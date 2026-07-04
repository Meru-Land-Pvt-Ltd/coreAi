import { DEFAULT_VOICE_PROVIDER, normalizeTimeZone, VOICE_TOOL_NAMES } from "@coreai/shared";
import { PLATFORM_DEFAULT_VOICE_ID, resolvePresetVoiceId } from "./voice-presets";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

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

export function buildVapiVariableValues({
  customerPhone,
  customerName,
  business,
  reason
}: {
  customerPhone: string;
  customerName?: string | null;
  business: VapiBusinessContext;
  reason: string;
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
    callReason: reason
  };
}

export async function startVapiOutboundCall({
  customerPhone,
  customerName,
  business,
  reason,
  assistantId,
  phoneNumberId,
  metadata = {}
}: {
  customerPhone: string;
  customerName?: string | null;
  business: VapiBusinessContext;
  reason: string;
  assistantId?: string | null;
  phoneNumberId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<VapiCallResult> {
  const config = requireVapiConfig(assistantId, phoneNumberId);

  const response = await fetch(`${env.VAPI_BASE_URL.replace(/\/$/, "")}/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.VAPI_API_KEY}`,
      "Content-Type": "application/json"
    },
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
          reason
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

  const responseJson = (await response.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(responseJson.message || responseJson.error || "Vapi outbound call failed");
  }

  return {
    id: responseJson.id ?? null,
    status: responseJson.status ?? null,
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
  metadata = {}
}: {
  callerNumber: string;
  callerName?: string | null;
  business: VapiBusinessContext;
  reason: string;
  assistantId?: string | null;
  phoneNumberId?: string | null;
  phoneNumber?: string | null;
  metadata?: Record<string, unknown>;
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
        reason
      })
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
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("Vapi inbound bridge request failed", error);
    return null;
  }

  const responseJson = (await response.json().catch(() => ({}))) as {
    phoneCallProviderDetails?: {
      twiml?: string;
    };
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    console.error(
      "Vapi inbound bridge rejected the call",
      responseJson.message || responseJson.error || `HTTP ${response.status}`
    );
    return null;
  }

  const twiml = responseJson.phoneCallProviderDetails?.twiml;
  return typeof twiml === "string" && twiml.trim().length > 0 ? twiml : null;
}

function resolveVapiVoice(input: {
  voice?: string | null;
  voiceProvider?: string | null;
  voiceId?: string | null;
}): {
  config?: {
    provider: string;
    voiceId: string;
    model?: string;
  };
  warning?: string;
} {
  const provider =
    clean(input.voiceProvider) || clean(env.VAPI_DEFAULT_VOICE_PROVIDER) || DEFAULT_VOICE_PROVIDER;

  const explicitVoiceId = clean(input.voiceId);

  const voiceId = looksLikeVoiceId(explicitVoiceId)
    ? explicitVoiceId
    : resolvePresetVoiceId(input.voice || PLATFORM_DEFAULT_VOICE_ID);

  if (!voiceId) {
    return {
      warning:
        "No ElevenLabs voiceId resolved. Set ELEVENLABS_DEFAULT_VOICE_ID or VAPI_DEFAULT_VOICE_ID."
    };
  }

  return {
    config: {
      provider,
      voiceId,
      ...(provider === "11labs" ? { model: env.VAPI_ELEVENLABS_MODEL } : {})
    }
  };
}

function resolveVapiModel(model?: string | null): {
  provider: string;
  model: string;
} {
  const m = (model ?? "gpt-4o-mini").toLowerCase();

  if (m.includes("claude")) {
    return {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022"
    };
  }

  if (m.includes("mini")) {
    return {
      provider: "openai",
      model: "gpt-4o-mini"
    };
  }

  return {
    provider: "openai",
    model: "gpt-4o"
  };
}

function genericAssistantTools() {
  return [
    {
      type: "function",
      function: {
        name: VOICE_TOOL_NAMES.checkAvailability,
        description:
          "Check the connected business calendar for available appointment slots. Always call this before offering exact times.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Appointment date in YYYY-MM-DD. Resolve today/tomorrow using runtime variables; never ask the caller for today's date."
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
            duration_minutes: {
              type: "number",
              description: "Appointment length in minutes."
            }
          },
          required: ["customer_name", "date", "time"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: VOICE_TOOL_NAMES.sendNotification,
        description:
          "Send an SMS or notification after the booking or lead action is completed, if the buyer has SMS configured.",
        parameters: {
          type: "object",
          properties: {
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

export type DeployVapiAssistantInput = {
  name: string;
  firstMessage: string;
  systemPrompt: string;
  model?: string | null;
  voice?: string | null;
  voiceProvider?: string | null;
  voiceId?: string | null;
  serverUrl: string;
  existingAssistantId?: string | null;
};

export async function deployVapiAssistant({
  name,
  firstMessage,
  systemPrompt,
  model,
  voice,
  voiceProvider,
  voiceId,
  serverUrl,
  existingAssistantId
}: DeployVapiAssistantInput): Promise<{ id: string; created: boolean }> {
  if (!env.VAPI_API_KEY) {
    throw new Error("VAPI_API_KEY is required to deploy the voice assistant.");
  }

  const resolvedModel = resolveVapiModel(model);

  const body: Record<string, unknown> = {
    name,
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
      tools: env.VAPI_ENABLE_BOOKING_TOOLS ? genericAssistantTools() : []
    },
    transcriber: {
      provider: env.VAPI_TRANSCRIBER_PROVIDER,
      model: env.VAPI_TRANSCRIBER_MODEL,
      language: "en-US"
    },
    startSpeakingPlan: {
      waitSeconds: 0.4,
      smartEndpointingPlan: {
        provider: "livekit",
        waitFunction: "2000 / (1 + exp(-10 * (x - 0.5)))"
      }
    },
    stopSpeakingPlan: {
      numWords: 0,
      voiceSeconds: 0.2,
      backoffSeconds: 1
    },
    server: {
      url: serverUrl
    }
  };

  const voiceResolution = resolveVapiVoice({
    voice: voice || PLATFORM_DEFAULT_VOICE_ID,
    voiceProvider,
    voiceId
  });

  if (voiceResolution.config) {
    body.voice = voiceResolution.config;
  } else if (voiceResolution.warning) {
    console.warn(`[vapi] ${voiceResolution.warning}`);
  }

  const base = env.VAPI_BASE_URL.replace(/\/$/, "");

  async function send(method: "POST" | "PATCH", url: string) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${env.VAPI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const json = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string | string[];
      error?: string;
    };

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

  if (!result.ok || !result.json.id) {
    const message = Array.isArray(result.json.message)
      ? result.json.message.join("; ")
      : result.json.message || result.json.error || `HTTP ${result.status}`;

    throw new Error(`Vapi assistant deploy failed: ${message}`);
  }

  return {
    id: result.json.id,
    created: !updating
  };
}