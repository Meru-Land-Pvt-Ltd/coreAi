import type Stripe from "stripe";
import { prisma } from "../../lib/prisma";
import { getStripeClient } from "../payments/stripe";
import { getArchitectBalances } from "./balance-service";
import { requireReadyConnectedAccount } from "./connect-account";
import { payoutConfig, stripeLivemode } from "./config";
import { releaseEligibleEarnings } from "./settlements";
import { PAYOUT_ACTIVE_STATES, payoutStatusFromStripe } from "./state-machine";
import { logStripeError, normalizeStripeError } from "./stripe-errors";
import { transferReleasedEarnings } from "./transfer-service";

/**
 * Manual payout requests: database-backed reservation → fresh Stripe balance
 * check → payouts.create on the CONNECTED account with a deterministic
 * idempotency key. A payout is never marked paid at creation — webhooks own
 * terminal states.
 */

export type PayoutRequestInput = {
  architectUserId: string;
  amountCents?: number;
  deliveryMethod: "standard" | "instant";
  clientRequestId: string;
};

export type PayoutRequestResult =
  | { ok: true; payoutId: string; status: string; duplicate: boolean }
  | { ok: false; code: string; userMessage: string; httpStatus: number; retryable?: boolean };

function failure(code: string, userMessage: string, httpStatus: number, retryable = false): PayoutRequestResult {
  return { ok: false, code, userMessage, httpStatus, retryable };
}

export async function findInstantPayoutDestination(stripeAccountId: string, currency: string) {
  const stripe = getStripeClient();
  if (!stripe) return null;
  try {
    const externalAccounts = await stripe.accounts.listExternalAccounts(stripeAccountId, { limit: 100 });
    return (
      externalAccounts.data.find(
        (account) =>
          account.currency === currency && account.available_payout_methods?.includes("instant")
      ) ?? null
    );
  } catch (error) {
    const normalized = normalizeStripeError(error, "instant.eligibility");
    logStripeError(normalized, { stripeAccountId });
    return null;
  }
}

export async function requestArchitectPayout(input: PayoutRequestInput): Promise<PayoutRequestResult> {
  const stripe = getStripeClient();
  if (!stripe) {
    return failure("PAYOUT_NOT_CONFIGURED", "Payouts are not configured yet. Contact platform support.", 503);
  }

  const livemode = stripeLivemode();

  // Idempotent replay: the same clientRequestId returns the existing request.
  const existing = await prisma.architectPayout.findFirst({
    where: {
      architectUserId: input.architectUserId,
      clientRequestId: input.clientRequestId,
      deliveryMethod: input.deliveryMethod,
      livemode
    }
  });
  if (existing) {
    return { ok: true, payoutId: existing.id, status: existing.status, duplicate: true };
  }

  const account = await requireReadyConnectedAccount(input.architectUserId);
  if (!account.ok) {
    return failure(account.error.code, account.error.userMessage, account.error.httpStatus);
  }
  const method = account.method;

  // Move any releasable earnings into the connected account first so the
  // Stripe balance reflects everything the architect can withdraw.
  await releaseEligibleEarnings(input.architectUserId);
  await transferReleasedEarnings(input.architectUserId, "payout_request");

  const balances = await getArchitectBalances(input.architectUserId, method.stripeAccountId);
  const payoutCurrency = (method.currency ?? payoutConfig.defaultPayoutCurrency).toLowerCase();
  const stripeBucket = balances.stripe[payoutCurrency] ?? {
    availableCents: 0,
    pendingCents: 0,
    instantAvailableCents: 0
  };

  // Non-USD connected accounts receive cross-currency transfers, so a USD
  // request amount cannot be applied 1:1 — sweep the full available balance.
  const crossCurrency = payoutCurrency !== "usd";
  const requestedCents = crossCurrency
    ? stripeBucket.availableCents
    : input.amountCents ?? stripeBucket.availableCents;

  if (!Number.isSafeInteger(requestedCents) || requestedCents <= 0) {
    return failure(
      "INSUFFICIENT_AVAILABLE_BALANCE",
      "There is no withdrawable Stripe balance yet. Transfers may still be settling.",
      422,
      true
    );
  }
  if (requestedCents < payoutConfig.minimumPayoutAmountMinor) {
    return failure("PAYOUT_BELOW_MINIMUM", "The requested amount is below the minimum payout.", 422);
  }

  let instantDestination: Stripe.BankAccount | Stripe.Card | null = null;
  if (input.deliveryMethod === "instant") {
    instantDestination = await findInstantPayoutDestination(method.stripeAccountId, payoutCurrency);
    if (!instantDestination) {
      return failure(
        "INSTANT_PAYOUT_NOT_AVAILABLE",
        "Instant payout is not currently available for this payout account.",
        422
      );
    }
    if (requestedCents > stripeBucket.instantAvailableCents) {
      return failure(
        "INSTANT_BALANCE_INSUFFICIENT",
        "The instant-available balance is not sufficient for this amount.",
        422
      );
    }
  } else if (requestedCents > stripeBucket.availableCents) {
    return failure(
      "INSUFFICIENT_AVAILABLE_BALANCE",
      "The requested amount exceeds the withdrawable Stripe balance.",
      422,
      true
    );
  }

  const idempotencyKey = `architect-payout:${input.architectUserId}:${input.clientRequestId}:${input.deliveryMethod}`;

  // Reservation: serialize per-architect via an advisory lock, then re-check
  // active reservations before inserting the RESERVED row. The unique
  // (architectUserId, clientRequestId, deliveryMethod, livemode) constraint is
  // the last line of defense against double submits.
  let payoutId: string;
  try {
    payoutId = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`architect-payout:${input.architectUserId}`}))`;

      const active = await tx.architectPayout.findMany({
        where: { architectUserId: input.architectUserId, status: { in: PAYOUT_ACTIVE_STATES }, livemode },
        select: { amountCents: true, stripePayoutId: true }
      });
      if (active.length >= payoutConfig.maxActivePayoutRequests) {
        throw Object.assign(new Error("Too many active payout requests"), { payoutCode: "PAYOUT_LIMIT_EXCEEDED" });
      }
      // Payouts already created at Stripe have deducted their funds from the
      // Stripe balance — only local reservations that never reached Stripe
      // still need subtracting here.
      const reservedCents = active
        .filter((payout) => !payout.stripePayoutId)
        .reduce((sum, payout) => sum + payout.amountCents, 0);
      const withdrawableCents =
        (input.deliveryMethod === "instant" ? stripeBucket.instantAvailableCents : stripeBucket.availableCents) -
        reservedCents;
      if (requestedCents > withdrawableCents) {
        throw Object.assign(new Error("Amount exceeds unreserved balance"), {
          payoutCode: "INSUFFICIENT_AVAILABLE_BALANCE"
        });
      }

      const created = await tx.architectPayout.create({
        data: {
          architectUserId: input.architectUserId,
          amountCents: requestedCents,
          currency: payoutCurrency,
          status: "RESERVED",
          deliveryMethod: input.deliveryMethod,
          origin: "MANUAL",
          livemode,
          clientRequestId: input.clientRequestId,
          idempotencyKey,
          stripeConnectedAccountId: method.stripeAccountId
        }
      });
      return created.id;
    });
  } catch (error) {
    const payoutCode = (error as { payoutCode?: string }).payoutCode;
    if (payoutCode === "PAYOUT_LIMIT_EXCEEDED") {
      return failure("PAYOUT_LIMIT_EXCEEDED", "Too many payout requests are already in progress.", 429);
    }
    if (payoutCode === "INSUFFICIENT_AVAILABLE_BALANCE") {
      return failure(
        "INSUFFICIENT_AVAILABLE_BALANCE",
        "The requested amount exceeds the withdrawable balance after pending requests.",
        422,
        true
      );
    }
    if ((error as { code?: string }).code === "P2002") {
      const duplicate = await prisma.architectPayout.findFirst({
        where: {
          architectUserId: input.architectUserId,
          clientRequestId: input.clientRequestId,
          deliveryMethod: input.deliveryMethod,
          livemode
        }
      });
      if (duplicate) return { ok: true, payoutId: duplicate.id, status: duplicate.status, duplicate: true };
    }
    throw error;
  }

  return executeReservedPayout(payoutId);
}

/**
 * Create the Stripe payout for a RESERVED row. Reused by the reconciliation
 * path after timeouts — the deterministic idempotency key guarantees at most
 * one Stripe payout per reservation.
 */
export async function executeReservedPayout(payoutId: string): Promise<PayoutRequestResult> {
  const stripe = getStripeClient();
  if (!stripe) {
    return failure("PAYOUT_NOT_CONFIGURED", "Payouts are not configured yet. Contact platform support.", 503);
  }

  const payout = await prisma.architectPayout.findUnique({ where: { id: payoutId } });
  if (!payout) return failure("PAYOUT_NOT_FOUND", "The payout request could not be found.", 404);
  if (payout.stripePayoutId) {
    return { ok: true, payoutId: payout.id, status: payout.status, duplicate: true };
  }
  if (payout.status !== "RESERVED") {
    return { ok: true, payoutId: payout.id, status: payout.status, duplicate: true };
  }
  if (!payout.stripeConnectedAccountId || !payout.idempotencyKey) {
    return failure("PAYOUT_REQUEST_INVALID", "The payout reservation is incomplete.", 422);
  }

  let instantDestinationId: string | undefined;
  if (payout.deliveryMethod === "instant") {
    const destination = await findInstantPayoutDestination(payout.stripeConnectedAccountId, payout.currency);
    if (!destination) {
      await prisma.architectPayout.update({
        where: { id: payout.id },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          failureCode: "INSTANT_PAYOUT_NOT_AVAILABLE",
          failureMessage: "Instant payout is not currently available for this payout account."
        }
      });
      return failure(
        "INSTANT_PAYOUT_NOT_AVAILABLE",
        "Instant payout is not currently available for this payout account.",
        422
      );
    }
    instantDestinationId = destination.id;
  }

  try {
    const stripePayout = await stripe.payouts.create(
      {
        amount: payout.amountCents,
        currency: payout.currency,
        method: payout.deliveryMethod === "instant" ? "instant" : "standard",
        ...(instantDestinationId ? { destination: instantDestinationId } : {}),
        description: `Triven architect payout ${payout.id}`,
        metadata: {
          appPayoutId: payout.id,
          architectId: payout.architectUserId,
          clientRequestId: payout.clientRequestId ?? ""
        }
      },
      { stripeAccount: payout.stripeConnectedAccountId, idempotencyKey: payout.idempotencyKey }
    );

    const destination = stripePayout.destination;
    const updated = await prisma.architectPayout.update({
      where: { id: payout.id },
      data: {
        stripePayoutId: stripePayout.id,
        status: payoutStatusFromStripe(stripePayout.status),
        arrivalDate: stripePayout.arrival_date ? new Date(stripePayout.arrival_date * 1000) : null,
        destinationType: stripePayout.type ?? null,
        destinationLast4:
          typeof destination === "object" && destination && "last4" in destination
            ? (destination.last4 as string)
            : null,
        stripeBalanceTransactionId:
          typeof stripePayout.balance_transaction === "string"
            ? stripePayout.balance_transaction
            : stripePayout.balance_transaction?.id ?? null
      }
    });

    console.log("[payouts] payout created", {
      payoutId: payout.id,
      architectId: payout.architectUserId,
      stripePayoutId: stripePayout.id,
      amountCents: payout.amountCents,
      method: payout.deliveryMethod
    });
    return { ok: true, payoutId: updated.id, status: updated.status, duplicate: false };
  } catch (error) {
    const normalized = normalizeStripeError(error, "payout.create");
    logStripeError(normalized, { payoutId: payout.id, architectId: payout.architectUserId });

    if (normalized.retryable) {
      // Leave the reservation in place — reconciliation retries with the SAME
      // idempotency key, so a Stripe-side success cannot be duplicated.
      return failure(normalized.code, normalized.userMessage, normalized.httpStatus, true);
    }

    await prisma.architectPayout.update({
      where: { id: payout.id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        failureCode: normalized.code,
        failureMessage: normalized.userMessage
      }
    });
    return failure(normalized.code, normalized.userMessage, normalized.httpStatus);
  }
}
