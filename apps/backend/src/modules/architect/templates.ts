import { buildVoiceBookingWorkflow, getNodeDefinition, VOICE_NODE_TYPES } from "@coreai/shared";

/**
 * Template gallery — static seed (no DB migration for MVP), still served over the
 * API so the frontend never hardcodes templates. A template is ONLY metadata +
 * workflowJson (nodes + edges + node.data). "Use" clones the workflowJson into a
 * WorkflowDefinition; deploy/runtime read only node.data, never a template flag.
 */

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
    edges: Array<{ id: string; source: string; target: string }>;
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

/**
 * Dental AI Receptionist = the generic 6-node voice-booking workflow with dental
 * values overlaid into node.data only. No special node types or flags — a user
 * could drag the same nodes and type these values manually.
 */
function buildDentalReceptionistWorkflow() {
  const base = buildVoiceBookingWorkflow();
  const overrides: Record<string, Record<string, string>> = {
    [VOICE_NODE_TYPES.phoneCallTrigger]: { callHandlingMode: "AI_ANSWERS" },
    [VOICE_NODE_TYPES.voiceConversation]: {
      practiceName: "Triven Dental Care",
      doctorName: "Dr. Patel",
      practiceHours: "Mon–Fri 9:00 AM–5:00 PM",
      services: "Cleaning 45min, Filling 30min, Crown 60min, Emergency 30min",
      firstMessage: "Good morning, Triven Dental Care, this is Sarah. How can I help you?",
      fallbackResponse: "Let me have the doctor's team call you back within 30 minutes.",
      customInstructions: [
        "New patients should be offered a 60-minute first visit and asked for their full name and a callback number.",
        "For tooth pain, swelling, or bleeding, treat it as urgent — offer the soonest available slot or escalate to the on-call dentist.",
        "We accept most major insurance. If asked about coverage, take the patient's provider name and tell them the team will confirm.",
        "Never quote exact prices; give a general range and offer to have the team follow up with details.",
        "Free parking is available behind the building.",
        "Always repeat the chosen date and time back to the patient to confirm before booking."
      ].join("\n")
    },
    [VOICE_NODE_TYPES.bookAppointment]: {
      eventTitleFormat: "[Service] - [Patient Name]",
      confirmationMessage: "Perfect, you're all set for [Service] on [Date] at [Time] with [Doctor Name]."
    },
    [VOICE_NODE_TYPES.sendSms]: {
      sendToDentist: "true",
      patientTemplate: "Confirmed: [Service] with [Doctor Name], [Date] at [Time]. Reply C to cancel.",
      dentistTemplate: "New booking: [Patient Name], [Date] [Time], [Service]. Phone: [Patient Phone]"
    },
    [VOICE_NODE_TYPES.endFlow]: {
      closingMessage: "You're all set! Have a wonderful day.",
      callRecording: "true"
    }
  };
  const nodes = base.nodes.map((node) => {
    const type = String(node.data.type ?? "");
    return { ...node, data: { ...node.data, ...(overrides[type] ?? {}) } };
  });
  return { nodes, edges: base.edges };
}

const SEED: Array<Omit<WorkflowTemplate, "nodeCount" | "status" | "createdAt" | "updatedAt">> = [
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
    id: "tpl-missed-call",
    slug: "missed-call-text-back",
    title: "Missed Call Text-Back",
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
