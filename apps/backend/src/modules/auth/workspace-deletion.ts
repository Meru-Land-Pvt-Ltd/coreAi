import type { UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export type WorkspaceDeletionResult = {
  /** True when the User row itself was removed (this was their last workspace). */
  accountRemoved: boolean;
  /** Roles the account still holds. Empty when the account was removed. */
  remainingRoles: UserRole[];
};

export async function deleteUserWorkspace(
  userId: string,
  workspace: Extract<UserRole, "BUSINESS" | "ARCHITECT">
): Promise<WorkspaceDeletionResult> {
  const [memberships, user] = await Promise.all([
    prisma.userRoleMembership.findMany({ where: { userId }, select: { role: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  ]);

  const heldRoles = new Set<UserRole>(memberships.map((membership) => membership.role));
  if (user?.role) heldRoles.add(user.role);

  const remainingRoles = [...heldRoles].filter((role) => role !== workspace);

  if (remainingRoles.length === 0) {
    await prisma.user.delete({ where: { id: userId } });
    return { accountRemoved: true, remainingRoles: [] };
  }

  await prisma.$transaction(async (tx) => {
    if (workspace === "BUSINESS") {
      const doomed = await tx.business.findMany({ where: { ownerId: userId }, select: { id: true } });
      if (doomed.length > 0) {
        const orphaned = await tx.payment.findMany({
          where: { userId, businessId: { in: doomed.map((b) => b.id) } },
          select: { id: true, businessId: true, lineItemsJson: true }
        });
        for (const payment of orphaned) {
          const meta =
            payment.lineItemsJson && typeof payment.lineItemsJson === "object" && !Array.isArray(payment.lineItemsJson)
              ? (payment.lineItemsJson as Record<string, unknown>)
              : {};
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              lineItemsJson: {
                ...meta,
                deletedWorkspaceBusinessId: payment.businessId,
                deletedWorkspaceAt: new Date().toISOString()
              }
            }
          });
        }
      }

      // Every business-owned record cascades from Business.
      await tx.business.deleteMany({ where: { ownerId: userId } });
    } else {
      await tx.agentListing.deleteMany({ where: { architectUserId: userId } });
      await tx.workflowDefinition.deleteMany({ where: { architectUserId: userId } });
      await tx.architectProfile.deleteMany({ where: { userId } });
    }

    await tx.userRoleMembership.deleteMany({ where: { userId, role: workspace } });

    if (user?.role === workspace && remainingRoles[0]) {
      await tx.user.update({ where: { id: userId }, data: { role: remainingRoles[0] } });
    }
  });

  return { accountRemoved: false, remainingRoles };
}
