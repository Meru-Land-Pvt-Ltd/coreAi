import { Hono, type Context, type Next } from "hono";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import { resolvePrimaryBusinessId } from "../business/primary-business";
import { CRM_CATALOG, findCatalogEntry, isLiveProvider, providerDisplayName } from "./catalog";
import { handleHubSpotOAuthCallback, safeRedirectPathFromState, setActiveCrmProvider } from "./hubspot/oauth";
import { hubspotRoutes } from "./hubspot/routes";
import { activeProviderSchema } from "./hubspot/validators";

/**
 * CRM router.
 *
 * Route order matters:
 *   1. OAuth callback — PUBLIC. The browser redirect from HubSpot carries no
 *      Bearer token; the HMAC-signed `state` is what proves the tenant.
 *   2. requireAuth + requireRole(["BUSINESS"]) — everything below is buyer-only.
 *   3. Provider catalog / active-provider — platform level, not HubSpot-specific.
 *   4. /hubspot/* — the first live adapter.
 */
export const crmRoutes = new Hono();

declare module "hono" {
  interface ContextVariableMap {
    /** Tenant for the current CRM request. Never client-supplied. */
    crmBusinessId: string;
  }
}

crmRoutes.get("/hubspot/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  const redirectBase = env.FRONTEND_URL.replace(/\/$/, "");
  const fallbackPath = safeRedirectPathFromState(state);

  if (c.req.query("error")) {
    // User declined on HubSpot's consent screen — return them to the page they
    // started from with a reason the UI can toast.
    return c.redirect(`${redirectBase}${fallbackPath}?crm=cancelled`);
  }

  if (!code || !state) {
    return c.redirect(`${redirectBase}${fallbackPath}?crm=error`);
  }

  try {
    const result = await handleHubSpotOAuthCallback({ code, state });
    const target = result.redirectPath ?? "/business/crm";
    return c.redirect(`${redirectBase}${target}?crm=connected`);
  } catch (error) {
    console.error("[crm] HubSpot OAuth callback failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return c.redirect(`${redirectBase}${fallbackPath}?crm=error`);
  }
});

crmRoutes.use("*", requireAuth);
crmRoutes.use("*", requireRole(["BUSINESS"]));

/**
 * Resolve the caller's own business. A client-supplied businessId is never
 * trusted — the tenant always comes from the authenticated user.
 */
async function requireCrmBusiness(c: Context, next: Next) {
  const authUser = c.get("authUser");
  const businessId = await resolvePrimaryBusinessId(authUser.id);

  if (!businessId) {
    return errorResponse(c, "No business workspace for this account", 404, "BUSINESS_NOT_FOUND");
  }

  c.set("crmBusinessId", businessId);
  await next();
}

crmRoutes.use("*", requireCrmBusiness);

/**
 * Catalog for the provider switcher. Coming-soon providers are listed so the
 * buyer can see where this is going, but cannot be activated.
 */
crmRoutes.get("/providers", async (c) => {
  const businessId = c.get("crmBusinessId");

  const connections = await prisma.crmConnection.findMany({
    where: { businessId },
    select: {
      provider: true,
      isActive: true,
      status: true,
      lastSyncedAt: true
    }
  });

  const byProvider = new Map(connections.map((row) => [String(row.provider), row]));
  const active = connections.find((row) => row.isActive && row.status === "CONNECTED");

  return successResponse(c, {
    activeProvider: active ? String(active.provider) : null,
    providers: CRM_CATALOG.map((entry) => {
      const connection = byProvider.get(entry.id);
      return {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        status: entry.status,
        connected: connection?.status === "CONNECTED",
        isActive: Boolean(connection?.isActive && connection.status === "CONNECTED"),
        lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null
      };
    })
  });
});

crmRoutes.get("/active-provider", async (c) => {
  const businessId = c.get("crmBusinessId");

  const connection = await prisma.crmConnection.findFirst({
    where: { businessId, isActive: true, status: "CONNECTED" },
    orderBy: { updatedAt: "desc" }
  });

  return successResponse(c, {
    provider: connection ? String(connection.provider) : null,
    connected: Boolean(connection),
    displayName: providerDisplayName(connection ? String(connection.provider) : null),
    lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null
  });
});

crmRoutes.patch("/active-provider", async (c) => {
  const businessId = c.get("crmBusinessId");
  const parsed = activeProviderSchema.safeParse(await c.req.json().catch(() => ({})));

  if (!parsed.success) {
    return errorResponse(c, "A provider is required", 422, "VALIDATION_ERROR");
  }

  const requested = parsed.data.provider.toUpperCase();
  const entry = findCatalogEntry(requested);
  if (!entry) return errorResponse(c, "Unknown CRM provider", 404, "CRM_PROVIDER_UNKNOWN");

  if (!isLiveProvider(requested)) {
    return errorResponse(
      c,
      `${entry.name} connection coming soon`,
      422,
      "CRM_PROVIDER_NOT_LIVE"
    );
  }

  const connection = await prisma.crmConnection.findUnique({
    where: { businessId_provider: { businessId, provider: requested } }
  });

  if (!connection || connection.status !== "CONNECTED") {
    return errorResponse(c, `Connect ${entry.name} first`, 409, "CRM_NOT_CONNECTED");
  }

  await setActiveCrmProvider(businessId, requested);

  return successResponse(
    c,
    { provider: requested, displayName: entry.name },
    `Using ${entry.name} for customer context`
  );
});

crmRoutes.route("/hubspot", hubspotRoutes);
