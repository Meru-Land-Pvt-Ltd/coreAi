import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { buildInstalledAgentChatTestSetup } from "./deploy";

const RUN = `predeploy-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let ownerId = "";
let businessId = "";
let workflowId = "";
let provisioningAgentId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[pre-deploy-testing.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  ownerId = owner.id;
  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Biz`, type: "salon" } })
  ).id;
  await prisma.businessProfile.create({
    data: { businessId, timeZone: "America/Los_Angeles", calendarId: "primary" }
  });
  workflowId = (
    await prisma.workflowDefinition.create({
      data: {
        name: `${RUN} wf`,
        workflowJson: { nodes: [{ id: "n1", data: { type: "ai.voice_conversation" } }], edges: [] },
        architectUserId: ownerId
      }
    })
  ).id;
  provisioningAgentId = (
    await prisma.installedAgent.create({
      data: { businessId, workflowId, name: `${RUN} agent`, status: "PROVISIONING" }
    })
  ).id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.businessProfile.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("pre-deploy test surfaces", () => {
  it("chat-test setup finds a PROVISIONING agent (Test step runs before Go Live)", async () => {
    if (!dbAvailable) return;

    const setup = await buildInstalledAgentChatTestSetup(businessId);
    expect(setup).not.toBeNull();
    expect(setup!.installedAgentId).toBe(provisioningAgentId);
    expect(setup!.workflowId).toBe(workflowId);
  });

  it("prefers an ACTIVE agent over a PROVISIONING one when both exist", async () => {
    if (!dbAvailable) return;

    const activeAgent = await prisma.installedAgent.create({
      data: { businessId, workflowId, name: `${RUN} active agent`, status: "ACTIVE" }
    });

    try {
      const setup = await buildInstalledAgentChatTestSetup(businessId);
      expect(setup!.installedAgentId).toBe(activeAgent.id);
    } finally {
      await prisma.installedAgent.delete({ where: { id: activeAgent.id } });
    }
  });

  it("paused agents are never testable", async () => {
    if (!dbAvailable) return;

    await prisma.installedAgent.update({
      where: { id: provisioningAgentId },
      data: { status: "PAUSED" }
    });

    try {
      expect(await buildInstalledAgentChatTestSetup(businessId)).toBeNull();
    } finally {
      await prisma.installedAgent.update({
        where: { id: provisioningAgentId },
        data: { status: "PROVISIONING" }
      });
    }
  });
});
