import crypto from "crypto";
import { env } from "../../../config/env";
import { decryptSecret } from "../../../lib/crypto";
import { prisma } from "../../../lib/prisma";
import {
  HUBSPOT_API_BASE,
  HUBSPOT_AUTH_BASE,
  assertHubSpotConfig,
  exchangeHubSpotToken,
  getHubSpotConnection,
  hubspotRedirectUri,
  persistHubSpotTokens
} from "./token.service";

/**
 * HubSpot OAuth 2.0 — same shape as the Calendly connector already in this
 * repo: authenticated endpoint hands back an authorize URL carrying an
 * HMAC-signed state, and an UNAUTHENTICATED callback verifies that signature.
 * The browser redirect has no Bearer token, so the signed state is what proves
 * which business is connecting.
 */

/**
 * Least-privilege scope set for customer context: read contacts/companies/
 * deals/owners, write contacts + notes (after-call sync) and deal stage.
 */
export const HUBSPOT_SCOPES = [
  "oauth",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.companies.read",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
  "crm.objects.owners.read"
] as const;

const STATE_TTL_MS = 10 * 60 * 1000;

interface HubSpotStatePayload {
  businessId: string;
  userId: string;
  redirectPath: string | null;
  createdAt: number;
}

function signStatePayload(payload: HubSpotStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", env.JWT_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyStatePayload(
  state: string,
  options?: { allowExpired?: boolean }
): HubSpotStatePayload {
  const [body, signature] = state.split(".");
  if (!body || !signature) throw new Error("Invalid OAuth state");

  const expected = crypto.createHmac("sha256", env.JWT_SECRET).update(body).digest("base64url");
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    throw new Error("Invalid OAuth state signature");
  }

  let payload: Partial<HubSpotStatePayload>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid OAuth state payload");
  }

  if (typeof payload.businessId !== "string" || typeof payload.userId !== "string") {
    throw new Error("Invalid OAuth state subject");
  }

  const createdAt = typeof payload.createdAt === "number" ? payload.createdAt : 0;
  if (Date.now() - createdAt > STATE_TTL_MS && !options?.allowExpired) {
    throw new Error("OAuth state expired");
  }

  return {
    businessId: payload.businessId,
    userId: payload.userId,
    // Open-redirect guard: only same-origin buyer paths are ever honoured.
    redirectPath:
      typeof payload.redirectPath === "string" && payload.redirectPath.startsWith("/business/")
        ? payload.redirectPath
        : null,
    createdAt
  };
}

/** Redirect target for a failed callback, best-effort even on an expired state. */
export function safeRedirectPathFromState(state: string | undefined | null): string {
  if (!state) return "/business/crm";
  try {
    return verifyStatePayload(state, { allowExpired: true }).redirectPath ?? "/business/crm";
  } catch {
    return "/business/crm";
  }
}

export function createHubSpotOAuthUrl(params: {
  businessId: string;
  userId: string;
  redirectPath?: string | null;
}): string {
  assertHubSpotConfig();

  const state = signStatePayload({
    businessId: params.businessId,
    userId: params.userId,
    redirectPath: params.redirectPath ?? null,
    createdAt: Date.now()
  });

  const query = new URLSearchParams({
    client_id: env.HUBSPOT_CLIENT_ID!,
    redirect_uri: hubspotRedirectUri(),
    scope: HUBSPOT_SCOPES.join(" "),
    state
  });

  return `${HUBSPOT_AUTH_BASE}/oauth/authorize?${query.toString()}`;
}

/** Portal id + granted scopes, read back from the token itself. */
async function fetchTokenMetadata(
  accessToken: string
): Promise<{ portalId: string | null; scopes: string | null }> {
  const response = await fetch(
    `${HUBSPOT_API_BASE}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`,
    { method: "GET", signal: AbortSignal.timeout(15_000) }
  );
  if (!response.ok) return { portalId: null, scopes: null };

  const payload = (await response.json().catch(() => ({}))) as {
    hub_id?: number | string;
    scopes?: string[];
  };

  return {
    portalId: payload.hub_id != null ? String(payload.hub_id) : null,
    scopes: Array.isArray(payload.scopes) ? payload.scopes.join(" ") : null
  };
}

export async function handleHubSpotOAuthCallback(params: {
  code: string;
  state: string;
}): Promise<{ businessId: string; redirectPath: string | null; portalId: string | null }> {
  const { businessId, redirectPath } = verifyStatePayload(params.state);

  const tokens = await exchangeHubSpotToken({
    grant_type: "authorization_code",
    client_id: env.HUBSPOT_CLIENT_ID!,
    client_secret: env.HUBSPOT_CLIENT_SECRET!,
    redirect_uri: hubspotRedirectUri(),
    code: params.code
  });

  if (!tokens.access_token) throw new Error("HubSpot did not return an access token");

  const meta = await fetchTokenMetadata(tokens.access_token).catch(() => ({
    portalId: null,
    scopes: null
  }));

  await persistHubSpotTokens({
    businessId,
    tokens,
    portalId: meta.portalId,
    scopes: meta.scopes
  });

  // Connecting a CRM makes it the active one — a business that just linked
  // HubSpot expects calls to start using it without a second step.
  await setActiveCrmProvider(businessId, "HUBSPOT");

  console.info("[hubspot] OAuth success", { businessId, portalId: meta.portalId });
  return { businessId, redirectPath, portalId: meta.portalId };
}

/**
 * Exactly one active CRM per business. Connected-but-inactive providers stay
 * linked; only the active one feeds AI lookup and after-call sync.
 */
export async function setActiveCrmProvider(
  businessId: string,
  provider: "HUBSPOT"
): Promise<void> {
  await prisma.$transaction([
    prisma.crmConnection.updateMany({
      where: { businessId, NOT: { provider } },
      data: { isActive: false }
    }),
    prisma.crmConnection.updateMany({
      where: { businessId, provider },
      data: { isActive: true }
    })
  ]);
}

export async function disconnectHubSpot(businessId: string): Promise<void> {
  const connection = await getHubSpotConnection(businessId);
  if (!connection) return;

  // Best-effort provider-side revoke; a failure here must not strand the row.
  if (connection.encryptedRefreshToken) {
    try {
      const refreshToken = decryptSecret(connection.encryptedRefreshToken);
      await fetch(
        `${HUBSPOT_API_BASE}/oauth/v1/refresh-tokens/${encodeURIComponent(refreshToken)}`,
        { method: "DELETE", signal: AbortSignal.timeout(10_000) }
      );
    } catch (error) {
      console.error("[hubspot] refresh token revoke failed", {
        businessId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Cascade removes the cached contacts and object mappings with the row.
  await prisma.crmConnection.delete({ where: { id: connection.id } });
  console.info("[hubspot] disconnected", { businessId });
}
