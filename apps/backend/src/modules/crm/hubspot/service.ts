import { prisma } from "../../../lib/prisma";
import type {
  CrmActivityDto,
  CrmContactDetailDto,
  CrmContactDto,
  CrmDealDto
} from "./dto/contacts";
import { HubSpotApiError, withHubSpotRetry } from "./rate-limit";
import {
  HUBSPOT_API_BASE,
  HubSpotNotConnectedError,
  getHubSpotAccessToken,
  getHubSpotConnection,
  refreshHubSpotToken
} from "./token.service";
import {
  CONTACT_PROPERTIES,
  contactDisplayName,
  mapCacheRow,
  mapHubSpotContact,
  toHubSpotProperties,
  type HubSpotContact
} from "./utils/mapping";
import { phoneMatchKey, phoneSearchVariants, toE164 } from "./utils/phone";

/**
 * HubSpot CRM API access, scoped to one business.
 *
 * Everything is tenant-scoped through the business's own CrmConnection — there
 * is no shared portal and no code path where one business's token reads
 * another's contacts.
 */

async function hubspotFetch<T>(
  businessId: string,
  path: string,
  init: RequestInit = {},
  options: { label?: string; retryOnAuth?: boolean } = {}
): Promise<T> {
  const token = await getHubSpotAccessToken(businessId);

  const perform = (bearer: string) =>
    withHubSpotRetry(
      () =>
        fetch(`${HUBSPOT_API_BASE}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
            ...(init.headers ?? {})
          },
          signal: AbortSignal.timeout(20_000)
        }),
      { label: options.label ?? path }
    );

  let response = await perform(token);

  // A 401 mid-flight means the token died early (revoked, or rotated by
  // another process). One refresh + retry, then surface it honestly.
  if (response.status === 401 && options.retryOnAuth !== false) {
    const refreshed = await refreshHubSpotToken(businessId);
    response = await perform(refreshed);
  }

  if (response.status === 204) return {} as T;

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message =
      (payload as { message?: string }).message ?? `HubSpot API error (${response.status})`;
    throw new HubSpotApiError(message, response.status, payload);
  }

  return payload as T;
}

/** Owner id → display name, so the table shows a person rather than a number. */
async function loadOwnerNames(businessId: string): Promise<Map<string, string>> {
  try {
    const payload = await hubspotFetch<{
      results?: { id?: string; firstName?: string; lastName?: string; email?: string }[];
    }>(businessId, "/crm/v3/owners?limit=200", { method: "GET" }, { label: "owners" });

    const names = new Map<string, string>();
    for (const owner of payload.results ?? []) {
      if (!owner.id) continue;
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();
      names.set(owner.id, name || owner.email || owner.id);
    }
    return names;
  } catch (error) {
    // Owner names are decoration; losing them must not fail a contact list.
    console.warn("[hubspot] owner lookup failed", {
      businessId,
      error: error instanceof Error ? error.message : String(error)
    });
    return new Map();
  }
}

async function requireConnection(businessId: string) {
  const connection = await getHubSpotConnection(businessId);
  if (!connection || connection.status === "DISCONNECTED") throw new HubSpotNotConnectedError();
  return connection;
}

/**
 * Write a contact into the local cache.
 *
 * The cache is what makes a mid-call lookup fast and what keeps the CRM table
 * rendering when HubSpot is slow or throttled. It is a mirror, never the
 * source of truth.
 */
export async function cacheContact(params: {
  businessId: string;
  connectionId: string;
  contact: CrmContactDto;
}): Promise<void> {
  const { businessId, connectionId, contact } = params;

  const data = {
    businessId,
    phone: contact.phone ? toE164(contact.phone) ?? contact.phone : null,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    company: contact.company,
    owner: contact.owner,
    stage: contact.stage,
    lastActivity: contact.lastInteractionAt ? new Date(contact.lastInteractionAt) : null,
    lastSynced: new Date(),
    insight: contact.insight,
    payloadJson: {
      vip: contact.vip,
      preferredLanguage: contact.preferredLanguage,
      customerSince: contact.customerSince
    }
  };

  await prisma.crmContactCache.upsert({
    where: { connectionId_contactId: { connectionId, contactId: contact.id } },
    create: { connectionId, contactId: contact.id, ...data },
    update: data
  });
}

export async function listHubSpotContacts(params: {
  businessId: string;
  query?: string | null;
  stage?: string | null;
  owner?: string | null;
  page: number;
  perPage: number;
}): Promise<{ items: CrmContactDto[]; total: number }> {
  const connection = await requireConnection(params.businessId);
  const ownerNames = await loadOwnerNames(params.businessId);

  const filterGroups: unknown[] = [];
  if (params.stage) {
    filterGroups.push({
      filters: [{ propertyName: "hs_lead_status", operator: "EQ", value: params.stage }]
    });
  }

  // HubSpot search matches name/email/phone from a single `query` term, which
  // is exactly the buyer-facing "search name, phone, or email" behaviour.
  const body = {
    ...(params.query?.trim() ? { query: params.query.trim() } : {}),
    ...(filterGroups.length ? { filterGroups } : {}),
    properties: [...CONTACT_PROPERTIES],
    limit: params.perPage,
    after: String((params.page - 1) * params.perPage),
    sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }]
  };

  const payload = await hubspotFetch<{ total?: number; results?: HubSpotContact[] }>(
    params.businessId,
    "/crm/v3/objects/contacts/search",
    { method: "POST", body: JSON.stringify(body) },
    { label: "contacts.search" }
  );

  const items = (payload.results ?? []).map((contact) => mapHubSpotContact(contact, ownerNames));

  // Refresh the cache opportunistically; a cache write must never fail a read.
  await Promise.all(
    items.map((contact) =>
      cacheContact({
        businessId: params.businessId,
        connectionId: connection.id,
        contact
      }).catch((error) => {
        console.warn("[hubspot] contact cache write failed", {
          contactId: contact.id,
          error: error instanceof Error ? error.message : String(error)
        });
      })
    )
  );

  await prisma.crmConnection.update({
    where: { id: connection.id },
    data: { lastSyncedAt: new Date(), status: "CONNECTED", lastError: null }
  });

  return { items, total: payload.total ?? items.length };
}

export async function getHubSpotContact(
  businessId: string,
  contactId: string
): Promise<CrmContactDetailDto> {
  const connection = await requireConnection(businessId);
  const ownerNames = await loadOwnerNames(businessId);

  const contact = await hubspotFetch<HubSpotContact>(
    businessId,
    `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=${CONTACT_PROPERTIES.join(",")}`,
    { method: "GET" },
    { label: "contacts.get" }
  );

  const base = mapHubSpotContact(contact, ownerNames);

  // Deals and activities are supporting detail — a failure degrades the drawer
  // section instead of the whole request.
  const [deals, activities] = await Promise.all([
    listContactDeals(businessId, contactId).catch(() => [] as CrmDealDto[]),
    listContactActivities(businessId, contactId).catch(() => [] as CrmActivityDto[])
  ]);

  await cacheContact({ businessId, connectionId: connection.id, contact: base }).catch(() => {});

  return {
    ...base,
    aiSummary: latestAiSummary(activities),
    deals,
    activities
  };
}

/** Most recent Triven-written AI summary note, if one exists. */
function latestAiSummary(activities: CrmActivityDto[]): string | null {
  const summary = activities.find((activity) => activity.type === "AI_SUMMARY");
  return summary?.body ?? null;
}

async function listContactDeals(businessId: string, contactId: string): Promise<CrmDealDto[]> {
  const associations = await hubspotFetch<{ results?: { toObjectId?: string | number; id?: string }[] }>(
    businessId,
    `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/deals?limit=25`,
    { method: "GET" },
    { label: "contacts.deals" }
  );

  const dealIds = (associations.results ?? [])
    .map((entry) => String(entry.toObjectId ?? entry.id ?? ""))
    .filter(Boolean);
  if (!dealIds.length) return [];

  const payload = await hubspotFetch<{
    results?: { id: string; properties?: Record<string, string | null> }[];
  }>(
    businessId,
    "/crm/v3/objects/deals/batch/read",
    {
      method: "POST",
      body: JSON.stringify({
        properties: ["dealname", "dealstage", "amount", "closedate", "deal_currency_code"],
        inputs: dealIds.map((id) => ({ id }))
      })
    },
    { label: "deals.batch" }
  );

  return (payload.results ?? []).map((deal) => {
    const properties = deal.properties ?? {};
    const amount = Number(properties.amount);
    return {
      id: deal.id,
      name: properties.dealname?.trim() || "Untitled deal",
      stage: properties.dealstage?.trim() || null,
      amount: Number.isFinite(amount) ? amount : null,
      currency: properties.deal_currency_code?.trim() || null,
      closeDate: properties.closedate?.trim() || null
    };
  });
}

const ACTIVITY_TYPE_BY_OBJECT: Record<string, string> = {
  notes: "NOTE",
  calls: "CALL",
  emails: "EMAIL",
  meetings: "MEETING",
  tasks: "TASK"
};

async function listContactActivities(
  businessId: string,
  contactId: string
): Promise<CrmActivityDto[]> {
  const objects = ["notes", "calls", "emails", "meetings"] as const;

  const perObject = await Promise.all(
    objects.map(async (object) => {
      try {
        const associations = await hubspotFetch<{
          results?: { toObjectId?: string | number; id?: string }[];
        }>(
          businessId,
          `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/${object}?limit=10`,
          { method: "GET" },
          { label: `contacts.${object}` }
        );

        const ids = (associations.results ?? [])
          .map((entry) => String(entry.toObjectId ?? entry.id ?? ""))
          .filter(Boolean);
        if (!ids.length) return [] as CrmActivityDto[];

        const payload = await hubspotFetch<{
          results?: { id: string; properties?: Record<string, string | null> }[];
        }>(
          businessId,
          `/crm/v3/objects/${object}/batch/read`,
          {
            method: "POST",
            body: JSON.stringify({
              properties: activityProperties(object),
              inputs: ids.map((id) => ({ id }))
            })
          },
          { label: `${object}.batch` }
        );

        return (payload.results ?? []).map((record) =>
          mapActivity(object, record.id, record.properties ?? {})
        );
      } catch {
        return [] as CrmActivityDto[];
      }
    })
  );

  return perObject
    .flat()
    .sort((left, right) => (right.occurredAt ?? "").localeCompare(left.occurredAt ?? ""))
    .slice(0, 25);
}

function activityProperties(object: string): string[] {
  if (object === "notes") return ["hs_note_body", "hs_timestamp", "hs_createdate"];
  if (object === "calls") {
    return ["hs_call_title", "hs_call_body", "hs_timestamp", "hs_call_duration"];
  }
  if (object === "emails") return ["hs_email_subject", "hs_email_text", "hs_timestamp"];
  return ["hs_meeting_title", "hs_meeting_body", "hs_timestamp"];
}

function mapActivity(
  object: string,
  id: string,
  properties: Record<string, string | null>
): CrmActivityDto {
  const body =
    properties.hs_note_body ??
    properties.hs_call_body ??
    properties.hs_email_text ??
    properties.hs_meeting_body ??
    null;

  const stripped = body ? body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : null;

  // Triven writes its call summaries as notes with a known marker, so they can
  // be surfaced as "AI summary" instead of an anonymous note.
  const isAiSummary = object === "notes" && Boolean(stripped?.startsWith(AI_NOTE_MARKER));

  return {
    id,
    type: isAiSummary ? "AI_SUMMARY" : ACTIVITY_TYPE_BY_OBJECT[object] ?? "NOTE",
    title:
      properties.hs_call_title ??
      properties.hs_email_subject ??
      properties.hs_meeting_title ??
      null,
    body: isAiSummary && stripped ? stripped.slice(AI_NOTE_MARKER.length).trim() : stripped,
    occurredAt: properties.hs_timestamp ?? properties.hs_createdate ?? null
  };
}

export const AI_NOTE_MARKER = "[Triven AI]";

/**
 * Find a contact by phone number.
 *
 * This is the mid-call lookup. It tries the local cache first (sub-millisecond)
 * and only reaches HubSpot on a miss, because the caller is on the line.
 */
export async function findContactByPhone(params: {
  businessId: string;
  phone: string;
  /** Skip the cache and force a live read (used by after-call sync). */
  fresh?: boolean;
}): Promise<CrmContactDto | null> {
  const variants = phoneSearchVariants(params.phone);
  if (!variants.length) return null;

  const connection = await requireConnection(params.businessId);

  if (!params.fresh) {
    const matchKey = phoneMatchKey(params.phone);
    if (matchKey) {
      const cached = await prisma.crmContactCache.findFirst({
        where: {
          businessId: params.businessId,
          connectionId: connection.id,
          phone: { endsWith: matchKey }
        },
        orderBy: { lastSynced: "desc" }
      });
      if (cached) return mapCacheRow(cached);
    }
  }

  const payload = await hubspotFetch<{ results?: HubSpotContact[] }>(
    params.businessId,
    "/crm/v3/objects/contacts/search",
    {
      method: "POST",
      body: JSON.stringify({
        filterGroups: variants.flatMap((value) => [
          { filters: [{ propertyName: "phone", operator: "EQ", value }] },
          { filters: [{ propertyName: "mobilephone", operator: "EQ", value }] }
        ]),
        properties: [...CONTACT_PROPERTIES],
        limit: 1
      })
    },
    { label: "contacts.searchByPhone" }
  );

  const found = payload.results?.[0];
  if (!found) return null;

  const ownerNames = await loadOwnerNames(params.businessId);
  const contact = mapHubSpotContact(found, ownerNames);
  await cacheContact({
    businessId: params.businessId,
    connectionId: connection.id,
    contact
  }).catch(() => {});

  return contact;
}

export async function findContactByEmail(
  businessId: string,
  email: string
): Promise<CrmContactDto | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const payload = await hubspotFetch<{ results?: HubSpotContact[] }>(
    businessId,
    "/crm/v3/objects/contacts/search",
    {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [
          { filters: [{ propertyName: "email", operator: "EQ", value: normalized }] }
        ],
        properties: [...CONTACT_PROPERTIES],
        limit: 1
      })
    },
    { label: "contacts.searchByEmail" }
  );

  const found = payload.results?.[0];
  if (!found) return null;
  return mapHubSpotContact(found, await loadOwnerNames(businessId));
}

export interface ContactUpsertInput {
  phone: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  company?: string | null;
  preferredLanguage?: string | null;
  stage?: string | null;
  vip?: boolean;
}

/**
 * Create-or-update a contact keyed on phone.
 *
 * Phone is the only required field. Email and company are omitted when unknown
 * rather than filled with a placeholder — writing a fake address into the
 * customer's CRM would be worse than an empty column.
 */
export async function upsertContactByPhone(params: {
  businessId: string;
  input: ContactUpsertInput;
}): Promise<{ contact: CrmContactDto; created: boolean }> {
  const connection = await requireConnection(params.businessId);
  const phone = toE164(params.input.phone);
  if (!phone) throw new HubSpotApiError("A valid phone number is required", 422);

  const existing = await findContactByPhone({
    businessId: params.businessId,
    phone,
    fresh: true
  });

  const properties = toHubSpotProperties({ ...params.input, phone });
  // Never blank a field that is already populated in HubSpot just because this
  // call did not learn it.
  for (const key of Object.keys(properties)) {
    if (properties[key] === "") delete properties[key];
  }

  const ownerNames = await loadOwnerNames(params.businessId);

  if (existing) {
    const updated = await hubspotFetch<HubSpotContact>(
      params.businessId,
      `/crm/v3/objects/contacts/${encodeURIComponent(existing.id)}`,
      { method: "PATCH", body: JSON.stringify({ properties }) },
      { label: "contacts.update" }
    );
    const contact = mapHubSpotContact(updated, ownerNames);
    await cacheContact({
      businessId: params.businessId,
      connectionId: connection.id,
      contact
    }).catch(() => {});
    return { contact, created: false };
  }

  const created = await hubspotFetch<HubSpotContact>(
    params.businessId,
    "/crm/v3/objects/contacts",
    { method: "POST", body: JSON.stringify({ properties }) },
    { label: "contacts.create" }
  );

  const contact = mapHubSpotContact(created, ownerNames);
  await cacheContact({
    businessId: params.businessId,
    connectionId: connection.id,
    contact
  }).catch(() => {});

  console.info("[hubspot] contact created from call", {
    businessId: params.businessId,
    contactId: contact.id,
    hasEmail: Boolean(contact.email),
    hasName: Boolean(contact.firstName || contact.lastName)
  });

  return { contact, created: true };
}

export async function updateContact(params: {
  businessId: string;
  contactId: string;
  input: Partial<ContactUpsertInput> & { phone?: string | null };
}): Promise<CrmContactDto> {
  const connection = await requireConnection(params.businessId);
  const properties = toHubSpotProperties(params.input);

  if (!Object.keys(properties).length) {
    return getHubSpotContact(params.businessId, params.contactId);
  }

  const updated = await hubspotFetch<HubSpotContact>(
    params.businessId,
    `/crm/v3/objects/contacts/${encodeURIComponent(params.contactId)}`,
    { method: "PATCH", body: JSON.stringify({ properties }) },
    { label: "contacts.patch" }
  );

  const contact = mapHubSpotContact(updated, await loadOwnerNames(params.businessId));
  await cacheContact({
    businessId: params.businessId,
    connectionId: connection.id,
    contact
  }).catch(() => {});

  return contact;
}

/** Attach a note to a contact (used for AI call summaries). */
export async function createContactNote(params: {
  businessId: string;
  contactId: string;
  body: string;
  /** Marks the note as Triven-written so the drawer can label it. */
  aiGenerated?: boolean;
}): Promise<{ id: string } | null> {
  const body = params.aiGenerated ? `${AI_NOTE_MARKER} ${params.body}` : params.body;

  const created = await hubspotFetch<{ id?: string }>(
    params.businessId,
    "/crm/v3/objects/notes",
    {
      method: "POST",
      body: JSON.stringify({
        properties: { hs_note_body: body, hs_timestamp: new Date().toISOString() },
        associations: [
          {
            to: { id: params.contactId },
            // 202 = note → contact association type in HubSpot v3.
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }]
          }
        ]
      })
    },
    { label: "notes.create" }
  );

  return created.id ? { id: created.id } : null;
}

export async function updateDealStage(params: {
  businessId: string;
  dealId: string;
  stage: string;
}): Promise<void> {
  await hubspotFetch(
    params.businessId,
    `/crm/v3/objects/deals/${encodeURIComponent(params.dealId)}`,
    { method: "PATCH", body: JSON.stringify({ properties: { dealstage: params.stage } }) },
    { label: "deals.patch" }
  );
}

export { HubSpotApiError, HubSpotNotConnectedError, contactDisplayName };
