import type { Context } from "hono";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest } from "./workflow-runner";
import { escapeXml, sendTwilioSms } from "./twilio-connector";

type TwilioBody = Record<string, unknown>;

type BusinessRuntimeContext = {
  businessId?: string;
  businessName: string;
  businessType?: string;
  bookingUrl?: string;
  teamPhone?: string;
  twilioFromNumber?: string;
  twilioMessagingServiceSid?: string;
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

async function parseTwilioBody(c: Context): Promise<TwilioBody> {
  const contentType = c.req.header("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await c.req.json().catch(() => ({}))) as TwilioBody;
  }

  return (await c.req.parseBody()) as TwilioBody;
}

function readBodyString(body: TwilioBody, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function readQueryString(c: Context, keys: string[]) {
  for (const key of keys) {
    const value = c.req.query(key);
    if (value?.trim()) return value.trim();
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

function buildBusinessContext({
  business,
  phoneNumber,
  configJson
}: {
  business: any;
  phoneNumber?: any;
  configJson?: unknown;
}): BusinessRuntimeContext {
  const profile = business?.profile;
  const knowledgeBases = Array.isArray(business?.knowledgeBases) ? business.knowledgeBases : [];
  const config = typeof configJson === "object" && configJson !== null ? (configJson as Record<string, unknown>) : {};
  const twilioMessagingServiceSid = typeof config.twilioMessagingServiceSid === "string" ? config.twilioMessagingServiceSid : undefined;

  return {
    businessId: business?.id,
    businessName: business?.name ?? env.TWILIO_DEFAULT_BUSINESS_NAME ?? "the business",
    businessType: business?.type ?? undefined,
    bookingUrl: profile?.bookingUrl ?? env.TWILIO_DEFAULT_BOOKING_URL ?? undefined,
    teamPhone: profile?.teamPhone ?? env.TWILIO_DEFAULT_TEAM_PHONE ?? undefined,
    twilioFromNumber: phoneNumber?.phoneNumber ?? env.TWILIO_PHONE_NUMBER ?? undefined,
    twilioMessagingServiceSid,
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
    const phoneNumber = await prisma.businessPhoneNumber.findFirst({
      where: {
        phoneNumber: normalizedCalledNumber,
        isActive: true
      },
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
        business: buildBusinessContext({
          business: phoneNumber.business,
          phoneNumber,
          configJson: phoneNumber.installedAgent.configJson
        })
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
          bookingUrl: env.TWILIO_DEFAULT_BOOKING_URL,
          teamPhone: env.TWILIO_DEFAULT_TEAM_PHONE,
          twilioFromNumber: normalizedCalledNumber || env.TWILIO_PHONE_NUMBER,
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
}) {
  const business = agent.business;

  return {
    callerNumber,
    callerName,
    businessId: business?.businessId,
    businessName: business?.businessName,
    businessType: business?.businessType,
    bookingUrl: business?.bookingUrl,
    teamPhone: business?.teamPhone,
    twilioFromNumber: business?.twilioFromNumber,
    twilioMessagingServiceSid: business?.twilioMessagingServiceSid,
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
  direction: "INBOUND" | "OUTBOUND";
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
  conversationId,
  customerPhone,
  source,
  status,
  notes
}: {
  businessId?: string;
  conversationId?: string | null;
  customerPhone: string;
  source: string;
  status: string;
  notes?: string;
}) {
  if (!businessId) return;

  await prisma.lead.upsert({
    where: {
      businessId_phoneNumber: {
        businessId,
        phoneNumber: customerPhone
      }
    },
    update: {
      conversationId: conversationId ?? undefined,
      status,
      notes: notes ?? undefined
    },
    create: {
      businessId,
      conversationId: conversationId ?? null,
      phoneNumber: customerPhone,
      source,
      status,
      notes: notes ?? null
    }
  });
}

function getRunRecord(context: Record<string, unknown>, key: string) {
  const value = context[key];
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function getRunText(context: Record<string, unknown>, key: string) {
  const value = context[key];
  return typeof value === "string" ? value : "";
}

async function recordWorkflowRunResult({
  agent,
  customerPhone,
  runContext,
  source,
  notes
}: {
  agent: ResolvedAgent;
  customerPhone: string;
  runContext: Record<string, unknown>;
  source: string;
  notes: string;
}) {
  const sentSms = getRunRecord(runContext, "sentSms");
  const smsBody = sentSms ? getRunText(sentSms, "body") : "";
  const smsId = sentSms ? getRunText(sentSms, "id") : null;
  const conversation = smsBody
    ? await upsertConversation({
        businessId: agent.business?.businessId,
        customerPhone,
        direction: "OUTBOUND",
        body: smsBody,
        providerId: smsId
      })
    : null;

  await upsertLead({
    businessId: agent.business?.businessId,
    conversationId: conversation?.id ?? null,
    customerPhone,
    source,
    status: "CAPTURED",
    notes
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

export async function handleTwilioVoice(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseTwilioBody(c);
  const calledNumber = readBodyString(body, ["Called", "To", "to"]) || readQueryString(c, ["calledNumber", "to"]);
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

  const actionPath = workflowId
    ? `/architect/connectors/twilio/voice-action/${agent.workflowId}`
    : "/architect/connectors/twilio/voice-action";
  const actionUrl = `${env.BACKEND_URL}${actionPath}?calledNumber=${encodeURIComponent(calledNumber)}`;
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
  const body = await parseTwilioBody(c);
  const calledNumber = readBodyString(body, ["Called", "To", "to"]) || readQueryString(c, ["calledNumber", "to"]);
  const callerNumber = readBodyString(body, ["From", "Caller", "from"]);
  const dialStatus = readBodyString(body, ["DialCallStatus", "DialStatus", "CallStatus"]);
  const agent = await resolveAgent({ calledNumber, workflowId });

  if (!agent || !callerNumber) {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  if (dialStatus === "completed") {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  const run = await runWorkflowTest({
    userId: agent.userId,
    workflowId: agent.workflowId,
    workflowJson: agent.workflowJson,
    mode: "live",
    input: runInputFromContext({
      agent,
      callerNumber,
      reason: `Twilio forwarded the call but office did not answer. Dial status: ${dialStatus || "unknown"}.`
    })
  });

  await recordWorkflowRunResult({
    agent,
    customerPhone: callerNumber,
    runContext: run.context as Record<string, unknown>,
    source: "TWILIO_MISSED_CALL",
    notes: `Missed call after dial status: ${dialStatus || "unknown"}`
  });

  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
}

export async function handleTwilioMissedCall(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseTwilioBody(c);
  const calledNumber = readBodyString(body, ["Called", "To", "to"]) || readQueryString(c, ["calledNumber", "to"]);
  const callerNumber = readBodyString(body, ["From", "Caller", "from"]);
  const callerName = readBodyString(body, ["CallerName", "callerName"]);
  const agent = await resolveAgent({ calledNumber, workflowId });

  if (!agent || !callerNumber) {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  const run = await runWorkflowTest({
    userId: agent.userId,
    workflowId: agent.workflowId,
    workflowJson: agent.workflowJson,
    mode: "live",
    input: runInputFromContext({
      agent,
      callerNumber,
      callerName,
      reason: "Direct Twilio missed-call webhook triggered this agent."
    })
  });

  await recordWorkflowRunResult({
    agent,
    customerPhone: callerNumber,
    runContext: run.context as Record<string, unknown>,
    source: "TWILIO_MISSED_CALL",
    notes: "Direct missed-call webhook"
  });

  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
}

export async function handleTwilioInboundSms(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseTwilioBody(c);
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

  const replyBody = buildInboundSmsReply(agent, incomingBody);
  const sent = await sendTwilioSms({
    to: customerPhone,
    body: replyBody,
    from: agent.business?.twilioFromNumber || businessNumber,
    messagingServiceSid: agent.business?.twilioMessagingServiceSid
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
    conversationId: conversation?.id ?? null,
    customerPhone,
    source: "TWILIO_SMS",
    status: "ENGAGED",
    notes: incomingBody
  });

  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
}
