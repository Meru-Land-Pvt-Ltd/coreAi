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
  status: "success" | "waiting" | "error";
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