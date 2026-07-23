import {
  AFTER_HOURS_POLICY_VERSION,
  DEFAULT_DENTAL_AFTER_HOURS_POLICY,
  VOICE_NODE_TYPES,
  buildAfterHoursSnapshot,
  normalizeAfterHoursPolicy,
  type AfterHoursPolicy,
  type AfterHoursSnapshot
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { loadBusinessHoursState } from "./business-hours-state";

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function voiceNodePolicy(workflowJson: unknown): AfterHoursPolicy | null {
  const nodes = recordOf(workflowJson).nodes;
  if (!Array.isArray(nodes)) return null;

  for (const node of nodes) {
    const data = recordOf(recordOf(node).data);
    if (data.type !== VOICE_NODE_TYPES.voiceConversation) continue;
    return normalizeAfterHoursPolicy(data.afterHoursPolicy);
  }
  return null;
}

export function resolveAfterHoursPolicy(input: {
  configJson: unknown;
  workflowJson?: unknown;
}): AfterHoursPolicy {
  const buyer = normalizeAfterHoursPolicy(recordOf(input.configJson).afterHoursPolicy);
  if (buyer) return buyer;
  return voiceNodePolicy(input.workflowJson) ?? DEFAULT_DENTAL_AFTER_HOURS_POLICY;
}

export async function resolveAfterHoursPolicyForBusiness(
  businessId: string,
  installedAgentId?: string | null
): Promise<AfterHoursPolicy | null> {
  const agent = await prisma.installedAgent.findFirst({
    where: installedAgentId ? { id: installedAgentId } : { businessId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { configJson: true, workflow: { select: { workflowJson: true } } }
  });

  if (!agent) return null;

  return resolveAfterHoursPolicy({
    configJson: agent.configJson,
    workflowJson: agent.workflow?.workflowJson
  });
}

export async function buildAfterHoursSnapshotForBusiness(
  businessId: string,
  options?: { now?: Date; simulate?: "open" | "closed" | null }
): Promise<AfterHoursSnapshot> {
  const state = await loadBusinessHoursState(businessId);
  return buildAfterHoursSnapshot({
    weekly: state.weekly,
    special: state.special,
    timeZone: state.timeZone,
    now: options?.now,
    simulate: options?.simulate ?? null
  });
}

function maskPhoneForLog(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

export function logAfterHoursRouting(entry: {
  event: string;
  businessId?: string | null;
  installedAgentId?: string | null;
  callId?: string | null;
  timeZone?: string | null;
  hoursState?: string | null;
  route?: string | null;
  executionMode?: string | null;
  redFlagDetected?: boolean;
  emergencyInstructionGiven?: boolean;
  staffNotificationAttempted?: boolean;
  bookingAttempted?: boolean;
  outcome?: string | null;
  callerPhone?: string | null;
  warning?: string | null;
}): void {
  console.log("[after-hours]", {
    event: entry.event,
    policyVersion: AFTER_HOURS_POLICY_VERSION,
    businessId: entry.businessId ?? null,
    installedAgentId: entry.installedAgentId ?? null,
    callId: entry.callId ?? null,
    timeZone: entry.timeZone ?? null,
    hoursState: entry.hoursState ?? null,
    route: entry.route ?? null,
    executionMode: entry.executionMode ?? null,
    ...(entry.redFlagDetected !== undefined ? { redFlagDetected: entry.redFlagDetected } : {}),
    ...(entry.emergencyInstructionGiven !== undefined
      ? { emergencyInstructionGiven: entry.emergencyInstructionGiven }
      : {}),
    ...(entry.staffNotificationAttempted !== undefined
      ? { staffNotificationAttempted: entry.staffNotificationAttempted }
      : {}),
    ...(entry.bookingAttempted !== undefined ? { bookingAttempted: entry.bookingAttempted } : {}),
    ...(entry.outcome ? { outcome: entry.outcome } : {}),
    ...(entry.callerPhone !== undefined ? { callerPhone: maskPhoneForLog(entry.callerPhone) } : {}),
    ...(entry.warning ? { warning: entry.warning } : {})
  });
}
