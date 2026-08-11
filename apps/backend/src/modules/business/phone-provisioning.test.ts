import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { PhoneNumberServiceError } from "../admin/twilio-number-service";
import { assignPlatformNumber } from "./phone-assignment";
import {
  findBuyerPlatformNumber,
  getPhoneNumberFeeWithSnapshotFallback
} from "./phone-provisioning";

const RUN = `phonetest-${process.pid}-${Date.now().toString(36)}`;
const sharedNumber = `+1777${String(Date.now()).slice(-7)}`;
const normalNumber = `+1778${String(Date.now()).slice(-7)}`;
/**
 * Imported by the Twilio sync, so it has pricing but no country. `+99` is not a
 * real calling code, so neither Twilio Lookup nor the prefix fallback can
 * resolve one — the reprice fails the same way whether or not the test
 * environment has Twilio credentials.
 */
const countrylessNumber = `+99${String(Date.now()).slice(-9)}`;

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
  await prisma.platformPhoneNumber.create({
    data: {
      phoneNumber: countrylessNumber,
      e164: countrylessNumber,
      provider: "TWILIO",
      status: "AVAILABLE",
      voiceEnabled: true,
      smsEnabled: true,
      isPlatformSmsSender: false,
      country: null,
      // Deliberately unlike any real Twilio price, so a successful reprice
      // could never be mistaken for the snapshot fallback.
      providerMonthlyPriceMicroUsd: 6_770_000,
      billingMonthlyPriceMicroUsd: 7_770_000,
      pricingCurrency: "usd",
      pricingNumberType: "local",
      pricingFetchedAt: new Date()
    }
  });
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.businessPhoneNumber.deleteMany({ where: { phoneNumber: { in: [sharedNumber, normalNumber, countrylessNumber] } } });
    await prisma.platformPhoneNumber.deleteMany({ where: { phoneNumber: { in: [sharedNumber, normalNumber, countrylessNumber] } } });
    if (businessId) await prisma.business.deleteMany({ where: { id: businessId } });
    if (buyerUserId) await prisma.user.deleteMany({ where: { id: buyerUserId } });
  }
  await prisma.$disconnect();
});

describe("shared SMS sender protection", () => {
  it("findBuyerPlatformNumber never returns the shared sender", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

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
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

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

describe("buyer setup pricing", () => {
  it("falls back to the stored price when a country-less number cannot be repriced", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const number = await prisma.platformPhoneNumber.findUnique({
      where: { phoneNumber: countrylessNumber },
      select: { id: true, country: true }
    });
    expect(number?.country).toBeNull();

    // Used to throw PHONE_NUMBER_PRICING_COUNTRY_MISSING (422) and block setup.
    const fee = await getPhoneNumberFeeWithSnapshotFallback(number!.id);

    expect(fee.amountCents).toBe(777);
    expect(fee.serviceCode).toBe("phone_number");
  });
});
