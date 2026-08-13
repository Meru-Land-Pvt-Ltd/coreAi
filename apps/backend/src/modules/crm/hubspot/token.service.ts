import type { CrmConnection } from "@prisma/client";
import { env } from "../../../config/env";
import { decryptSecret, encryptSecret } from "../../../lib/crypto";
import { prisma } from "../../../lib/prisma";

/**
 * HubSpot OAuth token lifecycle.
 *
 * Tokens are AES-256-GCM encrypted at rest through the shared crypto helpers
 * (same as every other connector in this repo) and are NEVER returned by an
 * API response or written to a log line.
 */

export const HUBSPOT_AUTH_BASE = "https://app.hubspot.com";
export const HUBSPOT_API_BASE = "https://api.hubapi.com";

/** Refresh this far ahead of expiry so a mid-call lookup never races the clock. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface HubSpotTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export class HubSpotNotConnectedError extends Error {
  readonly code = "HUBSPOT_NOT_CONNECTED";
  constructor(message = "HubSpot is not connected for this business") {
    super(message);
    this.name = "HubSpotNotConnectedError";
  }
}

export function assertHubSpotConfig(): void {
  if (!env.HUBSPOT_CLIENT_ID || !env.HUBSPOT_CLIENT_SECRET) {
    throw new Error("HubSpot OAuth env variables are missing (HUBSPOT_CLIENT_ID/SECRET)");
  }
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing");
  }
}

export function isHubSpotConfigured(): boolean {
  return Boolean(env.HUBSPOT_CLIENT_ID && env.HUBSPOT_CLIENT_SECRET);
}

export function hubspotRedirectUri(): string {
  return env.HUBSPOT_OAUTH_REDIRECT_URI ?? `${env.BACKEND_URL}/crm/hubspot/callback`;
}

export function hubspotWebhookUrl(): string {
  return env.HUBSPOT_WEBHOOK_URL ?? `${env.BACKEND_URL}/webhook/hubspot`;
}

export async function exchangeHubSpotToken(
  body: Record<string, string>
): Promise<HubSpotTokenResponse> {
  assertHubSpotConfig();

  const response = await fetch(`${HUBSPOT_API_BASE}/oauth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000)
  });

  const json = (await response.json().catch(() => ({}))) as HubSpotTokenResponse & {
    message?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok) {
    throw new Error(
      json.error_description || json.message || json.error || "HubSpot token exchange failed"
    );
  }
  return json;
}

function expiryFrom(tokens: HubSpotTokenResponse): Date | null {
  return typeof tokens.expires_in === "number"
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;
}

export async function persistHubSpotTokens(params: {
  businessId: string;
  tokens: HubSpotTokenResponse;
  portalId?: string | null;
  scopes?: string | null;
}): Promise<CrmConnection> {
  const { businessId, tokens } = params;

  const data = {
    ...(tokens.access_token ? { encryptedAccessToken: encryptSecret(tokens.access_token) } : {}),
    // HubSpot only returns a refresh token on the initial exchange; a refresh
    // response omits it, and overwriting with null would break the connection.
    ...(tokens.refresh_token
      ? { encryptedRefreshToken: encryptSecret(tokens.refresh_token) }
      : {}),
    expiresAt: expiryFrom(tokens),
    ...(params.portalId !== undefined ? { portalId: params.portalId } : {}),
    ...(params.scopes !== undefined ? { scopes: params.scopes } : {}),
    status: "CONNECTED" as const,
    lastError: null
  };

  return prisma.crmConnection.upsert({
    where: { businessId_provider: { businessId, provider: "HUBSPOT" } },
    create: { businessId, provider: "HUBSPOT", isActive: true, ...data },
    update: data
  });
}

export async function getHubSpotConnection(businessId: string): Promise<CrmConnection | null> {
  return prisma.crmConnection.findUnique({
    where: { businessId_provider: { businessId, provider: "HUBSPOT" } }
  });
}

export async function refreshHubSpotToken(businessId: string): Promise<string> {
  const connection = await getHubSpotConnection(businessId);
  if (!connection?.encryptedRefreshToken) {
    throw new HubSpotNotConnectedError("HubSpot refresh token is missing — reconnect HubSpot");
  }

  const refreshToken = decryptSecret(connection.encryptedRefreshToken);

  let tokens: HubSpotTokenResponse;
  try {
    tokens = await exchangeHubSpotToken({
      grant_type: "refresh_token",
      client_id: env.HUBSPOT_CLIENT_ID!,
      client_secret: env.HUBSPOT_CLIENT_SECRET!,
      refresh_token: refreshToken
    });
  } catch (error) {
    // A dead refresh token is a connection-level failure the buyer must see on
    // the CRM page, not a silent retry loop.
    const message = error instanceof Error ? error.message : "HubSpot token refresh failed";
    await prisma.crmConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", lastError: message }
    });
    throw error;
  }

  if (!tokens.access_token) throw new Error("HubSpot did not return an access token");
  await persistHubSpotTokens({ businessId, tokens });
  return tokens.access_token;
}

/**
 * Valid bearer token for this business, refreshing ahead of expiry.
 * Throws HubSpotNotConnectedError when the business has no live connection —
 * callers on the voice path must catch this and fall back to no CRM context.
 */
export async function getHubSpotAccessToken(businessId: string): Promise<string> {
  const connection = await getHubSpotConnection(businessId);
  if (!connection?.encryptedAccessToken || connection.status === "DISCONNECTED") {
    throw new HubSpotNotConnectedError();
  }

  const expiresSoon =
    connection.expiresAt != null && connection.expiresAt.getTime() < Date.now() + REFRESH_SKEW_MS;

  if (expiresSoon) return refreshHubSpotToken(businessId);
  return decryptSecret(connection.encryptedAccessToken);
}
