import type { BuyerSetupField } from "@coreai/shared";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";

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

/** One architect-defined buyer setup field, as defined on the listing (shared shape). */
export type BuyerSetupFieldDef = BuyerSetupField;

/** A buyer's answer to an architect-defined setup field. */
export type BuyerCustomFieldValue = {
  key: string;
  label: string;
  value: string | string[] | boolean;
};

export type BusinessSetupInput = {
  businessName: string;
  businessType: string;
  assistantName?: string;
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
  contactName?: string;
  customInstructions?: string;
  silenceRepromptCount?: number;
  silenceRepromptMessage1?: string;
  silenceRepromptMessage2?: string;
  goodbyeMessage?: string;
  /** Appointment timing config — drives availability slot generation. */
  scheduling?: {
    serviceDurationMinutes?: number;
    bufferMinutes?: number;
    maximumSlotsToShow?: number;
    openHour?: number;
    closeHour?: number;
    bookingLabel?: string;
  };
  /** Architect-defined setup answers (the listing's requiredBuyerSetup fields). */
  customFields?: BuyerCustomFieldValue[];
  selectedPlatformPhoneNumberId?: string;
  selectedPhoneNumber?: string;
  /** true only on the final Deploy — incremental saves skip the Vapi assistant build. */
  deploy?: boolean;
  calendarId?: string;
  listingId?: string;
  workflowId?: string;
};

export type PlatformPhoneOption = {
  id: string;
  phoneNumber: string;
  provider: string;
  status: "AVAILABLE" | "ASSIGNED" | "DISABLED";
  assignedToThisBusiness: boolean;
  /** True for the number currently assigned to this business (server-computed). */
  selected?: boolean;
  /** e.g. { voice: true, sms: false, mms: false } */
  capabilities?: { voice?: boolean; sms?: boolean; mms?: boolean } | null;
  country?: string | null;
  region?: string | null;
  locality?: string | null;
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
  assistantName?: string | null;
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
  /** Buyer's persisted contact name + custom instructions + silence policy. */
  contactName?: string | null;
  customInstructions?: string | null;
  /** Buyer's persisted answers to architect-defined setup fields. */
  customFields?: BuyerCustomFieldValue[];
  /** Snapshot of the listing's buyer setup schema saved with the installed agent. */
  buyerSetupSchema?: BuyerSetupFieldDef[];
  silence?: {
    repromptCount: number | null;
    reprompt1: string | null;
    reprompt2: string | null;
    goodbye: string | null;
  } | null;
  availablePhoneNumbers?: PlatformPhoneOption[];
  selectedPlatformPhoneNumberId?: string | null;
  installedAgentId?: string | null;
  vapiAssistantId?: string | null;
};

export type CallRoutingCheck = {
  key: string;
  label: string;
  ok: boolean;
  message?: string;
};

export type CallRoutingResult = {
  ok?: boolean;
  number: string | null;
  webhookUrl: string;
  readyForCall: boolean;
  resolveReason: string | null;
  checks: CallRoutingCheck[];
};

/** A marketplace listing as the buyer sees it (used to read requiredConnectors pre-install). */
export type MarketplaceListing = {
  id: string;
  name: string;
  shortDescription: string;
  requiredConnectors: string[];
  workflowId: string | null;
  /** Architect-defined setup fields the buyer fills in during install. */
  requiredBuyerSetup?: BuyerSetupFieldDef[] | null;
  /** Architect's setup notes shown to the buyer above the agent-specific fields. */
  buyerSetupInstructions?: string | null;
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
  return apiPost<BusinessSetupData>("/business/setup", body);
}

/**
 * Read a marketplace listing (buyer-accessible). Used so the setup checklist can
 * show the agent's required connectors immediately after install, before the
 * first save resolves the workflow server-side.
 */
export function getMarketplaceListing(listingId: string) {
  return apiGet<{ listing: MarketplaceListing }>(`/architect/listings/public/${listingId}`);
}

/** Available CoreAI/platform phone numbers the buyer can select (Step 2). */
export function getBusinessPhoneNumbers() {
  return apiGet<{ numbers: PlatformPhoneOption[] }>("/business/setup/phone-numbers");
}

export function testCallRouting(body: { phoneNumber?: string; selectedPlatformPhoneNumberId?: string }) {
  return apiPost<CallRoutingResult>("/business/setup/test-call-routing", body);
}

/* ---- Mail Setup (proxy email alias on reply.triven.ai) ---- */

export type BusinessEmailAliasData = {
  id: string;
  localPart: string;
  domain: string;
  emailAddress: string;
  displayName: string;
  forwardToEmail: string | null;
  replyHandlingMode: "TRIVEN_INBOX" | "FORWARD_ONLY" | "TRIVEN_AND_FORWARD";
  status: "ACTIVE" | "DISABLED" | "ARCHIVED";
};

export type BusinessMailSetupData = {
  alias: BusinessEmailAliasData | null;
  suggestedLocalPart: string;
  domain: string;
  sesConfigured: boolean;
};

export type MailSetupInput = {
  localPart: string;
  displayName: string;
  forwardToEmail?: string;
  replyHandlingMode: BusinessEmailAliasData["replyHandlingMode"];
};

export function getBusinessMailSetup() {
  return apiGet<BusinessMailSetupData>("/business/mail-setup");
}

export function checkMailAliasAvailability(localPart: string) {
  return apiGet<{ localPart: string; available: boolean; reason: string | null }>(
    `/business/mail-setup/check?localPart=${encodeURIComponent(localPart)}`
  );
}

export function saveBusinessMailSetup(body: MailSetupInput) {
  return apiPost<{ alias: BusinessEmailAliasData }>("/business/mail-setup", body);
}

export function sendMailSetupTestEmail(to?: string) {
  return apiPost<{ messageId: string; dryRun: boolean }>("/business/mail-setup/test-email", to ? { to } : {});
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

export type BusinessSettingsProfile = {
  businessId: string;
  fullName: string;
  email: string;
  phone: string;
  profilePhotoUrl: string | null;
  businessName: string;
  businessType: string;
  teamPhone: string;
  bookingUrl: string;
  timeZone: string;
  businessAddress: string;
};

export function getBusinessSettingsProfile() {
  return apiGet<{ profile: BusinessSettingsProfile }>("/business/settings/profile");
}

export function saveBusinessSettingsProfile(body: {
  businessId: string;
  fullName?: string;
  phone?: string;
  email?: string;
  businessName?: string;
  businessType?: string;
  teamPhone?: string;
  bookingUrl?: string;
  timeZone?: string;
  businessAddress?: string;
}) {
  return apiPut<{
    profile: BusinessSettingsProfile;
    token?: string;
    user?: {
      id: string;
      fullName: string | null;
      email: string;
      role: "BUSINESS";
      profilePhotoUrl: string | null;
    };
  }>("/business/settings/profile", body);
}

export function saveBusinessProfilePhoto(photoDataUrl: string) {
  return apiPut<{
    profile: {
      fullName: string | null;
      email: string;
      phone: string | null;
      profilePhotoUrl: string | null;
    };
  }>("/business/settings/profile/photo", { photoDataUrl });
}

export function requestBusinessEmailChange(email: string) {
  return apiPost<{ email: string; sent: boolean }>("/business/settings/profile/email/request", { email });
}

export function verifyBusinessEmailChange(body: { email: string; code: string }) {
  return apiPost<{ email: string; verified: boolean }>("/business/settings/profile/email/verify", body);
}
