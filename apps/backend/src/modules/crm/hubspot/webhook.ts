import crypto from "crypto";
import type { Context } from "hono";
import { env, isProduction } from "../../../config/env";
import { enqueueHubSpotWebhookEvent } from "./hubspot-queue";
import { recordHubSpotWebhookEvent } from "./sync.service";
import { hubspotWebhookUrl } from "./token.service";

/** HubSpot rejects its own replays after 5 minutes; match that window. */
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

export function resolveWebhookSecret(
  source: { webhookSecret?: string; clientSecret?: string } = {
    webhookSecret: env.HUBSPOT_CLIENT_SECRET_WEBHOOK,
    clientSecret: env.HUBSPOT_CLIENT_SECRET
  }
): string | undefined {
  const explicit = source.webhookSecret?.trim();
  if (explicit) return explicit;

  const fallback = source.clientSecret?.trim();
  return fallback || undefined;
}

/**
 * HubSpot v3 signature: HMAC-SHA256 over method + URI + body + timestamp.
 * Exported for unit tests.
 */
export function computeHubSpotV3Signature(params: {
  secret: string;
  method: string;
  uri: string;
  body: string;
  timestamp: string;
}): string {
  const source = `${params.method}${params.uri}${params.body}${params.timestamp}`;
  return crypto.createHmac("sha256", params.secret).update(source, "utf8").digest("base64");
}

export function verifyHubSpotSignature(params: {
  secret: string;
  method: string;
  uri: string;
  body: string;
  timestamp: string;
  signature: string;
  now?: number;
}): { valid: boolean; reason?: string } {
  const timestampMs = Number(params.timestamp);
  if (!Number.isFinite(timestampMs)) return { valid: false, reason: "Invalid timestamp" };

  const now = params.now ?? Date.now();
  if (Math.abs(now - timestampMs) > MAX_SIGNATURE_AGE_MS) {
    return { valid: false, reason: "Timestamp outside the accepted window" };
  }

  const expected = computeHubSpotV3Signature(params);
  const given = Buffer.from(params.signature);
  const want = Buffer.from(expected);

  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return { valid: false, reason: "Signature mismatch" };
  }

  return { valid: true };
}

function firstPortalId(payload: unknown): string | null {
  const entries = Array.isArray(payload) ? payload : [payload];
  for (const entry of entries) {
    if (entry && typeof entry === "object" && "portalId" in entry) {
      const value = (entry as { portalId?: unknown }).portalId;
      if (value != null) return String(value);
    }
  }
  return null;
}

export async function handleHubSpotWebhookPost(c: Context) {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hubspot-signature-v3") ?? "";
  const timestamp = c.req.header("x-hubspot-request-timestamp") ?? "";
  const secret = resolveWebhookSecret();

  if (secret && signature && timestamp) {
    const verdict = verifyHubSpotSignature({
      secret,
      method: "POST",
      uri: hubspotWebhookUrl(),
      body: rawBody,
      timestamp,
      signature
    });

    if (!verdict.valid) {
      console.error("[hubspot] webhook signature rejected", { reason: verdict.reason });
      return c.json({ success: false, error: "Invalid signature", code: "INVALID_SIGNATURE" }, 401);
    }
  } else if (isProduction) {
    // Fail closed: an unsigned webhook in production is not trustworthy.
    console.error("[hubspot] unsigned webhook rejected in production", {
      hasSecret: Boolean(secret),
      hasSignature: Boolean(signature)
    });
    return c.json({ success: false, error: "Signature required", code: "SIGNATURE_REQUIRED" }, 401);
  } else {
    console.warn("[hubspot] processing unsigned webhook (non-production)");
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : [];
  } catch {
    return c.json({ success: false, error: "Invalid JSON", code: "INVALID_PAYLOAD" }, 400);
  }

  const entries = Array.isArray(payload) ? payload : [payload];
  const eventType =
    entries.length && entries[0] && typeof entries[0] === "object"
      ? String((entries[0] as { subscriptionType?: unknown }).subscriptionType ?? "unknown")
      : "unknown";

  try {
    const row = await recordHubSpotWebhookEvent({
      eventType,
      payload,
      portalId: firstPortalId(payload)
    });
    await enqueueHubSpotWebhookEvent(row.id);
  } catch (error) {
    // Still 200: a storage failure here would put HubSpot into a retry storm,
    // and the next change event re-syncs the same contact anyway.
    console.error("[hubspot] webhook intake failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return c.json({ success: true });
}
