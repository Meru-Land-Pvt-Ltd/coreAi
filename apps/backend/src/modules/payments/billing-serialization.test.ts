import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { PaymentInvoiceKind, PaymentStatus, UsageInvoiceStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Billing serialization + retry-safety regressions for payments/routes.ts:
 * nullable Prisma dates (spendingAlertLastNotifiedAt, pausedAt, periodEnd)
 * must serialize to ISO strings or null, the AgentUsageExecution ledger is the
 * source of current-month execution cost, unpaid-invoice aggregation uses the
 * generated enums, and the invoice-pay claim stays idempotent. Stripe is
 * mocked at the module boundary — no provider call is ever made. DB cases
 * skip when the local database is down.
 */

const { stripeState } = await vi.hoisted(async () => {
  // Using vi.mock makes vitest evaluate this file's module graph BEFORE the
  // configured setupFiles run, so src/config/env.ts would parse an empty
  // process.env and throw. Replicate test/setup.ts's env bootstrap here,
  // ahead of every import — loading the backend .env by explicit path (the
  // hoisted phase does not reliably share the worker's cwd).
  const { fileURLToPath } = await import("node:url");
  const nodePath = await import("node:path");
  const dotenv = await import("dotenv");
  dotenv.config({
    path: nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../../../.env")
  });
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-at-least-24-chars";
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "test-encryption-key-24-chars!";
  process.env.SES_DRY_RUN = "true";
  delete process.env.REDIS_URL;

  return {
    stripeState: {
      createdIntents: [] as Array<{ params: unknown; options: { idempotencyKey?: string } | undefined }>
    }
  };
});

vi.mock("./stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stripe")>()),
  isStripeConfigured: () => true,
  getStripeClient: () => ({
    customers: {
      retrieve: async (customerId: string) => ({
        id: customerId,
        deleted: false,
        invoice_settings: { default_payment_method: "pm_default_mock" }
      })
    },
    paymentIntents: {
      retrieve: async () => {
        throw new Error("no prior intent");
      },
      create: async (params: unknown, options?: { idempotencyKey?: string }) => {
        stripeState.createdIntents.push({ params, options });
        return { id: `pi_mock_${stripeState.createdIntents.length}`, status: "succeeded" };
      },
      confirm: async (intentId: string) => ({ id: intentId, status: "succeeded" })
    },
    paymentMethods: {
      list: async () => ({ data: [] }),
      retrieve: async () => ({ card: null })
    }
  })
}));

const { createAuthToken } = await import("../../lib/jwt");
const { prisma } = await import("../../lib/prisma");
const { paymentRoutes } = await import("./routes");

const RUN = `billingser-${process.pid}-${Date.now().toString(36)}`;
const BILLING_MONTH = new Date().toISOString().slice(0, 7);

let dbAvailable = false;
let tokenWithDates = "";
let tokenWithoutDates = "";
let tokenPayer = "";
let businessAId = "";
let businessBId = "";
let listingTrialId = "";
let listingPaidId = "";
let listingBareId = "";
let payableInvoiceId = "";
let inProgressInvoiceId = "";

const pausedAt = new Date("2026-07-20T10:30:00.000Z");
const notifiedAt = new Date("2026-07-21T09:00:00.000Z");
const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const paidPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function buildApp() {
  const app = new Hono();
  app.route("/payments", paymentRoutes);
  return app;
}

function getJson(app: Hono, path: string, token: string) {
  return app.request(path, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

function postJson(app: Hono, path: string, token: string) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: "{}"
  });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[billing-serialization.test] database unreachable — suite skipped");
    return;
  }

  const [userA, userB, payer] = await Promise.all([
    prisma.user.create({ data: { email: `${RUN}-a@test.local`, role: "BUSINESS" } }),
    prisma.user.create({ data: { email: `${RUN}-b@test.local`, role: "BUSINESS" } }),
    prisma.user.create({ data: { email: `${RUN}-payer@test.local`, role: "BUSINESS" } })
  ]);
  tokenWithDates = await createAuthToken({ id: userA.id, email: userA.email, role: "BUSINESS" });
  tokenWithoutDates = await createAuthToken({ id: userB.id, email: userB.email, role: "BUSINESS" });
  tokenPayer = await createAuthToken({ id: payer.id, email: payer.email, role: "BUSINESS" });

  const businessA = await prisma.business.create({
    data: {
      ownerId: userA.id,
      name: `${RUN} Clinic A`,
      type: "Dental Practice",
      spendingAlertEnabled: true,
      spendingAlertLastNotifiedMonth: BILLING_MONTH,
      spendingAlertLastNotifiedAt: notifiedAt
    }
  });
  businessAId = businessA.id;

  const businessB = await prisma.business.create({
    data: { ownerId: userB.id, name: `${RUN} Clinic B`, type: "Dental Practice" }
  });
  businessBId = businessB.id;

  const workflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: userA.id,
      name: `${RUN} workflow`,
      workflowJson: { nodes: [], edges: [] }
    }
  });

  const [listingTrial, listingPaid, listingBare] = await Promise.all([
    prisma.agentListing.create({
      data: {
        name: `${RUN} Trial Agent`,
        shortDescription: "trial listing",
        architectUserId: userA.id,
        status: "APPROVED",
        priceCents: 4900,
        freeTrialEnabled: true,
        trialDays: 7,
        workflowId: workflow.id
      }
    }),
    prisma.agentListing.create({
      data: {
        name: `${RUN} Paid Agent`,
        shortDescription: "paid listing",
        architectUserId: userA.id,
        status: "APPROVED",
        priceCents: 9900,
        workflowId: workflow.id
      }
    }),
    prisma.agentListing.create({
      data: {
        name: `${RUN} Bare Agent`,
        shortDescription: "bare listing",
        architectUserId: userA.id,
        status: "APPROVED",
        priceCents: 1900,
        workflowId: workflow.id
      }
    })
  ]);
  listingTrialId = listingTrial.id;
  listingPaidId = listingPaid.id;
  listingBareId = listingBare.id;

  const installedTrial = await prisma.installedAgent.create({
    data: {
      businessId: businessA.id,
      workflowId: workflow.id,
      listingId: listingTrial.id,
      name: `${RUN} trial install`,
      status: "PAUSED",
      pausedAt
    }
  });
  await prisma.installedAgent.create({
    data: {
      businessId: businessA.id,
      workflowId: workflow.id,
      listingId: listingPaid.id,
      name: `${RUN} paid install`,
      status: "ACTIVE"
    }
  });
  await prisma.installedAgent.create({
    data: {
      businessId: businessB.id,
      workflowId: workflow.id,
      listingId: listingBare.id,
      name: `${RUN} bare install`,
      status: "ACTIVE"
    }
  });

  // Trial payment (invoiceKind TRIAL, periodEnd = trial expiry) and a plain
  // succeeded purchase whose periodEnd must NOT surface as trialEndsAt.
  await prisma.payment.create({
    data: {
      userId: userA.id,
      businessId: businessA.id,
      listingId: listingTrial.id,
      amountCents: 4900,
      currency: "usd",
      status: PaymentStatus.TRIALING,
      invoiceKind: PaymentInvoiceKind.TRIAL,
      periodStart: new Date(),
      periodEnd: trialEndsAt,
      description: `7-day trial for ${RUN} Trial Agent`
    }
  });
  await prisma.payment.create({
    data: {
      userId: userA.id,
      businessId: businessA.id,
      listingId: listingPaid.id,
      amountCents: 9900,
      currency: "usd",
      status: PaymentStatus.SUCCEEDED,
      invoiceKind: PaymentInvoiceKind.PURCHASE,
      periodStart: new Date(),
      periodEnd: paidPeriodEnd,
      paidAt: new Date(),
      description: `Purchase of ${RUN} Paid Agent`
    }
  });
  await prisma.payment.create({
    data: {
      userId: userB.id,
      businessId: businessB.id,
      listingId: listingBare.id,
      amountCents: 1900,
      currency: "usd",
      status: PaymentStatus.SUCCEEDED,
      invoiceKind: PaymentInvoiceKind.PURCHASE,
      paidAt: new Date(),
      description: `Purchase of ${RUN} Bare Agent`
    }
  });

  // Current-month execution ledger: 30¢ billed + 20¢ legacy = 50¢.
  await prisma.agentUsageExecution.createMany({
    data: [
      {
        businessId: businessA.id,
        installedAgentId: installedTrial.id,
        dedupeKey: `${RUN}-exec-1`,
        source: "VAPI",
        sourceId: `${RUN}-call-1`,
        billingMonth: BILLING_MONTH,
        occurredAt: new Date(),
        executionNumber: 1,
        unitPriceMicroUsd: 300_000,
        amountMicroUsd: 300_000
      },
      {
        businessId: businessA.id,
        installedAgentId: installedTrial.id,
        dedupeKey: `${RUN}-exec-2`,
        source: "VAPI",
        sourceId: `${RUN}-call-2`,
        billingMonth: BILLING_MONTH,
        occurredAt: new Date(),
        executionNumber: 2,
        unitPriceMicroUsd: 0,
        amountMicroUsd: 0,
        legacyBilledCostMicroUsd: 200_000
      }
    ]
  });

  // Unpaid usage invoices (OPEN + PENDING + OVERDUE count, PAID must not).
  const usageInvoiceBase = {
    businessId: businessA.id,
    billingMonth: BILLING_MONTH,
    currency: "usd",
    periodStart: new Date(),
    periodEnd: new Date(),
    issuedAt: new Date(),
    dueAt: new Date()
  };
  const openUsageInvoice = await prisma.businessUsageInvoice.create({
    data: {
      ...usageInvoiceBase,
      invoiceNumber: `${RUN}-usage-open`,
      status: UsageInvoiceStatus.OPEN,
      sequence: 1,
      subtotalMicroUsd: 100_000,
      totalMicroUsd: 100_000
    }
  });
  await prisma.agentUsageExecution.updateMany({
    where: {
      businessId: businessA.id,
      dedupeKey: { in: [`${RUN}-exec-1`, `${RUN}-exec-2`] }
    },
    data: { usageInvoiceId: openUsageInvoice.id }
  });
  await prisma.businessUsageInvoice.create({
    data: {
      ...usageInvoiceBase,
      invoiceNumber: `${RUN}-usage-pending`,
      status: UsageInvoiceStatus.PENDING,
      sequence: 2,
      subtotalMicroUsd: 200_000,
      totalMicroUsd: 200_000
    }
  });
  await prisma.businessUsageInvoice.create({
    data: {
      ...usageInvoiceBase,
      invoiceNumber: `${RUN}-usage-overdue`,
      status: UsageInvoiceStatus.OVERDUE,
      sequence: 3,
      subtotalMicroUsd: 300_000,
      totalMicroUsd: 300_000
    }
  });
  await prisma.businessUsageInvoice.create({
    data: {
      ...usageInvoiceBase,
      invoiceNumber: `${RUN}-usage-paid`,
      status: UsageInvoiceStatus.PAID,
      sequence: 4,
      subtotalMicroUsd: 990_000,
      totalMicroUsd: 990_000,
      paidAt: new Date()
    }
  });

  // Unpaid agent invoices: PENDING + OVERDUE of POST_TRIAL/SUBSCRIPTION_RENEWAL
  // count toward nextChargeCents; a PENDING PURCHASE row must not.
  await prisma.payment.create({
    data: {
      userId: userA.id,
      businessId: businessA.id,
      amountCents: 500,
      currency: "usd",
      status: PaymentStatus.PENDING,
      invoiceKind: PaymentInvoiceKind.POST_TRIAL,
      description: `${RUN} post-trial invoice`
    }
  });
  await prisma.payment.create({
    data: {
      userId: userA.id,
      businessId: businessA.id,
      amountCents: 700,
      currency: "usd",
      status: PaymentStatus.OVERDUE,
      invoiceKind: PaymentInvoiceKind.SUBSCRIPTION_RENEWAL,
      description: `${RUN} renewal invoice`
    }
  });
  await prisma.payment.create({
    data: {
      userId: userA.id,
      businessId: businessA.id,
      amountCents: 900,
      currency: "usd",
      status: PaymentStatus.PENDING,
      invoiceKind: PaymentInvoiceKind.PURCHASE,
      description: `${RUN} pending purchase (excluded)`
    }
  });

  // Retry-safety fixtures for POST /payments/invoices/:id/pay. businessId is
  // intentionally null so restoreBusinessAfterBillingPayment is out of scope.
  const payable = await prisma.payment.create({
    data: {
      userId: payer.id,
      amountCents: 700,
      currency: "usd",
      status: PaymentStatus.OVERDUE,
      invoiceKind: PaymentInvoiceKind.POST_TRIAL,
      stripeCustomerId: "cus_mock_payer",
      stripePaymentId: "pm_mock_card",
      description: `${RUN} payable invoice`
    }
  });
  payableInvoiceId = payable.id;

  const inProgress = await prisma.payment.create({
    data: {
      userId: payer.id,
      amountCents: 800,
      currency: "usd",
      status: PaymentStatus.OVERDUE,
      invoiceKind: PaymentInvoiceKind.SUBSCRIPTION_RENEWAL,
      stripeCustomerId: "cus_mock_payer",
      stripePaymentId: "pm_mock_card",
      paymentPendingAt: new Date(),
      paymentAttemptCount: 3,
      description: `${RUN} in-progress invoice`
    }
  });
  inProgressInvoiceId = inProgress.id;
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    const businessIds = [businessAId, businessBId].filter(Boolean);
    await prisma.agentUsageExecution.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.businessUsageInvoice.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.payment.deleteMany({ where: { user: { email: { contains: RUN } } } });
    await prisma.installedAgent.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.agentListing.deleteMany({ where: { name: { contains: RUN } } });
    await prisma.workflowDefinition.deleteMany({ where: { name: `${RUN} workflow` } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  }
  await prisma.$disconnect();
});

describe("GET /payments/billing serialization", () => {
  it("serializes spendingAlertLastNotifiedAt and trial periodEnd, aggregates execution + unpaid invoices", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const res = await getJson(buildApp(), "/payments/billing", tokenWithDates);
    expect(res.status).toBe(200);
    const body = await res.json();
    const billing = body.data.billing;

    expect(billing.spendingAlert.lastNotifiedAt).toBe(notifiedAt.toISOString());
    expect(billing.spendingAlert.lastNotifiedMonth).toBe(BILLING_MONTH);

    const trialAgent = billing.agents.find(
      (agent: { listingId: string }) => agent.listingId === listingTrialId
    );
    expect(trialAgent).toBeDefined();
    expect(trialAgent.trialEndsAt).toBe(trialEndsAt.toISOString());

    const paidAgent = billing.agents.find(
      (agent: { listingId: string }) => agent.listingId === listingPaidId
    );
    expect(paidAgent).toBeDefined();
    expect(paidAgent.trialEndsAt).toBeNull();

    // AgentUsageExecution ledger: 300_000 + 200_000 microUSD → 50¢.
    expect(billing.summary.currentMonthExecutionCostCents).toBe(50);
    // Usage OPEN+PENDING+OVERDUE (60¢) + agent PENDING/POST_TRIAL (500) +
    // OVERDUE/SUBSCRIPTION_RENEWAL (700); PAID usage and PENDING PURCHASE excluded.
    expect(billing.summary.nextChargeCents).toBe(60 + 500 + 700);

    expect(Array.isArray(billing.invoices)).toBe(true);
  });

  it("returns null lastNotifiedAt when the notification date is absent", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const res = await getJson(buildApp(), "/payments/billing", tokenWithoutDates);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.billing.spendingAlert.lastNotifiedAt).toBeNull();
  });
});

describe("GET /payments/my-agents serialization", () => {
  it("serializes pausedAt when present and null when absent", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const res = await getJson(buildApp(), "/payments/my-agents", tokenWithDates);
    expect(res.status).toBe(200);
    const body = await res.json();

    const pausedEntry = body.data.agents.find(
      (agent: { listing: { id: string } }) => agent.listing.id === listingTrialId
    );
    expect(pausedEntry).toBeDefined();
    expect(pausedEntry.installedAgentPausedAt).toBe(pausedAt.toISOString());
    expect(pausedEntry.purchaseStatus).toBe(PaymentStatus.TRIALING);
    expect(pausedEntry.pricing.agentPrice.amountCents).toBe(4900);
    expect(pausedEntry.pricing.executionPricing).toBeDefined();
    expect(pausedEntry.totalExecutions).toBe(2);
    expect(pausedEntry.stats).toEqual({
      runsThisMonth: 2,
      costThisMonthMicroUsd: 500_000
    });

    const activeEntry = body.data.agents.find(
      (agent: { listing: { id: string } }) => agent.listing.id === listingPaidId
    );
    expect(activeEntry).toBeDefined();
    expect(activeEntry.installedAgentPausedAt).toBeNull();
  });

  it("returns null pausedAt for a business that never paused", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const res = await getJson(buildApp(), "/payments/my-agents", tokenWithoutDates);
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.data.agents.find(
      (agent: { listing: { id: string } }) => agent.listing.id === listingBareId
    );
    expect(entry).toBeDefined();
    expect(entry.installedAgentPausedAt).toBeNull();
  });
});

describe("POST /payments/invoices/:id/pay retry safety", () => {
  it("claims the invoice (attempt count + pending window), pays with a per-attempt idempotency key, then clears the claim", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const res = await postJson(
      buildApp(),
      `/payments/invoices/${payableInvoiceId}/pay`,
      tokenPayer
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("PAID");

    const row = await prisma.payment.findUnique({ where: { id: payableInvoiceId } });
    expect(row?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(row?.paymentAttemptCount).toBe(1);
    expect(row?.paymentPendingAt).toBeNull();
    expect(row?.paidAt).not.toBeNull();

    const created = stripeState.createdIntents.at(-1);
    expect(created?.options?.idempotencyKey).toBe(`agent-invoice:${payableInvoiceId}:1`);
  });

  it("treats a duplicate payment attempt as already paid", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const intentsBefore = stripeState.createdIntents.length;
    const res = await postJson(
      buildApp(),
      `/payments/invoices/${payableInvoiceId}/pay`,
      tokenPayer
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.alreadyPaid).toBe(true);
    expect(stripeState.createdIntents.length).toBe(intentsBefore);

    const row = await prisma.payment.findUnique({ where: { id: payableInvoiceId } });
    expect(row?.paymentAttemptCount).toBe(1);
  });

  it("rejects a payment whose claim window is still open without touching the attempt count", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const res = await postJson(
      buildApp(),
      `/payments/invoices/${inProgressInvoiceId}/pay`,
      tokenPayer
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("INVOICE_PAYMENT_IN_PROGRESS");

    const row = await prisma.payment.findUnique({ where: { id: inProgressInvoiceId } });
    expect(row?.status).toBe(PaymentStatus.OVERDUE);
    expect(row?.paymentAttemptCount).toBe(3);
    expect(row?.paymentPendingAt).not.toBeNull();
  });
});

describe("payments routes source contract", () => {
  const routesSource = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const invoiceSource = readFileSync(
    new URL("../../lib/billing-invoices.ts", import.meta.url),
    "utf8"
  );

  it("uses the generated Prisma enums instead of free-form status strings", () => {
    expect(routesSource).toContain("UsageInvoiceStatus.OPEN");
    expect(routesSource).toContain("UsageInvoiceStatus.PENDING");
    expect(routesSource).toContain("UsageInvoiceStatus.OVERDUE");
    expect(routesSource).toContain("PaymentInvoiceKind.POST_TRIAL");
    expect(routesSource).toContain("PaymentInvoiceKind.SUBSCRIPTION_RENEWAL");
    expect(routesSource).toContain("PaymentInvoiceKind.TRIAL");
    expect(routesSource).toContain("PaymentStatus.OVERDUE");
  });

  it("serializes nullable Prisma dates through dateToIsoOrNull", () => {
    expect(routesSource).toContain("function dateToIsoOrNull(");
    expect(routesSource).toContain("dateToIsoOrNull(business?.spendingAlertLastNotifiedAt)");
    expect(routesSource).toContain("dateToIsoOrNull(installedAgent?.pausedAt)");
    expect(routesSource).toContain("dateToIsoOrNull(activeTrial.periodEnd)");
    expect(invoiceSource).toContain("payment.periodEnd?.toISOString() ?? null");
  });

  it("keeps the typed installed-agent map without unsafe casts", () => {
    expect(routesSource).toContain("new Map<string, InstalledAgentRow>()");
    expect(routesSource).not.toContain("agent.listingId as string");
  });

  it("keeps AgentUsageExecution as the execution billing ledger", () => {
    expect(routesSource).toContain("prisma.agentUsageExecution.aggregate");
    expect(routesSource).toContain("legacyBilledCostMicroUsd");
  });
});
