import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { PhoneNumberServiceError } from "../admin/twilio-number-service";
import { assignPlatformNumber } from "./phone-assignment";
import { claimAvailableInventoryNumber, findBuyerPlatformNumber } from "./phone-provisioning";

/**
 * Integration tests against the local dev database — the reserved shared
 * Triven SMS sender must never reach a buyer through any assignment path.
 * Fixtures are unique per run and deleted afterwards; skipped when the DB is
 * unreachable (same convention as the email integration suite).
 */

const RUN = `phonetest-${process.pid}-${Date.now().toString(36)}`;
const sharedNumber = `+1777${String(Date.now()).slice(-7)}`;
const normalNumber = `+1778${String(Date.now()).slice(-7)}`;

let dbAvailable = false;
let buyerUserId = "";
let businessId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[phone-provisioning.test] database unreachable — suite skipped");
    return;
  }

  const buyer = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  buyerUserId = buyer.id;
  const business = await prisma.business.create({
    data: { ownerId: buyerUserId, name: `${RUN} Biz`, type: "salon" }
  });
  businessId = business.id;

  // The reserved shared sender is intentionally OLDER than the normal number,
  // so a naive oldest-first claim would pick it if the guard were missing.
  await prisma.platformPhoneNumber.create({
    data: {
      phoneNumber: sharedNumber,
      e164: sharedNumber,
      provider: "TWILIO",
      status: "AVAILABLE",
      voiceEnabled: true,
      smsEnabled: true,
      isPlatformSmsSender: true,
      createdAt: new Date(Date.now() - 60 * 60 * 1000)
    }
  });
  await prisma.platformPhoneNumber.create({
    data: {
      phoneNumber: normalNumber,
      e164: normalNumber,
      provider: "TWILIO",
      status: "AVAILABLE",
      voiceEnabled: true,
      smsEnabled: true,
      isPlatformSmsSender: false
    }
  });
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.businessPhoneNumber.deleteMany({ where: { phoneNumber: { in: [sharedNumber, normalNumber] } } });
    await prisma.platformPhoneNumber.deleteMany({ where: { phoneNumber: { in: [sharedNumber, normalNumber] } } });
    if (businessId) await prisma.business.deleteMany({ where: { id: businessId } });
    if (buyerUserId) await prisma.user.deleteMany({ where: { id: buyerUserId } });
  }
  await prisma.$disconnect();
});

describe("shared SMS sender protection", () => {
  it("inventory claiming skips the shared sender and buyer voice provisioning still works", async () => {
    if (!dbAvailable) return;

    const claimed = await claimAvailableInventoryNumber({
      buyerUserId,
      businessId,
      installedAgentId: null
    });

    expect(claimed?.phoneNumber).not.toBe(sharedNumber);
    expect(claimed?.isPlatformSmsSender).toBe(false);

    const shared = await prisma.platformPhoneNumber.findUnique({ where: { phoneNumber: sharedNumber } });
    expect(shared?.status).toBe("AVAILABLE");
    expect(shared?.businessId).toBeNull();
  });

  it("findBuyerPlatformNumber never returns the shared sender", async () => {
    if (!dbAvailable) return;

    // Force the illegal state directly to prove the read-side guard.
    await prisma.platformPhoneNumber.update({
      where: { phoneNumber: sharedNumber },
      data: { status: "ASSIGNED", businessId, buyerUserId, assignedAt: new Date() }
    });

    const found = await findBuyerPlatformNumber({ buyerUserId, businessId });
    expect(found?.phoneNumber).not.toBe(sharedNumber);

    await prisma.platformPhoneNumber.update({
      where: { phoneNumber: sharedNumber },
      data: { status: "AVAILABLE", businessId: null, buyerUserId: null, assignedAt: null }
    });
  });

  it("assignPlatformNumber refuses the shared sender with PLATFORM_SMS_SENDER_NOT_ASSIGNABLE", async () => {
    if (!dbAvailable) return;

    const shared = await prisma.platformPhoneNumber.findUnique({ where: { phoneNumber: sharedNumber } });
    expect(shared).not.toBeNull();

    const attempt = prisma.$transaction(async (tx) =>
      assignPlatformNumber(tx, {
        platform: shared!,
        businessId,
        installedAgentId: null,
        buyerUserId
      })
    );

    await expect(attempt).rejects.toMatchObject({ code: "PLATFORM_SMS_SENDER_NOT_ASSIGNABLE" });
    await expect(attempt).rejects.toBeInstanceOf(PhoneNumberServiceError);

    const routingRow = await prisma.businessPhoneNumber.findUnique({ where: { phoneNumber: sharedNumber } });
    expect(routingRow).toBeNull();
  });
});
