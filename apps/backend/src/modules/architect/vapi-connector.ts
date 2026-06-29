import { DENTAL_TOOL_NAMES } from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

/**
 * True only when a real (non-placeholder) Vapi API key is configured. Used so the
 * missed-call flow degrades non-fatally to SMS-only when Vapi isn't set up.
 */
export function isVapiConfigured(): boolean {
  const key = env.VAPI_API_KEY;
  return Boolean(key && !key.includes("your_") && !key.includes("xxx"));
}

function isRealId(value?: string | null): boolean {
  return Boolean(value && !value.includes("your_") && !value.includes("xxx"));
}

export function getVoiceAnswerStatus() {
  const vapiApiKeyConfigured = isVapiConfigured();
  const assistantConfigured = isRealId(env.VAPI_DEFAULT_ASSISTANT_ID);
  const phoneNumberIdConfigured = isRealId(env.VAPI_DEFAULT_PHONE_NUMBER_ID);
  const aiAnswerMode = env.VAPI_ANSWER_INBOUND;

  const ready = vapiApiKeyConfigured && assistantConfigured;

  let blocker: string | null = null;
  if (!vapiApiKeyConfigured) {
    blocker = "VAPI_API_KEY is missing/placeholder — set a real Vapi private API key.";
  } else if (!assistantConfigured) {
    blocker = "VAPI_DEFAULT_ASSISTANT_ID is missing/placeholder — set a real Vapi assistant id.";
  } else if (!aiAnswerMode) {
    blocker =
      "AI answering is wired but off — set VAPI_ANSWER_INBOUND=true so inbound calls are answered by the AI.";
  }

  return {
    aiAnswerMode,
    vapiApiKeyConfigured,
    assistantConfigured,
    phoneNumberIdConfigured,
    phoneNumberIdNote: phoneNumberIdConfigured
      ? null
      : "VAPI_DEFAULT_PHONE_NUMBER_ID is a placeholder and is NOT sent. Only set it (to a real Vapi phone number id) if live calls fail with a Vapi 'phoneNumberId' error.",
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

  const assistantId = env.VAPI_DEFAULT_ASSISTANT_ID;
  if (!isRealId(assistantId)) return null;

  if (business.profile) {
    await prisma.businessProfile.update({
      where: { businessId },
      data: { vapiAssistantId: assistantId }
    });
  }
  return assistantId ?? null;
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
  const resolvedAssistantId = assistantId || env.VAPI_DEFAULT_ASSISTANT_ID;
  const resolvedPhoneNumberId = phoneNumberId || env.VAPI_DEFAULT_PHONE_NUMBER_ID;

  if (!env.VAPI_API_KEY || !resolvedAssistantId || !resolvedPhoneNumberId) {
    throw new Error(
      "Vapi is not configured. Add VAPI_API_KEY, VAPI_DEFAULT_ASSISTANT_ID, and VAPI_DEFAULT_PHONE_NUMBER_ID, or set them per business installation."
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
  return {
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
    timeZone: business.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
    missedCallReason: reason
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
        source: "coreai_missed_call_text_back"
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
  metadata = {}
}: {
  callerNumber: string;
  callerName?: string | null;
  business: VapiBusinessContext;
  reason: string;
  assistantId?: string | null;
  phoneNumberId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  const resolvedAssistantId = assistantId || env.VAPI_DEFAULT_ASSISTANT_ID;

  if (!env.VAPI_API_KEY || !isRealId(resolvedAssistantId) || !callerNumber) {
    return null;
  }

  const payload: Record<string, unknown> = {
    assistantId: resolvedAssistantId,
    phoneCallProviderBypassEnabled: true,
    customer: { number: callerNumber },
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
      source: "coreai_inbound_ai_receptionist"
    }
  };

  const resolvedPhoneNumberId = phoneNumberId || env.VAPI_DEFAULT_PHONE_NUMBER_ID;
  if (isRealId(resolvedPhoneNumberId)) {
    payload.phoneNumberId = resolvedPhoneNumberId;
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
    phoneCallProviderDetails?: { twiml?: string };
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

const ELEVENLABS_VOICE_IDS: Record<string, string> = {
  sarah: "EXAVITQu4vr4xnSDxMaL"
};

/** Resolve the builder voice selection to a Vapi voice config, or undefined to use the account default. */
function resolveVapiVoice(voice?: string | null): { provider: string; voiceId: string } | undefined {
  const raw = (voice ?? "").trim();
  const mapped = ELEVENLABS_VOICE_IDS[raw.toLowerCase()];
  // Treat a long, space-free value as an already-resolved ElevenLabs voice id.
  const looksLikeId = raw.length >= 18 && !raw.includes(" ");
  const voiceId = mapped || (looksLikeId ? raw : "") || env.VAPI_DEFAULT_VOICE_ID || "";
  if (!voiceId) return undefined;
  return { provider: "11labs", voiceId };
}

/** Map the builder model selection to a Vapi model provider/model pair. */
function resolveVapiModel(model?: string | null): { provider: string; model: string } {
  const m = (model ?? "gpt-4o").toLowerCase();
  if (m.includes("claude")) return { provider: "anthropic", model: "claude-3-5-sonnet-20241022" };
  if (m.includes("mini")) return { provider: "openai", model: "gpt-4o-mini" };
  return { provider: "openai", model: "gpt-4o" };
}

/** The 3 function tools the dental assistant calls back into our Vapi webhook. */
function dentalAssistantTools() {
  return [
    {
      type: "function",
      function: {
        name: DENTAL_TOOL_NAMES.checkAvailability,
        description: "Check the dentist's Google Calendar for open appointment slots on a given date. Always call this before offering times.",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "Requested date, ISO YYYY-MM-DD." },
            service_type: { type: "string", description: "The dental service, e.g. cleaning." },
            duration_minutes: { type: "number", description: "Appointment length in minutes." }
          },
          required: ["date"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: DENTAL_TOOL_NAMES.bookAppointment,
        description: "Book the appointment in Google Calendar after the patient confirms a slot.",
        parameters: {
          type: "object",
          properties: {
            patient_name: { type: "string" },
            patient_phone: { type: "string" },
            date: { type: "string", description: "ISO YYYY-MM-DD." },
            time: { type: "string", description: "24h HH:mm." },
            service_type: { type: "string" },
            duration_minutes: { type: "number" }
          },
          required: ["patient_name", "date", "time"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: DENTAL_TOOL_NAMES.sendNotification,
        description: "Send SMS confirmations to the patient and the dentist after the booking is created.",
        parameters: {
          type: "object",
          properties: {
            patient_phone: { type: "string" },
            patient_name: { type: "string" },
            appointment_date: { type: "string" },
            appointment_time: { type: "string" },
            service: { type: "string" },
            doctor_name: { type: "string" }
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
  serverUrl: string;
  existingAssistantId?: string | null;
};

export async function deployVapiAssistant({
  name,
  firstMessage,
  systemPrompt,
  model,
  voice,
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
      messages: [{ role: "system", content: systemPrompt }],
      tools: dentalAssistantTools()
    },
    server: { url: serverUrl }
  };

  const voiceConfig = resolveVapiVoice(voice);
  if (voiceConfig) body.voice = voiceConfig;

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
    return { ok: response.ok, status: response.status, json };
  }

  const updating = isRealId(existingAssistantId);
  let result = updating
    ? await send("PATCH", `${base}/assistant/${existingAssistantId}`)
    : await send("POST", `${base}/assistant`);

  // If the stored assistant was deleted upstream, fall back to creating a new one.
  if (!result.ok && updating && (result.status === 404 || result.status === 400)) {
    result = await send("POST", `${base}/assistant`);
  }

  if (!result.ok || !result.json.id) {
    const message = Array.isArray(result.json.message)
      ? result.json.message.join("; ")
      : result.json.message || result.json.error || `HTTP ${result.status}`;
    throw new Error(`Vapi assistant deploy failed: ${message}`);
  }

  return { id: result.json.id, created: !updating };
}
