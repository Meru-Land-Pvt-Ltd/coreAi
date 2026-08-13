import { apiGet, apiPatch, apiPost, type ApiResponse } from "@/lib/api";

/**
 * Typed wrappers around /crm/* and /crm/hubspot/*.
 *
 * The bearer token is attached by the axios interceptor in @/lib/api — the same
 * client every other buyer page uses. Nothing here talks to HubSpot directly;
 * all CRM writes go through the Triven API so tokens never reach the browser.
 */

export type CrmProviderStatus = "live" | "coming_soon";

export type CrmProviderEntry = {
  id: string;
  name: string;
  description: string;
  status: CrmProviderStatus;
  connected: boolean;
  isActive: boolean;
  lastSyncedAt: string | null;
};

export type CrmProvidersResponse = {
  activeProvider: string | null;
  providers: CrmProviderEntry[];
};

export type CrmContact = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  owner: string | null;
  stage: string | null;
  vip: boolean;
  preferredLanguage: string | null;
  customerSince: string | null;
  lastInteractionAt: string | null;
  insight: string | null;
};

export type CrmDeal = {
  id: string;
  name: string;
  stage: string | null;
  amount: number | null;
  currency: string | null;
  closeDate: string | null;
};

export type CrmActivity = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  occurredAt: string | null;
};

export type CrmContactDetail = CrmContact & {
  aiSummary: string | null;
  deals: CrmDeal[];
  activities: CrmActivity[];
};

export type CrmPagination = {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

export type CrmContactList = {
  items: CrmContact[];
  pagination: CrmPagination;
  /** True when HubSpot was unreachable and the cache answered instead. */
  stale?: boolean;
};

export type CrmDashboard = {
  totalCustomers: number;
  activeCustomers: number;
  appointments: number;
  openDeals: number;
  aiInteractions: number;
  lastSyncedAt: string | null;
  connected: boolean;
  portalId: string | null;
};

export type CrmStatus = {
  connected: boolean;
  portalId: string | null;
  scopes: string | null;
  status: string;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  configured: boolean;
};

/** Only fields the buyer actually changed are sent. */
export type CrmContactUpdate = {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string;
  email?: string | null;
  company?: string | null;
  preferredLanguage?: string | null;
  stage?: string | null;
  vip?: boolean;
};

export function getCrmProviders(): Promise<ApiResponse<CrmProvidersResponse>> {
  return apiGet<CrmProvidersResponse>("/crm/providers");
}

export function setActiveCrmProvider(
  provider: string
): Promise<ApiResponse<{ provider: string; displayName: string }>> {
  return apiPatch<{ provider: string; displayName: string }>("/crm/active-provider", { provider });
}

export function getHubSpotStatus(): Promise<ApiResponse<CrmStatus>> {
  return apiGet<CrmStatus>("/crm/hubspot/status");
}

/** Returns the authorize URL; the caller navigates the browser to it. */
export function getHubSpotOAuthUrl(redirectPath: string): Promise<ApiResponse<{ url: string }>> {
  return apiGet<{ url: string }>(
    `/crm/hubspot/auth?redirectPath=${encodeURIComponent(redirectPath)}`
  );
}

export function disconnectHubSpot(): Promise<ApiResponse<{ disconnected: boolean }>> {
  return apiPost<{ disconnected: boolean }>("/crm/hubspot/disconnect", {});
}

export function getCrmDashboard(): Promise<ApiResponse<CrmDashboard>> {
  return apiGet<CrmDashboard>("/crm/hubspot/dashboard");
}

export function listCrmContacts(params: {
  q?: string;
  stage?: string;
  owner?: string;
  page?: number;
  perPage?: number;
}): Promise<ApiResponse<CrmContactList>> {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.stage) query.set("stage", params.stage);
  if (params.owner) query.set("owner", params.owner);
  query.set("page", String(params.page ?? 1));
  query.set("perPage", String(params.perPage ?? 10));

  return apiGet<CrmContactList>(`/crm/hubspot/contacts?${query.toString()}`);
}

export function getCrmContact(contactId: string): Promise<ApiResponse<CrmContactDetail>> {
  return apiGet<CrmContactDetail>(`/crm/hubspot/contacts/${encodeURIComponent(contactId)}`);
}

export function updateCrmContact(
  contactId: string,
  input: CrmContactUpdate
): Promise<ApiResponse<{ contact: CrmContact; phoneConflict: string | null }>> {
  return apiPatch<{ contact: CrmContact; phoneConflict: string | null }>(
    `/crm/hubspot/contacts/${encodeURIComponent(contactId)}`,
    input
  );
}

export function addCrmContactNote(
  contactId: string,
  body: string
): Promise<ApiResponse<{ note: { id: string } | null }>> {
  return apiPost<{ note: { id: string } | null }>(
    `/crm/hubspot/contacts/${encodeURIComponent(contactId)}/notes`,
    { body }
  );
}

export function updateCrmDealStage(
  dealId: string,
  stage: string
): Promise<ApiResponse<{ updated: boolean }>> {
  return apiPatch<{ updated: boolean }>(`/crm/hubspot/deals/${encodeURIComponent(dealId)}`, {
    stage
  });
}
