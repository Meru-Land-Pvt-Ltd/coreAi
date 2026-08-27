import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "../../config/env";
import {
  sendBusinessEmail,
  sendCustomerFollowUpEmail,
  sendInternalNotificationEmail,
  type SendBusinessEmailInput
} from "./ses-mail-service";

/**
 * Reliable email delivery through Redis/BullMQ.
 *
 * Producers call enqueueEmail() and return immediately — SES is only ever
 * touched by the worker (apps/backend/src/email-worker.ts) or, when REDIS_URL
 * is not configured (local dev), by an inline fallback dispatch. Jobs reuse
 * the EmailMessage idempotency key as their BullMQ job id, so a duplicate
 * enqueue cannot create a second job, and sendBusinessEmail's unique-key
 * check makes a duplicate delivery a no-op even across queue restarts.
 */

export const EMAIL_QUEUE_NAME = "email-notifications";

export type EmailJobData =
  | { kind: "business_email"; input: SendBusinessEmailInput }
  | { kind: "customer_follow_up"; input: Parameters<typeof sendCustomerFollowUpEmail>[0] }
  | { kind: "internal_notification"; input: Parameters<typeof sendInternalNotificationEmail>[0] };

export type EmailDispatchResult = { ok: boolean; queued?: boolean; error?: string };

let queue: Queue | null = null;

export function isEmailQueueConfigured(): boolean {
  return Boolean(env.REDIS_URL);
}

/** REDIS_URL parsed into BullMQ connection options (worker-safe settings). */
export function getEmailQueueConnection(): ConnectionOptions {
  const url = new URL(env.REDIS_URL as string);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname && url.pathname !== "/" ? { db: Number(url.pathname.slice(1)) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    // BullMQ requires this on blocking connections.
    maxRetriesPerRequest: null
  };
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(EMAIL_QUEUE_NAME, { connection: getEmailQueueConnection() });
  }
  return queue;
}

/** Failures that must never be retried — recipient/config problems, not infrastructure. */
const PERMANENT_PATTERNS = [
  /suppressed/i,
  /* A BUSINESS'S HOURLY CEILING IS NOT A NETWORK BLIP. This matched the
     "rate limit" pattern below, so a mail refused by the business's own
     hourly limit was retried five times with a thirty-second backoff — about
     seven minutes against a sixty-minute window — and then abandoned. The
     retries could never succeed, and the attempts they burned were the ones
     a real transient failure needed. */
  /email rate limit reached for this business/i,
  /invalid recipient/i,
  /disabled in mail setup/i,
  /no active email alias/i,
  /no forward-to email/i,
  /not configured/i
];

/** Transient AWS/network conditions that a backoff retry can fix. */
const RETRYABLE_PATTERNS = [
  /throttl/i,
  /rate limit/i,
  /too many requests/i,
  /timeout|timed out/i,
  /econn|enotfound|eai_again|epipe|socket/i,
  /network/i,
  /temporar/i,
  /service unavailable|503|502/i
];

/** Thrown to make BullMQ retry with exponential backoff. */
export class RetryableEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableEmailError";
  }
}

/**
 * Execute one email job. Shared by the worker and the inline dev fallback.
 * Permanent failures resolve (job completes, no retry); transient failures
 * throw so BullMQ retries. The EmailMessage row already reflects the outcome.
 */
export async function dispatchEmailJob(data: EmailJobData): Promise<EmailDispatchResult> {
  const result =
    data.kind === "customer_follow_up"
      ? await sendCustomerFollowUpEmail(data.input)
      : data.kind === "internal_notification"
        ? await sendInternalNotificationEmail(data.input)
        : await sendBusinessEmail(data.input);

  if (result.ok) return { ok: true };

  if (RETRYABLE_PATTERNS.some((p) => p.test(result.error)) && !PERMANENT_PATTERNS.some((p) => p.test(result.error))) {
    throw new RetryableEmailError(result.error);
  }

  console.log(`[email-queue] permanent failure, not retrying: ${result.error}`);
  return { ok: false, error: result.error };
}

/** BullMQ job ids must not contain ":", so idempotency keys are slug-mapped. */
function toJobId(idempotencyKey: string | null | undefined): string | undefined {
  const key = idempotencyKey?.trim();
  if (!key) return undefined;
  return key.replace(/[^a-zA-Z0-9_@.-]/g, "_");
}

/**
 * Enqueue an email for background delivery. Never throws to the caller —
 * a caller's appointment/call handling must not fail because of email.
 */
export async function enqueueEmail(
  data: EmailJobData,
  opts?: { idempotencyKey?: string | null }
): Promise<EmailDispatchResult> {
  if (!isEmailQueueConfigured()) {
    try {
      return await dispatchEmailJob(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "email dispatch failed";
      console.error(`[email-queue] inline dispatch failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  try {
    await getQueue().add(data.kind, data, {
      jobId: toJobId(opts?.idempotencyKey),
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 }
    });
    return { ok: true, queued: true };
  } catch (error) {
    // Redis down: degrade to inline send rather than dropping the message.
    const message = error instanceof Error ? error.message : "enqueue failed";
    console.error(`[email-queue] enqueue failed (${message}) — sending inline`);
    try {
      return await dispatchEmailJob(data);
    } catch (dispatchError) {
      const inner = dispatchError instanceof Error ? dispatchError.message : "email dispatch failed";
      return { ok: false, error: inner };
    }
  }
}

/** Queue depth snapshot for worker health logging. */
export async function emailQueueCounts(): Promise<Record<string, number> | null> {
  if (!isEmailQueueConfigured()) return null;
  try {
    return (await getQueue().getJobCounts("waiting", "active", "delayed", "failed")) as Record<string, number>;
  } catch {
    return null;
  }
}

export async function closeEmailQueue(): Promise<void> {
  await queue?.close().catch(() => undefined);
  queue = null;
}
