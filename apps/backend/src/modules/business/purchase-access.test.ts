import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { architectRoutes } from "../architect/routes";
import { paymentRoutes } from "../payments/routes";
import { businessRoutes } from "./routes";
import {
  canBusinessAccessListing,
  canBusinessRunSetup,
  findActiveListingPurchase,
  hasAnyAgentAcquisition,
  resolveActivePayment
} from "./purchase-access";

/**
 * Marketplace purchase-enforcement tests: buyers must not configure, deploy,
 * or test agents they haven't acquired, and architect browser-test endpoints
 * must reject BUSINESS tokens. DB-backed (unique fixtures, removed afterwards,
 * skipped when the database is down); no provider network calls — fetch is
 * stubbed to fail loudly.
 */

const RUN = `purchasetest-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;

const createdUserIds: string[] = [];
const createdBusinessIds: string[] = [];
const createdWorkflowIds: string[] = [];
const createdListingIds: string[] = [];

let buyerA = { userId: "", businessId: "", token: "" };
let buyerB = { userId: "", businessId: "", token: "" };
let architectOwner = { userId: "", token: "" };
let architectOther = { userId: "", token: "" };

let workflowId = "";
let paidListingId = "";
let freeListingId = "";
let unsoldWorkflowId = "";

async function createBuyer(key: string) {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${key}@test.local`, role: "BUSINESS" }
  });
  createdUserIds.push(user.id);

  const business = await prisma.business.create({
    data: { ownerId: user.id, name: `${RUN} ${key}`, type: "Dental Practice" }
  });
  createdBusinessIds.push(business.id);

  const token = await createAuthToken({ id: user.id, email: user.email, role: "BUSINESS" });
  return { userId: user.id, businessId: business.id, token };
}

async function createArchitect(key: string) {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${key}@test.local`, role: "ARCHITECT" }
  });
  createdUserIds.push(user.id);

  const token = await createAuthToken({ id: user.id, email: user.email, role: "ARCHITECT" });
  return { userId: user.id, token };
}

function payment(userId: string, listingId: string, status: string, createdAt?: Date) {
  return prisma.payment.create({
    data: {
      userId,
      listingId,
      amountCents: 4900,
      status: status as never,
      description: `${RUN} ${status} payment`,
      ...(createdAt ? { createdAt } : {})
    }
  });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[purchase-access.test] database unreachable — DB suites skipped");
    return;
  }

  [buyerA, buyerB] = await Promise.all([createBuyer("buyer-a"), createBuyer("buyer-b")]);
  [architectOwner, architectOther] = await Promise.all([
    createArchitect("architect-owner"),
    createArchitect("architect-other")
  ]);

  const workflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: architectOwner.userId,
      name: `${RUN} workflow`,
      workflowJson: { nodes: [], edges: [] } as never
    }
  });
  workflowId = workflow.id;
  createdWorkflowIds.push(workflow.id);

  const unsold = await prisma.workflowDefinition.create({
    data: {
      architectUserId: architectOwner.userId,
      name: `${RUN} unsold workflow`,
      workflowJson: { nodes: [], edges: [] } as never
    }
  });
  unsoldWorkflowId = unsold.id;
  createdWorkflowIds.push(unsold.id);

  const paidListing = await prisma.agentListing.create({
    data: {
      name: `${RUN} paid listing`,
      shortDescription: "test",
      priceCents: 4900,
      status: "APPROVED",
      pricingModel: "ONE_TIME",
      architectUserId: architectOwner.userId,
      workflowId: workflow.id,
      requiredConnectors: [],
      supportedLlms: [],
      tags: []
    }
  });
  paidListingId = paidListing.id;
  createdListingIds.push(paidListing.id);

  const freeListing = await prisma.agentListing.create({
    data: {
      name: `${RUN} free listing`,
      shortDescription: "test",
      priceCents: 0,
      status: "APPROVED",
      pricingModel: "FREE",
      architectUserId: architectOwner.userId,
      workflowId: workflow.id,
      requiredConnectors: [],
      supportedLlms: [],
      tags: []
    }
  });
  freeListingId = freeListing.id;
  createdListingIds.push(freeListing.id);
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.installedAgent.deleteMany({ where: { business: { ownerId: { in: createdUserIds } } } });
    await prisma.payment.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.agentListing.deleteMany({ where: { id: { in: createdListingIds } } });
    await prisma.workflowDefinition.deleteMany({ where: { id: { in: createdWorkflowIds } } });
    await prisma.businessKnowledgeBase.deleteMany({ where: { business: { ownerId: { in: createdUserIds } } } });
    await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
    await prisma.business.deleteMany({ where: { ownerId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (dbAvailable) {
    await prisma.installedAgent.deleteMany({ where: { business: { ownerId: { in: createdUserIds } } } });
    await prisma.payment.deleteMany({ where: { userId: { in: createdUserIds } } });
  }
});

function stubNoNetwork() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network disabled in tests");
    })
  );
}

describe("resolveActivePayment", () => {
  const base = { createdAt: new Date() };

  it("never grants access for PENDING or FAILED payments", () => {
    expect(resolveActivePayment([{ status: "PENDING", ...base } as never])).toBeNull();
    expect(resolveActivePayment([{ status: "FAILED", ...base } as never])).toBeNull();
  });

  it("grants access for SUCCEEDED and fresh TRIALING payments", () => {
    expect(resolveActivePayment([{ status: "SUCCEEDED", ...base } as never])?.status).toBe("SUCCEEDED");
    expect(resolveActivePayment([{ status: "TRIALING", ...base } as never])?.status).toBe("TRIALING");
  });

  it("expires TRIALING payments outside the trial window", () => {
    const stale = { status: "TRIALING", createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) };
    expect(resolveActivePayment([stale as never])).toBeNull();
  });
});

describe("canBusinessAccessListing (DB)", () => {
  it("denies a buyer with no purchase", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const access = await canBusinessAccessListing({ userId: buyerA.userId, listingId: paidListingId });
    expect(access.allowed).toBe(false);
  });

  it("denies PENDING and FAILED payments", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    await payment(buyerA.userId, paidListingId, "PENDING");
    expect((await canBusinessAccessListing({ userId: buyerA.userId, listingId: paidListingId })).allowed).toBe(false);

    await payment(buyerA.userId, paidListingId, "FAILED");
    expect((await canBusinessAccessListing({ userId: buyerA.userId, listingId: paidListingId })).allowed).toBe(false);
  });

  it("allows SUCCEEDED payments (paid and free listings)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    await payment(buyerA.userId, paidListingId, "SUCCEEDED");
    expect((await canBusinessAccessListing({ userId: buyerA.userId, listingId: paidListingId })).allowed).toBe(true);

    await payment(buyerA.userId, freeListingId, "SUCCEEDED");
    expect((await canBusinessAccessListing({ userId: buyerA.userId, listingId: freeListingId })).allowed).toBe(true);
  });

  it("does not let buyer A ride on buyer B's purchase or install", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    await payment(buyerB.userId, paidListingId, "SUCCEEDED");
    await prisma.installedAgent.create({
      data: { businessId: buyerB.businessId, workflowId, listingId: paidListingId, name: "B install" }
    });

    expect((await canBusinessAccessListing({ userId: buyerA.userId, listingId: paidListingId })).allowed).toBe(false);
    expect(await findActiveListingPurchase(buyerA.userId, paidListingId)).toBeNull();
  });

  it("grandfathers an existing install without a payment record (legacy)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    await prisma.installedAgent.create({
      data: { businessId: buyerA.businessId, workflowId, listingId: paidListingId, name: "legacy install" }
    });

    const access = await canBusinessAccessListing({ userId: buyerA.userId, listingId: paidListingId });
    expect(access.allowed).toBe(true);
    expect(access.allowed && access.grandfathered).toBe(true);
  });
});

describe("canBusinessRunSetup (DB)", () => {
  it("denies an unpurchased listing", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const result = await canBusinessRunSetup({
      userId: buyerA.userId,
      requestedListingId: paidListingId
    });
    expect(result).toEqual({ allowed: false, reason: "PURCHASE_REQUIRED" });
  });

  it("denies a raw workflow id that is not sold through a purchased listing", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const result = await canBusinessRunSetup({
      userId: buyerA.userId,
      requestedWorkflowId: unsoldWorkflowId
    });
    expect(result.allowed).toBe(false);
  });

  it("allows a raw workflow id when a purchased listing sells that workflow", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    await payment(buyerA.userId, paidListingId, "SUCCEEDED");
    const result = await canBusinessRunSetup({
      userId: buyerA.userId,
      requestedWorkflowId: workflowId
    });
    expect(result.allowed).toBe(true);
  });

  it("allows managing an already-installed agent", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const result = await canBusinessRunSetup({
      userId: buyerA.userId,
      requestedListingId: paidListingId,
      existingAgent: { listingId: paidListingId, workflowId }
    });
    expect(result.allowed).toBe(true);
  });
});

describe("POST /business/setup purchase gate (DB)", () => {
  function setupApp() {
    const app = new Hono();
    app.route("/business", businessRoutes);
    return app;
  }

  it("rejects an unpurchased listing with PURCHASE_REQUIRED before any deploy work", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    stubNoNetwork();

    const response = await setupApp().request("/business/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${buyerA.token}`
      },
      body: JSON.stringify({
        listingId: paidListingId,
        businessName: `${RUN} Clinic`,
        businessType: "Dental",
        deploy: true
      })
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("PURCHASE_REQUIRED");
  });
});

describe("architect browser-test endpoints (DB)", () => {
  function architectApp() {
    const app = new Hono();
    app.route("/architect", architectRoutes);
    return app;
  }

  function startBrowserTest(token: string, targetWorkflowId: string) {
    return architectApp().request(`/architect/workflows/${targetWorkflowId}/vapi-browser-test/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({})
    });
  }

  it("rejects BUSINESS tokens with ARCHITECT_ACCESS_REQUIRED", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    stubNoNetwork();

    const response = await startBrowserTest(buyerA.token, workflowId);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("ARCHITECT_ACCESS_REQUIRED");
  });

  it("rejects a different architect testing someone else's workflow", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    stubNoNetwork();

    const response = await startBrowserTest(architectOther.token, workflowId);
    expect(response.status).toBe(404);
  });

  it("lets the owning architect past the ownership check", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    stubNoNetwork();

    // The fixture workflow has no voice node, so passing ownership surfaces
    // the next validation error instead of WORKFLOW_NOT_FOUND.
    const response = await startBrowserTest(architectOwner.token, workflowId);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("VOICE_NODE_REQUIRED");
  });
});

describe("duplicate installation protection (DB)", () => {
  it("blocks a second InstalledAgent for the same business + listing", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await prisma.installedAgent.create({
      data: { businessId: buyerA.businessId, workflowId, listingId: paidListingId, name: "first" }
    });

    await expect(
      prisma.installedAgent.create({
        data: { businessId: buyerA.businessId, workflowId, listingId: paidListingId, name: "second" }
      })
    ).rejects.toSatisfy(
      (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    );
  });

  it("still allows multiple NULL-listing sandbox agents per business", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await prisma.installedAgent.create({
      data: { businessId: buyerA.businessId, workflowId, name: "sandbox 1" }
    });
    await expect(
      prisma.installedAgent.create({
        data: { businessId: buyerA.businessId, workflowId, name: "sandbox 2" }
      })
    ).resolves.toBeTruthy();
  });
});

describe("setup test tools require an acquisition (DB)", () => {
  it("hasAnyAgentAcquisition is false without purchase/install/subscription", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    expect(await hasAnyAgentAcquisition(buyerA.userId)).toBe(false);
  });

  it("hasAnyAgentAcquisition turns true with a SUCCEEDED payment", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    await payment(buyerA.userId, paidListingId, "SUCCEEDED");
    expect(await hasAnyAgentAcquisition(buyerA.userId)).toBe(true);
  });

  it("blocks the platform test-SMS sender for unpurchased buyers", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    stubNoNetwork();

    const app = new Hono();
    app.route("/business", businessRoutes);

    const response = await app.request("/business/setup/test-sms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${buyerA.token}`
      },
      body: JSON.stringify({ to: "+15555550123" })
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("PURCHASE_REQUIRED");
  });
});

describe("POST /payments/purchase duplicate protection (DB)", () => {
  function paymentsApp() {
    const app = new Hono();
    app.route("/payments", paymentRoutes);
    return app;
  }

  it("returns the existing purchase instead of charging again (free listing)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    stubNoNetwork();

    await prisma.payment.create({
      data: {
        userId: buyerA.userId,
        businessId: buyerA.businessId,
        listingId: freeListingId,
        amountCents: 0,
        status: "SUCCEEDED",
        description: `${RUN} prior free install`
      }
    });

    const response = await paymentsApp().request("/payments/purchase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${buyerA.token}`
      },
      body: JSON.stringify({
        listingId: freeListingId,
        paymentMethodId: "free_installation",
        billingName: "Test Buyer",
        billingEmail: "buyer@test.local",
        billingAddress: "1 Test Street",
        billingPostalCode: "90210"
      })
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data?: { alreadyActive?: boolean } };
    expect(body.data?.alreadyActive).toBe(true);

    const count = await prisma.payment.count({
      where: { userId: buyerA.userId, listingId: freeListingId }
    });
    expect(count).toBe(1);

    const business = await prisma.business.findUnique({
      where: { id: buyerA.businessId },
      select: { billingName: true, billingAddress: true, billingPostalCode: true }
    });
    expect(business).toMatchObject({
      billingName: "Test Buyer",
      billingAddress: "1 Test Street",
      billingPostalCode: "90210"
    });
  });
});
