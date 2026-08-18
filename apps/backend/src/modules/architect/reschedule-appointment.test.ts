import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { handleVapiWebhook } from "./twilio-business-routing";
import { appointmentAiRef } from "../compliance/ai-safe-results";

/**
 * reschedule_appointment — security/privacy + move behavior at the webhook
 * level, mirroring cancel-appointment.test.ts.
 *
 * Google Calendar calls are mocked (partial module mock) so the patch success,
 * missing-event recreate, and failure paths run without Google credentials.
 * SMS runs in SIMULATED mode. DB cases skip when the database is down.
 */

const { calendarPatchMock, calendarCreateMock } = await vi.hoisted(async () => {
  // Using vi.mock makes vitest evaluate this file's module graph BEFORE the
  // configured setupFiles run, so src/config/env.ts would parse an empty
  // process.env and throw. Replicate test/setup.ts's env bootstrap here,
  // ahead of every import.
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
  return { calendarPatchMock: vi.fn(), calendarCreateMock: vi.fn() };
});

vi.mock("./google-calendar-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./google-calendar-connector")>()),
  rescheduleGoogleCalendarAppointment: calendarPatchMock,
  createGoogleCalendarAppointment: calendarCreateMock
}));

const RUN = `reschedappt-${process.pid}-${Date.now().toString(36)}`;

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
  return `+1620556${String(1000 + phoneCounter).slice(-4)}`;
}

function upcoming(hoursFromNow: number): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
}

/**
 * A bookable day at/after `hoursFromNow`. The default schedule closes Sunday,
 * so a fixed offset would make these cases fail on whichever weekday pushes
 * the target onto a Sunday (e.g. +120h every Tuesday).
 */
function upcomingOpenDay(hoursFromNow: number): Date {
  const date = upcoming(hoursFromNow);
  while (date.toLocaleDateString("en-US", { timeZone: TEST_TIME_ZONE, weekday: "short" }) === "Sun") {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

/** YYYY-MM-DD for a future moment in the business timezone. */
const TEST_TIME_ZONE = "America/New_York";

function dateStrInTz(date: Date, timeZone = TEST_TIME_ZONE): string {
  return date.toLocaleDateString("en-CA", { timeZone });
}

function buildApp() {
  const app = new Hono();
  app.post("/architect/connectors/vapi/webhook", handleVapiWebhook);
  return app;
}

function reschedulePayload(input: {
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
          function: { name: "reschedule_appointment", arguments: JSON.stringify(input.args ?? {}) }
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

async function postReschedule(app: Hono, payload: unknown): Promise<Record<string, unknown>> {
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
  "I’m unable to verify the phone number for this call, so I can’t reschedule an appointment automatically. Please call from the phone number used when booking or contact the business team for assistance.";

/** A failure payload must be exactly {rescheduled, code, message} — nothing else. */
function expectPrivacySafeFailure(result: Record<string, unknown>, code: string, message: string) {
  expect(result).toEqual({ rescheduled: false, code, message });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[reschedule-appointment.test] database unreachable — DB cases skipped");
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
  calendarPatchMock.mockReset();
  calendarPatchMock.mockResolvedValue({ updated: true, missing: false, htmlLink: null });
  calendarCreateMock.mockReset();
  calendarCreateMock.mockResolvedValue({
    id: `recreated_${RUN}`,
    htmlLink: "https://calendar.google.com/event/recreated",
    calendarId: "primary",
    summary: "Cleaning - Test Caller",
    startAt: new Date().toISOString(),
    endAt: new Date().toISOString(),
    timeZone: "America/New_York"
  });
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

describe("caller-number verification", () => {
  it("an exact normalized caller match finds the appointment and asks for the new time", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone, service: "Cleaning" });

    const result = await postReschedule(
      app,
      reschedulePayload({ businessId: bizAId, callId: `${RUN}-r1`, customerNumber: phone })
    );

    expect(result.rescheduled).toBe(false);
    expect(result.code).toBe("CONFIRMATION_REQUIRED");
    const found = result.appointment as Record<string, unknown>;
    expect(found.appointment_id).toBe(appointmentAiRef(appointment.id));
    expect(found.appointment_id).not.toBe(appointment.id);
    expect(found.service).toBe("Cleaning");
    expect(String(result.message)).toContain("What new day and time");

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.startAt.getTime()).toBe(appointment.startAt.getTime());
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

    const result = await postReschedule(
      app,
      reschedulePayload({ businessId: bizAId, callId: `${RUN}-r2`, customerNumber: nextPhone() })
    );

    expectPrivacySafeFailure(result, "CALLER_NUMBER_NOT_VERIFIED", NO_MATCH_MESSAGE);
    const raw = JSON.stringify(result);
    expect(raw).not.toContain(storedPhone);
    expect(raw).not.toContain("Root Canal");
    expect(raw).not.toContain("Privacy Person");
  });

  it("the same phone under a different business is not matched", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    await createAppointment({ businessId: bizBId, phone, service: "Haircut" });

    const result = await postReschedule(
      app,
      reschedulePayload({ businessId: bizAId, callId: `${RUN}-r3`, customerNumber: phone })
    );

    expectPrivacySafeFailure(result, "CALLER_NUMBER_NOT_VERIFIED", NO_MATCH_MESSAGE);
    expect(JSON.stringify(result)).not.toContain("Haircut");
  });

  it("hidden caller ID cannot reschedule", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();

    const result = await postReschedule(app, reschedulePayload({ businessId: bizAId, callId: `${RUN}-r4` }));
    expectPrivacySafeFailure(result, "CALLER_ID_UNAVAILABLE", CALLER_ID_UNAVAILABLE_MESSAGE);
  });
});

describe("confirmed reschedule", () => {
  it("requires the new date and time before moving anything", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone });

    const result = await postReschedule(
      app,
      reschedulePayload({
        businessId: bizAId,
        callId: `${RUN}-r5`,
        customerNumber: phone,
        args: { appointment_id: appointment.id, confirmed: true }
      })
    );

    expect(result.rescheduled).toBe(false);
    expect(result.code).toBe("NEW_TIME_REQUIRED");

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.startAt.getTime()).toBe(appointment.startAt.getTime());
  });

  it("moves a local appointment (no calendar event) to the new slot and records the audit note", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone, service: "Cleaning" });
    const newDay = dateStrInTz(upcomingOpenDay(96));

    const result = await postReschedule(
      app,
      reschedulePayload({
        businessId: bizAId,
        callId: `${RUN}-r6`,
        customerNumber: phone,
        args: {
          appointment_id: appointment.id,
          confirmed: true,
          new_date: newDay,
          new_time: "14:30"
        }
      })
    );

    expect(result.rescheduled).toBe(true);
    expect(result.code).toBe("RESCHEDULED");
    expect(String(result.message)).toContain("moved to");
    const moved = result.appointment as Record<string, unknown>;
    expect(String(moved.appointment_time)).toContain("2:30");

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.status).toBe("BOOKED");
    expect(row?.startAt.getTime()).not.toBe(appointment.startAt.getTime());
    expect(row?.notes ?? "").toContain("rescheduled by the customer");
    // Duration preserved (30 minutes).
    expect((row!.endAt.getTime() - row!.startAt.getTime()) / 60000).toBe(30);
    // No calendar event → the calendar must not be touched.
    expect(calendarPatchMock).not.toHaveBeenCalled();
  });

  it("patches the linked Google Calendar event and keeps its id", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({
      businessId: bizAId,
      phone,
      calendarEventId: `evt_${RUN}_patch`
    });
    const newDay = dateStrInTz(upcomingOpenDay(120));

    const result = await postReschedule(
      app,
      reschedulePayload({
        businessId: bizAId,
        callId: `${RUN}-r7`,
        customerNumber: phone,
        args: { appointment_id: appointment.id, confirmed: true, new_date: newDay, new_time: "10:00" }
      })
    );

    expect(result.rescheduled).toBe(true);
    expect(calendarPatchMock).toHaveBeenCalledTimes(1);

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.calendarEventId).toBe(`evt_${RUN}_patch`);
    expect(row?.startAt.getTime()).not.toBe(appointment.startAt.getTime());
  });

  it("recreates the event when it was deleted from the calendar out-of-band", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    calendarPatchMock.mockResolvedValue({ updated: false, missing: true, htmlLink: null });
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({
      businessId: bizAId,
      phone,
      calendarEventId: `evt_${RUN}_gone`
    });
    const newDay = dateStrInTz(upcomingOpenDay(120));

    const result = await postReschedule(
      app,
      reschedulePayload({
        businessId: bizAId,
        callId: `${RUN}-r8`,
        customerNumber: phone,
        args: { appointment_id: appointment.id, confirmed: true, new_date: newDay, new_time: "11:00" }
      })
    );

    expect(result.rescheduled).toBe(true);
    expect(calendarCreateMock).toHaveBeenCalledTimes(1);

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.calendarEventId).toBe(`recreated_${RUN}`);
  });

  it("keeps the original time when the calendar move fails, and the caller hears a failure", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    calendarPatchMock.mockRejectedValue(new Error("google down"));
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({
      businessId: bizAId,
      phone,
      calendarEventId: `evt_${RUN}_fail`
    });
    const newDay = dateStrInTz(upcomingOpenDay(120));

    const result = await postReschedule(
      app,
      reschedulePayload({
        businessId: bizAId,
        callId: `${RUN}-r9`,
        customerNumber: phone,
        args: { appointment_id: appointment.id, confirmed: true, new_date: newDay, new_time: "12:00" }
      })
    );

    expect(result.rescheduled).toBe(false);
    expect(result.code).toBe("RESCHEDULE_FAILED");

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.startAt.getTime()).toBe(appointment.startAt.getTime());
    expect(row?.status).toBe("BOOKED");
  });

  it("rejects a new time in the past without touching the appointment", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const phone = nextPhone();
    const appointment = await createAppointment({ businessId: bizAId, phone });

    const result = await postReschedule(
      app,
      reschedulePayload({
        businessId: bizAId,
        callId: `${RUN}-r10`,
        customerNumber: phone,
        args: {
          appointment_id: appointment.id,
          confirmed: true,
          new_date: "2020-01-01",
          new_time: "10:00"
        }
      })
    );

    expect(result.rescheduled).toBe(false);
    expect(result.code).toBe("INVALID_NEW_TIME");

    const row = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(row?.startAt.getTime()).toBe(appointment.startAt.getTime());
  });

  it("a guessed appointment id from another caller degrades to the generic no-match reply", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const victimPhone = nextPhone();
    const victim = await createAppointment({ businessId: bizAId, phone: victimPhone, service: "Implant" });

    const result = await postReschedule(
      app,
      reschedulePayload({
        businessId: bizAId,
        callId: `${RUN}-r11`,
        customerNumber: nextPhone(),
        args: {
          appointment_id: victim.id,
          confirmed: true,
          new_date: dateStrInTz(upcomingOpenDay(120)),
          new_time: "09:00"
        }
      })
    );

    expectPrivacySafeFailure(result, "CALLER_NUMBER_NOT_VERIFIED", NO_MATCH_MESSAGE);

    const row = await prisma.appointment.findUnique({ where: { id: victim.id } });
    expect(row?.startAt.getTime()).toBe(victim.startAt.getTime());
  });
});
