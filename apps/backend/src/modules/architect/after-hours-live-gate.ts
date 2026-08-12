import {
  evaluateAfterHoursToolGate,
  deriveLiveAfterHoursCallState,
  isPlatformDefaultAfterHoursPolicy,
  AFTER_HOURS_GATE_CODES,
  type AfterHoursCallTurn,
  type AfterHoursGateResult,
  type AfterHoursGatedAction,
  type AfterHoursLiveCallState,
  type AfterHoursPolicy,
  type BusinessHoursStateKind
} from "@coreai/shared";
import {
  afterHoursStateStoreAvailableForLive,
  clearAfterHoursCallState,
  readAfterHoursCallState,
  writeAfterHoursCallState
} from "../business/after-hours-call-state";
import {
  buildAfterHoursSnapshotForBusiness,
  logAfterHoursRouting,
  resolveAfterHoursPolicyForBusiness
} from "../business/after-hours-state";
import { parseTranscriptSegments } from "../notifications/sms-disclosure";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeRole(value: unknown): "assistant" | "user" | null {
  const role = String(value ?? "").toLowerCase();
  if (role === "assistant" || role === "bot" || role === "ai" || role === "agent") return "assistant";
  if (role === "user" || role === "human" || role === "customer" || role === "caller") return "user";
  // system / tool / tool_calls / tool_call_result are never conversation turns.
  return null;
}

function turnText(entry: Record<string, unknown>): string {
  const message = entry.message ?? entry.content ?? entry.text;
  return typeof message === "string" ? message.trim() : "";
}

function turnsFromArray(value: unknown): AfterHoursCallTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: AfterHoursCallTurn[] = [];
  for (const raw of value) {
    const entry = asRecord(raw);
    const role = normalizeRole(entry.role);
    if (!role) continue;
    const content = turnText(entry);
    if (!content) continue;
    turns.push({ role, content });
  }
  return turns;
}

export function extractStructuredCallTurns(body: Record<string, unknown>): AfterHoursCallTurn[] {
  const message = asRecord(body.message);
  const artifact = asRecord(message.artifact);

  for (const candidate of [artifact.messages, message.conversation, message.messages]) {
    const turns = turnsFromArray(candidate);
    if (turns.length > 0) return turns;
  }

  const transcript =
    typeof message.transcript === "string"
      ? message.transcript
      : typeof body.transcript === "string"
        ? body.transcript
        : "";
  if (!transcript.trim()) return [];

  return parseTranscriptSegments(transcript)
    .filter((segment) => segment.role === "assistant" || segment.role === "user")
    .map((segment) => ({ role: segment.role as "assistant" | "user", content: segment.text }));
}

export type LiveAfterHoursGateContext = {
  /** True only for LIVE calls of a policy-enabled business outside open hours. */
  active: boolean;
  /** Production without the distributed store — gated tools must fail safely. */
  storeUnavailable?: boolean;
  state?: AfterHoursLiveCallState;
  policy?: AfterHoursPolicy | null;
};

export const INACTIVE_AFTER_HOURS_GATE: LiveAfterHoursGateContext = { active: false };

export async function resolveLiveAfterHoursGateContext(params: {
  businessId: string | undefined | null;
  installedAgentId?: string | null;
  callId: string | undefined | null;
  executionMode: string;
  body: Record<string, unknown>;
}): Promise<LiveAfterHoursGateContext> {
  const { businessId, callId } = params;
  if (params.executionMode !== "LIVE" || !businessId || !callId) return INACTIVE_AFTER_HOURS_GATE;

  let policy: AfterHoursPolicy | null = null;
  try {
    policy = await resolveAfterHoursPolicyForBusiness(businessId, params.installedAgentId ?? null);
  } catch (error) {
    console.error("[after-hours] live policy resolution failed", error);
    return { active: true, storeUnavailable: true, policy: null };
  }
  if (!policy?.enabled) return INACTIVE_AFTER_HOURS_GATE;

  const storeAvailable = afterHoursStateStoreAvailableForLive();

  try {
    let prior: AfterHoursLiveCallState | null = null;
    if (storeAvailable) {
      prior = await readAfterHoursCallState(businessId, callId);
    }

    let businessHoursState: BusinessHoursStateKind;
    if (prior) {
      businessHoursState = prior.businessHoursState;
    } else {
      const snapshot = await buildAfterHoursSnapshotForBusiness(businessId, {
        simulate: null,
        installedAgentId: params.installedAgentId ?? null
      });
      businessHoursState = snapshot.state;
    }

    if (businessHoursState === "OPEN") return INACTIVE_AFTER_HOURS_GATE;

    if (businessHoursState !== "CLOSED" && isPlatformDefaultAfterHoursPolicy(policy)) {
      return INACTIVE_AFTER_HOURS_GATE;
    }

    if (!storeAvailable) {
      logAfterHoursRouting({
        event: "live_state_store_unavailable",
        businessId,
        installedAgentId: params.installedAgentId ?? null,
        callId,
        hoursState: businessHoursState,
        executionMode: "LIVE",
        warning: "distributed after-hours state store unavailable in production — gated tools fail safely"
      });
      return { active: true, storeUnavailable: true, policy };
    }

    const turns = extractStructuredCallTurns(params.body);
    const derived = deriveLiveAfterHoursCallState({ turns, policy, businessHoursState });

    const route = prior?.route === "RED_FLAG_DETECTED" ? "RED_FLAG_DETECTED" : derived.route;
    const emergencyInstructionStatus =
      prior?.emergencyInstructionStatus === "GIVEN" && route === "RED_FLAG_DETECTED"
        ? "GIVEN"
        : route === "RED_FLAG_DETECTED" && derived.emergencyInstructionStatus === "NOT_REQUIRED"
          ? "REQUIRED"
          : derived.emergencyInstructionStatus;

    const state: AfterHoursLiveCallState = {
      businessHoursState,
      route,
      emergencyInstructionStatus,
      staffNotificationStatus: prior?.staffNotificationStatus ?? "NOT_REQUESTED",
      redFlags: Array.from(new Set([...(prior?.redFlags ?? []), ...derived.redFlags])),
      policyVersion: derived.policyVersion,
      updatedAt: new Date().toISOString()
    };

    await writeAfterHoursCallState(businessId, callId, state);

    if (prior?.route !== state.route) {
      logAfterHoursRouting({
        event: "live_route_transition",
        businessId,
        installedAgentId: params.installedAgentId ?? null,
        callId,
        hoursState: businessHoursState,
        route: state.route,
        executionMode: "LIVE",
        redFlagDetected: state.redFlags.length > 0,
        emergencyInstructionGiven: state.emergencyInstructionStatus === "GIVEN"
      });
    }

    return { active: true, state, policy };
  } catch (error) {
    console.error("[after-hours] live state resolution failed — gated tools fail safely", error);
    return { active: true, storeUnavailable: true, policy };
  }
}

/** Gate one tool action for the current call. Non-fatal: the call continues. */
export function gateLiveAfterHoursAction(
  gate: LiveAfterHoursGateContext,
  action: AfterHoursGatedAction
): AfterHoursGateResult {
  if (!gate.active) return { allowed: true };
  if (action === "staff_alert") return { allowed: true };

  if (gate.storeUnavailable || !gate.state) {
    return {
      allowed: false,
      code: AFTER_HOURS_GATE_CODES.stateStoreUnavailable,
      message:
        "After-hours safety state is unavailable right now. Do not book or send anything. Take the caller's name and callback number for the team, and if they describe a possible medical emergency tell them to call 911 or go to the nearest emergency department."
    };
  }

  return evaluateAfterHoursToolGate({
    route: gate.state.route,
    emergencyInstructionStatus: gate.state.emergencyInstructionStatus,
    action
  });
}

/** Call ended — clear the per-call state (the TTL remains the backstop). */
export async function endLiveAfterHoursCall(
  businessId: string | undefined | null,
  callId: string | undefined | null
): Promise<void> {
  if (!businessId || !callId) return;
  try {
    await clearAfterHoursCallState(businessId, callId);
  } catch {
    // TTL backstop.
  }
}
