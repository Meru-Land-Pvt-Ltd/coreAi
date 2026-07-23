import type { ResolvedVoicePipeline } from "../modules/compliance/workspace-ai-guard";

/**
 * Deterministic pipeline → PlatformUsageService code resolution.
 *
 * Service CODES are configuration constants here; RATES always come from the
 * PlatformUsageService table (never hardcoded). A call is priced only for the
 * services its pipeline actually used — never "every active PER_MINUTE
 * service". A hop whose provider/model has no mapping makes the whole
 * execution UNPRICED with UNKNOWN_USAGE_SERVICE_MAPPING so an administrator
 * can reconcile it; we never guess and never invoice zero.
 */

export const UNKNOWN_USAGE_SERVICE_MAPPING = "UNKNOWN_USAGE_SERVICE_MAPPING";

/** Bump when mapping semantics change — stored in every pricing snapshot. */
export const USAGE_SERVICE_RESOLVER_VERSION = "2026-07.v1";

export const USAGE_SERVICE_CODES = {
  TWILIO_VOICE: "twilio_voice",
  DEEPGRAM_NOVA3: "deepgram_nova3",
  OPENAI_GPT4O_MINI: "openai_gpt4o_mini",
  ELEVENLABS_FLASH_V25: "elevenlabs_flash_v25",
  SMS_CONFIRMATION: "sms_confirmation",
  DATABASE_STORAGE: "database_storage",
  GOOGLE_CALENDAR: "google_calendar"
} as const;

export type PipelineHop = "telephony" | "transcriber" | "llm" | "voice";

export type HopMapping = {
  hop: PipelineHop;
  provider: string;
  model: string | null;
  serviceCode: string | null;
};

export type UsageServiceResolution =
  | {
      state: "RESOLVED";
      /** Service codes this execution may be billed for (quantity still gates each line). */
      codes: string[];
      mappings: HopMapping[];
    }
  | {
      state: "UNKNOWN";
      code: typeof UNKNOWN_USAGE_SERVICE_MAPPING;
      mappings: HopMapping[];
      unknownHops: Array<{ hop: PipelineHop; provider: string; model: string | null }>;
    };

/** Lowercase and collapse separator variants so "eleven_flash_v2_5",
 * "eleven-flash-v2.5" and "Eleven Flash V2.5" all compare equal. */
function normalizeModelId(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/[\s._-]+/g, "");
}

function normalizeProvider(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

type HopMatcher = {
  provider: string;
  /** Normalized model prefixes this mapping covers. */
  modelPrefixes: string[];
  serviceCode: string;
};

/**
 * The mapping table. Codes are constants; keep entries narrow — an unmapped
 * provider/model must surface as UNKNOWN, not silently match a neighbor.
 */
const HOP_MATCHERS: Record<Exclude<PipelineHop, "telephony">, HopMatcher[]> = {
  llm: [
    {
      provider: "openai",
      modelPrefixes: ["gpt4omini"],
      serviceCode: USAGE_SERVICE_CODES.OPENAI_GPT4O_MINI
    }
  ],
  transcriber: [
    {
      provider: "deepgram",
      modelPrefixes: ["nova3"],
      serviceCode: USAGE_SERVICE_CODES.DEEPGRAM_NOVA3
    }
  ],
  voice: [
    {
      provider: "elevenlabs",
      modelPrefixes: ["elevenflashv25"],
      serviceCode: USAGE_SERVICE_CODES.ELEVENLABS_FLASH_V25
    }
  ]
};

const TELEPHONY_SERVICE_CODES: Record<string, string> = {
  twilio: USAGE_SERVICE_CODES.TWILIO_VOICE
};

function matchHop(
  hop: Exclude<PipelineHop, "telephony">,
  provider: string,
  model: string | null | undefined
): string | null {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = normalizeModelId(model);
  if (!normalizedProvider || !normalizedModel) return null;

  for (const matcher of HOP_MATCHERS[hop]) {
    if (matcher.provider !== normalizedProvider) continue;
    if (matcher.modelPrefixes.some((prefix) => normalizedModel.startsWith(prefix))) {
      return matcher.serviceCode;
    }
  }
  return null;
}

export type ResolveApplicableUsageServiceCodesInput = {
  execution: {
    /** Whether this execution actually used the calendar (billing policy:
     * google_calendar applies only when an appointment was created/looked up). */
    calendarUsed?: boolean;
  };
  installedAgent?: { id?: string | null } | null;
  voicePipeline: ResolvedVoicePipeline | null;
  providerMetadata?: {
    /** Telephony provider of the call leg; LIVE platform calls are Twilio. */
    telephonyProvider?: string | null;
  };
};

export function resolveApplicableUsageServiceCodes(
  input: ResolveApplicableUsageServiceCodesInput
): UsageServiceResolution {
  const pipeline = input.voicePipeline;
  const telephonyProvider = normalizeProvider(
    input.providerMetadata?.telephonyProvider ?? "twilio"
  );

  const mappings: HopMapping[] = [];
  const unknownHops: Array<{ hop: PipelineHop; provider: string; model: string | null }> = [];

  const telephonyCode = TELEPHONY_SERVICE_CODES[telephonyProvider] ?? null;
  mappings.push({ hop: "telephony", provider: telephonyProvider, model: null, serviceCode: telephonyCode });
  if (!telephonyCode) {
    unknownHops.push({ hop: "telephony", provider: telephonyProvider, model: null });
  }

  const hops: Array<{
    hop: Exclude<PipelineHop, "telephony">;
    provider: string;
    model: string | null;
  }> = [
    { hop: "llm", provider: pipeline?.llmProvider ?? "", model: pipeline?.llmModel ?? null },
    {
      hop: "transcriber",
      provider: pipeline?.transcriberProvider ?? "",
      model: pipeline?.transcriberModel ?? null
    },
    { hop: "voice", provider: pipeline?.voiceProvider ?? "", model: pipeline?.voiceModel ?? null }
  ];

  for (const { hop, provider, model } of hops) {
    const serviceCode = matchHop(hop, provider, model);
    mappings.push({ hop, provider: normalizeProvider(provider) || "unknown", model, serviceCode });
    if (!serviceCode) {
      unknownHops.push({ hop, provider: normalizeProvider(provider) || "unknown", model });
    }
  }

  if (unknownHops.length > 0) {
    return { state: "UNKNOWN", code: UNKNOWN_USAGE_SERVICE_MAPPING, mappings, unknownHops };
  }

  const codes = new Set<string>();
  for (const mapping of mappings) {
    if (mapping.serviceCode) codes.add(mapping.serviceCode);
  }
  // Platform components: call-record storage always applies; SMS confirmation
  // is applicable (the per-SMS quantity gates whether it bills); calendar only
  // when the execution actually used it.
  codes.add(USAGE_SERVICE_CODES.DATABASE_STORAGE);
  codes.add(USAGE_SERVICE_CODES.SMS_CONFIRMATION);
  if (input.execution.calendarUsed) codes.add(USAGE_SERVICE_CODES.GOOGLE_CALENDAR);

  return { state: "RESOLVED", codes: [...codes], mappings };
}

/**
 * Which of the applicable codes MUST have an active pricing record for this
 * execution to be priceable: voice-pipeline components only matter when the
 * call had minutes, the SMS service only when SMS were actually sent, and the
 * calendar service only when the calendar was actually used.
 */
export function requiredServiceCodesForUsage(
  applicableCodes: readonly string[],
  usage: { durationMinutes: number; smsCount: number; calendarUsed: boolean }
): Set<string> {
  const required = new Set<string>();
  for (const code of applicableCodes) {
    if (code === USAGE_SERVICE_CODES.SMS_CONFIRMATION) {
      if (usage.smsCount > 0) required.add(code);
      continue;
    }
    if (code === USAGE_SERVICE_CODES.GOOGLE_CALENDAR) {
      if (usage.calendarUsed) required.add(code);
      continue;
    }
    // Voice-pipeline components (telephony/transcriber/LLM/voice/storage).
    if (usage.durationMinutes > 0) required.add(code);
  }
  return required;
}

/** The frozen, JSON-serializable applicability snapshot stored on the call. */
export type UsagePricingSnapshot = {
  resolverVersion: string;
  pipeline: {
    orchestrator: string;
    llmProvider: string;
    llmModel: string | null;
    transcriberProvider: string;
    transcriberModel: string | null;
    voiceProvider: string;
    voiceModel: string | null;
    telephonyProvider: string;
  };
  calendarUsed: boolean;
  applicableServiceCodes: string[];
  mappings: HopMapping[];
  /** null when PRICED; UNKNOWN_USAGE_SERVICE_MAPPING / USAGE_RATE_NOT_CONFIGURED when UNPRICED. */
  unpricedReason: string | null;
  unknownHops?: Array<{ hop: PipelineHop; provider: string; model: string | null }>;
  missingServiceCodes?: string[];
};

export function buildUsagePricingSnapshot(input: {
  pipeline: ResolvedVoicePipeline | null;
  telephonyProvider?: string | null;
  calendarUsed: boolean;
  resolution: UsageServiceResolution;
  unpricedReason?: string | null;
  missingServiceCodes?: string[];
}): UsagePricingSnapshot {
  const { pipeline, resolution } = input;
  return {
    resolverVersion: USAGE_SERVICE_RESOLVER_VERSION,
    pipeline: {
      orchestrator: pipeline?.orchestrator ?? "vapi",
      llmProvider: pipeline?.llmProvider ?? "unknown",
      llmModel: pipeline?.llmModel ?? null,
      transcriberProvider: pipeline?.transcriberProvider ?? "unknown",
      transcriberModel: pipeline?.transcriberModel ?? null,
      voiceProvider: pipeline?.voiceProvider ?? "unknown",
      voiceModel: pipeline?.voiceModel ?? null,
      telephonyProvider: normalizeProvider(input.telephonyProvider ?? "twilio")
    },
    calendarUsed: input.calendarUsed,
    applicableServiceCodes: resolution.state === "RESOLVED" ? resolution.codes : [],
    mappings: resolution.mappings,
    unpricedReason:
      input.unpricedReason ?? (resolution.state === "UNKNOWN" ? resolution.code : null),
    ...(resolution.state === "UNKNOWN" ? { unknownHops: resolution.unknownHops } : {}),
    ...(input.missingServiceCodes?.length ? { missingServiceCodes: input.missingServiceCodes } : {})
  };
}
