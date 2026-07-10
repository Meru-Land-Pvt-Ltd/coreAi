import { Hono } from "hono";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import {
  handleSesBounceComplaintNotification,
  handleSesInboundNotification
} from "./ses-mail-service";

export const emailRoutes = new Hono();

async function readSnsPayload(c: { req: { json: () => Promise<unknown>; text: () => Promise<string> } }): Promise<unknown> {
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

function topicAllowed(payload: unknown): boolean {
  if (!env.SES_INBOUND_TOPIC_ARN) return true;
  if (typeof payload !== "object" || payload === null) return true;
  const topicArn = (payload as Record<string, unknown>).TopicArn;
  return typeof topicArn !== "string" || topicArn === env.SES_INBOUND_TOPIC_ARN;
}

/** Auto-confirm SNS topic subscriptions so AWS can start delivering. */
async function maybeConfirmSubscription(payload: unknown): Promise<boolean> {
  if (typeof payload !== "object" || payload === null) return false;
  const record = payload as Record<string, unknown>;
  if (record.Type !== "SubscriptionConfirmation" || typeof record.SubscribeURL !== "string") return false;
  try {
    await fetch(record.SubscribeURL);
    console.log("[email] SNS subscription confirmed");
  } catch (error) {
    console.error(`[email] SNS subscription confirmation failed: ${(error as Error).message}`);
  }
  return true;
}

emailRoutes.post("/ses/inbound", async (c) => {
  const payload = await readSnsPayload(c);
  if (!payload) return errorResponse(c, "Invalid payload", 400, "INVALID_PAYLOAD");
  if (!topicAllowed(payload)) return errorResponse(c, "Unknown topic", 403, "TOPIC_MISMATCH");
  if (await maybeConfirmSubscription(payload)) return successResponse(c, { confirmed: true });

  const results = await handleSesInboundNotification(payload);
  return successResponse(c, { results });
});

emailRoutes.post("/ses/bounce-complaint", async (c) => {
  const payload = await readSnsPayload(c);
  if (!payload) return errorResponse(c, "Invalid payload", 400, "INVALID_PAYLOAD");
  if (!topicAllowed(payload)) return errorResponse(c, "Unknown topic", 403, "TOPIC_MISMATCH");
  if (await maybeConfirmSubscription(payload)) return successResponse(c, { confirmed: true });

  const result = await handleSesBounceComplaintNotification(payload);
  return successResponse(c, result);
});
