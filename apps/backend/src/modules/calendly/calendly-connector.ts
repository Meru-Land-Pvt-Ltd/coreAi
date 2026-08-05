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
  /** Last webhook subscribe error (cleared when subscription succeeds). */
  webhookSubscriptionError?: string | null;
};

export type CalendlyConnectionStatus = {
  connected: boolean;
  email: string | null;
  name: string | null;
  timezone: string | null;
  userUri: string | null;
  organizationUri: string | null;
  /** True when a Calendly webhook subscription URI is stored. */
  webhookReady: boolean;
  webhookError: string | null;
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

  if (response.status === 204 || response.status === 205) {
    if (!response.ok) {
      throw new Error(`Calendly API error (${response.status})`);
    }
    return {} as T;
  }

  const text = await response.text();
  const json = (text ? JSON.parse(text) : {}) as T & {
    message?: string;
    title?: string;
    details?: Array<{ parameter?: string; message?: string; code?: string }>;
  };
  if (!response.ok) {
    const detailText = Array.isArray(json.details)
      ? json.details
          .map((detail) => {
            const parameter = detail.parameter?.trim();
            const detailMessage = detail.message?.trim();
            if (parameter && detailMessage) return `${parameter}: ${detailMessage}`;
            return detailMessage || parameter || "";
          })
          .filter(Boolean)
          .join("; ")
      : "";
    const message =
      detailText ||
      json.message ||
      json.title ||
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
      timezone: resource.timezone ?? null,
      webhookSubscriptionError: null
    }
  });

  let webhookSubscribed = false;
  let webhookError: string | null = null;
  try {
    await ensureCalendlyWebhookSubscription(userId);
    webhookSubscribed = true;
  } catch (error) {
    webhookError = error instanceof Error ? error.message : String(error);
    console.error("[calendly] webhook subscription failed after OAuth", {
      userId,
      error: webhookError
    });
    const existing = await prisma.connectorCredential.findUnique({
      where: { userId_provider: { userId, provider: "CALENDLY" } }
    });
    const meta = asMetadata(existing?.metadata);
    await prisma.connectorCredential.update({
      where: { userId_provider: { userId, provider: "CALENDLY" } },
      data: {
        metadata: {
          ...meta,
          webhookSubscriptionError: webhookError
        }
      }
    });
    // Production must not pretend connect succeeded without live triggers.
    if (env.NODE_ENV === "production") {
      throw new Error(
        `Calendly connected but webhook registration failed: ${webhookError}. Check CALENDLY_WEBHOOK_URL is public HTTPS, then reconnect.`
      );
    }
  }

  console.info("[calendly] OAuth success", {
    userId,
    email: resource.email ?? null,
    webhookSubscribed
  });
  return { userId, redirectPath, webhookSubscribed, webhookError };
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
      organizationUri: null,
      webhookReady: false,
      webhookError: null
    };
  }
  const meta = asMetadata(credential.metadata);
  return {
    connected: true,
    email: credential.externalAccountEmail,
    name: meta.name ?? null,
    timezone: meta.timezone ?? null,
    userUri: meta.userUri ?? null,
    organizationUri: meta.organizationUri ?? null,
    webhookReady: Boolean(meta.webhookSubscriptionUri),
    webhookError: meta.webhookSubscriptionError ?? null
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default picker / list window: 1 year past → 1 year ahead. */
export function calendlyDefaultEventListRange(now = Date.now()) {
  return {
    minStartTime: new Date(now - 365 * DAY_MS).toISOString(),
    maxStartTime: new Date(now + 365 * DAY_MS).toISOString()
  };
}

function buildScheduledEventsParams(
  scope: { userUri?: string | null; organizationUri?: string | null },
  input: {
    minStartTime?: string;
    maxStartTime?: string;
    status?: string;
    inviteeEmail?: string;
    eventTypeUri?: string;
    count?: number;
    preferOrganization?: boolean;
  }
) {
  const params = new URLSearchParams({
    count: String(input.count && input.count > 0 ? Math.min(input.count, 100) : 100),
    sort: "start_time:desc"
  });
  const useOrg =
    Boolean(input.preferOrganization && scope.organizationUri) ||
    (!scope.userUri && Boolean(scope.organizationUri));
  if (useOrg && scope.organizationUri) {
    params.set("organization", scope.organizationUri);
  } else if (scope.userUri) {
    params.set("user", scope.userUri);
  } else if (scope.organizationUri) {
    params.set("organization", scope.organizationUri);
  }
  if (input.minStartTime) params.set("min_start_time", input.minStartTime);
  if (input.maxStartTime) params.set("max_start_time", input.maxStartTime);
  if (input.status) params.set("status", input.status);
  if (input.inviteeEmail) params.set("invitee_email", input.inviteeEmail);
  if (input.eventTypeUri) params.set("event_type", input.eventTypeUri);
  return params;
}

export async function calendlyListEvents(
  userId: string,
  input: {
    minStartTime?: string;
    maxStartTime?: string;
    status?: string;
    inviteeEmail?: string;
    eventTypeUri?: string;
    count?: number;
    /** When true, query organization first (admin/owner). Falls back to user if empty/forbidden. */
    preferOrganization?: boolean;
  } = {}
) {
  const connection = await getCalendlyConnectionStatus(userId);
  if (!connection.userUri && !connection.organizationUri) {
    throw new Error("Calendly user URI missing — reconnect Calendly");
  }
  const token = await getValidAccessToken(userId);
  const range =
    input.minStartTime || input.maxStartTime
      ? { minStartTime: input.minStartTime, maxStartTime: input.maxStartTime }
      : calendlyDefaultEventListRange();
  const listInput = {
    ...input,
    minStartTime: range.minStartTime,
    maxStartTime: range.maxStartTime
  };

  const fetchScoped = async (preferOrganization: boolean) => {
    const params = buildScheduledEventsParams(
      { userUri: connection.userUri, organizationUri: connection.organizationUri },
      { ...listInput, preferOrganization }
    );
    if (!params.has("user") && !params.has("organization")) {
      throw new Error("Calendly user URI missing — reconnect Calendly");
    }
    return calendlyApiRequest<{ collection: Array<Record<string, unknown>> }>(
      token,
      `/scheduled_events?${params.toString()}`
    );
  };

  // Default: user scope (personal events). If empty, try organization for team calendars.
  const startWithOrg =
    Boolean(input.preferOrganization && connection.organizationUri) ||
    (!connection.userUri && Boolean(connection.organizationUri));

  try {
    const primary = await fetchScoped(startWithOrg);
    if ((primary.collection?.length ?? 0) > 0) return primary;

    if (!startWithOrg && connection.userUri && connection.organizationUri) {
      try {
        const orgResult = await fetchScoped(true);
        if ((orgResult.collection?.length ?? 0) > 0) return orgResult;
      } catch {
        // Organization list needs admin/owner — keep the user-scoped result.
      }
    }
    return primary;
  } catch (error) {
    if (startWithOrg && connection.userUri) {
      return fetchScoped(false);
    }
    throw error;
  }
}

export async function calendlyGetEvent(userId: string, eventUuid: string) {
  const uuid = normalizeCalendlyResourceId(eventUuid);
  if (!uuid) throw new Error("Calendly event UUID is required");
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(
    token,
    `/scheduled_events/${encodeURIComponent(uuid)}`
  );
}

export async function calendlyListInvitees(userId: string, eventUuid: string) {
  const uuid = normalizeCalendlyResourceId(eventUuid);
  if (!uuid) throw new Error("Calendly event UUID is required");
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ collection: Array<Record<string, unknown>> }>(
    token,
    `/scheduled_events/${encodeURIComponent(uuid)}/invitees`
  );
}

export async function calendlyGetInvitee(userId: string, eventUuid: string, inviteeUuid: string) {
  const eventId = normalizeCalendlyResourceId(eventUuid);
  const inviteeId = normalizeCalendlyResourceId(inviteeUuid);
  if (!eventId || !inviteeId) throw new Error("Calendly event and invitee UUIDs are required");
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(
    token,
    `/scheduled_events/${encodeURIComponent(eventId)}/invitees/${encodeURIComponent(inviteeId)}`
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

function inviteeUriFromIds(eventUuid: string, inviteeUuid: string) {
  const eventId = normalizeCalendlyResourceId(eventUuid);
  const inviteeId = normalizeCalendlyResourceId(inviteeUuid);
  return `${CALENDLY_API_BASE}/scheduled_events/${encodeURIComponent(eventId)}/invitees/${encodeURIComponent(inviteeId)}`;
}

/** Book a meeting by creating an invitee (Scheduling API — paid plans). */
export async function calendlyBookMeetingForInvitee(
  userId: string,
  input: {
    eventTypeUri: string;
    startTime: string;
    inviteeName: string;
    inviteeEmail: string;
    timezone?: string;
  }
) {
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(token, "/invitees", {
    method: "POST",
    body: JSON.stringify({
      event_type: input.eventTypeUri,
      start_time: input.startTime,
      invitee: {
        name: input.inviteeName,
        email: input.inviteeEmail,
        timezone: input.timezone || "UTC"
      }
    })
  });
}

export async function calendlyCancelScheduledEvent(
  userId: string,
  eventUuid: string,
  reason?: string
) {
  const uuid = normalizeCalendlyResourceId(eventUuid);
  if (!uuid) throw new Error("Calendly event UUID is required");
  const token = await getValidAccessToken(userId);
  const body =
    reason && reason.trim()
      ? JSON.stringify({ reason: reason.trim() })
      : JSON.stringify({});
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(
    token,
    `/scheduled_events/${encodeURIComponent(uuid)}/cancellation`,
    { method: "POST", body }
  );
}

export async function calendlyCreateContact(
  userId: string,
  input: { email: string; firstName?: string; lastName?: string; name?: string }
) {
  const status = await getCalendlyConnectionStatus(userId);
  if (!status.organizationUri) {
    throw new Error("Calendly organization URI missing — reconnect Calendly");
  }
  const token = await getValidAccessToken(userId);
  const payload: Record<string, unknown> = {
    organization: status.organizationUri,
    email: input.email
  };
  if (input.firstName) payload.first_name = input.firstName;
  if (input.lastName) payload.last_name = input.lastName;
  if (input.name) payload.name = input.name;
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(token, "/contacts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function calendlyUpdateContact(
  userId: string,
  contactUuid: string,
  input: { email?: string; firstName?: string; lastName?: string; name?: string }
) {
  const token = await getValidAccessToken(userId);
  const payload: Record<string, unknown> = {};
  if (input.email) payload.email = input.email;
  if (input.firstName) payload.first_name = input.firstName;
  if (input.lastName) payload.last_name = input.lastName;
  if (input.name) payload.name = input.name;
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(
    token,
    `/contacts/${encodeURIComponent(contactUuid)}`,
    { method: "PATCH", body: JSON.stringify(payload) }
  );
}

export async function calendlyDeleteContact(userId: string, contactUuid: string) {
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<Record<string, unknown>>(
    token,
    `/contacts/${encodeURIComponent(contactUuid)}`,
    { method: "DELETE" }
  );
}

export async function calendlyGetContact(userId: string, contactUuid: string) {
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(
    token,
    `/contacts/${encodeURIComponent(contactUuid)}`
  );
}

export async function calendlyListContacts(userId: string) {
  const status = await getCalendlyConnectionStatus(userId);
  if (!status.organizationUri) {
    throw new Error("Calendly organization URI missing — reconnect Calendly");
  }
  const token = await getValidAccessToken(userId);
  const params = new URLSearchParams({
    organization: status.organizationUri,
    count: "100"
  });
  try {
    return await calendlyApiRequest<{ collection: Array<Record<string, unknown>> }>(
      token,
      `/contacts?${params.toString()}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isCalendlyPlanRestrictionError(message)) {
      throw new Error(calendlyPaidFeatureUnavailableMessage("contacts"));
    }
    throw error;
  }
}

export async function calendlyCreateOneOffMeetingLink(
  userId: string,
  input: {
    name: string;
    durationMinutes: number;
    startDate: string;
    endDate: string;
    timezone?: string;
    locationKind?: string;
    location?: string;
  }
) {
  const status = await getCalendlyConnectionStatus(userId);
  const token = await getValidAccessToken(userId);

  // Prefer a live /users/me URI — stale metadata host values cause invalid-parameter errors.
  const me = await calendlyApiRequest<{ resource?: { uri?: string; timezone?: string } }>(
    token,
    "/users/me"
  );
  const hostUri =
    (typeof me.resource?.uri === "string" && me.resource.uri.trim()) || status.userUri || "";
  if (!hostUri) throw new Error("Calendly user URI missing — reconnect Calendly");

  const startDate = normalizeCalendlyDate(input.startDate);
  const endDate = normalizeCalendlyDate(input.endDate);
  if (!startDate || !endDate) {
    throw new Error("Calendly One-Off Meeting Link needs valid start and end dates (YYYY-MM-DD)");
  }
  if (endDate < startDate) {
    throw new Error("Calendly One-Off Meeting Link end date must be on or after the start date");
  }

  const duration = Math.round(Number(input.durationMinutes));
  if (!Number.isFinite(duration) || duration < 1) {
    throw new Error("Calendly One-Off Meeting Link needs a valid duration in minutes");
  }

  const locationKind = (input.locationKind || "ask_invitee").trim() || "ask_invitee";
  const location: Record<string, unknown> = { kind: locationKind };
  if (
    (locationKind === "physical" || locationKind === "custom" || locationKind === "outbound_call") &&
    input.location?.trim()
  ) {
    location.location = input.location.trim();
  }

  const body: Record<string, unknown> = {
    name: input.name.trim(),
    host: hostUri,
    duration,
    date_setting: {
      type: "date_range",
      start_date: startDate,
      end_date: endDate
    },
    location
  };

  const timezone =
    input.timezone?.trim() ||
    status.timezone?.trim() ||
    (typeof me.resource?.timezone === "string" ? me.resource.timezone.trim() : "") ||
    "";
  if (timezone) body.timezone = timezone;

  return calendlyApiRequest<{ resource: Record<string, unknown> }>(token, "/one_off_event_types", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function normalizeCalendlyDate(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return "";
  const year = match[1] ?? "";
  const month = String(Number(match[2])).padStart(2, "0");
  const day = String(Number(match[3])).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function calendlyMarkInviteeNoShow(
  userId: string,
  eventUuid: string,
  inviteeUuid: string
) {
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(token, "/invitee_no_shows", {
    method: "POST",
    body: JSON.stringify({
      invitee: inviteeUriFromIds(eventUuid, inviteeUuid)
    })
  });
}

export async function calendlyFindInviteeByEmail(
  userId: string,
  input: { email: string; eventTypeUri?: string }
) {
  const { minStartTime, maxStartTime } = calendlyDefaultEventListRange();
  return calendlyListEvents(userId, {
    inviteeEmail: input.email,
    eventTypeUri: input.eventTypeUri,
    minStartTime,
    maxStartTime,
    count: 100
  });
}

export async function calendlyGetMeetingRecap(userId: string, recapUuid: string) {
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ resource: Record<string, unknown> }>(
    token,
    `/meeting_recaps/${encodeURIComponent(recapUuid)}`
  );
}

export async function calendlyGetMeetingRecapTranscript(userId: string, recapUuid: string) {
  const token = await getValidAccessToken(userId);
  return calendlyApiRequest<{ resource: Record<string, unknown> } | { transcript?: unknown }>(
    token,
    `/meeting_recaps/${encodeURIComponent(recapUuid)}/transcript`
  );
}

export async function calendlyFindUser(
  userId: string,
  input: { email?: string; name?: string; userUuid?: string }
) {
  const token = await getValidAccessToken(userId);
  if (input.userUuid) {
    return calendlyApiRequest<{ resource: Record<string, unknown> }>(
      token,
      `/users/${encodeURIComponent(input.userUuid)}`
    );
  }

  const status = await getCalendlyConnectionStatus(userId);
  if (!status.organizationUri) {
    throw new Error("Calendly organization URI missing — reconnect Calendly");
  }

  const params = new URLSearchParams({
    organization: status.organizationUri,
    count: "100"
  });
  if (input.email) params.set("email", input.email);

  const memberships = await calendlyApiRequest<{
    collection: Array<Record<string, unknown>>;
  }>(token, `/organization_memberships?${params.toString()}`);

  const needle = (input.name || "").trim().toLowerCase();
  if (!needle) return memberships;

  const filtered = (memberships.collection ?? []).filter((item) => {
    const user = (item.user && typeof item.user === "object" ? item.user : {}) as Record<
      string,
      unknown
    >;
    const name = typeof user.name === "string" ? user.name.toLowerCase() : "";
    const email = typeof user.email === "string" ? user.email.toLowerCase() : "";
    return name.includes(needle) || email.includes(needle);
  });
  return { collection: filtered };
}

/** Dropdown option for Test console / node inspector Calendly pickers. */
export type CalendlyPickerOption = {
  /** Event type URI, or scheduled-event / invitee UUID. */
  value: string;
  label: string;
  uri: string;
  /** Public scheduling URL when listing event types. */
  schedulingUrl?: string;
};

export function calendlyUuidFromUri(uri: unknown): string {
  if (typeof uri !== "string" || !uri.trim()) return "";
  const parts = uri.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Accept a bare UUID or a full Calendly resource URI. */
export function normalizeCalendlyResourceId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("/")) return calendlyUuidFromUri(trimmed);
  return trimmed;
}

/** Dry-run / setup-sample placeholders must never hit the live Calendly API. */
export function isCalendlySampleResourceId(value: unknown): boolean {
  const id = normalizeCalendlyResourceId(value).toUpperCase();
  if (!id) return false;
  return (
    id === "SAMPLE" ||
    id === "SAMPLE_EVENT_UUID" ||
    id === "SAMPLE_INVITEE_UUID" ||
    id.startsWith("SAMPLE_")
  );
}

function formatCalendlyInstant(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** Event types for Find Available Times / Create Scheduling Link. Value = full URI. */
export async function listCalendlyEventTypeOptions(userId: string): Promise<CalendlyPickerOption[]> {
  const data = await calendlyListEventTypes(userId);
  return (data.collection ?? [])
    .map((item) => {
      const uri = typeof item.uri === "string" ? item.uri : "";
      const name = typeof item.name === "string" && item.name.trim() ? item.name : "Event type";
      const duration =
        typeof item.duration === "number" && Number.isFinite(item.duration)
          ? `${item.duration} min`
          : null;
      const inactive = item.active === false ? "inactive" : null;
      const label = [name, duration, inactive].filter(Boolean).join(" · ");
      const schedulingUrl =
        typeof item.scheduling_url === "string" && item.scheduling_url.trim()
          ? item.scheduling_url.trim()
          : undefined;
      return { value: uri, label, uri, ...(schedulingUrl ? { schedulingUrl } : {}) };
    })
    .filter((option) => Boolean(option.uri));
}

/** Available start times for booking. Value = ISO start_time. */
export async function listCalendlyAvailableTimeOptions(
  userId: string,
  eventTypeUri: string,
  range?: { startTime?: string; endTime?: string }
): Promise<CalendlyPickerOption[]> {
  const now = Date.now();
  const startTime = range?.startTime || new Date(now).toISOString();
  const endTime = range?.endTime || new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  const data = await calendlyGetAvailability(userId, {
    eventTypeUri,
    startTime,
    endTime
  });
  const collection = Array.isArray(data.collection)
    ? data.collection
    : Array.isArray((data.resource as { available_times?: unknown } | undefined)?.available_times)
      ? ((data.resource as { available_times: Array<Record<string, unknown>> }).available_times)
      : [];

  return collection
    .map((item) => {
      const start =
        typeof item.start_time === "string"
          ? item.start_time
          : typeof item.start === "string"
            ? item.start
            : "";
      if (!start) return null;
      const status = typeof item.status === "string" ? item.status : null;
      if (status && status.toLowerCase() !== "available") return null;
      return {
        value: start,
        label: formatCalendlyInstant(start),
        uri: start
      } satisfies CalendlyPickerOption;
    })
    .filter((option): option is CalendlyPickerOption => Boolean(option));
}

/** Scheduled events for Get Event / List Invitees / Get Invitee. Value = event UUID. */
export async function listCalendlyEventOptions(
  userId: string,
  options?: { startedOnly?: boolean }
): Promise<CalendlyPickerOption[]> {
  const { minStartTime, maxStartTime } = calendlyDefaultEventListRange();
  const connection = await getCalendlyConnectionStatus(userId);
  // Picker must only show events the connected user can GET — org-wide lists
  // include teammates' meetings and yield "You are not allowed to view this event".
  const token = await getValidAccessToken(userId);
  if (!connection.userUri) {
    throw new Error("Calendly user URI missing — reconnect Calendly");
  }
  const params = buildScheduledEventsParams(
    { userUri: connection.userUri, organizationUri: null },
    { minStartTime, maxStartTime, count: 100 }
  );
  const data = await calendlyApiRequest<{ collection: Array<Record<string, unknown>> }>(
    token,
    `/scheduled_events?${params.toString()}`
  );
  const now = Date.now();
  return (data.collection ?? [])
    .filter((item) => {
      if (!options?.startedOnly) return true;
      const start =
        typeof item.start_time === "string" ? Date.parse(item.start_time) : Number.NaN;
      return Number.isFinite(start) && start <= now;
    })
    .map((item) => {
      const uri = typeof item.uri === "string" ? item.uri : "";
      const uuid = calendlyUuidFromUri(uri);
      const name = typeof item.name === "string" && item.name.trim() ? item.name : "Meeting";
      const when = formatCalendlyInstant(item.start_time);
      const status = typeof item.status === "string" ? item.status : null;
      const label = [name, when, status].filter(Boolean).join(" · ");
      return { value: uuid, label, uri };
    })
    .filter((option) => Boolean(option.value));
}

/** Contacts (paid Contacts API). Value = contact UUID. */
export async function listCalendlyContactOptions(userId: string): Promise<CalendlyPickerOption[]> {
  const data = await calendlyListContacts(userId);
  return (data.collection ?? [])
    .map((item) => {
      const uri = typeof item.uri === "string" ? item.uri : "";
      const uuid = calendlyUuidFromUri(uri);
      const name =
        (typeof item.name === "string" && item.name.trim() && item.name) ||
        [item.first_name, item.last_name]
          .filter((part) => typeof part === "string" && part.trim())
          .join(" ")
          .trim() ||
        "Contact";
      const email = typeof item.email === "string" ? item.email : null;
      const label = [name, email].filter(Boolean).join(" · ");
      return { value: uuid, label, uri };
    })
    .filter((option) => Boolean(option.value));
}

/** Meeting recaps (paid Notetaker API). Value = recap UUID. */
export async function listCalendlyMeetingRecapOptions(
  userId: string
): Promise<CalendlyPickerOption[]> {
  const status = await getCalendlyConnectionStatus(userId);
  if (!status.userUri) {
    throw new Error("Calendly user URI missing — reconnect Calendly");
  }
  const token = await getValidAccessToken(userId);
  const params = new URLSearchParams({
    user: status.userUri,
    count: "50"
  });
  try {
    const data = await calendlyApiRequest<{ collection: Array<Record<string, unknown>> }>(
      token,
      `/meeting_recaps?${params.toString()}`
    );
    return (data.collection ?? [])
      .map((item) => {
        const uri = typeof item.uri === "string" ? item.uri : "";
        const uuid = calendlyUuidFromUri(uri) || (typeof item.uuid === "string" ? item.uuid : "");
        const title =
          (typeof item.title === "string" && item.title.trim() && item.title) ||
          (typeof item.name === "string" && item.name.trim() && item.name) ||
          "Meeting recap";
        const when = formatCalendlyInstant(item.created_at || item.start_time);
        const label = [title, when].filter(Boolean).join(" · ");
        return { value: uuid, label, uri: uri || uuid };
      })
      .filter((option) => Boolean(option.value));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isCalendlyPlanRestrictionError(message)) {
      throw new Error(calendlyPaidFeatureUnavailableMessage("meeting_recaps"));
    }
    throw error;
  }
}

/** Invitees for a scheduled event. Value = invitee UUID. */
export async function listCalendlyInviteeOptions(
  userId: string,
  eventUuid: string
): Promise<CalendlyPickerOption[]> {
  const data = await calendlyListInvitees(userId, eventUuid);
  return (data.collection ?? [])
    .map((item) => {
      const uri = typeof item.uri === "string" ? item.uri : "";
      const uuid = calendlyUuidFromUri(uri);
      const name = typeof item.name === "string" && item.name.trim() ? item.name : "Invitee";
      const email = typeof item.email === "string" ? item.email : null;
      const status = typeof item.status === "string" ? item.status : null;
      const label = [name, email, status].filter(Boolean).join(" · ");
      return { value: uuid, label, uri };
    })
    .filter((option) => Boolean(option.value));
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
        webhookSigningKeyEnc: signingKey ? encryptSecret(signingKey) : meta.webhookSigningKeyEnc ?? null,
        webhookSubscriptionError: null
      }
    }
  });

  return subscriptionUri;
}

const orgCredentialCache = new Map<string, { userId: string; credentialId: string; expiresAt: number }>();
const ORG_CREDENTIAL_CACHE_TTL_MS = 60_000;

export async function findCalendlyCredentialByOrganizationUri(organizationUri: string) {
  const org = organizationUri.trim();
  if (!org) return null;

  const cached = orgCredentialCache.get(org);
  if (cached && cached.expiresAt > Date.now()) {
    const row = await prisma.connectorCredential.findUnique({ where: { id: cached.credentialId } });
    if (row && row.provider === "CALENDLY") return row;
    orgCredentialCache.delete(org);
  }

  // Prefer JSON path filter (Postgres) so we don't scan every Calendly row.
  try {
    const matched = await prisma.connectorCredential.findFirst({
      where: {
        provider: "CALENDLY",
        metadata: { path: ["organizationUri"], equals: org }
      }
    });
    if (matched) {
      orgCredentialCache.set(org, {
        userId: matched.userId,
        credentialId: matched.id,
        expiresAt: Date.now() + ORG_CREDENTIAL_CACHE_TTL_MS
      });
      return matched;
    }
  } catch (error) {
    console.warn("[calendly] organizationUri JSON path lookup failed; falling back to scan", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const credentials = await prisma.connectorCredential.findMany({
    where: { provider: "CALENDLY" }
  });
  const found =
    credentials.find((row) => asMetadata(row.metadata).organizationUri === org) ?? null;
  if (found) {
    orgCredentialCache.set(org, {
      userId: found.userId,
      credentialId: found.id,
      expiresAt: Date.now() + ORG_CREDENTIAL_CACHE_TTL_MS
    });
  }
  return found;
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

/** True when Calendly rejected the call because the account plan lacks the feature. */
export function isCalendlyPlanRestrictionError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("upgrade") ||
    text.includes("paid plan") ||
    text.includes("payment required") ||
    text.includes("not available on your") ||
    text.includes("requires a") ||
    text.includes("does not have access") ||
    text.includes("insufficient permission") ||
    // Free / lower plans often reject Contacts/Notetaker query params instead of saying "upgrade".
    text.includes("is not a supported query parameter") ||
    text.includes("unsupported query parameter") ||
    text.includes("not a valid parameter") ||
    /\b402\b/.test(text) ||
    (/\b403\b/.test(text) &&
      (text.includes("plan") || text.includes("permission") || text.includes("contact") || text.includes("forbidden")))
  );
}

/** Friendly copy when a Calendly paid-only feature is blocked by plan. */
export function calendlyPaidFeatureUnavailableMessage(feature: "contacts" | "meeting_recaps" | "generic"): string {
  if (feature === "contacts") {
    return "Contacts need a paid Calendly plan.";
  }
  if (feature === "meeting_recaps") {
    return "Meeting recaps need a paid Calendly plan with Notetaker. Upgrade your Calendly account, or switch this step to a free action.";
  }
  return "This Calendly action needs a paid plan. Upgrade your Calendly account";
}
