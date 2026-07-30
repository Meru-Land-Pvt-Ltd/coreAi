export type NodeCategory =
  | "trigger"
  | "action"
  | "logic"
  | "data"
  | "ai"
  | "integration";

export type RunnerNodeKind = "trigger" | "ai" | "condition" | "connector" | "output";

export type NodeRuntime = {
  nodeKind: RunnerNodeKind;
  connector?: string;
  connectorAction?: string;
};

export type ConnectorRequirement = {
  connector: string;
  label: string;
  ownedBy: "buyer" | "platform";
  scopes?: string[];
  config?: string[];
  optional?: boolean;
  note: string;
};

export type NodeDefinition = {
  /** Stable type slug, e.g. "action.send_sms". */
  type: string;
  label: string;
  category: NodeCategory;
  description: string;
  /** Config fields this node reads at runtime. */
  requiredConfig: string[];
  backendExecutable: boolean;
  launchCritical: boolean;
  comingSoon: boolean;
  /** data-testid friendly slug, e.g. "node-action-send-sms". */
  testId: string;
  runtime: NodeRuntime;
  /**
   * Connectors this node needs to run live, supplied by `getNodeDefinition`
   * from `REQUIRED_CONNECTORS_BY_TYPE`. Empty for platform-only/no-connector nodes.
   */
  requiredConnectors?: ConnectorRequirement[];
  /** Default builder config applied when the node is dropped on the canvas. */
  defaultConfig?: Record<string, string>;
  /** Agent-runtime capability slug, e.g. "calendar.check_availability". */
  capability?: string;
  /** Variables that must exist in the runtime context before this node can execute. */
  requiredVariables?: string[];
  /** Variables this node writes into the runtime context when it executes. */
  producedVariables?: string[];
};

/** The Triven connector groups platform actions executed directly by the runner. */
export const CORE_CONNECTOR = "Triven";

export const CORE_CONNECTOR_ACTIONS = {
  saveLead: "save_lead",
  saveConversationMessage: "save_conversation_message",
  humanHandoff: "human_handoff",
  triggerNextWorkflow: "trigger_next_workflow"
} as const;

export type CoreConnectorAction =
  (typeof CORE_CONNECTOR_ACTIONS)[keyof typeof CORE_CONNECTOR_ACTIONS];

/** Hard cap on workflow-to-workflow chaining depth to prevent infinite loops. */
export const MAX_WORKFLOW_CHAIN_DEPTH = 3;

export const VOICE_NODE_TYPES = {
  phoneCallTrigger: "trigger.phone_call",
  voiceConversation: "ai.voice_conversation",
  calendarAvailability: "calendar.availability",
  bookAppointment: "calendar.book_appointment",
  sendSms: "communication.send_sms",
  sendEmail: "communication.send_email",
  endFlow: "flow.end"
} as const;

export const VOICE_TEMPLATE_NODE_ORDER: string[] = [
  VOICE_NODE_TYPES.phoneCallTrigger,
  VOICE_NODE_TYPES.voiceConversation,
  VOICE_NODE_TYPES.calendarAvailability,
  VOICE_NODE_TYPES.bookAppointment,
  VOICE_NODE_TYPES.sendEmail,
  VOICE_NODE_TYPES.endFlow
];

export const BROWSER_CALL_START_MESSAGE = "__browser_call_start__";

/** Vapi function-tool names the deployed assistant calls back into our webhook. */
export const VOICE_TOOL_NAMES = {
  checkAvailability: "check_availability",
  bookAppointment: "book_appointment",
  cancelAppointment: "cancel_appointment",
  rescheduleAppointment: "reschedule_appointment",
  updateAppointmentContact: "update_appointment_contact",
  sendNotification: "send_notification",
  recordSmsConsent: "record_sms_consent",
  lookupKnowledge: "lookup_knowledge"
} as const;

export const DEFAULT_VOICE_PROVIDER = "11labs";

export const PLATFORM_DEFAULT_VOICE_ID = "triven-default";

export type VoiceProviderId = "11labs" | "cartesia";

export type AgentVoicePreset = {
  id: string;
  name: string;
  provider: VoiceProviderId;
  voiceId: string;
  style: string;
  bestFor: string;
  description: string;
  previewText: string;
  isDefault?: boolean;
};

export const VOICE_PRESETS: AgentVoicePreset[] = [
  {
    id: PLATFORM_DEFAULT_VOICE_ID,
    name: "Triven Default Voice",
    provider: DEFAULT_VOICE_PROVIDER,
    voiceId: "",
    style: "Platform default",
    bestFor: "All agent templates",
    description: "Uses ELEVENLABS_DEFAULT_VOICE_ID / VAPI_DEFAULT_VOICE_ID from production env.",
    previewText: "Hello, this is your Triven AI agent. How can I help you today?",
    isDefault: true
  },
  {
    id: "skylar",
    name: "Skylar",
    provider: "cartesia",
    voiceId: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4",
    style: "Friendly guide",
    bestFor: "Customer care, clinics, appointment booking",
    description: "Approachable American female voice for customer care and support.",
    previewText: "Hi, this is Skylar. How can I help you today?"
  },
  {
    id: "ella",
    name: "Ella",
    provider: "cartesia",
    voiceId: "2a12b36c-7f9b-4c3a-9f7a-72731b15323a",
    style: "Caring scout",
    bestFor: "Everyday customer conversations, front desk, support",
    description: "Approachable female voice for bright, lightweight customer conversations.",
    previewText: "Hi there, this is Ella. What can I do for you today?"
  },
  {
    id: "jacqueline",
    name: "Jacqueline",
    provider: "cartesia",
    voiceId: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
    style: "Reassuring agent",
    bestFor: "Empathic support, healthcare, complaint handling",
    description: "Confident young-adult female voice for empathic customer support.",
    previewText: "Hello, this is Jacqueline. I am here to help — what do you need?"
  },
  {
    id: "blake",
    name: "Blake",
    provider: "cartesia",
    voiceId: "a167e0f3-df7e-4d52-a9c3-f949145efdab",
    style: "Helpful agent",
    bestFor: "Home services, retail, high-energy front desk",
    description: "Energetic adult male voice for engaging customer support.",
    previewText: "Hey, this is Blake. Thanks for calling — how can I help?"
  },
  {
    id: "ronald",
    name: "Ronald",
    provider: "cartesia",
    voiceId: "5ee9feff-1265-424a-9d7f-8e4d431a12c7",
    style: "Male conversational",
    bestFor: "Home services, automotive, B2B",
    description: "Deep young-adult male voice for casual conversations.",
    previewText: "Hello, this is Ronald. Thanks for calling. How can I help?"
  }
];

export function getVoicePreset(id: string): AgentVoicePreset | undefined {
  const key = (id || PLATFORM_DEFAULT_VOICE_ID).trim().toLowerCase();
  return VOICE_PRESETS.find((preset) => preset.id === key);
}

export const RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE = `You are {{assistantName}}, the AI receptionist for {{business_name}}.

Your job: answer calls for this {{business_type}}, help callers book appointments, and answer basic questions.

CURRENT DATE & TIME (CRITICAL):
- The current date and time is {{currentDateTime}} ({{timeZone}}).
- For relative dates like "today", "tomorrow", or "next Monday", ALWAYS calculate the exact calendar date from {{currentDateTime}}.
- Pass dates to tools as YYYY-MM-DD computed from {{currentDateTime}} — never a date from memory or training data.
- NEVER call check_availability or book_appointment with a past date. If unsure, ask the caller to confirm the date.
- Always confirm the chosen date and time back to the caller in {{timeZone}} before booking.

BUSINESS DETAILS:
- Name: {{business_name}}
- Contact: {{contact_name}}
- Type: {{business_type}}
- Hours: {{business_hours}}
- Services: {{services_list}}

CALENDAR BOOKING RULES:
{{calendar_booking_rules}}

RULES:
1. Always be warm, friendly, and professional.
2. When a caller wants to book, call check_availability first.
3. Offer the available slots and let the caller choose.
4. After they choose, call book_appointment to confirm.
5. After booking, follow the SMS consent rules: read the SMS consent disclosure, record the answer with record_sms_consent, and only call send_notification if consent was recorded as yes.
6. If you cannot help with something, say: "{{fallback_response}}"
7. Never make up availability. Always check the calendar.
8. To cancel an appointment, use the cancel_appointment tool. It verifies the caller by their incoming caller ID only — never verify by a phone number the caller says out loud, never reveal stored numbers or appointment details when verification fails, and cancel only after the caller clearly says yes.

BEFORE CALLING book_appointment YOU MUST HAVE:
- the caller's REAL full name
- a callback phone number
- the service type
- the date
- the time
Never call book_appointment with a placeholder name (e.g. John Doe, Full Name, or "the caller"). If the caller's name is unclear, ask them to repeat it and confirm the spelling before booking.

SILENCE / NO-ANSWER POLICY:
{{silence_policy}}

CUSTOM INSTRUCTIONS:
{{custom_instructions}}

CONVERSATION STYLE:
- Keep responses short (1-2 sentences max)
- Sound natural, not robotic
- Use the caller's name after they give it
- Confirm details by repeating them back`;

/** Default silence/no-answer reprompt + goodbye copy (buyer can override in setup). */
export const DEFAULT_SILENCE = {
  repromptCount: 2,
  reprompt1: "Are you still there? I can help you book an appointment or answer a quick question.",
  reprompt2: "No problem. If now is not a good time, you can call us back anytime.",
  goodbye: "Thanks for calling. I'll end the call for now. Have a great day."
} as const;

export type SilenceConfig = {
  repromptCount?: number;
  reprompt1?: string;
  reprompt2?: string;
  goodbye?: string;
};

/** Render the silence/no-answer policy block injected into the system prompt. */
export function buildSilencePolicy(cfg?: SilenceConfig): string {
  const count =
    cfg?.repromptCount && cfg.repromptCount > 0 ? Math.min(Math.floor(cfg.repromptCount), 3) : DEFAULT_SILENCE.repromptCount;
  const reprompt1 = (cfg?.reprompt1 || DEFAULT_SILENCE.reprompt1).trim();
  const reprompt2 = (cfg?.reprompt2 || DEFAULT_SILENCE.reprompt2).trim();
  const goodbye = (cfg?.goodbye || DEFAULT_SILENCE.goodbye).trim();

  const lines = [
    `If the caller does not respond or stays silent, re-prompt warmly up to ${count} time(s) before ending the call.`,
    `- 1st silence, say: "${reprompt1}"`
  ];
  if (count >= 2) lines.push(`- 2nd silence, say: "${reprompt2}"`);
  lines.push(`- After ${count} attempt(s) with no response, say: "${goodbye}" and end the call politely.`);
  return lines.join("\n");
}

/** Default calendar booking rules. {{timeZone}} is filled by Vapi at call time. */
export const DEFAULT_CALENDAR_BOOKING_RULES = [
  "- Offer the earliest available slots first and never double-book.",
  "- All times are in the business timezone ({{timeZone}}); confirm the date and time back to the caller before booking.",
  "- Use the default appointment length unless the caller asks for something different."
].join("\n");

/** Quick-add custom-instruction suggestions surfaced as chips in buyer setup. */
export const CUSTOM_INSTRUCTION_SUGGESTIONS: string[] = [
  "Ask for full name before booking",
  "Escalate urgent calls",
  "Do not quote prices",
  "Mention parking",
  "Confirm date and time before booking",
  "Collect insurance provider"
];

function slug(type: string) {
  return `node-${type.replace(/[._]/g, "-")}`;
}

function def(input: Omit<NodeDefinition, "testId">): NodeDefinition {
  return { ...input, testId: slug(input.type) };
}

export const NODE_DEFINITIONS: NodeDefinition[] = [
  // ---- A. Launch-critical (Missed Call Text-Back) ----
  def({
    type: "trigger.twilio_missed_call",
    label: "Missed Call Trigger",
    category: "trigger",
    description: "Starts the workflow when a call goes unanswered (no-answer/busy/failed).",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "trigger" }
  }),
  def({
    type: "trigger.twilio_inbound_sms",
    label: "Inbound SMS Trigger",
    category: "trigger",
    description: "Marks the inbound-SMS entry. Inbound texts are handled by the SMS webhook.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "trigger" }
  }),
  def({
    type: "trigger.whatsapp_message_received",
    label: "WhatsApp Message Received",
    category: "trigger",
    description: "Starts when a WhatsApp message arrives on a connected Meta Cloud API number.",
    requiredConfig: ["connectionId"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "trigger", connector: "WhatsApp" },
    defaultConfig: {
      connectionId: "",
      listenFor: "all",
      ignoreGroups: "true",
      ignoreStatusMessages: "true"
    },
    capability: "trigger.whatsapp",
    requiredVariables: [],
    producedVariables: [
      "contact.name",
      "contact.phone",
      "message.id",
      "message.type",
      "message.text",
      "media.url",
      "timestamp"
    ]
  }),
  def({
    type: "trigger.vapi_tool_call",
    label: "Vapi Tool Call",
    category: "trigger",
    description: "Marks the Vapi webhook tool-call entry (e.g. book_appointment).",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "trigger" }
  }),
  def({
    type: "ai.context_reply",
    label: "AI Text Reply",
    category: "ai",
    description: "Generates a reply from per-business context (name, services, FAQs, hours, tone).",
    requiredConfig: ["prompt"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "ai" }
  }),
  def({
    type: "ai.memory",
    label: "Memory Node",
    category: "ai",
    description: "Stores and aggregates all previous node execution history + manual document uploads into a compact text memory string.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "ai" },
    defaultConfig: {
      customMemoryNotes: "",
      maxMemoryTokens: "4000"
    },
    capability: "ai.memory",
    producedVariables: ["memory"]
  }),
  def({
    type: "action.send_sms",
    label: "Send SMS",
    category: "action",
    description: "Sends an SMS via Twilio from the business number.",
    requiredConfig: ["smsTo", "smsBody"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "SMS", connectorAction: "send_sms" }
  }),
  def({
    type: "action.send_whatsapp",
    label: "Send WhatsApp Message",
    category: "action",
    description: "Sends a WhatsApp text message via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_text" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      whatsappMessageType: "text",
      message: "Hello {{contact.name}}",
      mediaLink: "",
      mediaId: "",
      caption: "",
      filename: "",
      templateName: "",
      languageCode: "en_US"
    },
    capability: "whatsapp.send",
    requiredVariables: ["contact.phone"],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "communication.send_whatsapp",
    label: "Send WhatsApp Message",
    category: "action",
    description: "Sends a WhatsApp text message via Meta Cloud API (communication group).",
    requiredConfig: ["connectionId", "recipient"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_text" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{customer.phone}}",
      whatsappMessageType: "text",
      message: "Hello {{customer.name}}",
      mediaLink: "",
      mediaId: "",
      caption: "",
      filename: "",
      templateName: "",
      languageCode: "en_US"
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  // ---- WhatsApp media + template + read receipts (service supported) ----
  def({
    type: "action.send_whatsapp_image",
    label: "Send WhatsApp Image",
    category: "action",
    description: "Sends a WhatsApp image via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient", "mediaLink"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_media" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      mediaType: "image",
      mediaLink: "",
      caption: ""
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "action.send_whatsapp_pdf",
    label: "Send WhatsApp PDF",
    category: "action",
    description: "Sends a WhatsApp PDF (document) via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient", "mediaLink"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_media" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      mediaType: "document",
      mediaLink: "",
      filename: "",
      caption: ""
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "action.send_whatsapp_voice",
    label: "Send WhatsApp Voice",
    category: "action",
    description: "Sends a WhatsApp voice note (audio) via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient", "mediaLink"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_media" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      mediaType: "audio",
      mediaLink: "",
      caption: ""
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "action.send_whatsapp_video",
    label: "Send WhatsApp Video",
    category: "action",
    description: "Sends a WhatsApp video via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient", "mediaLink"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_media" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      mediaType: "video",
      mediaLink: "",
      caption: ""
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "action.send_whatsapp_template",
    label: "Send WhatsApp Template",
    category: "action",
    description: "Sends a WhatsApp template message via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient", "templateName"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_template" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      templateName: "",
      languageCode: "en_US",
      // Note: components are not currently used by the backend runner for template sending.
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "action.start_vapi_call",
    label: "Start Vapi Call",
    category: "action",
    description: "Starts a Vapi outbound AI voice call using business or env config.",
    requiredConfig: ["vapiAssistantId", "vapiPhoneNumberId"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Vapi", connectorAction: "start_voice_call" }
  }),
  def({
    type: "action.google_calendar_create_appointment",
    label: "Create Appointment",
    category: "action",
    description: "Creates a Google Calendar event on the business owner's calendar.",
    requiredConfig: ["calendarId", "appointmentService"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "Google Calendar",
      connectorAction: "book_appointment"
    }
  }),
  def({
    type: "action.save_lead",
    label: "Save Lead",
    category: "data",
    description: "Persists/updates the caller as a Lead for this business (idempotent).",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: CORE_CONNECTOR, connectorAction: CORE_CONNECTOR_ACTIONS.saveLead },
    defaultConfig: { leadSource: "WORKFLOW", leadStatus: "CAPTURED" }
  }),
  def({
    type: "action.save_conversation_message",
    label: "Save Conversation",
    category: "data",
    description: "Stores a conversation message (inbound/outbound/system) for the caller.",
    requiredConfig: ["conversationDirection"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: CORE_CONNECTOR,
      connectorAction: CORE_CONNECTOR_ACTIONS.saveConversationMessage
    },
    defaultConfig: { conversationDirection: "OUTBOUND", conversationBody: "{{sentSms.body}}" }
  }),
  def({
    type: "action.human_handoff",
    label: "Human Handoff",
    category: "action",
    description: "Escalates the lead to a human and records the handoff with a reason.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: CORE_CONNECTOR,
      connectorAction: CORE_CONNECTOR_ACTIONS.humanHandoff
    },
    defaultConfig: { handoffReason: "{{business.escalationRules}}" }
  }),
  def({
    type: "action.trigger_next_workflow",
    label: "Next Workflow",
    category: "action",
    description: "Runs another workflow, forwarding the current context (depth-capped, loop-safe).",
    requiredConfig: ["nextWorkflowId"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: CORE_CONNECTOR,
      connectorAction: CORE_CONNECTOR_ACTIONS.triggerNextWorkflow
    },
    defaultConfig: { nextWorkflowId: "" }
  }),
  def({
    type: "logic.condition",
    label: "Condition",
    category: "logic",
    description: "Evaluates a condition (e.g. business hours) and records the decision.",
    requiredConfig: ["condition"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "condition" }
  }),
  def({
    type: "output.result",
    label: "Output",
    category: "data",
    description: "Captures the final workflow result under a named key.",
    requiredConfig: ["outputKey"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "output" }
  }),

  // ---- Executable integrations (not launch-critical) ----
  def({
    type: "integration.gmail_read_emails",
    label: "Read Gmail Emails",
    category: "integration",
    description: "Reads the latest email matching a Gmail query.",
    requiredConfig: ["gmailQuery"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Gmail", connectorAction: "read_emails" }
  }),
  def({
    type: "integration.gmail_send_email",
    label: "Send Gmail Email",
    category: "integration",
    description: "Sends an email from the connected Gmail account.",
    requiredConfig: ["gmailTo", "gmailSubject", "gmailBody"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Gmail", connectorAction: "send_email" }
  }),
  def({
    type: "integration.gmail_create_draft",
    label: "Create Gmail Draft",
    category: "integration",
    description: "Creates a Gmail draft reply.",
    requiredConfig: ["gmailTo", "gmailSubject", "gmailBody"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Gmail", connectorAction: "draft_reply" }
  }),

  // ---- D. Voice-booking capability nodes (generic; reusable by any use case) ----
  // Normal platform nodes. A template (e.g. Dental AI Receptionist) imports them
  // with use-case values in node.data. Deploy builds the Vapi assistant + function
  // tools from these by capability; the Vapi webhook executes the tools at call time.
  def({
    type: VOICE_NODE_TYPES.phoneCallTrigger,
    label: "Phone Call Trigger",
    category: "trigger",
    description: "Starts when a customer calls the assigned Twilio number.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "trigger", connector: "Twilio" },
    defaultConfig: { callHandlingMode: "AI_ANSWERS", answerAfterRings: "1", forwardingSchedule: "always" },
    capability: "trigger.phone_call",
    requiredVariables: [],
    producedVariables: ["caller.phone", "caller.name", "call.time", "business.name", "business.type"]
  }),
  def({
    type: VOICE_NODE_TYPES.voiceConversation,
    label: "AI Voice Conversation",
    category: "ai",
    description: "Real-time voice conversation using Vapi / ElevenLabs / model config.",
    requiredConfig: ["systemPrompt"],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "ai", connector: "Vapi" },
    defaultConfig: {
      voice: PLATFORM_DEFAULT_VOICE_ID,
      voiceName: "Triven Default Voice",
      voiceProvider: DEFAULT_VOICE_PROVIDER,
      voiceId: "",
      assistantName: "",
      language: "en-US",
      speakingSpeed: "1.0",
      model: "gpt-4o-mini",
      firstMessage: "",
      fallbackResponse: "",
      systemPrompt: "",
      customInstructions: ""
    },
    capability: "ai.conversation",
    requiredVariables: [],
    producedVariables: ["ai.reply", "customer.name", "customer.phone", "service", "selected.slot"]
  }),
  def({
    type: VOICE_NODE_TYPES.calendarAvailability,
    label: "Calendar Availability",
    category: "integration",
    description: "Check open Google Calendar slots.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "Google Calendar",
      connectorAction: VOICE_TOOL_NAMES.checkAvailability
    },
    defaultConfig: { bufferMinutes: "10", maxAdvanceDays: "30", slotsToOffer: "3" },
    capability: "calendar.check_availability",
    requiredVariables: [],
    producedVariables: ["calendar.available_slots", "calendar.requested_date", "calendar.timezone"]
  }),
  def({
    type: VOICE_NODE_TYPES.bookAppointment,
    label: "Book Calendar Appointment",
    category: "integration",
    description: "Create a Google Calendar event.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "Google Calendar",
      connectorAction: VOICE_TOOL_NAMES.bookAppointment
    },
    defaultConfig: {
      eventTitleFormat: "[Service] - [Customer Name]",
      eventDescription: "Phone: [Customer Phone]\nBooked by AI\nService: [Service]",
      reminderEnabled: "true",
      reminderTiming: "120",
      confirmationMessage: "You're all set for [Service] on [Date] at [Time]."
    },
    capability: "calendar.book_appointment",
    requiredVariables: ["customer.name", "customer.phone", "selected.slot", "service"],
    producedVariables: [
      "appointment.status",
      "appointment.confirmation_id",
      "appointment.date",
      "appointment.time",
      "appointment.calendar_event_id"
    ]
  }),
  def({
    type: VOICE_NODE_TYPES.sendSms,
    label: "Send SMS",
    category: "action",
    description:
      "Optional add-on: send SMS to the customer and/or team via Twilio. May require A2P/10DLC registration — for MVP use Send Email instead.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "SMS",
      connectorAction: VOICE_TOOL_NAMES.sendNotification
    },
    defaultConfig: {
      sendToCustomer: "true",
      customerTemplate: "",
      sendToTeam: "false",
      teamTemplate: ""
    },
    capability: "sms.send",
    requiredVariables: ["customer.phone"],
    producedVariables: ["sms.status", "sms.body"]
  }),
  def({
    type: VOICE_NODE_TYPES.sendEmail,
    label: "Send Email",
    category: "action",
    description: "Send confirmations, follow-ups, and internal notifications from the buyer's Triven proxy email.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "EMAIL",
      connectorAction: VOICE_TOOL_NAMES.sendNotification
    },
    defaultConfig: {
      recipientType: "customer",
      customRecipient: "",
      recipientVariable: "",
      ccTemplate: "",
      bccTemplate: "",
      subjectTemplate: "",
      bodyTemplate: "",
      htmlTemplate: "",
      purpose: "auto",
      includeCallSummary: "false",
      includeBookingDetails: "true",
      continueOnFailure: "true",
      fallbackBehavior: "skip"
    },
    capability: "email.send",
    requiredVariables: [],
    producedVariables: ["email.status", "email.subject"]
  }),
  def({
    type: VOICE_NODE_TYPES.endFlow,
    label: "End Flow",
    category: "logic",
    description: "Ends the conversation/flow with a closing message.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "output" },
    defaultConfig: {
      closingMessage: "",
      afterCallAction: "hangup",
      callRecording: "true"
    },
    capability: "flow.end",
    requiredVariables: [],
    producedVariables: ["flow.status", "flow.closing_message"]
  }),

  // ---- B. Near-term marketplace nodes (coming soon) ----
  def({ type: "trigger.manual", label: "Input", category: "trigger", description: "Start a workflow manually.", requiredConfig: [], backendExecutable: true, launchCritical: false, comingSoon: false, runtime: { nodeKind: "trigger" } }),
  def({ type: "trigger.webhook", label: "Webhook Trigger", category: "trigger", description: "Start from an inbound webhook.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "trigger" } }),
  def({ type: "trigger.schedule", label: "Schedule Trigger", category: "trigger", description: "Start on a schedule.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "trigger" } }),
  def({ type: "trigger.gmail_new_email", label: "Gmail New Email", category: "trigger", description: "Start when a new email arrives.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "trigger" } }),
  def({ type: "action.google_calendar_availability", label: "Calendar Availability", category: "action", description: "Check open slots before booking.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "connector", connector: "Google Calendar", connectorAction: "check_availability" } }),
  def({ type: "action.http_request", label: "HTTP Request", category: "action", description: "Call an external API.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "connector", connector: "HTTP", connectorAction: "request" } }),
  def({ type: "action.delay", label: "Delay / Wait", category: "logic", description: "Wait before the next step.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "condition" } }),
  def({ type: "action.data_transform", label: "Data Transform", category: "data", description: "Map/transform data between steps.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "condition" } }),
  def({ type: "logic.switch", label: "Switch / Router", category: "logic", description: "Route to multiple branches.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "condition" } }),
  def({ type: "action.update_lead", label: "Update Lead", category: "data", description: "Update an existing lead's fields.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "connector", connector: CORE_CONNECTOR, connectorAction: "update_lead" } }),
  def({ type: "action.create_task", label: "Create Task", category: "action", description: "Create a task/reminder.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "connector", connector: CORE_CONNECTOR, connectorAction: "create_task" } }),
  def({ type: "action.slack_notify", label: "Slack Notification", category: "integration", description: "Notify a Slack channel.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "connector", connector: "Slack", connectorAction: "notify" } }),

  // ---- C. Later advanced nodes (coming soon) ----
  def({ type: "trigger.stripe_payment", label: "Stripe Payment", category: "trigger", description: "Start on a Stripe payment event.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "trigger" } }),
  def({ type: "trigger.subscription_status", label: "Subscription Status", category: "trigger", description: "Start on a subscription change.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "trigger" } }),
  def({ type: "integration.crm", label: "CRM Connector", category: "integration", description: "Sync with an external CRM.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "connector", connector: "CRM", connectorAction: "sync" } }),
  def({ type: "ai.knowledge_base_search", label: "Knowledge Base Search", category: "ai", description: "RAG search over the knowledge base.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "ai" } }),
  def({ type: "action.file_parse", label: "File Upload / Parse", category: "data", description: "Parse an uploaded file.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "connector", connector: "Files", connectorAction: "parse" } }),
  def({ type: "action.multi_agent_handoff", label: "Multi-Agent Handoff", category: "action", description: "Hand off to another agent.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "connector", connector: CORE_CONNECTOR, connectorAction: "multi_agent_handoff" } }),
  def({ type: "action.analytics_event", label: "Analytics Event", category: "data", description: "Track an analytics event.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "connector", connector: "Analytics", connectorAction: "track" } }),
  def({ type: "logic.error_handler", label: "Error Handler", category: "logic", description: "Fallback workflow on error.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "condition" } }),
  def({ type: "logic.ab_test", label: "A/B Test", category: "logic", description: "Split traffic between variants.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "condition" } })
];

/** Template variables allowed in Send Email subject/body templates (shared by builder UI and send-time rendering). */
export const EMAIL_TEMPLATE_VARIABLES = [
  "customerName",
  "customerEmail",
  "businessName",
  "appointmentDate",
  "appointmentTime",
  "businessPhone",
  "businessAddress",
  "callSummary",
  "serviceName"
] as const;

/** Reusable connector-requirement descriptors (single source so nodes stay DRY). */
const REQ = {
  googleCalendarRead: {
    connector: "google_calendar",
    label: "Google Calendar",
    ownedBy: "buyer",
    scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    note: "Requires the buyer to connect their Google Calendar (read availability)."
  },
  googleCalendarWrite: {
    connector: "google_calendar",
    label: "Google Calendar",
    ownedBy: "buyer",
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    note: "Requires the buyer to connect their Google Calendar (create events)."
  },
  gmailRead: {
    connector: "gmail",
    label: "Google account",
    ownedBy: "buyer",
    note: "Legacy Gmail node — no longer supported. Google connect grants calendar access only."
  },
  gmailSend: {
    connector: "gmail",
    label: "Google account",
    ownedBy: "buyer",
    note: "Legacy Gmail node — no longer supported. Use the platform Send Email node instead."
  },
  gmailCompose: {
    connector: "gmail",
    label: "Google account",
    ownedBy: "buyer",
    note: "Legacy Gmail node — no longer supported. Use the platform Send Email node instead."
  },
  twilioSms: {
    connector: "twilio",
    label: "Text messaging (SMS)",
    ownedBy: "buyer",
    config: ["senderNumber"],
    note: "Text messaging is included — Triven manages the SMS sender."
  },
  phoneProvider: {
    connector: "phone_provider",
    label: "Phone number / routing",
    ownedBy: "buyer",
    config: ["assignedNumber", "forwarding"],
    note: "Buyer sets up phone routing and the assigned number during install."
  },
  vapi: {
    connector: "vapi",
    label: "Triven voice engine",
    ownedBy: "platform",
    note: "Runs on the Triven AI voice platform — nothing for you to set up."
  },
  elevenlabs: {
    connector: "elevenlabs",
    label: "Premium voice",
    ownedBy: "platform",
    optional: true,
    note: "Optional premium voice delivered through the Triven voice platform."
  },
  trivenMail: {
    connector: "triven_mail",
    label: "Triven proxy email",
    ownedBy: "platform",
    config: ["emailAlias", "forwardToEmail"],
    note: "Sends from the buyer's <alias>@reply.triven.ai proxy address — the buyer picks the alias in Mail Setup."
  },
  whatsapp: {
    connector: "whatsapp",
    label: "WhatsApp Business",
    ownedBy: "platform",
    config: ["connectionId"],
    note: "Architect connects a Meta Cloud API WhatsApp number under Integrations → WhatsApp."
  }
} satisfies Record<string, ConnectorRequirement>;

/**
 * Connector requirements per node type. Keyed by the node's `data.type` slug.
 * `getNodeDefinition` attaches these so consumers read them off the definition;
 * `requiredConnectorsForWorkflow` aggregates them across a workflow.
 */
export const REQUIRED_CONNECTORS_BY_TYPE: Record<string, ConnectorRequirement[]> = {
  "trigger.twilio_missed_call": [REQ.phoneProvider],
  "trigger.twilio_inbound_sms": [REQ.twilioSms],
  "trigger.whatsapp_message_received": [REQ.whatsapp],
  "trigger.vapi_tool_call": [REQ.vapi],
  "action.send_sms": [REQ.twilioSms],
  "action.send_whatsapp": [REQ.whatsapp],
  "communication.send_whatsapp": [REQ.whatsapp],
  "action.start_vapi_call": [REQ.vapi],
  "action.google_calendar_create_appointment": [REQ.googleCalendarWrite],
  "action.google_calendar_availability": [REQ.googleCalendarRead],
  "integration.gmail_read_emails": [REQ.gmailRead],
  "integration.gmail_send_email": [REQ.gmailSend],
  "integration.gmail_create_draft": [REQ.gmailCompose],
  "trigger.gmail_new_email": [REQ.gmailRead],
  [VOICE_NODE_TYPES.phoneCallTrigger]: [REQ.phoneProvider],
  [VOICE_NODE_TYPES.voiceConversation]: [REQ.vapi, REQ.elevenlabs],
  [VOICE_NODE_TYPES.calendarAvailability]: [REQ.googleCalendarRead],
  [VOICE_NODE_TYPES.bookAppointment]: [REQ.googleCalendarWrite],
  [VOICE_NODE_TYPES.sendSms]: [REQ.twilioSms],
  [VOICE_NODE_TYPES.sendEmail]: [REQ.trivenMail]
};

/** Connector requirements declared by a single node type (empty when none). */
export function requiredConnectorsForType(type: string): ConnectorRequirement[] {
  return REQUIRED_CONNECTORS_BY_TYPE[type] ?? [];
}

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  const base = NODE_DEFINITIONS.find((node) => node.type === type);
  if (!base) return undefined;
  return { ...base, requiredConnectors: requiredConnectorsForType(type) };
}

function workflowNodeList(workflowJson: unknown): Array<Record<string, unknown>> {
  const nodes = (workflowJson as { nodes?: unknown } | null | undefined)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((node): node is Record<string, unknown> => typeof node === "object" && node !== null);
}

/** A workflow node's registry type slug — prefers `data.type`, falls back to `type`. */
function workflowNodeType(node: Record<string, unknown>): string {
  const data = node.data;
  if (typeof data === "object" && data !== null) {
    const type = (data as Record<string, unknown>).type;
    if (typeof type === "string" && type) return type;
  }
  return typeof node.type === "string" ? node.type : "";
}

/**
 * Aggregate the unique connectors a whole workflow needs (deduped by connector
 * key). Used to stamp `AgentListing.requiredConnectors` at publish and to drive
 * the buyer install checklist. Accepts a `{ nodes }` workflowJson value.
 */
export function requiredConnectorsForWorkflow(workflowJson: unknown): ConnectorRequirement[] {
  const seen = new Map<string, ConnectorRequirement>();
  for (const node of workflowNodeList(workflowJson)) {
    for (const requirement of requiredConnectorsForType(workflowNodeType(node))) {
      if (!seen.has(requirement.connector)) seen.set(requirement.connector, requirement);
    }
  }
  return Array.from(seen.values());
}

/** The connector keys a workflow needs, e.g. ["google_calendar","twilio","vapi"]. */
export function requiredConnectorKeys(workflowJson: unknown): string[] {
  return requiredConnectorsForWorkflow(workflowJson).map((requirement) => requirement.connector);
}

export function launchCriticalNodes(): NodeDefinition[] {
  return NODE_DEFINITIONS.filter((node) => node.launchCritical);
}

export function comingSoonNodes(): NodeDefinition[] {
  return NODE_DEFINITIONS.filter((node) => node.comingSoon);
}

/** True when (connector, connectorAction) is a Triven platform action. */
export function isCoreConnectorAction(value: string): value is CoreConnectorAction {
  return (Object.values(CORE_CONNECTOR_ACTIONS) as string[]).includes(value);
}

/** The voice-booking capability node definitions, in canvas order. */
export function voiceNodes(): NodeDefinition[] {
  const order = Object.values(VOICE_NODE_TYPES) as string[];
  return order
    .map((type) => getNodeDefinition(type))
    .filter((node): node is NodeDefinition => Boolean(node));
}

/** True when a workflow node type is one of the voice-booking capability nodes. */
export function isVoiceNodeType(type: string): boolean {
  return (Object.values(VOICE_NODE_TYPES) as string[]).includes(type);
}

/** Builder presentation (icon/accent/kind) per voice node so template nodes look like dragged nodes. */
export const VOICE_NODE_PRESENTATION: Record<string, { kind: string; icon: string; accent: string }> = {
  [VOICE_NODE_TYPES.phoneCallTrigger]: { kind: "TWILIO", icon: "phone", accent: "amber" },
  [VOICE_NODE_TYPES.voiceConversation]: { kind: "VAPI · GPT-4o Mini", icon: "sparkles", accent: "violet" },
  [VOICE_NODE_TYPES.calendarAvailability]: { kind: "CALENDAR", icon: "calendar", accent: "blue" },
  [VOICE_NODE_TYPES.bookAppointment]: { kind: "CALENDAR", icon: "calendar", accent: "blue" },
  [VOICE_NODE_TYPES.sendSms]: { kind: "TWILIO SMS", icon: "message", accent: "green" },
  [VOICE_NODE_TYPES.sendEmail]: { kind: "TRIVEN MAIL", icon: "mail", accent: "green" },
  [VOICE_NODE_TYPES.endFlow]: { kind: "END FLOW", icon: "capture", accent: "slate" },
  "trigger.whatsapp_message_received": { kind: "WHATSAPP", icon: "whatsapp", accent: "green" },
  "action.send_whatsapp": { kind: "WHATSAPP", icon: "whatsapp", accent: "green" },
  "communication.send_whatsapp": { kind: "WHATSAPP", icon: "whatsapp", accent: "green" }
};

/**
 * Build the generic 6-node voice-booking workflow JSON (nodes + edges) from the
 * registry. Templates import this and overlay use-case values in node.data; the
 * nodes are the same reusable platform nodes a user can drag manually.
 */
export function buildVoiceBookingWorkflow(): {
  nodes: Array<{ id: string; type: "coreNode"; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
} {
  // Template chain uses the email-first order — SMS stays a manual add-on node.
  const defs = VOICE_TEMPLATE_NODE_ORDER.map((type) => getNodeDefinition(type)).filter(
    (node): node is NodeDefinition => Boolean(node)
  );
  const nodes = defs.map((def, index) => ({
    id: def.type,
    type: "coreNode" as const,
    position: { x: 80 + index * 280, y: 300 },
    data: {
      type: def.type,
      nodeKind: def.runtime.nodeKind,
      connector: def.runtime.connector,
      connectorAction: def.runtime.connectorAction,
      label: def.label,
      title: def.label,
      subtitle: def.description,
      ...(VOICE_NODE_PRESENTATION[def.type] ?? {}),
      ...(def.defaultConfig ?? {})
    }
  }));

  const edges = defs.slice(1).map((def, index) => ({
    id: `voice-e${index + 1}`,
    source: defs[index].type,
    target: def.type
  }));

  return { nodes, edges };
}

type TemplateWorkflowNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

type TemplateWorkflowEdge = {
  id: string;
  source: string;
  target: string;
};

/**
 * Reset a builder node to registry defaults for template gallery storage.
 * Keeps graph identity (id/position/type) and presentation fields, but drops
 * architect-filled values (connection IDs, custom prompts, recipients, etc.).
 */
export function nodeDataForTemplate(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const source: Record<string, unknown> = data && typeof data === "object" ? data : {};
  const type = typeof source.type === "string" ? source.type : "";
  const def = type ? getNodeDefinition(type) : undefined;
  const presentation = type ? VOICE_NODE_PRESENTATION[type] : undefined;
  const nodeKind =
    def?.runtime.nodeKind ?? (typeof source.nodeKind === "string" ? source.nodeKind : "connector");
  const fallbackKind = (def?.label || type || "NODE").toUpperCase();
  const existingKind = typeof source.kind === "string" ? source.kind : "";
  const kind = existingKind || presentation?.kind || fallbackKind;
  const existingLabel = typeof source.label === "string" ? source.label : "";
  const existingTitle = typeof source.title === "string" ? source.title : "";
  const existingSubtitle = typeof source.subtitle === "string" ? source.subtitle : "";
  const existingIcon = typeof source.icon === "string" ? source.icon : "";
  const existingAccent = typeof source.accent === "string" ? source.accent : "";

  return {
    type,
    nodeKind,
    kind,
    label: existingLabel || def?.label || type || "Node",
    title: existingTitle || def?.label || type || "Node",
    subtitle: def?.description || existingSubtitle,
    icon: presentation?.icon || existingIcon || "message",
    accent: presentation?.accent || existingAccent || "slate",
    ...(def?.runtime.connector ? { connector: def.runtime.connector } : {}),
    ...(def?.runtime.connectorAction ? { connectorAction: def.runtime.connectorAction } : {}),
    ...(def?.defaultConfig ?? {})
  };
}

/**
 * Build template-safe workflow JSON: same nodes/edges topology, no filled config values.
 */
export function workflowJsonForTemplate(workflowJson: unknown): {
  nodes: TemplateWorkflowNode[];
  edges: TemplateWorkflowEdge[];
} {
  if (!workflowJson || typeof workflowJson !== "object") {
    return { nodes: [], edges: [] };
  }

  const graph = workflowJson as { nodes?: unknown; edges?: unknown };
  const nodesIn = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edgesIn = Array.isArray(graph.edges) ? graph.edges : [];

  const nodes: TemplateWorkflowNode[] = nodesIn.map((raw, index) => {
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const id = typeof record.id === "string" && record.id ? record.id : `node-${index + 1}`;
    const positionRecord =
      record.position && typeof record.position === "object"
        ? (record.position as Record<string, unknown>)
        : null;
    const position = {
      x: typeof positionRecord?.x === "number" ? positionRecord.x : 80 + index * 280,
      y: typeof positionRecord?.y === "number" ? positionRecord.y : 300
    };
    const data =
      record.data && typeof record.data === "object"
        ? (record.data as Record<string, unknown>)
        : {};

    return {
      id,
      type: typeof record.type === "string" && record.type ? record.type : "coreNode",
      position,
      data: nodeDataForTemplate(data)
    };
  });

  const edges: TemplateWorkflowEdge[] = [];
  edgesIn.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const record = raw as Record<string, unknown>;
    if (typeof record.source !== "string" || typeof record.target !== "string") return;
    edges.push({
      id: typeof record.id === "string" && record.id ? record.id : `e${index + 1}`,
      source: record.source,
      target: record.target
    });
  });

  return { nodes, edges };
}
