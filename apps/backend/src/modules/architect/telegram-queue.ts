import { Queue } from "bullmq";
import { env } from "../../config/env";
import { getEmailQueueConnection } from "../email/email-queue";
import { processTelegramStoredUpdate } from "./telegram-booking-runtime";

export const TELEGRAM_UPDATE_QUEUE_NAME = "telegram-updates";
export type TelegramUpdateJobData = { processedUpdateId: string };

let queue: Queue<TelegramUpdateJobData> | null = null;

function getQueue(): Queue<TelegramUpdateJobData> {
  if (!queue) {
    queue = new Queue<TelegramUpdateJobData>(TELEGRAM_UPDATE_QUEUE_NAME, {
      connection: getEmailQueueConnection()
    });
  }
  return queue;
}

function runInlineAfterResponse(processedUpdateId: string): void {
  setImmediate(() => {
    void processTelegramStoredUpdate(processedUpdateId).catch((error) => {
      console.error("[telegram-worker] inline update failed", {
        processedUpdateId,
        error: error instanceof Error ? error.message : "unknown error"
      });
    });
  });
}

export async function enqueueTelegramUpdate(processedUpdateId: string): Promise<{
  queued: boolean;
  inline: boolean;
}> {
  if (!env.REDIS_URL) {
    runInlineAfterResponse(processedUpdateId);
    return { queued: false, inline: true };
  }
  try {
    const addJob = getQueue()
      .add(
        "process-update",
        { processedUpdateId },
        {
          jobId: processedUpdateId,
          attempts: 5,
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: { age: 24 * 3600, count: 5_000 },
          removeOnFail: { age: 7 * 24 * 3600 }
        }
      )
      .then(() => ({ outcome: "queued" as const }))
      .catch((error: unknown) => ({ outcome: "failed" as const, error }));
    const result = await Promise.race([
      addJob,
      new Promise<{ outcome: "timeout" }>((resolve) => {
        const timer = setTimeout(() => resolve({ outcome: "timeout" }), 350);
        timer.unref();
      })
    ]);
    if (result.outcome === "timeout") {
      runInlineAfterResponse(processedUpdateId);
      return { queued: false, inline: true };
    }
    if (result.outcome === "failed") throw result.error;
    return { queued: true, inline: false };
  } catch (error) {
    console.error("[telegram-queue] enqueue failed; using inline fallback", {
      processedUpdateId,
      error: error instanceof Error ? error.message : "unknown error"
    });
    runInlineAfterResponse(processedUpdateId);
    return { queued: false, inline: true };
  }
}

export async function telegramQueueCounts(): Promise<Record<string, number> | null> {
  if (!env.REDIS_URL) return null;
  try {
    return (await getQueue().getJobCounts("waiting", "active", "delayed", "failed")) as Record<string, number>;
  } catch {
    return null;
  }
}

export async function closeTelegramQueue(): Promise<void> {
  await queue?.close().catch(() => undefined);
  queue = null;
}
