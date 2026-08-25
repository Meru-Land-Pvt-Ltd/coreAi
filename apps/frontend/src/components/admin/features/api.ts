import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";

export type AdminSummary = {
  totalUsers: number;
  newUsersThisWeek: number;
  totalBusinesses: number;
  totalArchitects: number;
  totalAgentListings: number;
  pendingAgentListings: number;
  approvedAgentListings: number;
  rejectedAgentListings: number;
  suspendedAgentListings: number;
  activeInstalledAgents: number;
  totalAppointments: number;
  totalLeads: number;
  platformRevenueCents: number | null;
  platformRevenueCurrency: string | null;
  performanceRevenueCurrency: string | null;
  revenueChangePercent: number | null;
  totalExecutions: number;
  avgExecutionsPerDay30d: number | null;
  performance: Array<{
    date: string;
    revenueCents: number | null;
    executions: number;
    newUsers: number;
  }>;
  recentActivity: Array<{
    id: string;
    occurredAt: string;
    type: string;
    event: string;
    user: string | null;
    details: string | null;
  }>;
  platformHealth: {
    apiUptimePercent: number | null;
    avgResponseTimeMs: number | null;
    errorRatePercent: number | null;
  };
};

export type AdminPaged<T> = { items: T[]; total: number; page: number; limit: number };

export type AdminBusiness = {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  subscriptionStatus: string;
  owner: { id: string; email: string; fullName: string | null; role: string } | null;
  activePhoneNumber: string | null;
  installedAgentsCount: number;
  phoneNumbersCount: number;
  appointmentsCount: number;
  leadsCount: number;
};

export type AdminBusinessAccount = {
  id: string;
  email: string;
  fullName: string | null;
  createdAt: string;
  isSuspended: boolean;
  accountStatus: "Active" | "Trial" | "Inactive" | "Suspended";
  phone: string | null;
  businessName: string | null;
  lastActiveAt: string | null;
  totalSpendCents: number | null;
  currency: string | null;
  totalExecutions: number | null;
  subscriptionStatus: string | null;
  purchasedAgents: AdminBusinessPurchasedAgent[];
};

export type AdminBusinessPurchasedAgent = {
  purchaseId: string;
  purchasedAt: string;
  purchaseStatus: string;
  amountCents: number;
  currency: string;
  installedAgentId: string | null;
  installedAgentStatus: string | null;
  listing: {
    id: string;
    name: string;
    shortDescription: string;
    category: string | null;
    pricingModel: string;
    priceCents: number;
    architect: { email: string; fullName: string | null } | null;
  };
};

export type AdminArchitect = {
  id: string;
  email: string;
  fullName: string | null;
  createdAt: string;
  isSuspended: boolean;
  architectProfile: {
    title: string | null;
    approvalStatus: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
    rating: number;
    completedJobs: number;
  } | null;
  listingCount: number;
  workflowCount: number;
};

export type AdminAgent = {
  id: string;
  name: string;
  shortDescription: string;
  description: string | null;
  category: string | null;
  priceCents: number;
  status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED" | "PAUSED";
  tags: string[];
  createdAt: string;
  submittedAt: string | null;
  workflowId: string | null;
  workflowName: string | null;
  architect: { id: string; email: string; fullName: string | null } | null;
  installedAgentsCount: number;
  architectTotalInstalls: number | null;
  architectTier: string | null;
  priority: "High" | "Standard" | null;
  /** Set only by the admin Featured toggle; null = not featured. */
  featuredAt: string | null;
};

export type ListingStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type ArchitectApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

function query(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function getAdminSummary() {
  return apiGet<AdminSummary>("/admin/summary");
}

export function getAdminBusinesses(params: { search?: string; page?: number; limit?: number } = {}) {
  return apiGet<AdminPaged<AdminBusiness>>(`/admin/businesses${query(params)}`);
}

export function getAdminBusinessAccounts(
  params: { search?: string; page?: number; limit?: number; all?: boolean } = {}
) {
  return apiGet<AdminPaged<AdminBusinessAccount>>(`/admin/business-accounts${query(params)}`);
}

export function getAdminArchitects(
  params: { search?: string; status?: string; page?: number; limit?: number } = {}
) {
  return apiGet<AdminPaged<AdminArchitect>>(`/admin/architects${query(params)}`);
}

export function getAdminAgents(
  params: { search?: string; status?: string; page?: number; limit?: number } = {}
) {
  return apiGet<AdminPaged<AdminAgent>>(`/admin/agents${query(params)}`);
}

export function updateAdminAgentStatus(listingId: string, status: ListingStatus, reason?: string) {
  return apiPatch<{
    listing: {
      id: string;
      status: AdminAgent["status"];
      reviewStatus?: string;
      publishStatus?: string;
    };
  }>(`/admin/agents/${listingId}/status`, { status, reason });
}

/** Admin-curated marketplace Featured slot. APPROVED listings only. */
export function updateAdminAgentFeatured(listingId: string, featured: boolean) {
  return apiPatch<{
    listing: { id: string; name: string; status: string; featuredAt: string | null };
    /** Listings that lost the slot — only one can be featured at a time. */
    replacedListingIds?: string[];
  }>(
    `/admin/agents/${listingId}/featured`,
    { featured }
  );
}

export function deleteAdminAgent(listingId: string) {
  return apiDelete<{
    deleted: true;
    listingId: string;
    workflowId: string | null;
    workflowDeleted: boolean;
    installedAgentsDeleted: number;
    phoneNumbersReleased: number;
  }>(`/admin/agents/${listingId}`);
}

export function updateAdminArchitectStatus(userId: string, approvalStatus: ArchitectApprovalStatus) {
  return apiPatch<{ architectProfile: unknown }>(`/admin/architects/${userId}/status`, { approvalStatus });
}

export function deleteAdminArchitect(userId: string, confirmation: "DELETE") {
  return apiDelete<{
    deleted: true;
    userId: string;
    accountRemoved: boolean;
    remainingRoles: string[];
  }>(`/admin/architects/${userId}`, { confirmation });
}

export function updateAdminUserSuspension(userId: string, isSuspended: boolean) {
  return apiPatch<{ user: unknown }>(`/admin/users/${userId}/suspension`, { isSuspended });
}

export type AdminTemplateRequest = {
  id: string;
  industry: string;
  description: string;
  createdAt: string;
  architect: { id: string; email: string; fullName: string | null } | null;
};

export function getAdminTemplateRequests(
  params: { search?: string; industry?: string; page?: number; limit?: number } = {}
) {
  return apiGet<AdminPaged<AdminTemplateRequest>>(`/admin/template-requests${query(params)}`);
}

export type AdminContactSubmission = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
};

export function getAdminContactSubmissions(
  params: { search?: string; subject?: string; page?: number; limit?: number } = {}
) {
  return apiGet<AdminPaged<AdminContactSubmission>>(`/admin/contact-submissions${query(params)}`);
}

/* ------------------------- "Need Help" support issues ------------------------- */

export type AdminSupportIssueStatus = "OPEN" | "RESOLVED";

export type AdminSupportIssue = {
  id: string;
  name: string | null;
  email: string | null;
  issue: string;
  status: string;
  documentName: string | null;
  documentMimeType: string | null;
  documentSizeBytes: number | null;
  voiceName: string | null;
  voiceMimeType: string | null;
  voiceDurationSec: number | null;
  voiceSizeBytes: number | null;
  createdAt: string;
};

export function getAdminSupportIssues(
  params: { search?: string; status?: string; page?: number; limit?: number } = {}
) {
  return apiGet<AdminPaged<AdminSupportIssue>>(`/admin/support-issues${query(params)}`);
}

export function updateAdminSupportIssueStatus(id: string, status: AdminSupportIssueStatus) {
  return apiPatch<{ issue: { id: string; status: string } }>(`/admin/support-issues/${id}`, { status });
}

// The document/voice bytes are behind an ADMIN-guarded endpoint, so they must be
// fetched with the bearer token and handed to the browser as an object URL.
export async function fetchAdminSupportIssueBlobUrl(
  id: string,
  kind: "document" | "voice"
): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
  const token = localStorage.getItem("coreai-token");

  try {
    const response = await fetch(`${baseUrl}/admin/support-issues/${id}/${kind}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export type AdminPayoutSummary = {
  pendingSalesCount: number;
  pendingEarningsCents: number;
  approvedSalesCount: number;
  approvedEarningsCents: number;
  rejectedSalesCount: number;
  rejectedEarningsCents: number;
  architectSharePercent: number;
};

export type AdminPayoutSale = {
  paymentId: string;
  listingId: string;
  installId: string | null;
  date: string;
  listingName: string;
  businessName: string;
  buyerEmail: string;
  grossCents: number;
  earningsCents: number;
  architectSharePercent: number;
  purchaseStatus: string;
  architectEarningStatus: "PENDING" | "APPROVED" | "REJECTED";
  reviewedAt: string | null;
  architect: {
    id: string;
    email: string;
    fullName: string | null;
    payoutMethod: {
      bankName: string;
      accountHolderName: string;
      accountLast4: string;
      country: "US" | "IN";
      routingLabel: "IFSC" | "ABA routing number";
      routingLast4: string | null;
      verificationStatus: string;
    } | null;
  };
};

export type AdminPayoutSaleStatus = "APPROVED" | "REJECTED";

export function getAdminPayoutSummary() {
  return apiGet<AdminPayoutSummary>("/admin/payouts/summary");
}

export function getAdminPayoutSales(
  params: { search?: string; status?: string; page?: number; limit?: number } = {}
) {
  return apiGet<AdminPaged<AdminPayoutSale>>(`/admin/payouts/sales${query(params)}`);
}

export function updateAdminPayoutSaleStatus(paymentId: string, status: AdminPayoutSaleStatus) {
  return apiPatch<{
    payment: {
      id: string;
      architectEarningStatus: AdminPayoutSale["architectEarningStatus"];
      reviewedAt: string | null;
    };
    sale: unknown;
    architectTotals: {
      approvedEarningsCents: number;
      pendingEarningsCents: number;
    };
  }>(`/admin/payouts/sales/${paymentId}/status`, { status });
}

/* ------------------------- Platform phone numbers ------------------------- */

export type PhoneNumberStatus = "AVAILABLE" | "ASSIGNED" | "DISABLED" | "ARCHIVED" | "RELEASED" | "ERROR";
export type PhoneWebhookStatus = "CONFIGURED" | "MISSING" | "FAILED" | "UNKNOWN";

export type AdminPhoneNumber = {
  id: string;
  phoneNumber: string;
  e164: string | null;
  provider: string;
  status: PhoneNumberStatus;
  twilioSid: string | null;
  /** Present once this number can place outbound calls. */
  vapiPhoneNumberId?: string | null;
  country: string | null;
  region: string | null;
  locality: string | null;
  capabilities: { voice?: boolean; sms?: boolean; mms?: boolean } | null;
  voiceEnabled: boolean;
  smsEnabled: boolean;
  mmsEnabled: boolean | null;
  business: { id: string; name: string | null; type: string | null } | null;
  installedAgent: { id: string; name: string | null; status: string | null } | null;
  buyerUser: { id: string; email: string | null; fullName: string | null } | null;
  assignedAt: string | null;
  purchasedAt: string | null;
  releasedAt: string | null;
  voiceWebhookUrl: string | null;
  smsWebhookUrl: string | null;
  webhookStatus: PhoneWebhookStatus;
  complianceStatus: string;
  a2pStatus: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export type AvailablePhoneNumber = {
  phoneNumber: string;
  friendlyName: string;
  country: string;
  region: string | null;
  locality: string | null;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
};

export type PhoneSyncResult = {
  dryRun: boolean;
  totalOnTwilio: number;
  created: string[];
  updated: string[];
  /** Numbers whose stored Twilio SID was stale and repaired during sync. */
  repairedSids: string[];
  missingInTwilio: string[];
  unchanged: number;
};

export function getAdminPhoneNumbers() {
  return apiGet<{ numbers: AdminPhoneNumber[] }>("/admin/phone-numbers");
}

export function searchAvailablePhoneNumbers(params: {
  country?: string;
  areaCode?: string;
  contains?: string;
  voiceEnabled?: boolean;
  smsEnabled?: boolean;
  mmsEnabled?: boolean;
  limit?: number;
}) {
  const flags: Record<string, string | number | undefined> = {
    country: params.country,
    areaCode: params.areaCode,
    contains: params.contains,
    limit: params.limit,
    voiceEnabled: params.voiceEnabled ? "true" : undefined,
    smsEnabled: params.smsEnabled ? "true" : undefined,
    mmsEnabled: params.mmsEnabled ? "true" : undefined
  };
  return apiGet<{ numbers: AvailablePhoneNumber[] }>(`/admin/phone-numbers/available${query(flags)}`);
}

export function purchasePhoneNumber(body: { phoneNumber: string; country?: string; friendlyName?: string }) {
  return apiPost<{ number: AdminPhoneNumber }>("/admin/phone-numbers/purchase", body);
}

export function getPhoneAssignOptions(businessId: string) {
  return apiGet<{ agents: { id: string; name: string; status: string }[] }>(
    `/admin/phone-numbers/assign-options${query({ businessId })}`
  );
}

export function assignPhoneNumber(
  id: string,
  body: { businessId: string; installedAgentId?: string; buyerUserId?: string }
) {
  return apiPost<{ number: AdminPhoneNumber }>(`/admin/phone-numbers/${id}/assign`, body);
}

export function unassignPhoneNumber(id: string) {
  return apiPost<{ number: AdminPhoneNumber }>(`/admin/phone-numbers/${id}/unassign`, {});
}

export function configurePhoneNumberWebhooks(id: string) {
  return apiPost<{ number: AdminPhoneNumber }>(`/admin/phone-numbers/${id}/configure-webhooks`, {});
}

/**
 * Let this number PLACE calls. Registers it with the voice provider, which is
 * the step that was missing entirely — agents could answer calls but never
 * make them. Only offered for free numbers: registering takes over the
 * number's incoming calls, which would silence a business that uses it.
 */
export function enableOutboundCalling(id: string) {
  return apiPost<{ vapiPhoneNumberId: string; number: string }>(
    `/admin/phone-numbers/${id}/register-voice`,
    {}
  );
}

export function syncTwilioPhoneNumbers(dryRun: boolean) {
  return apiPost<PhoneSyncResult>(`/admin/phone-numbers/sync-twilio${dryRun ? "?dryRun=true" : ""}`, {});
}

export function releasePhoneNumber(id: string) {
  return apiDelete<{ number: AdminPhoneNumber }>(`/admin/phone-numbers/${id}/release`);
}

/* ------------------------- Platform usage service pricing ------------------------- */

export type UsageServiceUnit = "PER_MINUTE" | "PER_SMS" | "PER_CALL" | "PER_UNIT";

export type AdminUsageService = {
  id: string;
  code: string;
  name: string;
  role: string | null;
  unit: UsageServiceUnit;
  actualCostUsd: number;
  updatedCostUsd: number;
  actualCostMicroUsd: number;
  updatedCostMicroUsd: number;
  isActive: boolean;
  showInPhoneCallBreakdown: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminPricingServicesResponse = {
  services: AdminUsageService[];
  totals: {
    perMinuteActualUsd: number;
    perMinuteUpdatedUsd: number;
  };
};

export function getAdminPricingServices(includeInactive = false) {
  return apiGet<AdminPricingServicesResponse>(
    `/admin/pricing/services${includeInactive ? "?includeInactive=true" : ""}`
  );
}

export function createAdminPricingService(body: {
  code: string;
  name: string;
  role?: string;
  unit?: UsageServiceUnit;
  actualCostUsd: number;
  updatedCostUsd: number;
  showInPhoneCallBreakdown?: boolean;
  sortOrder?: number;
}) {
  return apiPost<{ service: AdminUsageService }>("/admin/pricing/services", body);
}

export function updateAdminPricingService(
  id: string,
  body: Partial<{
    name: string;
    role: string | null;
    unit: UsageServiceUnit;
    actualCostUsd: number;
    updatedCostUsd: number;
    isActive: boolean;
    showInPhoneCallBreakdown: boolean;
    sortOrder: number;
  }>
) {
  return apiPatch<{ service: AdminUsageService }>(`/admin/pricing/services/${id}`, body);
}

export function deleteAdminPricingService(id: string) {
  return apiDelete<{ service: AdminUsageService }>(`/admin/pricing/services/${id}`);
}

/* ------------------------------- Platform mail ------------------------------- */

export type AdminEmailAliasStatus = "ACTIVE" | "DISABLED" | "ARCHIVED";

export type AdminEmailAliasLastMessage = {
  id: string;
  subject: string;
  status: string;
  purpose: string;
  toEmail: string;
  createdAt: string;
};

export type AdminEmailAlias = {
  id: string;
  businessId: string;
  business: { id: string; name: string } | null;
  localPart: string;
  emailAddress: string;
  displayName: string;
  forwardToEmail: string | null;
  replyHandlingMode: string;
  customerConfirmationEnabled: boolean;
  internalSummaryEnabled: boolean;
  status: AdminEmailAliasStatus;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * EmailMessage status counts (QUEUED, SENT, DELIVERED, FAILED, RECEIVED,
   * BOUNCED, COMPLAINED, REJECTED, SUPPRESSED). Missing keys mean 0.
   */
  counts: Record<string, number>;
  lastMessage: AdminEmailAliasLastMessage | null;
};

export type AdminEmailSuppression = {
  id: string;
  emailAddress: string;
  reason: string;
  source: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export function getAdminEmailAliases(params: { search?: string; page?: number; limit?: number } = {}) {
  return apiGet<AdminPaged<AdminEmailAlias>>(`/admin/email-aliases${query(params)}`);
}

export function disableAdminEmailAlias(id: string) {
  return apiPost<{ alias: AdminEmailAlias }>(`/admin/email-aliases/${id}/disable`, {});
}

export function archiveAdminEmailAlias(id: string) {
  return apiPost<{ alias: AdminEmailAlias }>(`/admin/email-aliases/${id}/archive`, {});
}

export function resendTestAdminEmailAlias(id: string) {
  return apiPost<{ messageId: string; dryRun: boolean }>(`/admin/email-aliases/${id}/resend-test`, {});
}

export function getAdminEmailAliasActivity(id: string) {
  return apiGet<{
    alias: { id: string; emailAddress: string };
    counts: Record<string, number>;
    lastMessage: AdminEmailAliasLastMessage | null;
  }>(`/admin/email-aliases/${id}/activity`);
}

export function getAdminEmailSuppressions(params: { page?: number; limit?: number } = {}) {
  return apiGet<AdminPaged<AdminEmailSuppression>>(`/admin/email-suppressions${query(params)}`);
}

export function reactivateAdminEmailSuppression(id: string) {
  return apiPost<{ suppression: AdminEmailSuppression }>(`/admin/email-suppressions/${id}/reactivate`, {});
}

/* ------------------------- Manage API (platform keys) ---------------------- */

export type AdminApiSettingField = {
  key: string;
  label: string;
  /** Masked for secrets, full value for non-secret settings, "" when unset. */
  value: string;
  secret: boolean;
  /** Where the effective value comes from right now. */
  source: "admin" | "env" | "unset";
  updatedAt: string | null;
};

export type AdminApiSettingGroup = {
  id: string;
  title: string;
  description: string;
  fields: AdminApiSettingField[];
};

export function getAdminApiSettings() {
  return apiGet<{ groups: AdminApiSettingGroup[] }>("/admin/api-settings");
}

/** An empty value clears the override and restores the .env fallback. */
export function updateAdminApiSettings(settings: Array<{ key: string; value: string }>) {
  return apiPut<{ groups: AdminApiSettingGroup[]; saved: number; cleared: number }>(
    "/admin/api-settings",
    { settings }
  );
}

export type AdminBuilderNode = {
  type: string;
  group: string;
  label: string;
  visible: boolean;
  defaultVisible: boolean;
  defaultLabel: string;
  defaultGroup: string;
};

export function getAdminBuilderNodes() {
  return apiGet<{ nodes: AdminBuilderNode[]; groups: string[] }>("/admin/builder-nodes");
}

export function updateAdminBuilderNodes(
  nodes: Array<{ type: string; visible?: boolean; label?: string; group?: string }>
) {
  return apiPut<{ nodes: AdminBuilderNode[]; groups: string[]; saved: number }>("/admin/builder-nodes", { nodes });
}

export function createAdminBuilderGroup(name: string) {
  return apiPost<{ groups: string[] }>("/admin/builder-nodes/groups", { name });
}

export function deleteAdminBuilderGroup(name: string) {
  return apiDelete<{ nodes: AdminBuilderNode[]; groups: string[]; moved: number }>(
    "/admin/builder-nodes/groups",
    { name }
  );
}

/* ------------------------------- Nodes ---------------------------------- */

/**
 * One node and its two switches.
 *
 * `liveAgents` and `businesses` are what turn pausing from a guess into a
 * decision: switching off a step fourteen businesses depend on is a different
 * act from switching off one nobody uses.
 */
export type AdminNodeControl = {
  type: string;
  label: string;
  group: string;
  description: string;
  visible: boolean;
  executionEnabled: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  liveAgents: number;
  businesses: number;
  agentNames: string[];
};

export function getAdminNodes() {
  return apiGet<{ nodes: AdminNodeControl[] }>("/admin/nodes");
}

/** Toggle one: may an architect build something new with it? */
export function setAdminNodeVisibility(nodeType: string, visible: boolean) {
  return apiPut<{ nodeType: string; visible: boolean }>(
    `/admin/nodes/${encodeURIComponent(nodeType)}/visibility`,
    { visible }
  );
}

/** Toggle two: may it run at all — including inside agents already sold? */
export function setAdminNodeExecution(nodeType: string, enabled: boolean, reason?: string) {
  return apiPut<{
    nodeType: string;
    executionEnabled: boolean;
    affected: { installedAgents: number; businesses: number };
  }>(`/admin/nodes/${encodeURIComponent(nodeType)}/execution`, { enabled, reason });
}

/* ---------------------------- The AI Brain ------------------------------- */

/** Working, no key, or a sentence saying what is wrong. */
export type LlmProviderHealth =
  | { state: "working"; detail: null }
  | { state: "no-key"; detail: string }
  | { state: "problem"; detail: string };

export type LlmModelRow = {
  modelId: string;
  providerName: string | null;
  displayName: string;
  /** Available: may an architect choose it in something new. */
  enabled: boolean;
  /** Running: may it run at all, including in agents already bought. */
  runningEnabled: boolean;
  inputPricePer1M: number | null;
  outputPricePer1M: number | null;
  shipped: boolean;
};

export type LlmProviderView = {
  providerId: string;
  displayName: string;
  envKey: string;
  hasKey: boolean;
  /** Available: may an architect choose its models in something new. */
  enabled: boolean;
  /** Running: may it work at all, including in agents already bought. */
  runningEnabled: boolean;
  health: LlmProviderHealth;
  /** Null when the provider could not be asked — see modelsProblem. */
  models: LlmModelRow[] | null;
  modelsProblem: string | null;
};

export function getLlmControl(refresh = false) {
  return apiGet<{ providers: LlmProviderView[] }>(`/admin/llm-control${refresh ? "?refresh=1" : ""}`);
}

export function saveLlmKey(providerId: string, envKey: string, apiKey: string) {
  return apiPut<{ providers: LlmProviderView[] }>(
    `/admin/llm-control/${encodeURIComponent(providerId)}/key`,
    { envKey, apiKey }
  );
}

export function setLlmProviderSwitches(
  providerId: string,
  patch: { enabled?: boolean; runningEnabled?: boolean }
) {
  return apiPut<{ providers: LlmProviderView[] }>(
    `/admin/llm-control/${encodeURIComponent(providerId)}`,
    patch
  );
}

export function patchLlmModel(
  providerId: string,
  modelId: string,
  patch: Partial<Pick<LlmModelRow, "displayName" | "enabled" | "runningEnabled" | "inputPricePer1M" | "outputPricePer1M">>
) {
  return apiPut<{ model: unknown }>(
    `/admin/llm-control/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
    patch
  );
}

/* --------------------------- Memory: the limits --------------------------- */

export type MemoryLimits = {
  /** Days before a stored memory is deleted. 0 = keep forever. */
  keepForDays: number;
  biggestFileMb: number;
  piecesPerAnswer: number;
  searchByMeaning: boolean;
};

export function getMemoryLimits() {
  return apiGet<{
    memoryLimits: MemoryLimits;
    defaults: MemoryLimits;
    bounds: Record<string, { min: number; max: number }>;
  }>("/admin/memory-limits");
}

export function saveMemoryLimits(limits: MemoryLimits) {
  return apiPatch<{ memoryLimits: MemoryLimits }>("/admin/memory-limits", limits);
}

/* ------------------------- Condition: the roads out ------------------------ */

export function getConditionLimits() {
  return apiGet<{ maxRoads: number; default: number; bounds: { min: number; max: number } }>(
    "/admin/condition-limits"
  );
}

export function saveConditionLimits(maxRoads: number) {
  return apiPatch<{ maxRoads: number }>("/admin/condition-limits", { maxRoads });
}

/* ------------------------------ Loop: the rounds --------------------------- */

export function getLoopLimits() {
  return apiGet<{ maxRounds: number; default: number; bounds: { min: number; max: number } }>("/admin/loop-limits");
}

export function saveLoopLimits(maxRounds: number) {
  return apiPatch<{ maxRounds: number }>("/admin/loop-limits", { maxRounds });
}

/* --------------------------- File Upload: pictures ------------------------- */

export function getFileUploadLimits() {
  return apiGet<{ imagesAllowed: boolean; biggestFileMb: number }>("/admin/file-upload-limits");
}

export function saveFileUploadLimits(imagesAllowed: boolean) {
  return apiPatch<{ imagesAllowed: boolean }>("/admin/file-upload-limits", { imagesAllowed });
}

/* ------------------------------ Timer: the floor --------------------------- */

export function getTimerLimits() {
  return apiGet<{ floorMinutes: number; default: number; bounds: { min: number; max: number } }>("/admin/timer-limits");
}

export function saveTimerLimits(floorMinutes: number) {
  return apiPatch<{ floorMinutes: number }>("/admin/timer-limits", { floorMinutes });
}
