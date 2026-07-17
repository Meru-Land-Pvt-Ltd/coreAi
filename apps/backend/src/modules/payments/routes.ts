import { Hono } from "hono";
import { PaymentStatus } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import { buildBillingInvoices } from "../../lib/billing-invoices";
import {
  autoProvisionPhoneNumberForPurchase,
  buildAgentPurchaseLineItems,
  getPhoneNumberFee,
  listingNeedsPhoneNumber,
  resolveUnbilledPhoneFee
} from "../business/phone-provisioning";
import {
  buildInvoiceDocumentHtml,
  buildInvoicePdfBuffer,
  sendPaymentSuccessEmail
} from "../../lib/mailer";
import { getStripeClient, isStripeConfigured } from "./stripe";
import {
  buildInvoiceData,
  describeStripeError,
  finalizePaidAgentPurchase,
  paymentBillingData,
  setupUrlForListing,
  type AuthUserForInvoice,
  type CheckoutBillingDetails
} from "./purchase-finalize";
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
  listingId: z.string().trim().min(1, "Listing is required"),
  paymentMethodId: z.string().trim().min(1, "Payment method is required"),
  billingName: z.string().trim().min(2, "Enter the name on your card"),
  billingEmail: z.string().trim().email("Enter a valid billing email"),
  billingAddress: z.string().trim().min(3, "Enter your billing address"),
  /** Client-generated id for this checkout attempt — dedupes retried charges. */
  attemptId: z.string().trim().max(80).optional()
});

const purchaseSchema = z.object({
  listingId: z.string().trim().min(1, "Listing is required"),
  paymentMethodId: z.string().trim().min(1, "Payment method is required"),
  billingName: z.string().trim().min(2, "Enter the name on your card"),
  billingEmail: z.string().trim().email("Enter a valid billing email"),
  billingAddress: z.string().trim().min(3, "Enter your billing address"),
  attemptId: z.string().trim().max(80).optional()
});

const confirmPurchaseSchema = z.object({
  listingId: z.string().trim().min(1, "Listing is required"),
  paymentIntentId: z.string().trim().min(1, "Payment reference is required")
});

const billingPaymentMethodSchema = z.object({
  paymentMethodId: z.string().trim().min(1)
});

/** First zod issue as a buyer-readable message instead of a generic 422. */
function firstValidationMessage(error: z.ZodError, fallback: string) {
  const issue = error.issues[0];
  return issue?.message && issue.message !== "Required" ? issue.message : fallback;
}

async function persistCheckoutBilling(ownerId: string, billing: CheckoutBillingDetails) {
  const business = await prisma.business.findFirst({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (!business) return null;
  await prisma.business.update({ where: { id: business.id }, data: billing });
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

async function chargeAgentOnce({
  stripe,
  customerId,
  paymentMethodId,
  listing,
  userId,
  amountCents,
  phoneFeeCents,
  attemptId,
  priorTrialPaymentId
}: {
  stripe: NonNullable<ReturnType<typeof getStripeClient>>;
  customerId: string;
  paymentMethodId: string;
  listing: { id: string; name: string; priceCents: number };
  userId: string;
  /** Total to charge — agent price plus any number fee. Defaults to the agent price. */
  amountCents?: number;
  phoneFeeCents?: number;
  /** Client-generated attempt id — same retry never charges twice. */
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
      // The buyer is present on the checkout page, so 3DS/SCA challenges come
      // back as requires_action (handled client-side) instead of hard-failing.
      off_session: false,
      description: `One-time purchase of ${listing.name}`,
      metadata: {
        userId,
        listingId: listing.id,
        chargeType: "agent_purchase",
        ...(phoneFeeCents ? { phoneFeeCents: String(phoneFeeCents) } : {}),
        ...(priorTrialPaymentId ? { priorTrialPaymentId } : {})
      }
    },
    attemptId
      ? { idempotencyKey: `agent-purchase-${userId}-${listing.id}-${attemptId}` }
      : undefined
  );
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

    const isTrial = listingPayments.some(
      (p) => p.status === "TRIALING" || p.description?.toLowerCase().includes("trial")
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
    return errorResponse(
      c,
      "Payments are not available right now. Please try again later or contact support.",
      503,
      "STRIPE_NOT_CONFIGURED"
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = startTrialSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(
      c,
      firstValidationMessage(parsed.error, "Invalid payment payload"),
      422,
      "VALIDATION_ERROR"
    );
  }

  const authUser = c.get("authUser");
  const { listingId, paymentMethodId, billingName, billingEmail, billingAddress } = parsed.data;
  const billingDetails: CheckoutBillingDetails = { billingName, billingEmail, billingAddress };

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

  // Card validation/attachment can fail (invalid card, method already owned
  // by another customer, Stripe outage) — map to clean buyer-facing errors.
  let customerId: string;
  let attachedPaymentMethodId: string;
  try {
    if (previousPayment?.stripeCustomerId) {
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
    const attachedPaymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId
    });

    attachedPaymentMethodId = attachedPaymentMethod.id;

    await stripe.customers.update(customerId, {
      name: billingName,
      email: billingEmail,
      invoice_settings: {
        default_payment_method: attachedPaymentMethodId
      }
    });
  } catch (error) {
    const failure = describeStripeError(error);
    if (failure) {
      return errorResponse(c, failure.message, failure.status, failure.code);
    }
    console.error("[payments] start-trial failed with unexpected error", error);
    return errorResponse(c, "We couldn't validate your card. Please try again.", 500, "PAYMENT_FAILED");
  }

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
  try {
    const provisioned = await autoProvisionPhoneNumberForPurchase({
      buyerUserId: authUser.id,
      businessId,
      listingId: listing.id
    });
    assignedPhoneNumber = provisioned?.phoneNumber ?? null;
  } catch (error) {
    console.error("[phone-provision] trial-start provisioning failed (non-fatal)", {
      listingId: listing.id,
      error
    });
  }

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
  try {
    await notifyArchitectOfNewSale({ listingId: listing.id, agentPriceCents: listing.priceCents });
  } catch (error) {
    console.error("Architect sale notification failed (non-fatal)", error);
  }

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
    return errorResponse(
      c,
      firstValidationMessage(parsed.error, "Invalid payment payload"),
      422,
      "VALIDATION_ERROR"
    );
  }

  const authUser = c.get("authUser");
  const { listingId, paymentMethodId, billingName, billingEmail, billingAddress } = parsed.data;
  const billingDetails: CheckoutBillingDetails = { billingName, billingEmail, billingAddress };

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
      const provisioned = await autoProvisionPhoneNumberForPurchase({
        buyerUserId: authUser.id,
        businessId,
        listingId: listing.id
      });
      assignedPhoneNumber = provisioned?.phoneNumber ?? null;
    } catch (error) {
      console.error("[phone-provision] free-purchase provisioning failed (non-fatal)", {
        listingId: listing.id,
        error
      });
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

    try {
      await notifyArchitectOfNewSale({ listingId: listing.id, agentPriceCents: 0 });
    } catch (error) {
      console.error("Architect sale notification failed (non-fatal)", error);
    }

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
    return errorResponse(
      c,
      "Payments are not available right now. Please try again later or contact support.",
      503,
      "STRIPE_NOT_CONFIGURED"
    );
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

  // Allot the buyer's dedicated number before charging (idempotent — for a
  // trial conversion the number already exists) so its one-time fee can be
  // billed together with the agent price as an itemized line.
  try {
    await autoProvisionPhoneNumberForPurchase({
      buyerUserId: authUser.id,
      businessId,
      listingId: listing.id
    });
  } catch (error) {
    console.error("[phone-provision] purchase-time provisioning failed (non-fatal)", {
      listingId: listing.id,
      error
    });
  }

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

  // Every Stripe call below can throw (declined card, invalid method, Stripe
  // outage). Map those to clean buyer-facing errors instead of a raw 500.
  let intent;
  try {
    const previousPayment = await prisma.payment.findFirst({
      where: {
        userId: authUser.id,
        stripeCustomerId: { not: null }
      },
      orderBy: { createdAt: "desc" }
    });

    let customerId: string;

    if (activePayment?.stripeCustomerId) {
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

    const attachedPaymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId
    });

    const attachedPaymentMethodId = attachedPaymentMethod.id;

    await stripe.customers.update(customerId, {
      name: billingName,
      email: billingEmail,
      invoice_settings: {
        default_payment_method: attachedPaymentMethodId
      }
    });

    intent = await chargeAgentOnce({
      stripe,
      customerId,
      paymentMethodId: attachedPaymentMethodId,
      listing,
      userId: authUser.id,
      amountCents: totalCents,
      phoneFeeCents: unbilledPhoneFee?.fee.amountCents ?? 0,
      attemptId: parsed.data.attemptId,
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

  // 3DS / SCA: the buyer's bank wants authentication. The frontend completes
  // it with stripe.handleNextAction and then calls /payments/purchase/confirm.
  if (intent.status === "requires_action" || intent.status === "requires_confirmation") {
    return successResponse(c, {
      requiresAction: true,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret
    }, "Card authentication required");
  }

  if (intent.status !== "succeeded") {
    const declineMessage = intent.last_payment_error?.message;
    return errorResponse(
      c,
      declineMessage ?? "The payment could not be completed. Please try again or use a different card.",
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
    // For a trial conversion the architect was already notified at trial start.
    notifyArchitect: !priorTrialPaymentId
  });

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

// POST /payments/purchase/confirm — finalize a purchase after the buyer
// completed a 3DS/SCA challenge in the browser. Verifies the PaymentIntent
// belongs to this buyer+listing and succeeded before recording anything.
paymentRoutes.post("/purchase/confirm", async (c) => {
  const stripe = getStripeClient();
  if (!stripe || !isStripeConfigured()) {
    return errorResponse(
      c,
      "Payments are not available right now. Please try again later or contact support.",
      503,
      "STRIPE_NOT_CONFIGURED"
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = confirmPurchaseSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(
      c,
      firstValidationMessage(parsed.error, "Invalid payment confirmation payload"),
      422,
      "VALIDATION_ERROR"
    );
  }

  const authUser = c.get("authUser");

  let intent;
  try {
    intent = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
  } catch (error) {
    const failure = describeStripeError(error);
    if (failure) {
      return errorResponse(c, failure.message, failure.status, failure.code);
    }
    console.error("[payments] purchase confirm failed with unexpected error", error);
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
    return errorResponse(
      c,
      "Card authentication was not completed. Please try again.",
      402,
      "AUTHENTICATION_INCOMPLETE"
    );
  }

  if (intent.status !== "succeeded") {
    const declineMessage = intent.last_payment_error?.message;
    return errorResponse(
      c,
      declineMessage ?? "The payment was not completed. Please try again or use a different card.",
      402,
      "PAYMENT_INCOMPLETE"
    );
  }

  const listing = await prisma.agentListing.findUnique({
    where: { id: parsed.data.listingId },
    select: { id: true, name: true, priceCents: true }
  });

  if (!listing) {
    return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");
  }

  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
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
    // Billing details were persisted on the business at purchase start.
    billing: null,
    priorTrialPaymentId: metadata.priorTrialPaymentId || null,
    notifyArchitect: !metadata.priorTrialPaymentId
  });

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
