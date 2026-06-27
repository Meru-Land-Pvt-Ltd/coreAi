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

/**
 * Ensure a business install has a Vapi assistant id resolved and stored on its
 * BusinessProfile. MVP uses a shared assistant template (the platform default)
 * and injects per-business context at call time via assistantOverrides; the id is
 * persisted so each business has its own resolved config. To clone a dedicated
 * assistant per business later, create one via the Vapi API here and store its id.
 * Returns null (non-fatal) when Vapi is not configured.
 */
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
