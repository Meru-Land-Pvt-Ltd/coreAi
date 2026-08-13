/**
 * Buyer-facing CRM DTOs.
 *
 * Consumer callers usually have NO company and NO email — every field except
 * `id` and `name` is nullable on purpose, and the UI renders a blank as "—"
 * rather than treating it as missing data.
 */

export interface CrmContactDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** Display name; falls back to the phone number when no name is known. */
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  owner: string | null;
  /** Lifecycle stage or lead status, whichever the portal populates. */
  stage: string | null;
  vip: boolean;
  preferredLanguage: string | null;
  customerSince: string | null;
  lastInteractionAt: string | null;
  /** Short AI insight line rendered in the table. */
  insight: string | null;
}

export interface CrmDealDto {
  id: string;
  name: string;
  stage: string | null;
  amount: number | null;
  currency: string | null;
  closeDate: string | null;
}

export interface CrmActivityDto {
  id: string;
  /** CALL | NOTE | EMAIL | MEETING | TASK | WHATSAPP | AI_SUMMARY */
  type: string;
  title: string | null;
  body: string | null;
  occurredAt: string | null;
}

export interface CrmContactDetailDto extends CrmContactDto {
  aiSummary: string | null;
  deals: CrmDealDto[];
  activities: CrmActivityDto[];
}

export interface CrmPagination {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface CrmContactListDto {
  items: CrmContactDto[];
  pagination: CrmPagination;
}

export interface CrmDashboardDto {
  totalCustomers: number;
  activeCustomers: number;
  appointments: number;
  openDeals: number;
  aiInteractions: number;
  lastSyncedAt: string | null;
  connected: boolean;
  portalId: string | null;
}
