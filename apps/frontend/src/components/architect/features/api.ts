import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import type {
  ArchitectListing,
  ArchitectProfile,
  ArchitectProject,
  ArchitectProposal,
  ArchitectSummary,
  ArchitectWorkflow,
  GmailConnectorStatus,
  WorkflowRunResult
} from "./types";

export function getArchitectSummary() {
  return apiGet<ArchitectSummary>("/architect/summary");
}

export function getArchitectProfile() {
  return apiGet<{ profile: ArchitectProfile | null }>("/architect/profile");
}

export function saveArchitectProfile(body: {
  title?: string;
  bio?: string;
  portfolioUrl?: string;
  skills: string[];
  hourlyRateCents?: number;
}) {
  return apiPut<{ profile: ArchitectProfile }>("/architect/profile", body);
}

export function getArchitectWorkflows() {
  return apiGet<{ workflows: ArchitectWorkflow[] }>("/architect/workflows");
}

export function getArchitectWorkflow(workflowId: string) {
  return apiGet<{ workflow: ArchitectWorkflow }>(`/architect/workflows/${workflowId}`);
}

export function createArchitectWorkflow(body: {
  name: string;
  description?: string;
  isTemplate: boolean;
  workflowJson: {
    nodes: unknown[];
    edges: unknown[];
  };
}) {
  return apiPost<{ workflow: ArchitectWorkflow }>("/architect/workflows", body);
}

export function updateArchitectWorkflow(
  workflowId: string,
  body: {
    name?: string;
    description?: string;
    isTemplate?: boolean;
    workflowJson?: {
      nodes: unknown[];
      edges: unknown[];
    };
  }
) {
  return apiPut<{ workflow: ArchitectWorkflow }>(`/architect/workflows/${workflowId}`, body);
}

export type DentalDeployment = {
  businessId: string;
  workflowId: string;
  assignedNumber: string | null;
  assistantId: string;
  assistantCreated: boolean;
  webhookUrl: string;
  nodesDeployed: string[];
  missingNodes: string[];
};

/** Deploy the builder workflow as a live Vapi voice agent (creates the assistant + binds the number). */
export function deployArchitectWorkflow(workflowId: string) {
  return apiPost<{ deployment: DentalDeployment }>(
    `/architect/workflows/${workflowId}/deploy`,
    {}
  );
}

export type TemplateCard = {
  id: string;
  slug: string;
  title: string;
  category: string;
  difficulty: string;
  nodeCount: number;
  description: string;
  forks: number;
  rating: number;
  reviewCount: number;
  tags: string[];
  recommended?: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateDetail = TemplateCard & {
  workflowJson: { nodes: unknown[]; edges: unknown[] };
};

export type TemplateImport = {
  workflowId: string;
  name: string;
  description: string | null;
  workflowJson: { nodes: unknown[]; edges: unknown[] };
};

export function getArchitectTemplates() {
  return apiGet<{ templates: TemplateCard[] }>("/architect/templates");
}

export function getArchitectTemplate(slug: string) {
  return apiGet<{ template: TemplateDetail }>(`/architect/templates/${slug}`);
}

/** Import a template's workflowJson into the current (or a new) workflow. */
export function useArchitectTemplate(slug: string, body: { workflowId?: string } = {}) {
  return apiPost<TemplateImport>(`/architect/templates/${slug}/use`, body);
}

export type ForwardingInstructions = { headline: string; steps: string[]; note: string };

export type PhoneRoutingStatus = {
  configured: boolean;
  businessId: string | null;
  businessName?: string;
  businessType?: string;
  publicBusinessNumber: string | null;
  assignedCoreAiNumber: string | null;
  mode: string;
  isActive: boolean;
  setupStatus: string;
  forwardingInstructions: ForwardingInstructions;
  vapiAssistantId: string | null;
  vapiPhoneNumberId?: string | null;
  workflowId: string | null;
  installedAgentId: string | null;
};

export type PhoneRoutingSetupResult = {
  businessId: string;
  installedAgentId: string;
  workflowId: string | null;
  publicBusinessNumber: string;
  assignedCoreAiNumber: string;
  mode: string;
  isActive: boolean;
  setupStatus: string;
  forwardingInstructions: ForwardingInstructions;
  vapiAssistantId: string | null;
};

export type PhoneRoutingTestResult = {
  resolved: boolean;
  matchedNumber: string | null;
  callerNumber: string;
  businessName?: string;
  businessType?: string;
  workflowId?: string;
  installedAgentId?: string;
  vapiAssistantId?: string | null;
  mode?: string;
  message?: string;
};

export function getPhoneRoutingStatus() {
  return apiGet<PhoneRoutingStatus>("/architect/phone-routing/status");
}

export function setupPhoneRouting(body: {
  publicBusinessNumber: string;
  mode: string;
  workflowId?: string;
  installedAgentId?: string;
}) {
  return apiPost<PhoneRoutingSetupResult>("/architect/phone-routing/setup", body);
}

export function updatePhoneRoutingMode(mode: string) {
  return apiPatch<{ mode: string; assignedCoreAiNumber: string; forwardingInstructions: ForwardingInstructions }>(
    "/architect/phone-routing/mode",
    { mode }
  );
}

export function testPhoneRouting(body: { called: string; from: string }) {
  return apiPost<PhoneRoutingTestResult>("/architect/phone-routing/test", body);
}

export function getArchitectListings() {
  return apiGet<{ listings: ArchitectListing[] }>("/architect/listings");
}

export function createArchitectListing(body: {
  workflowId?: string;
  name: string;
  shortDescription: string;
  description?: string;
  priceCents: number;
  tags: string[];
  requiredConnectors: string[];
  supportedLlms: string[];
}) {
  return apiPost<{ listing: ArchitectListing }>("/architect/listings", body);
}

export function getArchitectProjects() {
  return apiGet<{ projects: ArchitectProject[] }>("/architect/projects");
}

export function submitProjectProposal(
  projectId: string,
  body: {
    coverLetter: string;
    bidAmountCents?: number;
    etaDays?: number;
  }
) {
  return apiPost<{ proposal: ArchitectProposal }>(
    `/architect/projects/${projectId}/proposals`,
    body
  );
}

export function getArchitectProposals() {
  return apiGet<{ proposals: ArchitectProposal[] }>("/architect/proposals");
}

export function deleteArchitectWorkflow(workflowId: string) {
  return apiDelete<{ workflowId: string }>(`/architect/workflows/${workflowId}`);
}

export function runArchitectWorkflowTest(
  workflowId: string,
  body: {
    input?: {
      callerNumber?: string;
      callerName?: string;
      businessId?: string;
      businessOwnerId?: string;
      businessName?: string;
      businessType?: string;
      businessPhoneNumber?: string;
      calendarId?: string;
      timeZone?: string;
      vapiAssistantId?: string;
      vapiPhoneNumberId?: string;
      callStatus?: string;
      callTimestamp?: string;
      missedCallReason?: string;
      bookingUrl?: string;
      teamPhone?: string;
      services?: string[];
      faqs?: string[];
      tone?: string;
      escalationRules?: string;
      knowledge?: string[];
      inboundSmsBody?: string;
      appointmentStartAt?: string;
      appointmentEndAt?: string;
      appointmentService?: string;
    };
  } = {}
) {
  return apiPost<{ run: WorkflowRunResult }>(
    `/architect/workflows/${workflowId}/run-test`,
    body
  );
}

export function runArchitectWorkflowLive(
  workflowId: string,
  body: {
    input?: {
      callerNumber?: string;
      callerName?: string;
      businessId?: string;
      businessOwnerId?: string;
      businessName?: string;
      businessType?: string;
      businessPhoneNumber?: string;
      calendarId?: string;
      timeZone?: string;
      vapiAssistantId?: string;
      vapiPhoneNumberId?: string;
      callStatus?: string;
      callTimestamp?: string;
      missedCallReason?: string;
      bookingUrl?: string;
      teamPhone?: string;
      services?: string[];
      faqs?: string[];
      tone?: string;
      escalationRules?: string;
      knowledge?: string[];
      inboundSmsBody?: string;
      appointmentStartAt?: string;
      appointmentEndAt?: string;
      appointmentService?: string;
    };
  } = {}
) {
  return apiPost<{ run: WorkflowRunResult }>(
    `/architect/workflows/${workflowId}/run-live`,
    body
  );
}

export function getGmailConnectorStatus() {
  return apiGet<GmailConnectorStatus>("/architect/connectors/gmail/status");
}

export function getGmailOAuthUrl() {
  return apiGet<{ url: string }>("/architect/connectors/gmail/oauth-url");
}

export function disconnectGmailConnector() {
  return apiDelete<null>("/architect/connectors/gmail");
}

export function createTwilioBusinessInstallation(body: {
  workflowId: string;
  listingId?: string;
  businessName: string;
  businessType: string;
  twilioPhoneNumber: string;
  twilioPhoneNumberSid?: string;
  forwardToPhone?: string;
  bookingUrl?: string;
  teamPhone?: string;
  calendarId?: string;
  timeZone?: string;
  vapiAssistantId?: string;
  vapiPhoneNumberId?: string;
  services: string[];
  faqs: { question: string; answer: string }[];
  knowledge: { title: string; content: string }[];
  tone?: string;
  escalationRules?: string;
}) {
  return apiPost<{
    business: unknown;
    installedAgent: unknown;
    phoneNumber: unknown;
    webhooks: { voice: string; sms: string; vapi: string };
  }>("/architect/connectors/twilio/business-installations", body);
}
