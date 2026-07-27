import type { UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export type WorkspaceDeletionResult = {
  /** True when the User row itself was removed (this was their last workspace). */
  accountRemoved: boolean;
  /** Roles the account still holds. Empty when the account was removed. */
  remainingRoles: UserRole[];
};

/**
 * Delete ONE workspace.
 *
 * Both danger-zone routes used to run `prisma.user.delete()`, which cascades
 * from the User row and therefore destroyed BOTH sides of a dual-role account:
 * deleting a business account also erased that person's architect listings,
 * workflows and profile, and vice versa. An account that still holds the other
 * role now keeps its User row, its other workspace's data, and its session —
 * only this workspace's records and its role membership are removed.
 */
export async function deleteUserWorkspace(
  userId: string,
  workspace: Extract<UserRole, "BUSINESS" | "ARCHITECT">
): Promise<WorkspaceDeletionResult> {
  const [memberships, user] = await Promise.all([
    prisma.userRoleMembership.findMany({ where: { userId }, select: { role: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  ]);

  /* Legacy accounts predate UserRoleMembership, so the primary-role column
     counts as an implicit grant — otherwise their other workspace would be
     treated as absent and the whole account deleted. */
  const heldRoles = new Set<UserRole>(memberships.map((membership) => membership.role));
  if (user?.role) heldRoles.add(user.role);

  const remainingRoles = [...heldRoles].filter((role) => role !== workspace);

  if (remainingRoles.length === 0) {
    await prisma.user.delete({ where: { id: userId } });
    return { accountRemoved: true, remainingRoles: [] };
  }

  await prisma.$transaction(async (tx) => {
    if (workspace === "BUSINESS") {
      // Every business-owned record cascades from Business.
      await tx.business.deleteMany({ where: { ownerId: userId } });
    } else {
      await tx.agentListing.deleteMany({ where: { architectUserId: userId } });
      await tx.workflowDefinition.deleteMany({ where: { architectUserId: userId } });
      await tx.architectProfile.deleteMany({ where: { userId } });
    }

    await tx.userRoleMembership.deleteMany({ where: { userId, role: workspace } });

    /* `User.role` is the legacy primary-role column that still drives some
       routing. Repoint it at a role the account actually keeps so nothing
       sends them back into the workspace they just deleted. */
    if (user?.role === workspace && remainingRoles[0]) {
      await tx.user.update({ where: { id: userId }, data: { role: remainingRoles[0] } });
    }
  });

  return { accountRemoved: false, remainingRoles };
}
