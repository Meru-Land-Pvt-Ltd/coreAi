import { prisma } from "../../lib/prisma";
import { ARCHITECT_SHARE } from "./payout-earnings";

export async function computeArchitectPayoutSummary(architectUserId: string) {
  const [payoutMethod, payouts] = await Promise.all([
    prisma.architectPayoutMethod.findUnique({ where: { architectUserId } }),
    prisma.architectPayout.findMany({
      where: { architectUserId, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: 1
    })
  ]);

  return {
    payoutMethod: payoutMethod
      ? {
          bankName: payoutMethod.bankName,
          accountLast4: payoutMethod.accountNumber.slice(-4),
          ifscCode: payoutMethod.ifscCode,
          verified: true
        }
      : null,
    architectSharePercent: Math.round(ARCHITECT_SHARE * 100),
    lastPayoutAt: payouts[0]?.createdAt.toISOString() ?? null
  };
}
