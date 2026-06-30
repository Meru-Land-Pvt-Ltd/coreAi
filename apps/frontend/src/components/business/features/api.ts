import { apiDelete, apiGet, apiPost } from "@/lib/api";

export type BusinessFaq = {
  question: string;
  answer: string;
};

export type BusinessKnowledgeItem = {
  title: string;
  content: string;
};

export type BusinessHoursItem = {
  day: string;
  open?: string;
  close?: string;
  closed: boolean;
};

export type BusinessSetupInput = {
  businessName: string;
  businessType: string;
  forwardToPhone: string;
  bookingUrl?: string;
  teamPhone?: string;
  timeZone?: string;
  tone?: string;
  escalationRules?: string;
  services: string[];
  faqs: BusinessFaq[];
  hours: BusinessHoursItem[];
  knowledge: BusinessKnowledgeItem[];
  vapiAssistantId?: string;
  vapiPhoneNumberId?: string;
  voice?: string;
  voiceId?: string;
  voiceProvider?: string;
  answeringMode?: string;
  calendarId?: string;
  listingId?: string;
  workflowId?: string;
};

export type ConnectorRequirement = {
  connector: string;
  label: string;
  ownedBy: "buyer" | "platform";
  scopes?: string[];
  config?: string[];
  optional?: boolean;
  note: string;
};

export type SetupChecklistItem = {
  key: string;
  label: string;
  required: boolean;
  complete: boolean;
  blocker?: string;
};

export type BusinessSetupData = {
  business: { id: string; name: string; type: string } | null;
  profile: {
    bookingUrl: string | null;
    teamPhone: string | null;
    calendarId: string | null;
    timeZone: string | null;
    tone: string | null;
    escalationRules: string | null;
    services: string[];
    faqs: BusinessFaq[];
    hours: BusinessHoursItem[];
    vapiAssistantId: string | null;
    vapiPhoneNumberId: string | null;
  } | null;
  phoneNumber: {
    phoneNumber: string;
    forwardToPhone: string | null;
    twilioPhoneNumberSid: string | null;
  } | null;
  installedAgent: { id: string; name: string; status: string } | null;
  knowledge: BusinessKnowledgeItem[];
  calendar: { connected: boolean; email: string | null };
  webhooks: {
    voice: string;
    voiceAction: string;
    sms: string;
    vapi: string;
  } | null;
  assignedPhoneNumber?: string;
  /** Connectors the buyer must set up to run this agent live (from the workflow). */
  requiredConnectors?: ConnectorRequirement[];
  /** Per-item install readiness; drives the buyer checklist + live-deploy gate. */
  checklist?: SetupChecklistItem[];
  readyToDeploy?: boolean;
  blockers?: string[];
  /** Buyer's persisted voice choice (prefills the voice picker). */
  voiceSelection?: { name: string | null; voiceId: string | null; provider: string | null } | null;
  /** Buyer's persisted answering mode (prefills the routing selector). */
  answeringMode?: string | null;
};

/** A marketplace listing as the buyer sees it (used to read requiredConnectors pre-install). */
export type MarketplaceListing = {
  id: string;
  name: string;
  shortDescription: string;
  requiredConnectors: string[];
  workflowId: string | null;
};

export type BusinessCalendarStatus = {
  connected: boolean;
  email: string | null;
  provider?: string;
  expiresAt?: string | null;
  scopes?: string[];
};

export function getBusinessSetup() {
  return apiGet<BusinessSetupData>("/business/setup");
}

export function saveBusinessSetup(body: BusinessSetupInput) {
  return apiPost<BusinessSetupData>(
    "/business/setup",
    body as unknown as Record<string, unknown>
  );
}

/**
 * Read a marketplace listing (buyer-accessible). Used so the setup checklist can
 * show the agent's required connectors immediately after install, before the
 * first save resolves the workflow server-side.
 */
export function getMarketplaceListing(listingId: string) {
  return apiGet<{ listing: MarketplaceListing }>(`/architect/listings/${listingId}`);
}

export function getBusinessCalendarStatus() {
  return apiGet<BusinessCalendarStatus>("/business/connectors/google-calendar/status");
}

export function getBusinessCalendarOAuthUrl() {
  return apiGet<{ url: string }>("/business/connectors/google-calendar/oauth-url");
}

export function disconnectBusinessCalendar() {
  return apiDelete<null>("/business/connectors/google-calendar");
}
