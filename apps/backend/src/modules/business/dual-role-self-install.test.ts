import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { getUserRoles, grantRole, mergeRoles, userHasBusinessCapability } from "../../lib/roles";
import { requireRole, type AuthUser } from "../../middleware/auth";
import { authRoutes } from "../auth/routes";
import { resolveLoginUser } from "../auth/role-login";
import { architectRoutes } from "../architect/routes";
import { businessRoutes } from "./routes";
import { canBusinessAccessListing } from "./purchase-access";
import { ensureBusinessAndAgent, loadOwnedListing } from "../setup/routes";

/**
 * Dual-role (ARCHITECT + BUSINESS) and architect self-install tests.
 *
 * Proves: one email/account can hold both roles via UserRoleMembership (no
 * duplicate User rows), architect access survives Business activation,
 * business routes accept membership-based authorization, an architect can
 * self-install their own listing (no payment / earnings / payout), repeat
 * installs reuse the same InstalledAgent, and normal buyers are unaffected.
 *
 * DB-backed like purchase-access.test.ts: unique fixtures, cleaned up
 * afterwards, suites skipped when the database is down.
 */

const RUN = `dualroletest-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;

const createdUserIds: string[] = [];
const createdListingIds: string[] = [];
const createdWorkflowIds: string[] = [];

let architect = { userId: "", email: "", token: "" };
let buyer = { userId: "", businessId: "", email: "", token: "" };

let workflowId = "";
let approvedListingId = "";
let draftListingId = "";

function stubNoNetwork() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network disabled in tests");
    })
  );
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[dual-role-self-install.test] database unreachable — DB suites skipped");
    return;
  }

  const architectUser = await prisma.user.create({
    data: {
      email: `${RUN}-architect@test.local`,
      role: "ARCHITECT",
      roleMemberships: { create: { role: "ARCHITECT" } },
      architectProfile: { create: {} }
    }
  });
  createdUserIds.push(architectUser.id);
  architect = {
    userId: architectUser.id,
    email: architectUser.email,
    token: await createAuthToken({
      id: architectUser.id,
      email: architectUser.email,
      role: "ARCHITECT"
    })
  };

  const buyerUser = await prisma.user.create({
    data: {
      email: `${RUN}-buyer@test.local`,
      role: "BUSINESS",
      roleMemberships: { create: { role: "BUSINESS" } }
    }
  });
  createdUserIds.push(buyerUser.id);
  const buyerBusiness = await prisma.business.create({
    data: { ownerId: buyerUser.id, name: `${RUN} buyer biz`, type: "Dental Practice" }
  });
  buyer = {
    userId: buyerUser.id,
    businessId: buyerBusiness.id,
    email: buyerUser.email,
    token: await createAuthToken({
      id: buyerUser.id,
      email: buyerUser.email,
      role: "BUSINESS"
    })
  };

  const workflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: architect.userId,
      name: `${RUN} workflow`,
      workflowJson: { nodes: [], edges: [] } as never
    }
  });
  workflowId = workflow.id;
  createdWorkflowIds.push(workflow.id);

  const approved = await prisma.agentListing.create({
    data: {
      name: `${RUN} approved listing`,
      shortDescription: "test",
      priceCents: 4900,
      status: "APPROVED",
      pricingModel: "ONE_TIME",
      architectUserId: architect.userId,
      workflowId: workflow.id,
      requiredConnectors: [],
      supportedLlms: [],
      tags: []
    }
  });
  approvedListingId = approved.id;
  createdListingIds.push(approved.id);

  const draft = await prisma.agentListing.create({
    data: {
      name: `${RUN} draft listing`,
      shortDescription: "test",
      priceCents: 4900,
      status: "DRAFT",
      pricingModel: "ONE_TIME",
      architectUserId: architect.userId,
      workflowId: workflow.id,
      requiredConnectors: [],
      supportedLlms: [],
      tags: []
    }
  });
  draftListingId = draft.id;
  createdListingIds.push(draft.id);
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.installedAgent.deleteMany({
      where: { business: { ownerId: { in: createdUserIds } } }
    });
    await prisma.payment.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.agentListing.deleteMany({ where: { id: { in: createdListingIds } } });
    await prisma.workflowDefinition.deleteMany({ where: { id: { in: createdWorkflowIds } } });
    await prisma.business.deleteMany({ where: { ownerId: { in: createdUserIds } } });
    // Memberships + profiles cascade with the user rows.
    await prisma.user.deleteMany({
      where: { email: { in: [architect.email, buyer.email, `${RUN}-fresh@test.local`] } }
    });
  }
  await prisma.$disconnect();
  vi.unstubAllGlobals();
});

describe("mergeRoles / requireRole (pure)", () => {
  const baseUser: AuthUser = {
    id: "u1",
    email: "u1@test.local",
    role: "ARCHITECT",
    roles: ["ARCHITECT", "BUSINESS"],
    fullName: null
  };

  function runGuard(user: AuthUser | undefined, accepted: Parameters<typeof requireRole>[0]) {
    const middleware = requireRole(accepted);
    const json = vi.fn((body: unknown, status?: number) => ({ body, status }));
    const c = {
      get: (key: string) => (key === "authUser" ? user : undefined),
      json
    } as never;
    const next = vi.fn(async () => undefined);
    return middleware(c, next).then(() => ({ next, json }));
  }

  it("merges the legacy role with memberships without duplicates", () => {
    expect(mergeRoles("ARCHITECT", [{ role: "ARCHITECT" }, { role: "BUSINESS" }])).toEqual([
      "ARCHITECT",
      "BUSINESS"
    ]);
  });

  it("lets a dual-role user through a BUSINESS-only guard", async () => {
    const { next } = await runGuard(baseUser, ["BUSINESS"]);
    expect(next).toHaveBeenCalledOnce();
  });

  it("lets a dual-role user keep ARCHITECT access", async () => {
    const { next } = await runGuard(baseUser, ["ARCHITECT"]);
    expect(next).toHaveBeenCalledOnce();
  });

  it("still rejects roles the account does not hold", async () => {
    const { next, json } = await runGuard(baseUser, ["ADMIN"]);
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledOnce();
  });

  it("falls back to the single legacy role for pre-membership sessions", async () => {
    const legacy = { ...baseUser, roles: undefined } as never as AuthUser;
    const { next } = await runGuard(legacy, ["ARCHITECT"]);
    expect(next).toHaveBeenCalledOnce();

    const denied = await runGuard(legacy, ["BUSINESS"]);
    expect(denied.next).not.toHaveBeenCalled();
  });
});

describe("script owner capability check (pure)", () => {
  it("accepts a legacy BUSINESS owner", () => {
    expect(userHasBusinessCapability({ role: "BUSINESS", roleMemberships: [] })).toBe(true);
  });

  it("accepts a dual-role ARCHITECT owner with a BUSINESS membership", () => {
    expect(
      userHasBusinessCapability({
        role: "ARCHITECT",
        roleMemberships: [{ role: "ARCHITECT" }, { role: "BUSINESS" }]
      })
    ).toBe(true);
  });

  it("rejects an ARCHITECT-only owner", () => {
    expect(
      userHasBusinessCapability({ role: "ARCHITECT", roleMemberships: [{ role: "ARCHITECT" }] })
    ).toBe(false);
  });
});

describe("business workspace activation (DB)", () => {
  function authApp() {
    const app = new Hono();
    app.route("/auth", authRoutes);
    return app;
  }

  it("grants BUSINESS to an ARCHITECT without duplicating the email or losing architect access", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const response = await authApp().request("/auth/business-workspace/activate", {
      method: "POST",
      headers: { Authorization: `Bearer ${architect.token}` }
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data?: { roles?: string[] } };
    expect(body.data?.roles).toContain("ARCHITECT");
    expect(body.data?.roles).toContain("BUSINESS");

    // Same email still maps to exactly one User row.
    const rows = await prisma.user.findMany({ where: { email: architect.email } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("ARCHITECT");

    // Activation is idempotent.
    const again = await authApp().request("/auth/business-workspace/activate", {
      method: "POST",
      headers: { Authorization: `Bearer ${architect.token}` }
    });
    expect(again.status).toBe(200);

    const memberships = await prisma.userRoleMembership.findMany({
      where: { userId: architect.userId, role: "BUSINESS" }
    });
    expect(memberships).toHaveLength(1);
  });

  it("keeps architect routes open after activation", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    stubNoNetwork();

    const app = new Hono();
    app.route("/architect", architectRoutes);
    const response = await app.request("/architect/dashboard/activity", {
      headers: { Authorization: `Bearer ${architect.token}` }
    });
    expect(response.status).toBe(200);
  });

  it("opens business routes for the dual-role account (hasRole BUSINESS, not user.role)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    stubNoNetwork();

    const app = new Hono();
    app.route("/business", businessRoutes);
    const response = await app.request("/business/phone-numbers/locations", {
      headers: { Authorization: `Bearer ${architect.token}` }
    });
    expect(response.status).toBe(200);
  });

  it("keeps a single-role BUSINESS buyer out of architect routes", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    stubNoNetwork();

    const app = new Hono();
    app.route("/architect", architectRoutes);
    const response = await app.request("/architect/dashboard/activity", {
      headers: { Authorization: `Bearer ${buyer.token}` }
    });
    expect(response.status).toBe(403);
  });
});

describe("resolveLoginUser email-first resolution (DB)", () => {
  it("reuses the ARCHITECT row for a BUSINESS login instead of duplicating the email", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const { user, isNewUser } = await resolveLoginUser({
      email: architect.email,
      role: "BUSINESS",
      fallbackFullName: "Test Architect",
      allowCreate: true
    });

    expect(isNewUser).toBe(false);
    expect(user?.id).toBe(architect.userId);
    expect(user?.roleMemberships.map((m) => m.role)).toContain("BUSINESS");

    const rows = await prisma.user.findMany({ where: { email: architect.email } });
    expect(rows).toHaveLength(1);
  });

  it("creates exactly one row (with membership) for a brand-new email", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const email = `${RUN}-fresh@test.local`;
    const first = await resolveLoginUser({
      email,
      role: "BUSINESS",
      fallbackFullName: "Fresh Buyer",
      allowCreate: true
    });
    expect(first.isNewUser).toBe(true);
    if (first.user) createdUserIds.push(first.user.id);

    const again = await resolveLoginUser({
      email,
      role: "BUSINESS",
      fallbackFullName: "Fresh Buyer",
      allowCreate: true
    });
    expect(again.isNewUser).toBe(false);
    expect(again.user?.id).toBe(first.user?.id);

    const rows = await prisma.user.findMany({ where: { email } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("BUSINESS");
  });
});

describe("architect self-install (DB)", () => {
  it("entitles the architect to their own APPROVED listing without a purchase", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const access = await canBusinessAccessListing({
      userId: architect.userId,
      listingId: approvedListingId
    });
    expect(access.allowed).toBe(true);
    expect(access.allowed && access.selfTest).toBe(true);
    expect(access.allowed && access.payment).toBeNull();
  });

  it("does not entitle DRAFT listings, even to their owner", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const access = await canBusinessAccessListing({
      userId: architect.userId,
      listingId: draftListingId
    });
    expect(access.allowed).toBe(false);
  });

  it("does not entitle another buyer to the unpurchased listing", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const access = await canBusinessAccessListing({
      userId: buyer.userId,
      listingId: approvedListingId
    });
    expect(access.allowed).toBe(false);
  });

  it("creates a Business + ARCHITECT_SELF_TEST install, reused on repeat, with no payment/earning/payout", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const listing = await loadOwnedListing(architect.userId, approvedListingId);
    expect(listing).not.toBeNull();
    if (!listing) return;

    const first = await ensureBusinessAndAgent({
      ownerId: architect.userId,
      listing,
      businessName: `${RUN} Self Test Biz`
    });

    expect(first.business.ownerId).toBe(architect.userId);
    expect(first.agent).not.toBeNull();
    expect(first.agent?.installSource).toBe("ARCHITECT_SELF_TEST");
    expect(first.agent?.listingId).toBe(approvedListingId);

    // Repeated install returns the same InstalledAgent (unique businessId+listingId).
    const second = await ensureBusinessAndAgent({ ownerId: architect.userId, listing });
    expect(second.agent?.id).toBe(first.agent?.id);
    expect(second.business.id).toBe(first.business.id);

    const installCount = await prisma.installedAgent.count({
      where: { businessId: first.business.id, listingId: approvedListingId }
    });
    expect(installCount).toBe(1);

    // Self-install never touches money: no Stripe payment, no architect
    // earnings, no payout obligations.
    expect(
      await prisma.payment.count({ where: { userId: architect.userId, listingId: approvedListingId } })
    ).toBe(0);
    expect(
      await prisma.architectEarning.count({ where: { architectUserId: architect.userId } })
    ).toBe(0);
    expect(
      await prisma.architectPayout.count({ where: { architectUserId: architect.userId } })
    ).toBe(0);

    // Installing granted the BUSINESS capability on the same account.
    expect(await getUserRoles(architect.userId)).toEqual(
      expect.arrayContaining(["ARCHITECT", "BUSINESS"])
    );

    // The number-assignment script accepts this dual-role owner.
    const owner = await prisma.user.findUnique({
      where: { id: architect.userId },
      select: { role: true, roleMemberships: { select: { role: true } } }
    });
    expect(owner && userHasBusinessCapability(owner)).toBe(true);
  });

  it("still installs normally for a paying buyer (MARKETPLACE_PURCHASE)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await prisma.payment.create({
      data: {
        userId: buyer.userId,
        businessId: buyer.businessId,
        listingId: approvedListingId,
        amountCents: 4900,
        status: "SUCCEEDED",
        description: `${RUN} buyer purchase`
      }
    });

    const listing = await loadOwnedListing(buyer.userId, approvedListingId);
    expect(listing).not.toBeNull();
    if (!listing) return;

    const { business, agent } = await ensureBusinessAndAgent({ ownerId: buyer.userId, listing });
    expect(business.id).toBe(buyer.businessId);
    expect(agent?.installSource).toBe("MARKETPLACE_PURCHASE");
  });
});

describe("grantRole idempotency (DB)", () => {
  it("creates at most one membership row per (user, role)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await grantRole(buyer.userId, "BUSINESS");
    await grantRole(buyer.userId, "BUSINESS");

    const memberships = await prisma.userRoleMembership.findMany({
      where: { userId: buyer.userId, role: "BUSINESS" }
    });
    expect(memberships).toHaveLength(1);
  });
});
