import { prisma } from "../../../lib/prisma";
import { CONTACT_PROPERTIES, mapHubSpotContact, type HubSpotContact } from "./utils/mapping";
import { cacheContact } from "./service";
import { HUBSPOT_API_BASE, getHubSpotAccessToken } from "./token.service";
import { withHubSpotRetry } from "./rate-limit";

/**
 * Incremental sync driven by HubSpot webhooks.
 *
 * Triven keeps a local mirror (CrmContactCache) so the CRM table renders and a
 * mid-call phone lookup stays fast. HubSpot pushes change events; this module
 * applies them one row at a time with bounded retries. HubSpot remains the
 * source of truth — a sync failure means a stale cache row, never lost data.
 */

const MAX_ATTEMPTS = 5;

interface HubSpotWebhookNotification {
  subscriptionType?: string;
  portalId?: number | string;
  objectId?: number | string;
  propertyName?: string;
  occurredAt?: number;
}

/** Store the raw payload immediately; processing happens off the request. */
export async function recordHubSpotWebhookEvent(params: {
  eventType: string;
  payload: unknown;
  portalId?: string | null;
}): Promise<{ id: string; businessId: string | null }> {
  const connection = params.portalId
    ? await prisma.crmConnection.findFirst({
        where: { portalId: params.portalId, provider: "HUBSPOT" },
        select: { id: true, businessId: true }
      })
    : null;

  const row = await prisma.crmWebhookEvent.create({
    data: {
      eventType: params.eventType,
      payloadJson: params.payload as never,
      connectionId: connection?.id ?? null,
      businessId: connection?.businessId ?? null
    },
    select: { id: true, businessId: true }
  });

  return row;
}

export async function processHubSpotWebhookEvent(eventRowId: string): Promise<void> {
  const event = await prisma.crmWebhookEvent.findUnique({ where: { id: eventRowId } });
  if (!event) return;
  if (event.status === "DONE") return;

  await prisma.crmWebhookEvent.update({
    where: { id: event.id },
    data: { status: "PROCESSING", attempts: { increment: 1 } }
  });

  try {
    const notifications = Array.isArray(event.payloadJson)
      ? (event.payloadJson as HubSpotWebhookNotification[])
      : [event.payloadJson as HubSpotWebhookNotification];

    for (const notification of notifications) {
      await applyNotification(notification);
    }

    await prisma.crmWebhookEvent.update({
      where: { id: event.id },
      data: { status: "DONE", processedAt: new Date(), lastError: null }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = event.attempts + 1;

    await prisma.crmWebhookEvent.update({
      where: { id: event.id },
      data: {
        // Exhausted retries stay FAILED so they are visible, not silently lost.
        status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
        lastError: message
      }
    });

    console.error("[hubspot] webhook event processing failed", {
      eventRowId,
      attempts,
      error: message
    });

    if (attempts < MAX_ATTEMPTS) throw error;
  }
}

async function applyNotification(notification: HubSpotWebhookNotification): Promise<void> {
  const portalId = notification.portalId != null ? String(notification.portalId) : null;
  const objectId = notification.objectId != null ? String(notification.objectId) : null;
  if (!portalId || !objectId) return;

  const connection = await prisma.crmConnection.findFirst({
    where: { portalId, provider: "HUBSPOT", status: { in: ["CONNECTED", "PENDING"] } },
    select: { id: true, businessId: true }
  });
  if (!connection) return;

  const subscription = (notification.subscriptionType ?? "").toLowerCase();

  if (subscription.startsWith("contact.deletion")) {
    await prisma.crmContactCache.deleteMany({
      where: { connectionId: connection.id, contactId: objectId }
    });
    return;
  }

  if (!subscription.startsWith("contact.")) return;

  await refreshCachedContact({
    businessId: connection.businessId,
    connectionId: connection.id,
    contactId: objectId
  });
}

/** Pull one contact from HubSpot and refresh its cache row. */
export async function refreshCachedContact(params: {
  businessId: string;
  connectionId: string;
  contactId: string;
}): Promise<void> {
  const token = await getHubSpotAccessToken(params.businessId);

  const response = await withHubSpotRetry(
    () =>
      fetch(
        `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${encodeURIComponent(params.contactId)}` +
          `?properties=${CONTACT_PROPERTIES.join(",")}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000)
        }
      ),
    { label: "sync.contact" }
  );

  if (response.status === 404) {
    // Deleted or merged away in HubSpot — drop the mirror row.
    await prisma.crmContactCache.deleteMany({
      where: { connectionId: params.connectionId, contactId: params.contactId }
    });
    return;
  }

  if (!response.ok) {
    throw new Error(`HubSpot contact sync failed (${response.status})`);
  }

  const contact = (await response.json()) as HubSpotContact;
  await cacheContact({
    businessId: params.businessId,
    connectionId: params.connectionId,
    contact: mapHubSpotContact(contact)
  });

  await prisma.crmConnection.update({
    where: { id: params.connectionId },
    data: { lastSyncedAt: new Date() }
  });
}
