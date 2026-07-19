import axios from "axios";
import type { BuyerSetupField } from "@coreai/shared";
import { apiClient, apiDelete, apiGet, apiPost, apiPut, type ApiResponse } from "@/lib/api";

/**
 * POST multipart/form-data through the shared authenticated axios client.
 * The Content-Type header is intentionally NOT set here — axios drops the
 * instance-level JSON header for FormData bodies so the browser can set the
 * multipart boundary itself. Errors are normalized to the same ApiResponse
 * shape the JSON helpers in lib/api return.
 */
async function apiPostFormData<T>(path: string, form: FormData): Promise<ApiResponse<T>> {
  try {
    // The shared apiClient defaults Content-Type to application/json at the
    // instance level, which axios keeps even for FormData bodies — the server
    // then can't parse the multipart request. Overriding per-request with
    // multipart/form-data makes axios hand the header to the browser, which
    // sets the real boundary.
    const response = await apiClient.post<ApiResponse<T>>(path, form, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const payload = error.response?.data as Partial<ApiResponse<T>> | undefined;
      const serverError =
        typeof payload?.error === "string" && payload.error.trim() ? payload.error.trim() : undefined;
      const serverMessage =
        typeof payload?.message === "string" && payload.message.trim() ? payload.message.trim() : undefined;

      return {
        success: false,
        error: serverError ?? serverMessage ?? error.message ?? "Something went wrong while connecting to server",
        code: typeof payload?.code === "string" && payload.code.trim() ? payload.code.trim() : "API_ERROR",
        status: error.response?.status
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error occurred",
      code: "UNKNOWN_ERROR"
    };
  }
}

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
  /** Buyer-owned Send Email recipients (To/CC/BCC) — CC/BCC comma-separated. */
  emailRecipients?: {
    recipientType: "customer" | "team" | "custom";
    customRecipient?: string;
    cc?: string;
    bcc?: string;
  };
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
  /** Buyer's persisted Send Email recipients; null until saved. */
  emailRecipients?: {
    recipientType: "customer" | "team" | "custom";
    customRecipient: string;
    cc: string[];
    bcc: string[];
  } | null;
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
  triggerKind?: any;
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
  /** The workflow graph — used to derive trigger kind for setup page UX. */
  workflowJson?: unknown;
  workflow?: any;
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

export function getBusinessSetup(listingId?: string | null) {
  const url = listingId ? `/business/setup?listingId=${encodeURIComponent(listingId)}` : "/business/setup";
  return apiGet<BusinessSetupData>(url);
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

export function sendPhoneOtp(listingId: string, phone: string) {
  return apiPost<{ sent: boolean; devCode?: string }>("/setup/send-otp", { listingId, phone });
}

export function verifyPhoneOtp(listingId: string, phone: string, code: string) {
  return apiPost<{
    verified: boolean;
    verifiedPhone: string;
    platformNumber: string | null;
    platformPhoneNumberId: string | null;
    /** true → the buyer must pick a location and confirm a number next. */
    numberSelectionRequired?: boolean;
    businessId: string;
    installedAgentId: string;
  }>("/setup/verify-otp", { listingId, phone, code });
}

/* ---- Location-based phone number provisioning ---- */

export type PhoneCountryOption = { code: string; name: string };
export type PhoneStateOption = { code: string; name: string };

/** All countries (full ISO list) for the Triven AI number picker. */
export function getPhoneCountries() {
  return apiGet<{ countries: PhoneCountryOption[]; note: string }>("/business/phone-numbers/locations");
}

/** States/provinces of one country (lazy-loaded on country select). */
export function getPhoneStates(country: string) {
  return apiGet<{ states: PhoneStateOption[]; supportsCityFilter: boolean }>(
    `/business/phone-numbers/locations?country=${encodeURIComponent(country)}`
  );
}

/** Cities of one state (lazy-loaded on state select; empty state = country-level cities). */
export function getPhoneCities(country: string, state: string) {
  return apiGet<{ cities: string[] }>(
    `/business/phone-numbers/locations?country=${encodeURIComponent(country)}&state=${encodeURIComponent(state)}`
  );
}

/** Buyer-safe number shape — never carries provider/wholesale cost fields. */
export type AvailablePhoneNumber = {
  phoneNumber: string;
  friendlyName: string;
  country: string;
  region: string | null;
  locality: string | null;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
  numberType: "LOCAL";
  regulatoryNote: string | null;
  checkedAt: string;
};

export type PhoneNumberSearchResult = {
  numbers: AvailablePhoneNumber[];
  exactMatchAvailable: boolean;
  matchLevel: "EXACT_CITY" | "SAME_STATE" | "NATIONAL";
  fallbackOptions: Array<"NEARBY_CITY" | "SAME_STATE" | "NATIONAL" | "TOLL_FREE">;
  smsRequired: boolean;
  /** False when Twilio cannot filter this country by state/city (country-wide search). */
  localityFilterSupported?: boolean;
  alreadyAssigned?: BusinessPhoneAssignment | null;
};

/** The business's one active Triven AI number (no provider cost fields). */
export type BusinessPhoneAssignment = {
  assigned: true;
  phoneNumber: string;
  status: "ACTIVE";
  country: string | null;
  region: string | null;
  locality: string | null;
  capabilities: { voice: boolean; sms: boolean };
  assignedAt: string | null;
  installedAgentId: string | null;
};

export function getBusinessPhoneAssignment() {
  return apiGet<BusinessPhoneAssignment | { assigned: false }>("/business/phone-numbers/assignment");
}

export function searchBusinessPhoneNumbers(body: {
  installedAgentId?: string;
  /** Purchased listing id — bootstraps the business on first-time setup. */
  listingId?: string;
  country: string;
  state?: string;
  city?: string;
}) {
  return apiPost<PhoneNumberSearchResult>("/business/phone-numbers/search", body);
}

export type PhonePurchaseOutcome = {
  status: string;
  requestId: string;
  phoneNumber: string | null;
  alreadyCompleted: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

export function purchaseBusinessPhoneNumber(body: {
  installedAgentId?: string;
  /** Purchased listing id — bootstraps the business on first-time setup. */
  listingId?: string;
  clientRequestId: string;
  phoneNumber: string;
  country: string;
  state?: string;
  city?: string;
  fallbackType?: "NEARBY_CITY" | "SAME_STATE" | "NATIONAL" | "TOLL_FREE";
  /** The buyer's own business line — stored as the forwarding target. */
  forwardToPhone?: string;
}) {
  return apiPost<PhonePurchaseOutcome>("/business/phone-numbers/purchase", body);
}

export function getPhoneProvisioningStatus(clientRequestId: string) {
  return apiGet<PhonePurchaseOutcome>(`/business/phone-numbers/provisioning/${encodeURIComponent(clientRequestId)}`);
}

/** Available Triven AI/platform phone numbers the buyer can select (Step 2). */
export function getBusinessPhoneNumbers() {
  return apiGet<{ numbers: PlatformPhoneOption[] }>("/business/setup/phone-numbers");
}

/* ---- Knowledge documents (buyer-uploaded PDF/DOCX/TXT for the agent) ---- */

export type KnowledgeFileSummary = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string; // "PROCESSING" | "PROCESSED" | "FAILED"
  extractedChars: number;
  chunkCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeFileUploadResult = KnowledgeFileSummary & { alreadyExisted: boolean };

/** Upload one or more knowledge documents (multipart). Both ids are optional. */
export function uploadBusinessKnowledgeFiles(
  files: File[],
  opts: { listingId?: string; installedAgentId?: string } = {}
) {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file, file.name);
  }
  if (opts.listingId) form.append("listingId", opts.listingId);
  if (opts.installedAgentId) form.append("installedAgentId", opts.installedAgentId);

  return apiPostFormData<{ files: KnowledgeFileUploadResult[] }>("/business/setup/knowledge-files", form);
}

/**
 * Real audio sample of an agent voice (ElevenLabs TTS via the platform).
 * The preview endpoint is auth-only (not architect-gated), so buyers can hear
 * the exact voice their agent will use.
 */
export function getVoiceSamplePreview(body: { presetId?: string; voiceId?: string; text?: string }) {
  return apiPost<{ audioBase64: string; mimeType: string }>("/architect/voices/preview", body);
}

/** List the business's persisted knowledge documents. */
export function getBusinessKnowledgeFiles() {
  return apiGet<{ files: KnowledgeFileSummary[] }>("/business/setup/knowledge-files");
}

/** Delete one knowledge document (and its extracted knowledge). */
export function deleteBusinessKnowledgeFile(id: string) {
  return apiDelete<{ deleted: true }>(`/business/setup/knowledge-files/${encodeURIComponent(id)}`);
}

/** Re-run extraction for a FAILED knowledge document. */
export function reprocessBusinessKnowledgeFile(id: string) {
  return apiPost<{ file: KnowledgeFileSummary }>(
    `/business/setup/knowledge-files/${encodeURIComponent(id)}/reprocess`,
    {}
  );
}

export function testCallRouting(body: { phoneNumber?: string; selectedPlatformPhoneNumberId?: string }) {
  return apiPost<CallRoutingResult>("/business/setup/test-call-routing", body);
}

/** Result of a test SMS sent through the shared Triven Messaging Service. */
export type TestSmsResult = {
  sent: boolean;
  simulated: boolean;
  /** True when Twilio test credentials were used — accepted, never delivered. */
  testCredentials?: boolean;
  mode?: "SIMULATED" | "TWILIO_TEST_CREDENTIALS" | "LIVE";
  messageSid: string | null;
  status: string | null;
  messagingServiceSid: string | null;
  from: string | null;
  to: string;
  executionId: string | null;
};

/** Send one real test SMS to a consented E.164 number (optionally with the buyer's own text-back message). */
export function sendBusinessTestSms(body: { to: string; message?: string }) {
  return apiPost<TestSmsResult>("/business/setup/test-sms", body);
}

/** Browser preview call session for the setup wizard's Test step. */
export type BusinessPreviewCallSession = {
  publicKey: string;
  assistantId: string;
  assistantName: string;
  businessName: string;
  maxDurationSeconds: number;
  preview: true;
};

/** Start a browser preview call against the buyer's configured agent. */
export function startBusinessSetupPreviewCall() {
  return apiPost<{ session: BusinessPreviewCallSession }>("/business/setup/preview-call", {});
}

/* ---- Chat simulation (setup Test step) ---- */

export type BusinessChatTestMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

export type BusinessChatTestToolCall = {
  name: string;
  status: "simulated" | "skipped" | "error";
  message: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
};

/** One node the graph runner executed this turn, in graph execution order. */
export type BusinessTestExecutedNode = {
  nodeId: string;
  label: string;
  status: "success" | "waiting" | "error" | "skipped";
  message: string;
  output?: unknown;
};

export type BusinessTestCalendarEvent = {
  testEventId?: string;
  title: string;
  /** Booked service name when the workflow captured one. */
  serviceName?: string | null;
  startAt: string;
  endAt: string;
  timeZone: string;
  htmlLink: string | null;
  status: "SIMULATED" | "CREATED";
  googleEventId?: string | null;
  description?: string;
};

export type BusinessChatTestResult = {
  reply: string;
  transcript: BusinessChatTestMessage[];
  toolCalls: BusinessChatTestToolCall[];
  /** Node execution timeline for this turn, in graph execution order. */
  executedNodes?: BusinessTestExecutedNode[];
  /** Final output of the last executed node this turn. */
  finalOutput?: unknown;
  simulated: true;
  executionMode?: "BUSINESS_TEST";
  timeZone?: string | null;
  testSessionId?: string | null;
  /** Real, clearly-marked test event created on the connected calendar. */
  calendarEvent?: BusinessTestCalendarEvent | null;
  /** This turn's booking failure (e.g. CALENDAR_NOT_CONNECTED) — actionable. */
  calendarError?: { code: string; message: string; remediation: string } | null;
  configError?: { code: string; message: string; remediation: string } | null;
};

export function runBusinessSetupChatTest(body: {
  message: string;
  history?: BusinessChatTestMessage[];
  testSessionId?: string;
}) {
  return apiPost<BusinessChatTestResult>("/business/setup/test-conversation", body);
}

/** Delete a business test calendar event (ownership-validated, idempotent). */
export function deleteBusinessTestEvent(testEventId: string) {
  return apiPost<{ outcome: string }>(`/business/setup/test-events/${encodeURIComponent(testEventId)}/delete`, {});
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
  customerConfirmationEnabled: boolean;
  internalSummaryEnabled: boolean;
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
  customerConfirmationEnabled?: boolean;
  internalSummaryEnabled?: boolean;
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

/** Permanently delete the buyer account and all business data (server-side). */
export function deleteBusinessAccount(confirmation: string) {
  return apiPost<{ deleted: boolean }>("/business/settings/danger/delete-account", { confirmation });
}

/** Pause a deployed agent — it stops responding on its number until resumed. */
export function pauseInstalledAgent(installedAgentId: string) {
  return apiPost<{ installedAgentId: string; status: string }>(
    `/business/agents/${encodeURIComponent(installedAgentId)}/pause`,
    {}
  );
}

/** Resume a paused agent. */
export function resumeInstalledAgent(installedAgentId: string) {
  return apiPost<{ installedAgentId: string; status: string }>(
    `/business/agents/${encodeURIComponent(installedAgentId)}/resume`,
    {}
  );
}

export function getBusinessCalendarStatus() {
  return apiGet<BusinessCalendarStatus>("/business/connectors/google-calendar/status");
}

/**
 * @param redirect In-app business path ("/business/...") the OAuth callback
 * should return the browser to. Omitted → Business Settings integrations tab.
 */
export function getBusinessCalendarOAuthUrl(redirect?: string) {
  const query = redirect ? `?redirect=${encodeURIComponent(redirect)}` : "";
  return apiGet<{ url: string }>(`/business/connectors/google-calendar/oauth-url${query}`);
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
  businessSize: string;
  teamPhone: string;
  bookingUrl: string;
  timeZone: string;
  businessAddress: string;
};

export function getBusinessSettingsProfile(businessId?: string) {
  const query = businessId?.trim() ? `?businessId=${encodeURIComponent(businessId.trim())}` : "";
  return apiGet<{ profile: BusinessSettingsProfile }>(`/business/settings/profile${query}`);
}

export function saveBusinessSettingsProfile(body: {
  businessId: string;
  fullName?: string;
  phone?: string;
  email?: string;
  businessName?: string;
  businessType?: string;
  businessSize?: string;
  teamPhone?: string;
  bookingUrl?: string;
  timeZone?: string;
  businessAddress?: string;
}) {
  return apiPost<{
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

export function saveBusinessBillingAddress(body: {
  businessId: string;
  address: string;
  pincode: string;
}) {
  return apiPut<{
    billingAddress: { address: string; pincode: string };
  }>("/business/settings/billing-address", body);
}

export function startBusinessCardSetup() {
  return apiPost<{ clientSecret: string | null; publishableKey: string | null }>(
    "/payments/billing/payment-method/setup-intent",
    {}
  );
}

export function saveBusinessPaymentMethod(
  mode: "primary" | "backup",
  paymentMethodId: string
) {
  return apiPost<{ paymentMethod?: BusinessBillingCard; backupPaymentMethod?: BusinessBillingCard }>(
    `/payments/billing/payment-method/${mode}`,
    { paymentMethodId }
  );
}

export type BusinessBillingCard = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export async function downloadBusinessDataExport(
  businessId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiClient.get(
      `/business/settings/data-export?businessId=${encodeURIComponent(businessId)}`,
      { responseType: "blob" }
    );

    const blob = new Blob([response.data as BlobPart], { type: "application/zip" });
    const disposition =
      typeof response.headers?.["content-disposition"] === "string"
        ? response.headers["content-disposition"]
        : "";
    const filenameMatch = /filename="?([^";]+)"?/.exec(disposition);
    const filename =
      filenameMatch?.[1] ?? `triven-business-data-${new Date().toISOString().slice(0, 10)}.zip`;

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);

    return { success: true };
  } catch {
    return { success: false, error: "Could not export your data" };
  }
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

export type BusinessSettingsSession = {
  id: string;
  deviceLabel: string;
  location: string;
  ipMasked: string;
  isCurrent: boolean;
  statusLabel: string;
  lastActiveAt: string;
};

export type BusinessLoginHistoryEntry = {
  id: string;
  date: string;
  device: string;
  location: string;
  status: string;
};

export function getBusinessActiveSessions() {
  return apiGet<{ sessions: BusinessSettingsSession[] }>("/business/settings/sessions");
}

export function revokeBusinessSession(sessionId: string) {
  return apiDelete<{ revoked: boolean }>(`/business/settings/sessions/${sessionId}`);
}

export function revokeOtherBusinessSessions() {
  return apiDelete<{ revoked: boolean }>("/business/settings/sessions");
}

export function getBusinessLoginHistory(page = 1, perPage = 20) {
  return apiGet<{
    loginHistory: BusinessLoginHistoryEntry[];
    pagination: { page: number; perPage: number; total: number; totalPages: number };
  }>(`/business/settings/login-history?page=${page}&perPage=${perPage}`);
}
