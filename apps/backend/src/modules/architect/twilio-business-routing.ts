import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { env, isProduction } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest, type WorkflowRunInput } from "./workflow-runner";
import { escapeXml, sendTwilioSms } from "./twilio-connector";
import { createVapiInboundTwiml, startVapiOutboundCall } from "./vapi-connector";
import {
  createGoogleCalendarAppointment,
  getDefaultAppointmentWindow,
  listAvailableSlots,
  zonedWallClockToUtc
} from "./google-calendar-connector";
import { parseRequestedAppointment } from "./appointment-parser";

type TwilioBody = Record<string, unknown>;

type BusinessRuntimeContext = {
  businessId?: string;
  ownerId?: string;
  installedAgentId?: string;
  listingId?: string;
  businessName: string;
  businessType?: string;
  businessPhoneNumber?: string;
  bookingUrl?: string;
  teamPhone?: string;
  calendarId?: string;
  timeZone?: string;
  vapiAssistantId?: string;
  vapiPhoneNumberId?: string;
  services: string[];
  faqs: string[];
  tone?: string;
  escalationRules?: string;
  knowledge: string[];
  hours?: unknown;
};

type ResolvedAgent = {
  workflowId: string;
  userId: string;
  workflowJson: unknown;
  forwardToPhone?: string;
  business?: BusinessRuntimeContext;
};

function normalizePhoneNumber(value: string) {
  return value.replace(/[^+\d]/g, "").trim();
}

async function parseBody(c: Context): Promise<Record<string, unknown>> {
  const contentType = c.req.header("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  }

  return (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
}

function stringParams(body: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

/**
 * Rebuild the exact URL Twilio signed. Twilio signs the webhook URL it was
 * configured with, so we anchor to BACKEND_URL (the same base advertised by the
 * installation endpoint) and keep the path + query string intact.
 */
function twilioRequestUrl(c: Context): string {
  const base = env.BACKEND_URL.replace(/\/$/, "");
  const parsed = new URL(c.req.url);
  return `${base}${parsed.pathname}${parsed.search}`;
}

function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

/**
 * Validates the X-Twilio-Signature header. Disabled by default
 * (TWILIO_VALIDATE_SIGNATURE) so local/manual testing and the :workflowId test
 * endpoints keep working; enable it in production once BACKEND_URL is the public
 * URL Twilio posts to.
 */
function isValidTwilioRequest(c: Context, body: Record<string, unknown>): boolean {
  if (!env.TWILIO_VALIDATE_SIGNATURE) return true;

  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn(
      "TWILIO_VALIDATE_SIGNATURE is enabled but TWILIO_AUTH_TOKEN is missing; rejecting Twilio webhook."
    );
    return false;
  }

  const signature = c.req.header("X-Twilio-Signature") ?? c.req.header("x-twilio-signature");
  if (!signature) return false;

  const expected = computeTwilioSignature(authToken, twilioRequestUrl(c), stringParams(body));
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);

  return provided.length === computed.length && timingSafeEqual(provided, computed);
}

function readBodyString(body: TwilioBody, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function getNestedRecord(value: unknown, keys: string[]) {
  let current = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function firstNestedString(body: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    const value = getNestedRecord(body, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function jsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  return [];
}

function faqStrings(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          const question = typeof record.question === "string" ? record.question : "";
          const answer = typeof record.answer === "string" ? record.answer : "";
          return [question, answer].filter(Boolean).join(" - ");
        }
        return "";
      })
      .filter(Boolean);
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>).filter((item): item is string => typeof item === "string");
  }

  return [];
}

function buildBusinessContext(
  business: any,
  phoneNumber?: string | null,
  installedAgent?: { id?: string; listingId?: string | null } | null
): BusinessRuntimeContext {
  const profile = business?.profile;
  const knowledgeBases = Array.isArray(business?.knowledgeBases) ? business.knowledgeBases : [];

  return {
    businessId: business?.id,
    ownerId: business?.ownerId,
    installedAgentId: installedAgent?.id,
    listingId: installedAgent?.listingId ?? undefined,
    businessName: business?.name ?? env.TWILIO_DEFAULT_BUSINESS_NAME ?? "the business",
    businessType: business?.type ?? undefined,
    businessPhoneNumber: phoneNumber ?? undefined,
    bookingUrl: profile?.bookingUrl ?? env.TWILIO_DEFAULT_BOOKING_URL ?? undefined,
    teamPhone: profile?.teamPhone ?? env.TWILIO_DEFAULT_TEAM_PHONE ?? undefined,
    calendarId: profile?.calendarId ?? env.GOOGLE_CALENDAR_ID ?? "primary",
    timeZone: profile?.timeZone ?? env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
    vapiAssistantId: profile?.vapiAssistantId ?? env.VAPI_DEFAULT_ASSISTANT_ID ?? undefined,
    vapiPhoneNumberId: profile?.vapiPhoneNumberId ?? env.VAPI_DEFAULT_PHONE_NUMBER_ID ?? undefined,
    services: jsonStringArray(profile?.services),
    faqs: faqStrings(profile?.faqsJson),
    tone: profile?.tone ?? "friendly",
    escalationRules: profile?.escalationRules ?? undefined,
    hours: profile?.hoursJson ?? undefined,
    knowledge: knowledgeBases
      .map((item: any) => `${item.title ? `${item.title}: ` : ""}${item.content ?? ""}`.trim())
      .filter(Boolean)
  };
}

async function resolveAgent({
  calledNumber,
  workflowId
}: {
  calledNumber?: string;
  workflowId?: string;
}): Promise<ResolvedAgent | null> {
  const normalizedCalledNumber = calledNumber ? normalizePhoneNumber(calledNumber) : "";

  if (normalizedCalledNumber) {
    const phoneNumber = await prisma.businessPhoneNumber.findUnique({
      where: { phoneNumber: normalizedCalledNumber },
      include: {
        business: {
          include: {
            profile: true,
            knowledgeBases: true
          }
        },
        installedAgent: {
          include: {
            workflow: true
          }
        }
      }
    });

    if (phoneNumber?.installedAgent?.workflow) {
      return {
        workflowId: phoneNumber.installedAgent.workflow.id,
        userId: phoneNumber.installedAgent.workflow.architectUserId,
        workflowJson: phoneNumber.installedAgent.workflow.workflowJson,
        forwardToPhone: phoneNumber.forwardToPhone ?? undefined,
        business: buildBusinessContext(
          phoneNumber.business,
          phoneNumber.phoneNumber,
          phoneNumber.installedAgent
        )
      };
    }
  }

  if (workflowId) {
    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: workflowId },
      select: {
        id: true,
        architectUserId: true,
        workflowJson: true
      }
    });

    if (workflow) {
      return {
        workflowId: workflow.id,
        userId: workflow.architectUserId,
        workflowJson: workflow.workflowJson,
        forwardToPhone: env.TWILIO_FORWARD_TO_PHONE,
        business: {
          businessName: env.TWILIO_DEFAULT_BUSINESS_NAME ?? normalizedCalledNumber ?? "the business",
          businessType: undefined,
          businessPhoneNumber: normalizedCalledNumber || env.TWILIO_PHONE_NUMBER,
          bookingUrl: env.TWILIO_DEFAULT_BOOKING_URL,
          teamPhone: env.TWILIO_DEFAULT_TEAM_PHONE,
          calendarId: env.GOOGLE_CALENDAR_ID ?? "primary",
          timeZone: env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
          vapiAssistantId: env.VAPI_DEFAULT_ASSISTANT_ID,
          vapiPhoneNumberId: env.VAPI_DEFAULT_PHONE_NUMBER_ID,
          services: [],
          faqs: [],
          tone: "friendly",
          knowledge: []
        }
      };
    }
  }

  return null;
}

function runInputFromContext({
  agent,
  callerNumber,
  callerName,
  body,
  reason
}: {
  agent: ResolvedAgent;
  callerNumber: string;
  callerName?: string;
  body?: string;
  reason: string;
}): WorkflowRunInput {
  const business = agent.business;

  return {
    callerNumber,
    callerName,
    businessId: business?.businessId,
    businessOwnerId: business?.ownerId,
    installedAgentId: business?.installedAgentId,
    listingId: business?.listingId,
    businessName: business?.businessName,
    businessType: business?.businessType,
    businessPhoneNumber: business?.businessPhoneNumber,
    bookingUrl: business?.bookingUrl,
    teamPhone: business?.teamPhone,
    calendarId: business?.calendarId,
    timeZone: business?.timeZone,
    vapiAssistantId: business?.vapiAssistantId,
    vapiPhoneNumberId: business?.vapiPhoneNumberId,
    services: business?.services,
    faqs: business?.faqs,
    tone: business?.tone,
    escalationRules: business?.escalationRules,
    knowledge: business?.knowledge,
    businessHours: business?.hours,
    callStatus: "no-answer",
    callTimestamp: new Date().toISOString(),
    missedCallReason: reason,
    inboundSmsBody: body
  };
}

async function upsertConversation({
  businessId,
  customerPhone,
  direction,
  body,
  providerId
}: {
  businessId?: string;
  customerPhone: string;
  direction: "INBOUND" | "OUTBOUND" | "SYSTEM";
  body: string;
  providerId?: string | null;
}) {
  if (!businessId) return null;

  const conversation = await prisma.conversation.upsert({
    where: {
      businessId_channel_customerPhone: {
        businessId,
        channel: "SMS",
        customerPhone
      }
    },
    update: {
      status: "OPEN"
    },
    create: {
      businessId,
      channel: "SMS",
      customerPhone,
      status: "OPEN"
    }
  });

  await prisma.conversationMessage.create({
    data: {
      conversationId: conversation.id,
      direction,
      body,
      providerId: providerId ?? null
    }
  });

  return conversation;
}

async function upsertLead({
  businessId,
  phoneNumber,
  source,
  status,
  notes,
  name
}: {
  businessId?: string;
  phoneNumber: string;
  source: string;
  status: string;
  notes?: string;
  name?: string;
}) {
  if (!businessId) return null;

  return prisma.lead.upsert({
    where: {
      businessId_phoneNumber: {
        businessId,
        phoneNumber
      }
    },
    update: {
      status,
      notes,
      name: name || undefined
    },
    create: {
      businessId,
      phoneNumber,
      source,
      status,
      notes,
      name
    }
  });
}

type ConversationTurn = {
  direction: string;
  body: string;
};

/** Loads recent conversation messages (chronological) for reply context. */
async function loadConversationHistory(
  conversationId: string,
  limit = 12
): Promise<ConversationTurn[]> {
  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { direction: true, body: true }
  });

  return messages.reverse().map((message) => ({
    direction: message.direction,
    body: message.body
  }));
}

/** Best-effort match of the requested service against the business's offerings. */
function inferService(message: string, services: string[]): string {
  const normalized = message.toLowerCase();
  const match = services.find((service) => normalized.includes(service.toLowerCase()));
  return match || "Appointment";
}

function formatAppointmentTime(iso: string, timeZone?: string | null): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/**
 * Shared appointment creation used by both the Vapi voice booking tool and the
 * inbound-SMS booking path: creates the Google Calendar event and persists the
 * Appointment row. Requires the business to have an owner (for Google OAuth).
 */
async function createBusinessAppointment({
  business,
  customerPhone,
  customerName,
  service,
  startAt,
  endAt,
  conversationId,
  description,
  notes
}: {
  business: BusinessRuntimeContext;
  customerPhone: string;
  customerName?: string | null;
  service: string;
  startAt: Date | string;
  endAt: Date | string;
  conversationId?: string | null;
  description?: string | null;
  notes?: string | null;
}) {
  if (!business.businessId || !business.ownerId) {
    throw new Error("Business is not fully configured for calendar booking.");
  }

  const calendarEvent = await createGoogleCalendarAppointment({
    userId: business.ownerId,
    calendarId: business.calendarId,
    timeZone: business.timeZone,
    businessName: business.businessName,
    customerName,
    customerPhone,
    service,
    startAt,
    endAt,
    description:
      description ??
      `Booked by CORE AI Receptionist for ${business.businessName}. Phone: ${customerPhone}`
  });

  const appointment = await prisma.appointment.create({
    data: {
      businessId: business.businessId,
      conversationId: conversationId ?? undefined,
      customerPhone,
      customerName: customerName ?? undefined,
      service,
      startAt: new Date(calendarEvent.startAt),
      endAt: new Date(calendarEvent.endAt),
      timeZone: calendarEvent.timeZone,
      calendarEventId: calendarEvent.id,
      notes: notes ?? undefined
    }
  });

  return { calendarEvent, appointment };
}

function buildInboundSmsReply(
  agent: ResolvedAgent,
  incomingBody: string,
  history: ConversationTurn[] = []
) {
  const business = agent.business;
  const businessName = business?.businessName ?? "the business";
  const businessType = business?.businessType ?? "business";
  const bookingUrl = business?.bookingUrl;
  const teamPhone = business?.teamPhone;
  const services = business?.services ?? [];
  const knowledge = [...(business?.faqs ?? []), ...(business?.knowledge ?? [])];
  const normalizedMessage = incomingBody.toLowerCase();

  // Use prior conversation context so we do not re-introduce the business on
  // every message and can keep the thread moving toward a booking.
  const hasGreeted = history.some((turn) => turn.direction === "OUTBOUND");
  const askedForTime = history.some(
    (turn) => turn.direction === "OUTBOUND" && /time|day|when|book/i.test(turn.body)
  );

  if (/book|appointment|schedule|yes|visit|slot|available|reschedule/.test(normalizedMessage)) {
    if (bookingUrl) {
      return `Absolutely — you can book with ${businessName} here: ${bookingUrl}. If you prefer, reply with your preferred day and time and we'll set it up.`;
    }

    if (teamPhone) {
      return askedForTime
        ? `Great — just reply with the exact day and time you'd like and we'll lock it in, or our team can call you from ${teamPhone}.`
        : `Absolutely — ${businessName} can help schedule that. What day and time works best? Our team can also call you from ${teamPhone}.`;
    }

    return `Happy to help you book with ${businessName}. What day and time works best for you?`;
  }

  if (/price|cost|fee|charge|rate|quote|estimate|how much/.test(normalizedMessage)) {
    const hint = knowledge.find((item) => /price|cost|fee|charge|rate|quote|estimate|cleaning|install|repair/i.test(item));
    if (hint) return hint;
  }

  const matchingService = services.find((service) => normalizedMessage.includes(service.toLowerCase().split(" ")[0] ?? ""));
  if (matchingService) {
    return `${businessName} can help with ${matchingService}. ${bookingUrl ? `You can book here: ${bookingUrl}` : "Reply with a day and time that works and we'll schedule it."}`;
  }

  const firstKnowledge = knowledge[0];
  if (firstKnowledge && !hasGreeted) {
    return `${businessName} is a ${businessType}. ${firstKnowledge} ${bookingUrl ? `You can also book here: ${bookingUrl}` : "How can we help you next?"}`;
  }

  if (hasGreeted) {
    return `Thanks for the reply. Want me to book you in with ${businessName}, or is there a question I can answer?${bookingUrl ? ` Booking link: ${bookingUrl}` : ""}`;
  }

  return `Thanks for texting ${businessName}. How can we help you today?${bookingUrl ? ` You can also book here: ${bookingUrl}` : ""}`;
}

async function maybeStartVapiAfterMissedCall({
  agent,
  callerNumber,
  callerName,
  conversationId,
  reason,
  existingCallId
}: {
  agent: ResolvedAgent;
  callerNumber: string;
  callerName?: string;
  conversationId?: string | null;
  reason: string;
  existingCallId?: string | null;
}) {
  if (existingCallId || !agent.business) return existingCallId ?? null;

  const call = await startVapiOutboundCall({
    customerPhone: callerNumber,
    customerName: callerName,
    business: {
      businessId: agent.business.businessId,
      businessName: agent.business.businessName,
      businessType: agent.business.businessType,
      bookingUrl: agent.business.bookingUrl,
      teamPhone: agent.business.teamPhone,
      services: agent.business.services,
      faqs: agent.business.faqs,
      knowledge: agent.business.knowledge,
      tone: agent.business.tone,
      escalationRules: agent.business.escalationRules,
      calendarId: agent.business.calendarId,
      timeZone: agent.business.timeZone
    },
    reason,
    assistantId: agent.business.vapiAssistantId,
    phoneNumberId: agent.business.vapiPhoneNumberId,
    metadata: {
      businessId: agent.business.businessId,
      businessOwnerId: agent.business.ownerId,
      conversationId,
      workflowId: agent.workflowId
    }
  });

  if (agent.business.businessId && call.id) {
    await prisma.vapiCall.upsert({
      where: { callId: call.id },
      update: {
        status: call.status ?? "STARTED",
        conversationId: conversationId ?? undefined
      },
      create: {
        businessId: agent.business.businessId,
        conversationId: conversationId ?? undefined,
        callId: call.id,
        customerPhone: callerNumber,
        status: call.status ?? "STARTED",
        metadataJson: {
          workflowId: agent.workflowId,
          reason
        }
      }
    });
  }

  return call.id;
}

async function runMissedCallAgent({
  agent,
  callerNumber,
  callerName,
  reason
}: {
  agent: ResolvedAgent;
  callerNumber: string;
  callerName?: string;
  reason: string;
}) {
  const conversation = await upsertConversation({
    businessId: agent.business?.businessId,
    customerPhone: callerNumber,
    direction: "SYSTEM",
    body: `Missed call detected. ${reason}`,
    providerId: null
  });

  const run = await runWorkflowTest({
    userId: agent.business?.ownerId ?? agent.userId,
    workflowId: agent.workflowId,
    workflowJson: agent.workflowJson,
    mode: "live",
    input: runInputFromContext({
      agent,
      callerNumber,
      callerName,
      reason
    })
  });

  const sentSms = typeof run.context.sentSms === "object" && run.context.sentSms !== null
    ? (run.context.sentSms as { body?: string; id?: string | null })
    : null;

  // Skip if a Save Conversation node in the workflow already persisted the reply.
  if (sentSms?.body && !run.context.conversationSaved) {
    await upsertConversation({
      businessId: agent.business?.businessId,
      customerPhone: callerNumber,
      direction: "OUTBOUND",
      body: sentSms.body,
      providerId: sentSms.id ?? null
    });
  }

  const existingVapiId = typeof run.context.vapiCall === "object" && run.context.vapiCall !== null
    ? (run.context.vapiCall as { id?: string | null }).id
    : null;

  await maybeStartVapiAfterMissedCall({
    agent,
    callerNumber,
    callerName,
    conversationId: conversation?.id,
    reason,
    existingCallId: existingVapiId
  }).catch((error) => {
    console.error("Vapi follow-up call failed", error);
  });

  // Skip if a Save Lead node in the workflow already persisted the lead.
  if (!run.context.leadSaved) {
    await upsertLead({
      businessId: agent.business?.businessId,
      phoneNumber: callerNumber,
      source: "TWILIO_MISSED_CALL",
      status: "CAPTURED",
      notes: reason,
      name: callerName
    });
  }

  return run;
}

async function buildVapiAnswerTwiml({
  agent,
  callerNumber,
  callerName,
  reason
}: {
  agent: ResolvedAgent;
  callerNumber: string;
  callerName?: string;
  reason: string;
}): Promise<string | null> {
  const business = agent.business;
  if (!business || !callerNumber) return null;

  return createVapiInboundTwiml({
    callerNumber,
    callerName,
    reason,
    business: {
      businessId: business.businessId,
      businessName: business.businessName,
      businessType: business.businessType,
      bookingUrl: business.bookingUrl,
      teamPhone: business.teamPhone,
      services: business.services,
      faqs: business.faqs,
      knowledge: business.knowledge,
      tone: business.tone,
      escalationRules: business.escalationRules,
      calendarId: business.calendarId,
      timeZone: business.timeZone
    },
    assistantId: business.vapiAssistantId,
    phoneNumberId: business.vapiPhoneNumberId,
    metadata: {
      businessId: business.businessId,
      businessOwnerId: business.ownerId,
      installedAgentId: business.installedAgentId,
      workflowId: agent.workflowId
    }
  });
}

export async function handleTwilioVoice(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseBody(c);

  if (!isValidTwilioRequest(c, body)) {
    return c.text("<Response><Reject /></Response>", 403, {
      "Content-Type": "text/xml"
    });
  }

  const calledNumber = readBodyString(body, ["Called", "To", "to"]);
  const callerNumber = readBodyString(body, ["From", "Caller", "from"]);
  const callerName = readBodyString(body, ["CallerName", "callerName"]) || undefined;
  const agent = await resolveAgent({ calledNumber, workflowId });

  if (!agent) {
    return c.text("<Response><Reject /></Response>", 404, {
      "Content-Type": "text/xml"
    });
  }

  const forwardToPhone = agent.forwardToPhone ?? env.TWILIO_FORWARD_TO_PHONE;

  // Live AI answer: when AI-first answering is enabled, or when there is no human
  // number to forward to, connect the caller straight to the Vapi AI receptionist.
  // If Vapi can't take the call we fall through to forwarding / the existing
  // message, so the missed-call text-back path is never broken.
  if (env.VAPI_ANSWER_INBOUND || !forwardToPhone) {
    const aiTwiml = await buildVapiAnswerTwiml({
      agent,
      callerNumber,
      callerName,
      reason: "Inbound call answered live by the AI receptionist."
    });

    if (aiTwiml) {
      return c.text(aiTwiml, 200, { "Content-Type": "text/xml" });
    }
  }

  if (!forwardToPhone) {
    return c.text("<Response><Say>Sorry, this business is not available right now.</Say></Response>", 200, {
      "Content-Type": "text/xml"
    });
  }

  const actionUrl = `${env.BACKEND_URL}/architect/connectors/twilio/voice-action/${agent.workflowId}?to=${encodeURIComponent(calledNumber)}`;
  const responseXml = [
    "<Response>",
    `<Dial timeout=\"${env.TWILIO_FORWARD_TIMEOUT_SECONDS}\" action=\"${escapeXml(actionUrl)}\" method=\"POST\" answerOnBridge=\"true\">`,
    `<Number>${escapeXml(forwardToPhone)}</Number>`,
    "</Dial>",
    "</Response>"
  ].join("");

  return c.text(responseXml, 200, {
    "Content-Type": "text/xml"
  });
}

export async function handleTwilioVoiceAction(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseBody(c);

  if (!isValidTwilioRequest(c, body)) {
    return c.text("<Response></Response>", 403, { "Content-Type": "text/xml" });
  }

  const calledNumber = readBodyString(body, ["Called", "To", "to"]) || c.req.query("to") || "";
  const callerNumber = readBodyString(body, ["From", "Caller", "from"]);
  const callerName = readBodyString(body, ["CallerName", "callerName"]);
  const dialStatus = readBodyString(body, ["DialCallStatus", "DialStatus", "CallStatus"]);
  const agent = await resolveAgent({ calledNumber, workflowId });

  if (!agent || !callerNumber) {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  if (dialStatus === "completed") {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  await runMissedCallAgent({
    agent,
    callerNumber,
    callerName,
    reason: `Twilio forwarded the call but office did not answer. Dial status: ${dialStatus || "unknown"}.`
  });

  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
}

export async function handleTwilioMissedCall(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseBody(c);

  if (!isValidTwilioRequest(c, body)) {
    return c.text("<Response></Response>", 403, { "Content-Type": "text/xml" });
  }

  const calledNumber = readBodyString(body, ["Called", "To", "to"]);
  const callerNumber = readBodyString(body, ["From", "Caller", "from"]);
  const callerName = readBodyString(body, ["CallerName", "callerName"]);
  const agent = await resolveAgent({ calledNumber, workflowId });

  if (!agent || !callerNumber) {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  await runMissedCallAgent({
    agent,
    callerNumber,
    callerName,
    reason: "Direct Twilio missed-call webhook triggered this agent."
  });

  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
}

export async function handleTwilioInboundSms(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseBody(c);

  if (!isValidTwilioRequest(c, body)) {
    return c.text("<Response></Response>", 403, { "Content-Type": "text/xml" });
  }

  const businessNumber = readBodyString(body, ["To", "to"]);
  const customerPhone = readBodyString(body, ["From", "from"]);
  const incomingBody = readBodyString(body, ["Body", "body"]);
  const agent = await resolveAgent({ calledNumber: businessNumber, workflowId });

  if (!agent || !customerPhone || !incomingBody) {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  const conversation = await upsertConversation({
    businessId: agent.business?.businessId,
    customerPhone,
    direction: "INBOUND",
    body: incomingBody,
    providerId: readBodyString(body, ["MessageSid", "SmsSid"])
  });

  const history = conversation?.id ? await loadConversationHistory(conversation.id) : [];

  // If the customer texted a concrete day + time, book it straight to Google
  // Calendar and confirm by SMS. Otherwise fall back to a context-aware reply.
  let replyBody: string;
  let bookedEventId: string | null = null;

  const requestedSlot =
    agent.business?.businessId && agent.business?.ownerId
      ? parseRequestedAppointment(
          incomingBody,
          agent.business.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE
        )
      : null;

  if (requestedSlot && agent.business) {
    try {
      const service = inferService(incomingBody, agent.business.services);
      const { calendarEvent } = await createBusinessAppointment({
        business: agent.business,
        customerPhone,
        service,
        startAt: requestedSlot.startAt,
        endAt: requestedSlot.endAt,
        conversationId: conversation?.id,
        description: `Booked from inbound SMS for ${agent.business.businessName}. Phone: ${customerPhone}`,
        notes: `Requested via SMS: "${incomingBody}"`
      });

      bookedEventId = calendarEvent.id;
      replyBody = `You're booked with ${agent.business.businessName}: ${service} on ${formatAppointmentTime(
        calendarEvent.startAt,
        agent.business.timeZone
      )}. Reply here if you need to change it.`;
    } catch (error) {
      console.error("Inbound SMS booking failed", error);
      replyBody = buildInboundSmsReply(agent, incomingBody, history);
    }
  } else {
    replyBody = buildInboundSmsReply(agent, incomingBody, history);
  }

  const sent = await sendTwilioSms({
    to: customerPhone,
    body: replyBody,
    fromPhoneNumber: agent.business?.businessPhoneNumber
  });

  await upsertConversation({
    businessId: agent.business?.businessId,
    customerPhone,
    direction: "OUTBOUND",
    body: replyBody,
    providerId: bookedEventId ?? sent.id
  });

  await upsertLead({
    businessId: agent.business?.businessId,
    phoneNumber: customerPhone,
    source: "TWILIO_SMS",
    status: bookedEventId ? "BOOKED" : "ENGAGED",
    notes: incomingBody
  });

  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
}

function getVapiMetadata(body: Record<string, unknown>) {
  const metadata = getNestedRecord(body, ["message", "call", "metadata"]);
  if (typeof metadata === "object" && metadata !== null) return metadata as Record<string, unknown>;
  const directMetadata = body.metadata;
  if (typeof directMetadata === "object" && directMetadata !== null) return directMetadata as Record<string, unknown>;
  return {} as Record<string, unknown>;
}

function getFirstToolCall(body: Record<string, unknown>) {
  // Vapi OpenAI-style: message.toolCalls[0] = { id, function: { name, arguments } }
  // where `arguments` is a JSON string.
  for (const path of [["message", "toolCalls"], ["toolCalls"]]) {
    const calls = getNestedRecord(body, path);
    if (Array.isArray(calls) && calls.length > 0 && typeof calls[0] === "object" && calls[0] !== null) {
      const record = calls[0] as Record<string, unknown>;
      const fn =
        typeof record.function === "object" && record.function !== null
          ? (record.function as Record<string, unknown>)
          : {};
      const name = typeof fn.name === "string" ? fn.name : typeof record.name === "string" ? record.name : "";
      if (name) {
        let parameters: Record<string, unknown> = {};
        const raw = fn.arguments ?? record.arguments;
        if (typeof raw === "string") {
          try {
            parameters = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            parameters = {};
          }
        } else if (typeof raw === "object" && raw !== null) {
          parameters = raw as Record<string, unknown>;
        }
        return {
          id: typeof record.id === "string" ? record.id : "",
          name,
          parameters
        };
      }
    }
  }

  const list = getNestedRecord(body, ["message", "toolCallList"]);
  if (Array.isArray(list) && list.length > 0 && typeof list[0] === "object" && list[0] !== null) {
    const record = list[0] as Record<string, unknown>;
    return {
      id: typeof record.id === "string" ? record.id : "",
      name: typeof record.name === "string" ? record.name : "",
      parameters:
        typeof record.parameters === "object" && record.parameters !== null
          ? (record.parameters as Record<string, unknown>)
          : {}
    };
  }

  const toolWithToolCallList = getNestedRecord(body, ["message", "toolWithToolCallList"]);
  if (Array.isArray(toolWithToolCallList) && toolWithToolCallList.length > 0 && typeof toolWithToolCallList[0] === "object" && toolWithToolCallList[0] !== null) {
    const record = toolWithToolCallList[0] as Record<string, unknown>;
    const toolCall = typeof record.toolCall === "object" && record.toolCall !== null ? (record.toolCall as Record<string, unknown>) : {};
    return {
      id: typeof toolCall.id === "string" ? toolCall.id : "",
      name: typeof record.name === "string" ? record.name : "",
      parameters:
        typeof toolCall.parameters === "object" && toolCall.parameters !== null
          ? (toolCall.parameters as Record<string, unknown>)
          : {}
    };
  }

  const legacyName = firstNestedString(body, [
    ["message", "toolCall", "function", "name"],
    ["toolCall", "function", "name"],
    ["function", "name"]
  ]);
  const legacyId = firstNestedString(body, [
    ["message", "toolCall", "id"],
    ["toolCall", "id"],
    ["id"]
  ]);
  const rawArguments =
    getNestedRecord(body, ["message", "toolCall", "function", "arguments"]) ??
    getNestedRecord(body, ["toolCall", "function", "arguments"]) ??
    body.arguments;

  let parameters: Record<string, unknown> = {};
  if (typeof rawArguments === "string") {
    try {
      parameters = JSON.parse(rawArguments) as Record<string, unknown>;
    } catch {
      parameters = {};
    }
  } else if (typeof rawArguments === "object" && rawArguments !== null) {
    parameters = rawArguments as Record<string, unknown>;
  }

  return {
    id: legacyId,
    name: legacyName,
    parameters
  };
}

async function findBusinessByVapiWebhook(body: Record<string, unknown>) {
  const metadata = getVapiMetadata(body);
  const businessId = typeof metadata.businessId === "string" ? metadata.businessId : "";

  if (!businessId) return null;

  return prisma.business.findUnique({
    where: { id: businessId },
    include: {
      profile: true,
      knowledgeBases: true
    }
  });
}

type DentalToolConfig = {
  bufferMinutes: number;
  slotsToOffer: number;
  openHour: number;
  closeHour: number;
  defaultDurationMinutes: number;
  doctorName: string;
  sendToPatient: boolean;
  sendToDentist: boolean;
  dentistPhone: string;
  patientTemplate: string;
  dentistTemplate: string;
  confirmationMessage: string;
};

/** Read the dental tool params persisted on the InstalledAgent at Deploy time. */
async function loadDentalToolConfig(businessId: string): Promise<DentalToolConfig> {
  const agent = await prisma.installedAgent.findFirst({
    where: { businessId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { configJson: true }
  });
  const cfg = ((agent?.configJson as Record<string, unknown> | null)?.dentalConfig ?? {}) as Record<string, unknown>;
  const num = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
  return {
    bufferMinutes: num(cfg.bufferMinutes, 10),
    slotsToOffer: num(cfg.slotsToOffer, 3),
    openHour: num(cfg.openHour, 9),
    closeHour: num(cfg.closeHour, 17),
    defaultDurationMinutes: num(cfg.defaultDurationMinutes, 30),
    doctorName: str(cfg.doctorName),
    sendToPatient: cfg.sendToPatient !== false,
    sendToDentist: cfg.sendToDentist !== false,
    dentistPhone: normalizePhoneNumber(str(cfg.dentistPhone)),
    patientTemplate: str(
      cfg.patientTemplate,
      "Confirmed: [Service] with [Doctor Name], [Date] at [Time]. Reply C to cancel."
    ),
    dentistTemplate: str(
      cfg.dentistTemplate,
      "New booking: [Patient Name], [Date] [Time], [Service]. Phone: [Patient Phone]"
    ),
    confirmationMessage: str(cfg.confirmationMessage)
  };
}

/** Fill [Bracketed] tokens in a dental SMS/confirmation template. */
function applyBracketTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\[([^\]]+)\]/g, (match, key: string) => {
    const normalized = key.trim().toLowerCase();
    return values[normalized] ?? match;
  });
}

/** Shape a Vapi tool result envelope. */
function vapiToolResult(toolCall: { id: string; name: string }, result: unknown) {
  return {
    results: [
      {
        name: toolCall.name,
        toolCallId: toolCall.id,
        result: typeof result === "string" ? result : JSON.stringify(result)
      }
    ]
  };
}

/** Day-1 demo fallback slots when the calendar can't be read (keeps the AI moving). */
const DEMO_AVAILABILITY_SLOTS = ["10:00 AM", "2:00 PM", "4:30 PM"];

/** Classify a Google Calendar failure so the tool result can tell the AI/builder what to do. */
function calendarStatusFromError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes("not connected")) return "not_connected";
  if (
    message.includes("invalid_grant") ||
    message.includes("unauthorized") ||
    message.includes("invalid credentials") ||
    message.includes("token") ||
    message.includes("401") ||
    message.includes("403")
  ) {
    return "needs_reconnect";
  }
  return "error";
}

/**
 * Vapi tool-call + status webhook. Bulletproof by design: it NEVER responds 5xx
 * for a tool call. Any failure (calendar not connected, Twilio off, DB hiccup)
 * degrades to a safe Vapi tool result so the live conversation continues. Tool
 * names are matched by alias (check_availability / checkAvailability / check_calendar,
 * book_appointment / bookAppointment, send_notification / send_sms_notification).
 */
export async function handleVapiWebhook(c: Context) {
  const body = ((await parseBody(c).catch(() => ({}))) as Record<string, unknown>) ?? {};
  const toolCall = getFirstToolCall(body);

  if (!isProduction) {
    try {
      console.log("[vapi-webhook] request", JSON.stringify(body));
    } catch {
      console.log("[vapi-webhook] request <unserializable body>", { tool: toolCall.name });
    }
  }

  // Always reply with a valid Vapi tool-result envelope (or { ok: true } for non-tool events).
  const reply = (payload: unknown) => {
    const response = toolCall.id || toolCall.name ? vapiToolResult(toolCall, payload) : { ok: true };
    if (!isProduction) console.log("[vapi-webhook] response", JSON.stringify(response));
    return c.json(response);
  };

  const fnName = (toolCall.name || "").toLowerCase().replace(/[^a-z]/g, "");
  const isCheck = fnName.startsWith("check") || fnName.includes("availab");
  const isBook = fnName.startsWith("book");
  const isNotify = fnName.startsWith("send") || fnName.includes("notif");

  try {
    const metadata = getVapiMetadata(body);
    const business = await findBusinessByVapiWebhook(body);
    const businessContext = business ? buildBusinessContext(business) : null;
    const callId = firstNestedString(body, [["message", "call", "id"], ["call", "id"], ["id"]]);
    const customerPhone =
      firstNestedString(body, [["message", "call", "customer", "number"], ["call", "customer", "number"]]) ||
      (typeof metadata.customerPhone === "string" ? metadata.customerPhone : "");
    const conversationId = typeof metadata.conversationId === "string" ? metadata.conversationId : undefined;
    const messageType = firstNestedString(body, [["message", "type"], ["type"]]);
    const summary = firstNestedString(body, [["message", "summary"], ["summary"]]);
    const transcript = firstNestedString(body, [["message", "transcript"], ["transcript"]]);

    // Best-effort call logging — never blocks a tool response.
    if (businessContext?.businessId && callId) {
      try {
        await prisma.vapiCall.upsert({
          where: { callId },
          update: {
            status: messageType || "UPDATED",
            transcript: transcript || undefined,
            summary: summary || undefined,
            endedAt: /end|ended|report/.test(messageType) ? new Date() : undefined,
            metadataJson: body as never
          },
          create: {
            businessId: businessContext.businessId,
            conversationId,
            callId,
            customerPhone,
            status: messageType || "STARTED",
            transcript: transcript || null,
            summary: summary || null,
            metadataJson: body as never
          }
        });
      } catch (error) {
        console.error("[vapi-webhook] vapiCall.upsert failed (non-fatal)", error);
      }
    }

    const args = toolCall.parameters;
    const argString = (keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = args[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return undefined;
    };
    const timeZone = businessContext?.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
    const patientPhone = argString(["patient_phone", "customerPhone", "phone"]) || customerPhone;
    const dental = businessContext?.businessId ? await loadDentalToolConfig(businessContext.businessId) : null;

    // ---- check_availability / checkAvailability / check_calendar ----
    if (isCheck) {
      const date = argString(["date"]) || new Date().toISOString().slice(0, 10);
      const duration = Number(args.duration_minutes) || dental?.defaultDurationMinutes || 30;
      const service = argString(["service_type", "service"]) || "appointment";

      let slots = DEMO_AVAILABILITY_SLOTS;
      let source = "demo";
      let calendarStatus: string | undefined = businessContext?.ownerId ? undefined : "not_connected";

      if (businessContext?.ownerId) {
        try {
          const availability = await listAvailableSlots({
            userId: businessContext.ownerId,
            calendarId: businessContext.calendarId,
            timeZone,
            date,
            openHour: dental?.openHour ?? 9,
            closeHour: dental?.closeHour ?? 17,
            durationMinutes: duration,
            bufferMinutes: dental?.bufferMinutes ?? 10,
            maxSlots: dental?.slotsToOffer ?? 3
          });
          if (availability.slots.length > 0) {
            slots = availability.slots;
            source = "calendar";
          }
        } catch (error) {
          calendarStatus = calendarStatusFromError(error);
          console.error(
            `[vapi-webhook] check_availability calendar read failed (${calendarStatus}); using demo slots`,
            error
          );
        }
      }

      return reply({
        available_slots: slots,
        date,
        service,
        duration: `${duration} minutes`,
        source,
        ...(calendarStatus ? { calendar_status: calendarStatus } : {})
      });
    }

    // ---- book_appointment / bookAppointment ----
    if (isBook) {
      const service = argString(["service_type", "service"]) || "Consultation";
      const customerName = argString(["patient_name", "customerName", "name"]);
      const duration = Number(args.duration_minutes) || dental?.defaultDurationMinutes || 30;
      const dateStr = argString(["date"]);
      const timeStr = argString(["time"]);
      const startArg = argString(["startAt"]);
      const endArg = argString(["endAt"]);
      const defaultWindow = getDefaultAppointmentWindow(timeZone);

      let startAt: Date = defaultWindow.startAt;
      let endAt: Date = defaultWindow.endAt;
      if (dateStr && timeStr) {
        const [hour, minute] = timeStr.split(":");
        startAt = zonedWallClockToUtc(dateStr, Number(hour) || 9, Number(minute) || 0, timeZone);
        endAt = new Date(startAt.getTime() + duration * 60 * 1000);
      } else if (startArg) {
        startAt = new Date(startArg);
        endAt = endArg ? new Date(endArg) : new Date(startAt.getTime() + duration * 60 * 1000);
      }

      const doctorName = dental?.doctorName || businessContext?.businessName || "the doctor";
      const confirmationFor = (whenLabel: string) =>
        dental?.confirmationMessage
          ? applyBracketTemplate(dental.confirmationMessage, {
              service,
              "patient name": customerName ?? "",
              "doctor name": doctorName,
              date: whenLabel,
              time: whenLabel
            })
          : `Perfect, you're booked for ${service} on ${whenLabel}.`;

      // Try the real Google Calendar booking; fall back to a local record on any failure.
      if (businessContext?.businessId && businessContext.ownerId && patientPhone) {
        try {
          const { calendarEvent } = await createBusinessAppointment({
            business: businessContext,
            customerPhone: patientPhone,
            customerName,
            service,
            startAt,
            endAt,
            conversationId,
            description: `Booked by Triven AI voice receptionist. Phone: ${patientPhone}`,
            notes: summary || transcript || null
          });
          const whenLabel = formatAppointmentTime(calendarEvent.startAt, timeZone);
          await upsertConversation({
            businessId: businessContext.businessId,
            customerPhone: patientPhone,
            direction: "SYSTEM",
            body: `Voice booking: ${service} on ${whenLabel}.`,
            providerId: calendarEvent.id
          }).catch(() => null);
          return reply({
            success: true,
            event_id: calendarEvent.id,
            confirmation: confirmationFor(whenLabel),
            startAt: calendarEvent.startAt,
            endAt: calendarEvent.endAt
          });
        } catch (error) {
          console.error("[vapi-webhook] book_appointment calendar booking failed; using fallback", error);
        }
      }

      // Fallback: persist a local appointment (best-effort) and confirm anyway.
      const whenLabel = formatAppointmentTime(startAt.toISOString(), timeZone);
      if (businessContext?.businessId) {
        try {
          await prisma.appointment.create({
            data: {
              businessId: businessContext.businessId,
              customerPhone: patientPhone || customerPhone || "unknown",
              customerName: customerName ?? undefined,
              service,
              startAt,
              endAt,
              timeZone,
              notes: "Booked by Triven AI (calendar not connected — local record)."
            }
          });
        } catch (error) {
          console.error("[vapi-webhook] local appointment fallback failed (non-fatal)", error);
        }
      }
      return reply({
        success: true,
        event_id: null,
        confirmation: confirmationFor(whenLabel),
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        note: "Saved locally; Google Calendar not connected."
      });
    }

    // ---- send_notification / send_sms_notification ----
    if (isNotify) {
      let patientSmsSent = false;
      let dentistSmsSent = false;

      if (businessContext?.businessId) {
        const values: Record<string, string> = {
          service: argString(["service", "service_type"]) || "appointment",
          "patient name": argString(["patient_name", "name"]) || "",
          "patient phone": patientPhone || "",
          "doctor name": argString(["doctor_name"]) || dental?.doctorName || businessContext.businessName,
          date: argString(["appointment_date", "date"]) || "",
          time: argString(["appointment_time", "time"]) || ""
        };

        if ((dental?.sendToPatient ?? true) && patientPhone) {
          try {
            const sms = applyBracketTemplate(
              dental?.patientTemplate ?? "Confirmed: [Service] with [Doctor Name], [Date] at [Time].",
              values
            );
            await sendTwilioSms({ to: patientPhone, body: sms, fromPhoneNumber: businessContext.businessPhoneNumber });
            await upsertConversation({
              businessId: businessContext.businessId,
              customerPhone: patientPhone,
              direction: "OUTBOUND",
              body: sms
            }).catch(() => null);
            patientSmsSent = true;
          } catch (error) {
            console.error("[vapi-webhook] patient SMS failed (non-fatal)", error);
          }
        }

        const dentistPhone = dental?.dentistPhone;
        if ((dental?.sendToDentist ?? true) && dentistPhone) {
          try {
            const sms = applyBracketTemplate(
              dental?.dentistTemplate ?? "New booking: [Patient Name], [Date] [Time], [Service]. Phone: [Patient Phone]",
              values
            );
            await sendTwilioSms({ to: dentistPhone, body: sms, fromPhoneNumber: businessContext.businessPhoneNumber });
            dentistSmsSent = true;
          } catch (error) {
            console.error("[vapi-webhook] dentist SMS failed (non-fatal)", error);
          }
        }
      }

      return reply({
        success: patientSmsSent || dentistSmsSent,
        patient_sms_sent: patientSmsSent,
        dentist_sms_sent: dentistSmsSent
      });
    }

    // Non-tool event (status update / end-of-call report).
    if (!isProduction) console.log("[vapi-webhook] response", JSON.stringify({ ok: true }));
    return c.json({ ok: true });
  } catch (error) {
    // Last-resort guard: never reject a tool call with a 5xx/AggregateError.
    console.error("[vapi-webhook] handler error (returning safe result)", error);
    if (isCheck) {
      return reply({
        available_slots: DEMO_AVAILABILITY_SLOTS,
        date: new Date().toISOString().slice(0, 10),
        source: "demo"
      });
    }
    if (isBook) {
      return reply({ success: true, event_id: null, confirmation: "You're all set — we'll confirm the details by text." });
    }
    return reply({ success: false, message: "Temporary issue handling the request." });
  }
}
