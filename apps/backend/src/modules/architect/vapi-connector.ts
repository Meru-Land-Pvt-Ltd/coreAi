import { normalizeTimeZone, VOICE_TOOL_NAMES } from "@coreai/shared";
import { normalizeAiProvider, type ResolvedVoicePipeline } from "../compliance/workspace-ai-guard";
import { PLATFORM_DEFAULT_VOICE_ID, isKnownVoicePresetId, resolvePresetVoiceId } from "./voice-presets";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { getProviderRegistry } from "../ai-provider-engine/ai-provider-engine";

export function isVapiConfigured(): boolean {
  const key = env.VAPI_API_KEY;
  return Boolean(key && !key.includes("your_") && !key.includes("xxx"));
}

export function isRealId(value?: string | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return Boolean(v && !v.includes("your_") && !v.includes("xxx") && !v.includes("placeholder"));
}

function clean(value?: string | null): string {
  return (value ?? "").trim();
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  return response
    .json()
    .then((value: unknown) => recordOrEmpty(value))
    .catch(() => ({}));
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function vapiErrorMessage(payload: Record<string, unknown>, status: number, fallback: string): string {
  const message = payload.message;

  if (Array.isArray(message)) {
    const joined = message
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join("; ");

    if (joined) return joined;
  }

  return stringField(payload, "message") || stringField(payload, "error") || `${fallback} (HTTP ${status})`;
}

function looksLikeVoiceId(value?: string | null): boolean {
  const v = clean(value);
  return v.length >= 18 && !/\s/.test(v);
}

function dateOnlyInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getVoiceAnswerStatus() {
  const vapiApiKeyConfigured = isVapiConfigured();
  const defaultAssistantConfigured = isRealId(env.VAPI_DEFAULT_ASSISTANT_ID);
  const defaultPhoneNumberIdConfigured = isRealId(env.VAPI_DEFAULT_PHONE_NUMBER_ID);
  const aiAnswerMode = env.VAPI_ANSWER_INBOUND;

  const ready = vapiApiKeyConfigured;

  let blocker: string | null = null;

  if (!vapiApiKeyConfigured) {
    blocker = "VAPI_API_KEY is missing/placeholder — set a real Vapi private API key.";
  } else if (!aiAnswerMode) {
    blocker =
      "AI answering is wired but off — set VAPI_ANSWER_INBOUND=true so inbound calls are answered by the AI.";
  }

  return {
    aiAnswerMode,
    vapiApiKeyConfigured,
    defaultAssistantConfigured,
    defaultAssistantNote: defaultAssistantConfigured
      ? "Legacy global fallback assistant is configured."
      : "Production multi-business setup does not require VAPI_DEFAULT_ASSISTANT_ID. Buyer deploy stores InstalledAgent.configJson.vapiAssistantId.",
    defaultPhoneNumberIdConfigured,
    defaultPhoneNumberIdNote: defaultPhoneNumberIdConfigured
      ? "Legacy global fallback phone number id is configured."
      : "Production multi-business setup does not require VAPI_DEFAULT_PHONE_NUMBER_ID. Phone numbers are mapped through PlatformPhoneNumber + BusinessPhoneNumber.",
    ready,
    blocker
  };
}

export async function ensureBusinessVapiAssistant(businessId: string): Promise<string | null> {
  if (!isVapiConfigured()) return null;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { profile: true }
  });

  if (!business) return null;

  const existing = business.profile?.vapiAssistantId;
  if (isRealId(existing)) return existing as string;

  const legacyFallbackAssistantId = env.VAPI_DEFAULT_ASSISTANT_ID;

  if (!isRealId(legacyFallbackAssistantId)) {
    return null;
  }

  if (business.profile) {
    await prisma.businessProfile.update({
      where: { businessId },
      data: { vapiAssistantId: legacyFallbackAssistantId }
    });
  }

  return legacyFallbackAssistantId ?? null;
}

export type VapiCallDetails = {
  id: string;
  status: string | null;
  durationSeconds: number | null;
  durationMinutes: number | null;
  durationMs: number | null;
  costUsd: number | null;
  costBreakdown: Record<string, unknown> | null;
  recordingUrl: string | null;
  recordingUrls: string[];
};

export function isPresignedRecordingUrl(url: string): boolean {
  return /[?&]X-Amz-(?:Signature|Credential|Algorithm)=/i.test(url);
}

export function extractCallRecordingUrls(payload: Record<string, unknown>): string[] {
  const urls: string[] = [];

  function collectUrls(value: unknown, path = ""): void {
    if (typeof value === "string") {
      const url = value.trim();

      if (
        /^https:\/\//i.test(url) &&
        /record|artifact|\.wav(?:$|\?)|\.mp3(?:$|\?)/i.test(`${path} ${url}`) &&
        // Artifacts also carry non-audio files — never offer those for playback.
        !/transcript|pcap|video/i.test(`${path} ${url}`) &&
        !urls.includes(url)
      ) {
        urls.push(url);
      }

      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        collectUrls(item, `${path}[${index}]`);
      });
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(
        value as Record<string, unknown>
      )) {
        collectUrls(nested, path ? `${path}.${key}` : key);
      }
    }
  }

  collectUrls(payload);

  const isPresigned = (url: string) =>
    /[?&]X-Amz-(?:Signature|Credential|Algorithm)=/i.test(url);

  return urls.sort(
    (left, right) =>
      Number(isPresigned(right)) - Number(isPresigned(left))
  );
}

export async function fetchVapiCallById(callId: string): Promise<VapiCallDetails | null> {
  if (!isVapiConfigured() || !isRealId(callId)) return null;

  const response = await fetch(`${env.VAPI_BASE_URL.replace(/\/$/, "")}/call/${encodeURIComponent(callId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.VAPI_API_KEY}`
    },
    signal: AbortSignal.timeout(15000)
  });

  const payload = await readJsonObject(response);
  if (!response.ok) {
    throw new Error(vapiErrorMessage(payload, response.status, "Vapi call lookup failed"));
  }

  const cost = Number(payload.cost);
  const durationSeconds = Number(payload.durationSeconds);
  const durationMinutes = Number(payload.durationMinutes);
  const durationMs = Number(payload.durationMs);
  const recordingUrls = extractCallRecordingUrls(payload);

  return {
    id: stringField(payload, "id") ?? callId,
    status: stringField(payload, "status") ?? null,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null,
    durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : null,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null,
    costUsd: Number.isFinite(cost) && cost >= 0 ? cost : null,
    costBreakdown:
      typeof payload.costBreakdown === "object" && payload.costBreakdown !== null
        ? (payload.costBreakdown as Record<string, unknown>)
        : null,
    recordingUrl: recordingUrls[0] ?? null,
    recordingUrls
  };
}

export type VapiCallResult = {
  id: string | null;
  status: string | null;
  customerPhone: string;
  assistantId: string;
  phoneNumberId: string;
  providerCalled: boolean;
};

export type VapiBusinessContext = {
  businessId?: string;
  businessName: string;
  businessType?: string;
  bookingUrl?: string;
  teamPhone?: string;
  services?: string[];
  faqs?: string[];
  knowledge?: string[];
  tone?: string;
  escalationRules?: string;
  calendarId?: string;
  timeZone?: string;
};

function requireVapiConfig(assistantId?: string | null, phoneNumberId?: string | null) {
  const resolvedAssistantId = clean(assistantId) || clean(env.VAPI_DEFAULT_ASSISTANT_ID);
  const resolvedPhoneNumberId = clean(phoneNumberId) || clean(env.VAPI_DEFAULT_PHONE_NUMBER_ID);

  if (!env.VAPI_API_KEY || !resolvedAssistantId || !resolvedPhoneNumberId) {
    throw new Error(
      "Vapi is not configured for this call. Add VAPI_API_KEY and pass per-business assistantId + phoneNumberId, or configure legacy fallback values."
    );
  }

  return {
    assistantId: resolvedAssistantId,
    phoneNumberId: resolvedPhoneNumberId
  };
}

export type VapiBusinessHoursVariables = {
  state: "open" | "closed" | "unknown";
  statusLine?: string;
  nextOpenText?: string;
};

export function buildVapiVariableValues({
  customerPhone,
  customerName,
  business,
  reason,
  smsConsentStatus,
  businessHours
}: {
  customerPhone: string;
  customerName?: string | null;
  business: VapiBusinessContext;
  reason: string;
  smsConsentStatus?: string | null;
  businessHours?: VapiBusinessHoursVariables | null;
}) {
  const timeZone = business.timeZone
    ? normalizeTimeZone(business.timeZone)
    : env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;

  const currentDateTime = new Date().toLocaleString("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const currentDate = dateOnlyInZone(timeZone);
  const tomorrowDate = addDaysToDateStr(currentDate, 1);

  return {
    currentDateTime,
    currentDate,
    todayDate: currentDate,
    tomorrowDate,
    customerPhone,
    customerName: customerName || "the caller",
    businessId: business.businessId || "",
    businessName: business.businessName,
    businessType: business.businessType || "business",
    bookingUrl: business.bookingUrl || "",
    teamPhone: business.teamPhone || "",
    services: (business.services ?? []).join(", "),
    faqs: (business.faqs ?? []).join("\n"),
    knowledge: (business.knowledge ?? []).join("\n"),
    tone: business.tone || "friendly",
    escalationRules: business.escalationRules || "",
    calendarId: business.calendarId || "primary",
    timeZone,
    callReason: reason,
    smsConsentStatus: smsConsentStatus || "unknown",
    businessOpenState: businessHours?.state ?? "unknown",
    businessHoursStatusLine: businessHours?.statusLine ?? "Business hours were not evaluated for this call.",
    businessNextOpenTime: businessHours?.nextOpenText ?? ""
  };
}

export async function startVapiOutboundCall({
  customerPhone,
  customerName,
  business,
  reason,
  assistantId,
  phoneNumberId,
  metadata = {},
  smsConsentStatus,
  businessHours
}: {
  customerPhone: string;
  customerName?: string | null;
  business: VapiBusinessContext;
  reason: string;
  assistantId?: string | null;
  phoneNumberId?: string | null;
  metadata?: Record<string, unknown>;
  smsConsentStatus?: string | null;
  businessHours?: VapiBusinessHoursVariables | null;
}): Promise<VapiCallResult> {
  const config = requireVapiConfig(assistantId, phoneNumberId);

  const response = await fetch(`${env.VAPI_BASE_URL.replace(/\/$/, "")}/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.VAPI_API_KEY}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      assistantId: config.assistantId,
      phoneNumberId: config.phoneNumberId,
      customer: {
        number: customerPhone
      },
      assistantOverrides: {
        variableValues: buildVapiVariableValues({
          customerPhone,
          customerName,
          business,
          reason,
          smsConsentStatus,
          businessHours
        })
      },
      metadata: {
        ...metadata,
        businessId: business.businessId,
        customerPhone,
        source: "triven_outbound_call"
      }
    })
  });

  const responseJson = await readJsonObject(response);

  if (!response.ok) {
    throw new Error(vapiErrorMessage(responseJson, response.status, "Vapi outbound call failed"));
  }

  return {
    id: stringField(responseJson, "id") ?? null,
    status: stringField(responseJson, "status") ?? null,
    customerPhone,
    assistantId: config.assistantId,
    phoneNumberId: config.phoneNumberId,
    providerCalled: true
  };
}

export async function createVapiInboundTwiml({
  callerNumber,
  callerName,
  business,
  reason,
  assistantId,
  phoneNumberId,
  phoneNumber,
  metadata = {},
  smsConsentStatus,
  businessHours,
  firstMessageOverride
}: {
  callerNumber: string;
  callerName?: string | null;
  business: VapiBusinessContext;
  reason: string;
  assistantId?: string | null;
  phoneNumberId?: string | null;
  phoneNumber?: string | null;
  metadata?: Record<string, unknown>;
  smsConsentStatus?: string | null;
  businessHours?: VapiBusinessHoursVariables | null;
  firstMessageOverride?: string | null;
}): Promise<string | null> {
  const resolvedAssistantId = clean(assistantId) || clean(env.VAPI_DEFAULT_ASSISTANT_ID);

  if (!env.VAPI_API_KEY || !isRealId(resolvedAssistantId) || !callerNumber) {
    return null;
  }

  const payload: Record<string, unknown> = {
    assistantId: resolvedAssistantId,
    phoneCallProviderBypassEnabled: true,
    customer: {
      number: callerNumber
    },
    assistantOverrides: {
      variableValues: buildVapiVariableValues({
        customerPhone: callerNumber,
        customerName: callerName,
        business,
        reason,
        smsConsentStatus,
        businessHours
      }),
      ...(firstMessageOverride?.trim() ? { firstMessage: firstMessageOverride.trim() } : {})
    },
    metadata: {
      ...metadata,
      businessId: business.businessId,
      customerPhone: callerNumber,
      source: "triven_inbound_ai_agent"
    }
  };

  const resolvedPhoneNumberId = clean(phoneNumberId) || clean(env.VAPI_DEFAULT_PHONE_NUMBER_ID);
  const resolvedPhoneNumber = clean(phoneNumber);

  if (isRealId(resolvedPhoneNumberId)) {
    payload.phoneNumberId = resolvedPhoneNumberId;
  } else if (resolvedPhoneNumber && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    payload.phoneNumber = {
      twilioPhoneNumber: resolvedPhoneNumber,
      twilioAccountSid: env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: env.TWILIO_AUTH_TOKEN
    };
  }

  let response: Response;

  try {
    response = await fetch(`${env.VAPI_BASE_URL.replace(/\/$/, "")}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.VAPI_API_KEY}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("Vapi inbound bridge request failed", error);
    return null;
  }

  const responseJson = await readJsonObject(response);

  if (!response.ok) {
    console.error(
      "Vapi inbound bridge rejected the call",
      vapiErrorMessage(responseJson, response.status, "Vapi inbound bridge failed")
    );
    return null;
  }

  const providerDetails = recordOrEmpty(responseJson.phoneCallProviderDetails);
  const twiml = stringField(providerDetails, "twiml");
  return typeof twiml === "string" && twiml.trim().length > 0 ? twiml : null;
}

/** Vapi built-in voices — the API requires these exact names for provider "vapi". */
const VAPI_BUILTIN_VOICES = [
  "Clara", "Godfrey", "Elliot", "Savannah", "Nico", "Kai", "Emma", "Sagar", "Neil", "Layla",
  "Sid", "Gustavo", "Kylie", "Rohan", "Lily", "Hana", "Neha", "Cole", "Harry", "Paige",
  "Spencer", "Naina", "Leah", "Tara", "Jess", "Leo", "Dan", "Mia", "Zac", "Zoe"
] as const;

const DEFAULT_VAPI_BUILTIN_VOICE = "Savannah";

/** Case-insensitive match against the built-in list, preserving exact capitalization. */
function matchVapiBuiltinVoice(value?: string | null): string | null {
  const cleaned = clean(value);

  if (!cleaned) return null;

  return VAPI_BUILTIN_VOICES.find((name) => name.toLowerCase() === cleaned.toLowerCase()) ?? null;
}

export function resolveVapiVoice(input: {
  voice?: string | null;
  voiceProvider?: string | null;
  voiceId?: string | null;
}): {
  config: {
    provider: string;
    voiceId: string;
    model?: string;
  };
} {
  const explicitProvider = clean(input.voiceProvider).toLowerCase();
  const voiceName = clean(input.voice).toLowerCase();
  const explicitVoiceId = clean(input.voiceId);
  const isCustomVoice = voiceName === "custom";
  const isKnownPreset = !isCustomVoice && isKnownVoicePresetId(voiceName);
  const builtinMatch = matchVapiBuiltinVoice(explicitVoiceId) ?? matchVapiBuiltinVoice(input.voice);

  const vapiBuiltin = (name?: string | null) => ({
    config: {
      provider: "vapi",
      voiceId:
        matchVapiBuiltinVoice(name) ?? matchVapiBuiltinVoice(env.VAPI_DEFAULT_VOICE_ID) ?? DEFAULT_VAPI_BUILTIN_VOICE
    }
  });

  const idBased = (voiceId: string) => {
    if (!voiceId || !looksLikeVoiceId(voiceId) || matchVapiBuiltinVoice(voiceId)) {
      return vapiBuiltin(voiceId);
    }

    const provider = explicitProvider && explicitProvider !== "vapi" ? explicitProvider : "11labs";

    return {
      config: {
        provider,
        voiceId,
        ...(provider === "11labs" ? { model: env.VAPI_ELEVENLABS_MODEL } : {})
      }
    };
  };
  if (isKnownPreset) {
    return idBased(resolvePresetVoiceId(voiceName));
  }

  const customVoiceId = looksLikeVoiceId(explicitVoiceId)
    ? explicitVoiceId
    : looksLikeVoiceId(clean(input.voice))
      ? clean(input.voice)
      : "";

  if (customVoiceId && explicitProvider !== "vapi") {
    return idBased(customVoiceId);
  }

  // 3. Vapi built-in voices keep provider "vapi".
  if (explicitProvider === "vapi" || builtinMatch) {
    return vapiBuiltin(builtinMatch);
  }

  // 4. Platform default preset, then the safe built-in fallback inside idBased.
  return idBased(resolvePresetVoiceId(PLATFORM_DEFAULT_VOICE_ID));
}

const TRANSCRIBER_LANGUAGES = ["en-US", "en-GB", "es", "hi"] as const;

export function resolveTranscriberLanguage(language?: string | null): string {
  const requested = clean(language);
  const supported = TRANSCRIBER_LANGUAGES.find(
    (code) => code.toLowerCase() === requested.toLowerCase()
  );

  if (!supported) return "en-US";
  if (supported.startsWith("en")) return supported;

  const isNova3 =
    env.VAPI_TRANSCRIBER_PROVIDER === "deepgram" && env.VAPI_TRANSCRIBER_MODEL.startsWith("nova-3");

  return isNova3 ? "multi" : supported;
}

export function resolveVoiceSpeed(speakingSpeed?: string | null): number | undefined {
  const parsed = Number.parseFloat(clean(speakingSpeed));

  if (!Number.isFinite(parsed) || parsed < 0.7 || parsed > 1.2 || parsed === 1) {
    return undefined;
  }

  return parsed;
}

const VAPI_ANTHROPIC_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001"
]);

export type VapiModelResolution = {
  provider: string;
  model: string;
  /** Set when the requested model could not be deployed as asked. */
  fallbackNotice?: string;
};

export function resolveVapiModel(model?: string | null): VapiModelResolution {
  const requested = clean(model);
  const m = (requested || env.VAPI_DEFAULT_LLM_MODEL).toLowerCase();

  if (m.includes("claude") || m.includes("anthropic")) {
    if (!env.VAPI_ANTHROPIC_ENABLED) {
      return {
        provider: env.VAPI_DEFAULT_LLM_PROVIDER,
        model: env.VAPI_DEFAULT_LLM_MODEL,
        fallbackNotice:
          "Anthropic voice-test model is unavailable for this Vapi account. " +
          `Using ${env.VAPI_DEFAULT_LLM_PROVIDER}/${env.VAPI_DEFAULT_LLM_MODEL} instead. ` +
          "Configure provider billing (set VAPI_ANTHROPIC_ENABLED=true once funded) or select another LLM."
      };
    }

    const anthropicModel = VAPI_ANTHROPIC_MODELS.has(m) ? m : env.VAPI_ANTHROPIC_MODEL;

    return {
      provider: "anthropic",
      model: anthropicModel,
      ...(anthropicModel !== requested && requested
        ? { fallbackNotice: `Model ${requested} is retired; using anthropic/${anthropicModel} instead.` }
        : {})
    };
  }

  if (m.includes("mini")) {
    return {
      provider: "openai",
      model: "gpt-4o-mini"
    };
  }

  if (m.includes("gpt")) {
    return {
      provider: "openai",
      model: "gpt-4o"
    };
  }

  return {
    provider: env.VAPI_DEFAULT_LLM_PROVIDER,
    model: env.VAPI_DEFAULT_LLM_MODEL
  };
}

function genericAssistantTools() {
  return [
    {
      type: "function",
      messages: [
        {
          type: "request-start",
          content: "Let me look that up for you."
        }
      ],
      function: {
        name: VOICE_TOOL_NAMES.lookupKnowledge,
        description:
          "Search this business's uploaded documents and knowledge base for specific details (policies, pricing, services, hours, procedures). ALWAYS call this with the caller's question before saying you don't know a business detail.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The caller's question or the specific topic to look up, in plain words."
            }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      messages: [
        {
          type: "request-start",
          content: "Let me check our calendar for available times."
        }
      ],
      function: {
        name: VOICE_TOOL_NAMES.checkAvailability,
        description:
          "Check the connected business calendar. Without a time it returns a SAMPLE of free times across the whole day plus the total count — unlisted times are NOT booked. When the caller asks about a specific time ('Is 5 PM available?', 'anything after 4?', 'the latest appointment'), call again WITH the time parameter for a direct truthful check.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Appointment date in YYYY-MM-DD. Resolve today/tomorrow using runtime variables; never ask the caller for today's date."
            },
            time: {
              type: "string",
              description: "Specific time the caller asked about, e.g. '5:00 PM' or '17:00'. When set, the tool verifies exactly this time instead of listing suggestions."
            },
            service_type: {
              type: "string",
              description: "Requested service or appointment type."
            },
            duration_minutes: {
              type: "number",
              description: "Requested appointment length in minutes."
            }
          },
          required: ["date"]
        }
      }
    },
    {
      type: "function",
      messages: [
        {
          type: "request-start",
          content: "Just a moment while I book that appointment for you."
        }
      ],
      function: {
        name: VOICE_TOOL_NAMES.bookAppointment,
        description:
          "Book an appointment in the connected business calendar after the caller confirms a slot. Only call this after collecting the caller's real name and confirmed date/time.",
        parameters: {
          type: "object",
          properties: {
            customer_name: {
              type: "string",
              description:
                "Customer's real full name. Do not use placeholders like John Doe, Customer Name, Full Name, or the caller."
            },
            customer_phone: {
              type: "string",
              description:
                "Customer callback number in E.164 format. If unknown, leave blank and the caller's number will be used."
            },
            patient_name: {
              type: "string",
              description: "Backward-compatible alias for customer_name."
            },
            patient_phone: {
              type: "string",
              description: "Backward-compatible alias for customer_phone."
            },
            date: {
              type: "string",
              description: "Appointment date in YYYY-MM-DD. Resolve today/tomorrow using runtime variables; never ask the caller for today's date."
            },
            time: {
              type: "string",
              description: "Appointment time in 24-hour HH:mm format."
            },
            service_type: {
              type: "string",
              description: "Requested service or appointment type."
            },
            doctor: {
              type: "string",
              description:
                "The doctor, practitioner, or staff member the caller chose, exactly as listed in the business context (e.g. \"Dr. Patel\"). Omit when the business lists only one provider or the caller has no preference — never invent a name."
            },
            duration_minutes: {
              type: "number",
              description: "Appointment length in minutes."
            }
          },
          required: ["customer_name", "customer_phone", "date", "time"]
        }
      }
    },
    {
      type: "function",
      messages: [
        {
          type: "request-start",
          content: "Let me look that up for you."
        }
      ],
      function: {
        name: VOICE_TOOL_NAMES.cancelAppointment,
        description:
          "Look up and cancel the caller's upcoming appointment. Identity is verified SERVER-SIDE from the number the caller is calling from — never pass a phone number, and never treat a phone number the caller says out loud as verification. Step 1: call with no arguments (optionally date or service_type to narrow) to find the caller's cancellable appointments. Step 2: ONLY after the caller clearly and unambiguously says yes to cancelling a specific appointment, call again with that appointment_id and confirmed=true. A no, hesitation, silence, or unclear answer means DO NOT set confirmed=true.",
        parameters: {
          type: "object",
          properties: {
            appointment_id: {
              type: "string",
              description:
                "Internal appointment id returned by a previous cancel_appointment lookup in THIS call. Never invent or guess this value."
            },
            date: {
              type: "string",
              description: "Optional YYYY-MM-DD filter when the caller mentions a specific day."
            },
            service_type: {
              type: "string",
              description: "Optional service filter when the caller mentions the service."
            },
            confirmed: {
              type: "boolean",
              description:
                "true ONLY after the caller clearly agreed to cancel the selected appointment."
            },
            cancellation_reason: {
              type: "string",
              description: "Optional short reason the caller volunteers."
            }
          },
          required: []
        }
      }
    },
    {
      type: "function",
      messages: [
        {
          type: "request-start",
          content: "Let me check that for you."
        }
      ],
      function: {
        name: VOICE_TOOL_NAMES.rescheduleAppointment,
        description:
          "Look up and move the caller's upcoming appointment to a new date/time. Identity is verified SERVER-SIDE from the number the caller is calling from — never pass a phone number, and never treat a phone number the caller says out loud as verification. Step 1: call with no arguments (optionally date or service_type to narrow) to find the caller's appointments. Step 2: collect the new day and time the caller wants (use check_availability if they ask what's open). Step 3: ONLY after the caller clearly agrees to move a specific appointment to a specific new date/time, call again with that appointment_id, new_date, new_time and confirmed=true. A no, hesitation, silence, or unclear answer means DO NOT set confirmed=true.",
        parameters: {
          type: "object",
          properties: {
            appointment_id: {
              type: "string",
              description:
                "Internal appointment id returned by a previous reschedule_appointment lookup in THIS call. Never invent or guess this value."
            },
            date: {
              type: "string",
              description: "Optional YYYY-MM-DD filter when the caller mentions which day the EXISTING appointment is on."
            },
            service_type: {
              type: "string",
              description: "Optional service filter when the caller mentions the service."
            },
            new_date: {
              type: "string",
              description: "The NEW appointment date in YYYY-MM-DD. Resolve today/tomorrow using runtime variables; never ask the caller for today's date."
            },
            new_time: {
              type: "string",
              description: "The NEW appointment time in 24-hour HH:mm format."
            },
            confirmed: {
              type: "boolean",
              description:
                "true ONLY after the caller clearly agreed to move the selected appointment to the stated new date and time."
            }
          },
          required: []
        }
      }
    },
    {
      type: "function",
      messages: [
        {
          type: "request-start",
          content: "Let me note that down."
        }
      ],
      function: {
        name: VOICE_TOOL_NAMES.recordSmsConsent,
        description:
          "Record the caller's answer to the SMS-consent disclosure. Call this ONLY after reading the full SMS consent disclosure aloud and hearing the caller's answer. Pass affirmative=true ONLY for a clear, unambiguous yes (e.g. 'yes', 'yes please', 'sure, that's fine'). Pass affirmative=false for no, silence, hesitation, an unclear answer, or an interruption. Never call it with affirmative=true because the caller merely provided a phone number or completed a booking.",
        parameters: {
          type: "object",
          properties: {
            affirmative: {
              type: "boolean",
              description:
                "true ONLY for a clear yes to the SMS consent question; false for no, silence, uncertainty, or an ambiguous answer."
            },
            customer_phone: {
              type: "string",
              description:
                "Customer phone number in E.164 format. If unknown, leave blank and the caller's number will be used."
            }
          },
          required: ["affirmative"]
        }
      }
    },
    {
      type: "function",
      messages: [
        {
          type: "request-start",
          content: "Sending you the details now."
        }
      ],
      function: {
        name: VOICE_TOOL_NAMES.sendNotification,
        description:
          "Send an SMS or notification after the booking or lead action is completed, if the buyer has SMS configured. Also used to alert the business team about urgent after-hours requests.",
        parameters: {
          type: "object",
          properties: {
            urgency: {
              type: "string",
              enum: ["normal", "urgent", "emergency"],
              description:
                "Set 'urgent' for an urgent after-hours request, 'emergency' when the caller was directed to 911/emergency care and asked for the team to be notified. Marks the INTERNAL team notification only — it never sends the customer anything."
            },
            reason: {
              type: "string",
              description: "One short neutral sentence for the team, e.g. 'urgent after-hours callback requested'. Never a diagnosis."
            },
            customer_phone: {
              type: "string",
              description: "Customer phone number."
            },
            customer_name: {
              type: "string",
              description: "Customer name."
            },
            patient_phone: {
              type: "string",
              description: "Backward-compatible alias for customer_phone."
            },
            patient_name: {
              type: "string",
              description: "Backward-compatible alias for customer_name."
            },
            appointment_date: {
              type: "string",
              description: "Appointment date."
            },
            appointment_time: {
              type: "string",
              description: "Appointment time."
            },
            service: {
              type: "string",
              description: "Booked service or request."
            },
            business_name: {
              type: "string",
              description: "Business name."
            }
          },
          required: []
        }
      }
    }
  ];
}

export type AssistantIncludeTools = {
  knowledgeLookup?: boolean;
  checkAvailability?: boolean;
  bookAppointment?: boolean;
  /** send_notification (SMS and/or email delivery) — include when the workflow can text OR email. */
  sendNotification?: boolean;
  /**
   * record_sms_consent — include ONLY when the workflow can text (SMS node).
   * Email-only workflows must not carry the SMS consent tool. Defaults to
   * sendNotification for back-compat.
   */
  recordSmsConsent?: boolean;
};

/**
 * Capability-based voice-tool gating (A2P rule: the SMS consent tool exists
 * only where SMS can actually be sent; the notification tool exists wherever
 * SMS OR email delivery exists). Pure so tests can pin the matrix.
 */
export function shouldIncludeAssistantTool(
  toolName: string,
  includeTools?: AssistantIncludeTools
): boolean {
  // record_sms_consent FAILS CLOSED: it exists ONLY on an explicit
  // recordSmsConsent === true (an SMS node in the workflow). It is NEVER
  // inferred from sendNotification — that flag also covers email-only
  // workflows, which must not carry the SMS consent tool. Omitted/legacy
  // values exclude the tool.
  if (toolName === VOICE_TOOL_NAMES.recordSmsConsent) {
    return includeTools?.recordSmsConsent === true;
  }
  if (!includeTools) return true;
  if (toolName === VOICE_TOOL_NAMES.checkAvailability) return includeTools.checkAvailability !== false;
  if (toolName === VOICE_TOOL_NAMES.bookAppointment) return includeTools.bookAppointment !== false;
  // Cancellation + rescheduling ship with the booking capability.
  if (toolName === VOICE_TOOL_NAMES.cancelAppointment) return includeTools.bookAppointment !== false;
  if (toolName === VOICE_TOOL_NAMES.rescheduleAppointment) return includeTools.bookAppointment !== false;
  if (toolName === VOICE_TOOL_NAMES.sendNotification) return includeTools.sendNotification !== false;
  return true;
}

export type DeployVapiAssistantInput = {
  name: string;
  firstMessage: string;
  systemPrompt: string;
  model?: string | null;
  voice?: string | null;
  voiceProvider?: string | null;
  voiceId?: string | null;
  stability?: number | null;
  similarityBoost?: number | null;
  style?: number | null;
  useSpeakerBoost?: boolean | null;
  /** BCP-47-ish node value ("en-US", "en-GB", "es", "hi"); mapped per transcriber model. */
  language?: string | null;
  /** ElevenLabs speed multiplier as node string ("0.8"–"1.2"); 11labs voices only. */
  speakingSpeed?: string | null;
  serverUrl: string;
  existingAssistantId?: string | null;
  /** Assistant-level metadata echoed back on webhook calls (e.g. businessId). */
  metadata?: Record<string, unknown>;
  /** Restrict attached tools to the connected workflow's capabilities. */
  includeTools?: AssistantIncludeTools;
  /** Seconds of caller silence before Vapi ends the call (Vapi default: 30). */
  silenceTimeoutSeconds?: number;
  /** Hard cap on call length (marketplace demos). Vapi ends the call at this limit. */
  maxDurationSeconds?: number;
  /** End Flow node "Call recording" toggle → Vapi artifactPlan.recordingEnabled (default on). */
  recordingEnabled?: boolean;
};

export async function deployVapiAssistant({
  name,
  firstMessage,
  systemPrompt,
  model,
  voice,
  voiceProvider,
  voiceId,
  stability,
  similarityBoost,
  style,
  useSpeakerBoost,
  language,
  speakingSpeed,
  serverUrl,
  existingAssistantId,
  metadata,
  includeTools,
  silenceTimeoutSeconds,
  maxDurationSeconds,
  recordingEnabled
}: DeployVapiAssistantInput): Promise<{ id: string; created: boolean; pipeline: ResolvedVoicePipeline }> {
  if (!env.VAPI_API_KEY) {
    throw new Error("VAPI_API_KEY is required to deploy the voice assistant.");
  }

  const resolvedModel = resolveVapiModel(model);

  // Vapi rejects assistant names longer than 40 characters — clamp centrally
  // so long listing/business/workflow names never fail a deploy.
  const assistantName = clean(name).slice(0, 40) || "Triven Assistant";

  const body: Record<string, unknown> = {
    name: assistantName,
    firstMessage,
    model: {
      provider: resolvedModel.provider,
      model: resolvedModel.model,
      messages: [
        {
          role: "system",
          content: systemPrompt
        }
      ],
      // The knowledge-lookup tool is independent of the booking-tools flag —
      // PDF retrieval must never be silently disabled by an unrelated env
      // toggle while the prompt still advertises the tool.
      tools: genericAssistantTools()
        .filter((tool) => {
          const toolName = tool.function.name;
          if (toolName === VOICE_TOOL_NAMES.lookupKnowledge) {
            return includeTools?.knowledgeLookup !== false;
          }
          return env.VAPI_ENABLE_BOOKING_TOOLS;
        })
        .filter((tool) => shouldIncludeAssistantTool(tool.function.name, includeTools))
    },
    transcriber: {
      provider: env.VAPI_TRANSCRIBER_PROVIDER,
      model: env.VAPI_TRANSCRIBER_MODEL,
      language: resolveTranscriberLanguage(language)
    },
    startSpeakingPlan: {
      waitSeconds: 0.4,
      smartEndpointingPlan: {
        provider: "livekit",
        waitFunction: "2000 / (1 + exp(-10 * (x - 0.5)))"
      },
      transcriptionEndpointingPlan: {
        onPunctuationSeconds: 0.1,
        onNoPunctuationSeconds: 0.8,
        onNumberSeconds: 0.4
      }
    },
    stopSpeakingPlan: {
      numWords: 0,
      voiceSeconds: 0.2,
      backoffSeconds: 1
    },
    firstMessageInterruptionsEnabled: true,
    server: {
      url: serverUrl,
      // Vapi echoes this back as X-Vapi-Secret on every webhook call.
      ...(clean(env.VAPI_WEBHOOK_SECRET) ? { secret: env.VAPI_WEBHOOK_SECRET } : {})
    },
    artifactPlan: {
      recordingEnabled: recordingEnabled !== false
    },
    compliancePlan: {
      hipaaEnabled: false
    },
    ...(metadata ? { metadata } : {}),
    ...(silenceTimeoutSeconds ? { silenceTimeoutSeconds } : {}),
    ...(maxDurationSeconds ? { maxDurationSeconds } : {})
  };

  const voiceResolution = resolveVapiVoice({
    voice: voice || PLATFORM_DEFAULT_VOICE_ID,
    voiceProvider,
    voiceId
  });

  const voiceSpeed = resolveVoiceSpeed(speakingSpeed);

  body.voice =
    voiceResolution.config.provider === "11labs"
      ? {
        ...voiceResolution.config,
        stability: typeof stability === "number" ? stability : 0.65,
        similarityBoost: typeof similarityBoost === "number" ? similarityBoost : 0.75,
        style: typeof style === "number" ? style : 0.0,
        useSpeakerBoost: typeof useSpeakerBoost === "boolean" ? useSpeakerBoost : false,
        ...(voiceSpeed !== undefined ? { speed: voiceSpeed } : {})
      }
      : voiceResolution.config;

  const voiceIdSuffix = voiceResolution.config.voiceId.slice(-4);
  console.log(`[vapi-deploy] resolved model: ${resolvedModel.provider}/${resolvedModel.model}`);
  if (resolvedModel.fallbackNotice) {
    console.warn(`[vapi-deploy] model fallback: ${resolvedModel.fallbackNotice}`);
  }
  console.log(`[vapi-deploy] resolved voice provider: ${voiceResolution.config.provider}`);
  console.log(`[vapi-deploy] resolved voice ID suffix: ...${voiceIdSuffix}`);

  const base = env.VAPI_BASE_URL.replace(/\/$/, "");

  async function send(method: "POST" | "PATCH", url: string) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${env.VAPI_API_KEY}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(body)
    });

    const json = await readJsonObject(response);

    return {
      ok: response.ok,
      status: response.status,
      json
    };
  }

  const updating = isRealId(existingAssistantId);

  let result = updating
    ? await send("PATCH", `${base}/assistant/${existingAssistantId}`)
    : await send("POST", `${base}/assistant`);

  if (!result.ok && updating && (result.status === 404 || result.status === 400)) {
    result = await send("POST", `${base}/assistant`);
  }

  const deployedAssistantId = stringField(result.json, "id");

  if (!result.ok || !deployedAssistantId) {
    throw new Error(`Vapi assistant deploy failed: ${vapiErrorMessage(result.json, result.status, "Assistant deploy failed")}`);
  }

  // The Limited Use guard validates the EXACT providers this assistant runs
  // on, so capture them from the payload we just sent — not from env guesses.
  // Model identifiers ride along for usage-service pricing resolution; a
  // vapi-built-in voice has no ElevenLabs model, so voiceModel stays unset
  // there and pricing treats it as an unknown mapping instead of guessing.
  const voiceModel =
    voiceResolution.config.provider === "11labs" ? env.VAPI_ELEVENLABS_MODEL : undefined;
  const pipeline: ResolvedVoicePipeline = {
    orchestrator: "vapi",
    llmProvider: normalizeAiProvider(resolvedModel.provider),
    transcriberProvider: normalizeAiProvider(env.VAPI_TRANSCRIBER_PROVIDER),
    voiceProvider: normalizeAiProvider(voiceResolution.config.provider),
    llmModel: resolvedModel.model,
    transcriberModel: env.VAPI_TRANSCRIBER_MODEL,
    ...(voiceModel ? { voiceModel } : {})
  };

  return {
    id: deployedAssistantId,
    created: !updating,
    pipeline
  };
}