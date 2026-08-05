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

  it("verifies 2-factor authentication when details match (Name + Phone)", async () => {
    if (!dbAvailable) return;

    const bookingPhone = "+16505558080";
    const bookingName = "Alice Smith";
    const futureDate = new Date(Date.now() + 86400000 * 3);

    const appt = await prisma.appointment.create({
      data: {
        businessId: testBusinessId,
        customerPhone: bookingPhone,
        customerName: bookingName,
        customerEmail: "alice.smith@example.com",
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
                booking_phone: bookingPhone
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

  it("fails verification when name does not match", async () => {
    if (!dbAvailable) return;

    const bookingPhone = "+16505558080";

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
                full_name: "Bob WrongName",
                booking_phone: bookingPhone
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

  it("allows reschedule_appointment after alternate phone verification without requiring email", async () => {
    if (!dbAvailable) return;

    const bookingPhone = "+16505557070";
    const bookingName = "Charlie Reschedule";
    const futureDate = new Date(Date.now() + 86400000 * 4);

    const appt = await prisma.appointment.create({
      data: {
        businessId: testBusinessId,
        customerPhone: bookingPhone,
        customerName: bookingName,
        customerEmail: "charlie@example.com",
        service: "Checkup",
        startAt: futureDate,
        endAt: new Date(futureDate.getTime() + 1800000),
        status: "BOOKED"
      }
    });

    const app = new Hono();
    app.post("/vapi-webhook", (c) => handleVapiWebhook(c));

    // Step 1: verify_and_lookup_appointment (caller on alternate phone +16505550000)
    const verifRes = await app.request("/vapi-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: `call-${RUN}-r1`, customer: { number: "+16505550000" }, metadata: { businessId: testBusinessId } },
          toolCalls: [
            {
              id: `tool-${RUN}-v1`,
              function: {
                name: "verify_and_lookup_appointment",
                arguments: { full_name: "Charlie Reschedule", booking_phone: bookingPhone }
              }
            }
          ]
        }
      })
    });
    const verifJson = await verifRes.json();
    const verifPayload = JSON.parse(verifJson.results[0].result);
    expect(verifPayload.verified).toBe(true);
    const appointmentAiId = verifPayload.appointments[0].appointment_id;

    // Step 2: reschedule_appointment using HMAC appointment_id from alternate phone
    const reschedRes = await app.request("/vapi-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: `call-${RUN}-r1`, customer: { number: "+16505550000" }, metadata: { businessId: testBusinessId } },
          toolCalls: [
            {
              id: `tool-${RUN}-r1`,
              function: {
                name: "reschedule_appointment",
                arguments: {
                  appointment_id: appointmentAiId,
                  new_date: "2026-08-20",
                  new_time: "14:00",
                  confirmed: true
                }
              }
            }
          ]
        }
      })
    });

    expect(reschedRes.status).toBe(200);
    const reschedJson = await reschedRes.json();
    const reschedPayload = JSON.parse(reschedJson.results[0].result);
    expect(reschedPayload.rescheduled).toBe(true);
    expect(reschedPayload.code).toBe("RESCHEDULED");

    // Verify DB update
    const updatedAppt = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(updatedAppt?.startAt.toISOString()).toContain("2026-08-20");
  });

  it("allows cancel_appointment after alternate phone verification without requiring email", async () => {
    if (!dbAvailable) return;

    const bookingPhone = "+16505556060";
    const bookingName = "David Cancel";
    const futureDate = new Date(Date.now() + 86400000 * 5);

    await prisma.appointment.create({
      data: {
        businessId: testBusinessId,
        customerPhone: bookingPhone,
        customerName: bookingName,
        customerEmail: "david@example.com",
        service: "Cleaning",
        startAt: futureDate,
        endAt: new Date(futureDate.getTime() + 1800000),
        status: "BOOKED"
      }
    });

    const app = new Hono();
    app.post("/vapi-webhook", (c) => handleVapiWebhook(c));

    // Step 1: verify_and_lookup_appointment
    const verifRes = await app.request("/vapi-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: `call-${RUN}-c1`, customer: { number: "+16505550000" }, metadata: { businessId: testBusinessId } },
          toolCalls: [
            {
              id: `tool-${RUN}-v2`,
              function: {
                name: "verify_and_lookup_appointment",
                arguments: { full_name: "David Cancel", booking_phone: bookingPhone }
              }
            }
          ]
        }
      })
    });
    const verifJson = await verifRes.json();
    const verifPayload = JSON.parse(verifJson.results[0].result);
    expect(verifPayload.verified).toBe(true);
    const appointmentAiId = verifPayload.appointments[0].appointment_id;

    // Step 2: cancel_appointment using HMAC appointment_id
    const cancelRes = await app.request("/vapi-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: `call-${RUN}-c1`, customer: { number: "+16505550000" }, metadata: { businessId: testBusinessId } },
          toolCalls: [
            {
              id: `tool-${RUN}-c1`,
              function: {
                name: "cancel_appointment",
                arguments: {
                  appointment_id: appointmentAiId,
                  confirmed: true
                }
              }
            }
          ]
        }
      })
    });

    expect(cancelRes.status).toBe(200);
    const cancelJson = await cancelRes.json();
    const cancelPayload = JSON.parse(cancelJson.results[0].result);
    expect(cancelPayload.cancelled).toBe(true);
    expect(cancelPayload.code).toBe("CANCELLED");
  });
});
