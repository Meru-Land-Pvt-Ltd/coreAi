import type { Context } from "hono";
import {
  CALENDLY_LEGACY_TRIGGER_TYPES,
  CALENDLY_NODE_TYPES,
  type CalendlyTriggerEvent
} from "@coreai/shared";
import crypto from "crypto";
import { env, isProduction } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { getSharedRedis } from "../../lib/redis";
import { runWorkflowTest } from "../architect/workflow-runner";
import {
  findCalendlyCredentialByOrganizationUri,
  getCalendlyOAuthRedirectPath,
  getCalendlySigningKeyFromCredential,
  handleCalendlyOAuthCallback,
  normalizeCalendlyResourceId,
  verifyCalendlyWebhookSignature
} from "./calendly-connector";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function eventToCalendlyEvent(event: string, isReschedule: boolean): CalendlyTriggerEvent | null {
  if (event === "invitee.canceled") return "meeting_cancelled";
  if (event === "routing_form_submission.created") return "routing_form_submitted";
  if (event === "invitee.created") {
    return isReschedule ? "meeting_rescheduled" : "meeting_booked";
  }
  return null;
}

/** Exported for unit tests. */
export function mapCalendlyWebhookEventToTrigger(
  event: string,
  isReschedule: boolean
): CalendlyTriggerEvent | null {
  return eventToCalendlyEvent(event, isReschedule);
}

function nodeCalendlyEvent(node: unknown): CalendlyTriggerEvent | null {
  const data = asRecord(asRecord(node)?.data);
  const type = String(data?.type ?? asRecord(node)?.type ?? "").toLowerCase();

  if (type === CALENDLY_NODE_TYPES.trigger) {
    const selected = String(data?.calendlyEvent ?? "meeting_booked").toLowerCase();
    if (
      selected === "meeting_booked" ||
      selected === "meeting_cancelled" ||
      selected === "meeting_rescheduled" ||
      selected === "routing_form_submitted"
    ) {
      return selected;
    }
    return "meeting_booked";
  }

  return CALENDLY_LEGACY_TRIGGER_TYPES[type] ?? null;
}

function workflowMatchesCalendlyEvent(workflowJson: unknown, calendlyEvent: CalendlyTriggerEvent): boolean {
  const nodes = (workflowJson as { nodes?: unknown } | null | undefined)?.nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.some((node) => nodeCalendlyEvent(node) === calendlyEvent);
}

function isReschedulePayload(payload: Record<string, unknown>): boolean {
  const body = asRecord(payload.payload);
  return Boolean(body?.old_invitee || body?.rescheduled);
}

const memoryIdempotency = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function calendlyWebhookIdempotencyKey(payload: Record<string, unknown>, rawBody: string): string {
  const body = asRecord(payload.payload) ?? {};
  const event = String(payload.event ?? "");
  const inviteeUri = typeof body.uri === "string" ? body.uri : "";
  const scheduledUri =
    typeof asRecord(body.scheduled_event)?.uri === "string"
      ? String(asRecord(body.scheduled_event)?.uri)
      : "";
  const createdAt = typeof body.created_at === "string" ? body.created_at : "";
  const material = [event, inviteeUri, scheduledUri, createdAt].filter(Boolean).join("|");
  if (material) return `calendly:webhook:${material}`;
  const hash = crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 32);
  return `calendly:webhook:body:${hash}`;
}

/** Returns true if this delivery was already processed (skip). */
export async function claimCalendlyWebhookDelivery(key: string): Promise<boolean> {
  // Prefer Redis in non-test environments; vitest should stay offline-friendly.
  const redis = env.NODE_ENV === "test" ? null : getSharedRedis();
  if (redis) {
    try {
      const result = await redis.set(key, "1", "PX", IDEMPOTENCY_TTL_MS, "NX");
      return result === null;
    } catch (error) {
      console.warn("[calendly] redis idempotency failed; using memory fallback", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const now = Date.now();
  for (const [k, expiresAt] of memoryIdempotency) {
    if (expiresAt <= now) memoryIdempotency.delete(k);
  }
  const existing = memoryIdempotency.get(key);
  if (existing && existing > now) return true;
  memoryIdempotency.set(key, now + IDEMPOTENCY_TTL_MS);
  return false;
}

/** Test helper — clear in-memory idempotency map. */
export function resetCalendlyWebhookIdempotencyForTests() {
  memoryIdempotency.clear();
}

function calendlyTriggerInput(args: {
  event: string;
  calendlyEvent: CalendlyTriggerEvent;
  invitee: Record<string, unknown>;
  scheduledEvent: Record<string, unknown>;
  payload: Record<string, unknown>;
  businessId?: string;
  installedAgentId?: string;
  businessOwnerId?: string;
  businessName?: string;
  businessType?: string;
  businessPhoneNumber?: string;
  calendarId?: string;
  timeZone?: string;
  services?: string[];
  calendlyEventTypeUri?: string;
}) {
  const eventUuid = normalizeCalendlyResourceId(args.scheduledEvent.uri);
  const inviteeUuid = normalizeCalendlyResourceId(args.invitee.uri);
  return {
    triggerType: CALENDLY_NODE_TYPES.trigger,
    ...(args.businessId ? { businessId: args.businessId } : {}),
    ...(args.installedAgentId ? { installedAgentId: args.installedAgentId } : {}),
    ...(args.businessOwnerId ? { businessOwnerId: args.businessOwnerId } : {}),
    ...(args.businessName ? { businessName: args.businessName } : {}),
    ...(args.businessType ? { businessType: args.businessType } : {}),
    ...(args.businessPhoneNumber ? { businessPhoneNumber: args.businessPhoneNumber } : {}),
    ...(args.calendarId ? { calendarId: args.calendarId } : {}),
    ...(args.timeZone ? { timeZone: args.timeZone } : {}),
    ...(args.services && args.services.length > 0 ? { services: args.services } : {}),
    ...(args.calendlyEventTypeUri ? { calendlyEventTypeUri: args.calendlyEventTypeUri } : {}),
    ...(eventUuid ? { calendlyEventUuid: eventUuid } : {}),
    ...(inviteeUuid ? { calendlyInviteeUuid: inviteeUuid } : {}),
    calendly: {
      event: args.event,
      calendlyEvent: args.calendlyEvent,
      invitee: args.invitee,
      scheduledEvent: args.scheduledEvent,
      raw: args.payload
    },
    message:
      args.calendlyEvent === "meeting_cancelled"
        ? "Calendly meeting cancelled"
        : args.calendlyEvent === "routing_form_submitted"
          ? "Calendly routing form submitted"
          : args.calendlyEvent === "meeting_rescheduled"
            ? "Calendly meeting rescheduled"
            : "Calendly meeting booked"
  };
}

/**
 * If Calendly OAuth was misconfigured to use the webhook URL as the redirect
 * URI, the browser lands here with ?code=&state=. Complete token exchange using
 * this URL as redirect_uri (must match authorize), then send the user back to the app.
 */
export async function handleCalendlyOAuthMisdirectGet(c: Context) {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const oauthError = c.req.query("error");

  if (!code && !state && !oauthError) {
    return c.json(
      {
        ok: false,
        error:
          "This endpoint accepts Calendly webhook POSTs only. Set the OAuth Redirect URI to /architect/connectors/calendly/callback"
      },
      405
    );
  }

  let target = "/architect/agents";
  if (state) {
    try {
      target = getCalendlyOAuthRedirectPath(state) ?? target;
    } catch {
      // Invalid state — keep agents fallback.
    }
  }
  const separator = target.includes("?") ? "&" : "?";

  if (!code || !state || oauthError) {
    const result = oauthError === "access_denied" ? "denied" : "failed";
    return c.redirect(`${env.FRONTEND_URL}${target}${separator}calendly=${result}`);
  }

  // Calendly requires token exchange redirect_uri to equal the authorize redirect_uri.
  const misconfiguredRedirectUri = c.req.url.split("?")[0] ?? "";
  try {
    const { webhookSubscribed } = await handleCalendlyOAuthCallback({
      code,
      state,
      redirectUriOverride: misconfiguredRedirectUri
    });
    console.warn(
      "[calendly] OAuth completed via misconfigured webhook redirect — fix CALENDLY_OAUTH_REDIRECT_URI",
      { misconfiguredRedirectUri }
    );
    const result = webhookSubscribed ? "connected" : "webhook_failed";
    return c.redirect(`${env.FRONTEND_URL}${target}${separator}calendly=${result}`);
  } catch (error) {
    console.error("[calendly] OAuth misdirect callback failed", error);
    return c.redirect(`${env.FRONTEND_URL}${target}${separator}calendly=failed`);
  }
}

export async function handleCalendlyWebhookPost(c: Context) {
  const rawBody = await c.req.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.error("[calendly] webhook invalid JSON");
    return c.json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const event = String(payload.event ?? "");
  const body = asRecord(payload.payload) ?? {};
  const scheduledEvent = asRecord(body.scheduled_event) ?? {};
  const eventMemberships = Array.isArray(scheduledEvent.event_memberships)
    ? scheduledEvent.event_memberships
    : [];
  const organizationUri =
    String(body.organization ?? scheduledEvent.organization ?? "").trim() ||
    String(asRecord(eventMemberships[0])?.user ?? "").trim();

  const inviteeOrg = String(body.organization ?? "").trim();
  const lookupOrg = inviteeOrg || organizationUri;

  console.info("[calendly] webhook received", { event, organizationUri: lookupOrg || null });

  if (!lookupOrg) {
    return c.json({ ok: true, ignored: true, reason: "missing_organization" });
  }

  /* The host of the event, when the payload names one. Two Triven accounts in
     one Calendly team share an organisation; they do not share a host. */
  const hostUserUri = String(asRecord(eventMemberships[0])?.user ?? "").trim() || null;
  const credential = await findCalendlyCredentialByOrganizationUri(lookupOrg, hostUserUri);
  if (!credential) {
    console.warn("[calendly] webhook: no connector for organization", { organizationUri: lookupOrg });
    return c.json({ ok: true, ignored: true, reason: "unknown_organization" });
  }

  const signingKey = getCalendlySigningKeyFromCredential(credential);
  const signatureHeader = c.req.header("Calendly-Webhook-Signature");
  if (signingKey) {
    const valid = verifyCalendlyWebhookSignature({
      rawBody,
      signatureHeader,
      signingKey
    });
    if (!valid) {
      console.error("[calendly] webhook signature invalid", { userId: credential.userId });
      return c.json({ ok: false, error: "Invalid signature" }, 401);
    }
  } else if (isProduction) {
    console.error("[calendly] webhook missing signing key — rejected in production", {
      userId: credential.userId
    });
    return c.json({ ok: false, error: "Webhook signing key missing — reconnect Calendly" }, 401);
  } else {
    console.warn("[calendly] webhook missing signing key — accepting without signature verify", {
      userId: credential.userId
    });
  }

  const idempotencyKey = calendlyWebhookIdempotencyKey(payload, rawBody);
  if (await claimCalendlyWebhookDelivery(idempotencyKey)) {
    console.info("[calendly] webhook duplicate delivery ignored", { event, organizationUri: lookupOrg });
    return c.json({ ok: true, ignored: true, reason: "duplicate_delivery" });
  }

  const calendlyEvent = eventToCalendlyEvent(event, isReschedulePayload(payload));
  if (!calendlyEvent) {
    return c.json({ ok: true, ignored: true, reason: "unsupported_event" });
  }

  const invitee = asRecord(body) ?? {};
  const results: Array<{
    workflowId: string;
    installedAgentId?: string;
    ok: boolean;
    error?: string;
  }> = [];

  // Architect dry-run / published workflow definitions owned by the connector user.
  const workflows = await prisma.workflowDefinition.findMany({
    where: { architectUserId: credential.userId },
    select: { id: true, name: true, workflowJson: true }
  });

  const matchingWorkflows = workflows.filter((workflow) =>
    workflowMatchesCalendlyEvent(workflow.workflowJson, calendlyEvent)
  );

  for (const workflow of matchingWorkflows) {
    try {
      await runWorkflowTest({
        userId: credential.userId,
        workflowId: workflow.id,
        workflowJson: workflow.workflowJson,
        input: calendlyTriggerInput({
          event,
          calendlyEvent,
          invitee,
          scheduledEvent,
          payload
        })
      });
      results.push({ workflowId: workflow.id, ok: true });
      console.info("[calendly] trigger executed", {
        workflowId: workflow.id,
        calendlyEvent,
        userId: credential.userId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ workflowId: workflow.id, ok: false, error: message });
      console.error("[calendly] trigger failed", {
        workflowId: workflow.id,
        calendlyEvent,
        error: message
      });
    }
  }

  // Buyer-installed agents: credential belongs to the business owner who connected Calendly.
  const installedAgents = await prisma.installedAgent.findMany({
    where: {
      status: "ACTIVE",
      business: { ownerId: credential.userId }
    },
    select: {
      id: true,
      businessId: true,
      workflowId: true,
      configJson: true,
      workflow: { select: { workflowJson: true } },
      business: {
        select: {
          id: true,
          name: true,
          type: true,
          ownerId: true,
          profile: {
            select: {
              calendarId: true,
              timeZone: true,
              services: true
            }
          },
          phoneNumbers: {
            take: 1,
            orderBy: { createdAt: "asc" },
            select: { phoneNumber: true }
          }
        }
      }
    }
  });

  const matchingInstalled = installedAgents.filter((agent) =>
    workflowMatchesCalendlyEvent(agent.workflow.workflowJson, calendlyEvent)
  );

  for (const agent of matchingInstalled) {
    const profile = agent.business.profile;
    const agentConfig =
      agent.configJson && typeof agent.configJson === "object" && !Array.isArray(agent.configJson)
        ? (agent.configJson as Record<string, unknown>)
        : {};
    const calendlyConfig =
      typeof agentConfig.calendly === "object" &&
      agentConfig.calendly !== null &&
      !Array.isArray(agentConfig.calendly)
        ? (agentConfig.calendly as Record<string, unknown>)
        : {};
    const calendlyEventTypeUri =
      typeof calendlyConfig.eventTypeUri === "string" ? calendlyConfig.eventTypeUri.trim() : "";
    try {
      await runWorkflowTest({
        userId: credential.userId,
        workflowId: agent.workflowId,
        workflowJson: agent.workflow.workflowJson,
        mode: "live",
        executionMode: "LIVE",
        input: calendlyTriggerInput({
          event,
          calendlyEvent,
          invitee,
          scheduledEvent,
          payload,
          businessId: agent.businessId,
          installedAgentId: agent.id,
          businessOwnerId: agent.business.ownerId,
          businessName: agent.business.name,
          businessType: agent.business.type,
          businessPhoneNumber: agent.business.phoneNumbers[0]?.phoneNumber,
          calendarId: profile?.calendarId || undefined,
          timeZone: profile?.timeZone || undefined,
          services: profile?.services ?? [],
          ...(calendlyEventTypeUri ? { calendlyEventTypeUri } : {})
        })
      });
      results.push({ workflowId: agent.workflowId, installedAgentId: agent.id, ok: true });
      console.info("[calendly] installed agent trigger executed", {
        workflowId: agent.workflowId,
        installedAgentId: agent.id,
        businessId: agent.businessId,
        calendlyEvent
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        workflowId: agent.workflowId,
        installedAgentId: agent.id,
        ok: false,
        error: message
      });
      console.error("[calendly] installed agent trigger failed", {
        workflowId: agent.workflowId,
        installedAgentId: agent.id,
        calendlyEvent,
        error: message
      });
    }
  }

  return c.json({
    ok: true,
    event,
    calendlyEvent,
    matched: matchingWorkflows.length + matchingInstalled.length,
    results
  });
}
