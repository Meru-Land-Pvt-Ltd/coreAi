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

export type GmailConnectorStatus = {
  connected: boolean;
  email: string | null;
};