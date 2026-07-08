import { prisma } from "../../lib/prisma";

export async function logAdminAction(input: {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        metaJson: input.meta ? (input.meta as never) : undefined
      }
    });
  } catch (error) {
    console.error("[admin-audit] failed to write audit log (non-fatal)", {
      action: input.action,
      targetType: input.targetType,
      error
    });
  }
}
