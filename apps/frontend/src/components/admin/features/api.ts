import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

export type AdminSummary = {
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
  priceCents: number;
  status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED";
  tags: string[];
  createdAt: string;
  workflowId: string | null;
  workflowName: string | null;
  architect: { id: string; email: string; fullName: string | null } | null;
  installedAgentsCount: number;
};

export type ListingStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type ArchitectApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

function query(params: Record<string, string | number | undefined>) {
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
  return apiPatch<{ listing: unknown }>(`/admin/agents/${listingId}/status`, { status, reason });
}

export function updateAdminArchitectStatus(userId: string, approvalStatus: ArchitectApprovalStatus) {
  return apiPatch<{ architectProfile: unknown }>(`/admin/architects/${userId}/status`, { approvalStatus });
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
    sortOrder: number;
  }>
) {
  return apiPatch<{ service: AdminUsageService }>(`/admin/pricing/services/${id}`, body);
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
