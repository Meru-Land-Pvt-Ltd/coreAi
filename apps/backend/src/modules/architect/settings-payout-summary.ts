import { prisma } from "../../lib/prisma";
import { ARCHITECT_SHARE } from "./payout-earnings";

export async function computeArchitectPayoutSummary(architectUserId: string) {
  const [payoutMethod, backupPayoutMethod, payouts] = await Promise.all([
    prisma.architectPayoutMethod.findUnique({ where: { architectUserId } }),
    prisma.architectBackupPayoutMethod.findUnique({ where: { architectUserId } }),
    prisma.architectPayout.findMany({
      where: { architectUserId, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: 1
    })
  ]);

  return {
    payoutMethod: payoutMethod
      ? {
          bankName: payoutMethod.bankName ?? "Stripe bank account",
          accountHolderName: payoutMethod.accountHolderName ?? "",
          accountLast4: payoutMethod.accountLast4 ?? "",
          country: payoutMethod.country,
          routingLabel: payoutMethod.country === "IN" ? "IFSC" : "ABA routing number",
          routingLast4: payoutMethod.routingLast4,
          verificationStatus: payoutMethod.verificationStatus,
          // Parity with the payouts-page serializer so Settings can show the
          // same "Continue verification" affordance.
          payoutsEnabled: payoutMethod.payoutsEnabled,
          detailsSubmitted: payoutMethod.detailsSubmitted,
          stripeConnected: Boolean(payoutMethod.stripeAccountId),
          requiresAction: !(payoutMethod.verificationStatus === "VERIFIED" && payoutMethod.payoutsEnabled),
          verified: payoutMethod.verificationStatus === "VERIFIED" && payoutMethod.payoutsEnabled
        }
      : null,
    backupPayoutMethod: backupPayoutMethod
      ? {
          bankName: backupPayoutMethod.bankName ?? "Stripe bank account",
          accountHolderName: backupPayoutMethod.accountHolderName ?? "",
          accountLast4: backupPayoutMethod.accountLast4 ?? "",
          country: backupPayoutMethod.country,
          routingLabel: backupPayoutMethod.country === "IN" ? "IFSC" : "ABA routing number",
          routingLast4: backupPayoutMethod.routingLast4,
          verificationStatus: backupPayoutMethod.verificationStatus,
          verified: backupPayoutMethod.verificationStatus === "VERIFIED"
        }
      : null,
    architectSharePercent: Math.round(ARCHITECT_SHARE * 100),
    lastPayoutAt: payouts[0]?.createdAt.toISOString() ?? null
  };
}
