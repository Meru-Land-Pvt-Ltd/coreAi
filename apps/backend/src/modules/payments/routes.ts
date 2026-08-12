import { Hono } from "hono";
import { PaymentInvoiceKind, PaymentStatus, Prisma, UsageInvoiceStatus } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  buildBillingInvoices,
  invoiceDateForPayment,
  invoiceDisplayAmountCents,
  parsePaymentLineItems,
  type PaymentWithListing
} from "../../lib/billing-invoices";
import {
  getPhoneNumberBillingState,
  listingNeedsPhoneNumber
} from "../business/phone-provisioning";
import {
  buildInvoiceDocumentHtml,
  buildInvoicePdfBuffer,
  sendPaymentSuccessEmail,
  type InvoiceData
} from "../../lib/mailer";
import {
  attachOrReusePaymentMethod,
  getStripeClient,
  isStripeConfigured
} from "./stripe";
import { omitLegacyFreeInstallationValue } from "./billing-details";
import { describeStripeError, finalizePaidAgentPurchase } from "./purchase-finalize";
import { notifyArchitectOfNewSale } from "../architect/sale-notifications";
import {
  buyerExecutionPricingView,
  loadActiveUsageServicePricing
} from "../admin/usage-pricing-service";
import { resolvePrimaryBusinessId } from "../business/primary-business";
import { OWNED_PAYMENT_STATUSES, resolveActivePayment, hasLegacyActiveSubscription } from "../business/purchase-access";
import { ensureBusinessAndAgent, loadOwnedListing } from "../setup/routes";
import { restoreBusinessAfterBillingPayment } from "../business/billing-cycle";
import {
  paymentsForInstalledAgent,
  reconcileCoveredAgentInvoices
} from "../business/agent-payment-scope";
import { createSettlementForPayment } from "../payouts/settlements";
import { buildListingUsagePricing } from "./listing-usage-pricing";
import {
  buildInstalledAgentUsageStats,
  type InstalledAgentUsageStats
} from "../business/installed-agent-run-stats";
import { reconcileBusinessExecutionUsage } from "../business/execution-billing";

export const paymentRoutes = new Hono();

/**
 * Public buyer-safe execution pricing for the marketing pricing page and
 * unauthenticated marketplace surfaces. Billing rates only — vendor actual
 * costs are removed by buyerExecutionPricingView.
 */
paymentRoutes.get("/execution-pricing", async (c) => {
  const [buyerPricing, phoneNumberBilling] = await Promise.all([
    loadActiveUsageServicePricing().then(buyerExecutionPricingView),
    getPhoneNumberBillingState()
  ]);

  return successResponse(c, {
    executionPricing: {
      billingType: "USAGE_BASED" as const,
      unit: "PER_MINUTE" as const,
      ratePerMinuteUsd: buyerPricing.voice.billingRatePerMinuteUsd,
      currency: buyerPricing.currency,
      voice: buyerPricing.voice,
      sms: buyerPricing.sms
        ? {
            ...buyerPricing.sms,
            billingRatePerSmsUsd: buyerPricing.sms.billingRateUsd
          }
        : null,
      calendar: buyerPricing.calendar,
      phoneNumber: buyerPricing.phoneNumber
    },
    phoneNumberBilling
  });
});

paymentRoutes.use("*", requireAuth);
paymentRoutes.use("*", requireRole(["BUSINESS"]));

function currentMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function dateToIsoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function resolveInvoicePaymentId(paymentId: string) {
  if (paymentId.endsWith("-trial")) {
    return {
      basePaymentId: paymentId.slice(0, -"-trial".length),
      syntheticTrial: true
    };
  }

  return {
    basePaymentId: paymentId,
    syntheticTrial: false
  };
}

const startTrialSchema = z.object({
  listingId: z.string().trim().min(1),
  paymentMethodId: z.string().trim().min(1),
  billingName: z.string().trim().min(2),
  billingEmail: z.string().trim().email(),
  billingAddress: z.string().trim().min(3),
  billingPostalCode: z.string().trim().min(3).max(20).optional()
});

const purchaseSchema = z.object({
  listingId: z.string().trim().min(1),
  paymentMethodId: z.string().trim().min(1),
  billingName: z.string().trim().min(2).optional(),
  billingEmail: z.string().trim().email(),
  billingAddress: z.string().trim().min(3).optional(),
  billingPostalCode: z.string().trim().min(3).max(20).optional(),
  /// Per-attempt UUID from checkout — Stripe idempotency key so a retried
  /// submit can never double-charge the buyer.
  attemptId: z.string().trim().min(8).max(64).optional()
});

const confirmPurchaseSchema = z.object({
  listingId: z.string().trim().min(1),
  paymentIntentId: z.string().trim().min(1)
});

const billingPaymentMethodSchema = z.object({
  paymentMethodId: z.string().trim().min(1)
});

const invoicePaymentSchema = z.object({
  paymentMethodId: z.string().trim().min(1).optional()
});

type CheckoutBillingDetails = {
  billingName: string;
  billingEmail: string;
  billingAddress: string;
  billingPostalCode?: string;
};

async function persistCheckoutBilling(ownerId: string, billing: CheckoutBillingDetails) {
  const business = await prisma.business.findFirst({
    where: { id: (await resolvePrimaryBusinessId(ownerId)) ?? "" },
    select: { id: true }
  });
  if (!business) return null;
  await prisma.business.update({
    where: { id: business.id },
    data: {
      billingName: billing.billingName,
      billingEmail: billing.billingEmail,
      billingAddress: billing.billingAddress,
      billingPostalCode: billing.billingPostalCode
    }
  });
  return business.id;
}

async function getOrCreateBusinessStripeCustomer(authUser: {
  id: string;
  email: string;
  fullName?: string | null;
}) {
  const stripe = getStripeClient();
  if (!stripe || !isStripeConfigured()) throw new Error("Stripe is not configured");

  const business = await prisma.business.findFirst({
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" }
  });
  if (!business) throw new Error("Business profile not found");

  const previousPayment = await prisma.payment.findFirst({
    where: { userId: authUser.id, stripeCustomerId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { stripeCustomerId: true }
  });
  const storedCustomerIds = Array.from(
    new Set(
      [business.stripeCustomerId, previousPayment?.stripeCustomerId]
        .filter((customerId): customerId is string => Boolean(customerId))
    )
  );
  let customerId: string | null = null;

  for (const storedCustomerId of storedCustomerIds) {
    try {
      const customer = await stripe.customers.retrieve(storedCustomerId);
      if (!("deleted" in customer && customer.deleted)) {
        customerId = customer.id;
        break;
      }
    } catch (error) {
      const stripeCode =
        error && typeof error === "object"
          ? (error as { code?: unknown; raw?: { code?: unknown } }).code ??
            (error as { raw?: { code?: unknown } }).raw?.code
          : null;

      // A customer id is scoped to one Stripe account and mode. If production
      // was previously using another account/key (or the customer was deleted),
      // repair the local mapping instead of failing every future card setup.
      if (stripeCode !== "resource_missing") throw error;
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: business.billingEmail ?? authUser.email,
      name: business.billingName ?? business.name ?? authUser.fullName ?? undefined,
      metadata: { userId: authUser.id, businessId: business.id }
    });
    customerId = customer.id;
  }

  if (business.stripeCustomerId !== customerId) {
    await prisma.business.update({ where: { id: business.id }, data: { stripeCustomerId: customerId } });
  }

  return { stripe, business, customerId };
}

function serializeBillingCard(method: { id: string; card?: { brand: string; last4: string; exp_month: number; exp_year: number } | null }) {
  if (!method.card) return null;
  return {
    id: method.id,
    brand: method.card.brand,
    last4: method.card.last4,
    expMonth: method.card.exp_month,
    expYear: method.card.exp_year
  };
}

async function chargeAgentOnce({
  stripe,
  customerId,
  paymentMethodId,
  listing,
  userId,
  amountCents,
  attemptId,
  priorTrialPaymentId
}: {
  stripe: NonNullable<ReturnType<typeof getStripeClient>>;
  customerId: string;
  paymentMethodId: string;
  listing: { id: string; name: string; priceCents: number };
  userId: string;
  /** Agent purchase amount. Phone-number billing starts after setup. */
  amountCents?: number;
  /** Checkout attempt UUID — deduplicates retried submits at Stripe. */
  attemptId?: string;
  priorTrialPaymentId?: string | null;
}) {
  return stripe.paymentIntents.create(
    {
      amount: amountCents ?? listing.priceCents,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: ["card"],
      confirm: true,
      use_stripe_sdk: true,
      // Checkout is an on-session payment: the buyer is present and can
      // complete a bank/3DS challenge. Marking this off-session makes Stripe
      // reject India-issued cards before authentication can occur.
      off_session: false,
      setup_future_usage: "off_session",
      description: `One-time purchase of ${listing.name}`,
      metadata: {
        userId,
        listingId: listing.id,
        chargeType: "agent_purchase",
        ...(priorTrialPaymentId ? { priorTrialPaymentId } : {})
      }
    },
    attemptId
      ? { idempotencyKey: `agent-purchase:${userId}:${listing.id}:${attemptId}` }
      : undefined
  );
}

function paymentBillingData(billing: CheckoutBillingDetails) {
  return {
    billingName: billing.billingName,
    billingEmail: billing.billingEmail,
    billingAddress: billing.billingAddress
  };
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

function setupUrlForListing(listingId?: string | null) {
  const base = env.FRONTEND_URL.replace(/\/$/, "");
  return listingId
    ? `${base}/business/agents/setup?listingId=${encodeURIComponent(listingId)}`
    : `${base}/business/agents/setup`;
}

type AuthUserForInvoice = {
  id: string;
  email: string;
  fullName: string | null;
};

type PaymentForInvoice = PaymentWithListing & {
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

async function buildInvoiceData(
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

async function loadOwnedPaymentForInvoice(authUser: AuthUserForInvoice, paymentId: string) {
  const { basePaymentId, syntheticTrial } = resolveInvoicePaymentId(paymentId);

  const payment = await prisma.payment.findFirst({
    where: { id: basePaymentId, userId: authUser.id },
    include: { listing: { select: { id: true, name: true } } }
  });

  if (!payment) return null;

  const invoice = await buildInvoiceData(payment, authUser, { syntheticTrial });
  return { payment, invoice, syntheticTrial };
}

paymentRoutes.get("/config", (c) => {
  return successResponse(c, {
    publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
    stripeEnabled: isStripeConfigured()
  });
});

paymentRoutes.get("/history", async (c) => {
  const authUser = c.get("authUser");

  const payments = await prisma.payment.findMany({
    where: { userId: authUser.id },
    orderBy: { createdAt: "desc" },
    include: {
      listing: {
        select: {
          id: true,
          name: true,
          pricingModel: true,
          trialDays: true
        }
      }
    }
  });

  return successResponse(c, { payments });
});

paymentRoutes.get("/billing", async (c) => {
  const authUser = c.get("authUser");

  const reconciliation = await reconcileCoveredAgentInvoices({
    userId: authUser.id
  });
  for (const businessId of reconciliation.businessIds) {
    await restoreBusinessAfterBillingPayment(businessId);
  }

  const [payments, business] = await Promise.all([
    prisma.payment.findMany({
      where: { userId: authUser.id },
      orderBy: { createdAt: "desc" },
      include: {
        listing: {
          select: {
            id: true,
            name: true,
            priceCents: true,
            pricingModel: true,
            trialDays: true,
            iconUrl: true,
            executionFeeCents: true
          }
        }
      }
    }),
    prisma.business.findFirst({
      where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
      select: {
        id: true,
        name: true,
        stripeCustomerId: true,
        billingName: true,
        billingEmail: true,
        billingAddress: true,
        billingPostalCode: true,
        spendingAlertEnabled: true,
        spendingAlertThresholdCents: true,
        spendingAlertLastNotifiedMonth: true,
        spendingAlertLastNotifiedAt: true,
        installedAgents: {
          select: {
            id: true,
            createdAt: true,
            status: true,
            installSource: true,
            executionFeeCents: true,
            trialExecutionLimit: true,
            trialExecutionsUsed: true,
            listingId: true,
            listing: {
              select: {
                id: true,
                name: true,
                pricingModel: true,
                trialDays: true,
                priceCents: true,
                iconUrl: true,
                executionFeeCents: true
              }
            }
          }
        }
      }
    })
  ]);

  // Current-plan rows are concrete installations. Payment history stays in
  // the invoice table, but cannot create a second plan row or inherit another
  // installed agent's executions merely because the names happen to match.
  const agents: Array<
    {
      id: string;
      listingId: string;
      installedAgentId: string | null;
      name: string;
      priceCents: number;
      monthlyCostCents: number;
      iconUrl: string | null;
      executionFeeCents: number;
      pricingModel?: string | null;
      trialDays?: number | null;
      isTrial?: boolean;
      status: string;
      purchasedAt: string;
      trialEndsAt: string | null;
      trialExecutionLimit: number;
      trialExecutionsUsed: number;
      trialExecutionsRemaining: number;
    }
  > = [];

  if (business?.installedAgents) {
    for (const installed of business.installedAgents) {
      if (!installed.listing) continue;
      if (installed.installSource === "ARCHITECT_SELF_TEST") continue;
      if (["CANCELED", "INACTIVE"].includes(installed.status.toUpperCase())) {
        continue;
      }

      const scopedPayments = paymentsForInstalledAgent(payments, {
        id: installed.id,
        businessId: business.id,
        listingId: installed.listingId
      });
      const latestPaid = scopedPayments.find(
        (payment) => payment.status === PaymentStatus.SUCCEEDED
      );
      const activeTrial = scopedPayments.find(
        (payment) =>
          payment.status === PaymentStatus.TRIALING &&
          (!payment.periodEnd || payment.periodEnd.getTime() > Date.now())
      );
      const outstandingInvoice = scopedPayments.find(
        (payment) =>
          (payment.status === PaymentStatus.PENDING ||
            payment.status === PaymentStatus.OVERDUE) &&
          (payment.invoiceKind === PaymentInvoiceKind.POST_TRIAL ||
            payment.invoiceKind ===
              PaymentInvoiceKind.SUBSCRIPTION_RENEWAL)
      );
      const planPayment =
        latestPaid ??
        activeTrial ??
        outstandingInvoice ??
        scopedPayments[0] ??
        null;
      const recordedPlanPriceCents = planPayment
        ? parsePaymentLineItems(planPayment.lineItemsJson)?.[0]?.amountCents ??
          planPayment.amountCents
        : installed.listing.priceCents;
      const planPriceCents =
        recordedPlanPriceCents > 0
          ? recordedPlanPriceCents
          : installed.listing.priceCents;

      agents.push({
        id: installed.id,
        listingId: installed.listing.id,
        installedAgentId: installed.id,
        name: installed.listing.name,
        priceCents: planPriceCents,
        monthlyCostCents:
          installed.listing.pricingModel === "SUBSCRIPTION" &&
          !["INACTIVE", "CANCELED"].includes(installed.status.toUpperCase())
            ? planPriceCents
            : 0,
        iconUrl: installed.listing.iconUrl,
        executionFeeCents: installed.executionFeeCents,
        pricingModel: installed.listing.pricingModel,
        trialDays: installed.listing.trialDays,
        isTrial: Boolean(activeTrial && !latestPaid),
        status:
          installed.status === "SUSPENDED_BILLING"
            ? installed.status
            : outstandingInvoice?.status ??
              activeTrial?.status ??
              latestPaid?.status ??
              installed.status,
        purchasedAt: installed.createdAt.toISOString(),
        trialEndsAt:
          activeTrial
            ? dateToIsoOrNull(activeTrial.periodEnd)
            : null,
        trialExecutionLimit: installed.trialExecutionLimit,
        trialExecutionsUsed: installed.trialExecutionsUsed,
        trialExecutionsRemaining: Math.max(
          0,
          installed.trialExecutionLimit - installed.trialExecutionsUsed
        )
      });
    }
  }

  const totalAgentFeesPaidCents = payments
    .filter((payment) => payment.status === "SUCCEEDED")
    .reduce((sum, payment) => sum + payment.amountCents, 0);

  const hasActivePlan = agents.length > 0;

  const storedBillingName = omitLegacyFreeInstallationValue(business?.billingName);
  const storedBillingAddress = omitLegacyFreeInstallationValue(business?.billingAddress);
  const invoices = buildBillingInvoices(payments).map((invoice) => ({
    ...invoice,
    billingName: omitLegacyFreeInstallationValue(invoice.billingName),
    billingAddress: omitLegacyFreeInstallationValue(invoice.billingAddress)
  }));

  if (business?.installedAgents) {
    for (const installed of business.installedAgents) {
      if (!installed.listing) continue;
      if (installed.listing.pricingModel !== "FREE") continue;

      const exists = invoices.some(
        (invoice) => invoice.installedAgentId === installed.id
      );
      if (exists) continue;

      invoices.push({
        id: `free-install-${installed.id}`,
        createdAt: installed.createdAt.toISOString(),
        description: `Free install of ${installed.listing.name}`,
        amountCents: 0,
        displayAmountCents: 0,
        currency: "usd",
        status: "PAID",
        lifecycleStatus: "SUCCEEDED",
        tabStatus: "PAID",
        invoiceKind: "PURCHASE",
        listingId: installed.listingId,
        installedAgentId: installed.id,
        listingName: installed.listing.name,
        billingName: storedBillingName,
        billingEmail: business.billingEmail,
        billingAddress: storedBillingAddress,
        lineItems: [{ label: `Installation fee`, amountCents: 0 }],
        periodStart: installed.createdAt.toISOString(),
        periodEnd: null,
        dueAt: null,
        graceEndsAt: null,
        paidAt: installed.createdAt.toISOString(),
        suspendedAt: null
      });
    }
  }

  invoices.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const currentBillingMonth = new Date().toISOString().slice(0, 7);
  if (business) {
    try {
      await reconcileBusinessExecutionUsage(business.id, currentBillingMonth, {
        since: currentMonthStart()
      });
    } catch (error) {
      console.error("[payments-billing] execution reconciliation failed (non-fatal)", {
        businessId: business.id,
        currentBillingMonth,
        error
      });
    }
  }
  const [currentUsage, unpaidUsageInvoices, unpaidAgentInvoices] = business
    ? await Promise.all([
      prisma.agentUsageExecution.aggregate({
        where: {
          businessId: business.id,
          billingMonth: currentBillingMonth
        },
        _sum: { amountMicroUsd: true, legacyBilledCostMicroUsd: true }
      }),
      prisma.businessUsageInvoice.aggregate({
        where: {
          businessId: business.id,
          status: {
            in: [
              UsageInvoiceStatus.OPEN,
              UsageInvoiceStatus.PENDING,
              UsageInvoiceStatus.OVERDUE
            ]
          }
        },
        _sum: { totalMicroUsd: true }
      }),
      prisma.payment.aggregate({
        where: {
          userId: authUser.id,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] },
          invoiceKind: {
            in: [
              PaymentInvoiceKind.POST_TRIAL,
              PaymentInvoiceKind.SUBSCRIPTION_RENEWAL
            ]
          }
        },
        _sum: { amountCents: true }
      })
    ])
    : [
        { _sum: { amountMicroUsd: null, legacyBilledCostMicroUsd: null } },
        { _sum: { totalMicroUsd: null } },
        { _sum: { amountCents: null } }
      ];

  // Best-effort fetch of the default card from Stripe. Any failure -> null (UI shows NA).
  type BillingCardSummary = {
    id: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
  let paymentMethod: BillingCardSummary | null = null;
  let backupPaymentMethod: BillingCardSummary | null = null;

  const paymentWithCustomer = payments.find((payment) => payment.stripeCustomerId);
  const stripe = getStripeClient();

  const billingCustomerId = business?.stripeCustomerId ?? paymentWithCustomer?.stripeCustomerId ?? null;
  if (stripe && isStripeConfigured() && billingCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(billingCustomerId);

      let paymentMethodId: string | null = null;

      if (typeof customer !== "string" && !customer.deleted) {
        const defaultMethod = customer.invoice_settings?.default_payment_method;
        paymentMethodId = typeof defaultMethod === "string" ? defaultMethod : defaultMethod?.id ?? null;
      }

      if (!paymentMethodId) {
        paymentMethodId = paymentWithCustomer?.stripePaymentId ?? null;
      }

      const methods = await stripe.paymentMethods.list({ customer: billingCustomerId, type: "card", limit: 100 });
      const primary = methods.data.find((method) => method.id === paymentMethodId) ?? methods.data[0];
      const backup = methods.data.find((method) => method.id !== primary?.id);
      paymentMethod = primary ? serializeBillingCard(primary) : null;
      backupPaymentMethod = backup ? serializeBillingCard(backup) : null;
    } catch {
      paymentMethod = null;
    }
  }

  const currentExecutionMicroUsd =
    (currentUsage._sum.amountMicroUsd ?? 0) +
    (currentUsage._sum.legacyBilledCostMicroUsd ?? 0);
  const currentMonthExecutionCostCents = Math.round(
    currentExecutionMicroUsd / 10_000
  );
  const currentPlanMonthlyCostCents = agents.reduce(
    (sum, agent) => sum + agent.monthlyCostCents,
    0
  );
  const nextChargeCents =
    Math.round((unpaidUsageInvoices._sum.totalMicroUsd ?? 0) / 10_000) +
    (unpaidAgentInvoices._sum.amountCents ?? 0);

  return successResponse(c, {
    billing: {
      plan: {
        name: "Pay-per-Agent",
        status: hasActivePlan ? "Active" : "Inactive"
      },
      agents,
      summary: {
        totalAgentFeesPaidCents,
        currentPlanMonthlyCostCents,
        monthlyCostCents: currentPlanMonthlyCostCents,
        currentMonthExecutionCostCents,
        nextChargeCents
      },
      usage: { billingMonth: currentBillingMonth },
      spendingAlert: {
        enabled: business?.spendingAlertEnabled ?? false,
        thresholdCents: business?.spendingAlertThresholdCents ?? 5000,
        currentMonthCostCents: currentMonthExecutionCostCents,
        lastNotifiedMonth: business?.spendingAlertLastNotifiedMonth ?? null,
        lastNotifiedAt: dateToIsoOrNull(business?.spendingAlertLastNotifiedAt)
      },
      invoices,
      paymentMethod,
      backupPaymentMethod,
      businessName: storedBillingName ?? business?.name ?? authUser.fullName ?? null,
      billingEmail: business?.billingEmail ?? authUser.email ?? null,
      billingAddress: storedBillingAddress,
      billingPostalCode: business?.billingPostalCode ?? null
    }
  });
});

paymentRoutes.post("/billing/payment-method/setup-intent", async (c) => {
  try {
    const authUser = c.get("authUser");
    const { stripe, customerId } = await getOrCreateBusinessStripeCustomer(authUser);
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: "off_session",
      payment_method_types: ["card"],
      metadata: { userId: authUser.id, purpose: "business_billing_method" }
    });
    return successResponse(c, {
      clientSecret: setupIntent.client_secret,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null
    }, "Card setup started");
  } catch (error) {
    return errorResponse(c, error instanceof Error ? error.message : "Could not start card setup", 422, "CARD_SETUP_FAILED");
  }
});

paymentRoutes.post("/billing/payment-method/backup", async (c) => {
  try {
    const parsed = billingPaymentMethodSchema.parse(await c.req.json());
    const authUser = c.get("authUser");
    const { stripe, customerId } = await getOrCreateBusinessStripeCustomer(authUser);
    const customer = await stripe.customers.retrieve(customerId);
    if (typeof customer === "string" || customer.deleted) throw new Error("Stripe customer not found");
    const defaultMethod = customer.invoice_settings.default_payment_method;
    const defaultMethodId = typeof defaultMethod === "string" ? defaultMethod : defaultMethod?.id ?? null;
    const method = await stripe.paymentMethods.retrieve(parsed.paymentMethodId);
    const ownerId = typeof method.customer === "string" ? method.customer : method.customer?.id ?? null;
    if (ownerId !== customerId || !method.card) throw new Error("Card does not belong to this business");

    const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 100 });
    await Promise.all(methods.data
      .filter((item) => item.id !== parsed.paymentMethodId && item.id !== defaultMethodId)
      .map((item) => stripe.paymentMethods.detach(item.id)));

    return successResponse(c, { backupPaymentMethod: serializeBillingCard(method) }, "Backup payment method saved");
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(c, error.issues[0]?.message ?? "Invalid card", 422, "VALIDATION_ERROR");
    return errorResponse(c, error instanceof Error ? error.message : "Could not save backup card", 422, "BACKUP_CARD_SAVE_FAILED");
  }
});

paymentRoutes.post("/billing/payment-method/primary", async (c) => {
  try {
    const parsed = billingPaymentMethodSchema.parse(await c.req.json());
    const authUser = c.get("authUser");
    const { stripe, customerId } = await getOrCreateBusinessStripeCustomer(authUser);
    const customer = await stripe.customers.retrieve(customerId);
    if (typeof customer === "string" || customer.deleted) throw new Error("Stripe customer not found");
    const previousDefault = customer.invoice_settings.default_payment_method;
    const previousDefaultId = typeof previousDefault === "string" ? previousDefault : previousDefault?.id ?? null;
    const method = await stripe.paymentMethods.retrieve(parsed.paymentMethodId);
    const ownerId = typeof method.customer === "string" ? method.customer : method.customer?.id ?? null;
    if (ownerId !== customerId || !method.card) throw new Error("Card does not belong to this business");

    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: method.id } });
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    await Promise.all(subscriptions.data
      .filter((subscription) => !["canceled", "incomplete_expired"].includes(subscription.status))
      .map((subscription) => stripe.subscriptions.update(subscription.id, { default_payment_method: method.id })));

    const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 100 });
    await Promise.all(methods.data
      .filter((item) => item.id !== method.id && item.id !== previousDefaultId)
      .map((item) => stripe.paymentMethods.detach(item.id)));

    return successResponse(c, { paymentMethod: serializeBillingCard(method) }, "Primary payment method updated");
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(c, error.issues[0]?.message ?? "Invalid card", 422, "VALIDATION_ERROR");
    return errorResponse(c, error instanceof Error ? error.message : "Could not update primary card", 422, "PRIMARY_CARD_UPDATE_FAILED");
  }
});

paymentRoutes.get("/my-agents", async (c) => {
  const authUser = c.get("authUser");

  const currentBusinessId = await resolvePrimaryBusinessId(authUser.id);

  const [payments, business] = await Promise.all([
    prisma.payment.findMany({
      where: {
        userId: authUser.id,
        listingId: { not: null },
        OR: [
          { businessId: null },
          ...(currentBusinessId ? [{ businessId: currentBusinessId }] : [])
        ],
        NOT: { lineItemsJson: { path: ["deletedWorkspaceBusinessId"], not: Prisma.DbNull } }
      },
      orderBy: { createdAt: "desc" },
      include: {
        listing: {
          include: {
            workflow: {
              select: { id: true, name: true, description: true }
            },
            architect: {
              select: {
                id: true,
                fullName: true,
                email: true,
                architectProfile: {
                  select: { title: true, rating: true, completedJobs: true }
                }
              }
            }
          }
        }
      }
    }),
    prisma.business.findFirst({
      where: { id: currentBusinessId ?? "" },
      select: {
        id: true,
        installedAgents: {
          select: { id: true, listingId: true, status: true, pausedAt: true, createdAt: true, installSource: true }
        }
      }
    })
  ]);

  const installedAgents = business?.installedAgents ?? [];
  const statsStart = currentMonthStart();
  if (business) {
    try {
      await reconcileBusinessExecutionUsage(
        business.id,
        statsStart.toISOString().slice(0, 7),
        { since: statsStart }
      );
    } catch (error) {
      console.error("[my-agents] execution reconciliation failed (non-fatal)", {
        businessId: business.id,
        error
      });
    }
  }
  // Buyer-facing execution numbers come from the canonical billing ledger
  // (AgentUsageExecution) — the same rows invoices are built from — so the
  // dashboard, the My Agents cards, and the Billing page always agree.
  const usageStatsByAgentId = business
    ? await buildInstalledAgentUsageStats(
        business.id,
        installedAgents.map((agent) => agent.id),
        statsStart.toISOString().slice(0, 7)
      )
    : new Map<string, InstalledAgentUsageStats>();

  const buyerPricing = buyerExecutionPricingView(await loadActiveUsageServicePricing());
  const phoneNumberBilling = await getPhoneNumberBillingState();
  const executionPricing = {
    billingType: "USAGE_BASED" as const,
    unit: "PER_MINUTE" as const,
    ratePerMinuteUsd: buyerPricing.voice.billingRatePerMinuteUsd,
    currency: buyerPricing.currency,
    voice: buyerPricing.voice,
    sms: buyerPricing.sms,
    phoneNumber: buyerPricing.phoneNumber,
    phoneNumberBilling
  };
  type InstalledAgentRow = (typeof installedAgents)[number];

  const installedByListingId = new Map<string, InstalledAgentRow>();
  for (const agent of installedAgents) {
    if (agent.listingId) {
      installedByListingId.set(agent.listingId, agent);
    }
  }

  // Group payments by listing
  const paymentsByListing = new Map<string, typeof payments>();

  for (const payment of payments) {
    const listing = payment.listing;
    if (!listing) continue;

    const existing = paymentsByListing.get(listing.id) ?? [];
    existing.push(payment);
    paymentsByListing.set(listing.id, existing);
  }

  // Find all distinct listings we need details for
  const allListingIds = new Set([
    ...paymentsByListing.keys(),
    ...installedByListingId.keys()
  ]);

  const missingListingIds = Array.from(allListingIds).filter((id) => !paymentsByListing.has(id));

  // Load details for listings that are installed but have no payment record
  const missingListings = missingListingIds.length > 0
    ? await prisma.agentListing.findMany({
      where: { id: { in: missingListingIds } },
      include: {
        workflow: {
          select: { id: true, name: true, description: true }
        },
        architect: {
          select: {
            id: true,
            fullName: true,
            email: true,
            architectProfile: {
              select: { title: true, rating: true, completedJobs: true }
            }
          }
        }
      }
    })
    : [];

  const missingListingsMap = new Map(missingListings.map((l) => [l.id, l]));
  const agents = [];

  for (const listingId of allListingIds) {
    const listingPayments = paymentsByListing.get(listingId) ?? [];
    const installedAgent = installedByListingId.get(listingId) ?? null;

    const listing = listingPayments[0]?.listing ?? missingListingsMap.get(listingId) ?? null;
    if (!listing) continue;

    const activePayment = resolveActivePayment(listingPayments);

    let statusToUse: string;
    let purchaseIdToUse: string;
    let purchasedAtToUse: Date;

    if (activePayment) {
      statusToUse = activePayment.status;
      purchaseIdToUse = activePayment.id;
      purchasedAtToUse = activePayment.createdAt;
    } else {
      // No active payment. Only include if an installed agent record exists.
      if (!installedAgent) continue;

      const mostRecentPayment = listingPayments[0] ?? null;
      if (mostRecentPayment) {
        statusToUse = mostRecentPayment.status;
        purchaseIdToUse = mostRecentPayment.id;
        purchasedAtToUse = mostRecentPayment.createdAt;
      } else if (
        installedAgent.installSource === "FREE_INSTALL" ||
        installedAgent.installSource === "ARCHITECT_SELF_TEST" ||
        installedAgent.installSource === "ADMIN_ASSIGNMENT"
      ) {
        // Payment-less by design: free installs, architect self-tests and
        // admin assignments are valid acquisitions with no Payment row.
        statusToUse = "SUCCEEDED";
        purchaseIdToUse = `installed-${installedAgent.id}`;
        purchasedAtToUse = installedAgent.createdAt;
      } else {
        // Installed but no payment record exists at all (e.g. legacy/subscription user)
        const hasSub = await hasLegacyActiveSubscription(authUser.id);
        statusToUse = hasSub ? "SUCCEEDED" : "FAILED";
        purchaseIdToUse = `installed-${installedAgent.id}`;
        purchasedAtToUse = installedAgent.createdAt;
      }
    }

    const resolvedStatus = statusToUse.toUpperCase();
    if (resolvedStatus === "FAILED" || resolvedStatus === "CANCELED") continue;

    const isTrial = statusToUse === PaymentStatus.TRIALING || (
      statusToUse !== PaymentStatus.SUCCEEDED &&
      listingPayments.some((payment) =>
        payment.status === PaymentStatus.TRIALING ||
        payment.description?.toLowerCase().includes("trial")
      )
    );

    const stats = (installedAgent
      ? usageStatsByAgentId.get(installedAgent.id)
      : undefined) ?? {
      lifetimeExecutions: 0,
      lifetimeCostMicroUsd: 0,
      monthExecutions: 0,
      monthCostMicroUsd: 0
    };

    // Lifetime, from the agent's very first execution — the My Agents card
    // shows a TOTAL, not a month window.
    const totalExecutions = stats.lifetimeExecutions;
    let totalBookings = 0;

    if (installedAgent && business) {
      if (installedAgents.length === 1) {
        totalBookings = await prisma.appointment.count({
          where: { businessId: business.id, executionMode: "LIVE" }
        });
      } else {
        const agentVapiCalls = await prisma.vapiCall.findMany({
          where: {
            businessId: business.id,
            installedAgentId: installedAgent.id,
            executionMode: "LIVE",
            conversationId: { not: null }
          },
          select: { conversationId: true }
        });
        const agentConversationIds = agentVapiCalls
          .map((c) => c.conversationId)
          .filter(Boolean) as string[];

        if (agentConversationIds.length > 0) {
          totalBookings = await prisma.appointment.count({
            where: {
              businessId: business.id,
              executionMode: "LIVE",
              conversationId: { in: agentConversationIds }
            }
          });
        }
      }
    }

    agents.push({
      purchaseId: purchaseIdToUse,
      purchasedAt: purchasedAtToUse,
      purchaseStatus: statusToUse,
      isTrial,
      installedAgentId: installedAgent?.id ?? null,
      installedAgentStatus: installedAgent?.status ?? null,
      installedAgentPausedAt: dateToIsoOrNull(installedAgent?.pausedAt),
      pricing: {
        agentPrice: {
          amountCents: listing.priceCents,
          currency: "USD",
          model: listing.pricingModel,
          label: listing.priceCents === 0 ? "Free" : null
        },
        executionPricing
      },
      stats: {
        runsThisMonth: stats.monthExecutions,
        costThisMonthMicroUsd: stats.monthCostMicroUsd
      },
      totalExecutions,
      totalCostMicroUsd: stats.lifetimeCostMicroUsd,
      totalBookings,
      listing: {
        id: listing.id,
        name: listing.name,
        shortDescription: listing.shortDescription,
        description: listing.description,
        priceCents: listing.priceCents,
        status: listing.status,
        tags: listing.tags,
        category: listing.category,
        industryTags: listing.industryTags,
        requiredConnectors: listing.requiredConnectors,
        supportedLlms: listing.supportedLlms,
        iconUrl: listing.iconUrl,
        workflowId: listing.workflowId,
        createdAt: listing.createdAt,
        workflow: listing.workflow,
        architect: listing.architect,
        freeTrialEnabled: listing.freeTrialEnabled,
        trialDays: listing.trialDays,
        pricingModel: listing.pricingModel
      }
    });
  }

  return successResponse(c, { agents });
});

paymentRoutes.get("/listing-access/:listingId", async (c) => {
  const authUser = c.get("authUser");
  const listingId = c.req.param("listingId");

  const listing = await prisma.agentListing.findFirst({
    where: {
      id: listingId,
      status: { in: ["APPROVED", "PENDING_REVIEW"] }
    },
    select: {
      id: true,
      name: true,
      priceCents: true,
      pricingModel: true,
      freeTrialEnabled: true,
      trialDays: true,
      requiredConnectors: true
    }
  });

  if (!listing) {
    return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");
  }

  const [payments, installedAgent] = await Promise.all([
    prisma.payment.findMany({
      where: {
        userId: authUser.id,
        listingId
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.installedAgent.findFirst({
      where: { listingId, business: { ownerId: authUser.id } },
      select: { id: true, status: true, installSource: true }
    })
  ]);

  const activePayment = resolveActivePayment(payments);
  const anyPayment = payments.length > 0;
  const paymentlessInstall = Boolean(installedAgent) && !anyPayment;
  const purchaseStatus = activePayment?.status ?? payments[0]?.status ?? null;
  const isTrialing = purchaseStatus === PaymentStatus.TRIALING;
  const canPayNow =
    (anyPayment && !activePayment) ||
    isTrialing;

  // Canonical pricing service, buyer-safe fields only (billing rates).
  const needsPhone = await listingNeedsPhoneNumber(listing.id);
  const phoneNumberBilling = await getPhoneNumberBillingState();
  const usagePricing = buildListingUsagePricing({
    records: await loadActiveUsageServicePricing(),
    requiredConnectors: listing.requiredConnectors,
    needsPhoneNumber: needsPhone,
    phoneNumberBillingEnabled: phoneNumberBilling.enabled
  });

  return successResponse(c, {
    listingId: listing.id,
    listingName: listing.name,
    amountCents: listing.priceCents,
    pricingModel: listing.pricingModel,
    freeTrialEnabled: listing.freeTrialEnabled,
    trialDays: listing.trialDays,
    // The monthly number fee is not charged at agent checkout. Its first fixed
    // unit is added to usage billing after setup assigns the number.
    phoneNumberFee: null,
    // Honest phone-number billing state: when disabled, the UI must say so
    // instead of displaying a payable rate that is never charged.
    phoneNumberBilling,
    needsPhoneNumber: needsPhone,
    currency: "usd",
    usagePricing,
    canStartTrial: listing.freeTrialEnabled && !anyPayment && !installedAgent,
    hasActiveAccess: Boolean(activePayment) || paymentlessInstall,
    trialUsed: anyPayment,
    canPayNow,
    purchaseStatus,
    installedAgentId: installedAgent?.id ?? null
  });
});

// POST /payments/invoices/:id/pay — settles this exact post-trial or monthly
// subscription debt. Generic checkout must never create a separate paid row
// while leaving the overdue invoice (and suspension) behind.
paymentRoutes.post("/invoices/:id/pay", async (c) => {
  const authUser = c.get("authUser");
  const invoiceId = c.req.param("id");
  const parsedPayment = invoicePaymentSchema.safeParse(
    await c.req.json().catch(() => ({}))
  );
  if (!parsedPayment.success) {
    return errorResponse(
      c,
      parsedPayment.error.issues[0]?.message ?? "Invalid payment method",
      422,
      "VALIDATION_ERROR"
    );
  }
  const invoice = await prisma.payment.findFirst({
    where: {
      id: invoiceId,
      userId: authUser.id,
      invoiceKind: {
        in: [PaymentInvoiceKind.POST_TRIAL, PaymentInvoiceKind.SUBSCRIPTION_RENEWAL]
      }
    },
    include: {
      business: { select: { id: true, stripeCustomerId: true } },
      listing: { select: { id: true, name: true } }
    }
  });
  if (!invoice) {
    return errorResponse(c, "Invoice not found", 404, "INVOICE_NOT_FOUND");
  }
  const covered = await reconcileCoveredAgentInvoices({
    userId: authUser.id,
    businessId: invoice.businessId,
    listingId: invoice.listingId,
    installedAgentId: invoice.installedAgentId
  });
  if (covered.canceledInvoiceIds.includes(invoice.id)) {
    if (invoice.businessId) {
      await restoreBusinessAfterBillingPayment(
        invoice.businessId,
        invoice.installedAgentId
      );
    }
    return successResponse(c, {
      invoiceId,
      status: "CANCELED",
      alreadyCovered: true
    }, "This invoice is already covered by a paid agent period");
  }
  if (invoice.status === "SUCCEEDED") {
    if (invoice.businessId) {
      await restoreBusinessAfterBillingPayment(
        invoice.businessId,
        invoice.installedAgentId
      );
    }
    return successResponse(c, {
      invoiceId,
      status: "PAID",
      alreadyPaid: true
    });
  }
  const payableStatuses: PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.OVERDUE];
  if (!payableStatuses.includes(invoice.status)) {
    return errorResponse(c, "Invoice cannot be paid", 409, "INVOICE_NOT_PAYABLE");
  }
  if (invoice.amountCents < 50) {
    return errorResponse(
      c,
      "This balance is below the card network minimum and will carry into the next statement.",
      409,
      "INVOICE_CARRIED_FORWARD"
    );
  }

  const stripe = getStripeClient();
  if (!stripe || !isStripeConfigured()) {
    return errorResponse(c, "Stripe is not configured", 503, "STRIPE_NOT_CONFIGURED");
  }
  const customerId =
    invoice.business?.stripeCustomerId ?? invoice.stripeCustomerId ?? null;
  if (
    !customerId ||
    (!invoice.stripePaymentId && !parsedPayment.data.paymentMethodId)
  ) {
    return errorResponse(
      c,
      "Update your payment method before paying this invoice.",
      409,
      "PAYMENT_METHOD_REQUIRED"
    );
  }

  let paymentMethodId = parsedPayment.data.paymentMethodId ?? invoice.stripePaymentId;
  try {
    if (parsedPayment.data.paymentMethodId) {
      const method = await attachOrReusePaymentMethod(
        stripe,
        parsedPayment.data.paymentMethodId,
        customerId
      );
      paymentMethodId = method.id;
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: method.id }
      });
    } else {
      const customer = await stripe.customers.retrieve(customerId);
      if (typeof customer !== "string" && !customer.deleted) {
        const defaultMethod = customer.invoice_settings.default_payment_method;
        paymentMethodId =
          (typeof defaultMethod === "string" ? defaultMethod : defaultMethod?.id) ||
          paymentMethodId;
      }
    }
  } catch (error) {
    const failure = describeStripeError(error);
    return errorResponse(
      c,
      failure?.message ?? "The selected payment method could not be used.",
      failure?.status ?? 422,
      failure?.code ?? "PAYMENT_METHOD_INVALID"
    );
  }
  if (!paymentMethodId) {
    return errorResponse(
      c,
      "Update your payment method before paying this invoice.",
      409,
      "PAYMENT_METHOD_REQUIRED"
    );
  }

  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-invoice-pay:${invoiceId}`}))`;
    const fresh = await tx.payment.findUnique({ where: { id: invoiceId } });
    if (!fresh) return { kind: "missing" as const };
    if (fresh.status === "SUCCEEDED") {
      return { kind: "paid" as const, fresh };
    }
    if (fresh.stripeSessionId) {
      return {
        kind: "claimed" as const,
        fresh,
        attempt: Math.max(1, fresh.paymentAttemptCount)
      };
    }
    const pendingIsFresh =
      fresh.paymentPendingAt &&
      Date.now() - fresh.paymentPendingAt.getTime() < 10 * 60 * 1000;
    if (pendingIsFresh) return { kind: "in_progress" as const };
    const attempt = fresh.paymentAttemptCount + 1;
    const updated = await tx.payment.update({
      where: { id: fresh.id },
      data: {
        paymentAttemptCount: attempt,
        paymentPendingAt: new Date()
      }
    });
    return { kind: "claimed" as const, fresh: updated, attempt };
  });

  if (claimed.kind === "missing") {
    return errorResponse(c, "Invoice not found", 404, "INVOICE_NOT_FOUND");
  }
  if (claimed.kind === "paid") {
    if (invoice.businessId) {
      await restoreBusinessAfterBillingPayment(
        invoice.businessId,
        invoice.installedAgentId
      );
    }
    return successResponse(c, { invoiceId, status: "PAID", alreadyPaid: true });
  }
  if (claimed.kind === "in_progress") {
    return errorResponse(
      c,
      "This invoice payment is already processing.",
      409,
      "INVOICE_PAYMENT_IN_PROGRESS"
    );
  }

  try {
    let intent = claimed.fresh.stripeSessionId
      ? await stripe.paymentIntents
          .retrieve(claimed.fresh.stripeSessionId)
          .catch(() => null)
      : null;

    if (!intent || intent.status === "canceled") {
      intent = await stripe.paymentIntents.create(
        {
          amount: claimed.fresh.amountCents,
          currency: claimed.fresh.currency,
          customer: customerId,
          description: claimed.fresh.description ?? "Triven agent invoice",
          metadata: {
            paymentInvoiceId: claimed.fresh.id,
            businessId: claimed.fresh.businessId ?? "",
            listingId: claimed.fresh.listingId ?? "",
            invoiceKind: claimed.fresh.invoiceKind
          }
        },
        {
          idempotencyKey: `agent-invoice:${claimed.fresh.id}:${claimed.attempt}`
        }
      );
      await prisma.payment.update({
        where: { id: claimed.fresh.id },
        data: { stripeSessionId: intent.id }
      });
    }

    if (intent.status !== "succeeded") {
      intent = await stripe.paymentIntents.confirm(intent.id, {
        payment_method: paymentMethodId,
        off_session: false,
        use_stripe_sdk: true
      });
    }

    if (intent.status === "requires_action" && intent.client_secret) {
      return successResponse(c, {
        invoiceId,
        requiresAction: true,
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret
      }, "Card authentication required");
    }

    if (intent.status !== "succeeded") {
      await prisma.payment.update({
        where: { id: claimed.fresh.id },
        data: { paymentPendingAt: null }
      });
      return errorResponse(
        c,
        "Payment requires attention. Update your card and try again.",
        409,
        "INVOICE_PAYMENT_INCOMPLETE"
      );
    }

    const paidAt = new Date();
    const paid = await prisma.payment.update({
      where: { id: claimed.fresh.id },
      data: {
        status: "SUCCEEDED",
        paidAt,
        suspendedAt: null,
        paymentPendingAt: null,
        stripeCustomerId: customerId,
        stripePaymentId: paymentMethodId,
        stripeSessionId: intent.id
      }
    });
    try {
      await createSettlementForPayment(paid.id);
    } catch (error) {
      console.error("[payments] renewal settlement creation failed (reconcile will backfill)", {
        paymentId: paid.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    const servicesRestored = paid.businessId
      ? await restoreBusinessAfterBillingPayment(
          paid.businessId,
          paid.installedAgentId
        )
      : false;
    return successResponse(
      c,
      {
        invoiceId: paid.id,
        status: "PAID",
        paidAt: paidAt.toISOString(),
        servicesRestored
      },
      "Invoice paid"
    );
  } catch (error) {
    await prisma.payment.updateMany({
      where: {
        id: invoiceId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] }
      },
      data: { paymentPendingAt: null }
    });
    const failure = describeStripeError(error);
    if (failure) {
      return errorResponse(c, failure.message, failure.status, failure.code);
    }
    console.error("[payments] invoice payment failed", { invoiceId, error });
    return errorResponse(
      c,
      "The invoice payment could not be completed.",
      500,
      "INVOICE_PAYMENT_FAILED"
    );
  }
});

// GET /payments/invoice/:id/html — same invoice card layout as the billing detail page.
paymentRoutes.get("/invoice/:id/html", async (c) => {
  const authUser = c.get("authUser");
  const paymentId = c.req.param("id");
  const loaded = await loadOwnedPaymentForInvoice(authUser, paymentId);

  if (!loaded) {
    return errorResponse(c, "Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  const html = buildInvoiceDocumentHtml(loaded.invoice);

  c.header("Content-Type", "text/html; charset=utf-8");
  return c.body(html);
});

// GET /payments/invoice/:id/pdf — branded PDF for a single payment/invoice.
paymentRoutes.get("/invoice/:id/pdf", async (c) => {
  const authUser = c.get("authUser");
  const paymentId = c.req.param("id");
  const loaded = await loadOwnedPaymentForInvoice(authUser, paymentId);

  if (!loaded) {
    return errorResponse(c, "Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  const pdf = await buildInvoicePdfBuffer(loaded.invoice);

  c.header("Content-Type", "application/pdf");
  c.header(
    "Content-Disposition",
    `attachment; filename="invoice-${loaded.invoice.invoiceNumber}.pdf"`
  );

  return c.body(new Uint8Array(pdf));
});

paymentRoutes.post("/start-trial", async (c) => {
  const stripe = getStripeClient();

  if (!stripe || !isStripeConfigured()) {
    return errorResponse(c, "Stripe is not configured", 500, "STRIPE_NOT_CONFIGURED");
  }

  const body = await c.req.json().catch(() => null);
  const parsed = startTrialSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(c, "Invalid payment payload", 422, "VALIDATION_ERROR");
  }

  const authUser = c.get("authUser");
  const { listingId, paymentMethodId, billingName, billingEmail, billingAddress, billingPostalCode } = parsed.data;
  const billingDetails: CheckoutBillingDetails = {
    billingName,
    billingEmail,
    billingAddress,
    billingPostalCode
  };

  const businessId = await persistCheckoutBilling(authUser.id, billingDetails);

  const listing = await prisma.agentListing.findFirst({
    where: {
      id: listingId,
      status: { in: ["APPROVED", "PENDING_REVIEW"] }
    }
  });

  if (!listing) {
    return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");
  }

  if (!listing.freeTrialEnabled) {
    return errorResponse(c, "Free trial is not enabled for this agent", 400, "TRIAL_NOT_ENABLED");
  }

  const existingPayments = await prisma.payment.findMany({
    where: {
      userId: authUser.id,
      listingId
    },
    orderBy: { createdAt: "desc" }
  });

  const activePayment = resolveActivePayment(existingPayments);

  if (activePayment) {
    return successResponse(c, {
      payment: activePayment,
      alreadyActive: true
    });
  }

  if (existingPayments.length > 0) {
    return errorResponse(
      c,
      "Free trial already used for this agent",
      409,
      "TRIAL_ALREADY_USED"
    );
  }

  const previousPayment = await prisma.payment.findFirst({
    where: {
      userId: authUser.id,
      stripeCustomerId: { not: null }
    },
    orderBy: { createdAt: "desc" }
  });
  const checkoutBusiness = businessId
    ? await prisma.business.findUnique({
      where: { id: businessId },
      select: { stripeCustomerId: true }
    })
    : null;

  let customerId: string;

  if (checkoutBusiness?.stripeCustomerId) {
    customerId = checkoutBusiness.stripeCustomerId;
  } else if (previousPayment?.stripeCustomerId) {
    customerId = previousPayment.stripeCustomerId;
  } else {
    const customer = await stripe.customers.create({
      email: authUser.email,
      name: authUser.fullName ?? undefined,
      metadata: {
        userId: authUser.id
      }
    });

    customerId = customer.id;
  }

  const attachedPaymentMethod = await attachOrReusePaymentMethod(stripe, paymentMethodId, customerId);

  const attachedPaymentMethodId = attachedPaymentMethod.id;

  await stripe.customers.update(customerId, {
    name: billingName,
    email: billingEmail,
    invoice_settings: {
      default_payment_method: attachedPaymentMethodId
    }
  });

  const trialDays = listing.trialDays || 7;
  const trialStartedAt = new Date();
  const trialEndsAt = new Date(
    trialStartedAt.getTime() + trialDays * 24 * 60 * 60 * 1000
  );

  const trialCreate = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-trial:${authUser.id}:${listing.id}`}))`;

    const concurrent = await tx.payment.findMany({
      where: { userId: authUser.id, listingId: listing.id },
      orderBy: { createdAt: "desc" },
      include: { listing: { select: { id: true, name: true } } }
    });

    const concurrentActive = resolveActivePayment(concurrent);
    if (concurrentActive) {
      return { payment: concurrentActive, alreadyActive: true as const };
    }
    if (concurrent.length > 0) {
      return { payment: null, alreadyActive: false as const };
    }

    const created = await tx.payment.create({
      data: {
        userId: authUser.id,
        businessId,
        listingId: listing.id,
        amountCents: listing.priceCents,
        currency: "usd",
        status: PaymentStatus.TRIALING,
        invoiceKind: PaymentInvoiceKind.TRIAL,
        periodStart: trialStartedAt,
        periodEnd: trialEndsAt,
        paidAt: trialStartedAt,
        createdAt: trialStartedAt,
        stripeCustomerId: customerId,
        stripePaymentId: attachedPaymentMethodId,
        description: `${trialDays}-day trial for ${listing.name}`,
        ...paymentBillingData(billingDetails)
      },
      include: {
        listing: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return { payment: created, alreadyActive: false as const };
  });

  if (!trialCreate.payment) {
    return errorResponse(
      c,
      "Free trial already used for this agent",
      409,
      "TRIAL_ALREADY_USED"
    );
  }

  if (trialCreate.alreadyActive) {
    return successResponse(c, {
      payment: trialCreate.payment,
      alreadyActive: true
    });
  }

  const payment = trialCreate.payment;

  // The trial IS the entitlement — install right away (installSource TRIAL)
  // so the agent appears on My Agents and setup reuses this exact install.
  // Best-effort: setup installs lazily if this ever fails.
  try {
    const owned = await loadOwnedListing(authUser.id, listing.id);
    if (owned) {
      const { agent } = await ensureBusinessAndAgent({
        ownerId: authUser.id,
        listing: owned
      });
      if (agent) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { installedAgentId: agent.id }
        });
      }
    }
  } catch (error) {
    console.error("Trial auto-install failed (setup will install lazily)", error);
  }

  // No number is acquired at trial start: the buyer selects and explicitly
  // purchases their Triven AI number during agent setup (country → state →
  // city → confirm). This field stays null for API-shape compatibility.
  const assignedPhoneNumber: string | null = null;

  // Send a purchase-confirmation email with the invoice attached. Best-effort:
  // a mail failure must never break the purchase.
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

  // Notify the architect that another buyer is now using their agent (only if
  // they enabled the New sale email). Best-effort — never blocks the purchase.
  await notifyArchitectOfNewSale({ listingId: listing.id, agentPriceCents: listing.priceCents });

  return successResponse(
    c,
    {
      payment,
      subscriptionId: null,
      assignedPhoneNumber,
      trialEndsAt: trialEndsAt.toISOString()
    },
    "Trial started",
    201
  );
});

paymentRoutes.post("/purchase", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = purchaseSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(c, "Invalid payment payload", 422, "VALIDATION_ERROR");
  }

  const authUser = c.get("authUser");
  const { listingId, paymentMethodId, billingName, billingEmail, billingAddress, billingPostalCode, attemptId } = parsed.data;

  const listing = await prisma.agentListing.findFirst({
    where: {
      id: listingId,
      status: { in: ["APPROVED", "PENDING_REVIEW"] }
    }
  });

  if (!listing) {
    return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");
  }

  if (listing.pricingModel === "FREE") {
    const [existingPayments, existingInstall] = await Promise.all([
      prisma.payment.findMany({
        where: { userId: authUser.id, listingId },
        orderBy: { createdAt: "desc" }
      }),
      prisma.installedAgent.findFirst({
        where: { listingId, business: { ownerId: authUser.id } },
        select: { id: true }
      })
    ]);

    const activePayment = resolveActivePayment(existingPayments);

    const owned = await loadOwnedListing(authUser.id, listingId);
    if (!owned) {
      return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");
    }

    const { agent } = await ensureBusinessAndAgent({ ownerId: authUser.id, listing: owned });

    const alreadyActive = Boolean(existingInstall) || Boolean(activePayment);

    // First-time install only — repeats stay silent for the architect.
    if (!alreadyActive) {
      await notifyArchitectOfNewSale({ listingId: listing.id, agentPriceCents: 0 });
    }

    return successResponse(
      c,
      {
        free: true,
        alreadyActive,
        installedAgentId: agent?.id ?? null,
        // Legacy free installs recorded a $0 payment — surface it when present
        // so older clients keep working; new free installs have none.
        payment: activePayment,
        subscriptionId: null,
        assignedPhoneNumber: null
      },
      alreadyActive ? "Agent already installed" : "Agent installed",
      alreadyActive ? 200 : 201
    );
  }

  if (!billingName || !billingAddress) {
    return errorResponse(c, "Invalid payment payload", 422, "VALIDATION_ERROR");
  }

  const billingDetails: CheckoutBillingDetails = {
    billingName,
    billingEmail,
    billingAddress,
    billingPostalCode
  };
  const businessId = await persistCheckoutBilling(authUser.id, billingDetails);

  // ── Paid path — Stripe is required beyond this point ──────────────────────
  const stripe = getStripeClient();
  if (!stripe || !isStripeConfigured()) {
    return errorResponse(c, "Stripe is not configured", 500, "STRIPE_NOT_CONFIGURED");
  }

  const existingPayments = await prisma.payment.findMany({
    where: {
      userId: authUser.id,
      listingId
    },
    orderBy: { createdAt: "desc" }
  });

  const activePayment = resolveActivePayment(existingPayments);

  if (activePayment?.status === "SUCCEEDED") {
    return successResponse(c, {
      payment: activePayment,
      alreadyActive: true
    });
  }

  const priorTrialPaymentId = activePayment?.status === "TRIALING" ? activePayment.id : null;

  const totalCents = listing.priceCents;

  let intent;
  try {
    const customer = await getOrCreateBusinessStripeCustomer(authUser);
    const attachedPaymentMethod = await attachOrReusePaymentMethod(
      stripe,
      paymentMethodId,
      customer.customerId
    );

    await stripe.customers.update(customer.customerId, {
      name: billingName,
      email: billingEmail,
      invoice_settings: { default_payment_method: attachedPaymentMethod.id }
    });

    intent = await chargeAgentOnce({
      stripe,
      customerId: customer.customerId,
      paymentMethodId: attachedPaymentMethod.id,
      listing,
      userId: authUser.id,
      amountCents: totalCents,
      attemptId,
      priorTrialPaymentId
    });
  } catch (error) {
    const failure = describeStripeError(error);
    if (failure) {
      return errorResponse(c, failure.message, failure.status, failure.code);
    }
    console.error("[payments] purchase failed with unexpected error", error);
    return errorResponse(c, "We couldn't process the payment. Please try again.", 500, "PAYMENT_FAILED");
  }

  // India-issued cards and other SCA cards can now return an authentication
  // action to the browser instead of failing as an off-session transaction.
  if (intent.status === "requires_action" && intent.client_secret) {
    return successResponse(c, {
      requiresAction: true,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret
    }, "Card authentication required");
  }

  if (intent.status !== "succeeded") {
    return errorResponse(
      c,
      intent.last_payment_error?.message ??
      "The payment could not be completed. Please try again or use a different card.",
      402,
      "PAYMENT_INCOMPLETE"
    );
  }

  const { payment } = await finalizePaidAgentPurchase({
    authUser: { id: authUser.id, email: authUser.email, fullName: authUser.fullName ?? null },
    listing,
    businessId,
    customerId: typeof intent.customer === "string" ? intent.customer : intent.customer?.id ?? null,
    paymentMethodId:
      typeof intent.payment_method === "string"
        ? intent.payment_method
        : intent.payment_method?.id ?? null,
    paymentIntentId: intent.id,
    amountCents: intent.amount,
    billing: billingDetails,
    priorTrialPaymentId,
    notifyArchitect: !priorTrialPaymentId
  });

  return successResponse(c, { payment, subscriptionId: null }, "Purchase completed", 201);
});

// Finalize an on-session purchase after Stripe.js completes bank/3DS
// authentication. Metadata ownership checks prevent confirming another
// buyer's PaymentIntent by guessing its id.
paymentRoutes.post("/purchase/confirm", async (c) => {
  const stripe = getStripeClient();
  if (!stripe || !isStripeConfigured()) {
    return errorResponse(c, "Payments are temporarily unavailable.", 503, "STRIPE_NOT_CONFIGURED");
  }

  const parsed = confirmPurchaseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, "Invalid payment confirmation payload", 422, "VALIDATION_ERROR");
  }

  const authUser = c.get("authUser");
  let intent;
  try {
    intent = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
  } catch (error) {
    const failure = describeStripeError(error);
    if (failure) return errorResponse(c, failure.message, failure.status, failure.code);
    console.error("[payments] purchase confirmation failed", error);
    return errorResponse(c, "We couldn't confirm the payment. Please try again.", 500, "PAYMENT_FAILED");
  }

  const metadata = intent.metadata ?? {};
  if (
    metadata.chargeType !== "agent_purchase" ||
    metadata.userId !== authUser.id ||
    metadata.listingId !== parsed.data.listingId
  ) {
    return errorResponse(c, "Payment not found", 404, "PAYMENT_NOT_FOUND");
  }

  if (intent.status === "requires_action" || intent.status === "requires_confirmation") {
    return errorResponse(c, "Card authentication was not completed.", 402, "AUTHENTICATION_INCOMPLETE");
  }
  if (intent.status !== "succeeded") {
    return errorResponse(
      c,
      intent.last_payment_error?.message ?? "The payment was not completed. Please try another card.",
      402,
      "PAYMENT_INCOMPLETE"
    );
  }

  const listing = await prisma.agentListing.findUnique({
    where: { id: parsed.data.listingId },
    select: { id: true, name: true, priceCents: true, pricingModel: true }
  });
  if (!listing) return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");

  const business = await prisma.business.findFirst({
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
    select: { id: true }
  });

  const { payment } = await finalizePaidAgentPurchase({
    authUser: { id: authUser.id, email: authUser.email, fullName: authUser.fullName ?? null },
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

  return successResponse(c, { payment, subscriptionId: null }, "Purchase completed", 201);
});

paymentRoutes.post("/cancel-agent/:agentId", async (c) => {
  const authUser = c.get("authUser");
  const agentId = c.req.param("agentId");
  const installedAgent = await prisma.installedAgent.findFirst({
    where: {
      business: { ownerId: authUser.id },
      OR: [{ id: agentId }, { listingId: agentId }]
    },
    select: { id: true, listingId: true }
  });
  const listingId = installedAgent?.listingId ?? agentId;

  const payments = await prisma.payment.findMany({
    where: {
      userId: authUser.id,
      OR: [
        ...(installedAgent
          ? [
              { installedAgentId: installedAgent.id },
              { installedAgentId: null, listingId }
            ]
          : [{ listingId }])
      ]
    },
    orderBy: { createdAt: "desc" }
  });

  const activePayment = resolveActivePayment(payments);
  if (!activePayment) {
    return errorResponse(c, "No active access found for this agent", 404, "ACTIVE_ACCESS_NOT_FOUND");
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: activePayment.id },
      data:
        activePayment.status === "SUCCEEDED"
          ? { canceledAt: now }
          : { status: "CANCELED", canceledAt: now }
    }),
    prisma.payment.updateMany({
      where: {
        userId: authUser.id,
        OR: [
          ...(installedAgent
            ? [
                { installedAgentId: installedAgent.id },
                { installedAgentId: null, listingId }
              ]
            : [{ listingId }])
        ],
        invoiceKind: { in: ["POST_TRIAL", "SUBSCRIPTION_RENEWAL"] },
        status: { in: ["PENDING", "OVERDUE"] }
      },
      data: { status: "CANCELED", canceledAt: now }
    }),
    prisma.installedAgent.updateMany({
      where: {
        business: { ownerId: authUser.id },
        ...(installedAgent
          ? { id: installedAgent.id }
          : { listingId })
      },
      data: {
        status: "CANCELED"
      }
    })
  ]);

  return successResponse(c, null, "Subscription cancelled successfully");
});
