import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { businessRoutes } from "./routes";

/**
 * Buyer account deletion must actually erase the account: the User row and
 * every cascaded business record go away, and the dedicated platform number
 * returns to the AVAILABLE pool (PlatformPhoneNumber has no FK, so this is
 * explicit cleanup). Runs against the local dev database; skipped when down.
 */

const RUN = `deltest-${process.pid}-${Date.now().toString(36)}`;
const buyerNumber = `+1782${String(Date.now()).slice(-7)}`;

let dbAvailable = false;
let ownerId = "";
let ownerToken = "";
let businessId = "";
let platformNumberId = "";
let bystanderUserId = "";
let bystanderBusinessId = "";

function buildApp() {
  const app = new Hono();
  app.route("/business", businessRoutes);
  return app;
}

function postDelete(app: Hono, token: string, confirmation: string) {
  return app.request("/business/settings/danger/delete-account", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ confirmation })
  });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[delete-account.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({
    data: { email: `${RUN}-owner@test.local`, role: "BUSINESS", fullName: "Delete Me" }
  });
  ownerId = owner.id;
  ownerToken = await createAuthToken({ id: owner.id, email: owner.email, role: "BUSINESS" });

  const business = await prisma.business.create({
    data: {
      ownerId,
      name: `${RUN} Clinic`,
      type: "Dental Practice",
      billingAddress: "42 Test Street",
      profile: { create: { services: ["Cleaning"], teamPhone: "+15550001111" } }
    }
  });
  businessId = business.id;

  const workflow = await prisma.workflowDefinition.create({
    data: { architectUserId: ownerId, name: `${RUN} workflow`, workflowJson: { nodes: [], edges: [] } as never }
  });
  const agent = await prisma.installedAgent.create({
    data: { businessId, workflowId: workflow.id, name: `${RUN} agent`, status: "ACTIVE" }
  });

  const platform = await prisma.platformPhoneNumber.create({
    data: {
      phoneNumber: buyerNumber,
      e164: buyerNumber,
      provider: "TWILIO",
      status: "ASSIGNED",
      businessId,
      buyerUserId: ownerId,
      installedAgentId: agent.id,
      assignedAt: new Date(),
      feeBilledAt: new Date()
    }
  });
  platformNumberId = platform.id;

  await prisma.businessPhoneNumber.create({
    data: { businessId, installedAgentId: agent.id, phoneNumber: buyerNumber, isActive: true }
  });

  await prisma.conversation.create({
    data: { businessId, channel: "SMS", customerPhone: "+15557654321" }
  });

  // An unrelated buyer that must be completely untouched by the deletion.
  const bystander = await prisma.user.create({
    data: { email: `${RUN}-bystander@test.local`, role: "BUSINESS" }
  });
  bystanderUserId = bystander.id;
  const bystanderBusiness = await prisma.business.create({
    data: { ownerId: bystander.id, name: `${RUN} Other`, type: "salon" }
  });
  bystanderBusinessId = bystanderBusiness.id;
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.platformPhoneNumber.deleteMany({ where: { phoneNumber: buyerNumber } });
    await prisma.businessPhoneNumber.deleteMany({ where: { phoneNumber: buyerNumber } });
    await prisma.business.deleteMany({ where: { id: { in: [businessId, bystanderBusinessId] } } });
    await prisma.workflowDefinition.deleteMany({ where: { name: `${RUN} workflow` } });
    await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  }
  await prisma.$disconnect();
});

describe("buyer account deletion", () => {
  it("rejects a wrong confirmation and deletes nothing", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const response = await postDelete(buildApp(), ownerToken, "delete");
    expect(response.status).toBe(422);
    expect(await prisma.user.findUnique({ where: { id: ownerId } })).not.toBeNull();
  });

  it("erases the account, all business data, and frees the platform number", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const response = await postDelete(buildApp(), ownerToken, "DELETE");
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data?: { deleted?: boolean } };
    expect(json.data?.deleted).toBe(true);

    // The user and every cascaded business record are gone.
    expect(await prisma.user.findUnique({ where: { id: ownerId } })).toBeNull();
    expect(await prisma.business.findUnique({ where: { id: businessId } })).toBeNull();
    expect(await prisma.businessProfile.findUnique({ where: { businessId } })).toBeNull();
    expect(await prisma.installedAgent.findFirst({ where: { businessId } })).toBeNull();
    expect(await prisma.conversation.findFirst({ where: { businessId } })).toBeNull();
    expect(await prisma.businessPhoneNumber.findUnique({ where: { phoneNumber: buyerNumber } })).toBeNull();

    // The dedicated number is back in inventory with all links cleared.
    const number = await prisma.platformPhoneNumber.findUnique({ where: { id: platformNumberId } });
    expect(number?.status).toBe("AVAILABLE");
    expect(number?.businessId).toBeNull();
    expect(number?.buyerUserId).toBeNull();
    expect(number?.installedAgentId).toBeNull();
    expect(number?.feeBilledAt).toBeNull();

    // The deleted token no longer authenticates.
    const replay = await postDelete(buildApp(), ownerToken, "DELETE");
    expect(replay.status).toBe(401);

    // Unrelated buyers are untouched.
    expect(await prisma.user.findUnique({ where: { id: bystanderUserId } })).not.toBeNull();
    expect(await prisma.business.findUnique({ where: { id: bystanderBusinessId } })).not.toBeNull();
  });
});
