import { apiClient, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import type { AgentConfigureData, AgentMarketplacePreview } from "@coreai/shared";
import type {
  ArchitectListing,
  ArchitectProfile,
  ArchitectProject,
  ArchitectProposal,
  ArchitectSummary,
  ArchitectTestDeploymentInput,
  ArchitectTestDeploymentStatus,
  ArchitectWorkflow,
  ArchitectVapiBrowserTestCallEndReason,
  ArchitectVapiBrowserTestSession,
  GmailConnectorStatus,
  WorkflowRunResult,
  ArchitectConversationMessage,
  ArchitectConversationTestResult,
  ArchitectConversationToolCall,
} from "./types";

export function getArchitectSummary() {
  return apiGet<ArchitectSummary>("/architect/summary");
}

export type ArchitectAgentsStats = {
  totalAgents: number;
  agentsAddedThisMonth: number;
  liveAndEarning: number;
  liveSharePercent: number;
  totalExecutions: number;
  executionsThisMonth: number;
  executionsPrevMonth: number;
  executionsChangePercent: number | null;
  /** Canonical ledger metrics: distinct LIVE provider executions only. */
  activeExecutionCount?: number;
  periodExecutionCount?: number;
  lifetimeExecutionCount?: number;
  excludedPausedInstallationCount?: number;
  totalEarningsCents: number;
  revenue30dCents: number;
  revenuePrev30dCents: number;
  revenueChangePercent: number | null;
};

export function getArchitectAgentsStats() {
  return apiGet<ArchitectAgentsStats>("/architect/agents/stats");
}

/** One AI provider the backend can run — `configured` is false when its key is missing. */
export type ArchitectAiProvider = {
  id: string;
  displayName: string;
  models: string[];
  /** A key is present for this provider. */
  configured: boolean;
  /** Key present AND the account is not blocked (no credit, over quota, …). */
  available?: boolean;
  /** Short reason for a tooltip; null when the provider is usable. */
  unavailableReason?: string | null;
  /** "blocked" = key present but the account failed; "no_key" = no key set. */
  unavailableKind?: "blocked" | "no_key" | null;
  envKey: string | null;
};

export function getArchitectAiProviders() {
  return apiGet<{ providers: ArchitectAiProvider[] }>("/architect/ai/providers");
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

/**
 * DEV/DEMO-ONLY — not used by the architect UI (architects design + publish only).
 * Buyer/business deployment runs through /business/setup. Kept for local demo/self-test.
 */
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

export function submitArchitectTemplateRequest(body: { industry: string; description: string }) {
  return apiPost<{
    request: { id: string; industry: string; description: string; createdAt: string };
  }>("/architect/template-requests", body);
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

export function updateArchitectListingStatus(
  agentId: string,
  status: ArchitectListing["status"]
) {
  return apiPatch<{ listing: ArchitectListing }>(`/architect/listings/${agentId}/status`, {
    status
  });
}

export function deleteArchitectListing(listingId: string, reason?: string) {
  return apiDelete<{ listingId: string; workflowId: string | null; softDeleted?: boolean }>(
    `/architect/listings/${listingId}`,
    reason ? { reason } : undefined
  );
}

export type ArchitectPayoutMethod = {
  bankName: string;
  accountHolderName: string;
  accountLast4: string;
  country: "US" | "IN";
  currency: string;
  routingLabel: "IFSC" | "ABA routing number";
  routingLast4: string | null;
  verificationStatus: "REQUIRES_ACTION" | "PENDING" | "VERIFIED" | "FAILED" | string;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requiresAction: boolean;
  stripeConnected: boolean;
  createdAt: string;
  verified: boolean;
};

export type ArchitectPayoutSummary = {
  totalEarningsCents: number;
  availableBalanceCents: number;
  pendingCents: number;
  thisMonthEarningsCents: number;
  thisMonthLabel: string;
  thisMonthSalesCount: number;
  totalSalesCount: number;
  agentCount: number;
  architectSharePercent: number;
  sales: ArchitectPayoutSale[];
  listingBreakdown: ArchitectListingEarnings[];
  chart: {
    period: string;
    points: Array<{
      label: string;
      confirmedCents: number;
      pendingCents: number;
    }>;
  };
  nextPayout: {
    amountCents: number;
    scheduledFor: string;
    grossSalesCents: number;
    platformFeeCents: number;
    earningsCents: number;
  };
  instantPayout: {
    eligible: boolean;
    destinationType: "bank_account" | "card" | null;
    destinationLast4: string | null;
  };
  /** The architect-selected payout schedule (Settings → Payouts). */
  payoutSchedule?: ArchitectPayoutSchedule | null;
  payoutMethod: ArchitectPayoutMethod | null;
};

export type ArchitectPayoutSale = {
  id: string;
  paymentId: string;
  listingId: string;
  installId: string | null;
  buyerUserId: string;
  date: string;
  listingName: string;
  businessName: string;
  grossCents: number;
  earningsCents: number;
  purchaseStatus: string;
  architectEarningStatus: "PENDING" | "APPROVED" | "REJECTED";
};

export type ArchitectListingEarnings = {
  listingId: string;
  listingName: string;
  priceCents: number;
  installCount: number;
  grossCents: number;
  earningsCents: number;
};

export type ArchitectPayoutTransaction = {
  id: string;
  paymentId: string | null;
  listingId: string | null;
  installId: string | null;
  date: string;
  description: string;
  type: "Sale" | "Payout" | "Refund";
  amountCents: number;
  status: string;
};

export type ArchitectDashboardActivity = {
  id: string;
  type: "SALE" | "PAYOUT" | "LISTING";
  title: string;
  description: string;
  occurredAt: string;
  status: string;
  amountCents?: number;
  listingId?: string;
};

export function getArchitectDashboardActivity(limit = 10) {
  return apiGet<{
    activities: ArchitectDashboardActivity[];
    refreshedAt: string;
  }>(`/architect/dashboard/activity?limit=${encodeURIComponent(String(limit))}`);
}

export type ArchitectAgentAnalyticsRange = "7D" | "30D" | "90D" | "6M" | "1Y";

export type ArchitectAgentAnalytics = {
  listing: {
    id: string;
    name: string;
    status: ArchitectListing["status"];
    category: string | null;
    priceCents: number;
    createdAt: string;
    publishedAt: string | null;
  };
  range: ArchitectAgentAnalyticsRange;
  rangeStart: string;
  refreshedAt: string;
  metrics: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    runningExecutions: number;
    successRate: number;
    averageExecutionSeconds: number;
    revenueCents: number;
    pendingRevenueCents: number;
    salesCount: number;
    callCount: number;
    totalInstalls: number;
    activeInstalls: number;
  };
  series: Array<{
    label: string;
    successful: number;
    failed: number;
    running: number;
    revenueCents: number;
    pendingRevenueCents: number;
  }>;
  failures: Array<{ reason: string; count: number }>;
  retention: {
    cohorts: Array<{
      label: string;
      installCount: number;
      values: Array<number | null>;
    }>;
    averageFourWeekPercent: number | null;
  };
  recentExecutions: Array<{
    id: string;
    kind: "WORKFLOW" | "CALL";
    status: "SUCCESS" | "FAILED" | "RUNNING";
    occurredAt: string;
    durationSeconds: number | null;
    businessName: string;
    error: string | null;
  }>;
};

export function getArchitectAgentAnalytics(
  listingId: string,
  range: ArchitectAgentAnalyticsRange
) {
  return apiGet<ArchitectAgentAnalytics>(
    `/architect/agents/${encodeURIComponent(listingId)}/analytics?range=${encodeURIComponent(range)}`
  );
}

export async function downloadArchitectAgentAnalyticsReport(
  listingId: string,
  range: ArchitectAgentAnalyticsRange
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiClient.get(
      `/architect/agents/${encodeURIComponent(listingId)}/analytics/export?range=${encodeURIComponent(range)}`,
      { responseType: "blob" }
    );
    const blob = new Blob([response.data as BlobPart], { type: "text/csv;charset=utf-8" });
    const disposition =
      typeof response.headers?.["content-disposition"] === "string"
        ? response.headers["content-disposition"]
        : "";
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const filename =
      match?.[1] ?? `triven-agent-analytics-${range.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;

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
    return { success: false, error: "Could not export this agent's analytics report" };
  }
}

export function getArchitectPayoutSummary(listingIds?: string[]) {
  const query = listingIds?.length
    ? `?listingIds=${encodeURIComponent(listingIds.join(","))}`
    : "";
  return apiGet<ArchitectPayoutSummary>(`/architect/payouts/summary${query}`);
}

export function getArchitectPayoutEarnings(listingIds?: string[]) {
  const query = listingIds?.length
    ? `?listingIds=${encodeURIComponent(listingIds.join(","))}`
    : "";
  return apiGet<{
    sales: ArchitectPayoutSale[];
    totals: {
      salesCount: number;
      grossCents: number;
      earningsCents: number;
      architectSharePercent: number;
    };
  }>(`/architect/payouts/earnings${query}`);
}

export function startArchitectStripeOnboarding(body: {
  country: "US" | "IN";
  accountHolderName: string;
}) {
  return apiPost<{ url: string; expiresAt: string; stripeAccountId: string }>(
    "/architect/payouts/connect/onboarding",
    body
  );
}

export function verifyArchitectIfsc(ifscCode: string) {
  return apiGet<{
    valid: boolean;
    ifscCode: string;
    bankName: string;
    branch: string;
    city: string;
    state: string;
  }>(`/architect/payouts/verify-ifsc/${encodeURIComponent(ifscCode.trim().toUpperCase())}`);
}

export function saveArchitectPayoutMethod(body: {
  country: "US" | "IN";
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  confirmAccountNumber: string;
  routingNumber: string;
}) {
  return apiPut<{ payoutMethod: ArchitectPayoutMethod }>("/architect/payouts/method", body);
}

export type ArchitectPayoutMethodInput = {
  country: "US" | "IN";
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  confirmAccountNumber: string;
  routingNumber: string;
};

export function saveArchitectBackupPayoutMethod(body: ArchitectPayoutMethodInput) {
  return apiPut<{ backupPayoutMethod: ArchitectPayoutMethod }>("/architect/payouts/method/backup", body);
}

export function makeArchitectBackupPayoutMethodPrimary() {
  return apiPost<{
    payoutMethod: ArchitectPayoutMethod;
    backupPayoutMethod: ArchitectPayoutMethod;
  }>("/architect/payouts/method/backup/primary", {});
}

export function refreshArchitectStripeOnboarding() {
  return apiPost<{ url: string }>("/architect/payouts/connect/refresh", {});
}

export function syncArchitectStripePayoutMethod() {
  return apiPost<{ payoutMethod: ArchitectPayoutMethod | null }>(
    "/architect/payouts/method/sync",
    {}
  );
}

export function getArchitectPayoutTransactions(params?: {
  type?: string;
  range?: string;
  page?: number;
  perPage?: number;
  listingIds?: string[];
}) {
  const search = new URLSearchParams();
  if (params?.type) search.set("type", params.type);
  if (params?.range) search.set("range", params.range);
  if (params?.page) search.set("page", String(params.page));
  if (params?.perPage) search.set("perPage", String(params.perPage));
  if (params?.listingIds?.length) search.set("listingIds", params.listingIds.join(","));
  const query = search.toString();
  return apiGet<{
    transactions: ArchitectPayoutTransaction[];
    pagination: {
      page: number;
      perPage: number;
      total: number;
      totalPages: number;
    };
  }>(`/architect/payouts/transactions${query ? `?${query}` : ""}`);
}

export function requestArchitectPayout(body: {
  amountCents?: number;
  deliveryMethod?: "standard" | "instant";
  /** Per-request UUID — the backend deduplicates retries/double-clicks on it. */
  clientRequestId: string;
}) {
  return apiPost<{
    payout: {
      id: string;
      amountCents: number;
      deliveryMethod: "standard" | "instant";
      status: string;
      expectedArrival?: string | null;
      duplicate?: boolean;
      createdAt: string;
    } | null;
    summary: ArchitectPayoutSummary;
  }>("/architect/payouts/request", body);
}

export function getArchitectStripeDashboardLink() {
  return apiPost<{ url: string }>("/architect/payouts/connect/dashboard-link", {});
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

/** Bulk-delete the architect's draft workflows that have no listing and aren't deployed. */
export function cleanupDraftWorkflows(
  body: { deleteUntitled?: boolean; deleteDuplicateTemplates?: boolean } = {}
) {
  return apiPost<{ deletedCount: number; deletedNames: string[] }>(
    "/architect/workflows/cleanup-drafts",
    body
  );
}

export function runArchitectConversationTest(
  workflowId: string,
  body: {
    message: string;
    history?: ArchitectConversationMessage[];
    /** Groups this dry run's records (test calendar events). */
    testSessionId?: string;
    /** Create real events in the architect's OWN connected test calendar. */
    useTestCalendar?: boolean;
    /** After-hours simulation: evaluate as open/closed ("current" = no override). */
    simulateBusinessHoursState?: "current" | "open" | "closed";
    testContext?: {
      businessName?: string;
      businessType?: string;
      assistantName?: string;
      callerName?: string;
      callerPhone?: string;
      calendarId?: string;
      timeZone?: string;
      appointmentService?: string;
      /** Test-form pre-selected date ("YYYY-MM-DD") — seeds the conversation. */
      requestedDate?: string;
      /** Test-form pre-selected time ("HH:mm", 24h). */
      requestedTime?: string;
      services?: string[];
      faqs?: string[];
    };
  }
) {
  return apiPost<{
    conversation: ArchitectConversationTestResult;
  }>(`/architect/workflows/${workflowId}/conversation-test`, body);
}

/** Delete an architect test calendar event (ownership-validated, idempotent). */
export function deleteArchitectTestEvent(testEventId: string) {
  return apiPost<{ outcome: string }>(`/architect/test-events/${encodeURIComponent(testEventId)}/delete`, {});
}

export type { ArchitectConversationMessage, ArchitectConversationToolCall };

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
      testEmail?: string;
      /** Create a REAL [TRIVEN ARCHITECT TEST] event in the architect's own calendar. */
      useTestCalendar?: boolean;
      /** Groups this test run's records (test calendar events). */
      testSessionId?: string;
      calendlyEventTypeUri?: string;
      calendlyEventUuid?: string;
      calendlyInviteeUuid?: string;
      calendlyStartTime?: string;
      calendlyEndTime?: string;
      calendlyStatus?: string;
      calendlyTimezone?: string;
      calendlyTriggerEvent?: string;
      calendlyInviteeName?: string;
      calendlyInviteeEmail?: string;
      calendlyMeetingName?: string;
      triggerType?: string;
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

/* ---- Architect sandbox test deployment (pre-publish live phone testing) ---- */

export function getArchitectTestDeployment(workflowId: string) {
  return apiGet<{ testDeployment: ArchitectTestDeploymentStatus }>(
    `/architect/workflows/${workflowId}/test-deployment`
  );
}

export function startArchitectTestDeployment(
  workflowId: string,
  body: ArchitectTestDeploymentInput = {}
) {
  return apiPost<{ testDeployment: ArchitectTestDeploymentStatus }>(
    `/architect/workflows/${workflowId}/test-deployment`,
    body
  );
}

export function stopArchitectTestDeployment(workflowId: string) {
  return apiDelete<{ testDeployment: ArchitectTestDeploymentStatus }>(
    `/architect/workflows/${workflowId}/test-deployment`
  );
}

/** Start a Vapi-powered browser call test (no Twilio number, dry-run tools). */
export function startArchitectVapiBrowserTest(
  workflowId: string,
  body: {
    testContext?: {
      businessName?: string;
      businessType?: string;
      assistantName?: string;
      callerName?: string;
      callerPhone?: string;
      calendarId?: string;
      timeZone?: string;
      appointmentService?: string;
      services?: string[];
      faqs?: string[];
      /** Create real [TRIVEN ARCHITECT TEST] events in the architect's own calendar. */
      useTestCalendar?: boolean;
      /** Groups this browser test's records (test calendar events). */
      testSessionId?: string;
      /** After-hours simulation for this voice test session. */
      simulateBusinessHoursState?: "current" | "open" | "closed";
    };
  } = {}
) {
  return apiPost<{ session: ArchitectVapiBrowserTestSession }>(
    `/architect/workflows/${workflowId}/vapi-browser-test/start`,
    body
  );
}

/** Latest architect test calendar event (optionally scoped to one test session). */
export function getLatestArchitectTestEvent(testSessionId?: string) {
  const query = testSessionId ? `?testSessionId=${encodeURIComponent(testSessionId)}` : "";
  return apiGet<{ event: import("./types").ArchitectTestCalendarEvent | null }>(
    `/architect/test-events/latest${query}`
  );
}

/** Fetch the real Vapi endedReason for a finished browser-test call. */
export function getArchitectVapiBrowserTestCallEndReason(callId: string) {
  return apiGet<{ endReason: ArchitectVapiBrowserTestCallEndReason }>(
    `/architect/vapi-browser-test/calls/${encodeURIComponent(callId)}/end-reason`
  );
}

/* ---- Architect Configure flow (marketplace template metadata) ---- */

export type WorkflowConfigureListingSummary = {
  id: string;
  status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED" | "PAUSED";
  reviewStatus: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
  publishStatus: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "UNPUBLISHED";
  rejectionReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
};

export type WorkflowConfigureResponse = {
  workflowId: string;
  configure: AgentConfigureData;
  reviewStatus: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
  publishStatus: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "UNPUBLISHED";
  listing: WorkflowConfigureListingSummary | null;
  locked: boolean;
  lockedMessage: string | null;
};

export type ConfigureValidationIssuePayload = {
  step: 1 | 2 | 3 | 4 | 5;
  field: string;
  message: string;
};

export function getWorkflowConfigure(workflowId: string) {
  return apiGet<WorkflowConfigureResponse>(`/architect/workflows/${workflowId}/configure`);
}

export function patchWorkflowConfigure(workflowId: string, configure: Partial<AgentConfigureData>) {
  return apiPatch<WorkflowConfigureResponse>(`/architect/workflows/${workflowId}/configure`, {
    configure
  });
}

export function saveWorkflowConfigureDraft(workflowId: string, configure: Partial<AgentConfigureData>) {
  return apiPost<WorkflowConfigureResponse>(
    `/architect/workflows/${workflowId}/configure/save-draft`,
    { configure }
  );
}

export function submitWorkflowForReview(workflowId: string, configure: Partial<AgentConfigureData>) {
  return apiPost<WorkflowConfigureResponse & { listingId: string; issues?: ConfigureValidationIssuePayload[] }>(
    `/architect/workflows/${workflowId}/submit-review`,
    { configure }
  );
}

export function publishWorkflowListing(workflowId: string) {
  return apiPost<{
    listingId: string;
    status: string;
    publishStatus: string;
    publishedAt: string | null;
  }>(`/architect/workflows/${workflowId}/publish`, {});
}

export function getWorkflowMarketplacePreview(workflowId: string) {
  return apiGet<{ preview: AgentMarketplacePreview }>(
    `/architect/workflows/${workflowId}/marketplace-preview`
  );
}

export function getGmailConnectorStatus() {
  return apiGet<GmailConnectorStatus>("/architect/connectors/gmail/status");
}

export function getGmailOAuthUrl(redirectPath?: string) {
  const query = redirectPath ? `?redirect=${encodeURIComponent(redirectPath)}` : "";
  return apiGet<{ url: string }>(`/architect/connectors/gmail/oauth-url${query}`);
}

export function postGmailDisclosureConsent(body: { disclosureVersion: string; action: string }) {
  return apiPost<{ disclosureVersion: string }>("/architect/connectors/gmail/disclosure-consent", body);
}

export function disconnectGmailConnector() {
  return apiDelete<null>("/architect/connectors/gmail");
}

export function getCalendlyConnectorStatus() {
  return apiGet<import("./types").CalendlyConnectorStatus>("/architect/connectors/calendly/status");
}

export function getCalendlyOAuthUrl(redirectPath?: string) {
  const query = redirectPath ? `?redirect=${encodeURIComponent(redirectPath)}` : "";
  return apiGet<{ url: string }>(`/architect/connectors/calendly/oauth-url${query}`);
}

export function disconnectCalendlyConnector() {
  return apiDelete<null>("/architect/connectors/calendly");
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

export type ArchitectSettingsProfile = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  timezone: string;
  profilePhotoUrl?: string | null;
};

export type ArchitectSettingsStorefront = {
  displayName: string;
  marketplacePhotoUrl?: string | null;
  tagline: string;
  bio: string;
  portfolioUrl: string;
  githubUrl: string;
  linkedinUrl: string;
  twitterHandle: string;
  experienceBand: string;
  skills: string[];
  approvalStatus: string;
  rating: number;
  completedJobs: number;
  agentsPaused: boolean;
};

export type ArchitectSettingsSession = {
  id: string;
  deviceLabel: string;
  location: string;
  ipMasked: string;
  isCurrent: boolean;
  statusLabel: string;
  lastActiveAt: string;
};

export type ArchitectLoginHistoryEntry = {
  id: string;
  date: string;
  device: string;
  location: string;
  status: string;
};

export type ArchitectRefundAgent = {
  listingId: string;
  listingName: string;
  listingStatus: string;
  paidInstallCount: number;
  refundPerInstallCents: number;
  totalRefundCents: number;
};

export type ArchitectSettingsPayload = {
  profile: ArchitectSettingsProfile;
  storefront: ArchitectSettingsStorefront;
  notifications: Record<string, { email?: boolean; push?: boolean; locked?: boolean }>;
  privacy: Record<string, boolean>;
  security: {
    sessions: ArchitectSettingsSession[];
    loginHistory: ArchitectLoginHistoryEntry[];
  };
  payouts: {
    payoutMethod: {
      bankName: string;
      accountHolderName: string;
      accountLast4: string;
      country: "US" | "IN";
      routingLabel: "IFSC" | "ABA routing number";
      routingLast4: string | null;
      verificationStatus: string;
      verified: boolean;
    } | null;
    backupPayoutMethod: {
      bankName: string;
      accountHolderName: string;
      accountLast4: string;
      country: "US" | "IN";
      routingLabel: "IFSC" | "ABA routing number";
      routingLast4: string | null;
      verificationStatus: string;
      verified: boolean;
    } | null;
    architectSharePercent: number;
    lastPayoutAt: string | null;
  };
  payoutSchedule: ArchitectPayoutSchedule;
  /** Computed next payout date from the saved schedule. */
  nextPayoutAt?: string;
  danger: {
    obligations: {
      agents: ArchitectRefundAgent[];
      totalRefundCents: number;
      requiresPayment: boolean;
    };
    agentsPaused: boolean;
    allAgentsPaused: boolean;
    hasPausableAgents: boolean;
  };
};

export function getArchitectSettings() {
  return apiGet<ArchitectSettingsPayload>("/architect/settings");
}

export function saveArchitectSettingsProfile(body: Partial<ArchitectSettingsProfile>) {
  return apiPut<{ profile: ArchitectSettingsProfile }>("/architect/settings/profile", body);
}

export function saveArchitectProfilePhoto(photoDataUrl: string) {
  return apiPut<{ profile: ArchitectSettingsProfile }>("/architect/settings/profile/photo", {
    photoDataUrl
  });
}

export function requestArchitectEmailChange(email: string) {
  return apiPost<{ email: string; sent: boolean }>("/architect/settings/profile/email/request", { email });
}

export function verifyArchitectEmailChange(body: { email: string; code: string }) {
  return apiPost<{
    email: string;
    token: string;
    user: {
      id: string;
      fullName: string | null;
      email: string;
      role: "ARCHITECT";
      profilePhotoUrl?: string | null;
    };
  }>("/architect/settings/profile/email/verify", body);
}

export function saveArchitectSettingsStorefront(body: Partial<ArchitectSettingsStorefront>) {
  return apiPut<{ storefront: ArchitectSettingsStorefront }>("/architect/settings/storefront", body);
}

export function saveArchitectMarketplacePhoto(photoDataUrl: string) {
  return apiPut<{ marketplacePhotoUrl: string | null }>("/architect/settings/storefront/photo", {
    photoDataUrl
  });
}

export function saveArchitectNotificationPrefs(body: Record<string, { email?: boolean; push?: boolean }>) {
  return apiPut<{ notifications: Record<string, unknown> }>("/architect/settings/notifications", body);
}

export const PAYOUT_WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
] as const;

export type ArchitectPayoutSchedule = {
  frequency: "Weekly" | "Bi-weekly" | "Monthly";
  /** Monthly payout day: "1", "15", "last", or a custom day "2".."28". */
  monthlyDay: string;
  /** Weekly payouts repeat on this weekday. */
  weeklyDay: (typeof PAYOUT_WEEKDAYS)[number];
  /** Bi-weekly payouts repeat every 14 days from this date (YYYY-MM-DD). */
  firstPayoutDate: string | null;
  thresholdCents: number;
};

export function saveArchitectPayoutSchedule(body: ArchitectPayoutSchedule) {
  return apiPut<{ payoutSchedule: ArchitectPayoutSchedule; nextPayoutAt?: string }>(
    "/architect/settings/payouts/schedule",
    body
  );
}

/**
 * Downloads the architect's data export as readable text (excludes agent source code
 * and conversation logs). Triggers a browser download on success.
 */
export async function downloadArchitectDataExport(): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiClient.get("/architect/settings/data-export", {
      responseType: "blob"
    });

    const blob = new Blob([response.data as BlobPart], { type: "text/plain;charset=utf-8" });
    const disposition =
      typeof response.headers?.["content-disposition"] === "string"
        ? response.headers["content-disposition"]
        : "";
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const filename = match?.[1] ?? `triven-architect-data-${new Date().toISOString().slice(0, 10)}.txt`;

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

export function saveArchitectPrivacyPrefs(body: Record<string, boolean>) {
  return apiPut<{ privacy: Record<string, boolean> }>("/architect/settings/privacy", body);
}

export function getArchitectLoginHistory(page = 1, perPage = 20) {
  return apiGet<{
    loginHistory: ArchitectLoginHistoryEntry[];
    pagination: { page: number; perPage: number; total: number; totalPages: number };
  }>(`/architect/settings/login-history?page=${page}&perPage=${perPage}`);
}

export function getArchitectActiveSessions() {
  return apiGet<{ sessions: ArchitectSettingsSession[] }>("/architect/settings/sessions");
}

export function revokeArchitectSession(sessionId: string) {
  return apiDelete<{ revoked: boolean }>(`/architect/settings/sessions/${sessionId}`);
}

export function revokeOtherArchitectSessions() {
  return apiDelete<{ revoked: boolean }>("/architect/settings/sessions");
}

export function getArchitectDangerObligations() {
  return apiGet<{
    agents: ArchitectRefundAgent[];
    totalRefundCents: number;
    requiresPayment: boolean;
  }>("/architect/settings/danger/obligations");
}

export function payArchitectRefundObligations(action: "PAUSE_ALL_AGENTS" | "DELETE_ACCOUNT") {
  return apiPost<{
    paid: boolean;
    settlementId?: string;
    amountCents: number;
    agents?: ArchitectRefundAgent[];
  }>("/architect/settings/danger/pay-obligations", { action });
}

export function pauseAllArchitectAgents() {
  return apiPost<{
    paused: boolean;
  }>("/architect/settings/danger/pause-agents", {});
}

export function reactivateAllArchitectAgents() {
  return apiPost<{
    reactivated: boolean;
  }>("/architect/settings/danger/reactivate-agents", {});
}

export function deleteArchitectAccount(confirmation: "DELETE") {
  return apiPost<{
    deleted: boolean;
    requiresPayment?: boolean;
    obligations?: {
      agents: ArchitectRefundAgent[];
      totalRefundCents: number;
      requiresPayment: boolean;
    };
  }>("/architect/settings/danger/delete-account", { confirmation });
}

export type LLMProviderResponse = {
  providers: Array<{
    id: string;
    displayName: string;
    models: string[];
  }>;
};

export function getLLMProviders() {
  return apiGet<LLMProviderResponse>("/architect/ai/providers");
}

export type WhatsAppConnection = {
  id: string;
  displayName: string | null;
  businessName: string | null;
  phoneNumber: string;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR" | "PENDING";
  qualityRating: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  webhookCallbackUrl: string;
};

export type WhatsAppConnectionOwnerView = WhatsAppConnection & {
  phoneNumberId: string;
  businessAccountId: string;
};

export type ConnectWhatsAppBody = {
  accessToken: string;
  phoneNumberId: string;
  phoneNumber: string;
  businessAccountId?: string;
  businessName?: string;
  displayName?: string;
  webhookVerifyToken?: string;
  appSecret?: string;
};

export function listWhatsAppConnections() {
  return apiGet<{ connections: WhatsAppConnection[] }>("/architect/whatsapp/connections");
}

export function listWhatsAppConnectionsOwnerView() {
  return apiGet<{ connections: WhatsAppConnectionOwnerView[] }>("/architect/whatsapp/connections?view=owner");
}

export function connectWhatsApp(body: ConnectWhatsAppBody) {
  return apiPost<{ connection: WhatsAppConnection }>("/architect/whatsapp/connections", body);
}

export function renameWhatsAppConnection(id: string, displayName: string) {
  return apiPatch<{ connection: WhatsAppConnection }>(`/integrations/whatsapp/connections/${id}`, {
    displayName
  });
}

export function deleteWhatsAppConnection(id: string) {
  return apiDelete<{ deleted: boolean }>(`/architect/whatsapp/connections/${id}`);
}

export function testWhatsAppConnection(id: string) {
  return apiPost<{
    result: {
      ok: boolean;
      phoneNumberId: string;
      displayPhoneNumber: string;
      verifiedName: string | null;
      qualityRating: string | null;
    };
  }>(`/architect/whatsapp/connections/${id}/test`, {});
}

export function refreshWhatsAppConnection(id: string) {
  return apiPost<{ connection: WhatsAppConnection }>(`/architect/whatsapp/connections/${id}/refresh`, {});
}

export function disconnectWhatsAppConnection(id: string) {
  return apiPost<{ connection: WhatsAppConnection }>(`/architect/whatsapp/connections/${id}/disconnect`, {});
}

export function startWhatsAppEmbeddedSignup(phoneNumber: string) {
  return apiPost<{ redirectUrl: string }>("/integrations/whatsapp/start", {
    phoneNumber
  });
}

export function callbackWhatsAppEmbeddedSignup(params: {
  code: string;
  phoneNumberId: string;
  wabaId: string;
  phoneNumber: string;
}) {
  const qs = new URLSearchParams({
    code: params.code,
    phoneNumberId: params.phoneNumberId,
    wabaId: params.wabaId,
    phoneNumber: params.phoneNumber
  });
  return apiGet<{ connection: WhatsAppConnection }>(`/integrations/whatsapp/callback?${qs.toString()}`);
}
