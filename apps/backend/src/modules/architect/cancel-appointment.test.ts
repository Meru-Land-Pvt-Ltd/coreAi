import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { recordVerbalSmsConsent } from "../notifications/sms-consent";
import { handleVapiWebhook } from "./twilio-business-routing";
import { appointmentAiRef } from "../compliance/ai-safe-results";

/**
 * cancel_appointment — security/privacy behavior at the webhook level.
 *
 * The Google Calendar delete is mocked (partial module mock) so both the
 * success and failure paths are exercised without Google credentials; all
 * other modules are real. SMS runs in SIMULATED mode (no provider call) so
 * the consent gate's sent/suppressed behavior is observable in SmsExecution
 * rows. DB cases skip when the database is down.
 */

const { calendarDeleteMock } = await vi.hoisted(async () => {
  // Using vi.mock makes vitest evaluate this file's module graph BEFORE the
  // configured setupFiles run, so src/config/env.ts would parse an empty
  // process.env and throw. Replicate test/setup.ts's env bootstrap here,
  // ahead of every import — loading the backend .env by explicit path (the
  // hoisted phase does not reliably share the worker's cwd).
  const { fileURLToPath } = await import("node:url");
  const nodePath = await import("node:path");
  const dotenv = await import("dotenv");
  dotenv.config({
    path: nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../../../.env")
  });
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-at-least-24-chars";
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "test-encryption-key-24-chars!";
  process.env.SES_DRY_RUN = "true";
  delete process.env.REDIS_URL;
  return { calendarDeleteMock: vi.fn() };
});

vi.mock("./google-calendar-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./google-calendar-connector")>()),
  cancelGoogleCalendarAppointment: calendarDeleteMock
}));

const RUN = `cancelappt-${process.pid}-${Date.now().toString(36)}`;

const originalEnv = {
  TWILIO_SMS_MODE: env.TWILIO_SMS_MODE,
  TWILIO_TEST_MODE: env.TWILIO_TEST_MODE,
  VAPI_WEBHOOK_SECRET: env.VAPI_WEBHOOK_SECRET
};

let dbAvailable = false;
let bizAId = "";
let bizBId = "";

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+1620555${String(1000 + phoneCounter).slice(-4)}`;
}

function upcoming(hoursFromNow: number): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
}

function buildApp() {
  const app = new Hono();
  app.post("/architect/connectors/vapi/webhook", handleVapiWebhook);
  return app;
}

function cancelPayload(input: {
  businessId: string;
  callId: string;
  customerNumber?: string;
  args?: Record<string, unknown>;
}) {
  return {
    message: {
      type: "tool-calls",
      toolCalls: [
        {
          id: `tc_${input.callId}`,
          function: { name: "cancel_appointment", arguments: JSON.stringify(input.args ?? {}) }
        }
      ],
      call: {
        id: input.callId,
        ...(input.customerNumber !== undefined ? { customer: { number: input.customerNumber } } : {})
      }
    },
    metadata: { businessId: input.businessId }
  };
}

async function postCancel(app: Hono, payload: unknown): Promise<Record<string, unknown>> {
  const response = await app.request("/architect/connectors/vapi/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  expect(response.status).toBe(200);
  const json = (await response.json()) as { results?: Array<{ result: string }> };
  return JSON.parse(json.results?.[0]?.result ?? "{}") as Record<string, unknown>;
}

async function createAppointment(input: {
  businessId: string;
  phone: string;
  service?: string;
  status?: string;
  startAt?: Date;
  calendarEventId?: string | null;
  customerName?: string;
}) {
  return prisma.appointment.create({
    data: {
      businessId: input.businessId,
      customerPhone: input.phone,
      customerName: input.customerName ?? "Test Caller",
      service: input.service ?? "Cleaning",
      startAt: input.startAt ?? upcoming(48),
      endAt: new Date((input.startAt ?? upcoming(48)).getTime() + 30 * 60 * 1000),
      timeZone: "America/New_York",
      status: input.status ?? "BOOKED",
      calendarEventId: input.calendarEventId ?? null
    }
  });
}

const NO_MATCH_MESSAGE =
  "I’m unable to verify an appointment associated with the number you’re calling from. For privacy and security, I can’t provide any appointment or phone-number details. Please call again from the phone number used when the appointment was booked, or contact the business team for assistance.";

const CALLER_ID_UNAVAILABLE_MESSAGE =
  "I’m unable to verify the phone number for this call, so I can’t cancel an appointment automatically. Please call from the phone number used when booking or contact the business team for assistance.";

/** A failure payload must be exactly {cancelled, code, message} — nothing else. */
function expectPrivacySafeFailure(result: Record<string, unknown>, code: string, message: string) {
  expect(result).toEqual({ cancelled: false, code, message });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[cancel-appointment.test] database unreachable — DB cases skipped");
    return;
  }

  const [ownerA, ownerB] = await Promise.all([
    prisma.user.create({ data: { email: `${RUN}-a@test.local`, role: "BUSINESS" } }),
    prisma.user.create({ data: { email: `${RUN}-b@test.local`, role: "BUSINESS" } })
  ]);
  const [bizA, bizB] = await Promise.all([
    prisma.business.create({ data: { ownerId: ownerA.id, name: `${RUN} Dental`, type: "dental" } }),
    prisma.business.create({ data: { ownerId: ownerB.id, name: `${RUN} Salon`, type: "salon" } })
  ]);
  bizAId = bizA.id;
  bizBId = bizB.id;
  await Promise.all([
    prisma.businessProfile.create({
      data: { businessId: bizAId, services: ["Cleaning"], timeZone: "America/New_York" }
    }),
    prisma.businessProfile.create({
      data: { businessId: bizBId, services: ["Haircut"], timeZone: "America/New_York" }
    })
  ]);
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    const ids = [bizAId, bizBId].filter(Boolean);
    await prisma.smsExecution.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.smsConsent.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.vapiCall.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.appointment.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  }
  await prisma.$disconnect();
});

beforeEach(() => {
  env.TWILIO_SMS_MODE = "SIMULATED";
  calendarDeleteMock.mockReset();
  calendarDeleteMock.mockResolvedValue({ deleted: true, alreadyGone: false });
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

describe("caller-number verification", () => {
  it("an exact normalized caller match finds the appointment and asks for confirmation", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone, service: "Cleaning" });

    const result = await postCancel(
      app,
      cancelPayload({ businessId: bizAId, callId: `${RUN}-c1`, customerNumber: phone })
    );

    expect(result.cancelled).toBe(false);
    expect(result.code).toBe("CONFIRMATION_REQUIRED");
    const found = result.appointment as Record<string, unknown>;
    expect(found.appointment_id).toBe(appointmentAiRef(appointment.id));
    expect(found.appointment_id).not.toBe(appointment.id);
    expect(found.service).toBe("Cleaning");
    expect(String(result.message)).toContain("Would you like me to cancel this appointment?");

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.status).toBe("BOOKED");
  });

  it("a different caller number reveals nothing about the appointment", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const storedPhone = nextPhone();
    await createAppointment({
      businessId: bizAId,
      phone: storedPhone,
      service: "Root Canal",
      customerName: "Privacy Person"
    });

    const result = await postCancel(
      app,
      cancelPayload({ businessId: bizAId, callId: `${RUN}-c2`, customerNumber: nextPhone() })
    );

    expectPrivacySafeFailure(result, "CALLER_NUMBER_NOT_VERIFIED", NO_MATCH_MESSAGE);
    const raw = JSON.stringify(result);
    expect(raw).not.toContain(storedPhone);
    expect(raw).not.toContain(storedPhone.slice(-4));
    expect(raw).not.toContain("Root Canal");
    expect(raw).not.toContain("Privacy Person");
  });

  it("the same phone under a different business is not matched", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    await createAppointment({ businessId: bizBId, phone, service: "Haircut" });

    const result = await postCancel(
      app,
      cancelPayload({ businessId: bizAId, callId: `${RUN}-c3`, customerNumber: phone })
    );

    expectPrivacySafeFailure(result, "CALLER_NUMBER_NOT_VERIFIED", NO_MATCH_MESSAGE);
    expect(JSON.stringify(result)).not.toContain("Haircut");
  });

  it("hidden caller ID cannot cancel", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();

    const result = await postCancel(app, cancelPayload({ businessId: bizAId, callId: `${RUN}-c4` }));
    expectPrivacySafeFailure(result, "CALLER_ID_UNAVAILABLE", CALLER_ID_UNAVAILABLE_MESSAGE);
  });

  it("anonymous/restricted/invalid caller IDs cannot cancel", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();

    for (const [index, callerId] of ["anonymous", "Restricted", "+266696687", "12345"].entries()) {
      const result = await postCancel(
        app,
        cancelPayload({ businessId: bizAId, callId: `${RUN}-c5-${index}`, customerNumber: callerId })
      );
      expectPrivacySafeFailure(result, "CALLER_ID_UNAVAILABLE", CALLER_ID_UNAVAILABLE_MESSAGE);
    }
  });

  it("a spoken/model-supplied phone number never overrides the caller ID", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const storedPhone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone: storedPhone });

    // The model passes the real appointment's number AND its id — but the call
    // comes from a different number, so nothing is disclosed or cancelled.
    const result = await postCancel(
      app,
      cancelPayload({
        businessId: bizAId,
        callId: `${RUN}-c6`,
        customerNumber: nextPhone(),
        args: {
          customer_phone: storedPhone,
          patient_phone: storedPhone,
          appointment_id: appointment.id,
          confirmed: true
        }
      })
    );

    expectPrivacySafeFailure(result, "CALLER_NUMBER_NOT_VERIFIED", NO_MATCH_MESSAGE);
    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.status).toBe("BOOKED");
  });

  it("a last-four-digit match is insufficient", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const storedPhone = "+16215550001";
    await createAppointment({ businessId: bizAId, phone: storedPhone });

    // Same last four digits, different number.
    const result = await postCancel(
      app,
      cancelPayload({ businessId: bizAId, callId: `${RUN}-c7`, customerNumber: "+17635550001" })
    );

    expectPrivacySafeFailure(result, "CALLER_NUMBER_NOT_VERIFIED", NO_MATCH_MESSAGE);
    await prisma.appointment.deleteMany({ where: { businessId: bizAId, customerPhone: storedPhone } });
  });
});

describe("confirmation flow", () => {
  it("multiple appointments are listed (service/date/time only) after verification", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    await createAppointment({ businessId: bizAId, phone, service: "Cleaning", startAt: upcoming(24) });
    await createAppointment({ businessId: bizAId, phone, service: "Whitening", startAt: upcoming(72) });

    const result = await postCancel(
      app,
      cancelPayload({ businessId: bizAId, callId: `${RUN}-c8`, customerNumber: phone })
    );

    expect(result.code).toBe("MULTIPLE_APPOINTMENTS");
    const list = result.appointments as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    expect(list[0].number).toBe(1);
    expect(list[0].service).toBe("Cleaning");
    for (const item of list) {
      expect(Object.keys(item).sort()).toEqual(
        ["appointment_id", "appointment_date", "appointment_time", "number", "service"].sort()
      );
      expect(JSON.stringify(item)).not.toContain(phone);
    }
  });

  it("an unclear confirmation (missing or non-boolean) does not cancel", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone });

    for (const [index, confirmed] of [undefined, "yes", "true", 1, null].entries()) {
      const result = await postCancel(
        app,
        cancelPayload({
          businessId: bizAId,
          callId: `${RUN}-c9-${index}`,
          customerNumber: phone,
          args: { appointment_id: appointment.id, ...(confirmed === undefined ? {} : { confirmed }) }
        })
      );
      expect(result.cancelled).toBe(false);
    }

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.status).toBe("BOOKED");
  });

  it("a clear yes cancels: DB status, audit fields, and call id are stored", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone, service: "Cleaning" });

    const result = await postCancel(
      app,
      cancelPayload({
        businessId: bizAId,
        callId: `${RUN}-c10`,
        customerNumber: phone,
        args: { appointment_id: appointment.id, confirmed: true, cancellation_reason: "schedule conflict" }
      })
    );

    expect(result.cancelled).toBe(true);
    expect(result.code).toBe("CANCELLED");
    expect(result.message).toBe("Your appointment has been cancelled successfully.");

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.status).toBe("CANCELLED");
    expect(row?.cancelledAt).not.toBeNull();
    expect(row?.cancellationSource).toBe("CUSTOMER_PHONE_CALL");
    expect(row?.cancellationCallId).toBe(`${RUN}-c10`);
    expect(row?.cancellationReason).toBe("schedule conflict");
  });

  it("repeating the cancellation is idempotent, not an error", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone });

    const args = { appointment_id: appointment.id, confirmed: true };
    const first = await postCancel(
      app,
      cancelPayload({ businessId: bizAId, callId: `${RUN}-c11`, customerNumber: phone, args })
    );
    const second = await postCancel(
      app,
      cancelPayload({ businessId: bizAId, callId: `${RUN}-c11b`, customerNumber: phone, args })
    );

    expect(first.cancelled).toBe(true);
    expect(second.cancelled).toBe(true);
    expect(second.code).toBe("ALREADY_CANCELLED");
  });

  it("a completed appointment cannot be cancelled", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone, status: "COMPLETED" });

    const result = await postCancel(
      app,
      cancelPayload({
        businessId: bizAId,
        callId: `${RUN}-c12`,
        customerNumber: phone,
        args: { appointment_id: appointment.id, confirmed: true }
      })
    );

    expect(result.cancelled).toBe(false);
    expect(result.code).toBe("NOT_CANCELLABLE");

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.status).toBe("COMPLETED");
  });
});

describe("Google Calendar integration", () => {
  it("deletes the linked calendar event on cancellation", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({
      businessId: bizAId,
      phone,
      calendarEventId: `${RUN}-event-1`
    });

    const result = await postCancel(
      app,
      cancelPayload({
        businessId: bizAId,
        callId: `${RUN}-c13`,
        customerNumber: phone,
        args: { appointment_id: appointment.id, confirmed: true }
      })
    );

    expect(result.cancelled).toBe(true);
    expect(calendarDeleteMock).toHaveBeenCalledTimes(1);
    expect(calendarDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: `${RUN}-event-1` })
    );
    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.status).toBe("CANCELLED");
  });

  it("a calendar failure never produces a false success and leaves the appointment active", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({
      businessId: bizAId,
      phone,
      calendarEventId: `${RUN}-event-2`
    });
    calendarDeleteMock.mockRejectedValue(new Error("google_api_500: token expired for tenant xyz"));

    const result = await postCancel(
      app,
      cancelPayload({
        businessId: bizAId,
        callId: `${RUN}-c14`,
        customerNumber: phone,
        args: { appointment_id: appointment.id, confirmed: true }
      })
    );

    expect(result.cancelled).toBe(false);
    expect(result.code).toBe("CANCELLATION_FAILED");
    // No technical details reach the caller.
    expect(String(result.message)).not.toMatch(/google|token|500|api/i);

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.status).toBe("BOOKED");
    expect(row?.cancelledAt).toBeNull();

    // No cancellation SMS may exist for an uncancelled appointment.
    const sms = await prisma.smsExecution.findFirst({ where: { appointmentId: appointment.id } });
    expect(sms).toBeNull();
  });
});

describe("cancellation notifications", () => {
  it("sends the cancellation SMS through the consent gate when consent exists", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone, service: "Cleaning" });
    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-consent`,
      affirmative: true
    });

    const result = await postCancel(
      app,
      cancelPayload({
        businessId: bizAId,
        callId: `${RUN}-c15`,
        customerNumber: phone,
        args: { appointment_id: appointment.id, confirmed: true }
      })
    );

    expect(result.cancelled).toBe(true);
    expect(result.sms_sent).toBe(true);

    const sms = await prisma.smsExecution.findUnique({
      where: { dedupeKey: `appointment-cancellation:${appointment.id}` }
    });
    expect(sms?.messageType).toBe("APPOINTMENT_CANCELLATION");
    expect(sms?.status).toBe("SIMULATED");
    expect(sms?.body).toContain("has been cancelled");
    expect(sms?.body).toContain("via Triven.ai");
  });

  it("cancellation still succeeds when the SMS is suppressed for missing consent", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone });

    const result = await postCancel(
      app,
      cancelPayload({
        businessId: bizAId,
        callId: `${RUN}-c16`,
        customerNumber: phone,
        args: { appointment_id: appointment.id, confirmed: true }
      })
    );

    expect(result.cancelled).toBe(true);
    expect(result.sms_sent).toBe(false);

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.status).toBe("CANCELLED");

    const sms = await prisma.smsExecution.findFirst({ where: { appointmentId: appointment.id } });
    expect(sms?.status).toBe("SUPPRESSED");
    expect(sms?.errorCode).toBe("SMS_CONSENT_REQUIRED");
  });
});
