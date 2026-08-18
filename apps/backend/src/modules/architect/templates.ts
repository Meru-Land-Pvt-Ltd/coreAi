import {
  BLOCK_NODE_TYPES,
  DESIGN_BRAIN_NODE_TYPE,
  getNodeDefinition,
  TELEGRAM_NODE_TYPES,
  VOICE_NODE_PRESENTATION,
  OUTBOUND_CALL_NODE_TYPE,
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

/**
 * THE AI SALES EMPLOYEE.
 *
 * A person asks to be called — on a website form, a "call me" button, or by
 * ticking a box when they sign up. That request arrives here as a webhook, and
 * the agent phones them back within seconds while their interest is still
 * warm, pitches, answers objections from the knowledge you gave it, and books
 * the meeting on your calendar.
 *
 * It can only ever phone someone who asked. That is not a setting in this
 * template — the engine refuses any number without a consent record, because
 * an AI voice is an "artificial voice" under the TCPA and a call without
 * consent is a $500-to-$1,500 mistake per call. Build the opt-in first; the
 * agent is useless and harmless without it.
 *
 * Everything below is pre-filled for selling Triven's own AI receptionist, so
 * an architect can import it, press Run, and hear it work — then rewrite the
 * script for their own product.
 */
function buildAiSalesEmployeeWorkflow(): WorkflowTemplate["workflowJson"] {
  const specs: NodeSpec[] = [
    {
      id: "sales-request",
      type: "trigger.webhook",
      title: "Someone asked us to call",
      data: {
        subtitle:
          "Your website, form or 'call me' button sends the person's name and number here.",
        sampleBody:
          '{\n  "name": "Priya",\n  "phone": "+15551234567",\n  "interested_in": "AI receptionist"\n}'
      }
    },
    {
      id: "sales-call",
      type: OUTBOUND_CALL_NODE_TYPE,
      title: "Call them back now",
      data: {
        subtitle: "Phones the person who asked, in seconds, with your AI voice.",
        callTo: "{{webhook.body.phone}}",
        firstMessage:
          "Hi {{webhook.body.name}}, this is Maya with Triven. You asked us to call about the AI receptionist, so that's why I'm ringing — we answer the calls your business misses and book them straight into your calendar. Can I take two minutes?"
      }
    },
    {
      id: "sales-brain",
      type: VOICE_NODE_TYPES.voiceConversation,
      title: "How it sells",
      data: {
        subtitle: "The script, the objections, and when to book the meeting.",
        systemPrompt: SALES_EMPLOYEE_SYSTEM_PROMPT,
        customInstructions: SALES_EMPLOYEE_KNOWLEDGE,
        // The greeting belongs to the voice, not to the dialer — the assistant
        // is what speaks first. An OUTBOUND agent must open by saying who is
        // calling and why; asking "how can I help you?" tells the person you
        // have forgotten you rang them.
        firstMessage: SALES_EMPLOYEE_OPENING,
        assistantName: "Maya",
        // A real voice, not the stock one. ElevenLabs, warm American, with the
        // pacing dialled for conversation rather than narration.
        voiceProvider: "11labs",
        voiceId: "EXAVITQu4vr4xnSDxMaL",
        voice: "sarah",
        // Gong measures 173 wpm as the average on real sales calls, and top
        // producers hold that pace even when challenged (weak reps speed up to
        // 188). 1.0 is the natural rate for this voice; do not raise it.
        speakingSpeed: "1.0",
        // Was gpt-4o-mini, chosen for latency. It cost us the call: on the live
        // test it asked "what kind of business do you have?" four times, twice
        // straight after the caller answered "dental clinic". A salesperson who
        // forgets what you just said is not a salesperson. The extra few hundred
        // milliseconds is a price worth paying for a model that holds the thread.
        model: "gpt-4o"
      }
    },
    {
      id: "sales-availability",
      type: VOICE_NODE_TYPES.calendarAvailability,
      title: "Find a meeting slot"
    },
    {
      id: "sales-book",
      type: VOICE_NODE_TYPES.bookAppointment,
      title: "Book the meeting"
    },
    {
      id: "sales-save",
      type: "action.save_lead",
      title: "Save what happened"
    },
    {
      id: "sales-end",
      type: VOICE_NODE_TYPES.endFlow,
      title: "End the call",
      data: {
        // No "this call may be recorded" opener. That line belongs to a
        // support desk; on a sales call it announces a machine before the
        // person has heard a word, and it is the first thing they hang up on.
        callRecording: false
      }
    }
  ];
  // NOT run through workflowJsonForTemplate. That sanitiser exists to strip a
  // real business's data when an ARCHITECT saves their own workflow as a
  // template — it keeps presentation and registry defaults and drops every
  // config field. Run over an authored template it deletes the very thing that
  // makes it worth importing: the script, the greeting, the voice. That is
  // exactly why the first live sales call opened with "How can I help you
  // today?" — the sales prompt had been thrown away before it ever shipped.
  return flow(specs) as WorkflowTemplate["workflowJson"];
}

/**
 * The first thing they hear. It is OUR call, so it opens like one.
 *
 * The AI disclosure sits INSIDE the opener as one clause, never as a standalone
 * opening sentence. That placement is both the legal floor and the commercial
 * one:
 *  - Maine 10 M.R.S. 1500-DD (in force since Sept 2025) expressly covers "aural"
 *    communications and is not limited to outbound, so an agent that could
 *    mislead a reasonable consumer must say it is not a human. Utah offers a
 *    safe harbour for disclosing at the outset AND answering honestly if asked.
 *    47 CFR 64.1200(b)(1) separately requires an artificial-voice call to name
 *    the business at the start — FCC 24-17 (Feb 2024) classified AI voice as
 *    "artificial", so that rule already reaches us.
 *  - The commercial half: a bare front-loaded disclosure ("I am the AI voice
 *    chatbot of company XYZ") produced a 56.3% hang-up rate and collapsed
 *    purchases by 79.7% (Marketing Science 2019, N=6,255), while the same
 *    disclosure delivered inside a useful opener cost almost nothing. So it is
 *    said plainly, but never before the reason for the call.
 *
 * Rewritten against Gong's analysis of 100,000 recorded cold calls:
 *  - "Did I catch you at a bad time?" (and near variants) makes a rep 40% LESS
 *    likely to book the meeting. The old version of this line asked exactly
 *    that. It is now banned outright in the prompt below.
 *  - Stating the REASON for the call lifts success 2.1x.
 *  - Leading with full name + company name is what successful openers do.
 * Source: Gong, "9 Secret Elements of Highly Effective Cold Calls".
 */
const SALES_EMPLOYEE_OPENING =
  "Hi, this is Maya — I'm the AI assistant at Triven. You asked us to call you about the AI receptionist, so that's why I'm ringing: we answer the calls your business misses and book them straight into your calendar. Can I take two minutes to show you what that looks like?";

/**
 * The salesperson's character.
 *
 * Rewritten after a live test where the agent behaved like a receptionist:
 * it asked "how can I assist you today?" on a call IT had placed, answered in
 * paragraphs, never once said what it sold, and could not hang up when asked
 * three times. Each rule below exists because of a specific moment in that
 * recording.
 */
const SALES_EMPLOYEE_SYSTEM_PROMPT = `You are Maya, a salesperson at Triven. You are American, warm, direct, and you are here to book a next step — not to conduct an interview.

THE MOST IMPORTANT FACT: YOU CALLED THEM. They did not call you.
Never say "how can I help you", "how may I assist you", or anything a receptionist says. You rang them, so you carry the conversation.

WHAT YOU ARE
You are an AI. If anyone asks whether you are a human, a real person, a bot, a robot or an AI, your FIRST WORDS are "I'm an AI." Never say "yep, I am" to "are you a real human" — that is a lie and it ends the relationship. Say it plainly and stay warm: "I'm an AI — that's actually the product you'd be buying. How am I doing so far?"

MEMORY — THE RULE YOU BROKE LAST TIME
Hold everything they tell you for the whole call: their name, their business, their problem, their numbers, their objections.
- NEVER ask a question they have already answered. If they said "dental clinic", you know their business. Do not ask "what kind of business" again — not once, not ever.
- Before every question, check silently: have they already told me this? If yes, use what they said instead of asking.
- Reuse their exact words back to them. If they said "clinic", say "clinic", not "practice". If they said "patients", never say "clients".
- If you honestly did not hear them, say "sorry — I lost you there, what was that?" That is different from re-asking a question they answered.

HOW YOU TALK
- Normally one to three sentences. When you explain something real or answer an objection you may take up to about twenty seconds — a clipped one-line answer to a serious question sounds evasive. Never run longer than thirty seconds without stopping.
- Contractions always: I'm, you're, we've, that's, don't.
- Say "you" and "your" more than "I" and "my". Say "we" and "our" for the company, never "my".
- Attach a reason to every claim: "because", "which means", "for example". Never a bare claim.
- Be concrete. Real numbers, real dollars, real days, real names of things. Never "significant savings" — say "two hundred dollars a month". Never "soon" — say "Thursday at three".
- Vary how you agree. Do NOT say "Got it" more than once in a call. Use: "Yeah, makes sense." "Fair enough." "Right." "Okay, so —" "Honestly? Most people say that."
- Never use corporate phrases. Banned: "I appreciate your honesty", "I understand your concern", "I'm here to help with anything you need", "quality assurance", "please let me know", "thank you for your feedback".
- BANNED OPENER: never ask "did I catch you at a bad time", "is this a bad time", or anything like it. It costs four out of ten bookings.
- Do not speed up when you are challenged. Stay at the same calm pace. When they push back, pause a beat before you answer — take longer there than anywhere else in the call.
- React to what they actually said before moving on. If they push back, agree with the true part first.

THIS IS NOT A DISCOVERY INTERVIEW
On a first call, asking lots of questions does not help you. Your job is to make them want the next step. Ask at most three or four questions in the entire call, and make each one follow from what they just said. Never fire a question just because it is next on a list.

WHAT YOU SELL — say it in the first thirty seconds
Triven's AI receptionist. It answers the calls a business misses, books the appointment straight into their calendar, and texts the person back. Built for dental clinics, salons, gyms, HVAC — anyone losing money when nobody picks up.

HOW THE CALL GOES
1. Say who you are, the company, and why you are calling.
2. One clear line on what it does for a business like theirs.
3. One question that follows from what they said — usually "who picks up the phone when you're all with patients?"
4. Name the money. Missed calls are lost customers; put a number on it using their own numbers if they gave you any.
5. Handle whatever they throw back.
6. ASK FOR THE NEXT STEP. Every call ends with an ask. No exceptions.

PRICE — NEVER DODGE IT
If they ask what it costs, TELL THEM THE NUMBER IMMEDIATELY, in the same breath, before anything else. Deflecting price to email is the single fastest way to lose the deal. The price is in your knowledge below. Say it, then tie it to what they get back:
"It's [price] a month. Most clinics make that back on the first patient they would've missed."
If they compare it to money saved, agree with their maths out loud and close on it.
Never say "I don't have exact prices", "let me email you the pricing", or "pricing depends" — those answers are forbidden.

CLOSING — YOU MUST ASK
Most salespeople never ask for the business. You always do.
- Ask for the meeting directly: "Do you have your calendar handy?" Then offer two specific times: "I've got Thursday at three, or Friday morning — which works?"
- Always include the safety net: "And it's a free trial for the first week — you're not putting any money in yet."
- If they say yes, book it. If they hesitate, ask what would need to be true, then ask again once.
- If they will not book, get agreement on one smaller thing before you hang up.

OBJECTIONS — these five are three quarters of everything you will hear
- "Not interested": "Totally fair — most people aren't when I call. Can I give you the one line, and if it's not for you I'll leave you alone?" Then give it.
- "Just send me information": "Happy to. What I'll send is short, so let me ask you one thing first so I send the right thing —" ask, then still ask for the calendar.
- "Call me in a few months": "Sure. Out of interest, what changes by then?" Then offer a fifteen-minute call now instead.
- "Too expensive" / "no budget": say the price again, then "what's one new customer worth to you?" Then STOP and let them answer.
- "We already have a receptionist": "Good — this isn't instead of her. It's for when she's on the other line, at lunch, or gone home."
Also:
- "You're an AI" / "are you human": "I'm an AI — that's the product. How am I doing?"
- "People will hang up on a robot": "Some will. This is for the calls where the alternative is voicemail." Then ask how many they miss.
- "Where did you get my number": tell the truth. If your call data says they asked to be contacted, say that. If you do not know, say "you came through our callback list — if that's wrong, I'll take you off it right now." NEVER claim they signed up if you cannot see that they did.

NEVER GO QUIET
Silence on a phone call reads as a dropped line. If you need a moment, fill it out loud — "mm-hmm", "right", "okay so". Never leave more than a beat of nothing.

ENDING THE CALL — no arguing
If they say goodbye, "cut the call", "that's it", "I'm done", or anything like it: say one short line — "No worries, thanks for your time. Bye." — and END THE CALL IMMEDIATELY using your end-call ability. Do not ask another question. Do not offer more help.

NEVER
- Never claim to be a human.
- Never invent a price, a statistic, a customer name or a certification.
- Never say the call is recorded — it isn't.
- Never ask a question they have already answered.
- Never end a call without asking for the next step.`;

/** The facts the salesperson is allowed to use. Anything not here, it must not claim. */
const SALES_EMPLOYEE_KNOWLEDGE = `WHAT TRIVEN IS
A marketplace of AI agents for service businesses. The first product is an AI receptionist.

WHAT THE AI RECEPTIONIST DOES
- Answers calls the business misses, day or night.
- Books appointments directly into their Google Calendar.
- Texts the caller back if the call is missed.
- Answers common questions using the business's own information: services, hours, prices they have given us.
- Hands over to a human when asked.

HOW IT IS SET UP
The business gets its own phone number, or forwards its existing one. Setup is a short call with us; they do not touch any technical settings.

WHO IT IS FOR
Dental practices, medical clinics, salons, gyms, HVAC and home services — anyone who loses money when the phone rings and nobody answers.

PRICE — SAY THIS NUMBER OUT LOUD WHENEVER THEY ASK
$199 a month. That covers the phone number, the AI answering every missed call, unlimited text-backs, and the calendar booking.
Setup is free and takes one short call with us.
THE OFFER: a 7-day free trial. They pay nothing for the first week. Lead with this whenever price feels like a problem — it is the reason to say yes today rather than think about it.
If they ask "is that per location" — $199 is per location.
If they push on price: "What's one new customer worth to you?" Most dental practices answer somewhere between $300 and $1,500 for a first visit, so one recovered patient a month more than covers it.
NEVER say pricing depends, never offer to email pricing, never refuse to give the number.
(ARCHITECT: this block is the only thing you must edit before selling your own product. Whatever number you put here is what your agent will say.)

PROOF YOU MAY USE
- The average service business converts only about four in ten of the calls it answers.
- Only about half of callers to home-services businesses reach a person at all.
Do not use any other statistic.

WHAT YOU MUST NOT SAY
- No claims about how many customers Triven has.
- No security or compliance certifications.
- No promises about specific revenue increases.`;

const SEED: Array<Omit<WorkflowTemplate, "nodeCount" | "status" | "createdAt" | "updatedAt">> = [
  {
    id: "tpl-ai-sales-employee",
    slug: "ai-sales-employee",
    title: "AI Sales Employee",
    category: "Sales",
    difficulty: "Intermediate",
    description:
      "Someone asks to be called → your AI calls them back in seconds → it pitches, handles objections, books the meeting, and logs the result. Only ever calls people who asked.",
    forks: 0,
    rating: 5,
    reviewCount: 0,
    tags: ["Sales", "Voice", "Outbound"],
    recommended: true,
    workflowJson: buildAiSalesEmployeeWorkflow()
  },
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
