import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import {
  getAgentPhoneAssignment,
  listBusinessPhoneAssignments,
  listUnassignedBusinessNumbers,
  purchaseNumberForBusiness,
  searchNumbersForBusiness
} from "./phone-provisioning-flow";

/**
 * One-active-number enforcement + buyer-safe responses. Integration tests
 * against the local dev database (fixtures unique per run, deleted afterwards,
 * suite skipped when the DB is unreachable). No Twilio calls are made — every
 * asserted path returns before the provider request.
 */

const RUN = `oneno-${process.pid}-${Date.now().toString(36)}`;
const heldNumber = `+1778${String(Date.now()).slice(-7)}`;
const secondNumber = `+1777${String(Date.now()).slice(-7)}`;

let dbAvailable = false;
let ownerId = "";
let businessId = "";
let emptyBusinessId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[phone-assignment-guard.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  ownerId = owner.id;
  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Biz`, type: "salon" } })
  ).id;
  emptyBusinessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Empty`, type: "gym" } })
  ).id;

  await prisma.platformPhoneNumber.create({
    data: {
      phoneNumber: heldNumber,
      e164: heldNumber,
      provider: "TWILIO",
      status: "ASSIGNED",
      businessId,
      buyerUserId: ownerId,
      country: "US",
      region: "CA",
      locality: "Los Angeles",
      voiceEnabled: true,
      smsEnabled: true,
      assignedAt: new Date()
    }
  });
});

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.phoneProvisioningRequest.deleteMany({ where: { businessId: { in: [businessId, emptyBusinessId] } } });
  await prisma.platformPhoneNumber.deleteMany({ where: { phoneNumber: { in: [heldNumber, secondNumber] } } });
  await prisma.business.deleteMany({ where: { id: { in: [businessId, emptyBusinessId] } } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("GET assignment shape", () => {
  it("returns the owned number without any provider cost fields", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const [assignment] = await listBusinessPhoneAssignments(businessId);
    expect(assignment).toBeTruthy();
    expect(assignment?.phoneNumber).toBe(heldNumber);
    expect(assignment?.status).toBe("ACTIVE");
    expect(assignment?.capabilities).toEqual({ voice: true, sms: true });
    expect(assignment?.locality).toBe("Los Angeles");
    expect(assignment?.assignedAt).toBeTruthy();

    const serialized = JSON.stringify(assignment);
    for (const forbidden of ["feeCents", "feeLabel", "providerCost", "twilioPrice", "amountCents"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns nothing when the business holds no number", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    expect(await listBusinessPhoneAssignments(emptyBusinessId)).toEqual([]);
    expect(await listUnassignedBusinessNumbers(emptyBusinessId)).toEqual([]);
  });

  it("reports an owned-but-unlocked number as available to assign", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    // Owned, no agent link yet — the buyer must use this before buying more.
    const free = await listUnassignedBusinessNumbers(businessId);
    expect(free.map((n) => n.phoneNumber)).toContain(heldNumber);
  });
});

describe("search while the business owns an unassigned number", () => {
  it("offers the owned number to assign and never purchasable inventory", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const outcome = await searchNumbersForBusiness({
      businessId,
      country: "US",
      state: "CA",
      city: "Los Angeles"
    });

    expect(outcome.numbers).toHaveLength(0);
    expect(outcome.availableToAssign?.map((n) => n.phoneNumber)).toContain(heldNumber);

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("feeCents");
    expect(serialized).not.toContain("feeLabel");
  });
});

describe("purchase while an owned number is unassigned", () => {
  it("returns UNASSIGNED_NUMBER_AVAILABLE with that number and creates nothing", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const outcome = await purchaseNumberForBusiness({
      businessId,
      requestedByUserId: ownerId,
      clientRequestId: `${RUN}-again-1`,
      phoneNumber: "+15550004444",
      country: "US",
      state: "CA",
      city: "Los Angeles"
    });

    expect(outcome.status).toBe("ACTIVE");
    expect(outcome.alreadyCompleted).toBe(true);
    expect(outcome.phoneNumber).toBe(heldNumber);
    expect(outcome.errorCode).toBe("UNASSIGNED_NUMBER_AVAILABLE");

    const requests = await prisma.phoneProvisioningRequest.count({
      where: { businessId, clientRequestId: `${RUN}-again-1` }
    });
    expect(requests).toBe(0);
  });

  it("two concurrent attempts both return the existing assignment and create zero requests", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const [first, second] = await Promise.all([
      purchaseNumberForBusiness({
        businessId,
        requestedByUserId: ownerId,
        clientRequestId: `${RUN}-race-a`,
        phoneNumber: "+15550005555",
        country: "US",
        state: "CA",
        city: "Los Angeles"
      }),
      purchaseNumberForBusiness({
        businessId,
        requestedByUserId: ownerId,
        clientRequestId: `${RUN}-race-b`,
        phoneNumber: "+15550006666",
        country: "US",
        state: "CA",
        city: "Los Angeles"
      })
    ]);

    for (const outcome of [first, second]) {
      expect(outcome.phoneNumber).toBe(heldNumber);
      expect(outcome.errorCode).toBe("UNASSIGNED_NUMBER_AVAILABLE");
    }

    const requests = await prisma.phoneProvisioningRequest.count({
      where: { businessId, clientRequestId: { in: [`${RUN}-race-a`, `${RUN}-race-b`] } }
    });
    expect(requests).toBe(0);
  });
});

describe("in-flight provisioning guard", () => {
  it("rejects a second purchase while another request is still provisioning", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await prisma.phoneProvisioningRequest.create({
      data: {
        businessId: emptyBusinessId,
        requestedByUserId: ownerId,
        clientRequestId: `${RUN}-inflight-1`,
        status: "PURCHASE_PENDING",
        requestedCountry: "US",
        requestedRegion: "CA",
        requestedLocality: "Los Angeles",
        selectedPhoneNumber: "+15550007777"
      }
    });

    await expect(
      purchaseNumberForBusiness({
        businessId: emptyBusinessId,
        requestedByUserId: ownerId,
        clientRequestId: `${RUN}-inflight-2`,
        phoneNumber: "+15550008888",
        country: "US",
        state: "CA",
        city: "Los Angeles"
      })
    ).rejects.toMatchObject({ code: "PROVISIONING_IN_PROGRESS" });
  });
});

describe("database constraint", () => {
  it("allows a business to own a second number (one per agent)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    // The old rule capped a business at one ASSIGNED number. Agents each need
    // their own, so a second number for the same business must be allowed.
    const second = await prisma.platformPhoneNumber.create({
      data: {
        phoneNumber: secondNumber,
        e164: secondNumber,
        provider: "TWILIO",
        status: "ASSIGNED",
        businessId,
        buyerUserId: ownerId,
        voiceEnabled: true,
        smsEnabled: true,
        assignedAt: new Date()
      }
    });
    expect(second.businessId).toBe(businessId);
  });

  it("refuses to lock one agent to two numbers", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const workflow = await prisma.workflowDefinition.findFirst({ select: { id: true } });
    if (!workflow) return; // no workflow fixture in this database — nothing to bind an agent to

    const agent = await prisma.installedAgent.create({
      data: { businessId, workflowId: workflow.id, name: `${RUN} agent`, status: "ACTIVE" }
    });

    await prisma.businessPhoneNumber.create({
      data: { businessId, installedAgentId: agent.id, phoneNumber: heldNumber, isActive: true }
    });

    // The partial unique index is the lock — a second active mapping for the
    // same agent must be impossible, not merely discouraged.
    await expect(
      prisma.businessPhoneNumber.create({
        data: { businessId, installedAgentId: agent.id, phoneNumber: secondNumber, isActive: true }
      })
    ).rejects.toThrowError();

    await prisma.businessPhoneNumber.deleteMany({ where: { businessId } });
    await prisma.installedAgent.deleteMany({ where: { id: agent.id } });
  });
});
