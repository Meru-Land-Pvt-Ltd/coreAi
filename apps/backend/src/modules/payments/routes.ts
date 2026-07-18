import { Hono } from "hono";
import { PaymentStatus } from "@prisma/client";
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
  autoProvisionPhoneNumberForPurchase,
  buildAgentPurchaseLineItems,
  getPhoneNumberFee,
  listingNeedsPhoneNumber,
  markPhoneNumberFeeBilled,
  resolveUnbilledPhoneFee
} from "../business/phone-provisioning";
import {
  buildInvoiceDocumentHtml,
  buildInvoicePdfBuffer,
  sendPaymentSuccessEmail,
  type InvoiceData
} from "../../lib/mailer";
import { getStripeClient, isStripeConfigured } from "./stripe";
import { notifyArchitectOfNewSale } from "../architect/sale-notifications";
import { buildInstalledAgentRunStats } from "../business/installed-agent-run-stats";
import { OWNED_PAYMENT_STATUSES, resolveActivePayment, hasLegacyActiveSubscription } from "../business/purchase-access";

export const paymentRoutes = new Hono();

paymentRoutes.use("*", requireAuth);
paymentRoutes.use("*", requireRole(["BUSINESS"]));

function currentMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
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
  billingName: z.string().trim().min(2),
  billingEmail: z.string().trim().email(),
  billingAddress: z.string().trim().min(3),
  billingPostalCode: z.string().trim().min(3).max(20).optional(),
  /// Per-attempt UUID from checkout — Stripe idempotency key so a retried
  /// submit can never double-charge the buyer.
  attemptId: z.string().trim().min(8).max(64).optional()
});

const billingPaymentMethodSchema = z.object({
  paymentMethodId: z.string().trim().min(1)
});

type CheckoutBillingDetails = {
  billingName: string;
  billingEmail: string;
  billingAddress: string;
  billingPostalCode?: string;
};

async function persistCheckoutBilling(ownerId: string, billing: CheckoutBillingDetails) {
  const business = await prisma.business.findFirst({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
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
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "asc" }
  });
  if (!business) throw new Error("Business profile not found");

  const previousPayment = await prisma.payment.findFirst({
    where: { userId: authUser.id, stripeCustomerId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { stripeCustomerId: true }
  });
  let customerId = business.stripeCustomerId ?? previousPayment?.stripeCustomerId ?? null;

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

async function attachOrReusePaymentMethod(
  stripe: NonNullable<ReturnType<typeof getStripeClient>>,
  paymentMethodId: string,
  customerId: string
) {
  const method = await stripe.paymentMethods.retrieve(paymentMethodId);
  const attachedCustomerId =
    typeof method.customer === "string" ? method.customer : method.customer?.id ?? null;

  if (attachedCustomerId === customerId) return method;
  if (attachedCustomerId) {
    throw new Error("Payment method belongs to a different customer");
  }

  return stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
}

async function chargeAgentOnce({
  stripe,
  customerId,
  paymentMethodId,
  listing,
  userId,
  amountCents,
  phoneFeeCents,
  attemptId
}: {
  stripe: NonNullable<ReturnType<typeof getStripeClient>>;
  customerId: string;
  paymentMethodId: string;
  listing: { id: string; name: string; priceCents: number };
  userId: string;
  /** Total to charge — agent price plus any number fee. Defaults to the agent price. */
  amountCents?: number;
  phoneFeeCents?: number;
  /** Checkout attempt UUID — deduplicates retried submits at Stripe. */
  attemptId?: string;
}) {
  return stripe.paymentIntents.create(
    {
      amount: amountCents ?? listing.priceCents,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      description: `One-time purchase of ${listing.name}`,
      metadata: {
        userId,
        listingId: listing.id,
        chargeType: "agent_purchase",
        ...(phoneFeeCents ? { phoneFeeCents: String(phoneFeeCents) } : {})
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
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
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

  const activeStatuses: string[] = ["TRIALING", "SUCCEEDED", "PENDING"];

  // Unique agents the business has purchased/started, with the price paid.
  const agentMap = new Map<
    string,
    { id: string; name: string; priceCents: number; pricingModel?: string | null; trialDays?: number | null }
  >();

  for (const payment of payments) {
    if (!payment.listing) continue;
    if (!activeStatuses.includes(payment.status)) continue;
    if (agentMap.has(payment.listing.id)) continue;

    agentMap.set(payment.listing.id, {
      id: payment.listing.id,
      name: payment.listing.name,
      priceCents: payment.amountCents,
      pricingModel: payment.listing.pricingModel,
      trialDays: payment.listing.trialDays
    });
  }

  const agents = Array.from(agentMap.values());

  const totalAgentFeesPaidCents = payments
    .filter((payment) => payment.status === "SUCCEEDED")
    .reduce((sum, payment) => sum + payment.amountCents, 0);

  const hasActivePlan = payments.some((payment) => activeStatuses.includes(payment.status));

  const invoices = buildBillingInvoices(payments);

  // Resolve the business name and billing address from the owner's business
  // profile so the billing/invoice UI shows real details instead of "NA".
  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      stripeCustomerId: true,
      billingName: true,
      billingEmail: true,
      billingAddress: true,
      billingPostalCode: true
    }
  });

  const currentBillingMonth = new Date().toISOString().slice(0, 7);
  const [currentUsage, unpaidUsageInvoices] = business
    ? await Promise.all([
        prisma.vapiCall.aggregate({
          where: {
            businessId: business.id,
            billingMonth: currentBillingMonth,
            billingRecordedAt: { not: null }
          },
          _sum: { billedCostMicroUsd: true }
        }),
        prisma.businessUsageInvoice.aggregate({
          where: { businessId: business.id, status: { in: ["OPEN", "OVERDUE"] } },
          _sum: { totalMicroUsd: true }
        })
      ])
    : [{ _sum: { billedCostMicroUsd: null } }, { _sum: { totalMicroUsd: null } }];

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

  return successResponse(c, {
    billing: {
      plan: {
        name: "Pay-per-Agent",
        status: hasActivePlan ? "Active" : "Inactive"
      },
      agents,
      summary: {
        totalAgentFeesPaidCents,
        currentMonthExecutionCostCents: Math.round((currentUsage._sum.billedCostMicroUsd ?? 0) / 10_000),
        nextChargeCents: Math.round((unpaidUsageInvoices._sum.totalMicroUsd ?? 0) / 10_000)
      },
      usage: { billingMonth: currentBillingMonth },
      invoices,
      paymentMethod,
      backupPaymentMethod,
      businessName: business?.billingName ?? business?.name ?? authUser.fullName ?? null,
      billingEmail: business?.billingEmail ?? authUser.email ?? null,
      billingAddress: business?.billingAddress ?? null,
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

// GET /payments/my-agents — the agents this business has purchased.
// Backed by the Payment ledger (keyed to the business owner), so each business
// effectively has its own array of purchased agents.
paymentRoutes.get("/my-agents", async (c) => {
  const authUser = c.get("authUser");

  const [payments, business] = await Promise.all([
    prisma.payment.findMany({
      where: {
        userId: authUser.id,
        listingId: { not: null }
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
      where: { ownerId: authUser.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        installedAgents: {
          select: { id: true, listingId: true, status: true, createdAt: true }
        }
      }
    })
  ]);

  const installedAgents = business?.installedAgents ?? [];
  const runStatsByAgentId = business
    ? await buildInstalledAgentRunStats(business.id, installedAgents, { start: currentMonthStart() })
    : new Map<string, { runs: number; costMicroUsd: number }>();
  const installedByListingId = new Map(
    installedAgents
      .filter((agent) => agent.listingId)
      .map((agent) => [agent.listingId as string, agent])
  );

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
      } else {
        // Installed but no payment record exists at all (e.g. legacy/subscription user)
        const hasSub = await hasLegacyActiveSubscription(authUser.id);
        statusToUse = hasSub ? "SUCCEEDED" : "FAILED";
        purchaseIdToUse = `installed-${installedAgent.id}`;
        purchasedAtToUse = installedAgent.createdAt;
      }
    }

    // A historical trial must not keep a converted/paid purchase in trial
    // mode. The status selected above is the current source of truth; only
    // retain the historical marker for failed/canceled trial acquisitions.
    const isTrial = statusToUse === PaymentStatus.TRIALING || (
      statusToUse !== PaymentStatus.SUCCEEDED &&
      listingPayments.some((payment) =>
        payment.status === PaymentStatus.TRIALING ||
        payment.description?.toLowerCase().includes("trial")
      )
    );

    const stats = installedAgent
      ? runStatsByAgentId.get(installedAgent.id) ?? { runs: 0, costMicroUsd: 0 }
      : { runs: 0, costMicroUsd: 0 };

    let totalExecutions = 0;
    let totalBookings = 0;

    if (installedAgent && business) {
      const vapiExecutions = await prisma.vapiCall.count({
        where: {
          businessId: business.id,
          installedAgentId: installedAgent.id
        }
      });
      totalExecutions = vapiExecutions;

      if (installedAgents.length === 1) {
        const missedCalls = await prisma.lead.count({
          where: {
            businessId: business.id,
            source: { contains: "MISSED_CALL" }
          }
        });
        totalExecutions += missedCalls;

        totalBookings = await prisma.appointment.count({
          where: { businessId: business.id }
        });
      } else {
        const agentVapiCalls = await prisma.vapiCall.findMany({
          where: {
            businessId: business.id,
            installedAgentId: installedAgent.id,
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
      stats: {
        runsThisMonth: stats.runs,
        costThisMonthMicroUsd: stats.costMicroUsd
      },
      totalExecutions,
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
        trialDays: listing.trialDays
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
      trialDays: true
    }
  });

  if (!listing) {
    return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");
  }

  const payments = await prisma.payment.findMany({
    where: {
      userId: authUser.id,
      listingId
    },
    orderBy: { createdAt: "desc" }
  });

  const activePayment = resolveActivePayment(payments);
  const anyPayment = payments.length > 0;
  const purchaseStatus = activePayment?.status ?? payments[0]?.status ?? null;
  const isTrialing = purchaseStatus === PaymentStatus.TRIALING;
  const canPayNow =
    (anyPayment && !activePayment) ||
    isTrialing;

  const usageServices = await prisma.platformUsageService.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { code: true, name: true, unit: true, updatedCostMicroUsd: true }
  });
  const perMinuteMicroUsd = usageServices
    .filter((service) => service.unit === "PER_MINUTE")
    .reduce((sum, service) => sum + service.updatedCostMicroUsd, 0);

  // One-time number fee billed with the agent price when this agent's
  // workflow needs a dedicated phone number.
  const needsPhone = await listingNeedsPhoneNumber(listing.id);
  const phoneFee = needsPhone ? await getPhoneNumberFee() : null;

  return successResponse(c, {
    listingId: listing.id,
    listingName: listing.name,
    amountCents: listing.priceCents,
    pricingModel: listing.pricingModel,
    freeTrialEnabled: listing.freeTrialEnabled,
    trialDays: listing.trialDays,
    phoneNumberFee: phoneFee
      ? { label: phoneFee.label, amountCents: phoneFee.amountCents }
      : null,
    currency: "usd",
    usagePricing: {
      perMinuteUsd: perMinuteMicroUsd / 1_000_000,
      services: usageServices.map((service) => ({
        code: service.code,
        name: service.name,
        unit: service.unit,
        unitPriceUsd: service.updatedCostMicroUsd / 1_000_000
      }))
    },
    canStartTrial: listing.freeTrialEnabled && !anyPayment,
    hasActiveAccess: Boolean(activePayment),
    trialUsed: anyPayment,
    canPayNow,
    purchaseStatus
  });
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
      businessId,
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

  // Attaching a test token (e.g. pm_card_visa) returns a concrete PaymentMethod
  // whose id differs from the token, so use the attached method's id afterwards.
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

  const payment = await prisma.payment.create({
    data: {
      userId: authUser.id,
      businessId,
      listingId: listing.id,
      amountCents: listing.priceCents,
      currency: "usd",
      status: "TRIALING",
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

  // Allot the buyer's dedicated number at trial start (agents with a phone
  // node only). The fee is billed with the agent price after the trial; a
  // provisioning failure must never break the purchase — setup retries later.
  let assignedPhoneNumber: string | null = null;

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
      trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString()
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

  // Bypass Stripe for FREE agent installations
  if (listing.pricingModel === "FREE") {
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

    const payment = await prisma.payment.create({
      data: {
        userId: authUser.id,
        businessId,
        listingId: listing.id,
        amountCents: 0,
        currency: "usd",
        status: "SUCCEEDED",
        stripeCustomerId: null,
        stripePaymentId: null,
        description: `Free installation of ${listing.name}`,
        lineItemsJson: [] as never,
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

    let assignedPhoneNumber: string | null = null;

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

    await notifyArchitectOfNewSale({ listingId: listing.id, agentPriceCents: 0 });

    return successResponse(
      c,
      {
        payment,
        subscriptionId: null,
        assignedPhoneNumber
      },
      "Purchase completed",
      201
    );
  }

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
  } else if (activePayment?.stripeCustomerId) {
    customerId = activePayment.stripeCustomerId;
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

  if (activePayment?.status === "TRIALING") {
    // The number was allotted at trial start; ensure it exists (idempotent)
    // and bill its fee together with the agent price, as an invoice line —
    // but only if this number's fee was never billed before.

    const unbilledPhoneFee = await resolveUnbilledPhoneFee({
      buyerUserId: authUser.id,
      businessId
    });
    const lineItems = buildAgentPurchaseLineItems({
      agentLabel: listing.name,
      agentPriceCents: listing.priceCents,
      phoneFee: unbilledPhoneFee?.fee ?? null
    });
    const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

    const intent = await chargeAgentOnce({
      stripe,
      customerId,
      paymentMethodId: attachedPaymentMethodId,
      listing,
      userId: authUser.id,
      amountCents: totalCents,
      phoneFeeCents: unbilledPhoneFee?.fee.amountCents ?? 0,
      attemptId
    });
    if (intent.status !== "succeeded") {
      return errorResponse(c, "Payment requires attention", 409, "PAYMENT_INCOMPLETE");
    }

    if (activePayment.stripeSubscriptionId) {
      await stripe.subscriptions.cancel(activePayment.stripeSubscriptionId).catch(() => undefined);
    }

    const payment = await prisma.payment.create({
      data: {
        userId: authUser.id,
        businessId,
        listingId: listing.id,
        amountCents: totalCents,
        currency: "usd",
        status: "SUCCEEDED",
        stripeCustomerId: customerId,
        stripePaymentId: attachedPaymentMethodId,
        description: `Purchase of ${listing.name}`,
        lineItemsJson: lineItems as never,
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

    await prisma.payment.update({
      where: { id: activePayment.id },
      data: { status: "CANCELED" }
    });

    if (unbilledPhoneFee) {
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

    return successResponse(
      c,
      {
        payment,
        subscriptionId: null
      },
      "Purchase completed",
      201
    );
  }

  // Direct purchase (no trial): allot the number first, then charge the agent
  // price plus the number fee (only if never billed for this number) in one
  // payment with an itemized breakdown.

  const unbilledPhoneFee = await resolveUnbilledPhoneFee({
    buyerUserId: authUser.id,
    businessId
  });
  const lineItems = buildAgentPurchaseLineItems({
    agentLabel: listing.name,
    agentPriceCents: listing.priceCents,
    phoneFee: unbilledPhoneFee?.fee ?? null
  });
  const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

  const intent = await chargeAgentOnce({
    stripe,
    customerId,
    paymentMethodId: attachedPaymentMethodId,
    listing,
    userId: authUser.id,
    amountCents: totalCents,
    phoneFeeCents: unbilledPhoneFee?.fee.amountCents ?? 0,
    attemptId
  });
  if (intent.status !== "succeeded") {
    return errorResponse(c, "Payment requires attention", 409, "PAYMENT_INCOMPLETE");
  }

  const payment = await prisma.payment.create({
    data: {
      userId: authUser.id,
      businessId,
      listingId: listing.id,
      amountCents: totalCents,
      currency: "usd",
      status: "SUCCEEDED",
      stripeCustomerId: customerId,
      stripePaymentId: attachedPaymentMethodId,
      description: `Purchase of ${listing.name}`,
      lineItemsJson: lineItems as never,
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

  // Cancel any stale TRIALING rows for this listing (an expired trial paid
  // manually lands here) so the hourly trial-conversion job cannot charge the
  // same buyer a second time.
  await prisma.payment.updateMany({
    where: { userId: authUser.id, listingId: listing.id, status: "TRIALING", NOT: { id: payment.id } },
    data: { status: "CANCELED" }
  });

  if (unbilledPhoneFee) {
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

  // Direct purchase (no prior trial) — notify the architect of the new sale.
  await notifyArchitectOfNewSale({ listingId: listing.id, agentPriceCents: listing.priceCents });

  return successResponse(
    c,
    {
      payment,
      subscriptionId: null
    },
    "Purchase completed",
    201
  );
});

paymentRoutes.post("/cancel-agent/:listingId", async (c) => {
  const authUser = c.get("authUser");
  const listingId = c.req.param("listingId");

  const payments = await prisma.payment.findMany({
    where: {
      userId: authUser.id,
      listingId
    },
    orderBy: { createdAt: "desc" }
  });

  const activePayment = resolveActivePayment(payments);
  if (!activePayment) {
    return errorResponse(c, "No active access found for this agent", 404, "ACTIVE_ACCESS_NOT_FOUND");
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: activePayment.id },
      data: { status: "CANCELED" }
    }),
    prisma.installedAgent.updateMany({
      where: {
        business: { ownerId: authUser.id },
        listingId
      },
      data: {
        status: "INACTIVE"
      }
    })
  ]);

  return successResponse(c, null, "Subscription cancelled successfully");
});
