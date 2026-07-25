/**
 * Canonical pricing layer: Admin Pricing API contract (the same records the
 * execution calculator uses), the current eight-service fixture (per-minute
 * billing AND actual totals exactly $0.0664), active/inactive/zero-rate
 * semantics, UNPRICED on missing configuration, the buyer-safe projection
 * (never exposes vendor cost), and dynamic five-minute / SMS execution math.
 *
 * The eight fixture services are seeded with RUN-prefixed codes at the CURRENT
 * production rates so assertions target the controlled subset (the shared dev
 * DB may hold the real records too) and are deleted afterwards.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { adminPricingRoutes } from "./pricing-routes";
import {
  buyerExecutionPricingView,
  listUsageServicePricing,
  loadActiveUsageServicePricing,
  sumPerMinuteActualMicroUsd,
  sumPerMinuteBillingMicroUsd
} from "./usage-pricing-service";
import {
  calculateUsageLineItems,
  priceExecutionUsage,
  sumLineItems,
  usdToMicroUsd
} from "../../lib/usage-pricing";

const RUN = `pxsvc${Date.now().toString(36)}`;

/** The current API-backed configuration, verbatim rates (micro-USD). */
const FIXTURE_SERVICES = [
  { code: `${RUN}_twilio_voice`, name: "Twilio Voice", role: "Inbound call connectivity", unit: "PER_MINUTE", actual: 8_500, billing: 8_500 },
  { code: `${RUN}_deepgram_nova3`, name: "Deepgram Nova 3", role: "Speech-to-text transcription", unit: "PER_MINUTE", actual: 7_700, billing: 7_700 },
  { code: `${RUN}_openai_gpt4o_mini`, name: "OpenAI GPT-4o Mini", role: "Conversation intelligence / LLM", unit: "PER_MINUTE", actual: 10_000, billing: 10_000 },
  { code: `${RUN}_elevenlabs_flash_v25`, name: "ElevenLabs Flash v2.5", role: "Text-to-speech voice output", unit: "PER_MINUTE", actual: 40_000, billing: 40_000 },
  { code: `${RUN}_database_storage`, name: "Firebase / MongoDB", role: "Call logs and records", unit: "PER_MINUTE", actual: 200, billing: 200 },
  { code: `${RUN}_google_calendar`, name: "Google Calendar API", role: "Appointment booking", unit: "PER_MINUTE", actual: 0, billing: 0 },
  { code: `${RUN}_sms_confirmation`, name: "SMS Confirmation", role: "SMS confirmations", unit: "PER_SMS", actual: 10_000, billing: 10_000 },
  { code: `${RUN}_phone_number`, name: "AI Receptionist No.", role: "Dedicated phone number", unit: "PER_UNIT", actual: 1_150_000, billing: 2_000_000 }
] as const;

const INACTIVE_CODE = `${RUN}_legacy_inactive`;

let dbAvailable = false;

function isFixture(code: string): boolean {
  return code.startsWith(RUN);
}

function app() {
  const instance = new Hono();
  instance.route("/admin/pricing", adminPricingRoutes);
  return instance;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[usage-pricing-service.test] database unreachable — suite skipped");
    return;
  }

  await prisma.platformUsageService.createMany({
    data: [
      ...FIXTURE_SERVICES.map((service, index) => ({
        code: service.code,
        name: service.name,
        role: service.role,
        unit: service.unit,
        actualCostMicroUsd: service.actual,
        updatedCostMicroUsd: service.billing,
        isActive: true,
        sortOrder: 9000 + index
      })),
      {
        code: INACTIVE_CODE,
        name: "Legacy Service",
        role: "Deactivated legacy rate",
        unit: "PER_MINUTE",
        actualCostMicroUsd: 99_000,
        updatedCostMicroUsd: 99_000,
        isActive: false,
        sortOrder: 9999
      }
    ]
  });
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.platformUsageService.deleteMany({ where: { code: { startsWith: RUN } } });
  await prisma.$disconnect();
});

describe("Admin Pricing Services API contract", () => {
  it("returns all eight fixture services with the documented field names; includeInactive gates inactive records", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const withInactive = await app().request("/admin/pricing/services?includeInactive=true");
    expect(withInactive.status).toBe(200);
    const body = (await withInactive.json()) as {
      data: { services: Array<Record<string, unknown>>; totals: Record<string, number> };
    };
    const fixture = body.data.services.filter((service) => isFixture(String(service.code)));
    expect(fixture).toHaveLength(9); // 8 active + 1 inactive

    const twilio = fixture.find((service) => String(service.code).endsWith("twilio_voice"));
    expect(twilio).toMatchObject({
      name: "Twilio Voice",
      role: "Inbound call connectivity",
      unit: "PER_MINUTE",
      actualCostUsd: 0.0085,
      updatedCostUsd: 0.0085,
      actualCostMicroUsd: 8_500,
      updatedCostMicroUsd: 8_500,
      isActive: true
    });
    expect(typeof twilio?.id).toBe("string");
    expect(typeof twilio?.updatedAt).toBe("string");

    const inactive = fixture.find((service) => service.code === INACTIVE_CODE);
    expect(inactive?.isActive).toBe(false);

    const withoutInactive = await app().request("/admin/pricing/services");
    const activeBody = (await withoutInactive.json()) as { data: { services: Array<Record<string, unknown>> } };
    const activeFixture = activeBody.data.services.filter((service) => isFixture(String(service.code)));
    expect(activeFixture).toHaveLength(8);
    expect(activeFixture.some((service) => service.code === INACTIVE_CODE)).toBe(false);
  });

  it("the API and the internal canonical pricing service return consistent values", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const response = await app().request("/admin/pricing/services?includeInactive=true");
    const body = (await response.json()) as { data: { services: Array<Record<string, unknown>> } };
    const records = await listUsageServicePricing({ includeInactive: true });

    for (const service of FIXTURE_SERVICES) {
      const apiRow = body.data.services.find((row) => row.code === service.code);
      const record = records.find((row) => row.serviceId === service.code);
      expect(apiRow, service.code).toBeTruthy();
      expect(record, service.code).toBeTruthy();
      expect(apiRow?.actualCostMicroUsd).toBe(record?.actualCostMicroUsd);
      expect(apiRow?.updatedCostMicroUsd).toBe(record?.billingCostMicroUsd);
      expect(apiRow?.unit).toBe(record?.unit);
      expect(apiRow?.isActive).toBe(record?.active);
      expect(apiRow?.id).toBe(record?.pricingRecordId);
    }
  });

  it("the fixture per-minute totals are exactly $0.0664 (billing AND actual), with the zero-rate service counted as active", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const records = (await loadActiveUsageServicePricing()).filter((record) => isFixture(record.serviceId));

    expect(sumPerMinuteBillingMicroUsd(records)).toBe(usdToMicroUsd(0.0664));
    expect(sumPerMinuteActualMicroUsd(records)).toBe(usdToMicroUsd(0.0664));

    // google_calendar at $0 is ACTIVE valid configuration — present, not missing.
    const calendar = records.find((record) => record.serviceId.endsWith("google_calendar"));
    expect(calendar?.active).toBe(true);
    expect(calendar?.billingCostMicroUsd).toBe(0);

    // The inactive legacy record is excluded from new execution pricing.
    expect(records.some((record) => record.serviceId === INACTIVE_CODE)).toBe(false);
  });
});

describe("dynamic execution-cost calculation (controlled fixture)", () => {
  const fixtureRecords = FIXTURE_SERVICES.map((service) => ({
    serviceId: service.code,
    name: service.name,
    invoiceLabel: service.role,
    unit: service.unit,
    actualCostMicroUsd: service.actual,
    billingCostMicroUsd: service.billing,
    pricingRecordId: `rec_${service.code}`,
    pricingVersion: `rec_${service.code}@fixture`
  }));

  it("a five-minute execution uses the dynamic combined rate; SMS adds its own rate; phone number is never per-call", () => {
    const lines = calculateUsageLineItems(fixtureRecords, { durationMinutes: 5, smsCount: 1 });
    const totals = sumLineItems(lines);

    // 5 min × $0.0664 + 1 × $0.01 — derived from the records, not hardcoded
    // in runtime logic (this fixture is the controlled test data).
    expect(totals.billedCostMicroUsd).toBe(5 * usdToMicroUsd(0.0664) + usdToMicroUsd(0.01));
    expect(totals.actualCostMicroUsd).toBe(5 * usdToMicroUsd(0.0664) + usdToMicroUsd(0.01));

    // The PER_UNIT phone-number service must not appear on a call execution.
    expect(lines.some((line) => line.serviceCode.endsWith("phone_number"))).toBe(false);
    // The zero-rate calendar service stays a valid priced-at-zero component.
    const calendarLine = lines.find((line) => line.serviceCode.endsWith("google_calendar"));
    expect(calendarLine?.quantity).toBe(5);
    expect(calendarLine?.billedCostMicroUsd).toBe(0);
    // Rate snapshots ride on every line for reproducibility.
    expect(lines.every((line) => typeof line.billingRateMicroUsd === "number")).toBe(true);
    expect(lines.every((line) => typeof line.pricingVersion === "string")).toBe(true);
    expect(lines.every((line) => line.currency === "USD")).toBe(true);
  });

  it("no SMS means no SMS line at all; unused services are never added", () => {
    const lines = calculateUsageLineItems(fixtureRecords, { durationMinutes: 2, smsCount: 0 });
    expect(lines.some((line) => line.unit === "PER_SMS")).toBe(false);
    expect(lines.some((line) => line.unit === "PER_UNIT")).toBe(false);
  });

  it("a missing required per-minute rate is UNPRICED (USAGE_RATE_NOT_CONFIGURED), never silent zero", () => {
    const smsOnly = fixtureRecords.filter((record) => record.unit !== "PER_MINUTE");
    const result = priceExecutionUsage(smsOnly, { durationMinutes: 3 });
    expect(result).toEqual({ state: "UNPRICED", code: "USAGE_RATE_NOT_CONFIGURED" });

    // With per-minute records present (even zero-rate ones), pricing succeeds.
    const priced = priceExecutionUsage(fixtureRecords, { durationMinutes: 3 });
    expect(priced.state).toBe("PRICED");
  });
});

describe("buyer-safe pricing projection", () => {
  it("exposes billing rates with breakdown, SMS and phone-number entries — and never vendor actual costs", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const records = (await loadActiveUsageServicePricing()).filter((record) => isFixture(record.serviceId));
    const view = buyerExecutionPricingView(records);

    expect(view.currency).toBe("USD");
    expect(view.voice.billingRatePerMinuteUsd).toBeCloseTo(0.0664, 6);
    expect(view.voice.serviceBreakdown).toHaveLength(6);
    expect(view.sms?.billingRateUsd).toBeCloseTo(0.01, 6);
    expect(view.phoneNumber?.billingRateUsd).toBeCloseTo(2.0, 6);
    // phone number billed at $2.00 even though vendor cost is $1.15 — and the
    // vendor figure must not be derivable from the buyer view.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("actualCost");
    expect(serialized).not.toContain("1.15");
  });
});
