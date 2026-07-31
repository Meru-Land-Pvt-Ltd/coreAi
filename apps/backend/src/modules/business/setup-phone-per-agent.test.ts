import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { businessRoutes } from "./routes";
import { assignPlatformNumber } from "./phone-assignment";

/**
 * QA (2026-07-31): "I have one agent working and I bought one more agent, but on
 * setting up, the number I took for my first agent is showing on the second."
 *
 * The database was already correct — one number per installed agent, enforced by
 * a unique index. The setup ENDPOINT was not: it read the business's first
 * number (`phoneNumbers[0]`) and pre-selected the business's first platform
 * number, so the second agent's wizard displayed the first agent's number and
 * looked already provisioned. These lock the read path to the agent being set up.
 */

const RUN = `setupphone-${process.pid}-${Date.now().toString(36)}`;
const NUM_ONE = `+1555${String(Date.now()).slice(-6)}1`;
const NUM_SPARE = `+1555${String(Date.now()).slice(-6)}2`;

let dbAvailable = false;
let userId = "";
let businessId = "";
let workflowId = "";
let listingOneId = "";
let listingTwoId = "";
let agentOneId = "";
let agentTwoId = "";
let token = "";

function app() {
  const instance = new Hono();
  instance.route("/business", businessRoutes);
  return instance;
}

async function getSetup(listingId?: string) {
  const path = listingId ? `/business/setup?listingId=${listingId}` : "/business/setup";
  const res = await app().request(path, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as {
    data?: {
      phoneNumber?: { phoneNumber?: string | null } | null;
      selectedPlatformPhoneNumberId?: string | null;
      availablePhoneNumbers?: Array<{ phoneNumber: string; selected: boolean; assignedToThisAgent: boolean }>;
    };
  };
  return body.data ?? {};
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[setup-phone-per-agent.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({
    data: {
      email: `${RUN}@test.local`,
      role: "BUSINESS",
      // UserRoleMembership is the auth source — without it the business never resolves.
      roleMemberships: { create: { role: "BUSINESS" } }
    }
  });
  userId = owner.id;
  token = await createAuthToken({ id: owner.id, email: owner.email, role: "BUSINESS" });

  const architect = await prisma.user.create({ data: { email: `${RUN}-arch@test.local`, role: "ARCHITECT" } });
  workflowId = (
    await prisma.workflowDefinition.create({
      data: { architectUserId: architect.id, name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] } as never }
    })
  ).id;

  listingOneId = (
    await prisma.agentListing.create({
      data: { architectUserId: architect.id, workflowId, name: `${RUN} One`, shortDescription: "test", status: "APPROVED", priceCents: 0 }
    })
  ).id;
  listingTwoId = (
    await prisma.agentListing.create({
      data: { architectUserId: architect.id, workflowId, name: `${RUN} Two`, shortDescription: "test", status: "APPROVED", priceCents: 0 }
    })
  ).id;

  businessId = (await prisma.business.create({ data: { ownerId: userId, name: `${RUN} Clinic`, type: "dental" } })).id;

  agentOneId = (
    await prisma.installedAgent.create({
      data: { businessId, workflowId, listingId: listingOneId, name: "Agent One", status: "ACTIVE" }
    })
  ).id;
  agentTwoId = (
    await prisma.installedAgent.create({
      data: { businessId, workflowId, listingId: listingTwoId, name: "Agent Two", status: "ACTIVE" }
    })
  ).id;

  for (const phoneNumber of [NUM_ONE, NUM_SPARE]) {
    await prisma.platformPhoneNumber.create({
      data: {
        phoneNumber,
        e164: phoneNumber,
        provider: "TWILIO",
        status: "AVAILABLE",
        voiceEnabled: true,
        smsEnabled: true
      }
    });
  }

  // Agent One completes setup and locks NUM_ONE to itself.
  const platform = await prisma.platformPhoneNumber.findUniqueOrThrow({ where: { phoneNumber: NUM_ONE } });
  await prisma.$transaction((tx) =>
    assignPlatformNumber(tx, {
      platform,
      businessId,
      installedAgentId: agentOneId,
      buyerUserId: userId,
      forwardToPhone: null
    })
  );
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.businessPhoneNumber.deleteMany({ where: { businessId } });
    await prisma.platformPhoneNumber.deleteMany({ where: { phoneNumber: { in: [NUM_ONE, NUM_SPARE] } } });
    await prisma.installedAgent.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.agentListing.deleteMany({ where: { id: { in: [listingOneId, listingTwoId] } } });
    await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  }
  await prisma.$disconnect();
});

describe("setup shows each agent its OWN number", () => {
  it("the first agent sees the number it locked", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const setup = await getSetup(listingOneId);
    expect(setup.phoneNumber?.phoneNumber).toBe(NUM_ONE);
  });

  it("the second agent does NOT inherit the first agent's number", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const setup = await getSetup(listingTwoId);
    // The exact reported bug: this used to come back as NUM_ONE.
    expect(setup.phoneNumber).toBeFalsy();
  });

  it("the second agent's picker pre-selects nothing owned by the first agent", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const setup = await getSetup(listingTwoId);
    const selected = setup.availablePhoneNumbers?.find((row) => row.selected) ?? null;

    expect(selected?.phoneNumber).not.toBe(NUM_ONE);
    expect(setup.selectedPlatformPhoneNumberId ?? null).toBeNull();
  });

  it("the first agent's number is marked as belonging to another agent", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const setup = await getSetup(listingTwoId);
    const first = setup.availablePhoneNumbers?.find((row) => row.phoneNumber === NUM_ONE);

    // Visible (so the buyer understands it is taken) but never claimed by agent two.
    expect(first?.assignedToThisAgent).toBe(false);
  });

  it("a free number is still offered to the second agent", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const setup = await getSetup(listingTwoId);
    const spare = setup.availablePhoneNumbers?.find((row) => row.phoneNumber === NUM_SPARE);

    expect(spare).toBeTruthy();
    expect(spare?.assignedToThisAgent).toBe(false);
  });
});
