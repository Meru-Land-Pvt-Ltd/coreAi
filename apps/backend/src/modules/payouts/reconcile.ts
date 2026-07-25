import { prisma } from "../../lib/prisma";
import { payoutConfig } from "./config";
import { createSettlementForPayment } from "./settlements";

export async function runSettlementReconcile(): Promise<{
  settlementsCreated: number;
  transferClaimsReleased: number;
  reservationsExpired: number;
}> {
  let settlementsCreated = 0;
  let transferClaimsReleased = 0;
  let reservationsExpired = 0;

  const missingSettlements = await prisma.payment.findMany({
    where: {
      status: "SUCCEEDED",
      listingId: { not: null },
      amountCents: { gt: 0 },
      earning: null
    },
    select: { id: true },
    take: 200
  });
  for (const payment of missingSettlements) {
    try {
      await createSettlementForPayment(payment.id);
      settlementsCreated += 1;
    } catch (error) {
      console.error("[payouts] reconcile settlement creation failed", {
        paymentId: payment.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const stuckTransfers = await prisma.architectEarning.updateMany({
    where: {
      status: "TRANSFER_PROCESSING",
      stripeTransferId: null,
      updatedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) }
    },
    data: { status: "AVAILABLE_FOR_TRANSFER" }
  });
  transferClaimsReleased = stuckTransfers.count;

  const reservationCutoff = new Date(Date.now() - payoutConfig.reservationTimeoutMinutes * 60 * 1000);
  const expired = await prisma.architectPayout.updateMany({
    where: {
      status: { in: ["PENDING", "RESERVED", "PROCESSING"] },
      stripePayoutId: null,
      createdAt: { lt: reservationCutoff }
    },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      failureCode: "RESERVATION_TIMEOUT",
      failureMessage:
        "The payout request did not complete and its reservation was released. Please request the payout again."
    }
  });
  reservationsExpired = expired.count;

  return { settlementsCreated, transferClaimsReleased, reservationsExpired };
}
