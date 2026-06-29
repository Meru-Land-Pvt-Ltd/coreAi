import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
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
