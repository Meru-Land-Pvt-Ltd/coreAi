import type { Prisma, PlatformPhoneNumber } from "@prisma/client";

/**
 * Shared platform-number assignment semantics, mirroring the buyer setup
 * transaction in business/routes.ts: runtime call/SMS routing reads
 * BusinessPhoneNumber first, so BOTH rows must always change together.
 *
 * Callers run these inside their own prisma.$transaction so they can add
 * flow-specific steps (buyer setup releases the previous number; admin
 * assignment validates statuses) around the same core writes.
 */

export type PhoneAssignmentTx = Prisma.TransactionClient;

/**
 * Point a platform number at a business/agent:
 * BusinessPhoneNumber upserted as the active routing row (forwardToPhone is
 * preserved on update unless explicitly provided), PlatformPhoneNumber marked
 * ASSIGNED with the assignment links.
 */
export async function assignPlatformNumber(
  tx: PhoneAssignmentTx,
  input: {
    platform: Pick<PlatformPhoneNumber, "id" | "phoneNumber" | "provider" | "twilioSid">;
    businessId: string;
    installedAgentId: string | null;
    buyerUserId?: string | null;
    forwardToPhone?: string | null;
  }
) {
  const mapping = await tx.businessPhoneNumber.upsert({
    where: { phoneNumber: input.platform.phoneNumber },
    update: {
      businessId: input.businessId,
      installedAgentId: input.installedAgentId,
      provider: input.platform.provider,
      twilioPhoneNumberSid: input.platform.twilioSid ?? null,
      ...(input.forwardToPhone !== undefined ? { forwardToPhone: input.forwardToPhone } : {}),
      isActive: true
    },
    create: {
      businessId: input.businessId,
      installedAgentId: input.installedAgentId,
      phoneNumber: input.platform.phoneNumber,
      provider: input.platform.provider,
      twilioPhoneNumberSid: input.platform.twilioSid ?? null,
      forwardToPhone: input.forwardToPhone ?? null,
      isActive: true
    }
  });

  const platform = await tx.platformPhoneNumber.update({
    where: { id: input.platform.id },
    data: {
      status: "ASSIGNED",
      businessId: input.businessId,
      installedAgentId: input.installedAgentId,
      buyerUserId: input.buyerUserId ?? null,
      assignedAt: new Date()
    }
  });

  return { mapping, platform };
}

/**
 * Detach a platform number from its business/agent:
 * the BusinessPhoneNumber routing row is deactivated (kept for history —
 * project convention, matching buyer setup), and the PlatformPhoneNumber
 * assignment links are cleared. Status returns to AVAILABLE only from
 * ASSIGNED — DISABLED/ARCHIVED/RELEASED lifecycles are preserved.
 */
export async function unassignPlatformNumber(
  tx: PhoneAssignmentTx,
  input: { platform: Pick<PlatformPhoneNumber, "id" | "phoneNumber" | "status"> }
) {
  await tx.businessPhoneNumber.updateMany({
    where: { phoneNumber: input.platform.phoneNumber, isActive: true },
    data: { isActive: false, installedAgentId: null }
  });

  const platform = await tx.platformPhoneNumber.update({
    where: { id: input.platform.id },
    data: {
      businessId: null,
      installedAgentId: null,
      buyerUserId: null,
      assignedAt: null,
      ...(input.platform.status === "ASSIGNED" ? { status: "AVAILABLE" as const } : {})
    }
  });

  return { platform };
}
