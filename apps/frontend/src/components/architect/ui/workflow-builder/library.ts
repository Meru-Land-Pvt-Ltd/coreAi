import {
  getNodeDefinition,
  PARKED_NODE_TYPES,
  API_CALL_NODE_TYPE,
  CALL_LIST_NODE_TYPE,
  SCRIPT_NODE_TYPE,
  BLOCK_NODE_TYPES,
  CALENDLY_NODE_TYPES,
  DEEPGRAM_NODE_TYPES,
  OUTBOUND_CALL_NODE_TYPE,
  SCHEDULE_NODE_TYPE,
  TELEGRAM_NODE_TYPES,
  WEBHOOK_NODE_TYPE,
  VOICE_NODE_PRESENTATION,
  VOICE_NODE_TYPES
} from "@coreai/shared";
import type { BuilderNodeData, LibraryGroup, LibraryItem, NodeAccent, NodeKind } from "./types";

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
    /* Era leftovers stay visible but greyed — the palette tells the truth. */
    ...(PARKED_NODE_TYPES[type] ? { parked: PARKED_NODE_TYPES[type] } : {}),
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
      /* A styling card used to sit here. Removed: the AI Builder generates and
         fixes the interface, so a draggable design node was a second place to
         ask for the same thing. Old canvases that still carry one keep
         rendering; the runner's clean skip for it is untouched. */
      paletteItem(BLOCK_NODE_TYPES.promptComposer, { icon: "edit", accent: "rose", kind: "PRODUCT" }),
      { ...paletteItem("block.file_upload", { icon: "file", accent: "rose", kind: "PRODUCT" }), badge: "NEW" },
      paletteItem(BLOCK_NODE_TYPES.outputStage, { icon: "eye", accent: "rose", kind: "PRODUCT" }),
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
      /* NODE 011. Memory remembers conversations; this reads the business's
         library — their documents, uploaded once at setup. */
      { ...paletteItem("ai.knowledge", { icon: "book", accent: "violet" }), badge: "NEW" },
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
        /* Written by hand, it said "Generate text or JSON using a select LLM
           model" while the node's own row said "Thinks about what has happened
           so far and writes an answer, using the model you pick." One node,
           two descriptions, and the shelf's was the machine's words. It reads
           the row now, like every other card. Its test id is kept as it was. */
        ...paletteItem("ai.llm_call", { icon: "sparkles", accent: "violet", kind: "AI Brain" }),
        badge: "NEW",
        testId: "library-ai-llm-call"
      },
      /* Deciding by business hours is thinking, not acting — it lives here. */
      paletteItem("logic.condition", { icon: "diamond", accent: "orange", kind: "BUSINESS HOURS" }),
      { ...paletteItem("logic.loop", { icon: "git-branch", accent: "orange", kind: "REPEAT" }), badge: "NEW" }
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
{ ...paletteItem("trigger.email_received", { icon: "mail", accent: "green", kind: "LISTENS" }), badge: "NEW" },
      paletteItem("trigger.twilio_inbound_sms", { icon: "message", accent: "amber" }),
      paletteItem("trigger.twilio_missed_call", { icon: "phone", accent: "amber" }),
      {
        ...paletteItem("trigger.whatsapp_message_received", { icon: "whatsapp", accent: "green" }),
        badge: "POPULAR"
      },
      paletteItem(CALENDLY_NODE_TYPES.trigger, { icon: "calendly", accent: "blue", kind: "CALENDLY" }),
      // The two ways in that need no human at all.
      {
        ...paletteItem(SCHEDULE_NODE_TYPE, { icon: "clock", accent: "amber", kind: "TIMER" }),
        badge: "NEW"
      },
      {
        ...paletteItem(WEBHOOK_NODE_TYPE, { icon: "globe", accent: "amber", kind: "WEBHOOK" }),
        badge: "NEW"
      },
      paletteItem("trigger.manual", { icon: "play", accent: "amber" }),
      {
        /* The third way in, and the only one the BUSINESS starts.
           The engine, the routes, the legal calling window and the dashboard
           for this shipped weeks ago; the card never did, so the one node a
           business operates themselves could not be placed on a canvas. */
        ...paletteItem(CALL_LIST_NODE_TYPE, { icon: "phone-outgoing", accent: "amber", kind: "CALL LIST" }),
        badge: "NEW"
      },
      // Acts
      /* The Settings Law's second ruling: one Google Calendar card, the job
         on a dial — check free times or book the visit. */
      paletteItem(VOICE_NODE_TYPES.calendarAvailability, { icon: "calendar", accent: "blue" }),
      paletteItem(CALENDLY_NODE_TYPES.action, { icon: "calendly", accent: "blue", kind: "CALENDLY" }),
      paletteItem(VOICE_NODE_TYPES.sendEmail, { icon: "mail", accent: "green" }),
      /* NODE 012. The judgment to stop — hands the thread to a human. */
      { ...paletteItem("communication.escalate", { icon: "life-buoy", accent: "orange" }), badge: "NEW" },
      /* NODE 013. The probation — nothing sends without the owner's yes. */
      { ...paletteItem("communication.approval", { icon: "check", accent: "green" }), badge: "NEW" },
      paletteItem(VOICE_NODE_TYPES.sendSms, { icon: "message", accent: "green" }),
      {
        // The sales employee's hands: it phones people who asked to be phoned.
        ...paletteItem(OUTBOUND_CALL_NODE_TYPE, { icon: "phone", accent: "green", kind: "AI CALL" }),
        badge: "NEW"
      },
      paletteItem("action.send_whatsapp", { icon: "whatsapp", accent: "green" }),
      paletteItem(TELEGRAM_NODE_TYPES.sendMessage, { icon: "telegram", accent: "blue" }),
      {
        // The universal action: one node reaches every service on the internet.
        ...paletteItem(API_CALL_NODE_TYPE, { icon: "globe", accent: "amber", kind: "API CALL" }),
        badge: "NEW"
      },
      {
        /* The Code step, back on the palette.
           It was taken off with a note saying it could return when it ran
           somewhere with no network and no filesystem. It now runs in a
           container with no route off the box, no credentials and no
           privileges — so here it is. */
        ...paletteItem(SCRIPT_NODE_TYPE, { icon: "code", accent: "slate", kind: "CODE" }),
        badge: "NEW"
      },
    ]
  },
];

export function libraryItemType(item: LibraryItem): string {
  return typeof item.overrides?.type === "string" ? item.overrides.type : "";
}
