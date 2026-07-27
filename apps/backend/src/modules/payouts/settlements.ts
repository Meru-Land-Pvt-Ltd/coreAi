import type { ArchitectEarningState, ArchitectLedgerEntryType, Prisma } from "@prisma/client";
import { paymentAgentGrossCents } from "../../lib/billing-invoices";
import { prisma } from "../../lib/prisma";
import { payoutConfig, stripeLivemode } from "./config";
import { architectShareOfRefund, calculateMarketplaceSettlement } from "./settlement-calculator";
import { isLegalEarningTransition } from "./state-machine";

/**
 * Immutable settlement ledger service. One ArchitectEarning row per eligible
 * Payment (unique paymentId). Money changes after creation are recorded as
 * append-only ArchitectLedgerEntry rows plus bounded adjustment columns —
 * gross/commission values are never rewritten.
 */

export async function createSettlementForPayment(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { listing: { select: { id: true, architectUserId: true, priceCents: true } } }
  });

  if (!payment?.listing || !payment.listingId) return;
  if (payment.status !== "SUCCEEDED") return;
  // Zero-value payments (free installs) never settle — without this guard the
  // listing-price fallback below would invent an earning for money that was
  // never charged.
  if (payment.amountCents <= 0) return;

  const agentGrossCents = paymentAgentGrossCents(payment);
  const grossCents = agentGrossCents > 0 ? agentGrossCents : payment.listing.priceCents;
  if (grossCents <= 0) return;

  const settlement = calculateMarketplaceSettlement({
    grossAmountMinor: grossCents,
    currency: payment.currency
  });

  const holdUntil = new Date(Date.now() + payoutConfig.earningHoldDays * 24 * 60 * 60 * 1000);

  try {
    await prisma.architectEarning.create({
      data: {
        architectUserId: payment.listing.architectUserId,
        buyerUserId: payment.userId,
        listingId: payment.listingId,
        paymentId: payment.id,
        currency: payment.currency,
        grossAmountCents: settlement.grossAmountMinor,
        platformCommissionCents: settlement.platformCommissionMinor,
        architectGrossCents: settlement.architectGrossMinor,
        architectNetCents: settlement.architectNetMinor,
        calculationVersion: settlement.calculationVersion,
        status: "HELD",
        holdUntil,
        livemode: stripeLivemode(),
        stripePaymentIntentId: payment.stripeSessionId ?? null
      }
    });
  } catch (error) {
    // P2002 on paymentId = the settlement already exists (duplicate webhook
    // delivery or response-path/webhook race) — exactly the idempotency we want.
    if ((error as { code?: string }).code !== "P2002") throw error;
  }
}

export type EarningTransitionInput = {
  earningId: string;
  to: ArchitectEarningState;
  /** What triggered this transition — stored on the audit ledger entry. */
  source: "stripe_webhook" | "admin" | "reconciliation" | "system";
  sourceId?: string | null;
  reason: string;
  data?: Prisma.ArchitectEarningUpdateInput;
};

/**
 * Apply a validated earning transition. Idempotent: transitioning to the
 * current state is a no-op; illegal transitions are rejected loudly.
 */
export async function transitionEarning(input: EarningTransitionInput) {
  return prisma.$transaction(async (tx) => {
    const earning = await tx.architectEarning.findUnique({ where: { id: input.earningId } });
    if (!earning) throw new Error(`Earning ${input.earningId} not found`);
    if (earning.status === input.to && !input.data) return earning;

    if (!isLegalEarningTransition(earning.status, input.to)) {
      console.error("[payouts] rejected illegal earning transition", {
        earningId: earning.id,
        from: earning.status,
        to: input.to,
        source: input.source,
        sourceId: input.sourceId ?? null
      });
      return earning;
    }

    return tx.architectEarning.update({
      where: { id: earning.id },
      data: { ...input.data, status: input.to }
    });
  });
}

/**
 * Release HELD earnings once the existing admin review gate approves them.
 * Unreviewed and rejected sales remain unavailable. Admin approval is the
 * explicit release decision, so an approved earning must not continue showing
 * as pending/held solely because its provisional hold date is still in the
 * future. Atomic claim per row; bounded batch; restart-safe.
 */
export async function releaseEligibleEarnings(architectUserId?: string): Promise<number> {
  const now = new Date();
  const candidates = await prisma.architectEarning.findMany({
    where: {
      status: "HELD",
      livemode: stripeLivemode(),
      ...(architectUserId ? { architectUserId } : {}),
      payment: {
        status: "SUCCEEDED",
        architectEarningStatus: "APPROVED",
        architectEarningReviewedAt: { not: null }
      }
    },
    select: { id: true },
    take: 50,
    orderBy: { createdAt: "asc" }
  });

  let released = 0;
  for (const candidate of candidates) {
    const claimed = await prisma.architectEarning.updateMany({
      where: { id: candidate.id, status: "HELD" },
      data: { status: "AVAILABLE_FOR_TRANSFER", availableAt: now }
    });
    released += claimed.count;
  }
  return released;
}

/**
 * Append a ledger entry and apply its bounded effect to the earning's
 * adjustment columns. The (entryType, sourceId, earningId) unique key absorbs
 * duplicate webhook deliveries — a second identical call is a no-op.
 */
export async function appendLedgerAdjustment(params: {
  earningId: string;
  entryType: ArchitectLedgerEntryType;
  amountCents: number; // signed
  reason: string;
  source: "stripe_webhook" | "admin" | "reconciliation" | "system";
  sourceId: string;
  createdByUserId?: string | null;
  column: "refundCents" | "disputeCents" | "reversalCents" | "adjustmentCents" | null;
}): Promise<boolean> {
  const earning = await prisma.architectEarning.findUnique({ where: { id: params.earningId } });
  if (!earning) return false;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.architectLedgerEntry.create({
        data: {
          earningId: params.earningId,
          architectUserId: earning.architectUserId,
          entryType: params.entryType,
          amountCents: params.amountCents,
          currency: earning.currency,
          reason: params.reason,
          source: params.source,
          sourceId: params.sourceId,
          createdByUserId: params.createdByUserId ?? null
        }
      });

      if (params.column) {
        const magnitude = Math.abs(params.amountCents);
        const updated = {
          refundCents: earning.refundCents,
          disputeCents: earning.disputeCents,
          reversalCents: earning.reversalCents,
          adjustmentCents: earning.adjustmentCents,
          [params.column]:
            params.column === "adjustmentCents"
              ? earning.adjustmentCents + params.amountCents
              : earning[params.column] + magnitude
        };
        const architectNetCents =
          earning.architectGrossCents -
          updated.refundCents -
          updated.disputeCents -
          updated.reversalCents +
          updated.adjustmentCents;

        await tx.architectEarning.update({
          where: { id: earning.id },
          data: {
            [params.column]: updated[params.column],
            architectNetCents,
            settlementVersion: { increment: 1 }
          }
        });
      }
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false; // duplicate delivery
    throw error;
  }
}

/**
 * Apply a Stripe refund to the related settlement. Called from the platform
 * webhook (charge.refunded). Idempotent per refund id.
 */
export async function applyRefundToSettlement(params: {
  paymentIntentId: string;
  refundId: string;
  /** Stripe's cumulative charge.amount_refunded — monotone across deliveries. */
  cumulativeRefundedCents: number;
  fullyRefunded: boolean;
  stripeChargeId?: string | null;
}): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { stripeSessionId: params.paymentIntentId },
    orderBy: { createdAt: "asc" },
    include: { earning: true }
  });
  if (!payment) return;

  if (params.fullyRefunded && payment.status !== "REFUNDED") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED" }
    });
  }

  const earning = payment.earning;
  if (!earning) return;

  // Target architect-share for the cumulative refunded amount; the delta from
  // what was already adjusted makes duplicate/out-of-order deliveries safe.
  const targetShareCents = architectShareOfRefund({
    refundAmountMinor: params.cumulativeRefundedCents,
    alreadyAdjustedMinor: 0,
    architectGrossMinor: earning.architectGrossCents
  });
  const shareCents = Math.max(0, targetShareCents - earning.refundCents);

  if (shareCents > 0) {
    const applied = await appendLedgerAdjustment({
      earningId: earning.id,
      entryType: "REFUND_ADJUSTMENT",
      amountCents: -shareCents,
      reason: params.fullyRefunded ? "Full buyer refund" : "Partial buyer refund",
      source: "stripe_webhook",
      sourceId: params.refundId,
      column: "refundCents"
    });
    if (!applied) return; // duplicate webhook delivery
  }

  const wasTransferred = ["TRANSFERRED", "PARTIALLY_REFUNDED"].includes(earning.status);
  const targetState: ArchitectEarningState = params.fullyRefunded
    ? wasTransferred
      ? "REVERSAL_PENDING"
      : "REFUNDED"
    : "PARTIALLY_REFUNDED";

  await transitionEarning({
    earningId: earning.id,
    to: targetState,
    source: "stripe_webhook",
    sourceId: params.refundId,
    reason: "Stripe refund",
    data: params.stripeChargeId ? { stripeChargeId: params.stripeChargeId } : undefined
  });
}

/**
 * Sync a transfer reversal that was created outside the app (Stripe Dashboard
 * or API). Applies the delta between Stripe's cumulative amount_reversed and
 * our recorded reversalCents; idempotent per (transfer, cumulative amount).
 */
export async function syncTransferReversalFromStripe(transfer: {
  id: string;
  amount_reversed?: number | null;
}): Promise<void> {
  const earning = await prisma.architectEarning.findUnique({
    where: { stripeTransferId: transfer.id }
  });
  if (!earning) return;

  const cumulativeReversed = transfer.amount_reversed ?? 0;
  const delta = cumulativeReversed - earning.reversalCents;
  if (delta <= 0) return;

  const applied = await appendLedgerAdjustment({
    earningId: earning.id,
    entryType: "TRANSFER_REVERSAL",
    amountCents: -delta,
    reason: "Stripe transfer reversal (external)",
    source: "stripe_webhook",
    sourceId: `${transfer.id}:${cumulativeReversed}`,
    column: "reversalCents"
  });
  if (!applied) return;

  const fullyReversed = cumulativeReversed >=
    earning.architectGrossCents - earning.refundCents - earning.disputeCents + earning.adjustmentCents;
  await transitionEarning({
    earningId: earning.id,
    to: fullyReversed ? "REVERSED" : "PARTIALLY_REFUNDED",
    source: "stripe_webhook",
    sourceId: transfer.id,
    reason: "Transfer reversed on Stripe"
  });
}

/**
 * Dispute lifecycle: created → hold; won → restore; lost → permanent loss.
 * Idempotent per dispute id via the ledger unique key.
 */
export async function applyDisputeToSettlement(params: {
  paymentIntentId: string;
  disputeId: string;
  disputeAmountCents: number;
  phase: "created" | "won" | "lost";
}): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { stripeSessionId: params.paymentIntentId },
    orderBy: { createdAt: "asc" },
    include: { earning: true }
  });
  const earning = payment?.earning;
  if (!earning) return;

  if (params.phase === "created") {
    const holdCents = Math.min(
      architectShareOfRefund({
        refundAmountMinor: params.disputeAmountCents,
        alreadyAdjustedMinor: earning.disputeCents,
        architectGrossMinor: earning.architectGrossCents
      }),
      Math.max(0, earning.architectNetCents)
    );
    const applied = await appendLedgerAdjustment({
      earningId: earning.id,
      entryType: "DISPUTE_HOLD",
      amountCents: -holdCents,
      reason: "Buyer dispute opened",
      source: "stripe_webhook",
      sourceId: params.disputeId,
      column: "disputeCents"
    });
    if (!applied) return;

    await transitionEarning({
      earningId: earning.id,
      to: "DISPUTED",
      source: "stripe_webhook",
      sourceId: params.disputeId,
      reason: "Dispute created",
      data: { statusBeforeDispute: earning.status }
    });
    return;
  }

  if (params.phase === "won") {
    const holdEntry = await prisma.architectLedgerEntry.findFirst({
      where: { earningId: earning.id, entryType: "DISPUTE_HOLD", sourceId: params.disputeId }
    });
    const releaseCents = Math.abs(holdEntry?.amountCents ?? 0);
    const applied = await appendLedgerAdjustment({
      earningId: earning.id,
      entryType: "DISPUTE_RELEASE",
      amountCents: releaseCents,
      reason: "Dispute won — hold released",
      source: "stripe_webhook",
      sourceId: params.disputeId,
      column: null
    });
    if (!applied) return;

    if (releaseCents > 0) {
      await prisma.architectEarning.update({
        where: { id: earning.id },
        data: {
          disputeCents: { decrement: releaseCents },
          architectNetCents: { increment: releaseCents },
          settlementVersion: { increment: 1 }
        }
      });
    }

    await transitionEarning({
      earningId: earning.id,
      to: earning.statusBeforeDispute ?? "HELD",
      source: "stripe_webhook",
      sourceId: params.disputeId,
      reason: "Dispute won",
      data: { statusBeforeDispute: null }
    });
    return;
  }

  // lost — the dispute hold becomes a permanent loss; state depends on whether
  // the money had already been transferred.
  const applied = await appendLedgerAdjustment({
    earningId: earning.id,
    entryType: "DISPUTE_LOSS",
    amountCents: 0,
    reason: "Dispute lost — hold made permanent",
    source: "stripe_webhook",
    sourceId: params.disputeId,
    column: null
  });
  if (!applied) return;

  const wasTransferred = ["TRANSFERRED", "PARTIALLY_REFUNDED"].includes(
    earning.statusBeforeDispute ?? earning.status
  );
  await transitionEarning({
    earningId: earning.id,
    to: wasTransferred ? "REVERSAL_PENDING" : "NEGATIVE_ADJUSTMENT",
    source: "stripe_webhook",
    sourceId: params.disputeId,
    reason: "Dispute lost"
  });
}
