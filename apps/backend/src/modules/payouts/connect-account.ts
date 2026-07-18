import type Stripe from "stripe";
import { prisma } from "../../lib/prisma";
import { getStripeClient } from "../payments/stripe";
import { stripeLivemode } from "./config";
import { logStripeError, normalizeStripeError } from "./stripe-errors";

export type ConnectAccountError =
  | { code: "STRIPE_NOT_CONFIGURED"; httpStatus: 503; userMessage: string }
  | { code: "CONNECT_ACCOUNT_NOT_FOUND"; httpStatus: 404; userMessage: string }
  | { code: "STRIPE_MODE_MISMATCH"; httpStatus: 409; userMessage: string }
  | { code: "CONNECT_REQUIREMENTS_INCOMPLETE"; httpStatus: 422; userMessage: string }
  | { code: "CONNECT_PAYOUTS_DISABLED"; httpStatus: 422; userMessage: string }
  | { code: "TRANSFER_CAPABILITY_INACTIVE"; httpStatus: 422; userMessage: string };

export function connectError(code: ConnectAccountError["code"]): ConnectAccountError {
  switch (code) {
    case "STRIPE_NOT_CONFIGURED":
      return { code, httpStatus: 503, userMessage: "Payouts are not configured yet. Contact platform support." };
    case "CONNECT_ACCOUNT_NOT_FOUND":
      return { code, httpStatus: 404, userMessage: "Connect your payout account with Stripe first." };
    case "STRIPE_MODE_MISMATCH":
      return {
        code,
        httpStatus: 409,
        userMessage:
          "Your payout account was created in a different Stripe mode and needs to be reconnected. Contact support."
      };
    case "CONNECT_REQUIREMENTS_INCOMPLETE":
      return { code, httpStatus: 422, userMessage: "Stripe needs more verification details before payouts can start." };
    case "CONNECT_PAYOUTS_DISABLED":
      return { code, httpStatus: 422, userMessage: "Payouts are currently disabled for your Stripe account." };
    case "TRANSFER_CAPABILITY_INACTIVE":
      return { code, httpStatus: 422, userMessage: "Your Stripe account cannot receive transfers yet." };
  }
}

/**
 * Refresh the architect's payout method row from Stripe: account status,
 * requirements, capabilities, default external account, and livemode. This is
 * the ONLY writer of that snapshot. Read-only against Stripe.
 */
export async function syncConnectedAccount(architectUserId: string) {
  const method = await prisma.architectPayoutMethod.findUnique({ where: { architectUserId } });
  if (!method?.stripeAccountId) return method;

  const stripe = getStripeClient();
  if (!stripe) return method;

  try {
    const account = await stripe.accounts.retrieve(method.stripeAccountId);
    const externalAccounts = await stripe.accounts.listExternalAccounts(method.stripeAccountId, {
      limit: 100
    });
    const banks = externalAccounts.data.filter(
      (item): item is Stripe.BankAccount => item.object === "bank_account"
    );
    const bank =
      banks.find((item) => item.id === method.stripeExternalAccountId) ??
      banks.find((item) => item.default_for_currency) ??
      banks[0];
    const bankFailed = bank?.status === "errored" || bank?.status === "verification_failed";
    const requirements = account.requirements;
    const requirementsDue = (requirements?.currently_due?.length ?? 0) > 0;
    const transfersCapability = account.capabilities?.transfers ?? null;
    const verified = Boolean(
      account.payouts_enabled && transfersCapability === "active" && bank && !bankFailed && !requirementsDue
    );
    const verificationStatus = bankFailed
      ? "FAILED"
      : verified
        ? "VERIFIED"
        : account.details_submitted
          ? "PENDING"
          : "REQUIRES_ACTION";

    return await prisma.architectPayoutMethod.update({
      where: { architectUserId },
      data: {
        bankName: bank?.bank_name ?? method.bankName,
        accountLast4: bank?.last4 ?? method.accountLast4,
        routingLast4: bank?.routing_number?.slice(-4) ?? method.routingLast4,
        stripeExternalAccountId: bank?.id ?? method.stripeExternalAccountId,
        country: account.country ?? method.country,
        currency: bank?.currency ?? account.default_currency ?? method.currency,
        verificationStatus,
        payoutsEnabled: Boolean(account.payouts_enabled),
        detailsSubmitted: Boolean(account.details_submitted),
        livemode: stripeLivemode(),
        transfersCapability,
        requirementsJson: {
          currentlyDue: requirements?.currently_due ?? [],
          eventuallyDue: requirements?.eventually_due ?? [],
          pastDue: requirements?.past_due ?? [],
          pendingVerification: requirements?.pending_verification ?? [],
          disabledReason: requirements?.disabled_reason ?? null
        },
        disabledReason: requirements?.disabled_reason ?? null,
        onboardingCompletedAt:
          method.onboardingCompletedAt ?? (account.details_submitted ? new Date() : null),
        lastSyncedAt: new Date(),
        // Remove legacy raw credentials as soon as Stripe Connect owns this method.
        accountNumber: null,
        ifscCode: null
      }
    });
  } catch (error) {
    const normalized = normalizeStripeError(error, "connect.sync");
    logStripeError(normalized, { architectUserId });
    return method;
  }
}

export async function requireReadyConnectedAccount(architectUserId: string): Promise<
  | { ok: true; method: NonNullable<Awaited<ReturnType<typeof syncConnectedAccount>>> & { stripeAccountId: string } }
  | { ok: false; error: ConnectAccountError }
> {
  const stripe = getStripeClient();
  if (!stripe) return { ok: false, error: connectError("STRIPE_NOT_CONFIGURED") };

  const method = await syncConnectedAccount(architectUserId);
  if (!method?.stripeAccountId) {
    return { ok: false, error: connectError("CONNECT_ACCOUNT_NOT_FOUND") };
  }

  if (method.livemode !== stripeLivemode()) {
    console.error("[payouts] connected account mode mismatch", {
      architectUserId,
      storedLivemode: method.livemode,
      configuredLivemode: stripeLivemode()
    });
    return { ok: false, error: connectError("STRIPE_MODE_MISMATCH") };
  }

  if (!method.detailsSubmitted) {
    return { ok: false, error: connectError("CONNECT_REQUIREMENTS_INCOMPLETE") };
  }

  if (!method.payoutsEnabled) {
    return { ok: false, error: connectError("CONNECT_PAYOUTS_DISABLED") };
  }

  if (method.transfersCapability !== "active") {
    return { ok: false, error: connectError("TRANSFER_CAPABILITY_INACTIVE") };
  }

  return { ok: true, method: method as never };
}

/** Map a Stripe connected-account id back to the owning architect (webhooks). */
export async function architectForConnectedAccount(stripeAccountId: string) {
  return prisma.architectPayoutMethod.findUnique({
    where: { stripeAccountId },
    select: { architectUserId: true, stripeAccountId: true, currency: true, livemode: true }
  });
}
