import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/**
 * Business-scoped audit trail (plan Part 6). Append-only by construction:
 * this helper is the only application write path, and no update/delete route
 * exists for BusinessActivityLog rows. Writes are best-effort — an audit
 * outage must never fail the action it records — but failures are logged
 * loudly so silence is visible.
 */
export type BusinessActivityAction =
  | "RULE_CREATED"
  | "RULE_UPDATED"
  | "RULE_DELETED"
  | "RULE_ROLLED_BACK"
  | "KNOWLEDGE_UPLOADED"
  | "KNOWLEDGE_ARCHIVED"
  | "KNOWLEDGE_DELETED"
  | "KNOWLEDGE_VISIBILITY_CHANGED"
  | "TEAM_MEMBER_ADDED"
  | "TEAM_MEMBER_UPDATED"
  | "TEAM_MEMBER_DEACTIVATED"
  | "TEAM_INVITE_SENT"
  | "TEAM_INVITE_REVOKED"
  | "TEAM_INVITE_ACCEPTED"
  | "OWNERSHIP_TRANSFERRED"
  | "INTEGRATION_CHANGED"
  | "WORKFLOW_CONFIG_CHANGED"
  | "REMINDER_CONFIG_CHANGED"
  | "PHONE_SETTINGS_CHANGED"
  | "AGENT_DEPLOYED"
  | "AGENT_PAUSED"
  | "BILLING_SETTINGS_CHANGED"
  | "CUSTOMER_MERGED"
  | "CUSTOMER_SPLIT"
  | "CUSTOMER_DELETED"
  | "CALL_DELETED"
  | "EVALUATION_REVIEWED"
  | "CONVERSATION_TAKEN_OVER"
  | "CONVERSATION_RETURNED_TO_AI";

export async function logBusinessActivity(input: {
  businessId: string;
  action: BusinessActivityAction;
  actorUserId?: string | null;
  actorLabel?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** Keep it small and PII-light: ids, field names, before/after summaries. */
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.businessActivityLog.create({
      data: {
        businessId: input.businessId,
        action: input.action,
        actorUserId: input.actorUserId ?? null,
        actorLabel: input.actorLabel ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        detailJson: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined
      }
    });
  } catch (error) {
    console.error("[activity-log] write failed (action still completed)", {
      businessId: input.businessId,
      action: input.action,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
