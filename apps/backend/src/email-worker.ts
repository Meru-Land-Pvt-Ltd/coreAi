import { Worker } from "bullmq";
import { env } from "./config/env";
import {
  EMAIL_QUEUE_NAME,
  dispatchEmailJob,
  emailQueueCounts,
  getEmailQueueConnection,
  closeEmailQueue,
  type EmailJobData
} from "./modules/email/email-queue";

/**
 * Standalone email delivery worker (docker compose service `email-worker`).
 * Consumes the email-notifications queue and sends through SES. Transient
 * failures rethrow and BullMQ retries with exponential backoff (5 attempts);
 * permanent failures complete without retry — the EmailMessage row and the
 * suppression list already hold the outcome.
 */

if (!env.REDIS_URL) {
  console.error("[email-worker] REDIS_URL is required to run the email worker.");
  process.exit(1);
}

const worker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  async (job) => {
    const result = await dispatchEmailJob(job.data);
    return result;
  },
  {
    connection: getEmailQueueConnection(),
    concurrency: 5
  }
);

worker.on("ready", () => {
  console.log(`[email-worker] ready — queue "${EMAIL_QUEUE_NAME}", concurrency 5`);
});

worker.on("completed", (job) => {
  console.log(`[email-worker] completed ${job.name} (job ${job.id}, attempt ${job.attemptsMade + 1})`);
});

worker.on("failed", (job, error) => {
  const attempt = job ? `${job.attemptsMade}/${job.opts.attempts ?? 1}` : "?";
  console.error(`[email-worker] failed ${job?.name ?? "unknown"} (job ${job?.id}, attempt ${attempt}): ${error.message}`);
});

worker.on("error", (error) => {
  console.error(`[email-worker] worker error: ${error.message}`);
});

// Health heartbeat with queue depth — visible via docker logs.
const healthTimer = setInterval(() => {
  void emailQueueCounts().then((counts) => {
    if (counts) console.log(`[email-worker] health ${JSON.stringify(counts)}`);
  });
}, 60_000);
healthTimer.unref();

async function shutdown(signal: string) {
  console.log(`[email-worker] ${signal} received — draining...`);
  clearInterval(healthTimer);
  try {
    // Waits for in-flight jobs; queued jobs stay in Redis for the next start.
    await worker.close();
    await closeEmailQueue();
  } catch (error) {
    console.error(`[email-worker] shutdown error: ${error instanceof Error ? error.message : error}`);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
