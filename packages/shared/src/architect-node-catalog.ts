/**
 * Architect workflow-builder palette catalog.
 *
 * Admin → Builder nodes controls `visible`, `label`, and `group` per type.
 * Missing DB rows use catalog defaults so the library matches today's palette
 * until an admin changes it. Hidden nodes remain executable if they already
 * exist on a canvas — this only controls the palette.
 */

import { NODE_DEFINITIONS } from "./node-registry";

export type ArchitectNodeCatalogItem = {
  type: string;
  group: string;
  label: string;
  /** Matches the current architect library when no admin override exists. */
  defaultVisible: boolean;
};

/** Partial admin override. Omitted fields keep the catalog / stored value. */
export type ArchitectNodeOverride = {
  visible?: boolean;
  label?: string | null;
  group?: string | null;
};

export type ResolvedArchitectNode = ArchitectNodeCatalogItem & {
  visible: boolean;
  defaultLabel: string;
  defaultGroup: string;
};

const HAND_WRITTEN_CATALOG: ArchitectNodeCatalogItem[] = [
  { type: "trigger.phone_call", group: "Triggers", label: "Incoming call", defaultVisible: true },
  { type: "trigger.telegram_message", group: "Triggers", label: "Telegram message", defaultVisible: true },
  { type: "trigger.twilio_inbound_sms", group: "Triggers", label: "Text message", defaultVisible: true },
  { type: "trigger.email_received", group: "Triggers", label: "Email received", defaultVisible: true },
  { type: "trigger.twilio_missed_call", group: "Triggers", label: "Missed call", defaultVisible: true },
  { type: "trigger.whatsapp_message_received", group: "Triggers", label: "WhatsApp message", defaultVisible: true },
  { type: "trigger.calendly", group: "Triggers", label: "Calendly booking", defaultVisible: true },
  { type: "trigger.manual", group: "Triggers", label: "Start here", defaultVisible: true },
  { type: "trigger.schedule", group: "Triggers", label: "Timer", defaultVisible: true },
  { type: "action.start_vapi_call", group: "Actions", label: "Call this person", defaultVisible: true },
  { type: "tool.node_frame", group: "Actions", label: "New connection", defaultVisible: true },
  { type: "logic.script", group: "Actions", label: "Code", defaultVisible: true },
  { type: "trigger.webhook", group: "Triggers", label: "When another app sends data", defaultVisible: true },

  { type: "ai.voice_conversation", group: "AI", label: "AI receptionist", defaultVisible: true },
  { type: "ai.context_reply", group: "AI", label: "AI Text Reply", defaultVisible: true },
  { type: "ai.memory", group: "AI", label: "Memory Node", defaultVisible: true },
  { type: "ai.knowledge", group: "AI", label: "Knowledge", defaultVisible: true },
  { type: "communication.escalate", group: "Actions", label: "Escalate", defaultVisible: true },
  { type: "communication.approval", group: "Actions", label: "Approval", defaultVisible: true },
  { type: "ai.image_generation", group: "AI", label: "Create image", defaultVisible: true },
  { type: "ai.deepgram_stt", group: "AI", label: "Deepgram STT", defaultVisible: true },
  { type: "ai.deepgram_tts", group: "AI", label: "Deepgram TTS", defaultVisible: true },
  { type: "ai.llm_call", group: "AI", label: "AI Brain", defaultVisible: true },

  { type: "calendar.availability", group: "Calendar", label: "Check Availability", defaultVisible: true },
  { type: "calendar.book_appointment", group: "Calendar", label: "Book appointment", defaultVisible: true },
  { type: "action.calendly", group: "Calendar", label: "Calendly action", defaultVisible: true },

  { type: "action.telegram_send_message", group: "Telegram Features", label: "Send Telegram", defaultVisible: true },
  { type: "action.telegram_send_buttons", group: "Telegram Features", label: "Telegram buttons", defaultVisible: false },
  { type: "action.telegram_answer_callback", group: "Telegram Features", label: "Confirm button tap", defaultVisible: false },
  { type: "action.telegram_request_contact", group: "Telegram Features", label: "Ask for phone number", defaultVisible: false },
  { type: "action.telegram_send_photo", group: "Telegram Features", label: "Send photo", defaultVisible: false },
  { type: "action.telegram_send_document", group: "Telegram Features", label: "Send file", defaultVisible: false },
  { type: "action.telegram_send_voice", group: "Telegram Features", label: "Send voice note", defaultVisible: false },
  { type: "action.telegram_send_location", group: "Telegram Features", label: "Send location", defaultVisible: false },
  { type: "action.telegram_edit_message", group: "Telegram Features", label: "Edit Telegram", defaultVisible: false },
  { type: "action.telegram_delete_message", group: "Telegram Features", label: "Delete Telegram", defaultVisible: false },

  { type: "communication.send_email", group: "Communication", label: "Send email", defaultVisible: true },
  { type: "communication.send_sms", group: "Communication", label: "Send text", defaultVisible: true },
  { type: "action.send_whatsapp", group: "Communication", label: "Send WhatsApp", defaultVisible: true },

  { type: "action.save_lead", group: "CRM / Data", label: "Save customer", defaultVisible: false },
  { type: "action.save_conversation_message", group: "CRM / Data", label: "Save chat", defaultVisible: false },

  { type: "logic.condition", group: "Routing / Logic", label: "Condition", defaultVisible: true },
  { type: "logic.loop", group: "Routing / Logic", label: "Loop", defaultVisible: true },
  { type: "action.human_handoff", group: "Routing / Logic", label: "Transfer to staff", defaultVisible: false },
  { type: "flow.end", group: "Routing / Logic", label: "End", defaultVisible: true },

  /* ---- What the customer sees. ----
     These are on the builder palette under "Face" and always have been, and
     they were simply never written down here. The cost was not cosmetic: this
     list is what the AI composer picks from, so with no Prompt Box and no
     Result Viewer it could not build a chat product at all. Asked for "an AI I
     can talk to", it reached for the phone receptionist, because a phone was
     the only mouth it had. */
  { type: "block.prompt_composer", group: "Face", label: "Prompt Box", defaultVisible: true },
  { type: "block.file_upload", group: "Face", label: "File Upload", defaultVisible: true },
  { type: "block.output_stage", group: "Face", label: "Result Viewer", defaultVisible: true },
  { type: "block.history_shelf", group: "Face", label: "History Shelf", defaultVisible: true },
  { type: "block.action_button", group: "Face", label: "Button", defaultVisible: true },
  { type: "block.continue_chain", group: "Face", label: "Continue Button", defaultVisible: true },
  { type: "block.model_picker", group: "Face", label: "Model Picker", defaultVisible: true },
  { type: "block.preset_gallery", group: "Face", label: "Styles Gallery", defaultVisible: true },

  /* On the palette, and missing from here for the same reason. */
  { type: "action.api_call", group: "Actions", label: "Connect to a service", defaultVisible: true },
  { type: "trigger.call_list", group: "Triggers", label: "Call this list", defaultVisible: true }
];

/**
 * EVERY NODE GETS A ROW, WITHOUT ANYONE REMEMBERING TO ADD IT.
 *
 * This list used to be the only list, kept by hand, and it had fallen 22 nodes
 * behind the builder. Two things broke quietly because of it: the admin Nodes
 * page could not switch off a node it had never heard of, and the AI composer
 * could not build with one.
 *
 * So anything in the registry that nobody wrote down still appears — switched
 * OFF, because a node nobody has decided about is not one to hand an architect
 * by default. Writing it above is now how you turn it on and give it a home,
 * not how you make it exist.
 */
function derivedCatalog(): ArchitectNodeCatalogItem[] {
  const written = new Set(HAND_WRITTEN_CATALOG.map((item) => item.type));
  const groupForCategory: Record<string, string> = {
    trigger: "Triggers",
    action: "Actions",
    ai: "AI",
    product: "Face",
    logic: "Routing / Logic"
  };

  const rest = NODE_DEFINITIONS.filter((definition) => !written.has(definition.type)).map((definition) => ({
    type: definition.type,
    group: groupForCategory[definition.category] ?? "Other",
    label: definition.label,
    defaultVisible: false
  }));

  return [...HAND_WRITTEN_CATALOG, ...rest];
}

export const ARCHITECT_NODE_CATALOG: readonly ArchitectNodeCatalogItem[] = derivedCatalog();

export const ARCHITECT_NODE_TYPE_SET = new Set(ARCHITECT_NODE_CATALOG.map((item) => item.type));

export const ARCHITECT_NODE_GROUP_ORDER = [...new Set(ARCHITECT_NODE_CATALOG.map((item) => item.group))];

export function isArchitectNodeType(type: string): boolean {
  return ARCHITECT_NODE_TYPE_SET.has(type);
}

export function defaultHiddenArchitectNodeTypes(): string[] {
  return ARCHITECT_NODE_CATALOG.filter((item) => !item.defaultVisible).map((item) => item.type);
}

function trimOverride(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOverride(value: boolean | ArchitectNodeOverride | undefined): ArchitectNodeOverride {
  if (value === undefined) return {};
  return typeof value === "boolean" ? { visible: value } : value;
}

export function resolveArchitectNodeVisibility(
  overrides:
    | ReadonlyMap<string, boolean | ArchitectNodeOverride>
    | Record<string, boolean | ArchitectNodeOverride>
): ResolvedArchitectNode[] {
  const lookup =
    overrides instanceof Map ? overrides : new Map(Object.entries(overrides));
  return ARCHITECT_NODE_CATALOG.map((item) => {
    const override = asOverride(lookup.get(item.type));
    return {
      ...item,
      visible: override.visible ?? item.defaultVisible,
      label: trimOverride(override.label) ?? item.label,
      group: trimOverride(override.group) ?? item.group,
      defaultLabel: item.label,
      defaultGroup: item.group
    };
  });
}

export function hiddenArchitectNodeTypes(
  overrides:
    | ReadonlyMap<string, boolean | ArchitectNodeOverride>
    | Record<string, boolean | ArchitectNodeOverride>
): string[] {
  return resolveArchitectNodeVisibility(overrides)
    .filter((item) => !item.visible)
    .map((item) => item.type);
}

export function defaultArchitectNodePresentation(): Array<{
  type: string;
  label: string;
  group: string;
  visible: boolean;
  defaultLabel: string;
  defaultGroup: string;
}> {
  return resolveArchitectNodeVisibility(new Map()).map((item) => ({
    type: item.type,
    label: item.label,
    group: item.group,
    visible: item.visible,
    defaultLabel: item.defaultLabel,
    defaultGroup: item.defaultGroup
  }));
}
