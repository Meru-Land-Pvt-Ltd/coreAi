import { prisma } from "../../../lib/prisma";
import { sendTrackedSms } from "../../notifications/sms-notification-service";
import { logBusinessActivity } from "../activity-log";

/**
 * Shared team inbox for text channels (plan Part 1D): SMS, WhatsApp,
 * Telegram, email conversations move through an explicit state machine —
 * AI_ACTIVE → WAITING_FOR_HUMAN → HUMAN_ACTIVE → RETURNED_TO_AI/CLOSED —
 * with SLA escalation when nobody claims a waiting thread.
 *
 * Channel runtimes MUST consult isAiPausedForConversation() before letting
 * the AI reply: a thread a human owns (or is being handed to) never gets an
 * AI message racing the person.
 */

export class InboxError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 400
  ) {
    super(message);
  }
}

export type InboxAiState =
  | "AI_ACTIVE"
  | "WAITING_FOR_HUMAN"
  | "HUMAN_ACTIVE"
  | "RETURNED_TO_AI"
  | "CLOSED";

/**
 * How long the AI stays quiet after a customer asks for a person, before it
 * starts helping again.
 *
 * A CUSTOMER IS NEVER ABANDONED (found by the platform audit, 2026-08-27).
 * Asking for a human used to switch the AI off on that thread FOREVER: if
 * nobody on the team claimed it — and for a while nobody could — the customer
 * texted into silence and no one ever answered. Waiting is now a wait, not a
 * door closing. A person who actually takes the thread (HUMAN_ACTIVE) still
 * owns it for as long as they want; only the unanswered wait expires.
 */
export const HUMAN_WAIT_MINUTES = 15;

/** True when the AI must NOT reply on this conversation. */
export function isAiPausedForConversation(conversation: {
  aiState?: string | null;
  waitingSince?: Date | string | null;
}): boolean {
  /* A person is holding this thread. The AI never talks over them. */
  if (conversation.aiState === "HUMAN_ACTIVE") return true;
  if (conversation.aiState !== "WAITING_FOR_HUMAN") return false;

  const since = conversation.waitingSince ? new Date(conversation.waitingSince) : null;
  /* Waiting since nobody-knows-when is not a reason to stay silent. */
  if (!since || Number.isNaN(since.getTime())) return false;
  return Date.now() - since.getTime() < HUMAN_WAIT_MINUTES * 60 * 1000;
}

async function getConversationOrThrow(businessId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, businessId }
  });
  if (!conversation) throw new InboxError("CONVERSATION_NOT_FOUND", "Conversation not found", 404);
  return conversation;
}

/**
 * AI (or a route) asks for a human: thread enters the waiting queue, an
 * audit HandoffEvent opens, and available handoff-eligible staff get a text
 * pointing them at the inbox. Fire-and-forget on the notification — the state
 * change must never depend on SMS delivery.
 */
export async function requestHumanTakeover(input: {
  businessId: string;
  conversationId: string;
  reason: string;
  requestedBy?: "customer" | "ai" | "policy";
}): Promise<{ handoffEventId: string | null; alreadyWaiting: boolean }> {
  const conversation = await getConversationOrThrow(input.businessId, input.conversationId);

  if (conversation.aiState === "WAITING_FOR_HUMAN" || conversation.aiState === "HUMAN_ACTIVE") {
    return { handoffEventId: null, alreadyWaiting: true };
  }

  const now = new Date();
  const [, handoff] = await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { aiState: "WAITING_FOR_HUMAN", waitingSince: now, slaEscalatedAt: null }
    }),
    prisma.handoffEvent.create({
      data: {
        businessId: input.businessId,
        channel: conversation.channel?.toUpperCase() || "SMS",
        executionMode: "LIVE",
        conversationId: conversation.id,
        customerPhone: conversation.customerPhone || null,
        customerId: conversation.customerId ?? null,
        reason: input.reason.slice(0, 500),
        requestedBy: input.requestedBy ?? "customer",
        status: "INITIATED"
      }
    })
  ]);

  notifyEligibleStaff({
    businessId: input.businessId,
    text: `A ${conversation.channel} customer asked for a person${conversation.customerPhone ? ` — ${conversation.customerPhone}` : ""}. Reason: ${input.reason.slice(0, 160)}. Please reach out to them directly.`
  });

  return { handoffEventId: handoff.id, alreadyWaiting: false };
}

/**
 * SLA sweep (worker): waiting threads older than the SLA that nobody claimed
 * escalate once — managers/admin-tier staff get a text, and the thread is
 * marked so it never double-escalates.
 */
export async function escalateStaleWaiting(params?: { slaMinutes?: number; limit?: number }): Promise<number> {
  const slaMinutes = params?.slaMinutes ?? 5;
  const cutoff = new Date(Date.now() - slaMinutes * 60 * 1000);

  const stale = await prisma.conversation.findMany({
    where: {
      aiState: "WAITING_FOR_HUMAN",
      waitingSince: { lte: cutoff },
      slaEscalatedAt: null
    },
    take: params?.limit ?? 20,
    select: { id: true, businessId: true, channel: true, customerPhone: true, waitingSince: true }
  });

  for (const conversation of stale) {
    const claimed = await prisma.conversation.updateMany({
      where: { id: conversation.id, slaEscalatedAt: null },
      data: { slaEscalatedAt: new Date() }
    });
    if (claimed.count !== 1) continue;

    notifyEligibleStaff({
      businessId: conversation.businessId,
      rolesOnly: ["OWNER", "ADMIN", "MANAGER"],
      text: `STILL WAITING: a ${conversation.channel} customer${conversation.customerPhone ? ` (${conversation.customerPhone})` : ""} asked for a person over ${slaMinutes} minutes ago and nobody has been in touch.`
    });
  }

  return stale.length;
}

/** Text up to 3 eligible staff. TEAM_NOTIFICATION is consent-exempt (staff). */
function notifyEligibleStaff(params: { businessId: string; text: string; rolesOnly?: string[] }): void {
  void (async () => {
    try {
      const members = await prisma.businessTeamMember.findMany({
        where: {
          businessId: params.businessId,
          active: true,
          handoffEligible: true,
          phone: { not: null },
          ...(params.rolesOnly ? { role: { in: params.rolesOnly } } : {})
        },
        orderBy: [{ priority: "asc" }],
        take: 3,
        select: { phone: true }
      });
      // No configured staff: fall back to the business profile team phone so
      // single-operator businesses still hear about waiting customers.
      let phones = members.map((m) => m.phone as string);
      if (phones.length === 0) {
        const profile = await prisma.businessProfile.findUnique({
          where: { businessId: params.businessId },
          select: { teamPhone: true }
        });
        if (profile?.teamPhone) phones = [profile.teamPhone];
      }
      await Promise.all(
        phones.map((phone) =>
          sendTrackedSms({
            to: phone,
            body: params.text,
            messageType: "TEAM_NOTIFICATION",
            businessId: params.businessId,
            dedupeKey: null
          })
        )
      );
    } catch (error) {
      console.error("[inbox] staff notification failed (state change unaffected)", {
        businessId: params.businessId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  })();
}
