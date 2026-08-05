import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { handleVapiWebhook, resolveCallerContext } from "./twilio-business-routing";
import { appointmentAiRef } from "../compliance/ai-safe-results";

const { calendarPatchMock, calendarCreateMock } = await vi.hoisted(async () => {
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

const RUN = `altverif-${process.pid}-${Date.now().toString(36)}`;

describe("Returning Caller & 3-Factor Alternate Phone Verification Flow", () => {
  let dbAvailable = false;
  let testBusinessId = "";
  let testOwnerId = "";

  beforeAll(async () => {
    try {
      await prisma.$connect();
      const user = await prisma.user.create({
        data: {
          email: `${RUN}-owner@example.com`,
          passwordHash: "test-hash",
          role: "BUSINESS"
        }
      });
      testOwnerId = user.id;

      const biz = await prisma.business.create({
        data: {
          ownerId: testOwnerId,
          businessName: "Test Dental Care",
          businessType: "Dental Clinic",
          timeZone: "America/Los_Angeles"
        }
      });
      testBusinessId = biz.id;
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    if (dbAvailable && testOwnerId) {
      await prisma.appointment.deleteMany({ where: { businessId: testBusinessId } }).catch(() => null);
      await prisma.business.deleteMany({ where: { id: testBusinessId } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: testOwnerId } }).catch(() => null);
      await prisma.$disconnect().catch(() => null);
    }
  });

  beforeEach(() => {
    calendarPatchMock.mockReset();
    calendarCreateMock.mockReset();
    calendarPatchMock.mockResolvedValue({ success: true, htmlLink: "https://calendar.google.com/event/test" });
  });

  it("resolves caller context for returning callers with active appointments", async () => {
    if (!dbAvailable) return;

    const callerPhone = "+16505559090";
    const futureDate = new Date(Date.now() + 86400000 * 2);

    await prisma.appointment.create({
      data: {
        businessId: testBusinessId,
        customerPhone: callerPhone,
        customerName: "Jane Returning",
        customerEmail: "jane@example.com",
        service: "Teeth Cleaning",
        startAt: futureDate,
        endAt: new Date(futureDate.getTime() + 1800000),
        status: "BOOKED"
      }
    });

    const ctx = await resolveCallerContext(testBusinessId, callerPhone, "America/Los_Angeles");

    expect(ctx).not.toBeNull();
    expect(ctx?.callerIsReturning).toBe(true);
    expect(ctx?.hasUpcomingAppointment).toBe(true);
    expect(ctx?.callerName).toBe("Jane Returning");
    expect(ctx?.existingAppointmentCount).toBe(1);
    expect(ctx?.existingAppointmentsSummary).toContain("Teeth Cleaning");
  });

  it("verifies 3-factor authentication when all details match (Name + Phone + Email)", async () => {
    if (!dbAvailable) return;

    const bookingPhone = "+16505558080";
    const bookingEmail = "alice.smith@example.com";
    const bookingName = "Alice Smith";
    const futureDate = new Date(Date.now() + 86400000 * 3);

    const appt = await prisma.appointment.create({
      data: {
        businessId: testBusinessId,
        customerPhone: bookingPhone,
        customerName: bookingName,
        customerEmail: bookingEmail,
        service: "Consultation",
        startAt: futureDate,
        endAt: new Date(futureDate.getTime() + 1800000),
        status: "BOOKED"
      }
    });

    const app = new Hono();
    app.post("/vapi-webhook", (c) => handleVapiWebhook(c));

    const reqBody = {
      message: {
        type: "tool-calls",
        call: {
          id: `call-${RUN}-1`,
          customer: { number: "+16505551111" },
          metadata: { businessId: testBusinessId }
        },
        toolCalls: [
          {
            id: `tool-${RUN}-1`,
            function: {
              name: "verify_and_lookup_appointment",
              arguments: {
                full_name: "Alice Smith",
                booking_phone: bookingPhone,
                booking_email: bookingEmail
              }
            }
          }
        ]
      }
    };

    const res = await app.request("/vapi-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody)
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    const resultPayload = JSON.parse(json.results[0].result);
    expect(resultPayload.verified).toBe(true);
    expect(resultPayload.code).toBe("VERIFIED");
    expect(resultPayload.appointments.length).toBe(1);
    expect(resultPayload.appointments[0].appointment_id).toBe(appointmentAiRef(appt.id));
  });

  it("fails verification when email does not match", async () => {
    if (!dbAvailable) return;

    const bookingPhone = "+16505558080";
    const bookingEmail = "alice.smith@example.com";

    const app = new Hono();
    app.post("/vapi-webhook", (c) => handleVapiWebhook(c));

    const reqBody = {
      message: {
        type: "tool-calls",
        call: {
          id: `call-${RUN}-2`,
          customer: { number: "+16505551111" },
          metadata: { businessId: testBusinessId }
        },
        toolCalls: [
          {
            id: `tool-${RUN}-2`,
            function: {
              name: "verify_and_lookup_appointment",
              arguments: {
                full_name: "Alice Smith",
                booking_phone: bookingPhone,
                booking_email: "wrong.email@example.com"
              }
            }
          }
        ]
      }
    };

    const res = await app.request("/vapi-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody)
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    const resultPayload = JSON.parse(json.results[0].result);
    expect(resultPayload.verified).toBe(false);
    expect(resultPayload.code).toBe("VERIFICATION_FAILED");
  });

  it("rejects book_appointment tool call when service is Rescheduling", async () => {
    if (!dbAvailable) return;

    const app = new Hono();
    app.post("/vapi-webhook", (c) => handleVapiWebhook(c));

    const reqBody = {
      message: {
        type: "tool-calls",
        call: {
          id: `call-${RUN}-3`,
          customer: { number: "+16505559999" },
          metadata: { businessId: testBusinessId }
        },
        toolCalls: [
          {
            id: `tool-${RUN}-3`,
            function: {
              name: "book_appointment",
              arguments: {
                customer_name: "John Rescheduler",
                customer_phone: "+16505559999",
                date: "2026-08-10",
                time: "10:00",
                service_type: "Rescheduling appointment"
              }
            }
          }
        ]
      }
    };

    const res = await app.request("/vapi-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody)
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    const resultPayload = JSON.parse(json.results[0].result);
    expect(resultPayload.success).toBe(false);
    expect(resultPayload.code).toBe("USE_RESCHEDULE_TOOL");
  });
});
