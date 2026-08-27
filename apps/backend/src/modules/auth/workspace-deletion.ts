import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export type WorkspaceDeletionResult = {
  /** True when the User row itself was removed (this was their last workspace). */
  accountRemoved: boolean;
  /** Roles the account still holds. Empty when the account was removed. */
  remainingRoles: UserRole[];
};

async function deleteArchitectOwnedRecords(
  tx: Prisma.TransactionClient,
  userId: string,
  email: string
): Promise<void> {
  // Financial and execution records reference one another, so remove the
  // architect-owned leaves before deleting listings and workflows.
  await tx.architectLedgerEntry.deleteMany({ where: { architectUserId: userId } });
  await tx.architectEarning.deleteMany({ where: { architectUserId: userId } });
  await tx.architectPayout.deleteMany({ where: { architectUserId: userId } });
  await tx.architectPayoutMethod.deleteMany({ where: { architectUserId: userId } });
  await tx.architectBackupPayoutMethod.deleteMany({ where: { architectUserId: userId } });
  await tx.architectRefundSettlement.deleteMany({ where: { architectUserId: userId } });
  await tx.projectProposal.deleteMany({ where: { architectUserId: userId } });
  await tx.templateRequest.deleteMany({ where: { architectUserId: userId } });
  await tx.whatsAppConnection.deleteMany({ where: { architectUserId: userId } });
  await tx.memoryRecord.deleteMany({ where: { architectUserId: userId } });
  await tx.connectorCredential.deleteMany({
    where: { userId, provider: { in: ["GMAIL", "CALENDLY"] } }
  });
  await tx.emailVerificationCode.deleteMany({ where: { email, role: "ARCHITECT" } });

  // Workflows cascade through every buyer installation. Usage executions are
  // the one installed-agent child that older databases restrict instead of
  // cascading, so remove them explicitly before deleting any workflow. This
  // deliberately applies to ACTIVE, PAUSED, and historical installations.
  await tx.agentUsageExecution.deleteMany({
    where: {
      installedAgent: {
        workflow: { architectUserId: userId }
      }
    }
  });

  await tx.agentListing.deleteMany({ where: { architectUserId: userId } });
  await tx.workflowDefinition.deleteMany({ where: { architectUserId: userId } });
  await tx.architectProfile.deleteMany({ where: { userId } });
}

export async function deleteUserWorkspace(
  userId: string,
  workspace: Extract<UserRole, "BUSINESS" | "ARCHITECT">
): Promise<WorkspaceDeletionResult> {
  const [memberships, user] = await Promise.all([
    prisma.userRoleMembership.findMany({ where: { userId }, select: { role: true } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, email: true, _count: { select: { businesses: true } } }
    })
  ]);

  const heldRoles = new Set<UserRole>(memberships.map((membership) => membership.role));
  if (user?.role) heldRoles.add(user.role);
  // Legacy dual-role accounts may predate UserRoleMembership. An owned
  // business is authoritative evidence that the BUSINESS workspace exists.
  if (user?._count.businesses) heldRoles.add("BUSINESS");

  const remainingRoles = [...heldRoles].filter((role) => role !== workspace);

  if (remainingRoles.length === 0) {
    await prisma.$transaction(async (tx) => {
      if (workspace === "ARCHITECT") {
        if (!user?.email) throw new Error("User not found");
        // Run the same explicit cleanup used for dual-role accounts. Relying
        // only on User cascades would otherwise leave AgentUsageExecution's
        // restrictive FK blocking deletion of an installed/live agent.
        await deleteArchitectOwnedRecords(tx, userId, user.email);
      }
      if (user?.email) {
        await tx.emailVerificationCode.deleteMany({
          where: { email: user.email, role: { in: [...heldRoles] } }
        });
      }

      /* ONE PERSON'S DELETE MUST NOT ERASE ANOTHER PERSON'S MONEY.
         Deleting this row cascades away their Payments, and every Payment
         carries the ArchitectEarning that pays a DIFFERENT person for the
         agent they sold — including earnings already marked available to
         transfer. The buyer leaves; the architect's record of what they are
         owed leaves with them, silently.

         When there is a payment history, the account is emptied of personal
         details and closed instead of deleted. The person is gone from the
         platform either way; the money trail behind them is not. */
      const paymentCount = await tx.payment.count({ where: { userId } });

      if (paymentCount > 0) {
        await tx.user.update({
          where: { id: userId },
          data: {
            email: `deleted-${userId}@removed.triven.ai`,
            passwordHash: null,
            fullName: null,
            phone: null,
            location: null,
            profilePhotoUrl: null,
            isSuspended: true
          }
        });
      } else {
        await tx.user.delete({ where: { id: userId } });
      }
    });
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
          /* KEEP THE FEE BREAKDOWN. This note used to REPLACE it, and the
             breakdown is what separates the agent's price from the buyer's
             phone fee. Without it every later reader fell back to the whole
             amount charged, and the architect was paid a share of the phone
             fee as well. The note wraps the items instead of erasing them. */
          const existing = payment.lineItemsJson;
          const items: Prisma.InputJsonValue[] = Array.isArray(existing)
            ? (existing as Prisma.InputJsonValue[])
            : existing && typeof existing === "object" && Array.isArray((existing as { items?: unknown }).items)
              ? ((existing as { items: Prisma.InputJsonValue[] }).items)
              : [];
          const meta =
            existing && typeof existing === "object" && !Array.isArray(existing)
              ? (existing as Record<string, unknown>)
              : {};

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              lineItemsJson: {
                ...meta,
                items,
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
      if (!user?.email) throw new Error("User not found");
      await deleteArchitectOwnedRecords(tx, userId, user.email);
    }

    await tx.userRoleMembership.deleteMany({ where: { userId, role: workspace } });

    if (user?.role === workspace && remainingRoles[0]) {
      await tx.user.update({ where: { id: userId }, data: { role: remainingRoles[0] } });
    }
  });

  return { accountRemoved: false, remainingRoles };
}
