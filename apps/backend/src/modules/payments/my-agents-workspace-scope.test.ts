import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { deleteUserWorkspace } from "../auth/workspace-deletion";
import { paymentRoutes } from "./routes";

/**
 * Deleting a business workspace does NOT delete the buyer's purchases:
 * Payment.userId cascades from User, but businessId is a plain column. So a
 * buyer who deletes their business and creates a new one used to see the old
 * workspace's agents reappear — shown as "Suspended", with no installed agent
 * behind them.
 */

const RUN = `wsscope-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let userId = "";
let token = "";
let oldBusinessId = "";
let newBusinessId = "";
let listingId = "";
let architectId = "";

function app() {
  const hono = new Hono();
  hono.route("/payments", paymentRoutes);
  return hono;
}

async function myAgents() {
  const res = await app().request("/payments/my-agents", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = (await res.json()) as { data?: { agents?: Array<{ listing?: { id: string } }> } };
  return body.data?.agents ?? [];
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[my-agents-workspace-scope.test] database unreachable — suite skipped");
    return;
  }

  const user = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  userId = user.id;
  await prisma.userRoleMembership.create({ data: { userId, role: "BUSINESS" } });
  token = await createAuthToken({ id: userId, email: user.email, role: "BUSINESS" });

  const architect = await prisma.user.create({ data: { email: `${RUN}-arch@test.local`, role: "ARCHITECT" } });
  architectId = architect.id;
  const workflow = await prisma.workflowDefinition.create({
    data: { architectUserId: architectId, name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] } as never }
  });
  listingId = (
    await prisma.agentListing.create({
      data: {
        name: `${RUN} Listing`,
        shortDescription: "test",
        architectUserId: architectId,
        workflowId: workflow.id,
        priceCents: 19900,
        status: "APPROVED",
        requiredConnectors: [],
        supportedLlms: [],
        tags: []
      }
    })
  ).id;

  oldBusinessId = (await prisma.business.create({ data: { ownerId: userId, name: `${RUN} old`, type: "dental" } })).id;

  // The purchase the buyer made in the workspace they later deleted.
  await prisma.payment.create({
    data: {
      userId,
      businessId: oldBusinessId,
      listingId,
      amountCents: 19900,
      status: "SUCCEEDED",
      stripeSessionId: `pi_${RUN}`
    }
  });
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.payment.deleteMany({ where: { userId } });
    await prisma.business.deleteMany({ where: { ownerId: userId } });
    await prisma.agentListing.deleteMany({ where: { id: listingId } });
    await prisma.workflowDefinition.deleteMany({ where: { architectUserId: architectId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, architectId] } } });
  }
  await prisma.$disconnect();
});

describe("suspended purchases", () => {
  it("never appear in My Agents", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    // Same workspace, still intact — only the payment status is bad.
    await prisma.payment.updateMany({ where: { userId }, data: { status: "CANCELED" } });
    expect((await myAgents()).map((a) => a.listing?.id)).not.toContain(listingId);

    await prisma.payment.updateMany({ where: { userId }, data: { status: "FAILED" } });
    expect((await myAgents()).map((a) => a.listing?.id)).not.toContain(listingId);

    // Restored for the workspace-scope tests below.
    await prisma.payment.updateMany({ where: { userId }, data: { status: "SUCCEEDED" } });
  });
});

describe("My Agents after deleting and recreating a business", () => {
  it("lists the purchase while its business still exists", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const agents = await myAgents();
    expect(agents.map((a) => a.listing?.id)).toContain(listingId);
  });

  it("does not carry the old workspace's agents into a new business", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    // Delete the workspace the way the product does, then create a fresh
    // business exactly as the buyer would. Keep an ARCHITECT membership so the
    // User row survives — that is when purchases outlive the workspace.
    await prisma.userRoleMembership.create({ data: { userId, role: "ARCHITECT" } });
    await deleteUserWorkspace(userId, "BUSINESS");
    newBusinessId = (
      await prisma.business.create({ data: { ownerId: userId, name: `${RUN} new`, type: "dental" } })
    ).id;

    // The FK nulls businessId, so the stamp is what remembers the orphaning.
    const orphan = await prisma.payment.findFirst({
      where: { userId },
      select: { businessId: true, lineItemsJson: true }
    });
    expect(orphan?.businessId).toBeNull();
    expect((orphan?.lineItemsJson as Record<string, unknown>)?.deletedWorkspaceBusinessId).toBe(oldBusinessId);

    const agents = await myAgents();
    expect(agents.map((a) => a.listing?.id)).not.toContain(listingId);
    expect(newBusinessId).toBeTruthy();
  });
});
