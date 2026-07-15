import { prisma } from "../src/lib/prisma";
import { normalizeE164 } from "../src/modules/admin/twilio-number-service";

/**
 * Mark ONE number as the reserved shared Triven SMS sender:
 *
 *   npm run mark:sms-sender --workspace=@coreai/backend -- --number=+17252202182
 *
 * Defaults to TWILIO_SHARED_SMS_NUMBER when --number is omitted. Safe by
 * design: refuses a number that is currently assigned/reserved to a buyer
 * (unassign it first), only flips the one flag (+ smsEnabled), and never
 * touches any other row.
 */

function flagValue(name: string): string | undefined {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : undefined;
}

async function main() {
  const raw = flagValue("number") ?? process.env.TWILIO_SHARED_SMS_NUMBER ?? "";
  const e164 = normalizeE164(raw);
  if (!e164) {
    console.error("Usage: --number=+1XXXXXXXXXX (or set TWILIO_SHARED_SMS_NUMBER)");
    process.exitCode = 1;
    return;
  }

  const record = await prisma.platformPhoneNumber.findFirst({
    where: { OR: [{ phoneNumber: e164 }, { e164 }] }
  });

  if (!record) {
    console.error(
      `${e164} is not in PlatformPhoneNumber. Import it first (admin "Sync Twilio numbers" or the seed script), then re-run.`
    );
    process.exitCode = 1;
    return;
  }

  if (record.status === "ASSIGNED" || record.businessId || record.buyerUserId || record.installedAgentId) {
    console.error(
      `${e164} is currently assigned/reserved (status ${record.status}, businessId ${record.businessId ?? "-"}). ` +
        "The shared SMS sender must not be a buyer number — unassign it in the admin panel first."
    );
    process.exitCode = 1;
    return;
  }

  const activeRouting = await prisma.businessPhoneNumber.findFirst({
    where: { phoneNumber: record.phoneNumber, isActive: true },
    select: { businessId: true }
  });
  if (activeRouting) {
    console.error(
      `${e164} still has an ACTIVE BusinessPhoneNumber routing row (business ${activeRouting.businessId}). Unassign it first.`
    );
    process.exitCode = 1;
    return;
  }

  if (record.isPlatformSmsSender && record.smsEnabled) {
    console.log(`${e164} is already marked as the platform SMS sender. Nothing to do.`);
    return;
  }

  // Capability and role are separate fields: the sender must be SMS-capable
  // (smsEnabled=true) AND reserved (isPlatformSmsSender=true).
  await prisma.platformPhoneNumber.update({
    where: { id: record.id },
    data: { isPlatformSmsSender: true, smsEnabled: true }
  });
  console.log(`${e164} marked: isPlatformSmsSender=true, smsEnabled=true.`);

  const others = await prisma.platformPhoneNumber.findMany({
    where: { isPlatformSmsSender: true, NOT: { id: record.id } },
    select: { phoneNumber: true }
  });
  if (others.length > 0) {
    console.warn(
      `Note: other rows also carry isPlatformSmsSender=true (${others.map((n) => n.phoneNumber).join(", ")}). ` +
        "Phase 1 expects exactly one shared sender — clear the extras manually if unintended."
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
