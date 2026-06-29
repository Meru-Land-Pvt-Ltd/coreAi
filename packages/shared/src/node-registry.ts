/**
 * Single source of truth for workflow node kinds shared by the frontend builder
 * and the backend runner so the two cannot drift.
 *
 * - `runtime` maps each node to how the backend runner dispatches it
 *   (nodeKind + connector + connectorAction).
 * - `backendExecutable` marks whether the runner actually performs work.
 * - `comingSoon` nodes are shown in the builder but must NOT be added to a
 *   publishable/executable workflow.
 */

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
  /** Default builder config applied when the node is dropped on the canvas. */
  defaultConfig?: Record<string, string>;
};

/** The CoreAI connector groups platform actions executed directly by the runner. */
export const CORE_CONNECTOR = "CoreAI";

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

/**
 * Generic voice-booking capability nodes — Phone Call Trigger → AI Voice
 * Conversation → Calendar Availability → Book Calendar Appointment → Send SMS →
 * End Flow. These are normal reusable platform nodes (draggable by anyone); the
 * Dental AI Receptionist is just a TEMPLATE that imports them with dental values
 * in node.data. Deploy builds the Vapi assistant + tools from these by capability;
 * they are not executed by the SMS workflow-runner for live calls.
 */
export const VOICE_NODE_TYPES = {
  phoneCallTrigger: "trigger.phone_call",
  voiceConversation: "ai.voice_conversation",
  calendarAvailability: "calendar.availability",
  bookAppointment: "calendar.book_appointment",
  sendSms: "communication.send_sms",
  endFlow: "flow.end"
} as const;

/** Vapi function-tool names the deployed assistant calls back into our webhook. */
export const VOICE_TOOL_NAMES = {
  checkAvailability: "check_availability",
  bookAppointment: "book_appointment",
  sendNotification: "send_notification"
} as const;

/**
 * Default Vapi system prompt for the AI Voice Conversation node. Token-parameterized
 * ({{practice_name}}, {{doctor_name}}, …) so it works for any business; the values
 * come from node.data and are injected at deploy/call time.
 */
export const RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE = `You are {{assistantName}}, the AI receptionist for {{practice_name}}. You work for {{doctor_name}}.

Your job: Answer patient calls, help them book appointments, and provide basic practice info.

PRACTICE DETAILS:
- Name: {{practice_name}}
- Doctor: {{doctor_name}}
- Hours: {{practice_hours}}
- Services: {{services_list}}

RULES:
1. Always be warm, friendly, and professional.
2. When a patient wants to book, call the check_availability function first.
3. Offer the available slots and let the patient choose.
4. After they choose, call book_appointment to confirm.
5. After booking, call send_notification to send SMS confirmations.
6. If you cannot help with something, say: "{{fallback_response}}"
7. Never make up availability. Always check the calendar.
8. Never provide medical advice.
9. If it's an emergency, advise them to call 911 or go to the nearest ER.

CUSTOM INSTRUCTIONS:
{{special_instructions}}

CONVERSATION STYLE:
- Keep responses short (1-2 sentences max)
- Sound natural, not robotic
- Use the patient's name after they give it
- Confirm details by repeating them back`;

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
    defaultConfig: { callHandlingMode: "AI_ANSWERS", answerAfterRings: "1", forwardingSchedule: "always" }
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
      voice: "sarah",
      assistantName: "Sarah",
      language: "en-US",
      speakingSpeed: "1.0",
      model: "gpt-4o",
      firstMessage: "Thanks for calling. This is your AI receptionist — how can I help you today?",
      practiceName: "",
      doctorName: "",
      practiceHours: "",
      services: "",
      fallbackResponse: "Let me take a message and have someone call you back shortly.",
      systemPrompt: RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE,
      customInstructions: ""
    }
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
    defaultConfig: { bufferMinutes: "10", maxAdvanceDays: "30", slotsToOffer: "3" }
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
    }
  }),
  def({
    type: VOICE_NODE_TYPES.sendSms,
    label: "Send SMS",
    category: "action",
    description: "Send SMS to the customer and/or team via Twilio.",
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
      sendToPatient: "true",
      patientTemplate: "Confirmed: [Service] on [Date] at [Time].",
      sendToDentist: "false",
      dentistPhone: "",
      dentistTemplate: "New booking: [Customer Name], [Date] [Time], [Service]. Phone: [Customer Phone]"
    }
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
      closingMessage: "You're all set. Have a great day.",
      afterCallAction: "hangup",
      callRecording: "true"
    }
  }),

  // ---- B. Near-term marketplace nodes (coming soon) ----
  def({ type: "trigger.manual", label: "Manual Trigger", category: "trigger", description: "Start a workflow manually.", requiredConfig: [], backendExecutable: false, launchCritical: false, comingSoon: true, runtime: { nodeKind: "trigger" } }),
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

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return NODE_DEFINITIONS.find((node) => node.type === type);
}

export function launchCriticalNodes(): NodeDefinition[] {
  return NODE_DEFINITIONS.filter((node) => node.launchCritical);
}

export function comingSoonNodes(): NodeDefinition[] {
  return NODE_DEFINITIONS.filter((node) => node.comingSoon);
}

/** True when (connector, connectorAction) is a CoreAI platform action. */
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
  [VOICE_NODE_TYPES.voiceConversation]: { kind: "VAPI · GPT-4o", icon: "sparkles", accent: "violet" },
  [VOICE_NODE_TYPES.calendarAvailability]: { kind: "CALENDAR", icon: "calendar", accent: "blue" },
  [VOICE_NODE_TYPES.bookAppointment]: { kind: "CALENDAR", icon: "calendar", accent: "blue" },
  [VOICE_NODE_TYPES.sendSms]: { kind: "TWILIO SMS", icon: "message", accent: "green" },
  [VOICE_NODE_TYPES.endFlow]: { kind: "END FLOW", icon: "capture", accent: "slate" }
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
  const defs = voiceNodes();
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
