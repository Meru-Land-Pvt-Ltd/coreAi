import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import {
  getBusinessPhoneAssignment,
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
  it("returns the active assignment without any provider cost fields", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const assignment = await getBusinessPhoneAssignment(businessId);
    expect(assignment).not.toBeNull();
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

  it("returns null when the business holds no number", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    expect(await getBusinessPhoneAssignment(emptyBusinessId)).toBeNull();
  });
});

describe("search with an active number", () => {
  it("returns the existing assignment and never purchasable inventory", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const outcome = await searchNumbersForBusiness({
      businessId,
      country: "US",
      state: "CA",
      city: "Los Angeles"
    });

    expect(outcome.numbers).toHaveLength(0);
    expect(outcome.alreadyAssigned?.assigned).toBe(true);
    expect(outcome.alreadyAssigned?.phoneNumber).toBe(heldNumber);

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("feeCents");
    expect(serialized).not.toContain("feeLabel");
  });
});

describe("purchase with an active number", () => {
  it("returns PHONE_NUMBER_ALREADY_ASSIGNED with the existing number and creates nothing", async () => {
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
    expect(outcome.errorCode).toBe("PHONE_NUMBER_ALREADY_ASSIGNED");

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
      expect(outcome.errorCode).toBe("PHONE_NUMBER_ALREADY_ASSIGNED");
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
  it("refuses a second ASSIGNED platform number for the same business", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await expect(
      prisma.platformPhoneNumber.create({
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
      })
    ).rejects.toThrowError();
  });
});
