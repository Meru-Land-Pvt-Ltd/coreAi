/**
 * One-time backfill: creates ArchitectEarning ledger rows for historic
 * successful marketplace payments and reconciles them against legacy
 * aggregate payouts, so the new ledger-based available balance matches what
 * architects saw before.
 *
 *   npx tsx scripts/backfill-architect-earnings.ts            # report only
 *   npx tsx scripts/backfill-architect-earnings.ts --apply    # write changes
 *
 * Idempotent: existing earnings are never rewritten; coverage only fills the
 * remaining shortfall. Creates NO Stripe objects.
 */
import { prisma } from "../src/lib/prisma";
import { paymentAgentGrossCents } from "../src/lib/billing-invoices";
import { payoutConfig, stripeLivemode } from "../src/modules/payouts/config";
import { calculateMarketplaceSettlement } from "../src/modules/payouts/settlement-calculator";

const APPLY = process.argv.includes("--apply");

async function main() {
  const livemode = stripeLivemode();
  console.log(`[backfill] mode=${APPLY ? "APPLY" : "REPORT-ONLY"} livemode=${livemode}`);

  // 1. Stamp livemode on legacy connect/payout rows (they predate the column).
  if (APPLY) {
    const methodStamp = await prisma.architectPayoutMethod.updateMany({
      where: { stripeAccountId: { not: null } },
      data: { livemode }
    });
    const payoutStamp = await prisma.architectPayout.updateMany({ data: { livemode } });
    console.log(`[backfill] livemode stamped: methods=${methodStamp.count} payouts=${payoutStamp.count}`);
  }

  // 2. Create missing settlements for successful paid purchases.
  const payments = await prisma.payment.findMany({
    where: {
      status: { in: ["SUCCEEDED", "REFUNDED"] },
      listingId: { not: null },
      earning: null
    },
    include: { listing: { select: { id: true, architectUserId: true, priceCents: true } } },
    orderBy: { createdAt: "asc" }
  });

  let created = 0;
  for (const payment of payments) {
    if (!payment.listing) continue;
    const agentGross = paymentAgentGrossCents(payment);
    const grossCents = agentGross > 0 ? agentGross : payment.listing.priceCents;
    if (grossCents <= 0) continue;

    const settlement = calculateMarketplaceSettlement({
      grossAmountMinor: grossCents,
      currency: payment.currency
    });

    const rejected = payment.architectEarningStatus === "REJECTED";
    const approved = payment.architectEarningStatus === "APPROVED" && payment.architectEarningReviewedAt;
    const refunded = payment.status === "REFUNDED";
    const holdUntil = new Date(
      payment.createdAt.getTime() + payoutConfig.earningHoldDays * 24 * 60 * 60 * 1000
    );

    const status = refunded
      ? ("REFUNDED" as const)
      : rejected
        ? ("FAILED" as const)
        : approved && holdUntil <= new Date()
          ? ("AVAILABLE_FOR_TRANSFER" as const)
          : ("HELD" as const);

    console.log(`[backfill] earning payment=${payment.id} gross=${grossCents} status=${status}`);
    if (!APPLY) continue;

    await prisma.architectEarning
      .create({
        data: {
          architectUserId: payment.listing.architectUserId,
          buyerUserId: payment.userId,
          listingId: payment.listingId,
          paymentId: payment.id,
          currency: payment.currency,
          grossAmountCents: settlement.grossAmountMinor,
          platformCommissionCents: settlement.platformCommissionMinor,
          architectGrossCents: settlement.architectGrossMinor,
          architectNetCents: refunded ? 0 : settlement.architectNetMinor,
          refundCents: refunded ? settlement.architectNetMinor : 0,
          calculationVersion: settlement.calculationVersion,
          status,
          holdUntil,
          availableAt: status === "AVAILABLE_FOR_TRANSFER" ? new Date() : null,
          livemode,
          stripePaymentIntentId: payment.stripeSessionId ?? null,
          createdAt: payment.createdAt
        }
      })
      .then(() => {
        created += 1;
      })
      .catch((error: { code?: string }) => {
        if (error.code !== "P2002") throw error;
      });
  }
  console.log(`[backfill] settlements created=${created} (of ${payments.length} candidates)`);

  // 3. Cover legacy aggregate payouts: the old flow transferred the requested
  //    amount at payout time without linking earnings. Mark the oldest released
  //    earnings as TRANSFERRED (legacy, no stripeTransferId) until the total
  //    active/paid payout amount is covered, so nothing double-pays.
  const architects = await prisma.architectPayout.groupBy({
    by: ["architectUserId"],
    where: { status: { in: ["PENDING", "PROCESSING", "IN_TRANSIT", "COMPLETED", "PAID"] } },
    _sum: { amountCents: true }
  });

  for (const row of architects) {
    const committed = row._sum.amountCents ?? 0;
    if (committed <= 0) continue;

    const alreadyCovered = await prisma.architectEarning.aggregate({
      where: {
        architectUserId: row.architectUserId,
        status: "TRANSFERRED",
        stripeTransferId: null
      },
      _sum: { architectNetCents: true }
    });
    let shortfall = committed - (alreadyCovered._sum.architectNetCents ?? 0);
    if (shortfall <= 0) continue;

    const releasable = await prisma.architectEarning.findMany({
      where: { architectUserId: row.architectUserId, status: "AVAILABLE_FOR_TRANSFER" },
      orderBy: { createdAt: "asc" }
    });

    for (const earning of releasable) {
      if (shortfall <= 0) break;
      const covered = Math.min(earning.architectNetCents, shortfall);
      const partial = covered < earning.architectNetCents;
      console.log(
        `[backfill] legacy coverage architect=${row.architectUserId} earning=${earning.id} covered=${covered}${partial ? " (partial)" : ""}`
      );
      shortfall -= covered;
      if (!APPLY) continue;

      if (!partial) {
        await prisma.architectEarning.update({
          where: { id: earning.id },
          data: { status: "TRANSFERRED", transferredAt: new Date() }
        });
      } else {
        // Split conceptually: the covered portion is recorded as a negative
        // adjustment (ledger CORRECTION) so the remainder stays withdrawable.
        await prisma.$transaction([
          prisma.architectLedgerEntry.create({
            data: {
              earningId: earning.id,
              architectUserId: earning.architectUserId,
              entryType: "CORRECTION",
              amountCents: -covered,
              currency: earning.currency,
              reason: "Covered by legacy aggregate payout before the settlement ledger existed",
              source: "reconciliation",
              sourceId: `legacy-backfill:${earning.id}`
            }
          }),
          prisma.architectEarning.update({
            where: { id: earning.id },
            data: {
              adjustmentCents: { decrement: covered },
              architectNetCents: { decrement: covered },
              settlementVersion: { increment: 1 }
            }
          })
        ]);
      }
    }

    if (shortfall > 0) {
      console.warn(
        `[backfill] architect=${row.architectUserId} has ${shortfall} cents of legacy payouts not covered by released earnings — review manually`
      );
    }
  }

  console.log("[backfill] done");
}

main()
  .catch((error) => {
    console.error("[backfill] failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
