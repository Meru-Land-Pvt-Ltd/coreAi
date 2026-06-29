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
 * The 6 fixed nodes of the Dental AI Receptionist, built in the drag-and-drop
 * builder and deployed as a live Vapi voice agent. Unlike the SMS launch-critical
 * nodes, these are NOT executed by the workflow-runner — they configure a Vapi
 * assistant (Node 2) plus its function tools (Nodes 3-5), consumed at Deploy time
 * and at call time by the Vapi webhook.
 */
export const DENTAL_NODE_TYPES = {
  incomingPhoneCall: "trigger.incoming_phone_call",
  aiConversation: "ai.ai_conversation",
  checkCalendar: "action.check_calendar",
  bookAppointment: "action.book_appointment",
  sendSmsNotification: "action.send_sms_notification",
  endCall: "action.end_call"
} as const;

/** Vapi function-tool names the deployed assistant calls back into our webhook. */
export const DENTAL_TOOL_NAMES = {
  checkAvailability: "check_availability",
  bookAppointment: "book_appointment",
  sendNotification: "send_notification"
} as const;

/**
 * Pre-filled Vapi system prompt for Node 2 (AI Conversation). `{{custom...}}`
 * style tokens are Vapi variableValues injected per business at call time; the
 * Custom Instructions field is spliced in at {{special_instructions}}.
 */
export const DENTAL_SYSTEM_PROMPT_TEMPLATE = `You are {{assistantName}}, the AI receptionist for {{practice_name}}. You work for {{doctor_name}}.

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
    label: "Twilio Missed Call",
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
    label: "Twilio Inbound SMS",
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
    label: "AI Context Reply",
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

  // ---- D. Dental AI Receptionist (built in the builder, deployed as a live Vapi voice agent) ----
  // These 6 nodes are NOT run by the workflow-runner. The Deploy endpoint reads
  // their config to build a Vapi assistant + function tools; the Vapi webhook
  // executes the tools at call time. backendExecutable=false reflects that the
  // SMS runner does not execute them.
  def({
    type: DENTAL_NODE_TYPES.incomingPhoneCall,
    label: "Incoming Phone Call",
    category: "trigger",
    description: "Patient calls the assigned Twilio number; the call is answered live by the AI.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "trigger", connector: "Twilio" },
    defaultConfig: { answerAfterRings: "1", forwardingSchedule: "always" }
  }),
  def({
    type: DENTAL_NODE_TYPES.aiConversation,
    label: "AI Conversation",
    category: "ai",
    description: "Vapi + ElevenLabs + GPT-4o voice conversation driven by your custom instructions.",
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
      firstMessage: "Good day, thanks for calling {{practice_name}}. This is Sarah, how can I help you?",
      practiceName: "",
      doctorName: "",
      practiceHours: "",
      services: "Cleaning (45m), Filling (30m), Crown (60m), Emergency (30m)",
      fallbackResponse: "Let me have the doctor's team call you back within 30 minutes.",
      systemPrompt: DENTAL_SYSTEM_PROMPT_TEMPLATE,
      customInstructions: ""
    }
  }),
  def({
    type: DENTAL_NODE_TYPES.checkCalendar,
    label: "Check Calendar",
    category: "action",
    description: "Vapi tool check_availability: returns open Google Calendar slots.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "Google Calendar",
      connectorAction: DENTAL_TOOL_NAMES.checkAvailability
    },
    defaultConfig: { bufferMinutes: "10", maxAdvanceDays: "30", slotsToOffer: "3" }
  }),
  def({
    type: DENTAL_NODE_TYPES.bookAppointment,
    label: "Book Appointment",
    category: "action",
    description: "Vapi tool book_appointment: creates the Google Calendar event.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "Google Calendar",
      connectorAction: DENTAL_TOOL_NAMES.bookAppointment
    },
    defaultConfig: {
      eventTitleFormat: "[Service] - [Patient Name]",
      eventDescription: "Phone: [Patient Phone]\nBooked by: Triven AI\nService: [Service]",
      reminderEnabled: "true",
      reminderTiming: "120",
      confirmationMessage: "Perfect, you're all set for [Service] on [Date] at [Time] with [Doctor Name]."
    }
  }),
  def({
    type: DENTAL_NODE_TYPES.sendSmsNotification,
    label: "Send SMS Notification",
    category: "action",
    description: "Vapi tool send_notification: texts the patient and the dentist after booking.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "SMS",
      connectorAction: DENTAL_TOOL_NAMES.sendNotification
    },
    defaultConfig: {
      sendToPatient: "true",
      patientTemplate: "Confirmed: [Service] with [Doctor Name], [Date] at [Time]. Reply C to cancel.",
      sendToDentist: "true",
      dentistPhone: "",
      dentistTemplate: "New booking: [Patient Name], [Date] [Time], [Service]. Phone: [Patient Phone]"
    }
  }),
  def({
    type: DENTAL_NODE_TYPES.endCall,
    label: "End Call",
    category: "action",
    description: "Closes the conversation with a goodbye message and after-call action.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "output" },
    defaultConfig: {
      closingMessage: "You're all set! Have a wonderful day.",
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

/** The 6 Dental AI Receptionist node definitions, in canvas order. */
export function dentalNodes(): NodeDefinition[] {
  const order = Object.values(DENTAL_NODE_TYPES) as string[];
  return order
    .map((type) => getNodeDefinition(type))
    .filter((node): node is NodeDefinition => Boolean(node));
}

/** True when a workflow type slug is one of the 6 dental nodes. */
export function isDentalNodeType(type: string): boolean {
  return (Object.values(DENTAL_NODE_TYPES) as string[]).includes(type);
}

/**
 * Build the 6-node Dental AI Receptionist workflow JSON (nodes + edges) used by
 * the builder's "Dental AI Receptionist" template and as the deploy default.
 * Each node's `data` is seeded from its registry defaultConfig so the config
 * panels and the Deploy endpoint read the same fields.
 */
export function buildDentalReceptionistWorkflow(): {
  nodes: Array<{ id: string; type: "coreNode"; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
} {
  const defs = dentalNodes();
  const nodes = defs.map((def, index) => ({
    id: def.type,
    type: "coreNode" as const,
    position: { x: 120 + index * 260, y: 160 },
    data: {
      type: def.type,
      nodeKind: def.runtime.nodeKind,
      connector: def.runtime.connector,
      connectorAction: def.runtime.connectorAction,
      label: def.label,
      title: def.label,
      description: def.description,
      ...(def.defaultConfig ?? {})
    }
  }));

  const edges = defs.slice(1).map((def, index) => ({
    id: `dental-e${index + 1}`,
    source: defs[index].type,
    target: def.type
  }));

  return { nodes, edges };
}
