import { prisma } from "../../lib/prisma";
import { getStripeClient } from "../payments/stripe";
import { requireReadyConnectedAccount } from "./connect-account";
import { payoutConfig, stripeLivemode } from "./config";
import { logStripeError, normalizeStripeError } from "./stripe-errors";

/**
 * The ONLY place that calls stripe.transfers.create for architect earnings.
 * One transfer per released earning; deterministic idempotency key
 * `architect-transfer:{earningId}:{settlementVersion}`; stable transfer_group
 * `marketplace-payment:{paymentId}`.
 */

export type TransferResult =
  | { ok: true; transferredCents: number; alreadyTransferred: boolean }
  | { ok: false; code: string; retryable: boolean };

export async function createArchitectTransfer(params: {
  earningId: string;
  actor: "payout_request" | "release_cycle" | "reconciliation" | "admin";
}): Promise<TransferResult> {
  const stripe = getStripeClient();
  if (!stripe) return { ok: false, code: "STRIPE_NOT_CONFIGURED", retryable: false };

  const earning = await prisma.architectEarning.findUnique({ where: { id: params.earningId } });
  if (!earning) return { ok: false, code: "EARNING_NOT_FOUND", retryable: false };
  if (earning.stripeTransferId) {
    return { ok: true, transferredCents: earning.architectNetCents, alreadyTransferred: true };
  }
  if (earning.livemode !== stripeLivemode()) {
    return { ok: false, code: "STRIPE_MODE_MISMATCH", retryable: false };
  }
  if (earning.architectNetCents < payoutConfig.minimumTransferAmountMinor) {
    return { ok: false, code: "TRANSFER_AMOUNT_INVALID", retryable: false };
  }

  const account = await requireReadyConnectedAccount(earning.architectUserId);
  if (!account.ok) {
    return { ok: false, code: account.error.code, retryable: false };
  }

  // Atomic claim — only one caller can move AVAILABLE_FOR_TRANSFER → TRANSFER_PROCESSING.
  const claimed = await prisma.architectEarning.updateMany({
    where: { id: earning.id, status: "AVAILABLE_FOR_TRANSFER", stripeTransferId: null },
    data: { status: "TRANSFER_PROCESSING" }
  });
  if (claimed.count === 0) {
    const current = await prisma.architectEarning.findUnique({
      where: { id: earning.id },
      select: { status: true, stripeTransferId: true, architectNetCents: true }
    });
    if (current?.stripeTransferId) {
      return { ok: true, transferredCents: current.architectNetCents, alreadyTransferred: true };
    }
    if (current?.status === "TRANSFER_PROCESSING") {
      return { ok: false, code: "TRANSFER_ALREADY_PROCESSING", retryable: true };
    }
    return { ok: false, code: "EARNING_NOT_RELEASABLE", retryable: false };
  }

  const idempotencyKey = `architect-transfer:${earning.id}:${earning.settlementVersion}`;

  try {
    const transfer = await stripe.transfers.create(
      {
        amount: earning.architectNetCents,
        currency: "usd",
        destination: account.method.stripeAccountId,
        description: `Triven architect earning ${earning.id}`,
        transfer_group: `marketplace-payment:${earning.paymentId}`,
        metadata: {
          earningId: earning.id,
          internalPaymentId: earning.paymentId,
          architectId: earning.architectUserId,
          listingId: earning.listingId ?? "",
          settlementVersion: String(earning.settlementVersion)
        }
      },
      { idempotencyKey }
    );

    await prisma.architectEarning.update({
      where: { id: earning.id },
      data: {
        status: "TRANSFERRED",
        stripeTransferId: transfer.id,
        transferredAt: new Date()
      }
    });

    console.log("[payouts] transfer created", {
      earningId: earning.id,
      architectId: earning.architectUserId,
      transferId: transfer.id,
      amountCents: earning.architectNetCents,
      actor: params.actor
    });
    return { ok: true, transferredCents: earning.architectNetCents, alreadyTransferred: false };
  } catch (error) {
    const normalized = normalizeStripeError(error, "transfer.create");
    logStripeError(normalized, { earningId: earning.id, architectId: earning.architectUserId, actor: params.actor });

    // Release the claim so a retryable failure can be attempted again later.
    await prisma.architectEarning.updateMany({
      where: { id: earning.id, status: "TRANSFER_PROCESSING", stripeTransferId: null },
      data: { status: "AVAILABLE_FOR_TRANSFER" }
    });

    const code = normalized.code === "INSUFFICIENT_AVAILABLE_BALANCE"
      ? "TRANSFER_BALANCE_UNAVAILABLE"
      : normalized.code;
    return { ok: false, code, retryable: normalized.retryable };
  }
}

/**
 * Transfer every released earning for one architect (bounded). Used by the
 * payout request path and the optional release cycle.
 */
export async function transferReleasedEarnings(
  architectUserId: string,
  actor: "payout_request" | "release_cycle" | "reconciliation"
): Promise<{ transferredCents: number; failures: string[] }> {
  const releasable = await prisma.architectEarning.findMany({
    where: {
      architectUserId,
      status: "AVAILABLE_FOR_TRANSFER",
      livemode: stripeLivemode()
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 25
  });

  let transferredCents = 0;
  const failures: string[] = [];

  for (const earning of releasable) {
    const result = await createArchitectTransfer({ earningId: earning.id, actor });
    if (result.ok) {
      if (!result.alreadyTransferred) transferredCents += result.transferredCents;
    } else {
      failures.push(result.code);
      if (!result.retryable) continue;
      break; // stop batch on retryable infra failures — the next cycle resumes
    }
  }

  return { transferredCents, failures };
}

/**
 * Reverse (part of) a transferred earning after a refund/lost dispute. Bounded
 * by the amount actually transferred minus what was already reversed.
 */
export async function reverseArchitectTransfer(params: {
  earningId: string;
  amountCents: number;
  reason: string;
  sourceId: string;
}): Promise<{ ok: boolean; code?: string }> {
  const stripe = getStripeClient();
  if (!stripe) return { ok: false, code: "STRIPE_NOT_CONFIGURED" };

  const earning = await prisma.architectEarning.findUnique({ where: { id: params.earningId } });
  if (!earning?.stripeTransferId) return { ok: false, code: "TRANSFER_NOT_FOUND" };

  const alreadyReversed = earning.reversalCents;
  const transferredCents = earning.architectGrossCents - earning.refundCents - earning.disputeCents + earning.adjustmentCents + alreadyReversed;
  const reversible = Math.max(0, Math.min(params.amountCents, transferredCents - alreadyReversed));
  if (reversible <= 0) return { ok: false, code: "REVERSAL_AMOUNT_EXHAUSTED" };

  try {
    const reversal = await stripe.transfers.createReversal(
      earning.stripeTransferId,
      { amount: reversible, metadata: { earningId: earning.id, sourceId: params.sourceId } },
      { idempotencyKey: `architect-transfer-reversal:${earning.id}:${params.sourceId}` }
    );

    await prisma.$transaction(async (tx) => {
      try {
        await tx.architectLedgerEntry.create({
          data: {
            earningId: earning.id,
            architectUserId: earning.architectUserId,
            entryType: "TRANSFER_REVERSAL",
            amountCents: -reversible,
            currency: earning.currency,
            reason: params.reason,
            source: "system",
            sourceId: params.sourceId
          }
        });
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") return; // duplicate
        throw error;
      }

      const remainingAfter = transferredCents - alreadyReversed - reversible;
      await tx.architectEarning.update({
        where: { id: earning.id },
        data: {
          reversalCents: { increment: reversible },
          architectNetCents: { decrement: reversible },
          stripeTransferReversalId: reversal.id,
          status: remainingAfter <= 0 ? "REVERSED" : "PARTIALLY_REFUNDED",
          settlementVersion: { increment: 1 }
        }
      });
    });

    return { ok: true };
  } catch (error) {
    const normalized = normalizeStripeError(error, "transfer.reverse");
    logStripeError(normalized, { earningId: earning.id, sourceId: params.sourceId });
    return { ok: false, code: normalized.code };
  }
}
