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
  | "SUSPENDED";

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
  status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED";
  tags: string[];
  requiredConnectors: string[];
  supportedLlms: string[];
  installCount?: number;
  createdAt: string;
  workflow?: ArchitectWorkflow | null;
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

export type ArchitectConversationTestResult = {
  reply: string;
  transcript: ArchitectConversationMessage[];
  executedNodes: WorkflowRunLog[];
  toolCalls: ArchitectConversationToolCall[];
  finalOutput: Record<string, unknown>;
  simulated: true;
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