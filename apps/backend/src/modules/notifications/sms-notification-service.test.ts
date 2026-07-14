import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import {
  applyTwilioMessageStatus,
  appointmentConfirmationDedupeKey,
  renderAppointmentConfirmationSms,
  sendAppointmentConfirmationSms,
  sendTrackedSms
} from "./sms-notification-service";

/**
 * Template tests are pure. Everything else runs against the local dev
 * database (fixtures marked + removed) with Twilio stubbed via global fetch —
 * no real SMS is ever sent. The DB suites skip when the database is down.
 */

const RUN = `smstest-${process.pid}-${Date.now().toString(36)}`;

const originalEnv = {
  TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY_SID: env.TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET: env.TWILIO_API_KEY_SECRET,
  TWILIO_MESSAGING_SERVICE_SID: env.TWILIO_MESSAGING_SERVICE_SID,
  TWILIO_SMS_MODE: env.TWILIO_SMS_MODE,
  TWILIO_TEST_MODE: env.TWILIO_TEST_MODE,
  TWILIO_SMS_STATUS_CALLBACK_URL: env.TWILIO_SMS_STATUS_CALLBACK_URL
};

let dbAvailable = false;
let businessId = "";
let sidCounter = 0;

function stubTwilioAccepting() {
  env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
  env.TWILIO_AUTH_TOKEN = "test-auth-token";
  env.TWILIO_API_KEY_SID = undefined;
  env.TWILIO_API_KEY_SECRET = undefined;
  env.TWILIO_MESSAGING_SERVICE_SID = "MGtest0000000000000000000000000000";
  env.TWILIO_SMS_MODE = "LIVE";
  env.TWILIO_TEST_MODE = false;
  env.TWILIO_SMS_STATUS_CALLBACK_URL = "https://triven.ai/api/architect/connectors/twilio/message-status";

  const fetchMock = vi.fn(async () => {
    sidCounter += 1;
    return {
      ok: true,
      status: 201,
      json: async () => ({
        sid: `SM${RUN}${sidCounter}`,
        status: "queued",
        messaging_service_sid: "MGtest0000000000000000000000000000",
        num_segments: "1"
      })
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubTwilioFailing(code: number, message: string) {
  env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
  env.TWILIO_AUTH_TOKEN = "test-auth-token";
  env.TWILIO_MESSAGING_SERVICE_SID = "MGtest0000000000000000000000000000";
  env.TWILIO_SMS_MODE = "LIVE";
  env.TWILIO_TEST_MODE = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ code, message }) }))
  );
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[sms-notification-service.test] database unreachable — DB suites skipped");
    return;
  }

  const owner = await prisma.user.create({
    data: { email: `${RUN}@test.local`, role: "BUSINESS" }
  });
  const business = await prisma.business.create({
    data: { ownerId: owner.id, name: `${RUN} Dental`, type: "dental" }
  });
  businessId = business.id;
  await prisma.businessProfile.create({
    data: { businessId, services: [], timeZone: "America/New_York" }
  });
  await prisma.businessPhoneNumber.create({
    data: { businessId, phoneNumber: `+1999${String(Date.now()).slice(-7)}`, isActive: true }
  });
}, 30_000);

afterAll(async () => {
  if (dbAvailable && businessId) {
    await prisma.smsExecution.deleteMany({ where: { businessId } });
    await prisma.appointment.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { email: `${RUN}@test.local` } });
  }
  await prisma.$disconnect();
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

describe("renderAppointmentConfirmationSms", () => {
  it("renders every dynamic value", () => {
    const body = renderAppointmentConfirmationSms({
      customerName: "Jane Smith",
      businessName: "Smile Dental",
      serviceName: "Cleaning",
      appointmentDate: "Tue, Jul 14, 2026",
      appointmentTime: "3:00 PM",
      businessPhone: "+15557654321"
    });

    expect(body).toContain("Hi Jane Smith,");
    expect(body).toContain("Cleaning appointment with Smile Dental");
    expect(body).toContain("Date: Tue, Jul 14, 2026");
    expect(body).toContain("Time: 3:00 PM");
    expect(body).toContain("For assistance call +15557654321.");
    expect(body).toContain("Reply STOP to opt out.");
  });

  it("drops the assistance line when there is no business phone", () => {
    const body = renderAppointmentConfirmationSms({
      customerName: "Jane",
      businessName: "Smile Dental",
      serviceName: "Cleaning",
      appointmentDate: "Tue, Jul 14, 2026",
      appointmentTime: "3:00 PM",
      businessPhone: ""
    });
    expect(body).not.toContain("For assistance call");
    expect(body).toContain("Reply STOP to opt out.");
  });
});

describe("appointment confirmation idempotency (DB)", () => {
  it("sends exactly once for the same appointment, even when re-triggered", async () => {
    if (!dbAvailable) return;
    const fetchMock = stubTwilioAccepting();

    const appointment = await prisma.appointment.create({
      data: {
        businessId,
        customerPhone: "+15551112222",
        customerName: "Jane",
        service: "Cleaning",
        startAt: new Date("2027-01-05T15:00:00Z"),
        endAt: new Date("2027-01-05T15:30:00Z"),
        timeZone: "America/New_York"
      }
    });

    const input = {
      appointmentId: appointment.id,
      businessId,
      customerName: "Jane",
      customerPhone: "+15551112222",
      serviceName: "Cleaning",
      appointmentDate: appointment.startAt,
      timeZone: "America/New_York"
    };

    const first = await sendAppointmentConfirmationSms(input);
    const second = await sendAppointmentConfirmationSms(input);

    expect(first.sent).toBe(true);
    expect(first.alreadySent).toBe(false);
    expect(second.alreadySent).toBe(true);
    expect(second.executionId).toBe(first.executionId);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const executions = await prisma.smsExecution.findMany({
      where: { dedupeKey: appointmentConfirmationDedupeKey(appointment.id) }
    });
    expect(executions).toHaveLength(1);
    expect(executions[0].messageType).toBe("APPOINTMENT_CONFIRMATION");
    expect(executions[0].messagingServiceSid).toBe("MGtest0000000000000000000000000000");
  });

  it("creates only one execution under concurrent duplicate triggers", async () => {
    if (!dbAvailable) return;
    const fetchMock = stubTwilioAccepting();
    const dedupeKey = `${RUN}-concurrent`;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        sendTrackedSms({
          to: "+15553334444",
          body: "concurrency test",
          messageType: "TEST_SMS",
          businessId,
          dedupeKey
        })
      )
    );

    const rows = await prisma.smsExecution.findMany({ where: { dedupeKey } });
    expect(rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => !r.alreadySent)).toHaveLength(1);
  });

  it("records a Twilio failure as FAILED with the error code — never fake success", async () => {
    if (!dbAvailable) return;
    stubTwilioFailing(21211, "Invalid 'To' phone number");

    const outcome = await sendTrackedSms({
      to: "+15550001111",
      body: "failure test",
      messageType: "TEST_SMS",
      businessId
    });

    expect(outcome.sent).toBe(false);
    expect(outcome.error).toContain("Invalid");
    expect(outcome.errorCode).toBe("21211");

    const row = await prisma.smsExecution.findUnique({ where: { id: outcome.executionId! } });
    expect(row?.status).toBe("FAILED");
    expect(row?.errorCode).toBe("21211");
    expect(row?.failedAt).not.toBeNull();
  });

  it("SIMULATED mode records a SIMULATED execution without any provider call", async () => {
    if (!dbAvailable) return;
    stubTwilioAccepting();
    env.TWILIO_SMS_MODE = "SIMULATED";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await sendTrackedSms({
      to: "+15552024680",
      body: "simulated mode test",
      messageType: "TEST_SMS",
      businessId
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.simulated).toBe(true);
    expect(outcome.testCredentials).toBe(false);
    expect(outcome.sent).toBe(true);

    const row = await prisma.smsExecution.findUnique({ where: { id: outcome.executionId! } });
    expect(row?.status).toBe("SIMULATED");
    expect(row?.messageSid).toBeNull();
  });

  it("rejects an ambiguous bare 10-digit recipient without creating an execution", async () => {
    if (!dbAvailable) return;
    stubTwilioAccepting();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await sendTrackedSms({
      to: "7252202182",
      body: "ambiguous recipient test",
      messageType: "TEST_SMS",
      businessId
    });

    expect(outcome.attempted).toBe(false);
    expect(outcome.sent).toBe(false);
    expect(outcome.error).toMatch(/country code/i);
    expect(outcome.executionId).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("delivery status callbacks (DB)", () => {
  it("updates delivered state from a callback", async () => {
    if (!dbAvailable) return;
    stubTwilioAccepting();

    const outcome = await sendTrackedSms({
      to: "+15556667777",
      body: "delivery test",
      messageType: "TEST_SMS",
      businessId
    });
    expect(outcome.messageSid).toBeTruthy();

    const result = await applyTwilioMessageStatus({
      MessageSid: outcome.messageSid!,
      MessageStatus: "delivered",
      NumSegments: "1",
      Price: "-0.0079",
      PriceUnit: "USD"
    });

    expect(result.ok).toBe(true);
    const row = await prisma.smsExecution.findUnique({ where: { messageSid: outcome.messageSid! } });
    expect(row?.status).toBe("DELIVERED");
    expect(row?.deliveredAt).not.toBeNull();
    expect(row?.providerCostMicroUsd).toBe(7900);
    expect(row?.currency).toBe("USD");
  });

  it("stores error code/message for a failed callback and is idempotent", async () => {
    if (!dbAvailable) return;
    stubTwilioAccepting();

    const outcome = await sendTrackedSms({
      to: "+15558889999",
      body: "failed delivery test",
      messageType: "TEST_SMS",
      businessId
    });

    const callback = {
      MessageSid: outcome.messageSid!,
      MessageStatus: "undelivered",
      ErrorCode: "30003",
      ErrorMessage: "Unreachable destination handset"
    };
    await applyTwilioMessageStatus(callback);
    await applyTwilioMessageStatus(callback); // replay must not corrupt state

    const row = await prisma.smsExecution.findUnique({ where: { messageSid: outcome.messageSid! } });
    expect(row?.status).toBe("UNDELIVERED");
    expect(row?.errorCode).toBe("30003");
    expect(row?.errorMessage).toContain("Unreachable");
    expect(row?.failedAt).not.toBeNull();
  });

  it("never downgrades a delivered execution on a late 'sent' callback", async () => {
    if (!dbAvailable) return;
    stubTwilioAccepting();

    const outcome = await sendTrackedSms({
      to: "+15551010101",
      body: "ordering test",
      messageType: "TEST_SMS",
      businessId
    });

    await applyTwilioMessageStatus({ MessageSid: outcome.messageSid!, MessageStatus: "delivered" });
    await applyTwilioMessageStatus({ MessageSid: outcome.messageSid!, MessageStatus: "sent" });

    const row = await prisma.smsExecution.findUnique({ where: { messageSid: outcome.messageSid! } });
    expect(row?.status).toBe("DELIVERED");
  });

  it("acknowledges an unknown MessageSid without creating anything", async () => {
    if (!dbAvailable) return;
    const result = await applyTwilioMessageStatus({
      MessageSid: `SM-${RUN}-unknown`,
      MessageStatus: "delivered"
    });
    expect(result.ok).toBe(true);
    expect(result.executionId).toBeNull();
  });
});
