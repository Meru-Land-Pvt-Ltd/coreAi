import { env } from "../../../config/env";
import { prisma } from "../../../lib/prisma";
import { escapeXml, normalizePhoneE164, twilioRestAuthHeader } from "../../architect/twilio-connector";
import { loadVoiceTransferContext } from "../../architect/voice-transfer-store";
import {
  resolveHandoffTargets,
  sendWarmHandoffContext,
  type HandoffTarget
} from "../../business/team/handoff-routing";
import type { NormalizedToolResult } from "./types";

/**
 * Live human handoff: rips the caller's Twilio leg away from the Vapi stream
 * and dials the business's configured team phone on the SAME call.
 *
 * The destination is resolved from the DATABASE at transfer time (per-agent
 * configJson.businessDetails.teamPhone, then BusinessProfile.teamPhone) —
 * mirroring the deploy-time gating exactly. It never trusts the model's
 * parameters, the caller's words, or runtime env fallbacks like
 * TWILIO_DEFAULT_TEAM_PHONE, so prompt injection or context drift can never
 * bridge a caller to the wrong number.
 *
 * Failure is always closed and honest: any missing precondition returns
 * success=false with instructions for the assistant to take a message and
 * alert the team instead — the caller is never left with a dead line.
 */

const TAKE_MESSAGE_FALLBACK =
  "Do NOT say a transfer is happening. Apologize briefly, take the caller's name, callback number, and message, then call send_notification with urgency to alert the team.";

/**
 * Minimal structural context — BOTH live webhook runtimes (the production
 * handler in architect/twilio-business-routing.ts and the ai-voice-assistant
 * gateway) satisfy this shape.
 */
export interface TransferToolContext {
  business: { businessId?: string | null } | null;
  customerPhone?: string;
  callId: string;
  executionMode: string;
  installedAgentId?: string | null;
  /** Live call summary from the webhook payload — powers the warm briefing. */
  summary?: string | null;
  callerName?: string | null;
}

export interface HumanTransferDeps {
  fetchImpl?: typeof fetch;
}

function failClosed(code: string, detail: string): NormalizedToolResult {
  return {
    success: false,
    code,
    message: `${detail} ${TAKE_MESSAGE_FALLBACK}`
  };
}

/**
 * The buyer's transfer destination, resolved the same way deploy gates the
 * tool: per-agent businessDetails.teamPhone first, then the business profile.
 * Returns "" when nothing valid is configured.
 */
export async function resolveTransferDestination(params: {
  businessId: string;
  installedAgentId?: string | null;
}): Promise<string> {
  const [agentRow, profile] = await Promise.all([
    params.installedAgentId
      ? prisma.installedAgent.findUnique({
          where: { id: params.installedAgentId },
          select: { configJson: true }
        })
      : Promise.resolve(null),
    prisma.businessProfile.findUnique({
      where: { businessId: params.businessId },
      select: { teamPhone: true }
    })
  ]);

  const config =
    agentRow?.configJson && typeof agentRow.configJson === "object" && !Array.isArray(agentRow.configJson)
      ? (agentRow.configJson as Record<string, unknown>)
      : null;
  const details =
    config?.businessDetails && typeof config.businessDetails === "object" && !Array.isArray(config.businessDetails)
      ? (config.businessDetails as Record<string, unknown>)
      : null;
  const agentTeamPhone = typeof details?.teamPhone === "string" ? details.teamPhone : "";

  return normalizePhoneE164(agentTeamPhone || profile?.teamPhone);
}

/** TwiML Twilio executes after the redirect: bridge to the team, then report back. */
export function buildTransferTwiml(params: {
  destination: string;
  actionUrl: string;
  timeoutSeconds: number;
  /**
   * Explicit caller ID for the bridged leg. Default (absent) passes the
   * customer's number through — right for domestic transfers. International
   * destinations need the business's own Twilio number: many carriers (India
   * among them) reject calls arriving on international routes that present a
   * local caller ID (anti-spoofing).
   */
  callerId?: string | null;
}): string {
  const callerIdAttr = params.callerId ? ` callerId="${escapeXml(params.callerId)}"` : "";
  return [
    "<Response>",
    "<Say>Connecting you with the team now. Please hold.</Say>",
    `<Dial timeout="${params.timeoutSeconds}" action="${escapeXml(params.actionUrl)}" method="POST" answerOnBridge="true"${callerIdAttr}>`,
    `<Number>${escapeXml(params.destination)}</Number>`,
    "</Dial>",
    "</Response>"
  ].join("");
}

/** International hop (non-NANP destination) → present the business's own number. */
export function resolveTransferCallerId(
  destination: string,
  businessNumber: string | null | undefined
): string | null {
  if (destination.startsWith("+1")) return null;
  return businessNumber || null;
}

export async function runTransferToHumanTool(
  rawParams: Record<string, unknown>,
  ctx: TransferToolContext,
  deps: HumanTransferDeps = {}
): Promise<NormalizedToolResult> {
  const reason =
    typeof rawParams.reason === "string" && rawParams.reason.trim()
      ? rawParams.reason.trim().slice(0, 500)
      : "Caller asked for a person.";
  const requestedBy = rawParams.caller_requested === false ? "ai" : "customer";
  const businessId = ctx.business?.businessId;

  if (!businessId) {
    return failClosed("TRANSFER_UNAVAILABLE", "The business for this call could not be resolved.");
  }

  // WHO to dial: available, handoff-eligible team members (priority order,
  // optional department filter — the model's department value only ever
  // FILTERS server-side rows, it can never introduce a number). Businesses
  // without team members keep the legacy per-agent/profile teamPhone.
  let targets: HandoffTarget[] = [];
  try {
    targets = await resolveHandoffTargets({
      businessId,
      department: typeof rawParams.department === "string" ? rawParams.department : null
    });
    if (targets.length === 0) {
      const legacy = await resolveTransferDestination({
        businessId,
        installedAgentId: ctx.installedAgentId ?? null
      });
      if (legacy) targets = [{ teamMemberId: null, destination: legacy, displayName: "the team" }];
    }
  } catch (error) {
    console.error("[human-transfer] destination lookup failed", {
      businessId,
      message: error instanceof Error ? error.message : String(error)
    });
    return failClosed("TRANSFER_UNAVAILABLE", "The transfer destination could not be loaded right now.");
  }

  if (targets.length === 0) {
    return failClosed(
      "NO_TRANSFER_DESTINATION",
      "No available team member or team phone is configured for this business, so a live transfer is not possible."
    );
  }

  const callerNumber = normalizePhoneE164(ctx.customerPhone);
  targets = targets.filter((t) => normalizePhoneE164(t.destination) !== callerNumber || !callerNumber);
  if (targets.length === 0) {
    return failClosed(
      "TRANSFER_LOOP_BLOCKED",
      "Every transfer destination matches the caller's own number, so a transfer would loop."
    );
  }

  const destination = targets[0].destination;

  // Test conversations never touch real telephony: report an honest simulation
  // so architects/buyers can exercise the flow end-to-end.
  if (ctx.executionMode !== "LIVE") {
    try {
      await prisma.handoffEvent.create({
        data: {
          businessId,
          installedAgentId: ctx.installedAgentId ?? null,
          channel: "VOICE",
          executionMode: ctx.executionMode,
          vapiCallId: ctx.callId || null,
          customerPhone: ctx.customerPhone || null,
          destination,
          reason,
          requestedBy,
          status: "SIMULATED",
          resolvedAt: new Date()
        }
      });
    } catch (error) {
      console.error("[human-transfer] simulated handoff record failed (non-fatal)", error);
    }
    return {
      success: true,
      code: "TRANSFER_SIMULATED",
      message:
        "Simulated transfer (test mode): on a live call the caller would now be connected to the team. Tell the caller you are connecting them, then end your turn."
    };
  }

  const transferCtx = await loadVoiceTransferContext(ctx.callId);
  if (!transferCtx) {
    return failClosed(
      "TRANSFER_UNAVAILABLE",
      "The live phone leg for this call is not reachable right now, so a transfer is not possible."
    );
  }

  const businessNumber = normalizePhoneE164(transferCtx.calledNumber);
  if (businessNumber) {
    targets = targets.filter((t) => normalizePhoneE164(t.destination) !== businessNumber);
  }
  if (targets.length === 0) {
    return failClosed(
      "TRANSFER_LOOP_BLOCKED",
      "The configured team phone is the business's own AI number, so a transfer would loop back to this assistant."
    );
  }

  const authHeader = twilioRestAuthHeader();
  if (!authHeader || !env.TWILIO_ACCOUNT_SID) {
    return failClosed("TRANSFER_UNAVAILABLE", "Telephony credentials are not configured.");
  }

  const [firstTarget, ...pendingTargets] = targets;

  const handoff = await prisma.handoffEvent.create({
    data: {
      businessId,
      installedAgentId: ctx.installedAgentId ?? transferCtx.installedAgentId ?? null,
      channel: "VOICE",
      executionMode: ctx.executionMode,
      vapiCallId: ctx.callId || null,
      twilioCallSid: transferCtx.twilioCallSid,
      customerPhone: ctx.customerPhone || transferCtx.callerNumber || null,
      destination: firstTarget.destination,
      reason,
      requestedBy,
      status: "INITIATED",
      assignedTeamMemberId: firstTarget.teamMemberId,
      attemptsCount: 1,
      metadataJson: {
        calledNumber: transferCtx.calledNumber ?? null,
        workflowId: transferCtx.workflowId ?? null,
        // The retry cascade: transfer-result dials these on no-answer, in order.
        pendingTargets: pendingTargets.map((t) => ({
          teamMemberId: t.teamMemberId,
          destination: t.destination,
          displayName: t.displayName
        })),
        callerName: ctx.callerName ?? null,
        summary: ctx.summary ? ctx.summary.slice(0, 500) : null
      }
    }
  });

  await prisma.handoffAttempt
    .create({
      data: {
        handoffEventId: handoff.id,
        teamMemberId: firstTarget.teamMemberId,
        destination: firstTarget.destination,
        attemptOrder: 1
      }
    })
    .catch((error) => console.error("[human-transfer] attempt record failed (non-fatal)", error));

  // Warm briefing to the person about to pick up (fire-and-forget).
  sendWarmHandoffContext({
    businessId,
    installedAgentId: ctx.installedAgentId ?? transferCtx.installedAgentId ?? null,
    vapiCallId: ctx.callId || null,
    target: firstTarget,
    callerNumber: ctx.customerPhone || transferCtx.callerNumber || null,
    callerName: ctx.callerName ?? null,
    reason,
    summary: ctx.summary ?? null
  });

  const base = env.BACKEND_URL.replace(/\/$/, "");
  const actionUrl = `${base}/architect/connectors/twilio/transfer-result/${handoff.id}`;
  const twiml = buildTransferTwiml({
    destination: firstTarget.destination,
    actionUrl,
    timeoutSeconds: env.TWILIO_FORWARD_TIMEOUT_SECONDS,
    callerId: resolveTransferCallerId(firstTarget.destination, businessNumber)
  });

  const fetchImpl = deps.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${encodeURIComponent(transferCtx.twilioCallSid)}.json`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({ Twiml: twiml }).toString()
      }
    );
  } catch (error) {
    console.error("[human-transfer] Twilio redirect request failed", {
      handoffId: handoff.id,
      message: error instanceof Error ? error.message : String(error)
    });
    await markHandoffFailed(handoff.id, "TWILIO_REQUEST_FAILED");
    return failClosed("TRANSFER_FAILED", "The phone system did not accept the transfer.");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[human-transfer] Twilio redirect rejected", {
      handoffId: handoff.id,
      status: response.status,
      // Twilio error bodies carry no secrets, but cap the size for the logs.
      detail: detail.slice(0, 300)
    });
    await markHandoffFailed(handoff.id, `TWILIO_HTTP_${response.status}`);
    return failClosed("TRANSFER_FAILED", "The phone system did not accept the transfer.");
  }

  console.log("[human-transfer] live call redirected to team phone", {
    handoffId: handoff.id,
    businessId,
    vapiCallId: ctx.callId
  });

  // The Vapi stream is being torn down by the redirect; this result usually
  // goes unspoken. It exists for the rare race where the model gets one more turn.
  return {
    success: true,
    code: "TRANSFER_INITIATED",
    message:
      "The caller is being connected to the team on this call right now. Do not speak again — the phone system has taken over.",
    data: { handoffId: handoff.id }
  };
}

async function markHandoffFailed(handoffId: string, detail: string): Promise<void> {
  try {
    await prisma.handoffEvent.update({
      where: { id: handoffId },
      data: { status: "FAILED", resolvedAt: new Date(), metadataJson: { failureDetail: detail } }
    });
  } catch (error) {
    console.error("[human-transfer] failed to mark handoff FAILED", { handoffId, detail, error });
  }
}
