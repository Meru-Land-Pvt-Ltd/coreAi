import type { Context } from "hono";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest, type WorkflowRunInput } from "./workflow-runner";
import { escapeXml, sendTwilioSms } from "./twilio-connector";
import { startVapiOutboundCall } from "./vapi-connector";
import {
  createGoogleCalendarAppointment,
  getDefaultAppointmentWindow
} from "./google-calendar-connector";

type TwilioBody = Record<string, unknown>;

type BusinessRuntimeContext = {
  businessId?: string;
  ownerId?: string;
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

function buildBusinessContext(business: any, phoneNumber?: string | null): BusinessRuntimeContext {
  const profile = business?.profile;
  const knowledgeBases = Array.isArray(business?.knowledgeBases) ? business.knowledgeBases : [];

  return {
    businessId: business?.id,
    ownerId: business?.ownerId,
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
        business: buildBusinessContext(phoneNumber.business, phoneNumber.phoneNumber)
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

function buildInboundSmsReply(agent: ResolvedAgent, incomingBody: string) {
  const business = agent.business;
  const businessName = business?.businessName ?? "the business";
  const businessType = business?.businessType ?? "business";
  const bookingUrl = business?.bookingUrl;
  const teamPhone = business?.teamPhone;
  const services = business?.services ?? [];
  const knowledge = [...(business?.faqs ?? []), ...(business?.knowledge ?? [])];
  const normalizedMessage = incomingBody.toLowerCase();

  if (/book|appointment|schedule|yes|visit|slot|available/.test(normalizedMessage)) {
    if (bookingUrl) {
      return `Absolutely — you can book with ${businessName} here: ${bookingUrl}. If you prefer, reply with your preferred time and our team will help.`;
    }

    if (teamPhone) {
      return `Absolutely — ${businessName} can help schedule that. Our team can call you from ${teamPhone}. What day and time works best?`;
    }
  }

  if (/price|cost|fee|charge|rate|quote|estimate|how much/.test(normalizedMessage)) {
    const hint = knowledge.find((item) => /price|cost|fee|charge|rate|quote|estimate|cleaning|install|repair/i.test(item));
    if (hint) return hint;
  }

  const matchingService = services.find((service) => normalizedMessage.includes(service.toLowerCase().split(" ")[0] ?? ""));
  if (matchingService) {
    return `${businessName} can help with ${matchingService}. ${bookingUrl ? `You can book here: ${bookingUrl}` : "Can you share a few details so our team can help?"}`;
  }

  const firstKnowledge = knowledge[0];
  if (firstKnowledge) {
    return `${businessName} is a ${businessType}. ${firstKnowledge} ${bookingUrl ? `You can also book here: ${bookingUrl}` : "How can we help you next?"}`;
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

  if (sentSms?.body) {
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

  await upsertLead({
    businessId: agent.business?.businessId,
    phoneNumber: callerNumber,
    source: "TWILIO_MISSED_CALL",
    status: "CAPTURED",
    notes: reason,
    name: callerName
  });

  return run;
}

export async function handleTwilioVoice(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseBody(c);
  const calledNumber = readBodyString(body, ["Called", "To", "to"]);
  const agent = await resolveAgent({ calledNumber, workflowId });

  if (!agent) {
    return c.text("<Response><Reject /></Response>", 404, {
      "Content-Type": "text/xml"
    });
  }

  const forwardToPhone = agent.forwardToPhone ?? env.TWILIO_FORWARD_TO_PHONE;

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
  const businessNumber = readBodyString(body, ["To", "to"]);
  const customerPhone = readBodyString(body, ["From", "from"]);
  const incomingBody = readBodyString(body, ["Body", "body"]);
  const agent = await resolveAgent({ calledNumber: businessNumber, workflowId });

  if (!agent || !customerPhone || !incomingBody) {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  await upsertConversation({
    businessId: agent.business?.businessId,
    customerPhone,
    direction: "INBOUND",
    body: incomingBody,
    providerId: readBodyString(body, ["MessageSid", "SmsSid"])
  });

  const replyBody = buildInboundSmsReply(agent, incomingBody);
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
    providerId: sent.id
  });

  await upsertLead({
    businessId: agent.business?.businessId,
    phoneNumber: customerPhone,
    source: "TWILIO_SMS",
    status: "ENGAGED",
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

export async function handleVapiWebhook(c: Context) {
  const body = await parseBody(c);
  const metadata = getVapiMetadata(body);
  const business = await findBusinessByVapiWebhook(body);
  const businessContext = business ? buildBusinessContext(business) : null;
  const callId = firstNestedString(body, [
    ["message", "call", "id"],
    ["call", "id"],
    ["id"]
  ]);
  const customerPhone =
    firstNestedString(body, [["message", "call", "customer", "number"], ["call", "customer", "number"]]) ||
    (typeof metadata.customerPhone === "string" ? metadata.customerPhone : "");
  const conversationId = typeof metadata.conversationId === "string" ? metadata.conversationId : undefined;
  const messageType = firstNestedString(body, [["message", "type"], ["type"]]);
  const summary = firstNestedString(body, [["message", "summary"], ["summary"]]);
  const transcript = firstNestedString(body, [["message", "transcript"], ["transcript"]]);

  if (businessContext?.businessId && callId) {
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
  }

  const toolCall = getFirstToolCall(body);
  const toolName = toolCall.name;
  const args = toolCall.parameters;

  if (toolName === "book_appointment" && businessContext?.businessId && businessContext.ownerId && customerPhone) {
    const requestedStart = typeof args.startAt === "string" ? args.startAt : undefined;
    const requestedEnd = typeof args.endAt === "string" ? args.endAt : undefined;
    const defaultWindow = getDefaultAppointmentWindow(businessContext.timeZone);
    const service = typeof args.service === "string" ? args.service : "Consultation";
    const customerName = typeof args.customerName === "string" ? args.customerName : undefined;

    const calendarEvent = await createGoogleCalendarAppointment({
      userId: businessContext.ownerId,
      calendarId: businessContext.calendarId,
      timeZone: businessContext.timeZone,
      businessName: businessContext.businessName,
      customerName,
      customerPhone,
      service,
      startAt: requestedStart ?? defaultWindow.startAt,
      endAt: requestedEnd ?? defaultWindow.endAt,
      description: `Booked by Vapi AI Receptionist after missed-call follow-up. Phone: ${customerPhone}`
    });

    await prisma.appointment.create({
      data: {
        businessId: businessContext.businessId,
        conversationId,
        customerPhone,
        customerName,
        service,
        startAt: new Date(calendarEvent.startAt),
        endAt: new Date(calendarEvent.endAt),
        timeZone: calendarEvent.timeZone,
        calendarEventId: calendarEvent.id,
        notes: summary || transcript || null
      }
    });

    const smsBody = `Booked with ${businessContext.businessName}: ${service} at ${new Date(calendarEvent.startAt).toLocaleString()}. Reply if you need to change it.`;
    await sendTwilioSms({
      to: customerPhone,
      body: smsBody,
      fromPhoneNumber: businessContext.businessPhoneNumber
    });

    await upsertConversation({
      businessId: businessContext.businessId,
      customerPhone,
      direction: "OUTBOUND",
      body: smsBody,
      providerId: calendarEvent.id
    });

    return c.json({
      results: [
        {
          name: toolName,
          toolCallId: toolCall.id,
          result: JSON.stringify({
            status: "booked",
            calendarEventId: calendarEvent.id,
            startAt: calendarEvent.startAt,
            endAt: calendarEvent.endAt,
            message: `Appointment booked with ${businessContext.businessName}.`
          })
        }
      ]
    });
  }

  return c.json({ ok: true });
}
