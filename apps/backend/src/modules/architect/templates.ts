import {
  BLOCK_NODE_TYPES,
  DESIGN_BRAIN_NODE_TYPE,
  getNodeDefinition,
  TELEGRAM_NODE_TYPES,
  VOICE_NODE_PRESENTATION,
  VOICE_NODE_TYPES,
  workflowJsonForTemplate
} from "@coreai/shared";

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

// ---- "Start with a Face" templates ----------------------------------------
// One tap in the builder sidebar imports a fully wired, working product. The
// node data copies the shapes the palette produces (see library.ts paletteItem
// + node-defaults.ts) so a template import and manual building are identical.
//
// DOOR-NATIVE (founder law). Every node carries its own AI entry and exit doors
// where translation is needed — Hands get both, the Result Viewer gets an entry
// door, Face-in blocks and brains get none (see NODE_DOORS_BY_TYPE in the shared
// registry). The doors are invisible, on by default, and born knowing their job,
// so a template ships ONLY real steps:
//
//   Face blocks + Hands + at most ONE thinking Brain, where genuine reasoning
//   is wanted.
//
// No template may hand-place a brain whose job is to fill in the next step's
// request or tidy the last step's reply — that is a door, and doors are no
// longer canvas nodes. templates.test.ts locks this in.

type PlacedNodeSpec = NodeSpec & { x: number; y: number };

/** tnodes with explicit canvas positions for clean, non-linear layouts. */
function placedNodes(specs: PlacedNodeSpec[]) {
  return tnodes(specs).map((node, index) => ({
    ...node,
    position: { x: specs[index].x, y: specs[index].y }
  }));
}

function tedge(id: string, source: string, target: string) {
  return { id, source, target };
}

/** Palette presentation for product blocks (mirrors library.ts). Result Viewer
 * gets no `kind` here — its flat config already uses `kind: "auto"`. */
const FACE_BLOCK_PRESENTATION: Record<string, Record<string, unknown>> = {
  [DESIGN_BRAIN_NODE_TYPE]: { icon: "wand", accent: "rose", kind: "DESIGN" },
  [BLOCK_NODE_TYPES.promptComposer]: { icon: "edit", accent: "rose", kind: "PRODUCT" },
  [BLOCK_NODE_TYPES.presetGallery]: { icon: "gallery", accent: "rose", kind: "PRODUCT" },
  [BLOCK_NODE_TYPES.actionButton]: { icon: "pointer-click", accent: "rose", kind: "PRODUCT" },
  [BLOCK_NODE_TYPES.outputStage]: { icon: "eye", accent: "rose" },
  [BLOCK_NODE_TYPES.historyShelf]: { icon: "clock", accent: "rose", kind: "PRODUCT" }
};

function blockData(type: string, config: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(FACE_BLOCK_PRESENTATION[type] ?? {}), ...config };
}

/**
 * AI Brain (ai.llm_call) node data — mirrors the builder's defaultNodeData for
 * ai.llm_call (node-defaults.ts) with Gemini as the provider. ai.llm_call has
 * no registry definition, so the full shape lives in spec.data.
 */
function aiBrainData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "ai.llm_call",
    nodeKind: "ai",
    kind: "AI Brain",
    label: "AI Brain",
    title: "AI Brain",
    subtitle: "Generate text or JSON using a select LLM model",
    icon: "sparkles",
    accent: "violet",
    llmProvider: "gemini",
    llmModel: "gemini-3.5-flash",
    llmRequirements: "",
    llmSystemPrompt: "You are a helpful assistant.",
    llmPrompt: "",
    llmContext: "",
    llmTemperature: "0.7",
    llmMaxTokens: "1024",
    llmOutputFormat: "text",
    llmOutputKey: "ai.output",
    ...overrides
  };
}

const CHATBOT_SYSTEM_PROMPT =
  "You are a friendly, helpful assistant for this business. Answer in plain language, keep replies warm and concise, and use the business details you are given. If you are not sure about something, say so honestly.";

const FORM_TOOL_SYSTEM_PROMPT =
  "You turn a short request into a finished, well-organized report. Structure every reply with a clear title, short headed sections, and a closing summary. Write in plain business language the customer can use right away.";

/**
 * Chatbot Face: Prompt Box → AI Brain → Result Viewer → History Shelf, styled
 * by a Design Brain. One Brain — it answers the customer, which is the whole
 * product. The Result Viewer's own entry door turns that answer into what the
 * customer sees, so nothing here is asked to format anything.
 */
function buildChatbotFaceWorkflow(): WorkflowTemplate["workflowJson"] {
  return {
    nodes: placedNodes([
      { id: "design-brain", type: DESIGN_BRAIN_NODE_TYPE, x: 80, y: 80, data: blockData(DESIGN_BRAIN_NODE_TYPE) },
      {
        id: "prompt-box",
        type: BLOCK_NODE_TYPES.promptComposer,
        x: 80,
        y: 300,
        data: blockData(BLOCK_NODE_TYPES.promptComposer, { placeholder: "Ask me anything…" })
      },
      { id: "ai-brain", type: "ai.llm_call", x: 400, y: 300, data: aiBrainData({ llmSystemPrompt: CHATBOT_SYSTEM_PROMPT }) },
      { id: "result-viewer", type: BLOCK_NODE_TYPES.outputStage, x: 720, y: 300, data: blockData(BLOCK_NODE_TYPES.outputStage) },
      { id: "history-shelf", type: BLOCK_NODE_TYPES.historyShelf, x: 1040, y: 300, data: blockData(BLOCK_NODE_TYPES.historyShelf) }
    ]),
    edges: [
      tedge("e-style", "design-brain", "prompt-box"),
      tedge("e-ask", "prompt-box", "ai-brain"),
      tedge("e-show", "ai-brain", "result-viewer"),
      tedge("e-history", "result-viewer", "history-shelf")
    ]
  };
}

/**
 * Voice Agent Face: the dental voice-booking chain with generic business copy.
 * One Brain (the voice conversation). The two calendar steps are Hands: their
 * built-in doors work out the day, the length and the booking details from
 * whatever the caller said, so no translator brain sits between them.
 */
function buildVoiceAgentFaceWorkflow(): WorkflowTemplate["workflowJson"] {
  const voice = (type: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...(VOICE_NODE_PRESENTATION[type] ?? {}),
    ...extra
  });
  return {
    nodes: placedNodes([
      {
        id: "phone-call",
        type: VOICE_NODE_TYPES.phoneCallTrigger,
        x: 80,
        y: 300,
        data: voice(VOICE_NODE_TYPES.phoneCallTrigger)
      },
      {
        id: "voice-conversation",
        type: VOICE_NODE_TYPES.voiceConversation,
        x: 360,
        y: 300,
        data: voice(VOICE_NODE_TYPES.voiceConversation, {
          firstMessage: "Thanks for calling! How can I help you today?",
          systemPrompt:
            "You are the friendly phone receptionist for this business. Answer questions using its saved details, and when the caller wants an appointment, check open times and book the one they choose. Keep replies short, warm, and natural."
        })
      },
      {
        id: "calendar-availability",
        type: VOICE_NODE_TYPES.calendarAvailability,
        x: 640,
        y: 300,
        data: voice(VOICE_NODE_TYPES.calendarAvailability)
      },
      {
        id: "book-appointment",
        type: VOICE_NODE_TYPES.bookAppointment,
        x: 920,
        y: 300,
        data: voice(VOICE_NODE_TYPES.bookAppointment)
      },
      {
        id: "end-flow",
        type: VOICE_NODE_TYPES.endFlow,
        x: 1200,
        y: 300,
        data: voice(VOICE_NODE_TYPES.endFlow, {
          closingMessage: "Thanks for calling! Have a great day."
        })
      }
    ]),
    edges: [
      tedge("e-answer", "phone-call", "voice-conversation"),
      tedge("e-check", "voice-conversation", "calendar-availability"),
      tedge("e-book", "calendar-availability", "book-appointment"),
      tedge("e-end", "book-appointment", "end-flow")
    ]
  };
}

/**
 * Image Studio Face: Prompt Box + Styles Gallery → Image Generation → Result
 * Viewer → History Shelf.
 *
 * Door-native: the old prompt-writing AI Brain between the Prompt Box and the
 * image maker is gone. Its whole job — "turn the customer's idea and the style
 * they picked into the request this step needs" — is the entry-door job, and
 * the picture maker already reads the customer's request directly. One Brain
 * (the image maker), six nodes instead of seven.
 */
function buildImageStudioFaceWorkflow(): WorkflowTemplate["workflowJson"] {
  return {
    nodes: placedNodes([
      { id: "design-brain", type: DESIGN_BRAIN_NODE_TYPE, x: 80, y: 80, data: blockData(DESIGN_BRAIN_NODE_TYPE) },
      {
        id: "prompt-box",
        type: BLOCK_NODE_TYPES.promptComposer,
        x: 80,
        y: 300,
        data: blockData(BLOCK_NODE_TYPES.promptComposer, { placeholder: "Describe the picture you want…" })
      },
      {
        id: "styles-gallery",
        type: BLOCK_NODE_TYPES.presetGallery,
        x: 80,
        y: 520,
        data: blockData(BLOCK_NODE_TYPES.presetGallery, {
          presets: [
            { id: "photo", title: "Photo", emoji: "📷", promptFragment: "a crisp, true-to-life photograph with natural light" },
            { id: "watercolor", title: "Watercolor", emoji: "🎨", promptFragment: "a soft watercolor painting with gentle colors" },
            { id: "3d", title: "3D", emoji: "🧊", promptFragment: "a polished 3D scene with soft studio lighting" },
            { id: "sketch", title: "Sketch", emoji: "✏️", promptFragment: "a clean pencil sketch with simple, confident lines" }
          ]
        })
      },
      {
        id: "image-generation",
        type: "ai.image_generation",
        x: 400,
        y: 300,
        // Empty prompt on purpose: the image step then uses the customer's own
        // request — what they typed plus the style they picked.
        data: { icon: "image", accent: "violet", kind: "IMAGE GENERATION" }
      },
      { id: "result-viewer", type: BLOCK_NODE_TYPES.outputStage, x: 720, y: 300, data: blockData(BLOCK_NODE_TYPES.outputStage) },
      { id: "history-shelf", type: BLOCK_NODE_TYPES.historyShelf, x: 720, y: 520, data: blockData(BLOCK_NODE_TYPES.historyShelf) }
    ]),
    edges: [
      tedge("e-style", "design-brain", "prompt-box"),
      tedge("e-imagine", "prompt-box", "image-generation"),
      tedge("e-styles", "styles-gallery", "image-generation"),
      tedge("e-show", "image-generation", "result-viewer"),
      tedge("e-history", "result-viewer", "history-shelf")
    ]
  };
}

/**
 * Form Tool Face: Prompt Box + Button → AI Brain (writes the report) → Result
 * Viewer. One Brain — writing the report IS the product. The Result Viewer's
 * entry door does the showing, so the brain is never asked to produce a payload.
 */
function buildFormToolFaceWorkflow(): WorkflowTemplate["workflowJson"] {
  return {
    nodes: placedNodes([
      {
        id: "prompt-box",
        type: BLOCK_NODE_TYPES.promptComposer,
        x: 80,
        y: 300,
        data: blockData(BLOCK_NODE_TYPES.promptComposer, { placeholder: "Describe what you need" })
      },
      {
        id: "create-button",
        type: BLOCK_NODE_TYPES.actionButton,
        x: 80,
        y: 520,
        data: blockData(BLOCK_NODE_TYPES.actionButton, { label: "Create my report" })
      },
      { id: "ai-brain", type: "ai.llm_call", x: 400, y: 300, data: aiBrainData({ llmSystemPrompt: FORM_TOOL_SYSTEM_PROMPT }) },
      { id: "result-viewer", type: BLOCK_NODE_TYPES.outputStage, x: 720, y: 300, data: blockData(BLOCK_NODE_TYPES.outputStage) }
    ]),
    edges: [
      tedge("e-ask", "prompt-box", "ai-brain"),
      tedge("e-press", "create-button", "ai-brain"),
      tedge("e-show", "ai-brain", "result-viewer")
    ]
  };
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

/**
 * A dedicated Telegram appointment bot: welcome → menu → book → Google Calendar.
 */
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
  // ---- "Start with a Face" (builder sidebar) ----
  {
    id: "tpl-face-chatbot",
    slug: "chatbot",
    title: "Chatbot",
    category: "Faces",
    difficulty: "Beginner",
    description: "A ChatGPT-style product with your knowledge.",
    forks: 0,
    rating: 5,
    reviewCount: 0,
    tags: ["Face", "Chat"],
    workflowJson: buildChatbotFaceWorkflow()
  },
  {
    id: "tpl-face-voice-agent",
    slug: "voice-agent",
    title: "Voice Agent",
    category: "Faces",
    difficulty: "Beginner",
    description: "Answers the phone, chats with callers, and books appointments.",
    forks: 0,
    rating: 5,
    reviewCount: 0,
    tags: ["Face", "Voice", "Scheduling"],
    workflowJson: buildVoiceAgentFaceWorkflow()
  },
  {
    id: "tpl-face-image-studio",
    slug: "image-studio",
    title: "Image Studio",
    category: "Faces",
    difficulty: "Beginner",
    description: "Customers describe a picture, pick a style, and get an image.",
    forks: 0,
    rating: 5,
    reviewCount: 0,
    tags: ["Face", "Images"],
    workflowJson: buildImageStudioFaceWorkflow()
  },
  {
    id: "tpl-face-form-tool",
    slug: "form-tool",
    title: "Form Tool",
    category: "Faces",
    difficulty: "Beginner",
    description: "Customers fill in what they need and get a ready-made report.",
    forks: 0,
    rating: 5,
    reviewCount: 0,
    tags: ["Face", "Reports"],
    workflowJson: buildFormToolFaceWorkflow()
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
