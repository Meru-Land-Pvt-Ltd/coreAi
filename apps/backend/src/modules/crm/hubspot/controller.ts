import type { Context } from "hono";
import { ZodError } from "zod";
import { errorResponse, successResponse } from "../../../lib/api-response";
import { prisma } from "../../../lib/prisma";
import type { CrmDashboardDto } from "./dto/contacts";
import { HubSpotApiError } from "./rate-limit";
import {
  createContactNote,
  getHubSpotContact,
  findContactByEmail,
  findContactByPhone,
  listHubSpotContacts,
  updateContact,
  updateDealStage,
  upsertContactByPhone
} from "./service";
import { HubSpotNotConnectedError, getHubSpotConnection } from "./token.service";
import { mapCacheRow } from "./utils/mapping";
import {
  contactListQuerySchema,
  contactNoteSchema,
  contactSearchQuerySchema,
  contactUpdateSchema,
  contactUpsertSchema,
  dealStageSchema
} from "./validators";

/**
 * Thin Hono handlers. Business rules live in the services; this layer resolves
 * the tenant, validates input, and maps errors onto the repo's API envelope.
 */

/** Every handler runs after requireCrmBusiness, which sets this. */
function businessId(c: Context): string {
  return c.get("crmBusinessId") as string;
}

/** Route params are typed optional; a missing one is a 404, not a crash. */
function requiredParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new HubSpotApiError(`Missing ${name}`, 404);
  return value;
}

export function handleCrmError(c: Context, error: unknown, fallback: string) {
  if (error instanceof ZodError) {
    return errorResponse(c, error.issues[0]?.message ?? "Invalid request", 422, "VALIDATION_ERROR");
  }

  if (error instanceof HubSpotNotConnectedError) {
    return errorResponse(c, error.message, 409, "CRM_NOT_CONNECTED");
  }

  if (error instanceof HubSpotApiError) {
    if (error.isRateLimited) {
      return errorResponse(c, "HubSpot is rate limiting requests — try again shortly", 429, "CRM_RATE_LIMITED");
    }
    if (error.isAuthError) {
      return errorResponse(c, "HubSpot rejected the connection — reconnect HubSpot", 401, "CRM_AUTH_FAILED");
    }
    if (error.status === 404) {
      return errorResponse(c, "Contact not found in HubSpot", 404, "CRM_NOT_FOUND");
    }
    return errorResponse(c, error.message, 503, "CRM_UPSTREAM_ERROR");
  }

  console.error("[crm] request failed", {
    requestId: c.get("requestId"),
    error: error instanceof Error ? error.message : String(error)
  });
  return errorResponse(c, fallback, 500, "CRM_REQUEST_FAILED");
}

export async function getDashboard(c: Context) {
  const id = businessId(c);

  try {
    const connection = await getHubSpotConnection(id);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [cachedTotal, activeCustomers, appointments, voiceCalls, whatsappMessages] =
      await Promise.all([
        connection
          ? prisma.crmContactCache.count({ where: { connectionId: connection.id } })
          : Promise.resolve(0),
        // "Active" = touched in the last 90 days, per the cached last activity.
        connection
          ? prisma.crmContactCache.count({
              where: {
                connectionId: connection.id,
                lastActivity: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
              }
            })
          : Promise.resolve(0),
        prisma.appointment.count({
          where: { businessId: id, executionMode: "LIVE", createdAt: { gte: monthStart } }
        }),
        prisma.vapiCall.count({
          where: { businessId: id, executionMode: "LIVE", startedAt: { gte: monthStart } }
        }),
        prisma.smsExecution.count({ where: { businessId: id, createdAt: { gte: monthStart } } })
      ]);

    const openDeals = connection
      ? await prisma.crmObjectMapping.count({
          where: { connectionId: connection.id, hubspotObject: "deal" }
        })
      : 0;

    const payload: CrmDashboardDto = {
      totalCustomers: cachedTotal,
      activeCustomers,
      appointments,
      openDeals,
      // AI interactions this month across the channels Triven actually runs.
      aiInteractions: voiceCalls + whatsappMessages,
      lastSyncedAt: connection?.lastSyncedAt ? connection.lastSyncedAt.toISOString() : null,
      connected: connection?.status === "CONNECTED",
      portalId: connection?.portalId ?? null
    };

    return successResponse(c, payload);
  } catch (error) {
    return handleCrmError(c, error, "Could not load CRM dashboard");
  }
}

export async function listContacts(c: Context) {
  const id = businessId(c);

  try {
    const query = contactListQuerySchema.parse({
      q: c.req.query("q"),
      stage: c.req.query("stage"),
      owner: c.req.query("owner"),
      tag: c.req.query("tag"),
      page: c.req.query("page") ?? 1,
      perPage: c.req.query("perPage") ?? 10
    });

    const result = await listHubSpotContacts({
      businessId: id,
      query: query.q ?? null,
      stage: query.stage ?? null,
      owner: query.owner ?? null,
      page: query.page,
      perPage: query.perPage
    });

    return successResponse(c, {
      items: result.items,
      pagination: {
        page: query.page,
        perPage: query.perPage,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.perPage))
      }
    });
  } catch (error) {
    // A HubSpot outage should still render the table from the local mirror
    // rather than showing the buyer an error page.
    if (error instanceof HubSpotApiError && !error.isAuthError) {
      const fallback = await listContactsFromCache(c, id).catch(() => null);
      if (fallback) return fallback;
    }
    return handleCrmError(c, error, "Could not load contacts");
  }
}

async function listContactsFromCache(c: Context, id: string) {
  const connection = await getHubSpotConnection(id);
  if (!connection) return null;

  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const perPage = Math.min(100, Math.max(1, Number(c.req.query("perPage")) || 10));

  const [rows, total] = await Promise.all([
    prisma.crmContactCache.findMany({
      where: { connectionId: connection.id },
      orderBy: { lastActivity: "desc" },
      skip: (page - 1) * perPage,
      take: perPage
    }),
    prisma.crmContactCache.count({ where: { connectionId: connection.id } })
  ]);

  console.warn("[crm] serving contacts from cache — HubSpot unavailable", { businessId: id });

  return successResponse(
    c,
    {
      items: rows.map(mapCacheRow),
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
      stale: true
    },
    "Showing cached contacts — HubSpot is temporarily unavailable"
  );
}

export async function getContact(c: Context) {
  try {
    const contact = await getHubSpotContact(businessId(c), requiredParam(c, "id"));
    return successResponse(c, contact);
  } catch (error) {
    return handleCrmError(c, error, "Could not load contact");
  }
}

export async function patchContact(c: Context) {
  const id = businessId(c);

  try {
    const body = contactUpdateSchema.parse(await c.req.json().catch(() => ({})));

    // Warn (do not block) when the new number already belongs to someone else —
    // duplicate phone numbers break the mid-call lookup.
    let phoneConflict: string | null = null;
    if (body.phone) {
      const existing = await findContactByPhone({ businessId: id, phone: body.phone, fresh: true });
      if (existing && existing.id !== requiredParam(c, "id")) phoneConflict = existing.name;
    }

    const contact = await updateContact({
      businessId: id,
      contactId: requiredParam(c, "id"),
      input: body
    });

    return successResponse(
      c,
      { contact, phoneConflict },
      phoneConflict
        ? `Saved. Note: ${phoneConflict} already uses this phone number.`
        : "Customer details saved"
    );
  } catch (error) {
    return handleCrmError(c, error, "Could not save customer details");
  }
}

export async function upsertContact(c: Context) {
  try {
    const body = contactUpsertSchema.parse(await c.req.json().catch(() => ({})));
    const result = await upsertContactByPhone({ businessId: businessId(c), input: body });
    return successResponse(c, result, result.created ? "Contact created" : "Contact updated");
  } catch (error) {
    return handleCrmError(c, error, "Could not save the contact");
  }
}

export async function searchContact(c: Context) {
  const id = businessId(c);

  try {
    const query = contactSearchQuerySchema.parse({
      phone: c.req.query("phone"),
      email: c.req.query("email")
    });

    const contact = query.phone
      ? await findContactByPhone({ businessId: id, phone: query.phone })
      : await findContactByEmail(id, query.email!);

    return successResponse(c, { contact, found: Boolean(contact) });
  } catch (error) {
    return handleCrmError(c, error, "Could not search contacts");
  }
}

export async function addContactNote(c: Context) {
  try {
    const body = contactNoteSchema.parse(await c.req.json().catch(() => ({})));
    const note = await createContactNote({
      businessId: businessId(c),
      contactId: requiredParam(c, "id"),
      body: body.body
    });
    return successResponse(c, { note }, "Note added");
  } catch (error) {
    return handleCrmError(c, error, "Could not add the note");
  }
}

export async function patchDealStage(c: Context) {
  try {
    const body = dealStageSchema.parse(await c.req.json().catch(() => ({})));
    await updateDealStage({
      businessId: businessId(c),
      dealId: requiredParam(c, "dealId"),
      stage: body.stage
    });
    return successResponse(c, { updated: true }, "Deal stage updated");
  } catch (error) {
    return handleCrmError(c, error, "Could not update the deal stage");
  }
}
