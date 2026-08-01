import { TELEGRAM_NODE_TYPES, VOICE_NODE_TYPES } from "@coreai/shared";

/** Minimal node shape used to derive Test / Configure capabilities from the canvas. */
export type CapabilityNode = {
  data?: {
    type?: unknown;
    connector?: unknown;
    title?: unknown;
    label?: unknown;
    [key: string]: unknown;
  };
  type?: unknown;
};

export type WorkflowCapabilities = {
  hasGmail: boolean;
  hasSmsSendOrTwilioConnector: boolean;
  hasWhatsApp: boolean;
  hasVoice: boolean;
  hasTelegram: boolean;
  hasCalendar: boolean;
  hasEmailSend: boolean;
  hasMissedCall: boolean;
  hasInboundSms: boolean;
  hasManualTrigger: boolean;
  hasLlm: boolean;
};

function nodeType(node: CapabilityNode): string {
  return String(node.data?.type ?? node.type ?? "").toLowerCase();
}

function nodeConnector(node: CapabilityNode): string {
  return String(node.data?.connector ?? "").toLowerCase();
}

function nodeTitle(node: CapabilityNode): string {
  return String(node.data?.title ?? "").toLowerCase();
}

function nodeLabel(node: CapabilityNode): string {
  return String(node.data?.label ?? "").toLowerCase();
}

/**
 * Derive architect Test / Configure capability flags from the live canvas nodes.
 * Prefer stable `data.type` / connector; title/label used only as legacy fallbacks.
 */
export function deriveWorkflowCapabilities(nodes: CapabilityNode[]): WorkflowCapabilities {
  const hasGmail = nodes.some((node) => nodeConnector(node) === "gmail");

  const hasSmsSendOrTwilioConnector = nodes.some((node) =>
    ["sms", "twilio"].includes(nodeConnector(node))
  );

  const hasWhatsApp = nodes.some((node) => {
    const type = nodeType(node);
    return type.includes("whatsapp") || nodeConnector(node) === "whatsapp";
  });

  const voiceTypes = new Set<string>([
    VOICE_NODE_TYPES.phoneCallTrigger,
    VOICE_NODE_TYPES.voiceConversation
  ]);
  const hasVoice = nodes.some((node) => voiceTypes.has(nodeType(node)));

  const hasTelegram = nodes.some(
    (node) =>
      nodeType(node) === TELEGRAM_NODE_TYPES.trigger ||
      nodeType(node).includes("telegram") ||
      nodeConnector(node) === "telegram"
  );

  const hasCalendar = nodes.some((node) => {
    const type = nodeType(node);
    const connector = nodeConnector(node);
    return (
      type === VOICE_NODE_TYPES.calendarAvailability ||
      type === VOICE_NODE_TYPES.bookAppointment ||
      type.includes("calendar") ||
      connector.includes("calendar")
    );
  });

  const hasEmailSend = nodes.some(
    (node) =>
      nodeType(node) === VOICE_NODE_TYPES.sendEmail ||
      nodeType(node) === "communication.send_email" ||
      nodeType(node).includes("send_email")
  );

  const hasMissedCall = nodes.some((node) => {
    const type = nodeType(node);
    const title = nodeTitle(node);
    const label = nodeLabel(node);
    return (
      type === "trigger.twilio_missed_call" ||
      type === "twilio_missed_call" ||
      type === "missed_call" ||
      title.includes("missed call") ||
      label.includes("missed call")
    );
  });

  const hasInboundSms = nodes.some((node) => {
    const type = nodeType(node);
    const title = nodeTitle(node);
    const label = nodeLabel(node);
    return (
      type === "trigger.twilio_inbound_sms" ||
      type === "twilio_inbound_sms" ||
      type === "inbound_sms" ||
      title.includes("inbound sms") ||
      label.includes("inbound sms")
    );
  });

  const hasCallOrVoice =
    hasVoice ||
    nodes.some((node) => {
      const type = nodeType(node);
      return (
        type === VOICE_NODE_TYPES.phoneCallTrigger ||
        type === "trigger.phone_call" ||
        type === "phone_call"
      );
    });

  const hasManualTrigger =
    !hasCallOrVoice &&
    !hasMissedCall &&
    !hasInboundSms &&
    nodes.some((node) => {
      const type = nodeType(node);
      return type === "trigger.manual" || type === "manual_trigger" || type === "manual";
    });

  const hasLlm = nodes.some((node) => {
    const type = nodeType(node);
    return type === "ai.llm_call" || type.includes("llm");
  });

  return {
    hasGmail,
    hasSmsSendOrTwilioConnector,
    hasWhatsApp,
    hasVoice,
    hasTelegram,
    hasCalendar,
    hasEmailSend,
    hasMissedCall,
    hasInboundSms,
    hasManualTrigger,
    hasLlm
  };
}

/**
 * True when the canvas has at least one workflow trigger (manual, phone, SMS,
 * missed-call, telegram, whatsapp, or nodeKind=trigger).
 */
export function workflowHasTriggerNode(nodes: CapabilityNode[]): boolean {
  return nodes.some((node) => {
    const type = nodeType(node);
    const kind = String(node.data?.nodeKind ?? "").toLowerCase();
    if (kind === "trigger") return true;
    if (type.startsWith("trigger.")) return true;
    if (type === "manual_trigger" || type === "manual") return true;
    if (type === "phone_call" || type === "twilio_missed_call" || type === "twilio_inbound_sms") {
      return true;
    }
    return false;
  });
}
