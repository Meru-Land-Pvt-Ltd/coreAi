import { prisma } from "../../../lib/prisma";
import { maskPhone } from "../../notifications/sms-consent";
import { sendTrackedSms } from "../../notifications/sms-notification-service";

/**
 * Staff-aware handoff routing (plan Part 1). Chooses WHO to dial instead of
 * one global number: active, handoff-eligible, AVAILABLE team members with a
 * phone, ordered by priority. Department filtering narrows when it matches
 * and falls back to everyone eligible when it doesn't — a caller must never
 * be stranded because a department name didn't line up.
 *
 * Backward compatible by design: a business with no team members configured
 * gets an empty list, and the caller (human-transfer.ts) falls back to the
 * legacy per-agent/profile teamPhone exactly as before.
 *
 * Destinations always come from the database. Model/caller input only ever
 * FILTERS (department); it can never introduce a number.
 */

export interface HandoffTarget {
  /** null for the legacy teamPhone fallback target. */
  teamMemberId: string | null;
  destination: string;
  displayName: string;
}

const MAX_CASCADE_TARGETS = 3;

export async function resolveHandoffTargets(params: {
  businessId: string;
  department?: string | null;
}): Promise<HandoffTarget[]> {
  const members = await prisma.businessTeamMember.findMany({
    where: {
      businessId: params.businessId,
      active: true,
      handoffEligible: true,
      presence: "AVAILABLE",
      phone: { not: null }
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: { id: true, displayName: true, phone: true, department: true }
  });

  const wanted = (params.department ?? "").trim().toLowerCase();
  const inDepartment = wanted
    ? members.filter((m) => (m.department ?? "").trim().toLowerCase() === wanted)
    : [];
  const pool = inDepartment.length > 0 ? inDepartment : members;

  return pool.slice(0, MAX_CASCADE_TARGETS).map((m) => ({
    teamMemberId: m.id,
    destination: m.phone as string,
    displayName: m.displayName
  }));
}

/**
 * Warm-handoff briefing: texts the staff member who is about to receive the
 * call. TEAM_NOTIFICATION is consent-exempt (staff are not customers).
 * Fire-and-forget — briefing delivery must never delay the actual bridge.
 */
export function sendWarmHandoffContext(params: {
  businessId: string;
  installedAgentId?: string | null;
  vapiCallId?: string | null;
  target: HandoffTarget;
  callerNumber?: string | null;
  callerName?: string | null;
  reason: string;
  summary?: string | null;
  urgency?: string | null;
}): void {
  const lines = [
    `Incoming transfer${params.callerName ? ` from ${params.callerName}` : ""}${
      params.callerNumber ? ` (${params.callerNumber})` : ""
    }.`,
    `Reason: ${params.reason}`,
    ...(params.urgency && params.urgency !== "normal" ? [`Urgency: ${params.urgency.toUpperCase()}`] : []),
    ...(params.summary ? [`So far: ${params.summary.slice(0, 320)}`] : [])
  ];

  void sendTrackedSms({
    to: params.target.destination,
    body: lines.join("\n"),
    messageType: "TEAM_NOTIFICATION",
    businessId: params.businessId,
    installedAgentId: params.installedAgentId ?? null,
    vapiCallId: params.vapiCallId ?? null,
    dedupeKey: params.vapiCallId
      ? `handoff-brief:${params.vapiCallId}:${params.target.teamMemberId ?? "team"}`
      : null
  }).catch((error) => {
    console.error("[handoff-routing] warm-context SMS failed (transfer unaffected)", {
      businessId: params.businessId,
      to: maskPhone(params.target.destination),
      message: error instanceof Error ? error.message : String(error)
    });
  });
}

/** Shape stored in HandoffEvent.metadataJson.pendingTargets for the cascade. */
export interface PendingTarget {
  teamMemberId: string | null;
  destination: string;
  displayName: string;
}

export function parsePendingTargets(value: unknown): PendingTarget[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const destination = typeof record.destination === "string" ? record.destination : "";
      if (!destination) return null;
      return {
        teamMemberId: typeof record.teamMemberId === "string" ? record.teamMemberId : null,
        destination,
        displayName: typeof record.displayName === "string" ? record.displayName : "the team"
      };
    })
    .filter((t): t is PendingTarget => Boolean(t));
}
