import { Hono, type Context } from "hono";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import {
  handleSesBounceComplaintNotification,
  handleSesDeliveryEventNotification,
  handleSesInboundNotification
} from "./ses-mail-service";
import { asSnsEnvelope, isTrustedAwsSnsUrl, verifySnsMessage } from "./sns-verify";

export const emailRoutes = new Hono();

async function readSnsPayload(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    // SNS posts JSON with Content-Type text/plain — parse the raw body.
    try {
      return JSON.parse(await c.req.text());
    } catch {
      return null;
    }
  }
}

/**
 * Strict topic allowlist. In production the expected ARN must be configured
 * and match; anything else is rejected (no fail-open).
 */
function topicAllowed(payload: unknown, expectedArns: Array<string | undefined>): boolean {
  const allowed = expectedArns.filter((arn): arn is string => Boolean(arn));
  const claimed =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>).TopicArn
      : undefined;

  if (allowed.length === 0) {
    // No ARNs configured: never acceptable in production.
    return env.NODE_ENV !== "production";
  }
  return typeof claimed === "string" && allowed.includes(claimed);
}

/** Confirm SNS topic subscriptions — only ever fetches AWS SNS URLs. */
async function maybeConfirmSubscription(payload: unknown): Promise<boolean> {
  const message = asSnsEnvelope(payload);
  if (!message || message.Type !== "SubscriptionConfirmation") return false;

  if (!isTrustedAwsSnsUrl(message.SubscribeURL)) {
    console.warn("[email] SNS SubscriptionConfirmation with untrusted SubscribeURL — ignored");
    return true; // handled (rejected), don't process further
  }

  try {
    await fetch(message.SubscribeURL as string, { signal: AbortSignal.timeout(10_000) });
    console.log("[email] SNS subscription confirmed");
  } catch (error) {
    console.error(`[email] SNS subscription confirmation failed: ${(error as Error).message}`);
  }
  return true;
}

type SnsHandler = (payload: unknown) => Promise<unknown>;

function snsRoute(expectedArns: () => Array<string | undefined>, handler: SnsHandler) {
  return async (c: Context) => {
    const payload = await readSnsPayload(c);
    if (!payload) return errorResponse(c, "Invalid payload", 400, "INVALID_PAYLOAD");

    const verdict = await verifySnsMessage(payload);
    if (!verdict.ok) {
      console.warn(`[email] rejected SNS message: ${verdict.reason}`);
      return errorResponse(c, "SNS verification failed", 403, "SNS_VERIFICATION_FAILED");
    }

    if (!topicAllowed(payload, expectedArns())) {
      return errorResponse(c, "Unknown topic", 403, "TOPIC_MISMATCH");
    }
    if (await maybeConfirmSubscription(payload)) return successResponse(c, { confirmed: true });

    const result = await handler(payload);
    return successResponse(c, { result });
  };
}

emailRoutes.post(
  "/ses/inbound",
  snsRoute(() => [env.SES_INBOUND_TOPIC_ARN], (payload) => handleSesInboundNotification(payload))
);

// Configuration-set event destination (Send/Delivery/Bounce/Complaint/Reject/RenderingFailure).
emailRoutes.post(
  "/ses/events",
  snsRoute(() => [env.SES_EVENTS_TOPIC_ARN], (payload) => handleSesDeliveryEventNotification(payload))
);

// Legacy identity-level bounce/complaint topic; kept for existing subscriptions.
emailRoutes.post(
  "/ses/bounce-complaint",
  snsRoute(
    () => [env.SES_EVENTS_TOPIC_ARN, env.SES_INBOUND_TOPIC_ARN],
    (payload) => handleSesBounceComplaintNotification(payload)
  )
);
