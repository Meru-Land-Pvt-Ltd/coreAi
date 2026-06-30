import { Hono } from "hono";
import { PaymentStatus } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  buildInvoicePdfBuffer,
  sendPaymentSuccessEmail,
  type InvoiceData
} from "../../lib/mailer";
import { getStripeClient, isStripeConfigured } from "./stripe";

export const paymentRoutes = new Hono();

paymentRoutes.use("*", requireAuth);
paymentRoutes.use("*", requireRole(["BUSINESS"]));

// Payments with one of these statuses count as an owned/purchased agent.
const OWNED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.TRIALING,
  PaymentStatus.SUCCEEDED,
  PaymentStatus.PENDING
];

const startTrialSchema = z.object({
  listingId: z.string().trim().min(1),
  paymentMethodId: z.string().trim().min(1)
});

function invoiceNumberForPayment(paymentId: string) {
  return `INV-${paymentId.slice(-8).toUpperCase()}`;
}

function setupUrlForListing(listingId?: string | null) {
  const base = env.FRONTEND_URL.replace(/\/$/, "");
  return listingId
    ? `${base}/business/agents/setup?listingId=${encodeURIComponent(listingId)}`
    : `${base}/business/agents/setup`;
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
          name: true
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
          name: true
        }
      }
    }
  });

  const activeStatuses: string[] = ["TRIALING", "SUCCEEDED", "PENDING"];

  // Unique agents the business has purchased/started, with the price paid.
  const agentMap = new Map<string, { id: string; name: string; priceCents: number }>();

  for (const payment of payments) {
    if (!payment.listing) continue;
    if (!activeStatuses.includes(payment.status)) continue;
    if (agentMap.has(payment.listing.id)) continue;

    agentMap.set(payment.listing.id, {
      id: payment.listing.id,
      name: payment.listing.name,
      priceCents: payment.amountCents
    });
  }

  const agents = Array.from(agentMap.values());

  const totalAgentFeesPaidCents = payments
    .filter((payment) => payment.status === "SUCCEEDED")
    .reduce((sum, payment) => sum + payment.amountCents, 0);

  const hasActivePlan = payments.some((payment) => activeStatuses.includes(payment.status));

  const invoices = payments.map((payment) => ({
    id: payment.id,
    createdAt: payment.createdAt,
    description: payment.description ?? (payment.listing ? payment.listing.name : "Payment"),
    amountCents: payment.amountCents,
    currency: payment.currency,
    status: payment.status
  }));

  // Best-effort fetch of the default card from Stripe. Any failure -> null (UI shows NA).
  let paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null = null;

  const paymentWithCustomer = payments.find((payment) => payment.stripeCustomerId);
  const stripe = getStripeClient();

  if (stripe && isStripeConfigured() && paymentWithCustomer?.stripeCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(paymentWithCustomer.stripeCustomerId);

      let paymentMethodId: string | null = null;

      if (typeof customer !== "string" && !customer.deleted) {
        const defaultMethod = customer.invoice_settings?.default_payment_method;
        paymentMethodId = typeof defaultMethod === "string" ? defaultMethod : defaultMethod?.id ?? null;
      }

      if (!paymentMethodId) {
        paymentMethodId = paymentWithCustomer.stripePaymentId ?? null;
      }

      if (paymentMethodId) {
        const method = await stripe.paymentMethods.retrieve(paymentMethodId);

        if (method.card) {
          paymentMethod = {
            brand: method.card.brand,
            last4: method.card.last4,
            expMonth: method.card.exp_month,
            expYear: method.card.exp_year
          };
        }
      }
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
        // Execution usage tracking is not available yet -> UI shows NA.
        currentMonthExecutionCostCents: null,
        nextChargeCents: 0
      },
      // Per-execution usage breakdown is not tracked yet -> UI shows NA.
      usage: null,
      invoices,
      paymentMethod,
      businessName: authUser.fullName ?? null,
      billingAddress: null
    }
  });
});

// GET /payments/my-agents — the agents this business has purchased.
// Backed by the Payment ledger (keyed to the business owner), so each business
// effectively has its own array of purchased agents.
paymentRoutes.get("/my-agents", async (c) => {
  const authUser = c.get("authUser");

  const payments = await prisma.payment.findMany({
    where: {
      userId: authUser.id,
      listingId: { not: null },
      status: { in: OWNED_PAYMENT_STATUSES }
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
  });

  // Dedupe by listing — a business owns each agent once even with several
  // payment rows (e.g. trial then renewal).
  const seen = new Set<string>();
  const agents = [];

  for (const payment of payments) {
    const listing = payment.listing;
    if (!listing || seen.has(listing.id)) continue;
    seen.add(listing.id);

    agents.push({
      purchaseId: payment.id,
      purchasedAt: payment.createdAt,
      purchaseStatus: payment.status,
      listing: {
        id: listing.id,
        name: listing.name,
        shortDescription: listing.shortDescription,
        description: listing.description,
        priceCents: listing.priceCents,
        status: listing.status,
        tags: listing.tags,
        requiredConnectors: listing.requiredConnectors,
        supportedLlms: listing.supportedLlms,
        workflowId: listing.workflowId,
        createdAt: listing.createdAt,
        workflow: listing.workflow,
        architect: listing.architect
      }
    });
  }

  return successResponse(c, { agents });
});

// GET /payments/invoice/:id/pdf — branded PDF for a single payment/invoice.
paymentRoutes.get("/invoice/:id/pdf", async (c) => {
  const authUser = c.get("authUser");
  const paymentId = c.req.param("id");

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId: authUser.id },
    include: { listing: { select: { id: true, name: true } } }
  });

  if (!payment) {
    return errorResponse(c, "Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
    select: { name: true }
  });

  const invoice: InvoiceData = {
    invoiceNumber: invoiceNumberForPayment(payment.id),
    date: payment.createdAt,
    businessName: business?.name || authUser.fullName || "Customer",
    businessEmail: authUser.email,
    agentName: payment.listing?.name || "Agent purchase",
    description: payment.description || payment.listing?.name || "Agent purchase",
    amountCents: payment.amountCents,
    currency: payment.currency,
    status: payment.status
  };

  const pdf = await buildInvoicePdfBuffer(invoice);

  c.header("Content-Type", "application/pdf");
  c.header(
    "Content-Disposition",
    `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`
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
  const { listingId, paymentMethodId } = parsed.data;

  const listing = await prisma.agentListing.findFirst({
    where: {
      id: listingId,
      status: { in: ["APPROVED", "PENDING_REVIEW"] }
    }
  });

  if (!listing) {
    return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");
  }

  const existingPayment = await prisma.payment.findFirst({
    where: {
      userId: authUser.id,
      listingId,
      status: { in: ["TRIALING", "SUCCEEDED", "PENDING"] }
    }
  });

  if (existingPayment) {
    return successResponse(c, {
      payment: existingPayment,
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

  let customerId: string;

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

  const attachedPaymentMethodId = attachedPaymentMethod.id;

  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: attachedPaymentMethodId
    }
  });

  const product = await stripe.products.create({
    name: listing.name,
    metadata: {
      listingId: listing.id
    }
  });

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: listing.priceCents,
          recurring: { interval: "month" },
          product: product.id
        }
      }
    ],
    trial_period_days: 7,
    default_payment_method: attachedPaymentMethodId,
    metadata: {
      userId: authUser.id,
      listingId: listing.id
    }
  });

  const payment = await prisma.payment.create({
    data: {
      userId: authUser.id,
      listingId: listing.id,
      amountCents: listing.priceCents,
      currency: "usd",
      status: "TRIALING",
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePaymentId: attachedPaymentMethodId,
      description: `7-day trial for ${listing.name}`
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

  // Send a purchase-confirmation email with the invoice attached. Best-effort:
  // a mail failure must never break the purchase.
  try {
    const business = await prisma.business.findFirst({
      where: { ownerId: authUser.id },
      orderBy: { createdAt: "desc" },
      select: { name: true }
    });

    await sendPaymentSuccessEmail({
      to: authUser.email,
      name: business?.name || authUser.fullName,
      setupUrl: setupUrlForListing(listing.id),
      invoice: {
        invoiceNumber: invoiceNumberForPayment(payment.id),
        date: payment.createdAt,
        businessName: business?.name || authUser.fullName || "Customer",
        businessEmail: authUser.email,
        agentName: listing.name,
        description: `7-day trial for ${listing.name}`,
        amountCents: listing.priceCents,
        currency: "usd",
        status: "TRIALING"
      }
    });
  } catch (error) {
    console.error("Payment success email failed (non-fatal)", error);
  }

  return successResponse(
    c,
    {
      payment,
      subscriptionId: subscription.id,
      trialEndsAt: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null
    },
    "Trial started",
    201
  );
});
