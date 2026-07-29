import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { assignPlatformNumber } from "./phone-assignment";
import {
  getAgentPhoneAssignment,
  listBusinessPhoneAssignments,
  listUnassignedBusinessNumbers
} from "./phone-provisioning-flow";

/**
 * The buyer-facing scenario, end to end:
 *
 *   Buyer A buys Agent A   -> number 1, assistant 1
 *   Buyer B buys Agent A   -> number 2, assistant 2   (same product, nothing shared)
 *   Buyer A buys Agent B   -> number 3, assistant 3   (own buyer, still nothing shared)
 *
 * Every number locks to exactly one installed agent and cannot be reused.
 */

const RUN = `oneper-${process.pid}-${Date.now().toString(36)}`;
const numberFor = (n: number) => `+1555${String(Date.now()).slice(-6)}${n}`;

let dbAvailable = false;
let ownerAId = "";
let ownerBId = "";
let businessAId = "";
let businessBId = "";
let workflowId = "";
let agentA1 = "";
let agentA2 = "";
let agentB1 = "";

const num1 = numberFor(1);
const num2 = numberFor(2);
const num3 = numberFor(3);

async function makeNumber(phoneNumber: string) {
  return prisma.platformPhoneNumber.create({
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

/** What the buyer does at the end of setup: lock this number to this agent. */
async function claim(phoneNumber: string, businessId: string, installedAgentId: string, buyerUserId: string) {
  const platform = await prisma.platformPhoneNumber.findUniqueOrThrow({ where: { phoneNumber } });
  return prisma.$transaction((tx) =>
    assignPlatformNumber(tx, { platform, businessId, installedAgentId, buyerUserId, forwardToPhone: null })
  );
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[one-number-per-agent.test] database unreachable — suite skipped");
    return;
  }

  const ownerA = await prisma.user.create({ data: { email: `${RUN}-a@test.local`, role: "BUSINESS" } });
  const ownerB = await prisma.user.create({ data: { email: `${RUN}-b@test.local`, role: "BUSINESS" } });
  ownerAId = ownerA.id;
  ownerBId = ownerB.id;

  const architect = await prisma.user.create({ data: { email: `${RUN}-arch@test.local`, role: "ARCHITECT" } });
  workflowId = (
    await prisma.workflowDefinition.create({
      data: { architectUserId: architect.id, name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] } as never }
    })
  ).id;

  businessAId = (await prisma.business.create({ data: { ownerId: ownerAId, name: `${RUN} A`, type: "dental" } })).id;
  businessBId = (await prisma.business.create({ data: { ownerId: ownerBId, name: `${RUN} B`, type: "dental" } })).id;

  // Buyer A installs Agent A; Buyer B installs the same Agent A; Buyer A adds Agent B.
  agentA1 = (await prisma.installedAgent.create({ data: { businessId: businessAId, workflowId, name: "Agent A", status: "ACTIVE" } })).id;
  agentB1 = (await prisma.installedAgent.create({ data: { businessId: businessBId, workflowId, name: "Agent A", status: "ACTIVE" } })).id;
  agentA2 = (await prisma.installedAgent.create({ data: { businessId: businessAId, workflowId, name: "Agent B", status: "ACTIVE" } })).id;

  await Promise.all([makeNumber(num1), makeNumber(num2), makeNumber(num3)]);
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.businessPhoneNumber.deleteMany({ where: { businessId: { in: [businessAId, businessBId] } } });
    await prisma.platformPhoneNumber.deleteMany({ where: { phoneNumber: { in: [num1, num2, num3] } } });
    await prisma.installedAgent.deleteMany({ where: { businessId: { in: [businessAId, businessBId] } } });
    await prisma.business.deleteMany({ where: { id: { in: [businessAId, businessBId] } } });
    await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  }
  await prisma.$disconnect();
});

describe("two buyers of the same agent", () => {
  it("each get their own number — nothing is shared", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await claim(num1, businessAId, agentA1, ownerAId);
    await claim(num2, businessBId, agentB1, ownerBId);

    expect((await getAgentPhoneAssignment(businessAId, agentA1))?.phoneNumber).toBe(num1);
    expect((await getAgentPhoneAssignment(businessBId, agentB1))?.phoneNumber).toBe(num2);
  });
});

describe("the same buyer installing a second agent", () => {
  it("starts with no number — the first agent's number is not offered", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    expect(await getAgentPhoneAssignment(businessAId, agentA2)).toBeNull();
    // Buyer A owns num1, but it is locked to Agent A, so nothing is free.
    expect(await listUnassignedBusinessNumbers(businessAId)).toEqual([]);
  });

  it("gets a second number of its own, and the business now holds two", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await claim(num3, businessAId, agentA2, ownerAId);

    expect((await getAgentPhoneAssignment(businessAId, agentA2))?.phoneNumber).toBe(num3);
    // The first agent kept its own number.
    expect((await getAgentPhoneAssignment(businessAId, agentA1))?.phoneNumber).toBe(num1);

    const owned = (await listBusinessPhoneAssignments(businessAId)).map((n) => n.phoneNumber).sort();
    expect(owned).toEqual([num1, num3].sort());
  });
});

describe("the lock", () => {
  it("refuses to give one agent a second number", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await expect(
      prisma.businessPhoneNumber.create({
        data: { businessId: businessAId, installedAgentId: agentA1, phoneNumber: num3, isActive: true }
      })
    ).rejects.toThrowError();
  });

  it("refuses to give one number to a second agent", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    // num1 belongs to Agent A; Agent B may not take it.
    const platform = await prisma.platformPhoneNumber.findUniqueOrThrow({ where: { phoneNumber: num1 } });
    await expect(
      prisma.$transaction((tx) =>
        assignPlatformNumber(tx, {
          platform,
          businessId: businessAId,
          installedAgentId: agentA2,
          buyerUserId: ownerAId,
          forwardToPhone: null
        })
      )
    ).rejects.toThrowError();

    // Agent A still has it.
    expect((await getAgentPhoneAssignment(businessAId, agentA1))?.phoneNumber).toBe(num1);
  });
});

describe("each agent's own Vapi assistant", () => {
  it("keeps two agents of one buyer on separate assistants", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await prisma.installedAgent.update({
      where: { id: agentA1 },
      data: { configJson: { vapiAssistantId: "assistant-for-agent-a" } }
    });
    await prisma.installedAgent.update({
      where: { id: agentA2 },
      data: { configJson: { vapiAssistantId: "assistant-for-agent-b" } }
    });

    const [a1, a2] = await Promise.all([
      prisma.installedAgent.findUniqueOrThrow({ where: { id: agentA1 }, select: { configJson: true } }),
      prisma.installedAgent.findUniqueOrThrow({ where: { id: agentA2 }, select: { configJson: true } })
    ]);

    const idOf = (config: unknown) => (config as { vapiAssistantId?: string })?.vapiAssistantId;
    expect(idOf(a1.configJson)).toBe("assistant-for-agent-a");
    expect(idOf(a2.configJson)).toBe("assistant-for-agent-b");
    expect(idOf(a1.configJson)).not.toBe(idOf(a2.configJson));
  });

  it("keeps two BUYERS of the same agent on separate assistants", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    // agentA1 and agentB1 are the SAME product installed by different buyers.
    await prisma.installedAgent.update({
      where: { id: agentB1 },
      data: { configJson: { vapiAssistantId: "assistant-for-buyer-b" } }
    });

    const [mine, theirs] = await Promise.all([
      prisma.installedAgent.findUniqueOrThrow({ where: { id: agentA1 }, select: { businessId: true, configJson: true } }),
      prisma.installedAgent.findUniqueOrThrow({ where: { id: agentB1 }, select: { businessId: true, configJson: true } })
    ]);

    const idOf = (config: unknown) => (config as { vapiAssistantId?: string })?.vapiAssistantId;
    expect(mine.businessId).not.toBe(theirs.businessId);
    expect(idOf(mine.configJson)).toBe("assistant-for-agent-a");
    expect(idOf(theirs.configJson)).toBe("assistant-for-buyer-b");
    expect(idOf(mine.configJson)).not.toBe(idOf(theirs.configJson));
  });
});
