import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Marketplace install-flow tests: free agents install immediately with no
 * Payment record, trials install once (never twice), paid agents install only
 * after a confirmed charge, and repeated requests/callbacks converge on one
 * Payment + one InstalledAgent. DB-backed like purchase-access.test.ts;
 * Stripe is replaced by a scriptable in-memory fake.
 */

const stripeMocks = vi.hoisted(() => {
  const paymentIntentsCreate = vi.fn();
  const fakeStripe = {
    customers: {
      create: vi.fn(async () => ({ id: "cus_test_install_flow" })),
      update: vi.fn(async () => ({})),
      retrieve: vi.fn(async () => ({ deleted: false, invoice_settings: {} }))
    },
    paymentMethods: {
      retrieve: vi.fn(async (id: string) => ({ id, customer: null, card: null })),
      attach: vi.fn(async (id: string, opts: { customer: string }) => ({
        id,
        customer: opts.customer,
        card: null
      }))
    },
    paymentIntents: {
      create: paymentIntentsCreate,
      retrieve: vi.fn()
    },
    subscriptions: {
      cancel: vi.fn(async () => ({}))
    }
  };
  return { fakeStripe, paymentIntentsCreate };
});

vi.mock("./stripe", async (importOriginal) => {
  // Keep the real pure helpers (e.g. attachOrReusePaymentMethod, which just
  // drives the client) and override only the client accessors with the fake.
  const actual = await importOriginal<typeof import("./stripe")>();
  return {
    ...actual,
    getStripeClient: () => stripeMocks.fakeStripe,
    isStripeConfigured: () => true
  };
});

import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { paymentRoutes } from "./routes";
import { finalizePaidAgentPurchase } from "./purchase-finalize";

const RUN = `installflow-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;

const createdUserIds: string[] = [];
const createdListingIds: string[] = [];
const createdWorkflowIds: string[] = [];

let buyer = { userId: "", businessId: "", email: "", token: "" };
let architectUserId = "";
let freeListingId = "";
let trialListingId = "";
let paidListingId = "";

function app() {
  const instance = new Hono();
  instance.route("/payments", paymentRoutes);
  return instance;
}

function authedPost(path: string, body: Record<string, unknown>) {
  return app().request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${buyer.token}`
    },
    body: JSON.stringify(body)
  });
}

function authedGet(path: string) {
  return app().request(path, {
    headers: { Authorization: `Bearer ${buyer.token}` }
  });
}

const BILLING = {
  billingName: "Install Flow Buyer",
  billingEmail: "installflow-buyer@test.local",
  billingAddress: "1 Flow Street",
  billingPostalCode: "90210"
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[install-flow.test] database unreachable — DB suites skipped");
    return;
  }

  const architect = await prisma.user.create({
    data: {
      email: `${RUN}-architect@test.local`,
      role: "ARCHITECT",
      roleMemberships: { create: { role: "ARCHITECT" } },
      architectProfile: { create: {} }
    }
  });
  architectUserId = architect.id;
  createdUserIds.push(architect.id);

  const buyerUser = await prisma.user.create({
    data: {
      email: `${RUN}-buyer@test.local`,
      role: "BUSINESS",
      roleMemberships: { create: { role: "BUSINESS" } }
    }
  });
  createdUserIds.push(buyerUser.id);

  const business = await prisma.business.create({
    data: { ownerId: buyerUser.id, name: `${RUN} biz`, type: "Dental Practice" }
  });

  buyer = {
    userId: buyerUser.id,
    businessId: business.id,
    email: buyerUser.email,
    token: await createAuthToken({
      id: buyerUser.id,
      email: buyerUser.email,
      role: "BUSINESS"
    })
  };

  const workflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId,
      name: `${RUN} workflow`,
      workflowJson: { nodes: [], edges: [] } as never
    }
  });
  createdWorkflowIds.push(workflow.id);

  async function createListing(key: string, data: Record<string, unknown>) {
    const listing = await prisma.agentListing.create({
      data: {
        name: `${RUN} ${key}`,
        shortDescription: "test",
        status: "APPROVED",
        architectUserId,
        workflowId: workflow.id,
        requiredConnectors: [],
        supportedLlms: [],
        tags: [],
        ...data
      } as never
    });
    createdListingIds.push(listing.id);
    return listing.id;
  }

  freeListingId = await createListing("free", { priceCents: 0, pricingModel: "FREE" });
  trialListingId = await createListing("trial", {
    priceCents: 4900,
    pricingModel: "SUBSCRIPTION",
    freeTrialEnabled: true,
    trialDays: 7
  });
  paidListingId = await createListing("paid", { priceCents: 9900, pricingModel: "ONE_TIME" });
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.installedAgent.deleteMany({
      where: { business: { ownerId: { in: createdUserIds } } }
    });
    await prisma.architectEarning.deleteMany({ where: { architectUserId: { in: createdUserIds } } });
    await prisma.payment.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.agentListing.deleteMany({ where: { id: { in: createdListingIds } } });
    await prisma.workflowDefinition.deleteMany({ where: { id: { in: createdWorkflowIds } } });
    await prisma.business.deleteMany({ where: { ownerId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

beforeEach(() => {
  stripeMocks.paymentIntentsCreate.mockReset();
});

describe("free agent installation (DB)", () => {
  it("installs immediately with no Payment record and reuses the install on repeat", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const first = await authedPost("/payments/purchase", {
      listingId: freeListingId,
      paymentMethodId: "free_installation",
      ...BILLING
    });

    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      data?: { free?: boolean; installedAgentId?: string | null; alreadyActive?: boolean };
    };
    expect(firstBody.data?.free).toBe(true);
    expect(firstBody.data?.alreadyActive).toBe(false);
    expect(firstBody.data?.installedAgentId).toBeTruthy();

    // No payment was asked for and none was recorded.
    expect(
      await prisma.payment.count({ where: { userId: buyer.userId, listingId: freeListingId } })
    ).toBe(0);

    const agent = await prisma.installedAgent.findUnique({
      where: { id: firstBody.data?.installedAgentId ?? "" }
    });
    expect(agent?.installSource).toBe("FREE_INSTALL");
    expect(agent?.businessId).toBe(buyer.businessId);

    // Repeated request reuses the same InstalledAgent — no duplicates.
    const second = await authedPost("/payments/purchase", {
      listingId: freeListingId,
      paymentMethodId: "free_installation",
      ...BILLING
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      data?: { installedAgentId?: string | null; alreadyActive?: boolean };
    };
    expect(secondBody.data?.alreadyActive).toBe(true);
    expect(secondBody.data?.installedAgentId).toBe(firstBody.data?.installedAgentId);

    expect(
      await prisma.installedAgent.count({
        where: { businessId: buyer.businessId, listingId: freeListingId }
      })
    ).toBe(1);
  });

  it("listing-access reports the free install as active access (no repeat trial offers)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const response = await authedGet(`/payments/listing-access/${freeListingId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data?: { hasActiveAccess?: boolean; canStartTrial?: boolean; installedAgentId?: string | null };
    };
    expect(body.data?.hasActiveAccess).toBe(true);
    expect(body.data?.canStartTrial).toBe(false);
    expect(body.data?.installedAgentId).toBeTruthy();
  });

  it("shows the free install on My Agents as a valid acquisition", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const response = await authedGet("/payments/my-agents");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data?: {
        agents?: Array<{
          listing: { id: string };
          purchaseStatus: string;
          installedAgentId: string | null;
        }>;
      };
    };
    const entry = body.data?.agents?.find((agent) => agent.listing.id === freeListingId);
    expect(entry).toBeTruthy();
    expect(entry?.purchaseStatus).toBe("SUCCEEDED");
    expect(entry?.installedAgentId).toBeTruthy();
  });
});

describe("free-trial installation (DB)", () => {
  it("starts one trial, auto-installs it, and blocks a second trial forever", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const first = await authedPost("/payments/start-trial", {
      listingId: trialListingId,
      paymentMethodId: "pm_test_trial",
      ...BILLING
    });
    expect(first.status).toBe(201);

    const payments = await prisma.payment.findMany({
      where: { userId: buyer.userId, listingId: trialListingId }
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe("TRIALING");

    // The trial auto-installed the agent with the TRIAL source.
    const agent = await prisma.installedAgent.findFirst({
      where: { businessId: buyer.businessId, listingId: trialListingId }
    });
    expect(agent?.installSource).toBe("TRIAL");

    // Second submit while the trial is active → same payment, no new rows.
    const second = await authedPost("/payments/start-trial", {
      listingId: trialListingId,
      paymentMethodId: "pm_test_trial",
      ...BILLING
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { data?: { alreadyActive?: boolean } };
    expect(secondBody.data?.alreadyActive).toBe(true);
    expect(
      await prisma.payment.count({ where: { userId: buyer.userId, listingId: trialListingId } })
    ).toBe(1);

    // After the trial ends (canceled/expired), a new trial is refused.
    await prisma.payment.updateMany({
      where: { userId: buyer.userId, listingId: trialListingId },
      data: { status: "CANCELED" }
    });

    const third = await authedPost("/payments/start-trial", {
      listingId: trialListingId,
      paymentMethodId: "pm_test_trial",
      ...BILLING
    });
    expect(third.status).toBe(409);
    const thirdBody = (await third.json()) as { code?: string };
    expect(thirdBody.code).toBe("TRIAL_ALREADY_USED");

    expect(
      await prisma.payment.count({ where: { userId: buyer.userId, listingId: trialListingId } })
    ).toBe(1);
  });
});

describe("paid agent installation (DB)", () => {
  it("does not install anything when the charge is incomplete or fails", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    stripeMocks.paymentIntentsCreate.mockResolvedValue({
      id: "pi_test_incomplete",
      status: "requires_payment_method",
      client_secret: "secret_incomplete"
    });

    const response = await authedPost("/payments/purchase", {
      listingId: paidListingId,
      paymentMethodId: "pm_test_paid",
      attemptId: "attempt-incomplete-1",
      ...BILLING
    });

    expect(response.status).toBe(402);
    expect(
      await prisma.payment.count({ where: { userId: buyer.userId, listingId: paidListingId } })
    ).toBe(0);
    expect(
      await prisma.installedAgent.count({
        where: { businessId: buyer.businessId, listingId: paidListingId }
      })
    ).toBe(0);
  });

  it("installs automatically after a confirmed charge; repeated callbacks stay deduplicated", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    stripeMocks.paymentIntentsCreate.mockResolvedValue({
      id: "pi_test_success_1",
      status: "succeeded",
      client_secret: "secret_success"
    });

    const response = await authedPost("/payments/purchase", {
      listingId: paidListingId,
      paymentMethodId: "pm_test_paid",
      attemptId: "attempt-success-1",
      ...BILLING
    });
    expect(response.status).toBe(201);

    const payments = await prisma.payment.findMany({
      where: { userId: buyer.userId, listingId: paidListingId }
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe("SUCCEEDED");
    expect(payments[0]?.stripeSessionId).toBe("pi_test_success_1");

    const agent = await prisma.installedAgent.findFirst({
      where: { businessId: buyer.businessId, listingId: paidListingId }
    });
    expect(agent?.installSource).toBe("MARKETPLACE_PURCHASE");

    // Webhook-style replay of the same PaymentIntent (the backstop path)
    // must not create a second Payment or a second InstalledAgent.
    const replay = await finalizePaidAgentPurchase({
      authUser: { id: buyer.userId, email: buyer.email, fullName: "Install Flow Buyer" },
      listing: { id: paidListingId, name: "paid", priceCents: 9900 },
      businessId: buyer.businessId,
      customerId: "cus_test_install_flow",
      paymentMethodId: "pm_test_paid",
      paymentIntentId: "pi_test_success_1",
      amountCents: 9900,
      billing: null,
      notifyArchitect: false
    });
    expect(replay.alreadyRecorded).toBe(true);

    expect(
      await prisma.payment.count({ where: { userId: buyer.userId, listingId: paidListingId } })
    ).toBe(1);
    expect(
      await prisma.installedAgent.count({
        where: { businessId: buyer.businessId, listingId: paidListingId }
      })
    ).toBe(1);
  });
});
