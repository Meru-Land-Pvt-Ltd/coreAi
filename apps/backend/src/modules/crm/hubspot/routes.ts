import { Hono } from "hono";
import { errorResponse, successResponse } from "../../../lib/api-response";
import {
  addContactNote,
  getContact,
  getDashboard,
  handleCrmError,
  listContacts,
  patchContact,
  patchDealStage,
  searchContact,
  upsertContact
} from "./controller";
import { createHubSpotOAuthUrl, disconnectHubSpot } from "./oauth";
import { getHubSpotConnection, isHubSpotConfigured } from "./token.service";

/**
 * Authenticated HubSpot routes.
 *
 * The OAuth callback is NOT here — a browser redirect carries no Bearer token,
 * so it is registered on the parent CRM router before the auth gate.
 */
export const hubspotRoutes = new Hono();

hubspotRoutes.get("/auth", async (c) => {
  const businessId = c.get("crmBusinessId") as string;
  const authUser = c.get("authUser");

  if (!isHubSpotConfigured()) {
    return errorResponse(
      c,
      "HubSpot is not configured on this environment yet",
      503,
      "CRM_NOT_CONFIGURED"
    );
  }

  try {
    const url = createHubSpotOAuthUrl({
      businessId,
      userId: authUser.id,
      redirectPath: c.req.query("redirectPath") ?? "/business/crm"
    });
    return successResponse(c, { url });
  } catch (error) {
    return handleCrmError(c, error, "Could not start the HubSpot connection");
  }
});

hubspotRoutes.get("/status", async (c) => {
  const businessId = c.get("crmBusinessId") as string;
  const connection = await getHubSpotConnection(businessId);

  return successResponse(c, {
    connected: connection?.status === "CONNECTED",
    portalId: connection?.portalId ?? null,
    scopes: connection?.scopes ?? null,
    status: connection?.status ?? "DISCONNECTED",
    isActive: connection?.isActive ?? false,
    lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
    lastError: connection?.lastError ?? null,
    configured: isHubSpotConfigured()
  });
});

hubspotRoutes.post("/disconnect", async (c) => {
  const businessId = c.get("crmBusinessId") as string;
  try {
    await disconnectHubSpot(businessId);
    return successResponse(c, { disconnected: true }, "HubSpot disconnected");
  } catch (error) {
    return handleCrmError(c, error, "Could not disconnect HubSpot");
  }
});

hubspotRoutes.get("/dashboard", getDashboard);

// /search is declared before /contacts/:id so "search" is never read as an id.
hubspotRoutes.get("/search", searchContact);
hubspotRoutes.get("/contacts", listContacts);
hubspotRoutes.post("/contacts/upsert", upsertContact);
hubspotRoutes.get("/contacts/:id", getContact);
hubspotRoutes.patch("/contacts/:id", patchContact);
hubspotRoutes.post("/contacts/:id/notes", addContactNote);
hubspotRoutes.patch("/deals/:dealId", patchDealStage);
