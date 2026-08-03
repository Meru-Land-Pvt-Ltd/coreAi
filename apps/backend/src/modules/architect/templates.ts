import { getNodeDefinition, TELEGRAM_NODE_TYPES, VOICE_NODE_TYPES, workflowJsonForTemplate } from "@coreai/shared";

export type WorkflowTemplate = {
  id: string;
  slug: string;
  title: string;
  category: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced" | "Beginner/Intermediate";
  nodeCount: number;
  description: string;
  forks: number;
  rating: number;
  reviewCount: number;
  tags: string[];
  recommended?: boolean;
  workflowJson: {
    nodes: Array<{ id: string; type: "coreNode"; position: { x: number; y: number }; data: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>;
  };
  status: "ACTIVE" | "DRAFT";
  createdAt: string;
  updatedAt: string;
};

const SEED_TS = "2026-06-01T00:00:00.000Z";

type NodeSpec = { id: string; type: string; data?: Record<string, unknown>; title?: string };

/** Build builder-shaped nodes from registry definitions (same shape as a dragged node). */
function tnodes(specs: NodeSpec[]) {
  return specs.map((spec, index) => {
    const def = getNodeDefinition(spec.type);
    const data: Record<string, unknown> = {
      type: spec.type,
      nodeKind: def?.runtime.nodeKind ?? "connector",
      label: def?.label ?? spec.id,
      title: spec.title ?? def?.label ?? spec.id,
      subtitle: def?.description ?? "",
      ...(def?.runtime.connector ? { connector: def.runtime.connector } : {}),
      ...(def?.runtime.connectorAction ? { connectorAction: def.runtime.connectorAction } : {}),
      ...(def?.defaultConfig ?? {}),
      ...(spec.data ?? {})
    };
    return {
      id: spec.id,
      type: "coreNode" as const,
      position: { x: 80 + index * 280, y: 300 },
      data
    };
  });
}

function tedges(ids: string[]) {
  return ids.slice(1).map((id, index) => ({ id: `e${index + 1}`, source: ids[index], target: id }));
}

function flow(specs: NodeSpec[]) {
  return { nodes: tnodes(specs), edges: tedges(specs.map((s) => s.id)) };
}

/**
 * Architect-side Dental AI Receptionist import: 6-node voice booking chain with
 * Send SMS (not email). Registry defaults only — same as saving a template.
 */
function buildDentalReceptionistWorkflow(): WorkflowTemplate["workflowJson"] {
  const graph = flow([
    { id: VOICE_NODE_TYPES.phoneCallTrigger, type: VOICE_NODE_TYPES.phoneCallTrigger },
    { id: VOICE_NODE_TYPES.voiceConversation, type: VOICE_NODE_TYPES.voiceConversation },
    { id: VOICE_NODE_TYPES.calendarAvailability, type: VOICE_NODE_TYPES.calendarAvailability },
    { id: VOICE_NODE_TYPES.bookAppointment, type: VOICE_NODE_TYPES.bookAppointment },
    { id: VOICE_NODE_TYPES.sendSms, type: VOICE_NODE_TYPES.sendSms },
    { id: VOICE_NODE_TYPES.endFlow, type: VOICE_NODE_TYPES.endFlow }
  ]);
  return workflowJsonForTemplate(graph) as WorkflowTemplate["workflowJson"];
}

function buildTelegramAppointmentWorkflow(): WorkflowTemplate["workflowJson"] {
  const specs: NodeSpec[] = [
    {
      id: "telegram-trigger",
      type: TELEGRAM_NODE_TYPES.trigger,
      data: {
        telegramBookingMode: "true",
        telegramEventType: "message",
        telegramChatAccess: "private",
        telegramIgnoreBots: "true"
      }
    },
    {
      id: "start-message",
      type: TELEGRAM_NODE_TYPES.sendMessage,
      title: "Welcome Message",
      data: { telegramMessageText: "Welcome to {{business.name}}." }
    },
    {
      id: "start-buttons",
      type: TELEGRAM_NODE_TYPES.sendButtons,
      title: "Main Menu",
      data: {
        telegramMessageText: "Choose an option:",
        telegramButtonsJson:
          '[[{"text":"View services","callbackData":"nav:services"},{"text":"Book appointment","callbackData":"nav:book"}],[{"text":"Help","callbackData":"nav:help"}]]'
      }
    },
    {
      id: "request-contact",
      type: TELEGRAM_NODE_TYPES.requestContact,
      title: "Request Customer Contact"
    },
    {
      id: "answer-callback",
      type: TELEGRAM_NODE_TYPES.answerCallback,
      title: "Acknowledge Selection",
      data: { telegramCallbackText: "Selection received." }
    },
    {
      id: "calendar-availability",
      type: VOICE_NODE_TYPES.calendarAvailability
    },
    {
      id: "book-appointment",
      type: VOICE_NODE_TYPES.bookAppointment
    },
    {
      id: "save-lead",
      type: "action.save_lead"
    },
    {
      id: "customer-confirmation",
      type: TELEGRAM_NODE_TYPES.sendMessage,
      title: "Customer Confirmation",
      data: {
        telegramMessageText:
          "Appointment confirmed\n\nBusiness: {{business.name}}\nService: {{appointment.service}}\nDate: {{appointment.date}}\nTime: {{appointment.time}}"
      }
    },
    {
      id: "owner-confirmation",
      type: TELEGRAM_NODE_TYPES.sendMessage,
      title: "Owner Notification",
      data: {
        telegramRecipientSource: "business_owner",
        telegramMessageText:
          "New Telegram booking\n\nCustomer: {{customer.name}}\nPhone: {{customer.phone}}\nService: {{appointment.service}}"
      }
    },
    {
      id: "optional-email",
      type: VOICE_NODE_TYPES.sendEmail,
      title: "Optional Email Notification"
    },
    {
      id: "edit-summary",
      type: TELEGRAM_NODE_TYPES.editMessage,
      title: "Edit Booking Summary",
      data: { telegramMessageText: "Confirmed" }
    },
    {
      id: "send-photo",
      type: TELEGRAM_NODE_TYPES.sendPhoto,
      data: { telegramPhotoSource: "TELEGRAM_FILE_ID_OR_HTTPS_URL" }
    },
    {
      id: "send-document",
      type: TELEGRAM_NODE_TYPES.sendDocument,
      data: { telegramDocumentSource: "TELEGRAM_FILE_ID_OR_HTTPS_URL" }
    },
    {
      id: "send-voice",
      type: TELEGRAM_NODE_TYPES.sendVoice,
      data: { telegramVoiceSource: "TELEGRAM_FILE_ID_OR_HTTPS_URL" }
    },
    {
      id: "send-location",
      type: TELEGRAM_NODE_TYPES.sendLocation,
      data: { telegramLatitude: "40.7128", telegramLongitude: "-74.0060" }
    },
    {
      id: "delete-message",
      type: TELEGRAM_NODE_TYPES.deleteMessage,
      title: "Delete Demo Message"
    }
  ];
  const nodes = tnodes(specs).map((node, index) => ({
    ...node,
    position: {
      x: index === 0 ? 80 : 380 + ((index - 1) % 4) * 290,
      y: index === 0 ? 430 : 80 + Math.floor((index - 1) / 4) * 230
    }
  }));
  const edges: WorkflowTemplate["workflowJson"]["edges"] = [
    { id: "tg-start", source: "telegram-trigger", target: "start-message", sourceHandle: "/start" },
    { id: "tg-start-menu", source: "start-message", target: "start-buttons" },
    { id: "tg-book", source: "telegram-trigger", target: "request-contact", sourceHandle: "/book" },
    { id: "tg-book-callback", source: "request-contact", target: "answer-callback" },
    { id: "tg-availability", source: "answer-callback", target: "calendar-availability" },
    { id: "tg-create", source: "calendar-availability", target: "book-appointment" },
    { id: "tg-lead", source: "book-appointment", target: "save-lead" },
    { id: "tg-customer", source: "save-lead", target: "customer-confirmation" },
    { id: "tg-owner", source: "customer-confirmation", target: "owner-confirmation" },
    { id: "tg-email", source: "owner-confirmation", target: "optional-email" },
    { id: "tg-edit", source: "optional-email", target: "edit-summary" },
    { id: "tg-media", source: "telegram-trigger", target: "send-photo", sourceHandle: "/media-demo" },
    { id: "tg-document", source: "send-photo", target: "send-document" },
    { id: "tg-voice", source: "send-document", target: "send-voice" },
    { id: "tg-location", source: "send-voice", target: "send-location" },
    { id: "tg-manage", source: "telegram-trigger", target: "delete-message", sourceHandle: "/message-demo" }
  ];
  return { nodes, edges };
}

const SEED: Array<Omit<WorkflowTemplate, "nodeCount" | "status" | "createdAt" | "updatedAt">> = [
  {
    id: "tpl-dental-receptionist",
    slug: "dental-ai-receptionist",
    title: "Dental AI Receptionist",
    category: "Dental",
    difficulty: "Beginner/Intermediate",
    description: "Incoming call → AI receptionist → check calendar → book appointment → send SMS → end call.",
    forks: 312,
    rating: 5.0,
    reviewCount: 52,
    tags: ["Dental", "Medical", "Scheduling"],
    recommended: true,
    workflowJson: buildDentalReceptionistWorkflow()
  },
  {
    id: "tpl-telegram-appointment-booking",
    slug: "telegram-appointment-booking-assistant",
    title: "Telegram Appointment Booking Assistant",
    category: "Scheduling",
    difficulty: "Intermediate",
    description:
      "A dedicated business Telegram bot with services, persistent booking state, Google Calendar booking, confirmations, and media/action examples.",
    forks: 0,
    rating: 5,
    reviewCount: 0,
    tags: ["Telegram", "Scheduling", "Multi-channel"],
    recommended: true,
    workflowJson: buildTelegramAppointmentWorkflow()
  },
  {
    id: "tpl-missed-call",
    slug: "missed-call-text-back",
    title: "AI Receptionist Template",
    category: "Communication",
    difficulty: "Beginner",
    description: "Detect missed calls → generate an AI response → send an SMS. Average 28-second response time.",
    forks: 234,
    rating: 4.9,
    reviewCount: 47,
    tags: ["Dental", "HVAC", "Legal", "Medical"],
    workflowJson: flow([
      { id: "trigger", type: "trigger.twilio_missed_call" },
      { id: "ai", type: "ai.context_reply" },
      { id: "sms", type: "action.send_sms" }
    ])
  },
  {
    id: "tpl-appointment-reminder",
    slug: "appointment-reminder-confirm",
    title: "Appointment Reminder & Confirm",
    category: "Scheduling",
    difficulty: "Beginner",
    description: "24-hour reminder → wait for reply → confirm or reschedule → update the calendar automatically.",
    forks: 189,
    rating: 4.8,
    reviewCount: 38,
    tags: ["Dental", "Medical", "Legal", "Salon"],
    workflowJson: flow([
      { id: "trigger", type: "trigger.twilio_inbound_sms", title: "Reminder Reply" },
      { id: "decide", type: "logic.condition", title: "Confirm or Reschedule?" },
      { id: "sms", type: "action.send_sms", title: "Send Confirmation" },
      { id: "calendar", type: "action.google_calendar_create_appointment", title: "Update Calendar" }
    ])
  },
  {
    id: "tpl-review-booster",
    slug: "google-review-booster",
    title: "Google Review Booster",
    category: "Reviews",
    difficulty: "Intermediate",
    description: "After appointment completion → wait 2 hours → send a review request → track response → follow up if no review.",
    forks: 156,
    rating: 4.8,
    reviewCount: 31,
    tags: ["Dental", "Medical Spa", "Restaurant"],
    workflowJson: flow([
      { id: "trigger", type: "trigger.twilio_inbound_sms", title: "Appointment Completed" },
      { id: "wait", type: "logic.condition", title: "Wait 2 Hours" },
      { id: "ai", type: "ai.context_reply", title: "Compose Review Ask" },
      { id: "sms", type: "action.send_sms", title: "Send Review Request" },
      { id: "out", type: "output.result", title: "Track Response" }
    ])
  },
  {
    id: "tpl-lead-qualification",
    slug: "lead-qualification-bot",
    title: "Lead Qualification Bot",
    category: "Lead Gen",
    difficulty: "Intermediate",
    description: "New inquiry → ask qualifying questions → score the lead → route hot leads to the owner → nurture cold leads.",
    forks: 98,
    rating: 4.7,
    reviewCount: 22,
    tags: ["Real Estate", "HVAC", "Legal"],
    workflowJson: flow([
      { id: "trigger", type: "trigger.twilio_inbound_sms", title: "New Inquiry" },
      { id: "ai", type: "ai.context_reply", title: "Ask Qualifying Questions" },
      { id: "score", type: "logic.condition", title: "Score Lead" },
      { id: "save", type: "action.save_lead", title: "Save Lead" },
      { id: "route", type: "action.human_handoff", title: "Route Hot Leads" },
      { id: "out", type: "output.result", title: "Nurture Cold Leads" }
    ])
  },
  {
    id: "tpl-after-hours-receptionist",
    slug: "after-hours-receptionist",
    title: "After-Hours Receptionist",
    category: "Customer Service",
    difficulty: "Advanced",
    description: "A full virtual receptionist: greet → identify intent → book an appointment, answer an FAQ, or escalate to a human.",
    forks: 67,
    rating: 4.9,
    reviewCount: 15,
    tags: ["Dental", "Medical", "Legal", "Salon"],
    workflowJson: flow([
      { id: "trigger", type: "trigger.twilio_missed_call", title: "After-Hours Call" },
      { id: "ai", type: "ai.context_reply", title: "Greet & Identify Intent" },
      { id: "intent", type: "logic.condition", title: "Intent Router" },
      { id: "calendar", type: "action.google_calendar_create_appointment", title: "Book Appointment" },
      { id: "sms", type: "action.send_sms", title: "Confirm by SMS" },
      { id: "save", type: "action.save_lead", title: "Capture Lead" },
      { id: "escalate", type: "action.human_handoff", title: "Escalate to Human" },
      { id: "out", type: "output.result", title: "Result" }
    ])
  },
  {
    id: "tpl-invoice-follow-up",
    slug: "invoice-follow-up",
    title: "Invoice Follow-Up",
    category: "Communication",
    difficulty: "Beginner",
    description: "Overdue invoice detected → send a friendly reminder → escalate if no payment within 48 hours.",
    forks: 45,
    rating: 4.6,
    reviewCount: 12,
    tags: ["HVAC", "Plumbing", "Contractor"],
    workflowJson: flow([
      { id: "trigger", type: "trigger.twilio_inbound_sms", title: "Overdue Invoice" },
      { id: "ai", type: "ai.context_reply", title: "Friendly Reminder" },
      { id: "sms", type: "action.send_sms", title: "Send Reminder" }
    ])
  }
];

export const TEMPLATE_SEED: WorkflowTemplate[] = SEED.map((template) => ({
  ...template,
  nodeCount: template.workflowJson.nodes.length,
  status: "ACTIVE",
  createdAt: SEED_TS,
  updatedAt: SEED_TS
}));

/** Card metadata for the gallery list (omits the heavy workflowJson). */
export function listTemplateCards() {
  return TEMPLATE_SEED.map(({ workflowJson: _workflowJson, ...card }) => card);
}

export function getTemplateBySlug(slug: string): WorkflowTemplate | undefined {
  return TEMPLATE_SEED.find((template) => template.slug === slug);
}

/** Deep clone so an imported workflow never shares the seed's object identity. */
export function cloneTemplateWorkflow(template: WorkflowTemplate) {
  return JSON.parse(JSON.stringify(template.workflowJson)) as WorkflowTemplate["workflowJson"];
}
