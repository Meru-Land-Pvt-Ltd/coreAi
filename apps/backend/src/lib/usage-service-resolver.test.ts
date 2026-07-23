/**
 * Pipeline → usage-service-code resolution (pure, no DB).
 *
 * The resolver maps a resolved voice pipeline (llm/transcriber/voice hops +
 * telephony) to the EXACT set of PlatformUsageService codes the execution may
 * be billed for. Unknown hops make the whole execution UNKNOWN (→ UNPRICED),
 * never a silent guess. Codes only — rates always live in the DB.
 */

import { describe, expect, it } from "vitest";
import type { ResolvedVoicePipeline } from "../modules/compliance/workspace-ai-guard";
import {
  buildUsagePricingSnapshot,
  requiredServiceCodesForUsage,
  resolveApplicableUsageServiceCodes,
  UNKNOWN_USAGE_SERVICE_MAPPING,
  USAGE_SERVICE_CODES,
  USAGE_SERVICE_RESOLVER_VERSION
} from "./usage-service-resolver";

function standardPipeline(overrides: Partial<ResolvedVoicePipeline> = {}): ResolvedVoicePipeline {
  return {
    orchestrator: "vapi",
    llmProvider: "openai",
    llmModel: "gpt-4o-mini",
    transcriberProvider: "deepgram",
    transcriberModel: "nova-3",
    voiceProvider: "elevenlabs",
    voiceModel: "eleven_flash_v2_5",
    ...overrides
  };
}

function resolve(pipeline: ResolvedVoicePipeline, calendarUsed = false) {
  return resolveApplicableUsageServiceCodes({
    execution: { calendarUsed },
    installedAgent: null,
    voicePipeline: pipeline,
    providerMetadata: { telephonyProvider: "twilio" }
  });
}

const STANDARD_CODES = [
  USAGE_SERVICE_CODES.TWILIO_VOICE,
  USAGE_SERVICE_CODES.DEEPGRAM_NOVA3,
  USAGE_SERVICE_CODES.OPENAI_GPT4O_MINI,
  USAGE_SERVICE_CODES.ELEVENLABS_FLASH_V25,
  USAGE_SERVICE_CODES.DATABASE_STORAGE,
  USAGE_SERVICE_CODES.SMS_CONFIRMATION
];

describe("resolveApplicableUsageServiceCodes — standard pipeline", () => {
  it("resolves the standard pipeline to EXACTLY the six standard codes (no google_calendar)", () => {
    const resolution = resolve(standardPipeline(), false);
    expect(resolution.state).toBe("RESOLVED");
    if (resolution.state !== "RESOLVED") return;
    expect([...resolution.codes].sort()).toEqual([...STANDARD_CODES].sort());
    expect(resolution.codes).not.toContain(USAGE_SERVICE_CODES.GOOGLE_CALENDAR);
  });

  it("calendarUsed true adds google_calendar and nothing else", () => {
    const resolution = resolve(standardPipeline(), true);
    expect(resolution.state).toBe("RESOLVED");
    if (resolution.state !== "RESOLVED") return;
    expect([...resolution.codes].sort()).toEqual(
      [...STANDARD_CODES, USAGE_SERVICE_CODES.GOOGLE_CALENDAR].sort()
    );
  });

  it("output carries codes and mappings only — no rate figures anywhere", () => {
    const resolution = resolve(standardPipeline(), true);
    expect(resolution.state).toBe("RESOLVED");
    if (resolution.state !== "RESOLVED") return;
    expect(Object.keys(resolution).sort()).toEqual(["codes", "mappings", "state"]);
    for (const mapping of resolution.mappings) {
      expect(Object.keys(mapping).sort()).toEqual(["hop", "model", "provider", "serviceCode"]);
    }
    // No monetary fields sneak into the resolver output.
    expect(JSON.stringify(resolution)).not.toMatch(/microusd|rate|cost|cents|price/i);
    for (const code of resolution.codes) expect(typeof code).toBe("string");
  });
});

describe("resolveApplicableUsageServiceCodes — unknown hops fail closed", () => {
  it("openai gpt-4o (NOT mini) is UNKNOWN — the gpt4omini prefix never matches gpt-4o", () => {
    const resolution = resolve(standardPipeline({ llmModel: "gpt-4o" }));
    expect(resolution.state).toBe("UNKNOWN");
    if (resolution.state !== "UNKNOWN") return;
    expect(resolution.code).toBe(UNKNOWN_USAGE_SERVICE_MAPPING);
    expect(resolution.unknownHops).toEqual([
      { hop: "llm", provider: "openai", model: "gpt-4o" }
    ]);
    // The llm hop must NOT have been mapped to the mini service.
    const llmMapping = resolution.mappings.find((mapping) => mapping.hop === "llm");
    expect(llmMapping?.serviceCode).toBeNull();
  });

  it("anthropic LLM is UNKNOWN", () => {
    const resolution = resolve(
      standardPipeline({ llmProvider: "anthropic", llmModel: "claude-3-5-sonnet" })
    );
    expect(resolution.state).toBe("UNKNOWN");
    if (resolution.state !== "UNKNOWN") return;
    expect(resolution.unknownHops.some((hop) => hop.hop === "llm" && hop.provider === "anthropic")).toBe(true);
  });

  it("unknown voice provider (cartesia) is UNKNOWN", () => {
    const resolution = resolve(standardPipeline({ voiceProvider: "cartesia", voiceModel: "sonic" }));
    expect(resolution.state).toBe("UNKNOWN");
    if (resolution.state !== "UNKNOWN") return;
    expect(resolution.unknownHops.some((hop) => hop.hop === "voice" && hop.provider === "cartesia")).toBe(true);
  });

  it("missing voiceModel (vapi built-in voice) is UNKNOWN — never guessed", () => {
    const pipeline = standardPipeline();
    delete pipeline.voiceModel;
    const resolution = resolve(pipeline);
    expect(resolution.state).toBe("UNKNOWN");
    if (resolution.state !== "UNKNOWN") return;
    expect(resolution.unknownHops).toEqual([{ hop: "voice", provider: "elevenlabs", model: null }]);
  });
});

describe("model id normalization", () => {
  it("separator/case variants of eleven_flash_v2_5 all match elevenlabs_flash_v25", () => {
    for (const variant of ["Eleven_Flash_V2_5", "eleven-flash-v2.5"]) {
      const resolution = resolve(standardPipeline({ voiceModel: variant }));
      expect(resolution.state).toBe("RESOLVED");
      if (resolution.state !== "RESOLVED") continue;
      expect(resolution.codes).toContain(USAGE_SERVICE_CODES.ELEVENLABS_FLASH_V25);
    }
  });

  it("nova-3-general matches deepgram_nova3 by prefix", () => {
    const resolution = resolve(standardPipeline({ transcriberModel: "nova-3-general" }));
    expect(resolution.state).toBe("RESOLVED");
    if (resolution.state !== "RESOLVED") return;
    expect(resolution.codes).toContain(USAGE_SERVICE_CODES.DEEPGRAM_NOVA3);
  });
});

describe("requiredServiceCodesForUsage", () => {
  const applicable = [...STANDARD_CODES, USAGE_SERVICE_CODES.GOOGLE_CALENDAR];

  it("sms_confirmation is required only when smsCount > 0", () => {
    const withoutSms = requiredServiceCodesForUsage(applicable, {
      durationMinutes: 2,
      smsCount: 0,
      calendarUsed: false
    });
    expect(withoutSms.has(USAGE_SERVICE_CODES.SMS_CONFIRMATION)).toBe(false);

    const withSms = requiredServiceCodesForUsage(applicable, {
      durationMinutes: 2,
      smsCount: 1,
      calendarUsed: false
    });
    expect(withSms.has(USAGE_SERVICE_CODES.SMS_CONFIRMATION)).toBe(true);
  });

  it("google_calendar is required only when the calendar was used", () => {
    const noCalendar = requiredServiceCodesForUsage(applicable, {
      durationMinutes: 2,
      smsCount: 0,
      calendarUsed: false
    });
    expect(noCalendar.has(USAGE_SERVICE_CODES.GOOGLE_CALENDAR)).toBe(false);

    const withCalendar = requiredServiceCodesForUsage(applicable, {
      durationMinutes: 2,
      smsCount: 0,
      calendarUsed: true
    });
    expect(withCalendar.has(USAGE_SERVICE_CODES.GOOGLE_CALENDAR)).toBe(true);
  });

  it("voice components are required only when the call had minutes", () => {
    const zeroMinutes = requiredServiceCodesForUsage(applicable, {
      durationMinutes: 0,
      smsCount: 0,
      calendarUsed: false
    });
    expect(zeroMinutes.size).toBe(0);

    const withMinutes = requiredServiceCodesForUsage(applicable, {
      durationMinutes: 1.5,
      smsCount: 0,
      calendarUsed: false
    });
    expect([...withMinutes].sort()).toEqual(
      [
        USAGE_SERVICE_CODES.TWILIO_VOICE,
        USAGE_SERVICE_CODES.DEEPGRAM_NOVA3,
        USAGE_SERVICE_CODES.OPENAI_GPT4O_MINI,
        USAGE_SERVICE_CODES.ELEVENLABS_FLASH_V25,
        USAGE_SERVICE_CODES.DATABASE_STORAGE
      ].sort()
    );
  });
});

describe("buildUsagePricingSnapshot", () => {
  it("RESOLVED → unpricedReason null, applicableServiceCodes populated, resolver version stamped", () => {
    const pipeline = standardPipeline();
    const resolution = resolve(pipeline, false);
    expect(resolution.state).toBe("RESOLVED");

    const snapshot = buildUsagePricingSnapshot({
      pipeline,
      telephonyProvider: "twilio",
      calendarUsed: false,
      resolution
    });

    expect(snapshot.resolverVersion).toBe(USAGE_SERVICE_RESOLVER_VERSION);
    expect(snapshot.unpricedReason).toBeNull();
    expect(snapshot.unknownHops).toBeUndefined();
    expect([...snapshot.applicableServiceCodes].sort()).toEqual([...STANDARD_CODES].sort());
    expect(snapshot.pipeline).toMatchObject({
      llmProvider: "openai",
      llmModel: "gpt-4o-mini",
      telephonyProvider: "twilio"
    });
  });

  it("UNKNOWN resolution → unpricedReason UNKNOWN_USAGE_SERVICE_MAPPING with unknownHops present", () => {
    const pipeline = standardPipeline({ llmProvider: "anthropic", llmModel: "claude-3" });
    const resolution = resolve(pipeline, false);
    expect(resolution.state).toBe("UNKNOWN");

    const snapshot = buildUsagePricingSnapshot({
      pipeline,
      telephonyProvider: "twilio",
      calendarUsed: false,
      resolution
    });

    expect(snapshot.resolverVersion).toBe(USAGE_SERVICE_RESOLVER_VERSION);
    expect(snapshot.unpricedReason).toBe(UNKNOWN_USAGE_SERVICE_MAPPING);
    expect(snapshot.unknownHops?.length).toBeGreaterThan(0);
    expect(snapshot.applicableServiceCodes).toEqual([]);
  });
});
