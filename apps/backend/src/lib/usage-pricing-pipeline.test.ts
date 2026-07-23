/**
 * Pipeline-aware pricing (pure, no DB): priceExecutionUsage /
 * calculateUsageLineItems with applicableServiceCodes + requiredServiceCodes.
 *
 * Fixture service arrays are constructed here with their OWN distinct rates —
 * never the dev DB's seeded rows — including two active PER_MINUTE "LLM"
 * services and two voice services, so no-stacking behavior is observable.
 */

import { describe, expect, it } from "vitest";
import type { UsageServiceUnit } from "@prisma/client";
import {
  calculateUsageLineItems,
  priceExecutionUsage,
  type PricingServiceRecordInput
} from "./usage-pricing";
import { requiredServiceCodesForUsage } from "./usage-service-resolver";

function svc(
  serviceId: string,
  unit: UsageServiceUnit,
  actualCostMicroUsd: number,
  billingCostMicroUsd: number
): PricingServiceRecordInput {
  return {
    serviceId,
    name: `Fixture ${serviceId}`,
    unit,
    actualCostMicroUsd,
    billingCostMicroUsd,
    pricingRecordId: `rec-${serviceId}`,
    pricingVersion: `v1-${serviceId}`
  };
}

/** Two active PER_MINUTE LLM-ish services and two voice services on purpose. */
function fixtureServices(): PricingServiceRecordInput[] {
  return [
    svc("twilio_voice", "PER_MINUTE", 8_000, 10_000),
    svc("deepgram_nova3", "PER_MINUTE", 7_000, 9_000),
    svc("openai_gpt4o_mini", "PER_MINUTE", 5_000, 6_000),
    svc("other_llm", "PER_MINUTE", 50_000, 60_000),
    svc("elevenlabs_flash_v25", "PER_MINUTE", 30_000, 40_000),
    svc("other_voice", "PER_MINUTE", 70_000, 80_000),
    svc("sms_confirmation", "PER_SMS", 8_000, 10_000),
    svc("database_storage", "PER_CALL", 100, 200)
  ];
}

const STANDARD_APPLICABLE = new Set([
  "twilio_voice",
  "deepgram_nova3",
  "openai_gpt4o_mini",
  "elevenlabs_flash_v25",
  "sms_confirmation",
  "database_storage"
]);

describe("pipeline-aware selection — no stacking", () => {
  it("bills only the applicable LLM: other_llm produces NO line item", () => {
    const result = priceExecutionUsage(
      fixtureServices(),
      { durationMinutes: 2, smsCount: 1, callCount: 1 },
      { applicableServiceCodes: STANDARD_APPLICABLE }
    );

    expect(result.state).toBe("PRICED");
    if (result.state !== "PRICED") return;
    const codes = result.lineItems.map((item) => item.serviceCode);
    expect(codes).toContain("openai_gpt4o_mini");
    expect(codes).not.toContain("other_llm");
  });

  it("bills only the applicable voice service: other_voice produces NO line item", () => {
    const result = priceExecutionUsage(
      fixtureServices(),
      { durationMinutes: 2, smsCount: 1, callCount: 1 },
      { applicableServiceCodes: STANDARD_APPLICABLE }
    );

    expect(result.state).toBe("PRICED");
    if (result.state !== "PRICED") return;
    const codes = result.lineItems.map((item) => item.serviceCode);
    expect(codes).toContain("elevenlabs_flash_v25");
    expect(codes).not.toContain("other_voice");
    // Exactly the applicable set (all quantities are positive here).
    expect([...codes].sort()).toEqual([...STANDARD_APPLICABLE].sort());
    // Totals reflect only applicable services:
    // per-minute (10000+9000+6000+40000)*2 + sms 10000*1 + per-call 200*1
    expect(result.totals.billedCostMicroUsd).toBe(140_200);
  });
});

describe("required codes — deactivated genuinely-used component is never silent-free", () => {
  it("an applicable+required code with no active service record → UNPRICED listing the code", () => {
    // elevenlabs_flash_v25 deactivated (excluded from the active services
    // array) while the pipeline genuinely used it.
    const withoutVoice = fixtureServices().filter(
      (service) => service.serviceId !== "elevenlabs_flash_v25"
    );
    const required = requiredServiceCodesForUsage([...STANDARD_APPLICABLE], {
      durationMinutes: 2,
      smsCount: 1,
      calendarUsed: false
    });

    const result = priceExecutionUsage(
      withoutVoice,
      { durationMinutes: 2, smsCount: 1, callCount: 1 },
      { applicableServiceCodes: STANDARD_APPLICABLE, requiredServiceCodes: required }
    );

    expect(result.state).toBe("UNPRICED");
    if (result.state !== "UNPRICED") return;
    expect(result.code).toBe("USAGE_RATE_NOT_CONFIGURED");
    expect(result.missingServiceCodes).toEqual(["elevenlabs_flash_v25"]);
  });

  it("zero-quantity sms_confirmation missing from active services → still PRICED", () => {
    const withoutSms = fixtureServices().filter(
      (service) => service.serviceId !== "sms_confirmation"
    );
    const required = requiredServiceCodesForUsage([...STANDARD_APPLICABLE], {
      durationMinutes: 2,
      smsCount: 0,
      calendarUsed: false
    });
    expect(required.has("sms_confirmation")).toBe(false);

    const result = priceExecutionUsage(
      withoutSms,
      { durationMinutes: 2, smsCount: 0, callCount: 1 },
      { applicableServiceCodes: STANDARD_APPLICABLE, requiredServiceCodes: required }
    );

    expect(result.state).toBe("PRICED");
    if (result.state !== "PRICED") return;
    expect(result.lineItems.map((item) => item.serviceCode)).not.toContain("sms_confirmation");
  });
});

describe("rate snapshots", () => {
  it("a rate change affects only NEW pricing calls — prior results are value snapshots", () => {
    const services = fixtureServices();
    const first = priceExecutionUsage(
      services,
      { durationMinutes: 2, smsCount: 0, callCount: 1 },
      { applicableServiceCodes: STANDARD_APPLICABLE }
    );
    expect(first.state).toBe("PRICED");
    if (first.state !== "PRICED") return;
    const firstFrozen = JSON.parse(JSON.stringify(first)) as typeof first;

    // Rate A → rate B on the LLM service.
    const llm = services.find((service) => service.serviceId === "openai_gpt4o_mini");
    if (!llm) throw new Error("fixture missing openai_gpt4o_mini");
    llm.billingCostMicroUsd = 99_000;

    const second = priceExecutionUsage(
      services,
      { durationMinutes: 2, smsCount: 0, callCount: 1 },
      { applicableServiceCodes: STANDARD_APPLICABLE }
    );
    expect(second.state).toBe("PRICED");
    if (second.state !== "PRICED") return;

    // First result unchanged (deep equality to its pre-mutation snapshot).
    expect(first).toEqual(firstFrozen);
    const firstLlmLine = first.lineItems.find((item) => item.serviceCode === "openai_gpt4o_mini");
    const secondLlmLine = second.lineItems.find((item) => item.serviceCode === "openai_gpt4o_mini");
    expect(firstLlmLine?.billedCostMicroUsd).toBe(12_000); // 6_000 * 2 min (rate A)
    expect(secondLlmLine?.billedCostMicroUsd).toBe(198_000); // 99_000 * 2 min (rate B)
  });
});

describe("legacy behavior without options", () => {
  it("no options → every active service bills (both LLMs and both voices stack)", () => {
    const lines = calculateUsageLineItems(fixtureServices(), {
      durationMinutes: 1,
      smsCount: 1,
      callCount: 1
    });
    const codes = lines.map((item) => item.serviceCode);
    expect(codes).toContain("openai_gpt4o_mini");
    expect(codes).toContain("other_llm");
    expect(codes).toContain("elevenlabs_flash_v25");
    expect(codes).toContain("other_voice");
    expect(codes).toHaveLength(fixtureServices().length);

    const priced = priceExecutionUsage(fixtureServices(), {
      durationMinutes: 1,
      smsCount: 1,
      callCount: 1
    });
    expect(priced.state).toBe("PRICED");
    if (priced.state !== "PRICED") return;
    expect(priced.lineItems.map((item) => item.serviceCode).sort()).toEqual([...codes].sort());
  });
});
