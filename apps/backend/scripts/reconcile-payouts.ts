/**
 * Payout/settlement reconciliation.
 *
 *   npm run reconcile:payouts -- --mode=report   (default; no writes)
 *   npm run reconcile:payouts -- --mode=repair   (explicit, idempotent)
 *
 * Repair mode fixes DATABASE state only — it synchronizes statuses from
 * Stripe, creates missing settlement rows, and releases stuck reservations.
 * It NEVER creates Stripe transfers or payouts.
 */
import { prisma } from "../src/lib/prisma";
import { getStripeClient } from "../src/modules/payments/stripe";
import { payoutConfig, stripeLivemode } from "../src/modules/payouts/config";
import { createSettlementForPayment } from "../src/modules/payouts/settlements";
import { isLegalPayoutTransition, PAYOUT_TERMINAL, payoutStatusFromStripe } from "../src/modules/payouts/state-machine";

const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const MODE = modeArg?.split("=")[1] === "repair" ? "repair" : "report";

type Finding = { kind: string; detail: Record<string, unknown> };
const findings: Finding[] = [];

function report(kind: string, detail: Record<string, unknown>) {
  findings.push({ kind, detail });
  console.log(`[reconcile] ${kind}`, JSON.stringify(detail));
}

async function main() {
  const livemode = stripeLivemode();
  const stripe = getStripeClient();
  console.log(`[reconcile] mode=${MODE} livemode=${livemode}`);

  // 1. Successful paid purchases without a settlement row.
  const missingSettlements = await prisma.payment.findMany({
    where: {
      status: "SUCCEEDED",
      listingId: { not: null },
      amountCents: { gt: 0 },
      earning: null
    },
    select: { id: true, listingId: true, amountCents: true }
  });
  for (const payment of missingSettlements) {
    report("MISSING_SETTLEMENT", { paymentId: payment.id, amountCents: payment.amountCents });
    if (MODE === "repair") await createSettlementForPayment(payment.id);
  }

  // 2. Duplicate Payment rows for one PaymentIntent (webhook/response race).
  const duplicateIntents = await prisma.$queryRaw<Array<{ stripeSessionId: string; count: bigint }>>`
    SELECT "stripeSessionId", COUNT(*) as count
    FROM "Payment"
    WHERE "stripeSessionId" IS NOT NULL
    GROUP BY "stripeSessionId"
    HAVING COUNT(*) > 1
  `;
  for (const row of duplicateIntents) {
    report("DUPLICATE_PAYMENT_INTENT_ROWS", { stripeSessionId: row.stripeSessionId, count: Number(row.count) });
    // Never auto-deleted — financial rows require manual review.
  }

  const reservationCutoff = new Date(Date.now() - payoutConfig.reservationTimeoutMinutes * 60 * 1000);

  // 3. Stuck reservations (never reached Stripe).
  const stuckReservations = await prisma.architectPayout.findMany({
    where: {
      status: { in: ["PENDING", "RESERVED", "PROCESSING"] },
      stripePayoutId: null,
      createdAt: { lt: reservationCutoff }
    }
  });
  for (const payout of stuckReservations) {
    report("STUCK_PAYOUT_RESERVATION", {
      payoutId: payout.id,
      architectUserId: payout.architectUserId,
      amountCents: payout.amountCents,
      status: payout.status,
      ageMinutes: Math.round((Date.now() - payout.createdAt.getTime()) / 60000)
    });
    if (MODE === "repair") {
      await prisma.architectPayout.update({
        where: { id: payout.id },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          failureCode: "RESERVATION_TIMEOUT",
          failureMessage:
            "The payout request did not complete and its reservation was released. Please request the payout again."
        }
      });
    }
  }

  // 4. Non-terminal payouts with a Stripe payout id — sync status from Stripe.
  if (stripe) {
    const pending = await prisma.architectPayout.findMany({
      where: { status: { notIn: PAYOUT_TERMINAL }, stripePayoutId: { not: null } },
      take: 100
    });
    for (const payout of pending) {
      const accountId = payout.stripeConnectedAccountId;
      if (!accountId) {
        report("PAYOUT_MISSING_CONNECTED_ACCOUNT", { payoutId: payout.id });
        continue;
      }
      try {
        const stripePayout = await stripe.payouts.retrieve(payout.stripePayoutId as string, {}, {
          stripeAccount: accountId
        });
        const mapped = payoutStatusFromStripe(stripePayout.status);
        if (mapped !== payout.status) {
          report("PAYOUT_STATUS_DRIFT", {
            payoutId: payout.id,
            local: payout.status,
            stripe: stripePayout.status
          });
          if (MODE === "repair" && isLegalPayoutTransition(payout.status, mapped)) {
            await prisma.architectPayout.update({
              where: { id: payout.id },
              data: {
                status: mapped,
                paidAt: mapped === "PAID" && !payout.paidAt ? new Date() : payout.paidAt,
                failedAt: mapped === "FAILED" && !payout.failedAt ? new Date() : payout.failedAt,
                failureCode: stripePayout.failure_code ?? payout.failureCode
              }
            });
          }
        }
      } catch (error) {
        report("PAYOUT_STRIPE_LOOKUP_FAILED", {
          payoutId: payout.id,
          error: error instanceof Error ? error.message.slice(0, 200) : "unknown"
        });
      }
    }
  } else {
    console.warn("[reconcile] Stripe is not configured — skipping Stripe cross-checks");
  }

  // 5. Earnings stuck in TRANSFER_PROCESSING (claim never resolved).
  const stuckTransfers = await prisma.architectEarning.findMany({
    where: {
      status: "TRANSFER_PROCESSING",
      updatedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) }
    }
  });
  for (const earning of stuckTransfers) {
    report("STUCK_TRANSFER_CLAIM", { earningId: earning.id, architectUserId: earning.architectUserId });
    if (MODE === "repair" && !earning.stripeTransferId) {
      await prisma.architectEarning.updateMany({
        where: { id: earning.id, status: "TRANSFER_PROCESSING", stripeTransferId: null },
        data: { status: "AVAILABLE_FOR_TRANSFER" }
      });
    }
  }

  // 6. Transferred earnings without a transfer id (legacy coverage rows are
  //    expected; anything created after the ledger shipped is suspicious).
  const transferredWithoutId = await prisma.architectEarning.count({
    where: { status: "TRANSFERRED", stripeTransferId: null }
  });
  if (transferredWithoutId > 0) {
    report("TRANSFERRED_WITHOUT_TRANSFER_ID", { count: transferredWithoutId, note: "legacy coverage rows expected" });
  }

  // 7. Failed webhook events awaiting attention.
  const failedEvents = await prisma.stripeWebhookEvent.findMany({
    where: { processingStatus: "FAILED" },
    select: { stripeEventId: true, eventType: true, attemptCount: true, lastErrorCode: true }
  });
  for (const event of failedEvents) {
    report("FAILED_WEBHOOK_EVENT", event as unknown as Record<string, unknown>);
  }

  // 8. Mode mismatches: rows whose livemode disagrees with the configured key.
  const [methodMismatch, payoutMismatch, earningMismatch] = await Promise.all([
    prisma.architectPayoutMethod.count({ where: { stripeAccountId: { not: null }, livemode: { not: livemode } } }),
    prisma.architectPayout.count({ where: { livemode: { not: livemode } } }),
    prisma.architectEarning.count({ where: { livemode: { not: livemode } } })
  ]);
  if (methodMismatch || payoutMismatch || earningMismatch) {
    report("LIVEMODE_MISMATCH", { methodMismatch, payoutMismatch, earningMismatch });
  }

  console.log(`[reconcile] done — ${findings.length} finding(s), mode=${MODE}`);
}

main()
  .catch((error) => {
    console.error("[reconcile] failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
