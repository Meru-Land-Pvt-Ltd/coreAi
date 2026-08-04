import { getNodeDefinition } from "./node-registry";

export type AgentPricingModel = "free" | "one_time" | "subscription";

export type AgentReviewStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "changes_requested";

export type AgentPublishStatus = "draft" | "in_review" | "published" | "unpublished";

export type RequiredIntegrationKey =
  | "phone"
  | "sms"
  | "calendar"
  | "email"
  | "crm"
  | "webhook"
  | "telegram"
  | "vapi"
  | "twilio"
  | "whatsapp";

export type RequiredIntegrations = Record<RequiredIntegrationKey, boolean>;

export type RequiredIntegrationDef = {
  key: RequiredIntegrationKey;
  label: string;
  description: string;
};

// Display order: the MVP follow-up channel is Email, so it leads; SMS sits
// after telephony and is only surfaced when a workflow actually sends SMS.
export const REQUIRED_INTEGRATION_DEFS: RequiredIntegrationDef[] = [
  { key: "phone", label: "Phone number", description: "A line to receive and place calls" },
  {
    key: "email",
    label: "Email proxy",
    description: "Send confirmations, follow-ups, and internal notifications using the buyer's proxy email"
  },
  { key: "calendar", label: "Calendar access", description: "To read and book appointments" },
  { key: "vapi", label: "AI voice (Vapi)", description: "AI voice conversations with callers" },
  { key: "twilio", label: "Telephony (Twilio)", description: "Call forwarding and missed-call detection" },
  { key: "sms", label: "SMS messaging", description: "Send and receive text messages" },
  { key: "whatsapp", label: "WhatsApp Business", description: "Send and receive WhatsApp messages via Meta Cloud API" },
  {
    key: "telegram",
    label: "Telegram bot",
    description: "A dedicated customer bot created for each installed business"
  },
  { key: "crm", label: "CRM connection", description: "Sync captured leads automatically" },
  { key: "webhook", label: "Custom webhook", description: "Send events to the buyer's systems" }
];

export const AGENT_CATEGORIES = [
  "Communication",
  "Scheduling",
  "Reviews & Reputation",
  "Lead Generation",
  "Customer Service",
  "Analytics",
  "Marketing",
  "Custom"
] as const;

export const AGENT_INDUSTRIES = [
  "Dental",
  "Medical Clinic",
  "Dermatology",
  "Physiotherapy",
  "Chiropractor",
  "Optometry",
  "Veterinary",
  "Med Spa",
  "Salon",
  "Barbershop",
  "Spa & Wellness",
  "Yoga Studio",
  "Gym / Fitness",
  "Law Firm",
  "Plumber",
  "HVAC",
  "Electrician",
  "Garage Door",
  "Roofing",
  "Landscaping",
  "Pool Service",
  "Real Estate",
  "Auto Repair",
  "Restaurant",
  "Insurance",
  "Mortgage Broker",
  "Urgent Care",
  "Senior Care",
  "Property Management",
  "Hotel / Hospitality",
  "Custom"
] as const;

/** Industry names from the original short list → their canonical replacements. */
export const LEGACY_INDUSTRY_MAP: Record<string, string> = {
  Legal: "Law Firm",
  "Medical Spa": "Med Spa",
  Medical: "Medical Clinic",
  Automotive: "Auto Repair",
  Fitness: "Gym / Fitness",
  General: "Custom"
};

/**
 * Map legacy industry names to their canonical equivalents, keep only values
 * present in AGENT_INDUSTRIES, and dedupe — so configureJson saved before the
 * list changed still loads safely.
 */
export function normalizeIndustryTags(tags: string[]): string[] {
  const canonical = new Set<string>(AGENT_INDUSTRIES);
  const result: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    const mapped = LEGACY_INDUSTRY_MAP[trimmed] ?? trimmed;
    if (canonical.has(mapped) && !result.includes(mapped)) result.push(mapped);
  }
  return result;
}

export const SETUP_TIME_OPTIONS = ["Under 2 min", "2-5 min", "5-10 min", "10+ min"] as const;

export const AGENT_TEMPLATE_TYPES = [
  "AI Receptionist",
  "Missed Call Text-Back",
  "Appointment Booking",
  "Lead Follow-Up",
  "Custom Workflow"
] as const;

export type ComplianceCheckKey = "guidelines" | "tested" | "accurate" | "terms";

export const COMPLIANCE_CHECK_DEFS: { key: ComplianceCheckKey; label: string }[] = [
  { key: "guidelines", label: "My agent follows Triven's content guidelines" },
  { key: "tested", label: "I have tested this agent with at least 3 real scenarios" },
  { key: "accurate", label: "I confirm all descriptions are accurate and not misleading" },
  { key: "terms", label: "I agree to Triven's Architect Terms of Service" }
];

/** Every input type an architect can ask a buyer to fill in during setup. */
export const BUYER_SETUP_FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "multiselect",
  "phone",
  "email",
  "url",
  "number",
  "boolean",
  "date",
  "time"
] as const;

export type BuyerSetupFieldType = (typeof BUYER_SETUP_FIELD_TYPES)[number];

export type BuyerSetupFieldValidation = {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
};

/** One field the buyer must fill in during their own setup (no secrets here). */
export type BuyerSetupField = {
  key: string;
  label: string;
  type: BuyerSetupFieldType;
  required: boolean;
  placeholder?: string;
  /** Buyer-facing help text shown under the field. */
  helper?: string;
  /** Choices for select/multiselect fields. */
  options?: string[];
  defaultValue?: string | string[] | boolean | number | null;
  validation?: BuyerSetupFieldValidation;
};

/** A buyer's answer to one architect-defined setup field. */
export type BuyerSetupAnswer = {
  key: string;
  label?: string;
  value: string | string[] | boolean | number;
};

export type BuyerSetupAnswerIssue = { key: string; label: string; message: string };

/**
 * Normalize a label into a safe camelCase key ("Room types" → "roomTypes").
 * Digit-leading labels get a "setup" prefix ("24/7 availability" →
 * "setup247Availability") so keys never start with a digit. Only NEW keys are
 * generated here — existing stored keys are preserved by normalizeBuyerSetupField.
 */
export function normalizeBuyerSetupKey(raw: string): string {
  const words = raw
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  const camel = words[0] + words.slice(1).map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return /^\d/.test(camel) ? `setup${camel[0].toUpperCase()}${camel.slice(1)}` : camel;
}

// Digit-leading keys are accepted here on purpose: keys like "247availability"
// were stored by older schema versions, and rewriting them would orphan the
// buyers' saved answers. Only brand-new keys go through normalizeBuyerSetupKey.
function isSafeBuyerSetupKey(key: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(key) && key.length <= 80;
}

function cleanOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Sanitize one persisted/unknown buyer setup field record into a safe shape. */
export function normalizeBuyerSetupField(raw: Record<string, unknown>): BuyerSetupField {
  const rawKey = typeof raw.key === "string" ? raw.key.trim() : "";
  const label = typeof raw.label === "string" ? raw.label : "";
  // Existing keys are kept verbatim when safe (answers are stored by key);
  // anything unusable is re-derived from the label.
  const key = isSafeBuyerSetupKey(rawKey) ? rawKey : normalizeBuyerSetupKey(rawKey || label);

  const type = (BUYER_SETUP_FIELD_TYPES as readonly string[]).includes(raw.type as string)
    ? (raw.type as BuyerSetupFieldType)
    : "text";

  const options = Array.isArray(raw.options)
    ? raw.options.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : undefined;

  const rawValidation = isRecord(raw.validation) ? raw.validation : undefined;
  const validation: BuyerSetupFieldValidation | undefined = rawValidation
    ? {
        minLength: cleanOptionalNumber(rawValidation.minLength),
        maxLength: cleanOptionalNumber(rawValidation.maxLength),
        min: cleanOptionalNumber(rawValidation.min),
        max: cleanOptionalNumber(rawValidation.max),
        pattern: typeof rawValidation.pattern === "string" ? rawValidation.pattern : undefined
      }
    : undefined;

  const defaultValue =
    typeof raw.defaultValue === "string" ||
    typeof raw.defaultValue === "boolean" ||
    typeof raw.defaultValue === "number"
      ? raw.defaultValue
      : Array.isArray(raw.defaultValue)
        ? raw.defaultValue.filter((item): item is string => typeof item === "string")
        : undefined;

  return {
    key,
    label,
    type,
    required: typeof raw.required === "boolean" ? raw.required : true,
    placeholder: typeof raw.placeholder === "string" ? raw.placeholder : undefined,
    // `helper` is the historical stored name; accept `helpText` as an alias.
    helper:
      typeof raw.helper === "string" ? raw.helper : typeof raw.helpText === "string" ? raw.helpText : undefined,
    ...(options && (type === "select" || type === "multiselect") ? { options } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(validation ? { validation } : {})
  };
}

/** Parse an unknown persisted JSON value (listing.requiredBuyerSetup) into fields. */
export function normalizeBuyerSetupFields(raw: unknown): BuyerSetupField[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map(normalizeBuyerSetupField);
}

export type BuyerSetupFieldIssue = { index: number; key: string; message: string };

/** Architect-side schema validation: labels, unique keys, select options. */
export function validateBuyerSetupFields(fields: BuyerSetupField[]): BuyerSetupFieldIssue[] {
  const issues: BuyerSetupFieldIssue[] = [];
  const seenKeys = new Map<string, number>();

  fields.forEach((field, index) => {
    if (!field.label.trim()) {
      issues.push({ index, key: field.key, message: `Buyer setup field ${index + 1} needs a label.` });
    }

    const key = field.key.trim();
    if (key) {
      const firstIndex = seenKeys.get(key);
      if (firstIndex !== undefined) {
        issues.push({
          index,
          key,
          message: `Buyer setup fields ${firstIndex + 1} and ${index + 1} have the same key ("${key}") — make the labels distinct.`
        });
      } else {
        seenKeys.set(key, index);
      }
    }

    if ((field.type === "select" || field.type === "multiselect") && !(field.options ?? []).some((option) => option.trim())) {
      issues.push({
        index,
        key: field.key,
        message: `"${field.label.trim() || `Field ${index + 1}`}" is a ${field.type === "select" ? "dropdown" : "multi-select"} — add at least one option.`
      });
    }
  });

  return issues;
}

/** True when a buyer answer counts as "not provided". */
export function isBuyerAnswerEmpty(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim()).length === 0;
  if (typeof value === "boolean") return false;
  if (typeof value === "number") return !Number.isFinite(value);
  return true;
}

/**
 * Human-readable, single-line form of a buyer answer for prompt injection:
 * arrays comma-separated, booleans Yes/No, multiline textarea answers joined
 * with commas ("Consultation\nEmergency visit" → "Consultation, Emergency visit"),
 * repeated whitespace collapsed. Empty values return "".
 */
export function formatBuyerAnswerValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.replace(/\s+/g, " ").trim())
      .join(", ");
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") {
    return value
      .split(/[\r\n]+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()\-.\s\d]{5,25}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]?\d|2[0-3]):[0-5]\d$|^(?:1[0-2]|0?[1-9]):[0-5]\d\s?(?:am|pm)$/i;

function isValidUrlAnswer(value: string): boolean {
  for (const candidate of [value, `https://${value}`]) {
    try {
      const parsed = new URL(candidate);
      if (parsed.hostname.includes(".")) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/**
 * Validate buyer answers against the listing's buyer setup schema.
 * `requireMissing: false` skips required-field checks (incremental saves)
 * while still rejecting values that are present but invalid.
 */
export function validateBuyerSetupAnswers(
  fields: BuyerSetupField[],
  answers: BuyerSetupAnswer[],
  opts: { requireMissing?: boolean } = {}
): BuyerSetupAnswerIssue[] {
  const requireMissing = opts.requireMissing ?? true;
  const issues: BuyerSetupAnswerIssue[] = [];
  const answerByKey = new Map(answers.map((answer) => [answer.key, answer.value]));

  for (const field of fields) {
    const label = field.label.trim() || field.key;
    const value = answerByKey.get(field.key);
    const empty = isBuyerAnswerEmpty(value);

    if (empty) {
      if (field.required && requireMissing) {
        issues.push({ key: field.key, label, message: `${label} is required.` });
      }
      continue;
    }

    const text = typeof value === "string" ? value.trim() : "";

    switch (field.type) {
      case "email":
        if (!text || !EMAIL_PATTERN.test(text)) {
          issues.push({ key: field.key, label, message: `${label} must be a valid email address.` });
        }
        break;
      case "phone":
        if (!text || !PHONE_PATTERN.test(text)) {
          issues.push({ key: field.key, label, message: `${label} must be a valid phone number.` });
        }
        break;
      case "url":
        if (!text || !isValidUrlAnswer(text)) {
          issues.push({ key: field.key, label, message: `${label} must be a valid URL.` });
        }
        break;
      case "number":
        if (typeof value !== "number" && (!text || Number.isNaN(Number(text)))) {
          issues.push({ key: field.key, label, message: `${label} must be a valid number.` });
        } else {
          const num = typeof value === "number" ? value : Number(text);
          if (field.validation?.min !== undefined && num < field.validation.min) {
            issues.push({ key: field.key, label, message: `${label} must be at least ${field.validation.min}.` });
          }
          if (field.validation?.max !== undefined && num > field.validation.max) {
            issues.push({ key: field.key, label, message: `${label} must be at most ${field.validation.max}.` });
          }
        }
        break;
      case "boolean":
        if (typeof value !== "boolean" && !/^(yes|no|true|false)$/i.test(text)) {
          issues.push({ key: field.key, label, message: `${label} must be Yes or No.` });
        }
        break;
      case "date":
        if (!text || !(DATE_PATTERN.test(text) || !Number.isNaN(Date.parse(text)))) {
          issues.push({ key: field.key, label, message: `${label} must be a valid date.` });
        }
        break;
      case "time":
        if (!text || !TIME_PATTERN.test(text)) {
          issues.push({ key: field.key, label, message: `${label} must be a valid time (e.g. 15:00 or 3:00 PM).` });
        }
        break;
      case "select": {
        const options = field.options ?? [];
        if (options.length > 0 && !options.includes(text)) {
          issues.push({ key: field.key, label, message: `Selected option is not allowed for ${label}.` });
        }
        break;
      }
      case "multiselect": {
        const options = field.options ?? [];
        const selected = Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : text
            ? text.split(",").map((item) => item.trim()).filter(Boolean)
            : [];
        if (options.length > 0 && selected.some((item) => !options.includes(item))) {
          issues.push({ key: field.key, label, message: `Selected option is not allowed for ${label}.` });
        }
        break;
      }
      default:
        break;
    }

    // Generic string-length / pattern rules for text-like answers.
    if (typeof value === "string" && field.validation) {
      if (field.validation.minLength !== undefined && text.length < field.validation.minLength) {
        issues.push({
          key: field.key,
          label,
          message: `${label} must be at least ${field.validation.minLength} characters.`
        });
      }
      if (field.validation.maxLength !== undefined && text.length > field.validation.maxLength) {
        issues.push({
          key: field.key,
          label,
          message: `${label} must be at most ${field.validation.maxLength} characters.`
        });
      }
      if (field.validation.pattern) {
        try {
          if (!new RegExp(field.validation.pattern).test(text)) {
            issues.push({ key: field.key, label, message: `${label} has an invalid format.` });
          }
        } catch {
          /* bad architect-supplied pattern — never block the buyer on it */
        }
      }
    }
  }

  return issues;
}

export type AgentConfigureBasics = {
  agentName: string;
  tagline: string;
  category: string;
  industryTags: string[];
  /** Data URL or hosted URL for the marketplace icon. */
  iconUrl: string;
  visibility: "public" | "private";
  shortDescription: string;
};

export type AgentConfigureMedia = {
  /** Sanitised rich-text HTML (bold/italic/lists only). */
  fullDescription: string;
  includedFeatures: string[];
  screenshotUrls: string[];
  demoVideoUrl: string;
};

export type AgentConfigureTemplate = {
  templateType: string;
  supportedIndustries: string[];
  requiredBuyerSetup: BuyerSetupField[];
  setupTimeEstimate: string;
  requiredIntegrations: RequiredIntegrations;
  buyerSetupInstructions: string;
  installInstructions: string;
};

export type AgentConfigurePricing = {
  pricingModel: AgentPricingModel;
  /** Dollars (not cents) as entered by the architect. */
  price: number;
  /** Dollars per run. */
  executionFee: number;
  freeTrialEnabled: boolean;
  trialDays: number;
  platformCommissionPercent: number;
};

export type AgentConfigureCompliance = {
  processesPersonalData: boolean;
  storesConversationHistory: boolean;
  connectsThirdPartyServices: boolean;
  complianceChecks: Record<ComplianceCheckKey, boolean>;
};

export type AgentConfigureData = {
  version: 1;
  basics: AgentConfigureBasics;
  media: AgentConfigureMedia;
  template: AgentConfigureTemplate;
  pricing: AgentConfigurePricing;
  compliance: AgentConfigureCompliance;
};

export const TRIVEN_PLATFORM_COMMISSION_PERCENT = 30;

/* ---- "What's included" generation from the workflow graph ---- */

/**
 * Buyer-friendly bullet per node type slug (see node-registry / VOICE_NODE_TYPES).
 * Generic business language only — never industry-specific.
 */
const INCLUDED_FEATURE_BY_NODE_TYPE: Record<string, string> = {
  "trigger.phone_call": "Inbound phone call answering",
  "trigger.twilio_missed_call": "Automatic missed call text-back",
  "trigger.twilio_inbound_sms": "Two-way SMS text messaging",
  "trigger.telegram_message": "Telegram messaging & service automation",
  "trigger.vapi_tool_call": "Voice AI assistant handling",
  "trigger.whatsapp_message_received": "WhatsApp customer messaging",
  "trigger.manual": "Web chat & event trigger",
  "ai.voice_conversation": "Natural AI voice conversation",
  "ai.context_reply": "AI replies trained on business context",
  "ai.llm_call": "Custom AI text generation & reasoning",
  "ai.memory": "Long-term conversation memory",
  "ai.image_generation": "AI image generation",
  "calendar.availability": "Real-time calendar availability check",
  "action.google_calendar_availability": "Real-time Google Calendar slot checking",
  "calendar.book_appointment": "Automated appointment booking",
  "action.google_calendar_create_appointment": "Google Calendar appointment scheduling",
  "communication.send_sms": "Automated SMS confirmations",
  "action.send_sms": "Automated SMS confirmation & alerts",
  "action.send_whatsapp": "Automated WhatsApp notifications & replies",
  "communication.send_email": "Automated email confirmations",
  "integration.gmail_send_email": "Automated Gmail email sending",
  "integration.gmail_create_draft": "Automated email draft creation",
  "integration.gmail_read_emails": "Automated email reading & extraction",
  "trigger.gmail_new_email": "Automated Gmail inbox monitoring",
  "trigger.calendly": "Calendly scheduling automation",
  "action.calendly": "Calendly scheduling actions",
  "trigger.calendly_meeting_booked": "Calendly meeting confirmation",
  "trigger.calendly_meeting_cancelled": "Calendly cancellation handling",
  "trigger.calendly_meeting_rescheduled": "Calendly reschedule handling",
  "trigger.calendly_routing_form_submitted": "Calendly form submission handling",
  "action.calendly_find_available_times": "Calendly available slot lookup",
  "action.calendly_create_scheduling_link": "Calendly scheduling link generation",
  "action.start_vapi_call": "Voice AI call initiation",
  "action.save_lead": "Lead capture & CRM sync",
  "action.update_lead": "CRM lead updates",
  "trigger.webhook": "Custom API & webhook integration",
  "action.http_request": "Custom API request integration",
  "action.save_conversation_message": "Full chat history logging",
  "action.human_handoff": "Smart live agent escalation",
  "logic.condition": "Smart conditional routing rules",
  "flow.end": "Complete flow automation"
};

/** Keyword fallback for node types/connectors without an exact mapping. */
function includedFeatureFallback(nodeType: string, connector: string, title?: string, label?: string): string | null {
  const haystack = `${nodeType} ${connector} ${title ?? ""} ${label ?? ""}`.toLowerCase();
  if (haystack.includes("whatsapp")) return "Automated WhatsApp messaging & engagement";
  if (haystack.includes("sms")) return "Automated SMS confirmation & updates";
  if (haystack.includes("telegram")) return "Telegram customer service & messaging";
  if (haystack.includes("twilio")) return "Telephony & SMS messaging support";
  if (haystack.includes("vapi") || haystack.includes("voice_conversation")) return "Voice AI call handling";
  if (haystack.includes("calendar")) return "Google Calendar appointment scheduling";
  if (haystack.includes("gmail") || haystack.includes("email")) return "Automated email confirmation & updates";
  if (haystack.includes("crm") || haystack.includes("lead") || haystack.includes("webhook")) {
    return "Lead capture & CRM integration";
  }
  if (
    haystack.includes("phone_call") ||
    haystack.includes("inbound_call") ||
    (haystack.includes("phone") && !haystack.includes("api") && !haystack.includes("llm"))
  ) {
    return "Inbound phone call answering";
  }
  if (label && label.trim() && label !== "Node" && label !== "Incoming Event") return label.trim();
  if (title && title.trim() && title !== "Node" && title !== "Incoming Event") return title.trim();
  return null;
}

const MAX_GENERATED_FEATURES = 5;

type FlowNode = { id: string; type: string; connector: string; title: string; label: string; nodeKind: string };

/**
 * Generate buyer-facing "What's included" bullets from workflowJson.
 *
 * Connected nodes count first, in traversal order from triggers. Bullets are
 * deduped and capped at 5.
 */
export function generateIncludedFeaturesFromWorkflow(workflowJson: unknown): string[] {
  if (!isRecord(workflowJson)) return [];

  const rawNodes = Array.isArray(workflowJson.nodes) ? workflowJson.nodes : [];
  const rawEdges = Array.isArray(workflowJson.edges) ? workflowJson.edges : [];

  const nodes: FlowNode[] = rawNodes.filter(isRecord).map((node) => {
    const data = isRecord(node.data) ? node.data : {};
    const type =
      typeof data.type === "string" && data.type
        ? data.type
        : typeof node.type === "string" && node.type !== "coreNode"
          ? node.type
          : typeof data.kind === "string"
            ? data.kind
            : typeof data.nodeKind === "string"
              ? data.nodeKind
              : "";
    return {
      id: typeof node.id === "string" ? node.id : "",
      type,
      connector: typeof data.connector === "string" ? data.connector : "",
      title: typeof data.title === "string" ? data.title : "",
      label: typeof data.label === "string" ? data.label : "",
      nodeKind: typeof data.nodeKind === "string" ? data.nodeKind : ""
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const edges = rawEdges
    .filter(isRecord)
    .map((edge) => ({
      source: typeof edge.source === "string" ? edge.source : "",
      target: typeof edge.target === "string" ? edge.target : ""
    }))
    .filter((edge) => edge.source && edge.target);

  if (edges.length === 0 && nodes.length === 0) return [];

  const connectedIds = new Set<string>();
  for (const edge of edges) {
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }

  const triggers = nodes.filter(
    (node) =>
      (node.type.startsWith("trigger.") || node.nodeKind === "trigger") &&
      (edges.length === 0 || connectedIds.has(node.id))
  );

  // With a trigger: walk the graph from it so bullets follow the flow order.
  // Without edges or without trigger: use every connected node in canvas order.
  const orderedIds: string[] = [];
  const visited = new Set<string>();

  if (triggers.length > 0) {
    const queue = triggers.map((node) => node.id);
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (visited.has(id)) continue;
      visited.add(id);
      orderedIds.push(id);
      for (const next of outgoing.get(id) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    }
  }

  for (const node of nodes) {
    if (!visited.has(node.id) && (edges.length === 0 || connectedIds.has(node.id))) {
      visited.add(node.id);
      orderedIds.push(node.id);
    }
  }

  const features: string[] = [];
  for (const id of orderedIds) {
    const node = nodeById.get(id);
    if (!node) continue;
    const feature =
      INCLUDED_FEATURE_BY_NODE_TYPE[node.type] ??
      includedFeatureFallback(node.type, node.connector, node.title, node.label);
    if (feature && !features.includes(feature)) features.push(feature);
    if (features.length >= MAX_GENERATED_FEATURES) break;
  }

  return features;
}

/** Every node type in the graph, lowercased ("" entries filtered). */
function workflowNodeTypes(workflowJson: unknown): string[] {
  if (!isRecord(workflowJson) || !Array.isArray(workflowJson.nodes)) return [];
  return workflowJson.nodes
    .filter(isRecord)
    .map((node) => {
      const data = isRecord(node.data) ? node.data : {};
      const type = typeof data.type === "string" ? data.type : typeof data.kind === "string" ? data.kind : "";
      const connector = typeof data.connector === "string" ? data.connector : "";
      return `${type} ${connector}`.toLowerCase();
    })
    .filter(Boolean);
}

/** True when the workflow graph actually sends or receives SMS. */
export function workflowUsesSms(workflowJson: unknown): boolean {
  return workflowNodeTypes(workflowJson).some((type) => type.includes("sms"));
}

export function workflowUsesWhatsApp(workflowJson: unknown): boolean {
  return workflowNodeTypes(workflowJson).some(
    (type) => type.includes("whatsapp") || type === "trigger.whatsapp_message_received"
  );
}

/** True when the workflow is a voice/call agent (Vapi, phone call, voice conversation). */
export function workflowUsesVoice(workflowJson: unknown): boolean {
  return workflowNodeTypes(workflowJson).some(
    (type) => type.includes("voice") || type.includes("phone_call") || type.includes("vapi")
  );
}

/* ---- Marketplace copy defaults (MVP follow-up channel is Email, not SMS) ---- */

export const RECEPTIONIST_DEFAULT_TAGLINE =
  "AI voice receptionist that answers calls, checks availability, books appointments, and sends email follow-ups.";

export const RECEPTIONIST_DEFAULT_SHORT_DESCRIPTION =
  "Automate inbound calls with an AI receptionist that answers questions, checks calendar availability, books appointments, and sends email follow-ups to customers and staff.";

export const RECEPTIONIST_DEFAULT_FULL_DESCRIPTION =
  "This AI voice receptionist helps service businesses handle inbound calls automatically. It can greet callers, understand their request, check calendar availability, book appointments, answer common questions, and send email follow-ups after the call. Buyers can customize business details, services, working hours, booking rules, escalation contacts, and policies during setup.";

/**
 * Collapse immediately-repeated sentences ("…end call.Incoming call →…" pasted
 * twice) and whole-string doubling. Keeps single occurrences untouched.
 */
export function dedupeAdjacentSentences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  // Whole-string doubling with no separator ("abcabc" → "abc").
  if (trimmed.length % 2 === 0) {
    const half = trimmed.slice(0, trimmed.length / 2);
    if (half === trimmed.slice(trimmed.length / 2) && half.trim()) return half.trim();
  }

  const sentences = trimmed.split(/(?<=[.!?])\s*/);
  if (sentences.length < 2) return text;

  const kept: string[] = [];
  for (const sentence of sentences) {
    if (sentence.trim() && sentence.trim() === kept[kept.length - 1]?.trim()) continue;
    kept.push(sentence);
  }
  return kept.length === sentences.length ? text : kept.join(" ").trim();
}

export function emptyRequiredIntegrations(): RequiredIntegrations {
  return {
    phone: false,
    sms: false,
    calendar: false,
    email: false,
    crm: false,
    webhook: false,
    telegram: false,
    vapi: false,
    twilio: false,
    whatsapp: false
  };
}

/**
 * Safe defaults for workflows that predate the Configure flow — seeded from
 * whatever the workflow already knows about itself.
 */
export function defaultAgentConfigure(seed?: {
  name?: string | null;
  tagline?: string | null;
  description?: string | null;
  priceDollars?: number | null;
  requiredConnectors?: string[] | null;
  /** When provided, "What's included" is pre-generated from the connected nodes. */
  workflowJson?: unknown;
}): AgentConfigureData {
  const integrations = emptyRequiredIntegrations();

  const generatedFeatures = seed?.workflowJson
    ? generateIncludedFeaturesFromWorkflow(seed.workflowJson)
    : [];
  const includedFeatures = [...generatedFeatures];
  while (includedFeatures.length < 4) includedFeatures.push("");

  for (const connector of seed?.requiredConnectors ?? []) {
    const key = connector.trim().toLowerCase();
    if (key.includes("twilio")) {
      // Telephony alone does not imply SMS — the MVP follow-up channel is
      // Email. SMS is only required when an SMS connector/node is present.
      integrations.twilio = true;
      integrations.phone = true;
    }
    if (key.includes("vapi") || key.includes("voice")) integrations.vapi = true;
    if (key.includes("calendar")) integrations.calendar = true;
    if (key.includes("gmail") || key.includes("email") || key.includes("mail")) integrations.email = true;
    if (key.includes("sms")) integrations.sms = true;
    if (key.includes("phone")) integrations.phone = true;
  }

  // SMS is required only when the graph itself sends/receives SMS (connector
  // keys are too coarse — Twilio telephony alone must not imply SMS).
  if (seed?.workflowJson && workflowUsesSms(seed.workflowJson)) {
    integrations.sms = true;
    integrations.phone = true;
  }

  return {
    version: 1,
    basics: {
      agentName: seed?.name?.trim() || "",
      tagline: seed?.tagline?.trim() || "",
      category: "Communication",
      industryTags: [],
      iconUrl: "",
      visibility: "public",
      shortDescription: seed?.description?.trim() || seed?.tagline?.trim() || ""
    },
    media: {
      fullDescription: seed?.description?.trim() || "",
      includedFeatures,
      screenshotUrls: [],
      demoVideoUrl: ""
    },
    template: {
      templateType: "Custom Workflow",
      supportedIndustries: [],
      requiredBuyerSetup: [],
      setupTimeEstimate: "2-5 min",
      requiredIntegrations: integrations,
      buyerSetupInstructions: "",
      installInstructions: ""
    },
    pricing: {
      pricingModel: "subscription",
      price: typeof seed?.priceDollars === "number" && seed.priceDollars >= 0 ? seed.priceDollars : 149,
      executionFee: 0,
      freeTrialEnabled: false,
      trialDays: 7,
      platformCommissionPercent: TRIVEN_PLATFORM_COMMISSION_PERCENT
    },
    compliance: {
      processesPersonalData: true,
      storesConversationHistory: true,
      connectsThirdPartyServices: true,
      complianceChecks: { guidelines: false, tested: false, accurate: false, terms: false }
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function cleanBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function cleanNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function cleanStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Merge an unknown/partial persisted `configureJson` into safe defaults so
 * older workflows (or partial PATCHes) always resolve to a complete object.
 */
export function normalizeAgentConfigure(
  raw: unknown,
  seed?: Parameters<typeof defaultAgentConfigure>[0]
): AgentConfigureData {
  const base = defaultAgentConfigure(seed);
  if (!isRecord(raw)) return base;

  const basics = isRecord(raw.basics) ? raw.basics : {};
  const media = isRecord(raw.media) ? raw.media : {};
  const template = isRecord(raw.template) ? raw.template : {};
  const pricing = isRecord(raw.pricing) ? raw.pricing : {};
  const compliance = isRecord(raw.compliance) ? raw.compliance : {};
  const rawIntegrations = isRecord(template.requiredIntegrations) ? template.requiredIntegrations : {};
  const rawChecks = isRecord(compliance.complianceChecks) ? compliance.complianceChecks : {};

  const integrations = emptyRequiredIntegrations();
  for (const def of REQUIRED_INTEGRATION_DEFS) {
    integrations[def.key] = cleanBoolean(rawIntegrations[def.key], base.template.requiredIntegrations[def.key]);
  }

  const requiredBuyerSetup: BuyerSetupField[] = Array.isArray(template.requiredBuyerSetup)
    ? normalizeBuyerSetupFields(template.requiredBuyerSetup)
    : base.template.requiredBuyerSetup;

  const pricingModel = (["free", "one_time", "subscription"] as const).includes(
    pricing.pricingModel as AgentPricingModel
  )
    ? (pricing.pricingModel as AgentPricingModel)
    : base.pricing.pricingModel;

  return {
    version: 1,
    basics: {
      agentName: cleanString(basics.agentName, base.basics.agentName),
      tagline: dedupeAdjacentSentences(cleanString(basics.tagline, base.basics.tagline)),
      category: cleanString(basics.category, base.basics.category),
      industryTags: normalizeIndustryTags(cleanStringArray(basics.industryTags, base.basics.industryTags)),
      iconUrl: cleanString(basics.iconUrl, base.basics.iconUrl),
      visibility: basics.visibility === "private" ? "private" : "public",
      shortDescription: dedupeAdjacentSentences(cleanString(basics.shortDescription, base.basics.shortDescription))
    },
    media: {
      fullDescription: dedupeAdjacentSentences(cleanString(media.fullDescription, base.media.fullDescription)),
      // A stored-but-blank list falls back to the workflow-generated bullets;
      // anything the architect actually typed always wins.
      includedFeatures: cleanStringArray(media.includedFeatures, base.media.includedFeatures).some((f) => f.trim())
        ? cleanStringArray(media.includedFeatures, base.media.includedFeatures)
        : base.media.includedFeatures,
      screenshotUrls: cleanStringArray(media.screenshotUrls, base.media.screenshotUrls),
      demoVideoUrl: cleanString(media.demoVideoUrl, base.media.demoVideoUrl)
    },
    template: {
      templateType: cleanString(template.templateType, base.template.templateType),
      supportedIndustries: normalizeIndustryTags(
        cleanStringArray(template.supportedIndustries, base.template.supportedIndustries)
      ),
      requiredBuyerSetup,
      setupTimeEstimate: cleanString(template.setupTimeEstimate, base.template.setupTimeEstimate),
      requiredIntegrations: integrations,
      buyerSetupInstructions: cleanString(template.buyerSetupInstructions, base.template.buyerSetupInstructions),
      installInstructions: cleanString(template.installInstructions, base.template.installInstructions)
    },
    pricing: {
      pricingModel,
      price: cleanNumber(pricing.price, base.pricing.price),
      executionFee: cleanNumber(pricing.executionFee, base.pricing.executionFee),
      freeTrialEnabled: cleanBoolean(pricing.freeTrialEnabled, base.pricing.freeTrialEnabled),
      trialDays: cleanNumber(pricing.trialDays, base.pricing.trialDays),
      platformCommissionPercent: cleanNumber(
        pricing.platformCommissionPercent,
        base.pricing.platformCommissionPercent
      )
    },
    compliance: {
      processesPersonalData: cleanBoolean(compliance.processesPersonalData, base.compliance.processesPersonalData),
      storesConversationHistory: cleanBoolean(
        compliance.storesConversationHistory,
        base.compliance.storesConversationHistory
      ),
      connectsThirdPartyServices: cleanBoolean(
        compliance.connectsThirdPartyServices,
        base.compliance.connectsThirdPartyServices
      ),
      complianceChecks: {
        guidelines: cleanBoolean(rawChecks.guidelines, false),
        tested: cleanBoolean(rawChecks.tested, false),
        accurate: cleanBoolean(rawChecks.accurate, false),
        terms: cleanBoolean(rawChecks.terms, false)
      }
    }
  };
}

export type ConfigureValidationIssue = {
  step: 1 | 2 | 3 | 4 | 5;
  field: string;
  message: string;
};

/** Full submit-for-review validation, shared by the frontend gate and backend. */
export function validateConfigureForSubmit(data: AgentConfigureData): ConfigureValidationIssue[] {
  const issues: ConfigureValidationIssue[] = [];

  if (data.basics.agentName.trim().length < 2) {
    issues.push({ step: 1, field: "agentName", message: "Agent name must be at least 2 characters." });
  }
  if (data.basics.tagline.trim().length < 10) {
    issues.push({ step: 1, field: "tagline", message: "Tagline must be at least 10 characters." });
  }
  if (!data.basics.category.trim()) {
    issues.push({ step: 1, field: "category", message: "Pick a category." });
  }
  if (data.basics.industryTags.length === 0) {
    issues.push({ step: 1, field: "industryTags", message: "Pick at least one industry tag." });
  }

  const plainDescription = data.media.fullDescription
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plainDescription.length < 100) {
    issues.push({ step: 2, field: "fullDescription", message: "Full description must be at least 100 characters." });
  }

  if (plainDescription.length > 2000) {
    issues.push({
      step: 2,
      field: "fullDescription",
      message: "Full description must be 2,000 characters or fewer."
    });
  }

  // Step 3 is Pricing in the Configure flow; step 4 is Requirements & Compliance.
  if (data.pricing.pricingModel !== "free" && data.pricing.price <= 0) {
    issues.push({ step: 3, field: "price", message: "Set a price greater than $0 for paid agents." });
  }

  for (const fieldIssue of validateBuyerSetupFields(data.template.requiredBuyerSetup)) {
    issues.push({ step: 4, field: `requiredBuyerSetup.${fieldIssue.index}`, message: fieldIssue.message });
  }

  const checks = data.compliance.complianceChecks;
  if (!checks.guidelines || !checks.tested || !checks.accurate || !checks.terms) {
    issues.push({ step: 4, field: "complianceChecks", message: "Complete all compliance checks in Step 4 before submitting." });
  }

  return issues;
}

export type TemplateGalleryValidationOptions = {
  nodeCount?: number;
};

/** Metadata required before an architect workflow can be saved to the template gallery. */
export function validateConfigureForTemplateGallery(
  data: AgentConfigureData,
  options: TemplateGalleryValidationOptions = {}
): ConfigureValidationIssue[] {
  const issues: ConfigureValidationIssue[] = [];

  if (data.basics.agentName.trim().length < 2) {
    issues.push({
      step: 1,
      field: "agentName",
      message: "Agent name must be at least 2 characters."
    });
  }
  if (data.basics.tagline.trim().length < 10) {
    issues.push({
      step: 1,
      field: "tagline",
      message: "Tagline must be at least 10 characters."
    });
  }
  if (data.basics.shortDescription.trim().length < 20) {
    issues.push({
      step: 1,
      field: "shortDescription",
      message: "Short description must be at least 20 characters."
    });
  }
  if (!data.basics.category.trim()) {
    issues.push({ step: 1, field: "category", message: "Pick a category." });
  }
  if (data.basics.industryTags.length === 0) {
    issues.push({
      step: 1,
      field: "industryTags",
      message: "Pick at least one industry tag."
    });
  }

  const plainDescription = data.media.fullDescription
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plainDescription.length < 100) {
    issues.push({
      step: 2,
      field: "fullDescription",
      message: "Full description must be at least 100 characters."
    });
  }

  if (!data.template.templateType.trim()) {
    issues.push({ step: 4, field: "templateType", message: "Select a template type." });
  }
  if (!data.template.setupTimeEstimate.trim()) {
    issues.push({ step: 4, field: "setupTimeEstimate", message: "Select a setup time estimate." });
  }

  const nodeCount = options.nodeCount ?? 0;
  if (nodeCount < 1) {
    issues.push({
      step: 4,
      field: "workflowNodes",
      message: "Add at least one node in Build before saving as a template."
    });
  }

  return issues;
}

/** Marketplace preview card payload derived from configure data. */
export type AgentMarketplacePreview = {
  name: string;
  tagline: string;
  category: string;
  industryTags: string[];
  iconUrl: string;
  priceLabel: string;
  pricingModel: AgentPricingModel;
  priceDollars: number;
  executionFeeDollars: number;
  freeTrialEnabled: boolean;
  trialDays: number;
  setupTimeEstimate: string;
  requiredIntegrations: RequiredIntegrationKey[];
  architectName: string;
};

export function buildMarketplacePreview(
  data: AgentConfigureData,
  architectName: string
): AgentMarketplacePreview {
  const price = Math.max(0, Math.round(data.pricing.price));
  const priceLabel =
    data.pricing.pricingModel === "free"
      ? "Free"
      : data.pricing.pricingModel === "subscription"
        ? `$${price.toLocaleString("en-US")}/mo`
        : `$${price.toLocaleString("en-US")}`;

  return {
    name: data.basics.agentName.trim() || "Your agent",
    tagline: data.basics.tagline.trim() || "Your tagline appears here",
    category: data.basics.category,
    industryTags: data.basics.industryTags,
    iconUrl: data.basics.iconUrl,
    priceLabel,
    pricingModel: data.pricing.pricingModel,
    priceDollars: data.pricing.price,
    executionFeeDollars: data.pricing.executionFee,
    freeTrialEnabled: data.pricing.freeTrialEnabled,
    trialDays: data.pricing.trialDays,
    setupTimeEstimate: data.template.setupTimeEstimate,
    requiredIntegrations: REQUIRED_INTEGRATION_DEFS.filter(
      (def) => data.template.requiredIntegrations[def.key]
    ).map((def) => def.key),
    architectName
  };
}

/**
 * Maps technical connector/integration keys to buyer-friendly, understandable terms
 * to avoid displaying jargon (e.g. 'phone_provider integration', 'twilio integration') to users.
 */
export function getConnectorIncludedItem(connector: string): string {
  const key = connector.toLowerCase().trim();
  if (key === "phone" || key === "phone_provider" || key === "phone-provider") {
    return "AI voice call capability";
  }
  if (key === "twilio" || key === "twillow") {
    return "Call forwarding & routing";
  }
  if (key === "vapi") {
    return "AI voice assistant engine";
  }
  if (key === "sms" || key === "twilio_sms") {
    return "Unlimited text messages";
  }
  if (key === "google_calendar" || key === "calendar" || key === "google calendar" || key === "google_calendar integration") {
    return "Calendar booking & scheduling";
  }
  if (key === "gmail" || key === "email" || key === "triven_mail") {
    return "Automated email confirmations";
  }
  if (key === "crm") {
    return "CRM lead synchronization";
  }
  if (key === "webhook") {
    return "Custom system connection";
  }
  if (key === "elevenlabs") {
    return "Realistic voice generation";
  }

  const formatted = connector
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return `${formatted} integration`;
}

/**
 * Maps technical LLM model names to a clean, buyer-friendly capability description.
 */
export function getLlmIncludedItem(llm: string): string {
  return "Advanced AI reasoning engine";
}

export type HowItWorksStep = {
  step: number;
  title: string;
  description: string;
};

/**
 * Helper function to clean node text values
 */
function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if a workflowJson contains any call/voice-related nodes.
 */
export function hasCallNode(workflowJson?: any): boolean {
  if (!workflowJson || !Array.isArray(workflowJson.nodes)) return false;
  return workflowJson.nodes.some((node: any) => {
    const data = node?.data ?? {};
    const type = String(data.type || data.kind || node?.type || "").toLowerCase();
    const connector = String(data.connector || "").toLowerCase();
    const label = String(data.label || data.title || "").toLowerCase();
    const haystack = `${type} ${connector} ${label}`;

    return (
      type === "trigger.phone_call" ||
      type === "trigger.twilio_missed_call" ||
      type === "ai.voice_conversation" ||
      type === "action.vapi_call" ||
      type === "trigger.vapi_tool_call" ||
      type === "action.start_vapi_call" ||
      haystack.includes("phone_call") ||
      haystack.includes("voice_conversation") ||
      haystack.includes("missed_call") ||
      haystack.includes("missed call") ||
      haystack.includes("vapi") ||
      haystack.includes("voice call") ||
      haystack.includes("phone call") ||
      haystack.includes("call node")
    );
  });
}

/**
 * Helper to determine the channel type from workflow nodes and connectors.
 * Logic matches inferChannel in the frontend.
 */
function determineAgentChannel(requiredConnectors?: string[] | null, workflowJson?: any): string {
  const connectors = (requiredConnectors ?? []).map(c => c.toLowerCase().trim());
  const rawNodes = workflowJson && Array.isArray(workflowJson.nodes) ? workflowJson.nodes : [];
  
  const nodeTypes = rawNodes.map((node: any) => {
    const data = node?.data ?? {};
    const type = typeof data.type === "string" ? data.type : typeof data.kind === "string" ? data.kind : "";
    const connector = typeof data.connector === "string" ? data.connector : "";
    return `${type} ${connector}`.toLowerCase();
  });
  
  const haystack = [...nodeTypes, ...connectors].join(" ");

  if (haystack.includes("missed_call") || haystack.includes("missed call") || haystack.includes("no-answer") || haystack.includes("no_answer")) {
    return "missed-call";
  }
  if (haystack.includes("phone_call") || haystack.includes("voice_conversation") || haystack.includes("vapi") || haystack.includes("voice call") || haystack.includes("incoming call")) {
    return "voice";
  }
  if (haystack.includes("whatsapp")) {
    return "whatsapp";
  }
  if (haystack.includes("gmail") || haystack.includes("email") || haystack.includes("mail")) {
    return "email";
  }
  if (haystack.includes("inbound_sms") || haystack.includes("send_sms") || haystack.includes("sms") || haystack.includes("text message") || haystack.includes("twilio")) {
    return "sms";
  }
  return "general";
}

function isEndFlowNode(node: any): boolean {
  if (!node) return false;
  const data = node?.data ?? {};
  const type = String(data.type || data.kind || node?.type || "").toLowerCase();
  const label = String(data.label || data.title || "").toLowerCase();
  return (
    type === "flow.end" ||
    type === "endflow" ||
    type === "end_flow" ||
    type.endsWith(".end") ||
    label === "end flow" ||
    label === "end" ||
    label === "end_flow"
  );
}

/**
 * Generates dynamic "How It Works" steps based on listing connectors and workflow capabilities.
 */
export function getHowItWorksSteps(
  requiredConnectors?: string[] | null,
  workflowJson?: any
): HowItWorksStep[] {
  const rawNodes = workflowJson && Array.isArray(workflowJson.nodes) ? workflowJson.nodes : [];

  if (rawNodes.length > 0) {
    const triggerNodes: any[] = [];
    const aiLogicNodes: any[] = [];
    const actionNodes: any[] = [];

    for (const node of rawNodes) {
      const data = node?.data ?? {};
      const type = String(data.type || data.kind || node?.type || "").toLowerCase();
      const def = getNodeDefinition(data.type || data.kind || node?.type);
      const category = String(data.category || def?.category || "").toLowerCase();
      const nodeKind = String(data.nodeKind || def?.runtime?.nodeKind || "").toLowerCase();

      if (category === "trigger" || nodeKind === "trigger" || type.startsWith("trigger.")) {
        triggerNodes.push(node);
      } else if (
        category === "ai" ||
        category === "logic" ||
        nodeKind === "ai" ||
        data.prompt ||
        data.llmPrompt ||
        data.llmSystemPrompt ||
        data.firstMessage ||
        type.includes("voice_conversation") ||
        type.includes("ai.")
      ) {
        aiLogicNodes.push(node);
      } else if (!isEndFlowNode(node)) {
        actionNodes.push(node);
      }
    }

    // Step 1: Trigger Node Analysis
    let step1Title = "Trigger Event";
    let step1Desc = "The workflow starts automatically when a trigger event occurs.";
    if (triggerNodes.length > 0) {
      const tNode = triggerNodes[0];
      const tData = tNode?.data ?? {};
      const tType = String(tData.type || tData.kind || tNode?.type || "").toLowerCase();
      const tDef = getNodeDefinition(tData.type || tData.kind || tNode?.type);
      const tLabel = cleanText(tData.label || tData.title || tDef?.label || tData.subtitle) || "Workflow Trigger";

      step1Title = tLabel;

      if (tType.includes("missed_call")) {
        step1Title = "Customer Calls & Missed";
        step1Desc = "When someone calls your business and no one picks up, the agent detects the missed call instantly.";
      } else if (tType.includes("phone_call")) {
        step1Title = "Customer Calls";
        step1Desc = "When a customer dials your business number, the AI agent answers instantly without keeping them waiting.";
      } else if (tType.includes("inbound_sms") || tType.includes("sms")) {
        step1Title = "SMS Received";
        step1Desc = "When a customer sends a text message, the workflow detects it immediately and initiates the response.";
      } else if (tType.includes("whatsapp")) {
        step1Title = "WhatsApp Message Received";
        step1Desc = "When a customer reaches out via WhatsApp, the workflow triggers automatically.";
      } else if (tType.includes("email") || tType.includes("gmail")) {
        step1Title = "Email Received";
        step1Desc = "The agent monitors incoming emails and triggers on new customer inquiries or requests.";
      } else if (tType.includes("calendly")) {
        step1Title = "Calendly Event";
        step1Desc = "When a meeting or booking event occurs on Calendly, the workflow starts automatically.";
      } else if (tType.includes("telegram")) {
        step1Title = "Telegram Message";
        step1Desc = "When a message is received in your Telegram chat or bot, the workflow is triggered.";
      } else if (tType.includes("webhook")) {
        step1Title = "Webhook Trigger";
        step1Desc = "The workflow triggers automatically upon receiving an inbound HTTP webhook event.";
      } else if (tType.includes("schedule")) {
        step1Title = "Schedule Trigger";
        step1Desc = "The workflow executes automatically according to your configured schedule.";
      } else if (tDef?.description) {
        step1Desc = `The workflow starts automatically when ${tLabel.toLowerCase()} occurs (${tDef.description.toLowerCase()}).`;
      } else {
        step1Desc = `The workflow starts automatically whenever ${tLabel} occurs in your business tools.`;
      }
    }

    // Step 2: AI & Logic Processing Analysis
    let step2Title = "AI Reasoning & Logic";
    let step2Desc = "The AI agent analyzes the request, references your custom business guidelines, and executes actions.";
    if (aiLogicNodes.length > 0) {
      const aiNode = aiLogicNodes[0];
      const aiData = aiNode?.data ?? {};
      const aiType = String(aiData.type || aiData.kind || aiNode?.type || "").toLowerCase();
      const aiDef = getNodeDefinition(aiData.type || aiData.kind || aiNode?.type);
      const aiLabel = cleanText(aiData.label || aiData.title || aiDef?.label || aiData.subtitle) || "AI Agent Processing";

      step2Title = aiLabel;

      if (aiType.includes("voice_conversation")) {
        step2Title = "Natural Voice Conversation";
        step2Desc = "The AI speaks in a natural voice, answers customer questions, checks calendar availability, and processes requests.";
      } else if (aiType.includes("condition") || aiType.includes("logic")) {
        step2Title = aiLabel;
        step2Desc = `Evaluates incoming data using ${aiLabel} logic to guide downstream workflow actions.`;
      } else if (aiData.prompt || aiData.llmPrompt || aiData.llmSystemPrompt) {
        step2Desc = `The AI analyzes the request using configured instructions (${aiLabel}) and generates tailored responses.`;
      } else if (aiDef?.description) {
        step2Desc = `The AI agent processes the request using ${aiLabel} (${aiDef.description.toLowerCase()}).`;
      } else {
        step2Desc = `The AI evaluates incoming data using ${aiLabel} logic to guide downstream workflow actions.`;
      }
    }

    // Step 3: Action & Outcome Analysis
    let step3Title = "Task Completed";
    let step3Desc = "The workflow run completes successfully and output is delivered.";

    if (actionNodes.length > 0) {
      const actionLabels = actionNodes
        .map((n) => {
          const data = n?.data ?? {};
          const def = getNodeDefinition(data.type || data.kind || n?.type);
          return cleanText(data.label || data.title || def?.label || data.connectorAction);
        })
        .filter(Boolean);

      if (actionLabels.length === 1) {
        step3Title = actionLabels[0];
      } else if (actionLabels.length === 2) {
        step3Title = `${actionLabels[0]} & ${actionLabels[1]}`;
      } else if (actionLabels.length > 2) {
        step3Title = `${actionLabels[0]} & More Actions`;
      } else {
        step3Title = "Actions Executed";
      }

      const actionsDescParts: string[] = [];

      for (const n of actionNodes) {
        const data = n?.data ?? {};
        const def = getNodeDefinition(data.type || data.kind || n?.type);
        const text = String(data.type || data.label || data.connector || def?.type || "").toLowerCase();

        if (text.includes("book") || text.includes("calendar") || text.includes("appointment")) {
          if (!actionsDescParts.includes("appointments are scheduled directly in your calendar")) {
            actionsDescParts.push("appointments are scheduled directly in your calendar");
          }
        } else if (text.includes("sms") || text.includes("text")) {
          if (!actionsDescParts.includes("SMS notifications are sent")) {
            actionsDescParts.push("SMS notifications are sent");
          }
        } else if (text.includes("email") || text.includes("gmail") || text.includes("mail")) {
          if (!actionsDescParts.includes("email updates are delivered")) {
            actionsDescParts.push("email updates are delivered");
          }
        } else if (text.includes("lead") || text.includes("save") || text.includes("capture")) {
          if (!actionsDescParts.includes("lead details are recorded into your account")) {
            actionsDescParts.push("lead details are recorded into your account");
          }
        } else if (text.includes("telegram")) {
          if (!actionsDescParts.includes("Telegram messages are sent")) {
            actionsDescParts.push("Telegram messages are sent");
          }
        } else if (text.includes("slack")) {
          if (!actionsDescParts.includes("Slack notifications are posted")) {
            actionsDescParts.push("Slack notifications are posted");
          }
        } else if (text.includes("webhook") || text.includes("http") || text.includes("api")) {
          if (!actionsDescParts.includes("data is delivered to your endpoint")) {
            actionsDescParts.push("data is delivered to your endpoint");
          }
        } else if (def?.description) {
          const formattedDefDesc = def.description.toLowerCase().replace(/\.$/, "");
          if (!actionsDescParts.includes(formattedDefDesc)) {
            actionsDescParts.push(formattedDefDesc);
          }
        }
      }

      if (actionsDescParts.length > 0) {
        step3Desc = `As the flow completes, ${actionsDescParts.join(", ")}.`;
      } else if (actionLabels.length > 0) {
        step3Desc = `Executes ${actionLabels.join(", ")} and completes the workflow.`;
      } else {
        step3Desc = "Executes configured workflow actions and completes the run.";
      }
    } else {
      // If last node was End Flow, inspect the second-to-last node
      const lastNode = rawNodes[rawNodes.length - 1];
      const secondLastNode = isEndFlowNode(lastNode) && rawNodes.length >= 2 ? rawNodes[rawNodes.length - 2] : null;

      if (secondLastNode) {
        const slData = secondLastNode.data ?? {};
        const slType = String(slData.type || slData.kind || secondLastNode.type || "").toLowerCase();
        const slDef = getNodeDefinition(slData.type || slData.kind || secondLastNode.type);
        const slLabel = cleanText(slData.label || slData.title || slDef?.label || slData.subtitle);

        if (slType.includes("voice_conversation")) {
          step3Title = "Action Completed";
          step3Desc = "The AI handles customer requests, checks availability, and completes the interaction.";
        } else if (slLabel) {
          step3Title = slLabel;
          step3Desc = `Executes ${slLabel} and completes the workflow run.`;
        } else {
          step3Title = "Response & Completion";
          step3Desc = "The generated response or result is delivered and the workflow run completes.";
        }
      } else {
        step3Title = "Response & Completion";
        step3Desc = "The generated response or result is delivered and the workflow run completes.";
      }
    }

    return [
      { step: 1, title: step1Title, description: step1Desc },
      { step: 2, title: step2Title, description: step2Desc },
      { step: 3, title: step3Title, description: step3Desc }
    ];
  }

  // Fallback to channel-based steps if workflowJson has no nodes
  const channel = determineAgentChannel(requiredConnectors, workflowJson);

  if (channel === "missed-call") {
    return [
      {
        step: 1,
        title: "Customer Calls",
        description: "When someone calls your business and no one picks up, the agent detects the missed call instantly."
      },
      {
        step: 2,
        title: "Auto Text in 5 Seconds",
        description: "A personalized text message is sent immediately to keep the caller engaged and prevent them from leaving."
      },
      {
        step: 3,
        title: "Lead Captured",
        description: "The conversation continues via text. The agent books appointments, answers FAQs, or escalates to your team."
      }
    ];
  }

  if (channel === "voice") {
    return [
      {
        step: 1,
        title: "Customer Calls",
        description: "When a customer dials your business number, the AI agent answers instantly without keeping them waiting."
      },
      {
        step: 2,
        title: "Natural Conversation",
        description: "The AI speaks in a natural voice, answers questions, checks calendar availability, and processes requests."
      },
      {
        step: 3,
        title: "Action Completed",
        description: "Appointments are booked directly into your calendar, lead details are synced, and email updates are sent."
      }
    ];
  }

  if (channel === "email") {
    return [
      {
        step: 1,
        title: "Email Received",
        description: "The agent monitors your incoming emails and detects new customer inquiries or requests immediately."
      },
      {
        step: 2,
        title: "AI Response Drafted",
        description: "A professional response is drafted or sent using your business context and scheduling options."
      },
      {
        step: 3,
        title: "Workflow Automated",
        description: "Leads are logged, appointments are booked, and your team is notified of any urgent escalations."
      }
    ];
  }

  if (channel === "sms" || channel === "whatsapp") {
    return [
      {
        step: 1,
        title: "Message Received",
        description: `When a customer sends an ${channel === "whatsapp" ? "WhatsApp" : "SMS"} message, the agent detects it instantly.`
      },
      {
        step: 2,
        title: "AI Auto-Response",
        description: "A personalized text reply is sent back immediately using your custom business rules and tone."
      },
      {
        step: 3,
        title: "Lead Captured",
        description: "The conversation continues via text. The agent can book appointments, answer FAQs, or route to your team."
      }
    ];
  }

  return [
    {
      step: 1,
      title: "Trigger Event",
      description: "The workflow starts automatically when a trigger event (like a webhook, form submission, or new lead) occurs."
    },
    {
      step: 2,
      title: "AI Processing",
      description: "The AI agent analyzes the request, references your custom business guidelines, and executes actions."
    },
    {
      step: 3,
      title: "Task Completed",
      description: "The workflow run completes successfully and output is delivered to your system."
    }
  ];
}

/**
 * Generates dynamic "How It Works" subtitles based on listing connectors and workflow capabilities.
 */
export function getHowItWorksSubtitle(
  requiredConnectors?: string[] | null,
  workflowJson?: any
): string {
  const rawNodes = workflowJson && Array.isArray(workflowJson.nodes) ? workflowJson.nodes : [];
  if (rawNodes.length > 0) {
    const triggerNode = rawNodes.find((n: any) => {
      const data = n?.data ?? {};
      const type = String(data.type || data.kind || n?.type || "").toLowerCase();
      const category = String(data.category || "").toLowerCase();
      return category === "trigger" || type.startsWith("trigger.");
    });
    if (triggerNode) {
      const tLabel = cleanText(triggerNode.data?.label || triggerNode.data?.title) || "trigger event";
      return `From ${tLabel.toLowerCase()} to completed task in three automatic steps.`;
    }
  }

  const channel = determineAgentChannel(requiredConnectors, workflowJson);

  if (channel === "missed-call") {
    return "From missed call to captured lead in three automatic steps.";
  }
  if (channel === "voice") {
    return "From inbound call to completed appointment in three automatic steps.";
  }
  if (channel === "email") {
    return "From new inquiry to resolved request in three automatic steps.";
  }
  if (channel === "sms" || channel === "whatsapp") {
    return "From incoming message to customer conversion in three automatic steps.";
  }
  return "From trigger event to completed task in three automatic steps.";
}

/* ---- Workflow-driven integration & trigger helpers ---- */

/**
 * The three primary trigger kinds that drive what the Setup page shows.
 * - "missed_call": trigger.twilio_missed_call — needs call-forwarding number
 * - "inbound_sms":  trigger.twilio_inbound_sms — SMS number only, no call-forwarding
 * - "voice":        trigger.phone_call — needs call-forwarding + answering-mode selector
 * - "none":         no recognised trigger (AI Brain-only, manual, webhook, etc.)
 */
export type WorkflowTriggerKind = "missed_call" | "inbound_sms" | "voice" | "none";

/**
 * Inspect workflowJson and return the dominant trigger kind.
 * When multiple triggers are present the priority order is:
 * missed_call > voice > inbound_sms > none.
 */
export function getWorkflowTriggerKind(workflowJson: unknown): WorkflowTriggerKind {
  if (!isRecord(workflowJson) || !Array.isArray(workflowJson.nodes)) return "none";

  let hasMissedCall = false;
  let hasVoice = false;
  let hasSms = false;

  for (const rawNode of workflowJson.nodes) {
    if (!isRecord(rawNode)) continue;
    const data = isRecord(rawNode.data) ? rawNode.data : {};
    const type =
      typeof data.type === "string" ? data.type :
      typeof data.kind === "string" ? data.kind :
      typeof rawNode.type === "string" ? rawNode.type : "";

    if (type === "trigger.twilio_missed_call") hasMissedCall = true;
    if (type === "trigger.phone_call" || type === "ai.voice_conversation") hasVoice = true;
    if (type === "trigger.twilio_inbound_sms") hasSms = true;
  }

  if (hasMissedCall) return "missed_call";
  if (hasVoice) return "voice";
  if (hasSms) return "inbound_sms";
  return "none";
}

/**
 * Derive the RequiredIntegrations flags directly from the node types present
 * in workflowJson, using the REQUIRED_CONNECTORS_BY_TYPE registry.
 * Returns only the integrations the workflow actually needs.
 */
export function deriveRequiredIntegrationsFromWorkflow(
  workflowJson: unknown
): RequiredIntegrations {
  const integrations = emptyRequiredIntegrations();
  if (!isRecord(workflowJson) || !Array.isArray(workflowJson.nodes)) return integrations;

  for (const rawNode of workflowJson.nodes) {
    if (!isRecord(rawNode)) continue;
    const data = isRecord(rawNode.data) ? rawNode.data : {};
    const type =
      typeof data.type === "string" ? data.type :
      typeof data.kind === "string" ? data.kind :
      typeof rawNode.type === "string" ? rawNode.type : "";
    if (!type) continue;

    const connector =
      typeof data.connector === "string" ? data.connector.toLowerCase() : "";
    const combined = `${type} ${connector}`.toLowerCase();

    // Vapi / voice AI
    if (type === "ai.voice_conversation" || type === "action.start_vapi_call" ||
        type === "trigger.vapi_tool_call" || combined.includes("vapi")) {
      integrations.vapi = true;
    }

    // Phone / Twilio (call routing/forwarding/voice triggers only - exclude SMS)
    const isVoiceTrigger = type === "trigger.phone_call" || type === "trigger.twilio_missed_call";
    const isTwilioVoice = combined.includes("phone_provider") || 
      (combined.includes("twilio") && !combined.includes("sms"));
    if (isVoiceTrigger || isTwilioVoice) {
      integrations.phone = true;
      integrations.twilio = true;
    }

    // SMS
    if (type === "trigger.twilio_inbound_sms" || type === "action.send_sms" ||
        type === "communication.send_sms" || combined.includes("sms")) {
      integrations.sms = true;
    }

    // WhatsApp
    if (
      type === "trigger.whatsapp_message_received" ||
      type === "action.send_whatsapp" ||
      type === "communication.send_whatsapp" ||
      combined.includes("whatsapp")
    ) {
      integrations.whatsapp = true;
    }

    // Google Calendar
    if (type === "calendar.availability" || type === "calendar.book_appointment" ||
        type === "action.google_calendar_availability" ||
        type === "action.google_calendar_create_appointment" ||
        combined.includes("google_calendar") || combined.includes("calendar")) {
      integrations.calendar = true;
    }

    // Gmail / Email (triven_mail counts as email too)
    if (type === "integration.gmail_read_emails" || type === "integration.gmail_send_email" ||
        type === "integration.gmail_create_draft" || type === "trigger.gmail_new_email" ||
        type === "communication.send_email" || combined.includes("gmail") ||
        combined.includes("email") || combined.includes("triven_mail")) {
      integrations.email = true;
    }

    // CRM
    if (combined.includes("crm")) integrations.crm = true;

    // Telegram
    if (type === "trigger.telegram_message" || combined.includes("telegram")) {
      integrations.telegram = true;
    }

    // Calendly (Architect scheduling connector — maps to calendar requirement for now)
    if (combined.includes("calendly")) {
      integrations.calendar = true;
    }

    // Webhook
    if (type === "trigger.webhook" || type === "action.http_request") {
      integrations.webhook = true;
    }
  }

  return integrations;
}

/**
 * Generate a contextual success message for the deployment confirmation screen,
 * based on the active trigger kind of the deployed workflow.
 */
export function getAgentSuccessMessage(triggerKind: WorkflowTriggerKind): {
  headline: string;
  body: string;
  capabilities: string[];
} {
  switch (triggerKind) {
    case "missed_call":
      return {
        headline: "Your missed-call agent is live 🎉",
        body: "Every missed call now gets an instant AI text-back, keeping leads engaged before they go elsewhere.",
        capabilities: [
          "Detect missed calls on your Triven number",
          "Send a personalised text within 30 seconds",
          "Capture leads and book appointments automatically"
        ]
      };
    case "inbound_sms":
      return {
        headline: "Your SMS agent is live 🎉",
        body: "Your AI will now respond to every inbound text instantly, 24/7, without you lifting a finger.",
        capabilities: [
          "Reply to incoming SMS messages instantly",
          "Answer FAQs and capture lead details",
          "Escalate complex requests to your team"
        ]
      };
    case "voice":
      return {
        headline: "Your AI receptionist is live 🎉",
        body: "Your AI now answers every call, checks availability, books appointments, and sends follow-ups automatically.",
        capabilities: [
          "Answer calls instantly on your Triven number",
          "Check calendar availability in real time",
          "Book appointments and send email confirmations"
        ]
      };
    default:
      return {
        headline: "Your agent is live 🎉",
        body: "Your AI workflow is now running automatically. Sit back and let it work.",
        capabilities: [
          "Process incoming triggers automatically",
          "Execute your custom workflow steps",
          "Capture and sync data to your systems"
        ]
      };
  }
}

