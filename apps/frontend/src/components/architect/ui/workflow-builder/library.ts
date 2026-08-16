import {
  getNodeDefinition,
  API_CALL_NODE_TYPE,
  BLOCK_NODE_TYPES,
  CALENDLY_NODE_TYPES,
  DEEPGRAM_NODE_TYPES,
  DESIGN_BRAIN_NODE_TYPE,
  TELEGRAM_NODE_TYPES,
  VOICE_NODE_PRESENTATION,
  VOICE_NODE_TYPES
} from "@coreai/shared";
import type { BuilderNodeData, LibraryGroup, LibraryItem, NodeAccent, NodeKind } from "./types";

/**
 * Build a draggable palette item from a registry node definition. The dragged
 * node carries the same node.data (type + defaultConfig) as a template node, so
 * manual building and template import are identical and open the same inspector.
 */
function paletteItem(
  type: string,
  presentation: { icon: string; accent: NodeAccent; kind?: string }
): LibraryItem {
  const def = getNodeDefinition(type);
  const pres = VOICE_NODE_PRESENTATION[type];
  const overrides: Partial<BuilderNodeData> = {
    type,
    nodeKind: (def?.runtime.nodeKind ?? "connector") as NodeKind,
    connector: def?.runtime.connector,
    connectorAction: def?.runtime.connectorAction,
    kind: presentation.kind ?? pres?.kind ?? (def?.label ?? type ?? "").toUpperCase(),
    title: def?.label,
    subtitle: def?.description,
    ...(def?.defaultConfig ?? {})
  };
  return {
    nodeKind: (def?.runtime.nodeKind ?? "connector") as NodeKind,
    label: def?.label ?? type,
    helper: def?.description ?? "",
    icon: presentation.icon,
    accent: presentation.accent,
    testId: def?.testId,
    overrides
  };
}

// Generic, reusable platform nodes organized into the founder's three-part
// story: Face (what the customer sees), Brain (how it thinks), Hands (how it
// acts in the world). Every item keeps its registry testId, so templates and
// manual building stay identical.
export const libraryGroups: LibraryGroup[] = [
  /* Pre-designed sections of the customer page. Architects toggle and fill
     content — Triven owns the pixels. The engine skips these at run time; the
     customer page and Test preview assemble themselves from these blocks. */
  {
    title: "Face",
    subtitle: "What your customer sees",
    items: [
      {
        /* Design Brain — not a page section: the architect chats with it and
           the whole customer page restyles itself. Wand icon sets it apart
           from the section cards around it. */
        ...paletteItem(DESIGN_BRAIN_NODE_TYPE, { icon: "wand", accent: "rose", kind: "DESIGN" }),
        badge: "NEW"
      },
      paletteItem(BLOCK_NODE_TYPES.promptComposer, { icon: "edit", accent: "rose", kind: "PRODUCT" }),
      paletteItem(BLOCK_NODE_TYPES.presetGallery, { icon: "gallery", accent: "rose", kind: "PRODUCT" }),
      paletteItem(BLOCK_NODE_TYPES.modelPicker, { icon: "sliders", accent: "rose", kind: "PRODUCT" }),
      paletteItem(BLOCK_NODE_TYPES.actionButton, { icon: "pointer-click", accent: "rose", kind: "PRODUCT" }),
      paletteItem(BLOCK_NODE_TYPES.outputStage, { icon: "eye", accent: "rose", kind: "PRODUCT" }),
      paletteItem(BLOCK_NODE_TYPES.continueChain, { icon: "arrow-right", accent: "rose", kind: "PRODUCT" }),
      paletteItem(BLOCK_NODE_TYPES.historyShelf, { icon: "clock", accent: "rose", kind: "PRODUCT" })
    ]
  },
  {
    title: "Brain",
    subtitle: "How it thinks",
    items: [
      {
        ...paletteItem(VOICE_NODE_TYPES.voiceConversation, { icon: "sparkles", accent: "violet" }),
        badge: "POPULAR"
      },
      paletteItem("ai.context_reply", { icon: "sparkles", accent: "violet" }),
      paletteItem("ai.memory", { icon: "database", accent: "violet" }),
      {
        ...paletteItem("ai.image_generation", { icon: "image", accent: "violet" }),
        badge: "BETA"
      },
      {
        ...paletteItem(DEEPGRAM_NODE_TYPES.stt, { icon: "mic", accent: "violet", kind: "DEEPGRAM STT" }),
        badge: "NEW"
      },
      {
        ...paletteItem(DEEPGRAM_NODE_TYPES.tts, { icon: "mic", accent: "violet", kind: "DEEPGRAM TTS" }),
        badge: "NEW"
      },
      {
        nodeKind: "ai",
        label: "AI Brain",
        helper: "Generate text or JSON using a select LLM model",
        icon: "sparkles",
        accent: "violet",
        badge: "NEW",
        testId: "library-ai-llm-call",
        overrides: {
          type: "ai.llm_call",
          nodeKind: "ai",
          kind: "AI Brain",
          title: "AI Brain",
          subtitle: "Generate text or JSON using a select LLM model"
        }
      },
      /* Deciding by business hours is thinking, not acting — it lives here. */
      paletteItem("logic.condition", { icon: "diamond", accent: "orange", kind: "BUSINESS HOURS" })
    ]
  },
  /* Listen-items (things that start the agent) first, then act-items (things
     the agent does in the world). Advanced Telegram actions remain hidden
     until their dedicated UX is ready. */
  {
    title: "Hands",
    subtitle: "How it acts in the world",
    items: [
      // Listens
      paletteItem(VOICE_NODE_TYPES.phoneCallTrigger, { icon: "phone", accent: "amber" }),
      paletteItem(TELEGRAM_NODE_TYPES.trigger, { icon: "telegram", accent: "blue", kind: "TELEGRAM BOT" }),
      paletteItem("trigger.twilio_inbound_sms", { icon: "message", accent: "amber" }),
      paletteItem("trigger.twilio_missed_call", { icon: "phone", accent: "amber" }),
      {
        ...paletteItem("trigger.whatsapp_message_received", { icon: "whatsapp", accent: "green" }),
        badge: "POPULAR"
      },
      paletteItem(CALENDLY_NODE_TYPES.trigger, { icon: "calendly", accent: "blue", kind: "CALENDLY" }),
      paletteItem("trigger.manual", { icon: "play", accent: "amber" }),
      // Acts
      paletteItem(VOICE_NODE_TYPES.calendarAvailability, { icon: "calendar", accent: "blue" }),
      paletteItem(VOICE_NODE_TYPES.bookAppointment, { icon: "calendar", accent: "blue" }),
      paletteItem(CALENDLY_NODE_TYPES.action, { icon: "calendly", accent: "blue", kind: "CALENDLY" }),
      paletteItem(VOICE_NODE_TYPES.sendEmail, { icon: "mail", accent: "green" }),
      paletteItem(VOICE_NODE_TYPES.sendSms, { icon: "message", accent: "green" }),
      paletteItem("action.send_whatsapp", { icon: "whatsapp", accent: "green" }),
      paletteItem(TELEGRAM_NODE_TYPES.sendMessage, { icon: "telegram", accent: "blue" }),
      {
        // The universal action: one node reaches every service on the internet.
        ...paletteItem(API_CALL_NODE_TYPE, { icon: "globe", accent: "amber", kind: "API CALL" }),
        badge: "NEW"
      },
      paletteItem(VOICE_NODE_TYPES.endFlow, { icon: "capture", accent: "slate" })
    ]
  },
  // {
  //   title: "Telegram Bot Advanced",
  //   items: [
  //     paletteItem(TELEGRAM_NODE_TYPES.sendButtons, { icon: "telegram", accent: "green" }),
  //     paletteItem(TELEGRAM_NODE_TYPES.answerCallback, { icon: "telegram", accent: "green" }),
  //     paletteItem(TELEGRAM_NODE_TYPES.requestContact, { icon: "telegram", accent: "green" }),
  //     paletteItem(TELEGRAM_NODE_TYPES.sendPhoto, { icon: "image", accent: "green" }),
  //     paletteItem(TELEGRAM_NODE_TYPES.sendDocument, { icon: "file", accent: "green" }),
  //     paletteItem(TELEGRAM_NODE_TYPES.sendVoice, { icon: "mic", accent: "green" }),
  //     paletteItem(TELEGRAM_NODE_TYPES.sendLocation, { icon: "map-pin", accent: "green" }),
  //     paletteItem(TELEGRAM_NODE_TYPES.editMessage, { icon: "edit", accent: "green" }),
  //     paletteItem(TELEGRAM_NODE_TYPES.deleteMessage, { icon: "trash", accent: "red" })
  //   ]
  // },
  // {
  //   title: "CRM / Data",
  //   items: [
  //     paletteItem("action.save_lead", { icon: "capture", accent: "blue" }),
  //     paletteItem("action.save_conversation_message", { icon: "message", accent: "green" })
  //   ]
  // },
  // Human Handoff is intentionally hidden from the architect library.
  // paletteItem("action.human_handoff", { icon: "phone-call", accent: "red" }),
];

// Coming Soon nodes are intentionally hidden from the architect library.
