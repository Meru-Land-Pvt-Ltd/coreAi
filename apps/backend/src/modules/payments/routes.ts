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
  type PaymentWithListing
} from "../../lib/billing-invoices";
import {
  buildInvoiceDocumentHtml,
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

function resolveActivePayment<T extends { status: PaymentStatus }>(payments: T[]) {
  const owned = payments.filter((payment) => OWNED_PAYMENT_STATUSES.includes(payment.status));

  return (
    owned.find((payment) => payment.status === PaymentStatus.SUCCEEDED) ??
    owned.find((payment) => payment.status === PaymentStatus.TRIALING) ??
    owned.find((payment) => payment.status === PaymentStatus.PENDING) ??
    null
  );
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
  billingAddress: z.string().trim().min(3)
});

const purchaseSchema = z.object({
  listingId: z.string().trim().min(1),
  paymentMethodId: z.string().trim().min(1),
  billingName: z.string().trim().min(2),
  billingEmail: z.string().trim().email(),
  billingAddress: z.string().trim().min(3)
});

type CheckoutBillingDetails = {
  billingName: string;
  billingEmail: string;
  billingAddress: string;
};

async function persistCheckoutBilling(ownerId: string, billing: CheckoutBillingDetails) {
  await prisma.business.updateMany({
    where: { ownerId },
    data: billing
  });
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
      billingAddress: true
    }
  });

  const paymentMethod = await resolvePaymentMethodLabel(payment);
  const agentName = payment.listing?.name || "Agent purchase";
  const trialDescription = `7-day trial for ${agentName}`;
  const billTo = resolveInvoiceBillTo(payment, business, authUser);

  if (syntheticTrial) {
    return {
      invoiceNumber: invoiceNumberForPayment(`${payment.id}-trial`),
      date: payment.createdAt,
      businessName: billTo.businessName,
      businessEmail: billTo.businessEmail,
      agentName,
      description: trialDescription,
      amountCents: 0,
      listPriceCents: payment.amountCents,
      currency: payment.currency,
      status: PaymentStatus.TRIALING,
      billingAddress: billTo.billingAddress,
      paymentMethod,
      transactionId: `${payment.id}-trial`
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
    transactionId: payment.id
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

  const invoices = buildBillingInvoices(payments);

  // Resolve the business name and billing address from the owner's business
  // profile so the billing/invoice UI shows real details instead of "NA".
  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "asc" },
    select: {
      name: true,
      billingName: true,
      billingEmail: true,
      billingAddress: true
    }
  });

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
      businessName: business?.billingName ?? business?.name ?? authUser.fullName ?? null,
      billingEmail: business?.billingEmail ?? authUser.email ?? null,
      billingAddress: business?.billingAddress ?? null
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

  // Dedupe by listing — prefer the current active payment (paid over trial).
  const paymentsByListing = new Map<string, typeof payments>();

  for (const payment of payments) {
    const listing = payment.listing;
    if (!listing) continue;

    const existing = paymentsByListing.get(listing.id) ?? [];
    existing.push(payment);
    paymentsByListing.set(listing.id, existing);
  }

  const agents = [];

  for (const listingPayments of paymentsByListing.values()) {
    const listing = listingPayments[0]?.listing;
    if (!listing) continue;

    const activePayment = resolveActivePayment(listingPayments);
    if (!activePayment) continue;

    agents.push({
      purchaseId: activePayment.id,
      purchasedAt: activePayment.createdAt,
      purchaseStatus: activePayment.status,
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
      priceCents: true
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

  return successResponse(c, {
    listingId: listing.id,
    listingName: listing.name,
    amountCents: listing.priceCents,
    canStartTrial: !anyPayment,
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
  const { listingId, paymentMethodId, billingName, billingEmail, billingAddress } = parsed.data;
  const billingDetails: CheckoutBillingDetails = { billingName, billingEmail, billingAddress };

  await persistCheckoutBilling(authUser.id, billingDetails);

  const listing = await prisma.agentListing.findFirst({
    where: {
      id: listingId,
      status: { in: ["APPROVED", "PENDING_REVIEW"] }
    }
  });

  if (!listing) {
    return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");
  }

  const existingPayments = await prisma.payment.findMany({
    where: {
      userId: authUser.id,
      listingId
    },
    orderBy: { createdAt: "desc" }
  });

  const activePayment = existingPayments.find((payment) =>
    OWNED_PAYMENT_STATUSES.includes(payment.status)
  );

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
    name: billingName,
    email: billingEmail,
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
      description: `7-day trial for ${listing.name}`,
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

paymentRoutes.post("/purchase", async (c) => {
  const stripe = getStripeClient();

  if (!stripe || !isStripeConfigured()) {
    return errorResponse(c, "Stripe is not configured", 500, "STRIPE_NOT_CONFIGURED");
  }

  const body = await c.req.json().catch(() => null);
  const parsed = purchaseSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(c, "Invalid payment payload", 422, "VALIDATION_ERROR");
  }

  const authUser = c.get("authUser");
  const { listingId, paymentMethodId, billingName, billingEmail, billingAddress } = parsed.data;
  const billingDetails: CheckoutBillingDetails = { billingName, billingEmail, billingAddress };

  await persistCheckoutBilling(authUser.id, billingDetails);

  const listing = await prisma.agentListing.findFirst({
    where: {
      id: listingId,
      status: { in: ["APPROVED", "PENDING_REVIEW"] }
    }
  });

  if (!listing) {
    return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");
  }

  const existingPayments = await prisma.payment.findMany({
    where: {
      userId: authUser.id,
      listingId
    },
    orderBy: { createdAt: "desc" }
  });

  const activePayment = existingPayments.find((payment) =>
    OWNED_PAYMENT_STATUSES.includes(payment.status)
  );

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

  if (activePayment?.status === "TRIALING" && activePayment.stripeSubscriptionId) {
    await stripe.subscriptions.update(activePayment.stripeSubscriptionId, {
      trial_end: "now",
      default_payment_method: attachedPaymentMethodId
    });

    const payment = await prisma.payment.create({
      data: {
        userId: authUser.id,
        listingId: listing.id,
        amountCents: listing.priceCents,
        currency: "usd",
        status: "SUCCEEDED",
        stripeCustomerId: customerId,
        stripeSubscriptionId: activePayment.stripeSubscriptionId,
        stripePaymentId: attachedPaymentMethodId,
        description: `Purchase of ${listing.name}`,
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
        subscriptionId: activePayment.stripeSubscriptionId
      },
      "Purchase completed",
      201
    );
  }

  if (activePayment?.status === "PENDING") {
    return successResponse(c, {
      payment: activePayment,
      alreadyActive: true
    });
  }

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
      status: "SUCCEEDED",
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePaymentId: attachedPaymentMethodId,
      description: `Purchase of ${listing.name}`,
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
      subscriptionId: subscription.id
    },
    "Purchase completed",
    201
  );
});
