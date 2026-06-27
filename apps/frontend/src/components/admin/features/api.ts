import { apiGet, apiPatch } from "@/lib/api";

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
