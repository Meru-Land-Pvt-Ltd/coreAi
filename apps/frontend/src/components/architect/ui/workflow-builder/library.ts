import {
  comingSoonNodes,
  getNodeDefinition,
  VOICE_NODE_PRESENTATION,
  VOICE_NODE_TYPES
} from "@coreai/shared";
import type { BuilderNodeData, ComingSoonItem, LibraryGroup, LibraryItem, NodeAccent, NodeKind } from "./types";

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
    kind: presentation.kind ?? pres?.kind ?? (def?.label ?? type).toUpperCase(),
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

// Generic, reusable platform nodes organized by use-case category. The Dental AI
// Receptionist is just a template that imports these with values in node.data.
export const libraryGroups: LibraryGroup[] = [
  {
    title: "Triggers",
    items: [
      paletteItem(VOICE_NODE_TYPES.phoneCallTrigger, { icon: "phone", accent: "amber" }),
      paletteItem("trigger.twilio_inbound_sms", { icon: "message", accent: "amber" }),
      paletteItem("trigger.twilio_missed_call", { icon: "phone", accent: "amber" })
    ]
  },
  {
    title: "AI",
    items: [
      paletteItem(VOICE_NODE_TYPES.voiceConversation, { icon: "sparkles", accent: "violet" }),
      paletteItem("ai.context_reply", { icon: "sparkles", accent: "violet" })
    ]
  },
  {
    title: "Calendar",
    items: [
      paletteItem(VOICE_NODE_TYPES.calendarAvailability, { icon: "calendar", accent: "blue" }),
      paletteItem(VOICE_NODE_TYPES.bookAppointment, { icon: "calendar", accent: "blue" })
    ]
  },
  {
    title: "Communication",
    items: [
      paletteItem(VOICE_NODE_TYPES.sendSms, { icon: "message", accent: "green" }),
      paletteItem("integration.gmail_send_email", { icon: "mail", accent: "green" }),
      paletteItem("integration.gmail_create_draft", { icon: "mail", accent: "blue" })
    ]
  },
  {
    title: "CRM / Data",
    items: [
      paletteItem("action.save_lead", { icon: "capture", accent: "blue" }),
      paletteItem("action.save_conversation_message", { icon: "message", accent: "green" })
    ]
  },
  {
    title: "Routing / Logic",
    items: [
      paletteItem("logic.condition", { icon: "diamond", accent: "orange", kind: "BUSINESS HOURS" }),
      paletteItem("action.human_handoff", { icon: "phone-call", accent: "red" }),
      paletteItem(VOICE_NODE_TYPES.endFlow, { icon: "capture", accent: "slate" })
    ]
  }
];

// Future nodes surfaced in the builder as non-executable "Coming soon" chips.
// They cannot be added to the canvas, so they can never end up in a published
// or executed workflow.
export const comingSoonItems: ComingSoonItem[] = comingSoonNodes().map((node) => ({
  type: node.type,
  label: node.label,
  description: node.description,
  testId: node.testId
}));
