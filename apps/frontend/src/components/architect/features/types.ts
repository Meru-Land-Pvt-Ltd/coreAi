import type { ProductSpec } from "@coreai/shared";
import type { ContentWidth, DesignConfig, FaceBlueprint, FaceLayoutMap } from "@/components/agent-page/types";

export type ArchitectProfile = {
  id: string;
  userId: string;
  title: string | null;
  bio: string | null;
  portfolioUrl: string | null;
  skills: string[];
  hourlyRateCents: number | null;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  rating: number;
  completedJobs: number;
};

export type ArchitectListingStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED"
  | "PAUSED";

export type ArchitectWorkflowListing = {
  id: string;
  name: string;
  status: ArchitectListingStatus;
  createdAt: string;
};

export type ArchitectWorkflow = {
  id: string;
  name: string;
  description: string | null;
  /** What the architect TOLD the AI Builder they are building — never inferred. */
  purpose?: string | null;
  workflowJson: {
    nodes: unknown[];
    edges: unknown[];
  };
  isTemplate: boolean;
  createdAt: string;
  // Latest listing for this workflow (most recent first), included by GET /architect/workflows.
  listings?: ArchitectWorkflowListing[];
};

export type ArchitectListing = {
  id: string;
  workflowId: string | null;
  name: string;
  shortDescription: string;
  description: string | null;
  priceCents: number;
  /** Billing model stored in the DB: FREE | ONE_TIME | SUBSCRIPTION */
  pricingModel?: "FREE" | "ONE_TIME" | "SUBSCRIPTION" | null;
  status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED" | "PAUSED";
  /** Review-team feedback when status is REJECTED (or soft-delete marker). */
  rejectionReason?: string | null;
  tags: string[];
  requiredConnectors: string[];
  supportedLlms: string[];
  installCount?: number;
  createdAt: string;
  updatedAt?: string;
  submittedAt?: string | null;
  workflow?: ArchitectWorkflow | null;
  /** Configure / marketplace fields surfaced for My Agents cards */
  tagline?: string | null;
  category?: string | null;
  industryTags?: string[];
  iconUrl?: string | null;
  coverUrl?: string | null;
  includedFeatures?: string[];
  screenshotUrls?: string[];
  /** Live card metrics */
  executionCount?: number;
  revenueCents?: number;
  rating?: number | null;
  draftProgress?: {
    stepsCompleted: number;
    stepsTotal: number;
    percent: number;
    missing: string[];
  } | null;
  reviewProgress?: {
    percent: number;
    passed: number;
    total: number;
    items: Array<{ label: string; done: boolean }>;
  } | null;
};

export type ArchitectProject = {
  id: string;
  title: string;
  requirementBrief: string;
  requiredConnectors: string[];
  preferredLlms: string[];
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  status: string;
  createdAt: string;
};

export type ArchitectProposal = {
  id: string;
  coverLetter: string;
  bidAmountCents: number | null;
  etaDays: number | null;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
  createdAt: string;
  project: ArchitectProject;
};

export type ArchitectSummary = {
  user: {
    id: string;
    email: string;
    role: "ARCHITECT";
    fullName: string | null;
  };
  profile: ArchitectProfile | null;
  stats: {
    workflows: number;
    listings: number;
    proposals: number;
    openProjects: number;
  };
  recent: {
    workflows: ArchitectWorkflow[];
    listings: ArchitectListing[];
    proposals: ArchitectProposal[];
  };
};

export type WorkflowRunLog = {
  nodeId: string;
  label: string;
  status: "success" | "waiting" | "error" | "skipped";
  message: string;
  output?: unknown;
};

export type WorkflowRunResult = {
  workflowId: string;
  logs: WorkflowRunLog[];
  context: Record<string, unknown>;
};

export type ArchitectConversationMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

export type ArchitectConversationToolCall = {
  name: string;
  status: "simulated" | "skipped" | "error";
  message: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
};

export type ArchitectTestCalendarEvent = {
  testEventId?: string;
  title: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  htmlLink: string | null;
  status: "SIMULATED" | "CREATED";
  description?: string;
};

export type ArchitectConversationTestResult = {
  reply: string;
  transcript: ArchitectConversationMessage[];
  executedNodes: WorkflowRunLog[];
  toolCalls: ArchitectConversationToolCall[];
  finalOutput: Record<string, unknown>;
  simulated: true;
  executionMode?: "ARCHITECT_DRY_RUN" | "BUSINESS_TEST";
  timeZone?: string | null;
  testSessionId?: string | null;
  calendarEvent?: ArchitectTestCalendarEvent | null;
  /** This turn's booking failure (e.g. CALENDAR_NOT_CONNECTED) — actionable. */
  calendarError?: { code: string; message: string; remediation: string } | null;
  configError?: { code: string; message: string; remediation: string } | null;
};

export type GmailConnectorStatus = {
  connected: boolean;
  email: string | null;
  scopes?: string[];
  // True when the granted Google scopes include calendar.events — one Google
  // connect powers Gmail + Calendar for architect test runs.
  calendarConnected?: boolean;
};

export type CalendlyConnectorStatus = {
  connected: boolean;
  email: string | null;
  name: string | null;
  timezone: string | null;
  userUri: string | null;
  organizationUri: string | null;
};

/** Option for Calendly event-type / event / invitee pickers. */
export type CalendlyPickerOption = {
  value: string;
  label: string;
  uri: string;
  schedulingUrl?: string;
};

/** Frontend-safe config for a Vapi-powered browser call test session. */
export type ArchitectVapiBrowserTestSession = {
  publicKey: string;
  assistantId: string;
  businessId: string;
  assistantName: string;
  businessName: string;
  model: string;
  voiceName: string;
  voiceId: string | null;
  transcriber: string;
  dryRun: true;
  /** {{variables}} nothing could fill — stripped before the prompt reached Vapi. */
  unresolvedVariables?: string[];
  /** Set when the requested LLM could not be deployed as asked (e.g. Anthropic unavailable). */
  modelNotice?: string | null;
};

export type ArchitectVapiBrowserTestCallEndReason = {
  callId: string;
  status: string | null;
  endedReason: string | null;
  /** Human-readable, secret-free explanation of why the call ended. */
  message: string | null;
};

export type ArchitectTestDeploymentStatus = {
  workflowId: string;
  businessId: string | null;
  installedAgentId: string | null;
  assignedPhoneNumber: string | null;
  vapiAssistantId: string | null;
  calendarConnected: boolean;
  calendarEmail: string | null;
  webhookUrl: string;
  status: "NOT_STARTED" | "READY" | "ERROR";
};

export type ArchitectTestDeploymentInput = {
  businessName?: string;
  businessType?: string;
  calendarId?: string;
  timeZone?: string;
  services?: string[];
  faqs?: string[];
  knowledge?: string[];
};
export type AgentPageTemplate = "chat" | "voice" | "media" | "form";

export type AgentPageConfig = {
  slug: string;
  template: AgentPageTemplate;
  headline: string | null;
  welcomeMessage: string | null;
  suggestedPrompts: string[];
  accentColor: string | null;
  status: "LIVE";
};

export type AgentPageManageData = {
  page: AgentPageConfig | null;
  url: string | null;
  defaultTemplate: AgentPageTemplate;
  /**
   * Non-null only when the workflow's canvas contains product blocks — the
   * Test preview (and the live page) then assemble the customer interface
   * from these blocks instead of a built-in template. Optional so older
   * fixtures without the field keep compiling; absent reads as null.
   */
  blueprint?: FaceBlueprint | null;
  /**
   * The saved AI Builder config, resolved to a full DesignConfig by the
   * backend. Optional so older fixtures keep compiling; absent reads as the
   * design defaults.
   */
  design?: DesignConfig | null;
  /**
   * The saved ProductSpec — the whole product the AI Builder's Build mode
   * wrote (pages, sections, copy, wires). Optional so older fixtures keep
   * compiling; absent reads as null (no product built yet).
   */
  product?: ProductSpec | null;
};

export type AgentPageUpdateBody = {
  template?: AgentPageTemplate;
  headline?: string;
  welcomeMessage?: string;
  suggestedPrompts?: string[];
  /** null clears the accent back to the default; omitting leaves it unchanged. */
  accentColor?: string | null;
  /**
   * Design dial patches riding the manage PATCH (additive). The Arrange
   * Editor sends the FULL layout map on every drop ({} clears it); the
   * Preview toolbar sends `contentWidth`; other saved dials are preserved
   * server-side.
   */
  design?: {
    layout?: FaceLayoutMap;
    contentWidth?: ContentWidth;
  };
};

/** One turn of the AI Builder conversation, oldest first. */
export type DesignChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type DesignChatBody = {
  instruction: string;
  /** Up to the last 10 turns, for follow-ups like "a bit darker". */
  history?: DesignChatMessage[];
};

/**
 * POST /agent-pages/manage/:workflowId/product-chat — the Product Architect.
 * Longer instructions than the styling chat allows (800 vs 500) because this
 * one is given a whole brief, not a single dial to turn.
 */
export type ProductChatBody = {
  instruction: string;
  history?: DesignChatMessage[];
};

export type ProductChatData = {
  reply: string;
  /** The saved blueprint. Shape is validated server-side before it is stored. */
  product: unknown;
  /** Ids of pages this instruction created — empty when it only edited. */
  pagesCreated: string[];
  /** Set when legal pages were generated and need the architect's eye. */
  legalNote: string | null;
};

/**
 * POST /agent-pages/manage/:workflowId/design-chat result. `patch` is the
 * validated set of dials the AI Builder just turned — empty when the ask
 * was impossible; `design` is the full post-patch DesignConfig.
 */
export type DesignChatData = {
  reply: string;
  patch: Record<string, unknown>;
  design: DesignConfig;
  page: Partial<AgentPageConfig> | null;
  /**
   * True when the AI Builder also changed the saved canvas graph (added or
   * rewired pieces), so the builder must reload nodes/edges from the server —
   * not just refetch the page design. Additive: older backends omit it.
   */
  graphChanged?: boolean;
};

/**
 * POST /agent-pages/manage/:workflowId/smart-compose — the AI Composer.
 * Reads every node's declarations and writes the MINIMUM interface out of
 * our pre-built components. No request body: the workflow graph is the brief.
 */
export type SmartComposeData = {
  reply: string;
  /** The composed Product Spec. Validated server-side before it is stored. */
  product: unknown;
  /** False when the workflow declared nothing worth composing. */
  composed: boolean;
  /** How many asks the composer placed on the page. */
  asksPlaced: number;
  /** How many duplicate node inputs collapsed into shared fields — merging is the composer's core job. */
  merged: number;
};

/**
 * POST /agent-pages/manage/:workflowId/smart-designer — the feedback loop.
 * The architect says what the composed interface got wrong ("this box isn't
 * capturing email separately") and the AI Builder fixes the spec.
 */
export type BuilderPageBody = {
  instruction: string;
  /** Up to the last 10 turns, for follow-ups like "actually make it optional". */
  history?: DesignChatMessage[];
};

export type BuilderPageData = {
  reply: string;
  /** The updated Product Spec after this instruction (unchanged on a redirect). */
  product: unknown;
  /**
   * "packaging" when the ask was outside the product interface (privacy page,
   * landing page, sell page) and was redirected to Packaging — not a failure.
   */
  boundary: "packaging" | null;
};
