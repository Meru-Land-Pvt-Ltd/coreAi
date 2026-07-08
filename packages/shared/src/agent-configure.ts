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
  | "vapi"
  | "twilio";

export type RequiredIntegrations = Record<RequiredIntegrationKey, boolean>;

export type RequiredIntegrationDef = {
  key: RequiredIntegrationKey;
  label: string;
  description: string;
};

export const REQUIRED_INTEGRATION_DEFS: RequiredIntegrationDef[] = [
  { key: "phone", label: "Phone number", description: "A line to receive and place calls" },
  { key: "sms", label: "SMS messaging", description: "Send and receive text messages" },
  { key: "calendar", label: "Calendar access", description: "To read and book appointments" },
  { key: "email", label: "Email account", description: "For confirmations and follow-ups" },
  { key: "crm", label: "CRM connection", description: "Sync captured leads automatically" },
  { key: "webhook", label: "Custom webhook", description: "Send events to the buyer's systems" },
  { key: "vapi", label: "AI voice (Vapi)", description: "AI voice conversations with callers" },
  { key: "twilio", label: "Telephony (Twilio)", description: "Call forwarding and missed-call detection" }
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

/** One field the buyer must fill in during their own setup (no secrets here). */
export type BuyerSetupField = {
  key: string;
  label: string;
  type: "text" | "phone" | "url" | "select" | "textarea";
  required: boolean;
  helper?: string;
};

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
  "trigger.phone_call": "Inbound phone call handling",
  "trigger.twilio_missed_call": "Missed call detection and automatic follow-up",
  "trigger.twilio_inbound_sms": "Two-way SMS conversation handling",
  "trigger.vapi_tool_call": "Voice AI call handling",
  "ai.voice_conversation": "Natural AI voice conversation",
  "ai.context_reply": "AI replies based on your business context",
  "calendar.availability": "Real-time calendar availability checking",
  "action.google_calendar_availability": "Real-time calendar availability checking",
  "calendar.book_appointment": "Appointment booking into connected calendar",
  "action.google_calendar_create_appointment": "Google Calendar appointment scheduling",
  "communication.send_sms": "Automated SMS confirmation and follow-up",
  "action.send_sms": "Automated SMS confirmation and follow-up",
  "integration.gmail_send_email": "Automated email confirmation and follow-up",
  "integration.gmail_create_draft": "Automated email confirmation and follow-up",
  "integration.gmail_read_emails": "Incoming email monitoring",
  "trigger.gmail_new_email": "Incoming email monitoring",
  "action.start_vapi_call": "Voice AI call handling",
  "action.save_lead": "Lead capture and CRM/webhook sync",
  "action.update_lead": "Lead capture and CRM/webhook sync",
  "trigger.webhook": "Lead capture and CRM/webhook sync",
  "action.http_request": "Lead capture and CRM/webhook sync",
  "action.save_conversation_message": "Full conversation history logging",
  "action.human_handoff": "Smart escalation to your team",
  "flow.end": "Complete call flow with proper ending"
};

/** Keyword fallback for node types/connectors without an exact mapping. */
function includedFeatureFallback(nodeType: string, connector: string): string | null {
  const haystack = `${nodeType} ${connector}`.toLowerCase();
  if (haystack.includes("twilio")) return "Phone and SMS communication support";
  if (haystack.includes("vapi") || haystack.includes("voice")) return "Voice AI call handling";
  if (haystack.includes("sms")) return "Automated SMS confirmation and follow-up";
  if (haystack.includes("calendar")) return "Google Calendar appointment scheduling";
  if (haystack.includes("gmail") || haystack.includes("email")) return "Automated email confirmation and follow-up";
  if (haystack.includes("crm") || haystack.includes("lead") || haystack.includes("webhook")) {
    return "Lead capture and CRM/webhook sync";
  }
  if (haystack.includes("phone") || haystack.includes("call")) return "Inbound phone call handling";
  return null;
}

const MAX_GENERATED_FEATURES = 5;

type FlowNode = { id: string; type: string; connector: string };

/**
 * Generate buyer-facing "What's included" bullets from workflowJson.
 *
 * Only CONNECTED nodes count: with a trigger present, nodes reachable from a
 * trigger by following edges (in traversal order); without one, nodes that
 * participate in at least one edge. Isolated nodes are ignored. Bullets are
 * deduped and capped at 5.
 */
export function generateIncludedFeaturesFromWorkflow(workflowJson: unknown): string[] {
  if (!isRecord(workflowJson)) return [];

  const rawNodes = Array.isArray(workflowJson.nodes) ? workflowJson.nodes : [];
  const rawEdges = Array.isArray(workflowJson.edges) ? workflowJson.edges : [];

  const nodes: FlowNode[] = rawNodes.filter(isRecord).map((node) => {
    const data = isRecord(node.data) ? node.data : {};
    return {
      id: typeof node.id === "string" ? node.id : "",
      type: typeof data.type === "string" ? data.type : typeof data.kind === "string" ? data.kind : "",
      connector: typeof data.connector === "string" ? data.connector : ""
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

  if (edges.length === 0) return [];

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

  const triggers = nodes.filter((node) => node.type.startsWith("trigger.") && connectedIds.has(node.id));

  // With a trigger: walk the graph from it so bullets follow the flow order.
  // Without one: use every edge-connected node in canvas order.
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
  } else {
    for (const node of nodes) {
      if (connectedIds.has(node.id)) orderedIds.push(node.id);
    }
  }

  const features: string[] = [];
  for (const id of orderedIds) {
    const node = nodeById.get(id);
    if (!node) continue;
    const feature =
      INCLUDED_FEATURE_BY_NODE_TYPE[node.type] ?? includedFeatureFallback(node.type, node.connector);
    if (feature && !features.includes(feature)) features.push(feature);
    if (features.length >= MAX_GENERATED_FEATURES) break;
  }

  return features;
}

export function emptyRequiredIntegrations(): RequiredIntegrations {
  return {
    phone: false,
    sms: false,
    calendar: false,
    email: false,
    crm: false,
    webhook: false,
    vapi: false,
    twilio: false
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
      integrations.twilio = true;
      integrations.phone = true;
      integrations.sms = true;
    }
    if (key.includes("vapi") || key.includes("voice")) integrations.vapi = true;
    if (key.includes("calendar")) integrations.calendar = true;
    if (key.includes("gmail") || key.includes("email")) integrations.email = true;
    if (key.includes("sms")) integrations.sms = true;
    if (key.includes("phone")) integrations.phone = true;
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
    ? template.requiredBuyerSetup.filter(isRecord).map((field) => ({
        key: cleanString(field.key, ""),
        label: cleanString(field.label, ""),
        type: (["text", "phone", "url", "select", "textarea"] as const).includes(
          field.type as BuyerSetupField["type"]
        )
          ? (field.type as BuyerSetupField["type"])
          : "text",
        required: cleanBoolean(field.required, true),
        helper: typeof field.helper === "string" ? field.helper : undefined
      }))
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
      tagline: cleanString(basics.tagline, base.basics.tagline),
      category: cleanString(basics.category, base.basics.category),
      industryTags: normalizeIndustryTags(cleanStringArray(basics.industryTags, base.basics.industryTags)),
      iconUrl: cleanString(basics.iconUrl, base.basics.iconUrl),
      visibility: basics.visibility === "private" ? "private" : "public",
      shortDescription: cleanString(basics.shortDescription, base.basics.shortDescription)
    },
    media: {
      fullDescription: cleanString(media.fullDescription, base.media.fullDescription),
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

  // Step 3 is Pricing in the Configure flow; step 4 is Requirements & Compliance.
  if (data.pricing.pricingModel !== "free" && data.pricing.price <= 0) {
    issues.push({ step: 3, field: "price", message: "Set a price greater than $0 for paid agents." });
  }

  const checks = data.compliance.complianceChecks;
  if (!checks.guidelines || !checks.tested || !checks.accurate || !checks.terms) {
    issues.push({ step: 4, field: "complianceChecks", message: "Complete all compliance checks in Step 4 before submitting." });
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
