import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { buildBookingSlug, ensureBusinessBookingSlug, publicBookingRoutes } from "./booking-routes";

/**
 * Public booking/service-request API: booking always completes on its own
 * merits; the SMS consent checkbox is optional and only an explicit true
 * creates a WEB_FORM consent record. DB cases skip when the DB is down.
 */

const RUN = `pubbook-${process.pid}-${Date.now().toString(36)}`;

const originalEnv = {
  TWILIO_SMS_MODE: env.TWILIO_SMS_MODE,
  TWILIO_TEST_MODE: env.TWILIO_TEST_MODE
};

let dbAvailable = false;
let businessId = "";
let slug = "";

function buildApp() {
  const app = new Hono();
  app.route("/public", publicBookingRoutes);
  return app;
}

function postBooking(app: Hono, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+1619555${String(1000 + phoneCounter).slice(-4)}`;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[booking-routes.test] database unreachable — DB cases skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  const business = await prisma.business.create({
    data: { ownerId: owner.id, name: `${RUN} Dental & Co`, type: "dental" }
  });
  businessId = business.id;
  await prisma.businessProfile.create({
    data: { businessId, services: ["Cleaning", "Whitening"], timeZone: "America/New_York" }
  });
  slug = (await ensureBusinessBookingSlug(businessId)) ?? "";
}, 30_000);

afterAll(async () => {
  if (dbAvailable && businessId) {
    await prisma.smsExecution.deleteMany({ where: { businessId } });
    await prisma.smsConsent.deleteMany({ where: { businessId } });
    await prisma.appointment.deleteMany({ where: { businessId } });
    await prisma.lead.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { email: `${RUN}@test.local` } });
  }
  await prisma.$disconnect();
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

describe("buildBookingSlug", () => {
  it("builds a url-safe slug with a unique id suffix", () => {
    expect(buildBookingSlug("Bright Smile Dental & Co", "cabc123xyz456")).toBe(
      "bright-smile-dental-co-xyz456"
    );
    expect(buildBookingSlug("!!!", "cabc123xyz456")).toBe("xyz456");
  });
});

describe("public booking endpoints (DB)", () => {
  it("GET returns public business info without authentication", async () => {
    if (!dbAvailable) return;
    const app = buildApp();

    const response = await app.request(`/public/booking/${slug}`);
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { business: { name: string; services: string[] } } };
    expect(json.data.business.name).toBe(`${RUN} Dental & Co`);
    expect(json.data.business.services).toContain("Cleaning");
  });

  it("GET 404s for an unknown slug", async () => {
    if (!dbAvailable) return;
    const app = buildApp();
    const response = await app.request("/public/booking/does-not-exist");
    expect(response.status).toBe(404);
  });

  it("booking succeeds with the checkbox unchecked — and records no consent, sends no SMS", async () => {
    if (!dbAvailable) return;
    const app = buildApp();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const phone = nextPhone();

    const response = await postBooking(app, `/public/booking/${slug}`, {
      customerName: "Web Jane",
      customerPhone: phone,
      service: "Cleaning",
      preferredDate: "2027-03-02",
      preferredTime: "10:00",
      smsConsent: false
    });

    expect(response.status).toBe(201);
    const json = (await response.json()) as {
      data: { booking: { id: string; status: string }; smsConsent: string; smsSent: boolean };
    };
    expect(json.data.booking.status).toBe("REQUESTED");
    expect(json.data.smsConsent).toBe("NOT_REQUESTED");
    expect(json.data.smsSent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const appointment = await prisma.appointment.findUnique({ where: { id: json.data.booking.id } });
    expect(appointment?.customerPhone).toBe(phone);

    const consent = await prisma.smsConsent.findFirst({ where: { businessId, phoneNumber: phone } });
    expect(consent).toBeNull();
  });

  it("booking with the checkbox omitted behaves exactly like unchecked", async () => {
    if (!dbAvailable) return;
    const app = buildApp();
    const phone = nextPhone();

    const response = await postBooking(app, `/public/booking/${slug}`, {
      customerName: "Web Jane",
      customerPhone: phone
    });
    expect(response.status).toBe(201);

    const consent = await prisma.smsConsent.findFirst({ where: { businessId, phoneNumber: phone } });
    expect(consent).toBeNull();
  });

  it("a checked box creates WEB_FORM consent with booking id, URL, and metadata", async () => {
    if (!dbAvailable) return;
    env.TWILIO_SMS_MODE = "SIMULATED";
    const app = buildApp();
    const phone = nextPhone();

    const response = await postBooking(
      app,
      `/public/booking/${slug}`,
      {
        customerName: "Web Joe",
        customerPhone: phone,
        service: "Whitening",
        preferredDate: "2027-03-03",
        preferredTime: "14:30",
        smsConsent: true,
        sourceUrl: `https://triven.ai/book/${slug}`
      },
      { "x-forwarded-for": "203.0.113.77", "user-agent": "vitest-agent" }
    );

    expect(response.status).toBe(201);
    const json = (await response.json()) as {
      data: { booking: { id: string }; smsConsent: string; smsSent: boolean };
    };
    expect(json.data.smsConsent).toBe("OPTED_IN");
    expect(json.data.smsSent).toBe(true); // SIMULATED mode — no provider call.

    const consent = await prisma.smsConsent.findFirst({ where: { businessId, phoneNumber: phone } });
    expect(consent?.method).toBe("WEB_FORM");
    expect(consent?.status).toBe("OPTED_IN");
    expect(consent?.appointmentId).toBe(json.data.booking.id);
    expect(consent?.sourceUrl).toBe(`https://triven.ai/book/${slug}`);
    expect(consent?.ipAddress).toBe("203.0.113.77");
    expect(consent?.userAgent).toBe("vitest-agent");
  });

  it("rejects an invalid phone without creating anything", async () => {
    if (!dbAvailable) return;
    const app = buildApp();

    const response = await postBooking(app, `/public/booking/${slug}`, {
      customerName: "Bad Phone",
      customerPhone: "5551234"
    });
    expect(response.status).toBe(422);

    const appointment = await prisma.appointment.findFirst({
      where: { businessId, customerName: "Bad Phone" }
    });
    expect(appointment).toBeNull();
  });
});
