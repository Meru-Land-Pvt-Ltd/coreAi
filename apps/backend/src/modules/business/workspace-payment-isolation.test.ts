

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { createAuthToken } from "../../lib/jwt";
import { businessRoutes } from "./routes";

const RUN = `wpiso-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let ownerId = "";
let token = "";
let oldBusinessId = "";
let currentBusinessId = "";
let workflowId = "";
let listingId = "";

function app() {
  const instance = new Hono();
  instance.route("/business", businessRoutes);
  return instance;
}

type DashboardBody = {
  data: {
    totalSpendCents: number;
    activities: Array<{ id: string; text: string }>;
  };
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[workspace-payment-isolation.test] database unreachable — suite skipped");
    return;
  }

  const email = `${RUN}-owner@test.local`;
  ownerId = (
    await prisma.user.create({ data: { email, role: "BUSINESS", fullName: "Workspace Owner" } })
  ).id;
  await prisma.userRoleMembership.create({ data: { userId: ownerId, role: "BUSINESS" } });
  token = await createAuthToken({ id: ownerId, email, role: "BUSINESS" });

  // An OLD sibling business (still existing) and the CURRENT workspace.
  oldBusinessId = (
    await prisma.business.create({
      data: {
        ownerId,
        name: `${RUN} old biz`,
        type: "salon",
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    })
  ).id;
  currentBusinessId = (
    await prisma.business.create({
      data: { ownerId, name: `${RUN} current biz`, type: "salon" }
    })
  ).id;

  // Invoices (spend) only count payments carrying a listingId, so every
  // seeded payment gets one — otherwise the spend assertion would pass
  // vacuously even without the workspace filter.
  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, architectUserId: ownerId, workflowJson: { nodes: [], edges: [] } }
    })
  ).id;
  listingId = (
    await prisma.agentListing.create({
      data: {
        name: `${RUN} listing`,
        shortDescription: "workspace isolation test listing",
        status: "APPROVED",
        architectUserId: ownerId,
        workflowId,
        requiredConnectors: [],
        supportedLlms: [],
        tags: []
      },
      select: { id: true }
    })
  ).id;

  await prisma.payment.createMany({
    data: [
      // Exactly what workspace deletion leaves behind: businessId nulled by
      // the cascade, deletion stamped into lineItemsJson.
      {
        userId: ownerId,
        businessId: null,
        listingId,
        amountCents: 4900,
        status: "SUCCEEDED",
        description: `${RUN} deleted-workspace purchase`,
        lineItemsJson: {
          deletedWorkspaceBusinessId: "deleted-biz-id",
          deletedWorkspaceAt: new Date().toISOString()
        }
      },
      // A payment that belongs to ANOTHER business of the same user.
      {
        userId: ownerId,
        businessId: oldBusinessId,
        listingId,
        amountCents: 2900,
        status: "SUCCEEDED",
        description: `${RUN} sibling-business purchase`
      },
      // Legacy row predating the businessId column: null but NOT stamped.
      {
        userId: ownerId,
        businessId: null,
        listingId,
        amountCents: 1900,
        status: "SUCCEEDED",
        description: `${RUN} legacy purchase`
      },
      // The current workspace's own purchase.
      {
        userId: ownerId,
        businessId: currentBusinessId,
        listingId,
        amountCents: 900,
        status: "SUCCEEDED",
        description: `${RUN} current purchase`
      }
    ]
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.payment.deleteMany({ where: { userId: ownerId } });
  await prisma.agentListing.deleteMany({ where: { id: listingId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.business.deleteMany({ where: { ownerId } });
  await prisma.userRoleMembership.deleteMany({ where: { userId: ownerId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe("dashboard workspace payment isolation", () => {
  it("never shows a deleted workspace's or a sibling business's payments as activity or spend", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const response = await app().request("/business/dashboard", {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as DashboardBody;

    const purchaseActivities = body.data.activities.filter((activity) =>
      activity.id.startsWith("purchase-")
    );
    // Only the legacy unstamped row and the current workspace's row survive.
    expect(purchaseActivities).toHaveLength(2);
    // Deleted-workspace and sibling-business purchases are gone…
    expect(body.data.totalSpendCents).toBe(1900 + 900);
  });
});
