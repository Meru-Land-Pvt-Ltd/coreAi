import {
  DEEPGRAM_NODE_TYPES,
  resolveDeepgramMode,
  TELEGRAM_NODE_TYPES,
  VOICE_NODE_TYPES,
  workflowGraphHasTrigger
} from "@coreai/shared";

/** Minimal node shape used to derive Test / Configure capabilities from the canvas. */
export type CapabilityNode = {
  data?: {
    type?: unknown;
    connector?: unknown;
    title?: unknown;
    label?: unknown;
    mode?: unknown;
    [key: string]: unknown;
  };
  type?: unknown;
};

export type WorkflowCapabilities = {
  hasGmail: boolean;
  hasSmsSendOrTwilioConnector: boolean;
  hasWhatsApp: boolean;
  hasWhatsAppTrigger: boolean;
  hasVoice: boolean;
  hasTelegram: boolean;
  hasCalendar: boolean;
  hasCalendly: boolean;
  hasCalendlyTrigger: boolean;
  calendlyActions: string[];
  hasEmailSend: boolean;
  hasMissedCall: boolean;
  hasInboundSms: boolean;
  hasManualTrigger: boolean;
  hasLlm: boolean;
  hasDeepgram: boolean;
  hasDeepgramStt: boolean;
  hasDeepgramTts: boolean;
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

  const hasWhatsAppTrigger = nodes.some((node) => {
    const type = nodeType(node);
    return type === "trigger.whatsapp_message_received" || type.startsWith("trigger.whatsapp");
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

  const hasCalendly = nodes.some((node) => {
    const type = nodeType(node);
    const connector = nodeConnector(node);
    return type.includes("calendly") || connector === "calendly";
  });

  const hasCalendlyTrigger = nodes.some((node) => {
    const type = nodeType(node);
    const kind = String(node.data?.nodeKind ?? "").toLowerCase();
    const connector = nodeConnector(node);
    return (
      type === "trigger.calendly" ||
      type.startsWith("trigger.calendly_") ||
      (kind === "trigger" && connector === "calendly")
    );
  });

  const calendlyActions = [
    ...new Set(
      nodes
        .filter((node) => {
          const type = nodeType(node);
          const connector = nodeConnector(node);
          const kind = String(node.data?.nodeKind ?? "").toLowerCase();
          if (kind === "trigger") return false;
          return (
            type === "action.calendly" ||
            type.startsWith("action.calendly_") ||
            (connector === "calendly" && type.startsWith("action."))
          );
        })
        .map((node) => String(node.data?.connectorAction ?? "").toLowerCase())
        .filter(Boolean)
    )
  ];

  const hasCalendar = nodes.some((node) => {
    const type = nodeType(node);
    const connector = nodeConnector(node);
    if (type.includes("calendly") || connector === "calendly") return false;
    return (
      type === VOICE_NODE_TYPES.calendarAvailability ||
      type === VOICE_NODE_TYPES.bookAppointment ||
      type.includes("google_calendar") ||
      type.includes("calendar") ||
      connector.includes("google calendar") ||
      connector === "calendar"
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

  const hasDeepgram = nodes.some((node) => {
    const type = nodeType(node);
    return (
      type === DEEPGRAM_NODE_TYPES.speech ||
      type === DEEPGRAM_NODE_TYPES.stt ||
      type === DEEPGRAM_NODE_TYPES.tts ||
      type.includes("deepgram")
    );
  });

  const hasDeepgramStt = nodes.some((node) => {
    const type = nodeType(node);
    const mode = typeof node.data?.mode === "string" ? node.data.mode : undefined;
    return resolveDeepgramMode(type, mode) === "stt";
  });

  const hasDeepgramTts = nodes.some((node) => {
    const type = nodeType(node);
    const mode = typeof node.data?.mode === "string" ? node.data.mode : undefined;
    return resolveDeepgramMode(type, mode) === "tts";
  });

  return {
    hasGmail,
    hasSmsSendOrTwilioConnector,
    hasWhatsApp,
    hasWhatsAppTrigger,
    hasVoice,
    hasTelegram,
    hasCalendar,
    hasCalendly,
    hasCalendlyTrigger,
    calendlyActions,
    hasEmailSend,
    hasMissedCall,
    hasInboundSms,
    hasManualTrigger,
    hasLlm,
    hasDeepgram,
    hasDeepgramStt,
    hasDeepgramTts
  };
}

/**
 * True when the canvas has at least one workflow trigger (manual, phone, SMS,
 * missed-call, telegram, whatsapp, or nodeKind=trigger).
 */
export function workflowHasTriggerNode(nodes: CapabilityNode[]): boolean {
  // One rule, shared with the graph validator and the template seeds.
  return workflowGraphHasTrigger(nodes);
}
