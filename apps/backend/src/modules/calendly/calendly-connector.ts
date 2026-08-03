import crypto from "crypto";
import { env } from "../../config/env";
import { encryptSecret, decryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";

export const CALENDLY_CONNECTOR = "Calendly";
export const CALENDLY_AUTH_BASE = "https://auth.calendly.com";
export const CALENDLY_API_BASE = "https://api.calendly.com";

export type CalendlyCredentialMetadata = {
  userUri?: string | null;
  organizationUri?: string | null;
  timezone?: string | null;
  name?: string | null;
  webhookSubscriptionUri?: string | null;
  webhookSigningKeyEnc?: string | null;
};

export type CalendlyConnectionStatus = {
  connected: boolean;
  email: string | null;
  name: string | null;
  timezone: string | null;
  userUri: string | null;
  organizationUri: string | null;
};

type CalendlyTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  created_at?: number;
  owner?: string;
  organization?: string;
};

function assertCalendlyConfig() {
  if (!env.CALENDLY_CLIENT_ID || !env.CALENDLY_CLIENT_SECRET) {
    throw new Error("Calendly OAuth env variables are missing");
  }
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing");
  }
}

function getRedirectUri() {
  return (
    env.CALENDLY_OAUTH_REDIRECT_URI ??
    `${env.BACKEND_URL}/architect/connectors/calendly/callback`
  );
}

export function calendlyWebhookCallbackUrl() {
  return env.CALENDLY_WEBHOOK_URL ?? `${env.BACKEND_URL}/webhook/calendly`;
}

function signStatePayload(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function verifyStatePayload(state: string, options?: { allowExpired?: boolean }) {
  const [body, signature] = state.split(".");
  if (!body || !signature) throw new Error("Invalid OAuth state");

  const expectedSignature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(body)
    .digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    throw new Error("Invalid OAuth state signature");
  }

  let payload: { userId?: unknown; redirectPath?: unknown; createdAt?: unknown };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid OAuth state payload");
  }
  if (typeof payload.userId !== "string") throw new Error("Invalid OAuth state user");

  const createdAt = typeof payload.createdAt === "number" ? payload.createdAt : 0;
  if (Date.now() - createdAt > 10 * 60 * 1000 && !options?.allowExpired) {
    throw new Error("OAuth state expired");
  }

  const redirectPath =
    typeof payload.redirectPath === "string" && payload.redirectPath.startsWith("/")
      ? payload.redirectPath
      : null;

  return { userId: payload.userId, redirectPath };
}

export function getCalendlyOAuthRedirectPath(state: string) {
  return verifyStatePayload(state, { allowExpired: true }).redirectPath;
}

function asMetadata(value: unknown): CalendlyCredentialMetadata {
  if (!value || typeof value !== "object") return {};
  return value as CalendlyCredentialMetadata;
}

async function exchangeToken(body: Record<string, string>): Promise<CalendlyTokenResponse> {
  assertCalendlyConfig();
  const response = await fetch(`${CALENDLY_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const json = (await response.json().catch(() => ({}))) as CalendlyTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok) {
    throw new Error(json.error_description || json.error || "Calendly token exchange failed");
  }
  return json;
}

export function createCalendlyOAuthUrl(userId: string, redirectPath?: string) {
  assertCalendlyConfig();
  const state = signStatePayload({
    userId,
    redirectPath: redirectPath ?? null,
    createdAt: Date.now()
  });
  const params = new URLSearchParams({
    client_id: env.CALENDLY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    state
  });
  return `${CALENDLY_AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

async function calendlyApiRequest<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${CALENDLY_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const json = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    title?: string;
  };
  if (!response.ok) {
    const message =
      (json as { message?: string }).message ||
      (json as { title?: string }).title ||
      `Calendly API error (${response.status})`;
    throw new Error(message);
  }
  return json as T;
}

async function persistTokens({
  userId,
  tokens,
  email,
  metadata
}: {
  userId: string;
  tokens: CalendlyTokenResponse;
  email?: string | null;
  metadata?: CalendlyCredentialMetadata;
}) {
  const existing = await prisma.connectorCredential.findUnique({
    where: { userId_provider: { userId, provider: "CALENDLY" } }
  });
  const existingMeta = asMetadata(existing?.metadata);
  const expiresAt =
    typeof tokens.expires_in === "number"
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : existing?.expiresAt ?? null;

  const nextMeta: CalendlyCredentialMetadata = {
    ...existingMeta,
    ...metadata,
    userUri: metadata?.userUri ?? tokens.owner ?? existingMeta.userUri ?? null,
    organizationUri:
      metadata?.organizationUri ?? tokens.organization ?? existingMeta.organizationUri ?? null
  };

  await prisma.connectorCredential.upsert({
    where: { userId_provider: { userId, provider: "CALENDLY" } },
    update: {
      externalAccountEmail: email ?? existing?.externalAccountEmail ?? null,
      accessTokenEnc: tokens.access_token
        ? encryptSecret(tokens.access_token)
        : existing?.accessTokenEnc ?? null,
      refreshTokenEnc: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : existing?.refreshTokenEnc ?? null,
      scope: tokens.scope ?? existing?.scope ?? null,
      tokenType: tokens.token_type ?? existing?.tokenType ?? null,
      expiresAt,
      metadata: nextMeta
    },
    create: {
      userId,
      provider: "CALENDLY",
      externalAccountEmail: email ?? null,
      accessTokenEnc: tokens.access_token ? encryptSecret(tokens.access_token) : null,
      refreshTokenEnc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      scope: tokens.scope ?? null,
      tokenType: tokens.token_type ?? null,
      expiresAt,
      metadata: nextMeta
    }
  });
}

export async function handleCalendlyOAuthCallback({
  code,
  state,
  redirectUriOverride
}: {
  code: string;
  state: string;
  /** Must match the redirect_uri used in the authorize request (Calendly requirement). */
  redirectUriOverride?: string;
}) {
  const { userId, redirectPath } = verifyStatePayload(state);
  const tokens = await exchangeToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUriOverride || getRedirectUri(),
    client_id: env.CALENDLY_CLIENT_ID!,
    client_secret: env.CALENDLY_CLIENT_SECRET!
  });

  if (!tokens.access_token) throw new Error("Calendly did not return an access token");

  const me = await calendlyApiRequest<{
    resource?: { uri?: string; email?: string; name?: string; timezone?: string; current_organization?: string };
  }>(tokens.access_token, "/users/me");

  const resource = me.resource ?? {};
  await persistTokens({
    userId,
    tokens,
    email: resource.email ?? null,
    metadata: {
      userUri: resource.uri ?? tokens.owner ?? null,
      organizationUri: resource.current_organization ?? tokens.organization ?? null,
      name: resource.name ?? null,
      timezone: resource.timezone ?? null
    }
  });

  try {
    await ensureCalendlyWebhookSubscription(userId);
  } catch (error) {
    console.error("[calendly] webhook subscription failed after OAuth", {
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  console.info("[calendly] OAuth success", { userId, email: resource.email ?? null });
  return { userId, redirectPath };
}

export async function refreshCalendlyToken(userId: string) {
  const credential = await prisma.connectorCredential.findUnique({
    where: { userId_provider: { userId, provider: "CALENDLY" } }
  });
  if (!credential?.refreshTokenEnc) {
    throw new Error("Calendly refresh token is missing — reconnect Calendly");
  }
  const refreshToken = decryptSecret(credential.refreshTokenEnc);
  const tokens = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.CALENDLY_CLIENT_ID!,
    client_secret: env.CALENDLY_CLIENT_SECRET!
  });
  await persistTokens({ userId, tokens });
  return tokens;
}

async function getValidAccessToken(userId: string): Promise<string> {
  const credential = await prisma.connectorCredential.findUnique({
    where: { userId_provider: { userId, provider: "CALENDLY" } }
  });
  if (!credential?.accessTokenEnc) {
    throw new Error("Calendly is not connected");
  }

  const expiresSoon =
    credential.expiresAt != null && credential.expiresAt.getTime() < Date.now() + 60_000;
  if (expiresSoon) {
    const refreshed = await refreshCalendlyToken(userId);
    if (!refreshed.access_token) throw new Error("Calendly token refresh failed");
    return refreshed.access_token;
  }

  return decryptSecret(credential.accessTokenEnc);
}

export async function getCalendlyConnectionStatus(userId: string): Promise<CalendlyConnectionStatus> {
  const credential = await prisma.connectorCredential.findUnique({
    where: { userId_provider: { userId, provider: "CALENDLY" } }
  });
  if (!credential?.accessTokenEnc) {
    return {
      connected: false,
      email: null,
      name: null,
      timezone: null,
      userUri: null,
      organizationUri: null
    };
  }
  const meta = asMetadata(credential.metadata);
  return {
    connected: true,
    email: credential.externalAccountEmail,
    name: meta.name ?? null,
    timezone: meta.timezone ?? null,
    userUri: meta.userUri ?? null,
    organizationUri: meta.organizationUri ?? null
  };
}

export async function disconnectCalendly(userId: string) {
  const credential = await prisma.connectorCredential.findUnique({
    where: { userId_provider: { userId, provider: "CALENDLY" } }
  });
  if (!credential) return;

  const meta = asMetadata(credential.metadata);
  if (meta.webhookSubscriptionUri && credential.accessTokenEnc) {
    try {
      const token = decryptSecret(credential.accessTokenEnc);
      const uuid = meta.webhookSubscriptionUri.split("/").pop();
      if (uuid) {
        await fetch(`${CALENDLY_API_BASE}/webhook_subscriptions/${uuid}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch (error) {
      console.error("[calendly] failed to delete webhook subscription", {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  await prisma.connectorCredential.delete({
    where: { userId_provider: { userId, provider: "CALENDLY" } }
  });
  console.info("[calendly] disconnected", { userId });
}

export async function calendlyGetUser(userId: string) {
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(token, "/users/me");
}

export async function calendlyListEventTypes(userId: string) {
  const status = await getCalendlyConnectionStatus(userId);
  if (!status.userUri) throw new Error("Calendly user URI missing — reconnect Calendly");
  const token = await getValidAccessToken(userId);
  const params = new URLSearchParams({ user: status.userUri, count: "100" });
  return calendlyApiRequest<{ collection: Array<Record<string, unknown>> }>(
    token,
    `/event_types?${params.toString()}`
  );
}

export async function calendlyListEvents(
  userId: string,
  input: { minStartTime?: string; maxStartTime?: string; status?: string }
) {
  const status = await getCalendlyConnectionStatus(userId);
  if (!status.userUri) throw new Error("Calendly user URI missing — reconnect Calendly");
  const token = await getValidAccessToken(userId);
  const params = new URLSearchParams({ user: status.userUri, count: "100" });
  if (input.minStartTime) params.set("min_start_time", input.minStartTime);
  if (input.maxStartTime) params.set("max_start_time", input.maxStartTime);
  if (input.status) params.set("status", input.status);
  return calendlyApiRequest<{ collection: Array<Record<string, unknown>> }>(
    token,
    `/scheduled_events?${params.toString()}`
  );
}

export async function calendlyGetEvent(userId: string, eventUuid: string) {
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(
    token,
    `/scheduled_events/${encodeURIComponent(eventUuid)}`
  );
}

export async function calendlyListInvitees(userId: string, eventUuid: string) {
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ collection: Array<Record<string, unknown>> }>(
    token,
    `/scheduled_events/${encodeURIComponent(eventUuid)}/invitees`
  );
}

export async function calendlyGetInvitee(userId: string, eventUuid: string, inviteeUuid: string) {
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(
    token,
    `/scheduled_events/${encodeURIComponent(eventUuid)}/invitees/${encodeURIComponent(inviteeUuid)}`
  );
}

export async function calendlyGetAvailability(
  userId: string,
  input: { eventTypeUri: string; startTime: string; endTime: string; timezone?: string }
) {
  const token = await getValidAccessToken(userId);
  const body: Record<string, unknown> = {
    event_type: input.eventTypeUri,
    start_time: input.startTime,
    end_time: input.endTime
  };
  // Calendly availability API expects ISO range; timezone is applied by callers when needed.
  void input.timezone;
  return calendlyApiRequest<{ collection?: Array<Record<string, unknown>>; resource?: Record<string, unknown> }>(
    token,
    "/event_type_available_times?" +
      new URLSearchParams({
        event_type: input.eventTypeUri,
        start_time: input.startTime,
        end_time: input.endTime
      }).toString()
  );
}

export async function calendlyCreateSchedulingLink(userId: string, eventTypeUri: string) {
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(token, "/scheduling_links", {
    method: "POST",
    body: JSON.stringify({
      max_event_count: 1,
      owner: eventTypeUri,
      owner_type: "EventType"
    })
  });
}

export async function ensureCalendlyWebhookSubscription(userId: string) {
  const status = await getCalendlyConnectionStatus(userId);
  if (!status.organizationUri) {
    throw new Error("Calendly organization URI missing — reconnect Calendly");
  }

  const credential = await prisma.connectorCredential.findUnique({
    where: { userId_provider: { userId, provider: "CALENDLY" } }
  });
  const meta = asMetadata(credential?.metadata);
  if (meta.webhookSubscriptionUri) return meta.webhookSubscriptionUri;

  const token = await getValidAccessToken(userId);
  const created = await calendlyApiRequest<{
    resource?: { uri?: string; signing_key?: string };
  }>(token, "/webhook_subscriptions", {
    method: "POST",
    body: JSON.stringify({
      url: calendlyWebhookCallbackUrl(),
      events: [
        "invitee.created",
        "invitee.canceled",
        "routing_form_submission.created"
      ],
      organization: status.organizationUri,
      scope: "organization",
      signing_key: true
    })
  });

  const subscriptionUri = created.resource?.uri ?? null;
  const signingKey = created.resource?.signing_key ?? null;
  await prisma.connectorCredential.update({
    where: { userId_provider: { userId, provider: "CALENDLY" } },
    data: {
      metadata: {
        ...meta,
        webhookSubscriptionUri: subscriptionUri,
        webhookSigningKeyEnc: signingKey ? encryptSecret(signingKey) : meta.webhookSigningKeyEnc ?? null
      }
    }
  });

  return subscriptionUri;
}

export async function findCalendlyCredentialByOrganizationUri(organizationUri: string) {
  const credentials = await prisma.connectorCredential.findMany({
    where: { provider: "CALENDLY" }
  });
  return (
    credentials.find((row) => asMetadata(row.metadata).organizationUri === organizationUri) ?? null
  );
}

export function getCalendlySigningKeyFromCredential(credential: {
  metadata?: unknown;
}): string | null {
  const meta = asMetadata(credential.metadata);
  if (!meta.webhookSigningKeyEnc) return null;
  try {
    return decryptSecret(meta.webhookSigningKeyEnc);
  } catch {
    return null;
  }
}

/**
 * Calendly-Webhook-Signature: t=timestamp,v1=signature
 * signed payload = `${timestamp}.${rawBody}`
 */
export function verifyCalendlyWebhookSignature({
  rawBody,
  signatureHeader,
  signingKey
}: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  signingKey: string;
}): boolean {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [k, v] = part.trim().split("=");
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const ageMs = Math.abs(Date.now() - Number(timestamp) * 1000);
  if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) return false;

  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
