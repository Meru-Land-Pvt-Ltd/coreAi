import type { Context } from "hono";
import Stripe from "stripe";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { sendPlatformEmail } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { getStripeClient } from "../payments/stripe";
import { architectForConnectedAccount, syncConnectedAccount } from "./connect-account";
import { isLegalPayoutTransition, PAYOUT_TERMINAL_SUCCESS, payoutStatusFromStripe } from "./state-machine";
import { claimStripeEvent, markEventFailed, markEventProcessed } from "./webhook-events";

const SAFE_PAYOUT_FAILURE_MESSAGES: Record<string, string> = {
  account_closed: "The destination bank account is closed. Update your payout method.",
  account_frozen: "The destination bank account is frozen. Contact your bank.",
  could_not_process: "The bank could not process this payout. Please try again or update your payout method.",
  debit_not_authorized: "The bank declined the payout. Contact your bank.",
  insufficient_funds: "The Stripe balance was insufficient when the payout was attempted.",
  invalid_account_number: "The bank account number is invalid. Update your payout method.",
  incorrect_account_holder_name: "The account holder name does not match the bank record.",
  invalid_currency: "The bank account does not support the payout currency.",
  no_account: "The destination bank account could not be found. Update your payout method.",
  declined: "The bank declined this payout. Contact your bank or update your payout method."
};

function safePayoutFailureMessage(failureCode: string | null | undefined): string {
  return (failureCode && SAFE_PAYOUT_FAILURE_MESSAGES[failureCode]) ??
    "The payout could not be delivered. Update your payout method or contact support.";
}

async function notifyPayoutOutcome(payoutId: string, outcome: "paid" | "failed") {
  try {
    const payout = await prisma.architectPayout.findUnique({
      where: { id: payoutId },
      include: { architect: { select: { email: true, fullName: true } } }
    });
    if (!payout?.architect.email) return;

    const amount = `${(payout.amountCents / 100).toFixed(2)} ${payout.currency.toUpperCase()}`;
    await sendPlatformEmail({
      purpose: "billing",
      to: payout.architect.email,
      subject: outcome === "paid" ? "Your Triven payout was sent" : "Your Triven payout failed",
      text:
        outcome === "paid"
          ? `Hi ${payout.architect.fullName ?? "there"},\n\nYour payout of ${amount} has been paid out to your bank.\n\n— Triven`
          : `Hi ${payout.architect.fullName ?? "there"},\n\nYour payout of ${amount} could not be delivered. ${payout.failureMessage ?? ""}\n\nPlease review your payout method on the Payouts page.\n\n— Triven`
    });
  } catch (error) {
    console.error("[payouts] payout notification failed (non-fatal)", { payoutId, outcome, error });
  }
}

async function handlePayoutEvent(event: Stripe.Event): Promise<"processed" | "stale" | "ignored"> {
  const stripePayout = event.data.object as Stripe.Payout;
  const eventCreatedAt = new Date(event.created * 1000);

  const appPayoutId =
    typeof stripePayout.metadata?.appPayoutId === "string" && stripePayout.metadata.appPayoutId
      ? stripePayout.metadata.appPayoutId
      : null;

  let record =
    (appPayoutId ? await prisma.architectPayout.findUnique({ where: { id: appPayoutId } }) : null) ??
    (await prisma.architectPayout.findUnique({ where: { stripePayoutId: stripePayout.id } }));

  // A payout we did not create (Stripe automatic schedule, or dashboard) —
  // upsert it for the mapped architect so history stays complete.
  if (!record) {
    if (!event.account) return "ignored";
    const mapping = await architectForConnectedAccount(event.account);
    if (!mapping) return "ignored";

    try {
      record = await prisma.architectPayout.create({
        data: {
          architectUserId: mapping.architectUserId,
          amountCents: stripePayout.amount,
          currency: stripePayout.currency,
          status: payoutStatusFromStripe(stripePayout.status),
          deliveryMethod: stripePayout.method === "instant" ? "instant" : "standard",
          origin: "AUTOMATIC",
          livemode: event.livemode,
          stripePayoutId: stripePayout.id,
          stripeConnectedAccountId: event.account,
          arrivalDate: stripePayout.arrival_date ? new Date(stripePayout.arrival_date * 1000) : null,
          destinationType: stripePayout.type ?? null,
          lastStripeEventCreatedAt: eventCreatedAt
        }
      });
      return "processed";
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        record = await prisma.architectPayout.findUnique({ where: { stripePayoutId: stripePayout.id } });
        if (!record) return "ignored";
      } else {
        throw error;
      }
    }
  }

  // Stale-event guard: never apply an older event over a newer one, and never
  // regress a terminal success.
  if (record.lastStripeEventCreatedAt && record.lastStripeEventCreatedAt > eventCreatedAt) {
    return "stale";
  }
  const nextStatus = payoutStatusFromStripe(stripePayout.status);
  if (PAYOUT_TERMINAL_SUCCESS.includes(record.status) && !PAYOUT_TERMINAL_SUCCESS.includes(nextStatus)) {
    return "stale";
  }
  if (!isLegalPayoutTransition(record.status, nextStatus)) {
    return "stale";
  }

  const becamePaid = nextStatus === "PAID" && !PAYOUT_TERMINAL_SUCCESS.includes(record.status);
  const becameFailed = nextStatus === "FAILED" && record.status !== "FAILED";

  await prisma.architectPayout.update({
    where: { id: record.id },
    data: {
      stripePayoutId: stripePayout.id,
      status: nextStatus,
      arrivalDate: stripePayout.arrival_date
        ? new Date(stripePayout.arrival_date * 1000)
        : record.arrivalDate,
      failureCode: stripePayout.failure_code ?? record.failureCode,
      failureMessage: stripePayout.failure_code
        ? safePayoutFailureMessage(stripePayout.failure_code)
        : record.failureMessage,
      paidAt: becamePaid ? eventCreatedAt : record.paidAt,
      failedAt: becameFailed ? eventCreatedAt : record.failedAt,
      canceledAt: nextStatus === "CANCELED" && !record.canceledAt ? eventCreatedAt : record.canceledAt,
      stripeBalanceTransactionId:
        typeof stripePayout.balance_transaction === "string"
          ? stripePayout.balance_transaction
          : stripePayout.balance_transaction?.id ?? record.stripeBalanceTransactionId,
      lastStripeEventCreatedAt: eventCreatedAt
    }
  });

  // Notify exactly once — only on the transition into the terminal state.
  if (becamePaid) void notifyPayoutOutcome(record.id, "paid");
  if (becameFailed) {
    void notifyPayoutOutcome(record.id, "failed");
    // A delivery failure usually means the external account is unusable —
    // refresh its status so the UI disables withdrawal until it is fixed.
    void syncConnectedAccount(record.architectUserId);
  }

  return "processed";
}

export async function handleStripeConnectWebhook(c: Context) {
  const stripe = getStripeClient();
  const signature = c.req.header("stripe-signature");

  if (!stripe || !env.STRIPE_CONNECT_WEBHOOK_SECRET) {
    return errorResponse(c, "Stripe Connect webhook is not configured", 503, "STRIPE_WEBHOOK_NOT_CONFIGURED");
  }
  if (!signature) {
    return errorResponse(c, "Missing Stripe signature", 400, "STRIPE_SIGNATURE_MISSING");
  }

  let event: Stripe.Event;
  try {
    const rawBody = await c.req.text();
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_CONNECT_WEBHOOK_SECRET);
  } catch {
    return errorResponse(c, "Invalid Stripe signature", 400, "STRIPE_WEBHOOK_INVALID");
  }

  const claim = await claimStripeEvent(event);
  if (claim.duplicate) {
    return successResponse(c, { received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const mapping = await architectForConnectedAccount(account.id);
        if (mapping) await syncConnectedAccount(mapping.architectUserId);
        break;
      }
      case "account.external_account.created":
      case "account.external_account.updated":
      case "account.external_account.deleted": {
        if (event.account) {
          const mapping = await architectForConnectedAccount(event.account);
          if (mapping) await syncConnectedAccount(mapping.architectUserId);
        }
        break;
      }
      case "payout.created":
      case "payout.updated":
      case "payout.paid":
      case "payout.failed":
      case "payout.canceled": {
        const outcome = await handlePayoutEvent(event);
        if (outcome === "stale") {
          await markEventProcessed(event.id, "SKIPPED_STALE");
          return successResponse(c, { received: true, stale: true });
        }
        break;
      }
      default:
        break; // unhandled event types are acknowledged
    }

    await markEventProcessed(event.id);
    return successResponse(c, { received: true });
  } catch (error) {
    console.error("[payouts] connect webhook processing failed", {
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error)
    });
    await markEventFailed(event.id, error instanceof Error ? error.message : "unknown");
    // 500 → Stripe retries; the event row is re-claimable.
    return errorResponse(c, "Webhook processing failed", 500, "STRIPE_WEBHOOK_PROCESSING_FAILED");
  }
}
