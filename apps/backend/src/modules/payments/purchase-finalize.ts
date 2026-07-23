import Stripe from "stripe";
import { PaymentStatus } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { resolvePrimaryBusinessId } from "../business/primary-business";
import {
  invoiceDateForPayment,
  invoiceDisplayAmountCents,
  parsePaymentLineItems,
  type PaymentWithListing
} from "../../lib/billing-invoices";
import { sendPaymentSuccessEmail, type InvoiceData } from "../../lib/mailer";
import {
  buildAgentPurchaseLineItems,
  markPhoneNumberFeeBilled,
  resolveUnbilledPhoneFee
} from "../business/phone-provisioning";
import { resolveActivePayment } from "../business/purchase-access";
import { notifyArchitectOfNewSale } from "../architect/sale-notifications";
import { createSettlementForPayment } from "../payouts/settlements";
import { ensureBusinessAndAgent, loadOwnedListing } from "../setup/routes";
import { getStripeClient, isStripeConfigured } from "./stripe";


export type CheckoutBillingDetails = {
  billingName: string;
  billingEmail: string;
  billingAddress: string;
};

export function paymentBillingData(billing: CheckoutBillingDetails) {
  return {
    billingName: billing.billingName,
    billingEmail: billing.billingEmail,
    billingAddress: billing.billingAddress
  };
}

export function setupUrlForListing(listingId?: string | null) {
  const base = env.FRONTEND_URL.replace(/\/$/, "");
  return listingId
    ? `${base}/business/agents/setup?listingId=${encodeURIComponent(listingId)}`
    : `${base}/business/agents/setup`;
}

/* ------------------------------ error mapping ----------------------------- */

export type StripeFailure = {
  status: 402 | 409 | 422 | 503;
  code: string;
  message: string;
};

export function describeStripeError(error: unknown): StripeFailure | null {
  if (!(error instanceof Stripe.errors.StripeError)) return null;

  switch (error.type) {
    case "StripeCardError":
      return {
        status: 402,
        code: "CARD_DECLINED",
        message: error.message || "Your card was declined. Please try a different card."
      };
    case "StripeInvalidRequestError":
      return {
        status: 422,
        code: "PAYMENT_INVALID",
        message: "We couldn't process this card. Please check the card details and try again."
      };
    case "StripeRateLimitError":
    case "StripeConnectionError":
    case "StripeAPIError":
      return {
        status: 503,
        code: "PAYMENT_SERVICE_UNAVAILABLE",
        message: "The payment service is temporarily unavailable. Please try again in a moment."
      };
    case "StripeAuthenticationError":
      return {
        status: 503,
        code: "PAYMENT_SERVICE_MISCONFIGURED",
        message: "Payments are temporarily unavailable. Please contact support."
      };
    default:
      return {
        status: 402,
        code: "PAYMENT_FAILED",
        message: error.message || "The payment could not be completed. Please try again."
      };
  }
}

/* ------------------------------ invoice build ----------------------------- */

export type AuthUserForInvoice = {
  id: string;
  email: string;
  fullName: string | null;
};

export type PaymentForInvoice = PaymentWithListing & {
  stripeCustomerId?: string | null;
  stripePaymentId?: string | null;
  billingName?: string | null;
  billingEmail?: string | null;
  billingAddress?: string | null;
  lineItemsJson?: unknown;
};

async function resolvePaymentMethodLabel(payment: PaymentForInvoice): Promise<string | null> {
  const stripe = getStripeClient();

  if (!stripe || !isStripeConfigured()) return null;

  try {
    let paymentMethodId: string | null = payment.stripePaymentId ?? null;

    if (payment.stripeCustomerId) {
      const customer = await stripe.customers.retrieve(payment.stripeCustomerId);

      if (typeof customer !== "string" && !customer.deleted) {
        const defaultMethod = customer.invoice_settings?.default_payment_method;
        paymentMethodId =
          typeof defaultMethod === "string" ? defaultMethod : defaultMethod?.id ?? paymentMethodId;
      }
    }

    if (!paymentMethodId) return null;

    const method = await stripe.paymentMethods.retrieve(paymentMethodId);

    if (!method.card) return null;

    const brand = method.card.brand.charAt(0).toUpperCase() + method.card.brand.slice(1);
    return `${brand} ending in ${method.card.last4}`;
  } catch {
    return null;
  }
}

function resolveInvoiceBillTo(
  payment: {
    billingName?: string | null;
    billingEmail?: string | null;
    billingAddress?: string | null;
  },
  business: {
    billingName?: string | null;
    billingEmail?: string | null;
    billingAddress?: string | null;
    name?: string;
  } | null,
  authUser: AuthUserForInvoice
) {
  return {
    businessName:
      payment.billingName ??
      business?.billingName ??
      business?.name ??
      authUser.fullName ??
      "Customer",
    businessEmail: payment.billingEmail ?? business?.billingEmail ?? authUser.email,
    billingAddress: payment.billingAddress ?? business?.billingAddress ?? null
  };
}

function invoiceNumberForPayment(paymentId: string) {
  return `INV-${paymentId.slice(-8).toUpperCase()}`;
}

export async function buildInvoiceData(
  payment: PaymentForInvoice,
  authUser: AuthUserForInvoice,
  options: { syntheticTrial?: boolean } = {}
): Promise<InvoiceData> {
  const syntheticTrial = options.syntheticTrial ?? false;

  const business = await prisma.business.findFirst({
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
    select: {
      name: true,
      billingName: true,
      billingEmail: true,
      billingAddress: true,
      billingPostalCode: true
    }
  });

  const paymentMethod = await resolvePaymentMethodLabel(payment);
  const agentName = payment.listing?.name || "Agent purchase";
  const trialDescription = `7-day trial for ${agentName}`;
  const billTo = resolveInvoiceBillTo(payment, business, authUser);
  const isHistoricalTrial =
    payment.status === PaymentStatus.CANCELED &&
    (payment.description ?? "").toLowerCase().includes("trial");
  const isTrialInvoice =
    syntheticTrial || payment.status === PaymentStatus.TRIALING || isHistoricalTrial;

  if (isTrialInvoice) {
    const trialTransactionId = syntheticTrial ? `${payment.id}-trial` : payment.id;

    return {
      invoiceNumber: invoiceNumberForPayment(trialTransactionId),
      date: payment.createdAt,
      businessName: billTo.businessName,
      businessEmail: billTo.businessEmail,
      agentName,
      description: payment.description || trialDescription,
      amountCents: 0,
      listPriceCents: payment.amountCents,
      currency: payment.currency,
      status: PaymentStatus.TRIALING,
      billingAddress: billTo.billingAddress,
      paymentMethod,
      transactionId: trialTransactionId
    };
  }

  return {
    invoiceNumber: invoiceNumberForPayment(payment.id),
    date: invoiceDateForPayment(payment),
    businessName: billTo.businessName,
    businessEmail: billTo.businessEmail,
    agentName,
    description: payment.description || agentName,
    amountCents: invoiceDisplayAmountCents(payment),
    listPriceCents: payment.amountCents,
    currency: payment.currency,
    status: payment.status,
    billingAddress: billTo.billingAddress,
    paymentMethod,
    transactionId: payment.id,
    lineItems: parsePaymentLineItems(payment.lineItemsJson) ?? undefined
  };
}

/* ---------------------------- purchase finalize --------------------------- */

export type FinalizeAgentPurchaseParams = {
  authUser: AuthUserForInvoice;
  listing: { id: string; name: string; priceCents: number };
  businessId: string | null;
  customerId: string | null;
  paymentMethodId: string | null;
  /** The succeeded PaymentIntent — recorded on the row for deduplication. */
  paymentIntentId: string | null;
  /** The amount actually charged (intent amount), in cents. */
  amountCents: number;
  /** Billing details from checkout; null → fall back to the business profile. */
  billing: CheckoutBillingDetails | null;
  /** Set when this charge converts a trial — that row is canceled. */
  priorTrialPaymentId?: string | null;
  notifyArchitect: boolean;
};

export async function finalizePaidAgentPurchase(params: FinalizeAgentPurchaseParams) {
  const { authUser, listing, businessId } = params;

  if (params.paymentIntentId) {
    const existing = await prisma.payment.findFirst({
      where: { stripeSessionId: params.paymentIntentId },
      include: { listing: { select: { id: true, name: true } } }
    });
    if (existing) return { payment: existing, alreadyRecorded: true };
  }

  const unbilledPhoneFee = await resolveUnbilledPhoneFee({
    buyerUserId: authUser.id,
    businessId
  });
  let lineItems = buildAgentPurchaseLineItems({
    agentLabel: listing.name,
    agentPriceCents: listing.priceCents,
    phoneFee: unbilledPhoneFee?.fee ?? null
  });
  const lineTotal = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
  const phoneFeeCharged = Boolean(unbilledPhoneFee) && lineTotal === params.amountCents;
  if (lineTotal !== params.amountCents) {
    lineItems = [{ label: listing.name, amountCents: params.amountCents }];
  }

  let billing = params.billing;
  if (!billing) {
    const business = await prisma.business.findFirst({
      where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
      select: { billingName: true, billingEmail: true, billingAddress: true }
    });
    billing = {
      billingName: business?.billingName ?? authUser.fullName ?? "Customer",
      billingEmail: business?.billingEmail ?? authUser.email,
      billingAddress: business?.billingAddress ?? ""
    };
  }

  // Advisory-locked create: the response path and the webhook backstop can
  // race on the same PaymentIntent, and stripeSessionId has no unique index —
  // the xact lock serializes them so only one Payment row is recorded.
  const createResult = await prisma.$transaction(async (tx) => {
    if (params.paymentIntentId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-intent:${params.paymentIntentId}`}))`;
      const existing = await tx.payment.findFirst({
        where: { stripeSessionId: params.paymentIntentId },
        include: { listing: { select: { id: true, name: true } } }
      });
      if (existing) return { payment: existing, alreadyRecorded: true as const };
    }

    const created = await tx.payment.create({
      data: {
        userId: authUser.id,
        businessId,
        listingId: listing.id,
        amountCents: params.amountCents,
        currency: "usd",
        status: "SUCCEEDED",
        invoiceKind: "PURCHASE",
        paidAt: new Date(),
        stripeCustomerId: params.customerId,
        stripePaymentId: params.paymentMethodId,
        // PaymentIntent id — the dedupe key between response path and webhook.
        stripeSessionId: params.paymentIntentId,
        description: `Purchase of ${listing.name}`,
        lineItemsJson: lineItems as never,
        ...paymentBillingData(billing)
      },
      include: { listing: { select: { id: true, name: true } } }
    });
    return { payment: created, alreadyRecorded: false as const };
  });

  if (createResult.alreadyRecorded) {
    return { payment: createResult.payment, alreadyRecorded: true };
  }

  const payment = createResult.payment;

  // Auto-install the moment the payment is confirmed — the same code runs
  // from the response path, the 3DS confirm, and the webhook backstop; the
  // unique (businessId, listingId) constraint keeps repeated callbacks on
  // one InstalledAgent. Best-effort: setup still installs lazily on failure.
  try {
    const owned = await loadOwnedListing(authUser.id, listing.id);
    if (owned) {
      await ensureBusinessAndAgent({ ownerId: authUser.id, listing: owned });
    }
  } catch (error) {
    console.error("Post-purchase auto-install failed (setup will install lazily)", {
      paymentId: payment.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Immutable architect settlement for this purchase (idempotent per payment).
  try {
    await createSettlementForPayment(payment.id);
  } catch (error) {
    console.error("Architect settlement creation failed (reconciliation will backfill)", {
      paymentId: payment.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // A completed purchase supersedes every trial row for this listing, so the
  // hourly trial-conversion job can never charge this buyer a second time.
  await prisma.payment.updateMany({
    where: {
      userId: authUser.id,
      listingId: listing.id,
      status: "TRIALING",
      NOT: { id: payment.id }
    },
    data: {
      status: "COMPLETED",
      invoiceKind: "TRIAL",
      periodEnd: new Date()
    }
  });

  if (params.priorTrialPaymentId) {
    const trial = await prisma.payment.findUnique({
      where: { id: params.priorTrialPaymentId },
      select: { stripeSubscriptionId: true }
    });
    if (trial?.stripeSubscriptionId && isStripeConfigured()) {
      await getStripeClient()
        ?.subscriptions.cancel(trial.stripeSubscriptionId)
        .catch(() => undefined);
    }
  }

  if (phoneFeeCharged && unbilledPhoneFee) {
    await markPhoneNumberFeeBilled(unbilledPhoneFee.platformPhoneNumberId);
  }

  try {
    const invoice = await buildInvoiceData(payment, authUser);
    await sendPaymentSuccessEmail({
      to: authUser.email,
      name: invoice.businessName,
      setupUrl: setupUrlForListing(listing.id),
      invoice
    });
  } catch (error) {
    console.error("Payment success email failed (non-fatal)", error);
  }

  if (params.notifyArchitect) {
    try {
      await notifyArchitectOfNewSale({ listingId: listing.id, agentPriceCents: listing.priceCents });
    } catch (error) {
      console.error("Architect sale notification failed (non-fatal)", error);
    }
  }

  return { payment, alreadyRecorded: false };
}

/* ----------------------------- webhook backstop ---------------------------- */

export async function recordAgentPurchaseFromIntent(intent: Stripe.PaymentIntent) {
  const metadata = intent.metadata ?? {};
  if (metadata.chargeType !== "agent_purchase") return;
  if (intent.status !== "succeeded") return;

  const userId = metadata.userId;
  const listingId = metadata.listingId;
  if (!userId || !listingId) return;

  const [user, listing, business, existingIntentRow] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true }
    }),
    prisma.agentListing.findUnique({
      where: { id: listingId },
      select: { id: true, name: true, priceCents: true }
    }),
    prisma.business.findFirst({
      where: { id: (await resolvePrimaryBusinessId(userId)) ?? "" },
      select: { id: true }
    }),
    prisma.payment.findFirst({
      where: { stripeSessionId: intent.id },
      select: { id: true }
    })
  ]);

  if (!user || !listing || existingIntentRow) return;

  const payments = await prisma.payment.findMany({
    where: { userId, listingId },
    orderBy: { createdAt: "desc" }
  });
  const active = resolveActivePayment(payments);
  if (active?.status === "SUCCEEDED") return;

  await finalizePaidAgentPurchase({
    authUser: { id: user.id, email: user.email, fullName: user.fullName },
    listing,
    businessId: business?.id ?? null,
    customerId: typeof intent.customer === "string" ? intent.customer : intent.customer?.id ?? null,
    paymentMethodId:
      typeof intent.payment_method === "string"
        ? intent.payment_method
        : intent.payment_method?.id ?? null,
    paymentIntentId: intent.id,
    amountCents: intent.amount,
    billing: null,
    priorTrialPaymentId: metadata.priorTrialPaymentId || null,
    notifyArchitect: !metadata.priorTrialPaymentId
  });

  console.log("[payments] purchase recorded from webhook backstop", {
    paymentIntentId: intent.id,
    listingId
  });
}
