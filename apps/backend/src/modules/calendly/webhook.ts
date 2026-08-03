import type { Context } from "hono";
import {
  CALENDLY_LEGACY_TRIGGER_TYPES,
  CALENDLY_NODE_TYPES,
  type CalendlyTriggerEvent
} from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest } from "../architect/workflow-runner";
import {
  findCalendlyCredentialByOrganizationUri,
  getCalendlyOAuthRedirectPath,
  getCalendlySigningKeyFromCredential,
  handleCalendlyOAuthCallback,
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
    await handleCalendlyOAuthCallback({
      code,
      state,
      redirectUriOverride: misconfiguredRedirectUri
    });
    console.warn(
      "[calendly] OAuth completed via misconfigured webhook redirect — fix CALENDLY_OAUTH_REDIRECT_URI",
      { misconfiguredRedirectUri }
    );
    return c.redirect(`${env.FRONTEND_URL}${target}${separator}calendly=connected`);
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

  const credential = await findCalendlyCredentialByOrganizationUri(lookupOrg);
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
  } else {
    console.warn("[calendly] webhook missing signing key — accepting without signature verify", {
      userId: credential.userId
    });
  }

  const calendlyEvent = eventToCalendlyEvent(event, isReschedulePayload(payload));
  if (!calendlyEvent) {
    return c.json({ ok: true, ignored: true, reason: "unsupported_event" });
  }

  const workflows = await prisma.workflowDefinition.findMany({
    where: { architectUserId: credential.userId },
    select: { id: true, name: true, workflowJson: true }
  });

  const matching = workflows.filter((workflow) =>
    workflowMatchesCalendlyEvent(workflow.workflowJson, calendlyEvent)
  );

  const invitee = asRecord(body) ?? {};
  const results: Array<{ workflowId: string; ok: boolean; error?: string }> = [];

  for (const workflow of matching) {
    try {
      await runWorkflowTest({
        userId: credential.userId,
        workflowId: workflow.id,
        workflowJson: workflow.workflowJson,
        input: {
          triggerType: CALENDLY_NODE_TYPES.trigger,
          calendly: {
            event,
            calendlyEvent,
            invitee,
            scheduledEvent,
            raw: payload
          },
          message:
            calendlyEvent === "meeting_cancelled"
              ? "Calendly meeting cancelled"
              : calendlyEvent === "routing_form_submitted"
                ? "Calendly routing form submitted"
                : calendlyEvent === "meeting_rescheduled"
                  ? "Calendly meeting rescheduled"
                  : "Calendly meeting booked"
        }
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

  return c.json({ ok: true, event, calendlyEvent, matched: matching.length, results });
}
