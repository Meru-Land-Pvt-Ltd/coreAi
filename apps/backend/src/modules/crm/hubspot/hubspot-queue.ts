import { Queue } from "bullmq";
import { env } from "../../../config/env";
import { getEmailQueueConnection } from "../../email/email-queue";
import { processHubSpotWebhookEvent } from "./sync.service";

/**
 * HubSpot webhook processing queue.
 *
 * Same contract as the Telegram update queue already in this repo: enqueue when
 * Redis is available, fall back to inline processing after the response
 * otherwise. HubSpot retries webhooks it does not get a fast 2xx for, so the
 * handler must return immediately and never process in-request.
 */

export const HUBSPOT_WEBHOOK_QUEUE_NAME = "hubspot-webhooks";
export type HubSpotWebhookJobData = { eventRowId: string };

let queue: Queue<HubSpotWebhookJobData> | null = null;

function getQueue(): Queue<HubSpotWebhookJobData> {
  if (!queue) {
    queue = new Queue<HubSpotWebhookJobData>(HUBSPOT_WEBHOOK_QUEUE_NAME, {
      connection: getEmailQueueConnection()
    });
  }
  return queue;
}

function runInlineAfterResponse(eventRowId: string): void {
  setImmediate(() => {
    void processHubSpotWebhookEvent(eventRowId).catch((error) => {
      console.error("[hubspot-worker] inline event failed", {
        eventRowId,
        error: error instanceof Error ? error.message : "unknown error"
      });
    });
  });
}

export async function enqueueHubSpotWebhookEvent(eventRowId: string): Promise<{
  queued: boolean;
  inline: boolean;
}> {
  if (!env.REDIS_URL) {
    runInlineAfterResponse(eventRowId);
    return { queued: false, inline: true };
  }

  try {
    const addJob = getQueue()
      .add(
        "process-event",
        { eventRowId },
        {
          jobId: eventRowId,
          attempts: 5,
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: { age: 24 * 3600, count: 5_000 },
          removeOnFail: { age: 7 * 24 * 3600 }
        }
      )
      .then(() => ({ outcome: "queued" as const }))
      .catch((error: unknown) => ({ outcome: "failed" as const, error }));

    // A slow Redis must not hold the webhook response open — HubSpot retries.
    const result = await Promise.race([
      addJob,
      new Promise<{ outcome: "timeout" }>((resolve) => {
        const timer = setTimeout(() => resolve({ outcome: "timeout" }), 350);
        timer.unref();
      })
    ]);

    if (result.outcome === "queued") return { queued: true, inline: false };

    if (result.outcome === "failed") {
      console.error("[hubspot] enqueue failed — processing inline", {
        eventRowId,
        error:
          "error" in result && result.error instanceof Error ? result.error.message : "unknown error"
      });
    }

    runInlineAfterResponse(eventRowId);
    return { queued: false, inline: true };
  } catch (error) {
    console.error("[hubspot] queue unavailable — processing inline", {
      eventRowId,
      error: error instanceof Error ? error.message : "unknown error"
    });
    runInlineAfterResponse(eventRowId);
    return { queued: false, inline: true };
  }
}
