import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { deleteTestCalendarEvent } from "../architect/test-calendar-events";
import { purchaseNumberForBusiness } from "./phone-provisioning-flow";

/**
 * Integration tests against the local dev database (same convention as
 * phone-provisioning.test.ts: fixtures unique per run, deleted afterwards,
 * suite skipped when the DB is unreachable). No Twilio calls are made — every
 * asserted path returns before the provider request.
 */

const RUN = `provflow-${process.pid}-${Date.now().toString(36)}`;
const heldNumber = `+1779${String(Date.now()).slice(-7)}`;

let dbAvailable = false;
let ownerId = "";
let otherOwnerId = "";
let businessId = "";
let otherBusinessId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[phone-provisioning-flow.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  ownerId = owner.id;
  const other = await prisma.user.create({ data: { email: `${RUN}-b@test.local`, role: "BUSINESS" } });
  otherOwnerId = other.id;

  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Biz`, type: "salon" } })
  ).id;
  otherBusinessId = (
    await prisma.business.create({ data: { ownerId: otherOwnerId, name: `${RUN} Other`, type: "gym" } })
  ).id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.phoneProvisioningRequest.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
  await prisma.testCalendarEvent.deleteMany({ where: { ownerUserId: { in: [ownerId, otherOwnerId] } } });
  await prisma.platformPhoneNumber.deleteMany({ where: { phoneNumber: heldNumber } });
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } });
});

describe("purchaseNumberForBusiness", () => {
  it("rejects invalid locations before any purchase", async () => {
    if (!dbAvailable) return;

    await expect(
      purchaseNumberForBusiness({
        businessId,
        requestedByUserId: ownerId,
        clientRequestId: `${RUN}-badloc-1`,
        phoneNumber: "+15550001111",
        country: "US",
        state: "ON" // Canadian province with US country
      })
    ).rejects.toMatchObject({ code: "INVALID_REGION" });
  });

  it("returns the existing number instead of buying a second one", async () => {
    if (!dbAvailable) return;

    await prisma.platformPhoneNumber.create({
      data: {
        phoneNumber: heldNumber,
        e164: heldNumber,
        provider: "TWILIO",
        status: "ASSIGNED",
        businessId,
        buyerUserId: ownerId,
        voiceEnabled: true,
        smsEnabled: true
      }
    });

    const outcome = await purchaseNumberForBusiness({
      businessId,
      requestedByUserId: ownerId,
      clientRequestId: `${RUN}-dup-1`,
      phoneNumber: "+15550002222",
      country: "US",
      state: "CA",
      city: "Los Angeles"
    });

    expect(outcome.alreadyCompleted).toBe(true);
    expect(outcome.status).toBe("ACTIVE");
    expect(outcome.phoneNumber).toBe(heldNumber);

    // No provisioning request row was created — nothing to retry or reconcile.
    const requests = await prisma.phoneProvisioningRequest.findMany({
      where: { businessId, clientRequestId: `${RUN}-dup-1` }
    });
    expect(requests).toHaveLength(0);
  });

  it("repeats of the same clientRequestId return the recorded request without re-purchasing", async () => {
    if (!dbAvailable) return;

    // Seed a completed request as if a prior purchase finished.
    await prisma.phoneProvisioningRequest.create({
      data: {
        businessId: otherBusinessId,
        requestedByUserId: otherOwnerId,
        clientRequestId: `${RUN}-idem-1`,
        status: "ACTIVE",
        requestedCountry: "US",
        requestedRegion: "CA",
        requestedLocality: "Los Angeles",
        selectedPhoneNumber: "+15550003333"
      }
    });

    const outcome = await purchaseNumberForBusiness({
      businessId: otherBusinessId,
      requestedByUserId: otherOwnerId,
      clientRequestId: `${RUN}-idem-1`,
      phoneNumber: "+15550003333",
      country: "US",
      state: "CA",
      city: "Los Angeles"
    });

    expect(outcome.alreadyCompleted).toBe(true);
    expect(outcome.status).toBe("ACTIVE");
    expect(outcome.phoneNumber).toBe("+15550003333");
  });
});

describe("test calendar event ownership", () => {
  it("only the owner can delete a test event; deletion is idempotent", async () => {
    if (!dbAvailable) return;

    const row = await prisma.testCalendarEvent.create({
      data: {
        executionMode: "BUSINESS_TEST",
        ownerUserId: ownerId,
        businessId,
        serviceName: "Test Appointment",
        startAt: new Date("2026-07-25T19:00:00Z"),
        endAt: new Date("2026-07-25T19:30:00Z"),
        timeZone: "America/New_York",
        status: "SIMULATED"
      }
    });

    // A different user (even a business owner) is denied.
    const denied = await deleteTestCalendarEvent({
      testEventId: row.id,
      requesterUserId: otherOwnerId,
      allowedBusinessIds: [otherBusinessId],
      scope: "BUSINESS"
    });
    expect(denied.outcome).toBe("ownership_denied");

    // The owner deletes it; a second delete reports already_deleted.
    const deleted = await deleteTestCalendarEvent({
      testEventId: row.id,
      requesterUserId: ownerId,
      allowedBusinessIds: [businessId],
      scope: "BUSINESS"
    });
    expect(deleted.outcome).toBe("deleted");

    const repeat = await deleteTestCalendarEvent({
      testEventId: row.id,
      requesterUserId: ownerId,
      allowedBusinessIds: [businessId],
      scope: "BUSINESS"
    });
    expect(repeat.outcome).toBe("already_deleted");

    // Unknown ids are not found; an architect-scope requester cannot delete
    // business test events.
    const missing = await deleteTestCalendarEvent({
      testEventId: "does-not-exist",
      requesterUserId: ownerId,
      scope: "BUSINESS"
    });
    expect(missing.outcome).toBe("not_found");
  });

  it("architect events are scoped to the architect who created them", async () => {
    if (!dbAvailable) return;

    const row = await prisma.testCalendarEvent.create({
      data: {
        executionMode: "ARCHITECT_DRY_RUN",
        ownerUserId: ownerId,
        serviceName: "Test Appointment",
        startAt: new Date("2026-07-25T19:00:00Z"),
        endAt: new Date("2026-07-25T19:30:00Z"),
        timeZone: "Asia/Kolkata",
        status: "SIMULATED"
      }
    });

    const otherArchitect = await deleteTestCalendarEvent({
      testEventId: row.id,
      requesterUserId: otherOwnerId,
      scope: "ARCHITECT"
    });
    expect(otherArchitect.outcome).toBe("ownership_denied");

    const businessScope = await deleteTestCalendarEvent({
      testEventId: row.id,
      requesterUserId: ownerId,
      allowedBusinessIds: [businessId],
      scope: "BUSINESS"
    });
    expect(businessScope.outcome).toBe("ownership_denied");

    const owner = await deleteTestCalendarEvent({
      testEventId: row.id,
      requesterUserId: ownerId,
      scope: "ARCHITECT"
    });
    expect(owner.outcome).toBe("deleted");
  });
});
