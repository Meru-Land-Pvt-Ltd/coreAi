import { describe, expect, it } from "vitest";
import type { UsageServicePricingRecord } from "../admin/usage-pricing-service";
import { buildListingUsagePricing } from "./listing-usage-pricing";

const now = new Date("2026-07-27T00:00:00.000Z");
const standardPipeline = {
  orchestrator: "vapi" as const,
  llmProvider: "openai",
  llmModel: "gpt-4o-mini",
  transcriberProvider: "deepgram",
  transcriberModel: "nova-3",
  voiceProvider: "elevenlabs",
  voiceModel: "eleven_flash_v2_5"
};

function service(
  serviceId: string,
  invoiceLabel: string,
  unit: UsageServicePricingRecord["unit"],
  billingCostMicroUsd: number,
  showInPhoneCallBreakdown = false
): UsageServicePricingRecord {
  return {
    pricingRecordId: `price-${serviceId}`,
    serviceId,
    name: `Internal ${serviceId}`,
    invoiceLabel,
    description: invoiceLabel,
    unit,
    actualCostMicroUsd: 999_999,
    billingCostMicroUsd,
    currency: "USD",
    showInPhoneCallBreakdown,
    active: true,
    sortOrder: 1,
    pricingVersion: `price-${serviceId}@${now.toISOString()}`,
    createdAt: now,
    updatedAt: now
  };
}

const records = [
  service("twilio_voice", "Inbound call connectivity", "PER_MINUTE", 8_500, true),
  service("deepgram_nova3", "Speech transcription", "PER_MINUTE", 7_700, true),
  service("openai_gpt4o_mini", "Conversation intelligence", "PER_MINUTE", 10_000, true),
  service("elevenlabs_flash_v25", "Voice output", "PER_MINUTE", 40_000, true),
  service("cartesia_sonic_2", "Voice output", "PER_MINUTE", 45_000, true),
  service("database_storage", "Call records", "PER_CALL", 200),
  service("sms_confirmation", "SMS confirmation", "PER_SMS", 10_000),
  service("google_calendar", "Appointment booking", "PER_UNIT", 0),
  // The old admin row remains present to prove checkout execution pricing
  // ignores it; assigned-number pricing now comes from Twilio.
  service("phone_number", "Dedicated Business Phone Number", "PER_UNIT", 2_000_000),
  service("unused_provider", "Unused provider", "PER_MINUTE", 500_000)
];

describe("listing checkout usage pricing", () => {
  it("uses the current Cartesia pipeline and admin rate by default", () => {
    const pricing = buildListingUsagePricing({
      records,
      requiredConnectors: ["phone_provider", "vapi", "cartesia"],
      needsPhoneNumber: true,
      phoneNumberBillingEnabled: true
    });

    expect(pricing.available).toBe(true);
    expect(pricing.services.map((row) => row.code)).toContain("cartesia_sonic_2");
    expect(pricing.services.map((row) => row.code)).not.toContain("elevenlabs_flash_v25");
    expect(pricing.perMinuteUsd).toBeCloseTo(0.0712, 8);
  });

  it("returns only services used by the listing with invoice labels and billing rates", () => {
    const pricing = buildListingUsagePricing({
      records,
      requiredConnectors: ["phone_provider", "vapi", "elevenlabs", "twilio", "google_calendar"],
      needsPhoneNumber: true,
      phoneNumberBillingEnabled: true,
      voicePipeline: standardPipeline
    });

    expect(pricing.available).toBe(true);
    expect(pricing.services.map((row) => row.code)).toEqual([
      "twilio_voice",
      "deepgram_nova3",
      "openai_gpt4o_mini",
      "elevenlabs_flash_v25",
      "database_storage",
      "sms_confirmation",
      "google_calendar"
    ]);
    expect(pricing.services).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unused_provider" })])
    );
    expect(
      pricing.services
        .filter((service) => service.showInPhoneCallBreakdown)
        .map((service) => service.code)
    ).toEqual([
      "twilio_voice",
      "deepgram_nova3",
      "openai_gpt4o_mini",
      "elevenlabs_flash_v25"
    ]);
    expect(pricing.services).toContainEqual({
      code: "openai_gpt4o_mini",
      invoiceLabel: "Conversation intelligence",
      unit: "PER_MINUTE",
      billingRateUsd: 0.01,
      showInPhoneCallBreakdown: true
    });
    expect(JSON.stringify(pricing)).not.toContain("actualCost");
    expect(pricing.perMinuteUsd).toBeCloseTo(0.0662, 8);
  });

  it("maps a non-voice SMS agent to only its configured SMS service", () => {
    const pricing = buildListingUsagePricing({
      records,
      requiredConnectors: ["twilio"],
      needsPhoneNumber: false,
      phoneNumberBillingEnabled: false,
      voicePipeline: standardPipeline
    });

    expect(pricing.services).toEqual([
      {
        code: "sms_confirmation",
        invoiceLabel: "SMS confirmation",
        unit: "PER_SMS",
        billingRateUsd: 0.01,
        showInPhoneCallBreakdown: false
      }
    ]);
  });

  it("never mixes the fixed monthly phone fee into execution pricing", () => {
    const pricing = buildListingUsagePricing({
      records,
      requiredConnectors: ["phone_provider"],
      needsPhoneNumber: true,
      phoneNumberBillingEnabled: false,
      voicePipeline: standardPipeline
    });

    expect(pricing).toEqual({
      available: true,
      perMinuteUsd: 0,
      services: []
    });
  });
});
