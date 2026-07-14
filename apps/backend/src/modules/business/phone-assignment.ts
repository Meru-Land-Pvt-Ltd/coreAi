import type { Prisma, PlatformPhoneNumber } from "@prisma/client";
import { PhoneNumberServiceError } from "../admin/twilio-number-service";

export type PhoneAssignmentTx = Prisma.TransactionClient;

export async function assignPlatformNumber(
  tx: PhoneAssignmentTx,
  input: {
    platform: Pick<
      PlatformPhoneNumber,
      "id" | "phoneNumber" | "provider" | "twilioSid" | "isPlatformSmsSender"
    >;
    businessId: string;
    installedAgentId: string | null;
    buyerUserId?: string | null;
    forwardToPhone?: string | null;
  }
) {
  if (input.platform.isPlatformSmsSender) {
    throw new PhoneNumberServiceError(
      "This number is the reserved shared Triven SMS sender and cannot be assigned to a business.",
      409,
      "PLATFORM_SMS_SENDER_NOT_ASSIGNABLE"
    );
  }

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
      feeBilledAt: null,
      ...(input.platform.status === "ASSIGNED" ? { status: "AVAILABLE" as const } : {})
    }
  });

  return { platform };
}
