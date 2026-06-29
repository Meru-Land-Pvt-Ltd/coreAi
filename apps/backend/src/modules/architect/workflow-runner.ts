import { CORE_CONNECTOR_ACTIONS, MAX_WORKFLOW_CHAIN_DEPTH, VOICE_NODE_TYPES } from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { sendTwilioSms } from "./twilio-connector";
import {
  createGmailDraft,
  readGmailEmail,
  sendGmailEmail
} from "./gmail-connector";
import {
  createGoogleCalendarAppointment,
  getDefaultAppointmentWindow,
  listAvailableSlots
} from "./google-calendar-connector";
import { startVapiOutboundCall } from "./vapi-connector";

/** Threaded through the runner to bound workflow-to-workflow chaining. */
type WorkflowChain = {
  depth: number;
  visited: string[];
  workflowId: string;
};

export type WorkflowRunLog = {
  nodeId: string;
  label: string;
  status: "success" | "waiting" | "error";
  message: string;
  output?: unknown;
};

type WorkflowRunMode = "test" | "live";

export type WorkflowRunInput = {
  callerNumber?: string;
  callerName?: string;
  businessId?: string;
  businessOwnerId?: string;
  businessName?: string;
  businessType?: string;
  businessPhoneNumber?: string;
  calendarId?: string;
  timeZone?: string;
  vapiAssistantId?: string;
  vapiPhoneNumberId?: string;
  callStatus?: string;
  callTimestamp?: string;
  missedCallReason?: string;
  bookingUrl?: string;
  teamPhone?: string;
  services?: string[];
  faqs?: string[];
  tone?: string;
  escalationRules?: string;
  knowledge?: string[];
  inboundSmsBody?: string;
  appointmentStartAt?: string;
  appointmentEndAt?: string;
  appointmentService?: string;
  businessHours?: unknown;
  conversationId?: string;
  leadId?: string;
  installedAgentId?: string;
  listingId?: string;
  latestMessage?: string;
};

type RunnerNodeData = {
  label?: unknown;
  title?: unknown;
  nodeKind?: unknown;
  kind?: unknown;
  description?: unknown;
  prompt?: unknown;
  connector?: unknown;
  connectorAction?: unknown;
  gmailQuery?: unknown;
  gmailTo?: unknown;
  gmailSubject?: unknown;
  gmailBody?: unknown;
  smsTo?: unknown;
  smsBody?: unknown;
  sendAt?: unknown;
  vapiAssistantId?: unknown;
  vapiPhoneNumberId?: unknown;
  calendarId?: unknown;
  calendarSummary?: unknown;
  calendarDescription?: unknown;
  appointmentStartAt?: unknown;
  appointmentEndAt?: unknown;
  appointmentService?: unknown;
  condition?: unknown;
  outputKey?: unknown;
  leadSource?: unknown;
  leadStatus?: unknown;
  conversationDirection?: unknown;
  conversationBody?: unknown;
  handoffReason?: unknown;
  nextWorkflowId?: unknown;
  // Generic node capability + voice-booking node fields (read in Test/Dry Run).
  type?: unknown;
  callHandlingMode?: unknown;
  firstMessage?: unknown;
  practiceName?: unknown;
  doctorName?: unknown;
  voice?: unknown;
  model?: unknown;
  language?: unknown;
  date?: unknown;
  slotsToOffer?: unknown;
  bufferMinutes?: unknown;
  sendToPatient?: unknown;
  sendToDentist?: unknown;
  dentistPhone?: unknown;
  patientTemplate?: unknown;
  dentistTemplate?: unknown;
};

type RunnerNode = {
  id: string;
  position?: {
    x?: number;
    y?: number;
  };
  data?: RunnerNodeData;
};

type RunnerEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
};

type RunnerContext = {
  caller_number?: string;
  caller_name?: string;
  business?: {
    id?: string;
    ownerId?: string;
    name: string;
    type?: string;
    phoneNumber?: string;
    bookingUrl?: string;
    teamPhone?: string;
    services?: string[];
    faqs?: string[];
    tone?: string;
    escalationRules?: string;
    knowledge?: string[];
    calendarId?: string;
    timeZone?: string;
    vapiAssistantId?: string;
    vapiPhoneNumberId?: string;
    hours?: unknown;
  };
  inboundSms?: {
    body: string;
  };
  missedCall?: {
    callerNumber: string;
    callerName?: string;
    businessName: string;
    status: string;
    timestamp: string;
    reason: string;
  };
  gmail?: {
    emails?: {
      id: string;
      from: string;
      senderEmail: string;
      subject: string;
      body: string;
    }[];
    senderEmail?: string;
    subject?: string;
    body?: string;
  };
  ai?: {
    output?: string;
  };
  condition?: {
    passed: boolean;
    label: string;
  };
  sentEmail?: {
    id: string | null;
    to: string;
    subject: string;
    body: string;
  };
  draftEmail?: {
    id: string | null;
    to: string;
    subject: string;
    body: string;
  };
  sentSms?: {
    id: string | null;
    to: string;
    body: string;
    mode: WorkflowRunMode;
    providerCalled: boolean;
    twilioTestMode: boolean;
  };
  queuedSms?: {
    to: string;
    body: string;
    sendAt: string;
    mode: WorkflowRunMode;
  };
  vapiCall?: {
    id: string | null;
    status: string | null;
    customerPhone: string;
    providerCalled: boolean;
  };
  calendarAppointment?: {
    id: string | null;
    calendarId: string;
    summary: string;
    startAt: string;
    endAt: string;
    timeZone: string;
  };
  capturedLead?: {
    callerNumber: string;
    callerName?: string;
    businessName: string;
    status: string;
    capturedAt: string;
  };
  conversationId?: string;
  leadId?: string;
  installedAgentId?: string;
  listingId?: string;
  latestMessage?: string;
  leadSaved?: boolean;
  conversationSaved?: boolean;
  handoff?: {
    reason: string;
    teamPhone?: string;
  };
  nextWorkflow?: {
    workflowId: string;
    name: string;
    ran: boolean;
  };
  output?: unknown;
  [key: string]: unknown;
};

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function isRunnerNode(value: unknown): value is RunnerNode {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as Partial<RunnerNode>).id === "string";
}

function isRunnerEdge(value: unknown): value is RunnerEdge {
  if (typeof value !== "object" || value === null) return false;

  const edge = value as Partial<RunnerEdge>;

  return (
    typeof edge.id === "string" &&
    typeof edge.source === "string" &&
    typeof edge.target === "string"
  );
}

export function parseRunnerWorkflowJson(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return {
      nodes: [] as RunnerNode[],
      edges: [] as RunnerEdge[]
    };
  }

  const workflowJson = value as {
    nodes?: unknown;
    edges?: unknown;
  };

  return {
    nodes: Array.isArray(workflowJson.nodes)
      ? workflowJson.nodes.filter(isRunnerNode)
      : [],
    edges: Array.isArray(workflowJson.edges)
      ? workflowJson.edges.filter(isRunnerEdge)
      : []
  };
}

function sortNodesForRun(nodes: RunnerNode[]) {
  return [...nodes].sort((a, b) => {
    const ax = typeof a.position?.x === "number" ? a.position.x : 0;
    const bx = typeof b.position?.x === "number" ? b.position.x : 0;

    if (ax !== bx) return ax - bx;

    const ay = typeof a.position?.y === "number" ? a.position.y : 0;
    const by = typeof b.position?.y === "number" ? b.position.y : 0;

    return ay - by;
  });
}

function resolveContextPath(context: RunnerContext, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, context);
}

function renderTemplate(input: unknown, context: RunnerContext) {
  const template = asString(input);

  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const value = resolveContextPath(context, path);

    if (value === undefined || value === null) return "";

    return String(value);
  });
}

function createLog(
  node: RunnerNode,
  status: WorkflowRunLog["status"],
  message: string,
  output?: unknown
): WorkflowRunLog {
  return {
    nodeId: node.id,
    label: asString(node.data?.label ?? node.data?.title, node.id),
    status,
    message,
    output
  };
}

function seedMissedCallContext(input?: WorkflowRunInput): RunnerContext {
  const callerNumber = optionalString(input?.callerNumber);
  const callerName = optionalString(input?.callerName);
  const businessName =
    optionalString(input?.businessName) ??
    optionalString(env.TWILIO_DEFAULT_BUSINESS_NAME) ??
    "the business";
  const timestamp = optionalString(input?.callTimestamp) ?? new Date().toISOString();
  const status = optionalString(input?.callStatus) ?? "no-answer";
  const reason = optionalString(input?.missedCallReason) ?? "No one picked up the customer call.";

  const context: RunnerContext = {
    business: {
      id: optionalString(input?.businessId),
      ownerId: optionalString(input?.businessOwnerId),
      name: businessName,
      type: optionalString(input?.businessType),
      phoneNumber: optionalString(input?.businessPhoneNumber),
      bookingUrl: optionalString(input?.bookingUrl) ?? optionalString(env.TWILIO_DEFAULT_BOOKING_URL),
      teamPhone: optionalString(input?.teamPhone) ?? optionalString(env.TWILIO_DEFAULT_TEAM_PHONE),
      services: input?.services ?? [],
      faqs: input?.faqs ?? [],
      tone: optionalString(input?.tone) ?? "friendly",
      escalationRules: optionalString(input?.escalationRules),
      knowledge: input?.knowledge ?? [],
      calendarId: optionalString(input?.calendarId) ?? env.GOOGLE_CALENDAR_ID ?? "primary",
      timeZone: optionalString(input?.timeZone) ?? env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
      vapiAssistantId: optionalString(input?.vapiAssistantId) ?? env.VAPI_DEFAULT_ASSISTANT_ID,
      vapiPhoneNumberId: optionalString(input?.vapiPhoneNumberId) ?? env.VAPI_DEFAULT_PHONE_NUMBER_ID,
      hours: input?.businessHours
    },
    missedCall: {
      callerNumber: callerNumber ?? "",
      callerName,
      businessName,
      status,
      timestamp,
      reason
    }
  };

  if (callerNumber) context.caller_number = callerNumber;
  if (callerName) context.caller_name = callerName;
  if (optionalString(input?.inboundSmsBody)) {
    context.inboundSms = { body: optionalString(input?.inboundSmsBody)! };
  }
  if (input?.appointmentStartAt) context.appointmentStartAt = input.appointmentStartAt;
  if (input?.appointmentEndAt) context.appointmentEndAt = input.appointmentEndAt;
  if (input?.appointmentService) context.appointmentService = input.appointmentService;
  if (optionalString(input?.conversationId)) context.conversationId = optionalString(input?.conversationId);
  if (optionalString(input?.leadId)) context.leadId = optionalString(input?.leadId);
  if (optionalString(input?.installedAgentId)) context.installedAgentId = optionalString(input?.installedAgentId);
  if (optionalString(input?.listingId)) context.listingId = optionalString(input?.listingId);
  if (optionalString(input?.latestMessage)) context.latestMessage = optionalString(input?.latestMessage);

  return context;
}

function runTriggerNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  // Voice booking: Phone Call Trigger simulates an inbound call (no missed-call wording).
  if (asString(node.data?.type) === VOICE_NODE_TYPES.phoneCallTrigger) {
    logs.push(
      createLog(node, "success", "Customer call simulated for the assigned Twilio number.", {
        businessName: context.business?.name,
        callerNumber: context.caller_number || context.missedCall?.callerNumber,
        callHandlingMode: asString(node.data?.callHandlingMode, "AI_ANSWERS")
      })
    );
    return;
  }

  const callerNumber = context.missedCall?.callerNumber;

  if (!callerNumber) {
    logs.push(
      createLog(node, "error", "Missing caller phone number. Use Twilio webhook From or enter a verified test recipient.")
    );
    return;
  }

  logs.push(
    createLog(node, "success", "Twilio missed-call event received.", {
      callerNumber,
      timestamp: context.missedCall?.timestamp,
      status: context.missedCall?.status,
      business: context.business
    })
  );
}

function runAiNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  // Voice booking: AI Voice Conversation previews the assistant config (not an SMS reply).
  if (asString(node.data?.type) === VOICE_NODE_TYPES.voiceConversation) {
    const voicePreview = {
      firstMessage: asString(node.data?.firstMessage, "Thanks for calling. How can I help you today?"),
      practiceName: asString(node.data?.practiceName),
      doctorName: asString(node.data?.doctorName),
      voice: asString(node.data?.voice, "sarah"),
      model: asString(node.data?.model, "gpt-4o"),
      language: asString(node.data?.language, "en-US")
    };
    context.voiceConversation = voicePreview;
    logs.push(
      createLog(
        node,
        "success",
        "Voice assistant prompt generated from AI Voice Conversation node config.",
        voicePreview
      )
    );
    return;
  }

  const prompt = asString(
    node.data?.prompt,
    "Write a friendly missed-call text-back message."
  );

  const business = context.business;
  const businessName = business?.name ?? "the business";
  const businessType = business?.type ? ` (${business.type})` : "";
  const callerName = context.caller_name ? `${context.caller_name}, ` : "";
  const services = business?.services?.length
    ? ` We can help with: ${business.services.slice(0, 5).join(", ")}.`
    : "";
  const booking = business?.bookingUrl
    ? ` You can book here: ${business.bookingUrl}`
    : "";
  const team = business?.teamPhone
    ? ` Or our team can call you from ${business.teamPhone}.`
    : "";

  let output: string;

  if (context.gmail?.subject || context.gmail?.body) {
    output = `Hi, thanks for reaching out to ${businessName}. We saw your message about "${context.gmail.subject ?? "your request"}". ${services}${booking || team ? `${booking}${team}` : "We will help you with the next step shortly."}`.trim();
  } else if (context.inboundSms?.body) {
    const message = context.inboundSms.body.toLowerCase();
    const wantsBooking = /book|appointment|schedule|yes|visit|call/.test(message);
    const asksPrice = /price|cost|fee|charge|rate|how much/.test(message);
    const faqHint = business?.faqs?.[0] ?? business?.knowledge?.[0] ?? "";

    if (wantsBooking && business?.bookingUrl) {
      output = `Absolutely — ${businessName}${businessType} can help. Please book here: ${business.bookingUrl}. ${team}`.trim();
    } else if (asksPrice && faqHint) {
      output = `${callerName}${faqHint} ${booking || team || "Reply with a preferred time and we will help you further."}`.trim();
    } else {
      output = `${callerName}thanks for texting ${businessName}. ${services}${faqHint ? ` ${faqHint}` : ""} ${booking || team || "How can we help you today?"}`.trim();
    }
  } else {
    output = `Hi ${callerName}this is ${businessName}. Sorry we missed your call. We can help by text or voice right now.${services} Would you like to book an appointment or ask a quick question?${booking ? ` ${booking}` : ""}`;
  }

  context.ai = {
    output
  };

  logs.push(
    createLog(node, "success", "Context-aware reply generated.", {
      prompt,
      business,
      inboundSms: context.inboundSms,
      output
    })
  );
}

function nowInZone(timeZone?: string) {
  const tz = timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  let hour = Number(map.hour);
  if (hour === 24) hour = 0;

  return {
    weekday: (map.weekday || "").toLowerCase(),
    minutes: hour * 60 + Number(map.minute)
  };
}

function parseHoursMinutes(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(typeof value === "string" ? value : "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Real business-hours evaluation: uses the business's configured weekly hours
 * (from setup) when available, otherwise falls back to Mon–Fri 8:00–18:00.
 */
function evaluateBusinessHours(context: RunnerContext): boolean {
  const { weekday, minutes } = nowInZone(context.business?.timeZone);
  const hours = Array.isArray(context.business?.hours)
    ? (context.business?.hours as Array<Record<string, unknown>>)
    : null;

  if (hours) {
    const today = hours.find(
      (entry) => typeof entry?.day === "string" && entry.day.toLowerCase() === weekday
    );
    if (today) {
      if (today.closed === true) return false;
      const open = parseHoursMinutes(today.open);
      const close = parseHoursMinutes(today.close);
      if (open !== null && close !== null) return minutes >= open && minutes < close;
    }
  }

  const isWeekday = weekday !== "saturday" && weekday !== "sunday";
  return isWeekday && minutes >= 8 * 60 && minutes < 18 * 60;
}

function runConditionNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  const condition = asString(node.data?.condition, "Business hours check");
  const isBusinessHours = evaluateBusinessHours(context);

  context.condition = {
    passed: isBusinessHours,
    label: condition
  };

  logs.push(
    createLog(
      node,
      "success",
      isBusinessHours
        ? `Condition passed: ${condition}`
        : `Condition failed: ${condition}`,
      context.condition
    )
  );
}

async function runSmsConnectorNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const action = asString(node.data?.connectorAction, "send_sms");

  // Voice booking: Send SMS notifies patient + dentist after booking.
  if (action === "send_notification") {
    const sendToPatient = asString(node.data?.sendToPatient, "true") !== "false";
    const sendToDentist = asString(node.data?.sendToDentist, "false") === "true";
    const dentistPhone = asString(node.data?.dentistPhone);
    const targets = [sendToPatient ? "patient" : null, sendToDentist && dentistPhone ? "dentist" : null].filter(Boolean);
    context.smsNotification = {
      sendToPatient,
      sendToDentist: sendToDentist && Boolean(dentistPhone),
      patientTemplate: asString(node.data?.patientTemplate),
      dentistTemplate: asString(node.data?.dentistTemplate),
      mode
    };
    if (mode === "live") {
      logs.push(
        createLog(node, "success", `SMS notification will be sent live to ${targets.join(" and ") || "no one"}.`, context.smsNotification)
      );
    } else {
      logs.push(
        createLog(
          node,
          "success",
          `Dry run passed. SMS would be sent to ${targets.join(" and ") || "no recipients"}.`,
          context.smsNotification
        )
      );
    }
    return;
  }

  if (action === "capture_lead") {
    if (!context.missedCall?.callerNumber) {
      logs.push(createLog(node, "error", "Lead capture failed because caller number is missing."));
      return;
    }

    context.capturedLead = {
      callerNumber: context.missedCall.callerNumber,
      callerName: context.missedCall.callerName,
      businessName: context.missedCall.businessName,
      status: "captured",
      capturedAt: new Date().toISOString()
    };

    logs.push(
      createLog(
        node,
        "success",
        "Lead captured. Conversation can continue by SMS, Vapi voice, booking, FAQ, or team routing.",
        context.capturedLead
      )
    );
    return;
  }

  const defaultBody = context.ai?.output ?? `Hi, this is ${context.business?.name ?? "the business"}. Sorry we missed your call. We can help by text right now.`;
  const actionTo = renderTemplate(node.data?.smsTo, context) || context.caller_number || "";
  const actionBody = renderTemplate(node.data?.smsBody, context) || defaultBody;
  const sendAt = renderTemplate(node.data?.sendAt, context) || "8:00 AM next business day";

  if (!actionTo || !actionBody) {
    logs.push(createLog(node, "error", "SMS failed because To or Message is empty."));
    return;
  }

  if (action === "queue_sms") {
    context.queuedSms = {
      to: actionTo,
      body: actionBody,
      sendAt,
      mode
    };

    logs.push(
      createLog(node, "waiting", `SMS queued for ${sendAt}.`, context.queuedSms)
    );
    return;
  }

  if (mode === "live") {
    const sentSms = await sendTwilioSms({
      to: actionTo,
      body: actionBody,
      fromPhoneNumber: context.business?.phoneNumber
    });

    context.sentSms = {
      ...sentSms,
      mode
    };

    logs.push(
      createLog(
        node,
        "success",
        sentSms.twilioTestMode
          ? "Twilio test credentials accepted the SMS request. No real SMS was delivered."
          : "Twilio SMS sent successfully.",
        context.sentSms
      )
    );
    return;
  }

  context.sentSms = {
    id: null,
    to: actionTo,
    body: actionBody,
    mode,
    providerCalled: false,
    twilioTestMode: false
  };

  logs.push(
    createLog(
      node,
      "success",
      "Dry run passed. No Twilio request was made.",
      context.sentSms
    )
  );
}

async function runVapiConnectorNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const action = asString(node.data?.connectorAction, "start_voice_call");
  const customerPhone = context.caller_number || context.missedCall?.callerNumber || "";

  if (!customerPhone) {
    logs.push(createLog(node, "error", "Vapi call failed because caller phone number is missing."));
    return;
  }

  const assistantId = renderTemplate(node.data?.vapiAssistantId, context) || context.business?.vapiAssistantId;
  const phoneNumberId = renderTemplate(node.data?.vapiPhoneNumberId, context) || context.business?.vapiPhoneNumberId;

  if (mode !== "live") {
    context.vapiCall = {
      id: null,
      status: "dry_run",
      customerPhone,
      providerCalled: false
    };
    logs.push(createLog(node, "success", "Dry run passed. No Vapi call was made.", context.vapiCall));
    return;
  }

  if (action !== "start_voice_call") {
    logs.push(createLog(node, "error", `Unsupported Vapi action: ${action}`));
    return;
  }

  const call = await startVapiOutboundCall({
    customerPhone,
    customerName: context.caller_name,
    business: {
      businessId: context.business?.id,
      businessName: context.business?.name ?? "the business",
      businessType: context.business?.type,
      bookingUrl: context.business?.bookingUrl,
      teamPhone: context.business?.teamPhone,
      services: context.business?.services,
      faqs: context.business?.faqs,
      knowledge: context.business?.knowledge,
      tone: context.business?.tone,
      escalationRules: context.business?.escalationRules,
      calendarId: context.business?.calendarId,
      timeZone: context.business?.timeZone
    },
    reason: context.missedCall?.reason ?? "Missed call follow-up",
    assistantId,
    phoneNumberId,
    metadata: {
      businessId: context.business?.id,
      businessOwnerId: context.business?.ownerId,
      installedAgentId: context.installedAgentId,
      listingId: context.listingId,
      conversationId: context.conversationId,
      leadId: context.leadId,
      workflowSource: "workflow_runner"
    }
  });

  context.vapiCall = {
    id: call.id,
    status: call.status,
    customerPhone: call.customerPhone,
    providerCalled: call.providerCalled
  };

  logs.push(createLog(node, "success", "Vapi AI voice call started.", context.vapiCall));
}

async function runGoogleCalendarConnectorNode({
  userId,
  node,
  context,
  logs,
  mode
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const action = asString(node.data?.connectorAction, "book_appointment");
  const normalizedAction = action.toLowerCase().replace(/[^a-z]/g, "");

  // Calendar Availability — supports check_availability / checkAvailability /
  // check_calendar / calendar.availability. Demo slots when not connected.
  if (normalizedAction.startsWith("check") || normalizedAction.includes("availab")) {
    const timeZoneAvail = context.business?.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
    const date = asString(node.data?.date) || new Date().toISOString().slice(0, 10);
    const slotsToOffer = Number(node.data?.slotsToOffer) || 3;
    const demoSlots = ["10:00 AM", "2:00 PM", "4:30 PM"].slice(0, slotsToOffer);

    const ownerId = context.business?.ownerId;
    if (mode !== "live" || !ownerId) {
      context.calendarAvailability = {
        date,
        slots: demoSlots,
        source: "demo",
        calendar_status: ownerId ? undefined : "not_connected"
      };
      logs.push(
        createLog(
          node,
          "success",
          `Calendar not connected. Demo slots returned: ${demoSlots.join(", ")}.`,
          context.calendarAvailability
        )
      );
      return;
    }

    try {
      const availability = await listAvailableSlots({
        userId: ownerId,
        calendarId: renderTemplate(node.data?.calendarId, context) || context.business?.calendarId,
        timeZone: timeZoneAvail,
        date,
        bufferMinutes: Number(node.data?.bufferMinutes) || 10,
        maxSlots: slotsToOffer
      });
      const slots = availability.slots.length ? availability.slots : demoSlots;
      context.calendarAvailability = {
        date,
        slots,
        source: availability.slots.length ? "calendar" : "demo"
      };
      logs.push(
        createLog(node, "success", `Calendar checked. Available slots: ${slots.join(", ")}.`, context.calendarAvailability)
      );
    } catch (error) {
      context.calendarAvailability = { date, slots: demoSlots, source: "demo", calendar_status: "needs_reconnect" };
      logs.push(
        createLog(
          node,
          "success",
          `Calendar not connected. Demo slots returned: ${demoSlots.join(", ")}.`,
          { date, slots: demoSlots, source: "demo", calendar_status: "needs_reconnect", error: error instanceof Error ? error.message : String(error) }
        )
      );
    }
    return;
  }

  if (action !== "book_appointment") {
    logs.push(createLog(node, "error", `Unsupported Google Calendar action: ${action}`));
    return;
  }

  const customerPhone = context.caller_number || context.missedCall?.callerNumber || "";
  const businessName = context.business?.name ?? "the business";
  const calendarId = renderTemplate(node.data?.calendarId, context) || context.business?.calendarId || "primary";
  const timeZone = context.business?.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  const service = renderTemplate(node.data?.appointmentService, context) || asString(context.appointmentService, "Consultation");
  context.appointmentService = service;
  const defaultWindow = getDefaultAppointmentWindow(timeZone);
  const startAtRaw = renderTemplate(node.data?.appointmentStartAt, context) || asString(context.appointmentStartAt, defaultWindow.startAt.toISOString());
  const endAtRaw = renderTemplate(node.data?.appointmentEndAt, context) || asString(context.appointmentEndAt, defaultWindow.endAt.toISOString());
  const summary = renderTemplate(node.data?.calendarSummary, context) || `${service} - ${context.caller_name || customerPhone}`;
  const description = renderTemplate(node.data?.calendarDescription, context) || `Booked by CORE AI Receptionist for ${businessName}.`;

  if (!customerPhone && mode === "live") {
    logs.push(createLog(node, "error", "Calendar booking failed because caller phone number is missing."));
    return;
  }

  if (mode !== "live") {
    context.calendarAppointment = {
      id: null,
      calendarId,
      summary,
      startAt: new Date(startAtRaw).toISOString(),
      endAt: new Date(endAtRaw).toISOString(),
      timeZone
    };
    logs.push(createLog(node, "success", "Dry run passed. Calendar event would be created.", context.calendarAppointment));
    return;
  }

  const appointment = await createGoogleCalendarAppointment({
    userId: context.business?.ownerId || userId,
    calendarId,
    timeZone,
    businessName,
    customerName: context.caller_name,
    customerPhone,
    service,
    startAt: startAtRaw,
    endAt: endAtRaw,
    description
  });

  context.calendarAppointment = appointment;
  logs.push(createLog(node, "success", "Google Calendar appointment created.", appointment));
}

async function runGmailConnectorNode({
  userId,
  node,
  context,
  logs
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
}) {
  const action = asString(node.data?.connectorAction, "read_emails");

  if (action === "read_emails") {
    const query = asString(node.data?.gmailQuery, "newer_than:7d");
    const email = await readGmailEmail({
      userId,
      query
    });

    if (!email) {
      logs.push(createLog(node, "error", `No Gmail emails found for query: ${query}`));
      return;
    }

    context.gmail = {
      emails: [email],
      senderEmail: email.senderEmail,
      subject: email.subject,
      body: email.body
    };

    logs.push(
      createLog(node, "success", `Read Gmail email using query: ${query}`, {
        email
      })
    );

    return;
  }

  if (action === "send_email") {
    const to = renderTemplate(node.data?.gmailTo, context);
    const subject = renderTemplate(node.data?.gmailSubject, context);
    const body = renderTemplate(node.data?.gmailBody, context);

    if (!to || !subject || !body) {
      logs.push(createLog(node, "error", "Gmail send failed because To, Subject, or Body is empty."));
      return;
    }

    const sentEmail = await sendGmailEmail({
      userId,
      to,
      subject,
      body
    });

    context.sentEmail = sentEmail;

    logs.push(createLog(node, "success", "Gmail email sent successfully.", sentEmail));
    return;
  }

  if (action === "draft_reply") {
    const to = renderTemplate(node.data?.gmailTo, context);
    const subject = renderTemplate(node.data?.gmailSubject, context);
    const body = renderTemplate(node.data?.gmailBody, context);

    if (!to || !subject || !body) {
      logs.push(createLog(node, "error", "Gmail draft failed because To, Subject, or Body is empty."));
      return;
    }

    const draftEmail = await createGmailDraft({
      userId,
      to,
      subject,
      body
    });

    context.draftEmail = draftEmail;

    logs.push(createLog(node, "success", "Gmail draft created successfully.", draftEmail));
    return;
  }

  logs.push(createLog(node, "error", `Unsupported Gmail action: ${action}`));
}

function customerPhoneFromContext(context: RunnerContext) {
  return context.caller_number || context.missedCall?.callerNumber || "";
}

async function runSaveLeadNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const businessId = context.business?.id;
  const phoneNumber = customerPhoneFromContext(context);

  if (!businessId || !phoneNumber) {
    logs.push(createLog(node, "error", "Save Lead failed because business or caller phone is missing."));
    return;
  }

  const status = asString(node.data?.leadStatus, "CAPTURED");
  const source = asString(node.data?.leadSource, "WORKFLOW");
  const name = context.caller_name;

  if (mode === "live") {
    const lead = await prisma.lead.upsert({
      where: { businessId_phoneNumber: { businessId, phoneNumber } },
      update: { status, name: name || undefined },
      create: { businessId, phoneNumber, source, status, name }
    });
    context.leadId = lead.id;
  }

  context.leadSaved = true;
  context.capturedLead = {
    callerNumber: phoneNumber,
    callerName: name,
    businessName: context.business?.name ?? "the business",
    status,
    capturedAt: new Date().toISOString()
  };

  logs.push(
    createLog(
      node,
      "success",
      mode === "live" ? "Lead saved." : "Dry run: lead not written.",
      context.capturedLead
    )
  );
}

async function runSaveConversationNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const businessId = context.business?.id;
  const phoneNumber = customerPhoneFromContext(context);

  if (!businessId || !phoneNumber) {
    logs.push(createLog(node, "error", "Save Conversation failed because business or caller phone is missing."));
    return;
  }

  const direction = asString(node.data?.conversationDirection, "OUTBOUND").toUpperCase();
  const body =
    renderTemplate(node.data?.conversationBody, context) ||
    context.sentSms?.body ||
    context.ai?.output ||
    "";

  if (!body) {
    logs.push(createLog(node, "error", "Save Conversation failed because the message body is empty."));
    return;
  }

  if (mode === "live") {
    const conversation = await prisma.conversation.upsert({
      where: {
        businessId_channel_customerPhone: { businessId, channel: "SMS", customerPhone: phoneNumber }
      },
      update: { status: "OPEN" },
      create: { businessId, channel: "SMS", customerPhone: phoneNumber, status: "OPEN" }
    });

    // Dedupe: skip if the latest stored message is identical (avoids double-writes
    // when handler orchestration also persists the same message).
    const latest = await prisma.conversationMessage.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" }
    });

    if (!(latest && latest.direction === direction && latest.body === body)) {
      await prisma.conversationMessage.create({
        data: { conversationId: conversation.id, direction, body }
      });
    }

    context.conversationId = conversation.id;
  }

  context.conversationSaved = true;
  context.latestMessage = body;

  logs.push(
    createLog(
      node,
      "success",
      mode === "live" ? `Conversation message saved (${direction}).` : "Dry run: message not written.",
      { direction, body }
    )
  );
}

async function runHumanHandoffNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const businessId = context.business?.id;
  const phoneNumber = customerPhoneFromContext(context);
  const reason =
    renderTemplate(node.data?.handoffReason, context) ||
    context.business?.escalationRules ||
    "Escalated to a human team member.";
  const teamPhone = context.business?.teamPhone;

  if (mode === "live" && businessId && phoneNumber) {
    await prisma.lead.upsert({
      where: { businessId_phoneNumber: { businessId, phoneNumber } },
      update: { status: "ESCALATED", notes: reason },
      create: {
        businessId,
        phoneNumber,
        source: "WORKFLOW",
        status: "ESCALATED",
        notes: reason,
        name: context.caller_name
      }
    });

    const conversation = await prisma.conversation.upsert({
      where: {
        businessId_channel_customerPhone: { businessId, channel: "SMS", customerPhone: phoneNumber }
      },
      update: { status: "OPEN" },
      create: { businessId, channel: "SMS", customerPhone: phoneNumber, status: "OPEN" }
    });

    await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "SYSTEM",
        body: `Handoff to human${teamPhone ? ` (${teamPhone})` : ""}: ${reason}`
      }
    });

    context.conversationId = conversation.id;
  }

  context.handoff = { reason, teamPhone };

  logs.push(
    createLog(
      node,
      "success",
      `Human handoff recorded${teamPhone ? ` to ${teamPhone}` : ""}.`,
      context.handoff
    )
  );
}

function forwardInputFromContext(context: RunnerContext): WorkflowRunInput {
  return {
    callerNumber: context.caller_number,
    callerName: context.caller_name,
    businessId: context.business?.id,
    businessOwnerId: context.business?.ownerId,
    businessName: context.business?.name,
    businessType: context.business?.type,
    businessPhoneNumber: context.business?.phoneNumber,
    bookingUrl: context.business?.bookingUrl,
    teamPhone: context.business?.teamPhone,
    calendarId: context.business?.calendarId,
    timeZone: context.business?.timeZone,
    vapiAssistantId: context.business?.vapiAssistantId,
    vapiPhoneNumberId: context.business?.vapiPhoneNumberId,
    services: context.business?.services,
    faqs: context.business?.faqs,
    tone: context.business?.tone,
    escalationRules: context.business?.escalationRules,
    knowledge: context.business?.knowledge,
    businessHours: context.business?.hours,
    inboundSmsBody: context.inboundSms?.body,
    missedCallReason: context.missedCall?.reason,
    conversationId: context.conversationId,
    leadId: context.leadId,
    installedAgentId: context.installedAgentId,
    latestMessage: context.latestMessage ?? context.inboundSms?.body
  };
}

async function runTriggerNextWorkflowNode({
  userId,
  node,
  context,
  logs,
  mode,
  chain
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
  chain: WorkflowChain;
}) {
  const targetWorkflowId = renderTemplate(node.data?.nextWorkflowId, context).trim();

  if (!targetWorkflowId) {
    logs.push(createLog(node, "error", "Next Workflow failed: no target workflow id is configured."));
    return;
  }

  if (chain.depth + 1 > MAX_WORKFLOW_CHAIN_DEPTH) {
    logs.push(
      createLog(node, "error", `Next Workflow stopped: max chain depth (${MAX_WORKFLOW_CHAIN_DEPTH}) reached.`)
    );
    return;
  }

  if (targetWorkflowId === chain.workflowId || chain.visited.includes(targetWorkflowId)) {
    logs.push(createLog(node, "error", "Next Workflow stopped: workflow loop detected."));
    return;
  }

  const target = await prisma.workflowDefinition.findUnique({
    where: { id: targetWorkflowId }
  });

  if (!target) {
    logs.push(createLog(node, "error", `Next Workflow failed: workflow ${targetWorkflowId} not found or inactive.`));
    return;
  }

  const childRun = await runWorkflowTest({
    userId,
    workflowId: target.id,
    workflowJson: target.workflowJson,
    input: forwardInputFromContext(context),
    mode,
    chainDepth: chain.depth + 1,
    chainVisited: [...chain.visited, chain.workflowId]
  });

  for (const childLog of childRun.logs) {
    logs.push({ ...childLog, label: `${target.name} › ${childLog.label}` });
  }

  context.nextWorkflow = { workflowId: target.id, name: target.name, ran: true };

  logs.push(
    createLog(node, "success", `Triggered next workflow: ${target.name}.`, {
      workflowId: target.id,
      name: target.name
    })
  );
}

async function runCoreConnectorNode({
  userId,
  node,
  context,
  logs,
  mode,
  chain
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
  chain: WorkflowChain;
}) {
  const action = asString(node.data?.connectorAction);

  if (action === CORE_CONNECTOR_ACTIONS.saveLead) {
    await runSaveLeadNode({ node, context, logs, mode });
    return;
  }

  if (action === CORE_CONNECTOR_ACTIONS.saveConversationMessage) {
    await runSaveConversationNode({ node, context, logs, mode });
    return;
  }

  if (action === CORE_CONNECTOR_ACTIONS.humanHandoff) {
    await runHumanHandoffNode({ node, context, logs, mode });
    return;
  }

  if (action === CORE_CONNECTOR_ACTIONS.triggerNextWorkflow) {
    await runTriggerNextWorkflowNode({ userId, node, context, logs, mode, chain });
    return;
  }

  logs.push(createLog(node, "error", `CoreAI action "${action}" is not executable yet.`));
}

async function runConnectorNode({
  userId,
  node,
  context,
  logs,
  mode,
  chain
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
  chain: WorkflowChain;
}) {
  const connector = asString(node.data?.connector, "SMS").toLowerCase();

  if (connector === "coreai" || connector === "core") {
    await runCoreConnectorNode({ userId, node, context, logs, mode, chain });
    return;
  }

  if (connector === "gmail") {
    await runGmailConnectorNode({
      userId,
      node,
      context,
      logs
    });
    return;
  }

  if (connector === "sms" || connector === "twilio") {
    await runSmsConnectorNode({
      node,
      context,
      logs,
      mode
    });
    return;
  }

  if (connector === "vapi" || connector === "vapi ai") {
    await runVapiConnectorNode({
      node,
      context,
      logs,
      mode
    });
    return;
  }

  if (connector === "google calendar" || connector === "calendar") {
    await runGoogleCalendarConnectorNode({
      userId,
      node,
      context,
      logs,
      mode
    });
    return;
  }

  logs.push(createLog(node, "error", `Unsupported connector: ${connector}`));
}

function runOutputNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  // Voice booking: End Flow closes a voice workflow (no missed-call output key/wording).
  const isEndFlow = asString(node.data?.type) === VOICE_NODE_TYPES.endFlow;
  const isVoiceWorkflow = isEndFlow || Boolean(context.voiceConversation || context.calendarAvailability);

  const outputKey = asString(node.data?.outputKey, isVoiceWorkflow ? "voiceBookingResult" : "missedCallTextBackResult");

  context.output = {
    key: outputKey,
    value:
      context.calendarAppointment ??
      context.calendarAvailability ??
      context.smsNotification ??
      context.voiceConversation ??
      context.capturedLead ??
      context.vapiCall ??
      context.sentSms ??
      context.queuedSms ??
      context.sentEmail ??
      context.draftEmail ??
      context.ai ??
      context.gmail ??
      context.missedCall ??
      null
  };

  if (isVoiceWorkflow) {
    logs.push(
      createLog(node, "success", "Voice booking workflow dry run completed.", context.output)
    );
    return;
  }

  logs.push(createLog(node, "success", `Output saved as ${outputKey}.`, context.output));
}

export async function runWorkflowTest({
  userId,
  workflowId,
  workflowJson,
  input,
  mode = "test",
  chainDepth = 0,
  chainVisited = []
}: {
  userId: string;
  workflowId: string;
  workflowJson: unknown;
  input?: WorkflowRunInput;
  mode?: WorkflowRunMode;
  chainDepth?: number;
  chainVisited?: string[];
}) {
  const parsedWorkflow = parseRunnerWorkflowJson(workflowJson);
  const logs: WorkflowRunLog[] = [];
  const context: RunnerContext = seedMissedCallContext(input);
  const chain: WorkflowChain = { depth: chainDepth, visited: chainVisited, workflowId };

  if (parsedWorkflow.nodes.length === 0) {
    return {
      workflowId,
      logs: [
        {
          nodeId: "empty",
          label: "Empty agent",
          status: "error" as const,
          message: "Please add at least one node before running a test."
        }
      ],
      context
    };
  }

  for (const node of sortNodesForRun(parsedWorkflow.nodes)) {
    const nodeKind = asString(node.data?.nodeKind);

    try {
      if (nodeKind === "trigger") {
        runTriggerNode(node, context, logs);
        continue;
      }

      if (nodeKind === "connector") {
        await runConnectorNode({
          userId,
          node,
          context,
          logs,
          mode,
          chain
        });
        continue;
      }

      if (nodeKind === "ai") {
        runAiNode(node, context, logs);
        continue;
      }

      if (nodeKind === "condition") {
        runConditionNode(node, context, logs);
        continue;
      }

      if (nodeKind === "output") {
        runOutputNode(node, context, logs);
        continue;
      }

      logs.push(createLog(node, "error", `Unknown node kind: ${nodeKind}`));
    } catch (error) {
      logs.push(
        createLog(
          node,
          "error",
          error instanceof Error ? error.message : "Node execution failed"
        )
      );
    }
  }

  return {
    workflowId,
    logs,
    context
  };
}
