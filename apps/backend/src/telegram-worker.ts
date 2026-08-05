import { Worker } from "bullmq";
import { env } from "./config/env";
import { getEmailQueueConnection } from "./modules/email/email-queue";
import { initProviderEngine } from "./modules/ai-provider-engine/provider-engine";
import { processTelegramStoredUpdate } from "./modules/architect/telegram-booking-runtime";
import {
  closeTelegramQueue,
  TELEGRAM_UPDATE_QUEUE_NAME,
  telegramQueueCounts,
  type TelegramUpdateJobData
} from "./modules/architect/telegram-queue";

if (!env.REDIS_URL) {
  console.error("[telegram-worker] REDIS_URL is required to run the Telegram worker.");
  process.exit(1);
}

let worker: Worker<TelegramUpdateJobData> | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;

async function start() {
  // The worker executes complete workflows, including AI Brain nodes. It is a
  // separate process from the HTTP backend, so it must initialize its own
  // provider registry before accepting Telegram jobs.
  await initProviderEngine();

  worker = new Worker<TelegramUpdateJobData>(
    TELEGRAM_UPDATE_QUEUE_NAME,
    async (job) => {
      await processTelegramStoredUpdate(job.data.processedUpdateId);
    },
    {
      connection: getEmailQueueConnection(),
      concurrency: 5
    }
  );

  worker.on("ready", () => {
    console.log(`[telegram-worker] ready - queue "${TELEGRAM_UPDATE_QUEUE_NAME}", concurrency 5`);
  });

  worker.on("completed", (job) => {
    console.log(`[telegram-worker] completed update ${job.data.processedUpdateId}`);
  });

  worker.on("failed", (job, error) => {
    console.error("[telegram-worker] update failed", {
      processedUpdateId: job?.data.processedUpdateId,
      attempts: job?.attemptsMade,
      error: error.message
    });
  });

  healthTimer = setInterval(() => {
    void telegramQueueCounts().then((counts) => {
      if (counts) console.log(`[telegram-worker] health ${JSON.stringify(counts)}`);
    });
  }, 60_000);
  healthTimer.unref();
}

async function shutdown(signal: string) {
  console.log(`[telegram-worker] ${signal} received - draining...`);
  if (healthTimer) clearInterval(healthTimer);
  await worker?.close().catch(() => undefined);
  await closeTelegramQueue();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void start().catch((error) => {
  console.error("[telegram-worker] startup failed", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
