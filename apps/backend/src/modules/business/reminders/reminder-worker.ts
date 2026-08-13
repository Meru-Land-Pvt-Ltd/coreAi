import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { sendTrackedSms } from "../../notifications/sms-notification-service";
import { ACTIVE_REMINDER_STATUSES } from "./reminder-service";

/**
 * Appointment-reminder delivery worker.
 *
 * All state is AppointmentReminder rows, so the worker survives restarts: a
 * sweep simply picks up whatever is due. Two workers can run concurrently —
 * each row is claimed with an atomic conditional updateMany (status must still
 * be SCHEDULED/RETRYING); only the claimer whose update count === 1 proceeds,
 * so a reminder can never be double-sent.
 *
 * The reminder row is the ONLY thing the worker writes. The appointment row is
 * never touched, on any outcome.
 */

export const REMINDER_MAX_ATTEMPTS = 3;
/** Rows processed per sweep — keeps a single sweep bounded. */
export const REMINDER_SWEEP_BATCH_SIZE = 25;
/** Retry backoff: +5min per attempt, capped so a retry never drifts far. */
const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = 30 * 60 * 1000;
const LAST_ERROR_MAX_LENGTH = 300;
const DEFAULT_INTERVAL_MS = 60 * 1000;

/** Consent-shaped suppression codes → terminal SKIPPED_NO_CONSENT. */
const CONSENT_SUPPRESSION_CODES = new Set([
  "SMS_CONSENT_REQUIRED",
  "SMS_OPTED_OUT",
  "SMS_BUSINESS_UNRESOLVED"
]);

export type ReminderSweepSummary = {
  claimed: number;
  sent: number;
  skippedNoConsent: number;
  retried: number;
  failed: number;
  cancelled: number;
};

function truncateError(message: string | null | undefined): string {
  return (message ?? "unknown error").slice(0, LAST_ERROR_MAX_LENGTH);
}

function formatInZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): string {
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(date);
  } catch {
    // Unknown/invalid IANA zone — fall back to UTC rather than crash the sweep.
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
  }
}

export function composeReminderMessage(input: {
  businessName: string;
  service: string | null;
  startAt: Date;
  timeZone: string;
}): string {
  const service = input.service?.trim();
  const what = service ? `your ${service} appointment` : "your appointment";
  const date = formatInZone(input.startAt, input.timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
  const time = formatInZone(input.startAt, input.timeZone, {
    hour: "numeric",
    minute: "2-digit"
  });
  return `Reminder from ${input.businessName}: ${what} is on ${date} at ${time} (${input.timeZone}). Reply C to cancel.`;
}

/** Terminal/next-state write for one reminder row. Never touches the appointment. */
async function updateReminder(id: string, data: Prisma.AppointmentReminderUpdateInput): Promise<void> {
  await prisma.appointmentReminder.update({ where: { id }, data });
}

/**
 * One sweep: claim due reminders and deliver them. Exported separately from
 * the timer so tests (and ops scripts) can run it directly.
 */
export async function runReminderSweep(now = new Date()): Promise<ReminderSweepSummary> {
  const summary: ReminderSweepSummary = {
    claimed: 0,
    sent: 0,
    skippedNoConsent: 0,
    retried: 0,
    failed: 0,
    cancelled: 0
  };

  const due = await prisma.appointmentReminder.findMany({
    where: {
      status: { in: [...ACTIVE_REMINDER_STATUSES] },
      sendAt: { lte: now },
      attempts: { lt: REMINDER_MAX_ATTEMPTS },
      channel: "SMS"
    },
    orderBy: { sendAt: "asc" },
    take: REMINDER_SWEEP_BATCH_SIZE,
    select: { id: true }
  });

  for (const row of due) {
    // Atomic claim: only one worker can transition SCHEDULED/RETRYING → SENDING.
    const claim = await prisma.appointmentReminder.updateMany({
      where: { id: row.id, status: { in: [...ACTIVE_REMINDER_STATUSES] } },
      data: { status: "SENDING", attempts: { increment: 1 } }
    });
    if (claim.count !== 1) continue; // another worker won the row — skip.
    summary.claimed += 1;

    try {
      await processClaimedReminder(row.id, now, summary);
    } catch (error) {
      // Defensive: a processing crash must not poison the rest of the batch.
      const message = truncateError(error instanceof Error ? error.message : String(error));
      console.error("[reminders] processing crashed", { reminderId: row.id, error: message });
      await applyFailureOutcome(row.id, message, now, summary).catch(() => null);
    }
  }

  return summary;
}

async function processClaimedReminder(
  reminderId: string,
  now: Date,
  summary: ReminderSweepSummary
): Promise<void> {
  const reminder = await prisma.appointmentReminder.findUnique({
    where: { id: reminderId },
    include: { appointment: true }
  });
  if (!reminder) return;

  const appointment = reminder.appointment;

  // The appointment may have changed since scheduling — re-check now.
  if (!appointment || appointment.status !== "BOOKED" || appointment.executionMode !== "LIVE") {
    await updateReminder(reminder.id, {
      status: "CANCELLED",
      lastError: `appointment not eligible (status=${appointment?.status ?? "missing"}, mode=${appointment?.executionMode ?? "?"})`
    });
    summary.cancelled += 1;
    return;
  }

  if (appointment.startAt.getTime() <= now.getTime()) {
    await updateReminder(reminder.id, {
      status: "CANCELLED",
      lastError: "appointment start time already passed"
    });
    summary.cancelled += 1;
    return;
  }

  const business = await prisma.business.findUnique({
    where: { id: reminder.businessId },
    select: { name: true }
  });
  if (!business) {
    await updateReminder(reminder.id, {
      status: "FAILED",
      lastError: "business not found for reminder"
    });
    summary.failed += 1;
    return;
  }

  const timeZone = appointment.timeZone?.trim() || "America/New_York";
  const body = composeReminderMessage({
    businessName: business.name,
    service: appointment.service,
    startAt: appointment.startAt,
    timeZone
  });

  // NOTE: SmsMessageType has no APPOINTMENT_REMINDER member, so the closest
  // appointment type (APPOINTMENT_CONFIRMATION — same consent-gated
  // transactional booking program) is used. smsPurpose IS the approved
  // APPOINTMENT_REMINDER transactional purpose. Consent enforcement happens
  // centrally inside sendTrackedSms; a consent denial arrives back as a
  // suppressed outcome.
  const outcome = await sendTrackedSms({
    to: appointment.customerPhone,
    body,
    messageType: "APPOINTMENT_CONFIRMATION",
    businessId: reminder.businessId,
    installedAgentId: appointment.installedAgentId ?? null,
    appointmentId: appointment.id,
    businessName: business.name,
    smsPurpose: "APPOINTMENT_REMINDER",
    // Provider-level dedupe: even if two claims ever raced past the row claim,
    // SmsExecution's unique dedupeKey guarantees at most one real send.
    dedupeKey: `appointment-reminder:${appointment.id}:${reminder.offsetMinutes}`
  });

  if (outcome.sent) {
    await updateReminder(reminder.id, {
      status: "SENT",
      sentAt: new Date(),
      providerId: outcome.messageSid ?? outcome.executionId,
      lastError: null
    });
    summary.sent += 1;
    return;
  }

  if (outcome.suppressed && CONSENT_SUPPRESSION_CODES.has(outcome.errorCode ?? "")) {
    // Terminal — retrying cannot manufacture consent.
    await updateReminder(reminder.id, {
      status: "SKIPPED_NO_CONSENT",
      lastError: truncateError(outcome.error ?? outcome.errorCode)
    });
    summary.skippedNoConsent += 1;
    return;
  }

  if (outcome.suppressed || outcome.errorCode === "SMS_INVALID_RECIPIENT") {
    // Deterministic rejections (purpose guard, invalid phone) — no retry.
    await updateReminder(reminder.id, {
      status: "FAILED",
      lastError: truncateError(outcome.error ?? outcome.errorCode)
    });
    summary.failed += 1;
    return;
  }

  // Transient provider failure — retry with backoff, bounded attempts.
  await applyFailureOutcome(reminderId, truncateError(outcome.error), now, summary);
}

async function applyFailureOutcome(
  reminderId: string,
  lastError: string,
  now: Date,
  summary: ReminderSweepSummary
): Promise<void> {
  const current = await prisma.appointmentReminder.findUnique({
    where: { id: reminderId },
    select: { attempts: true }
  });
  const attempts = current?.attempts ?? REMINDER_MAX_ATTEMPTS;

  if (attempts >= REMINDER_MAX_ATTEMPTS) {
    await updateReminder(reminderId, { status: "FAILED", lastError });
    summary.failed += 1;
    return;
  }

  const backoffMs = Math.min(RETRY_BASE_MS * attempts, RETRY_MAX_MS);
  await updateReminder(reminderId, {
    status: "RETRYING",
    sendAt: new Date(now.getTime() + backoffMs),
    lastError
  });
  summary.retried += 1;
}

/* ------------------------------- timer loop ------------------------------- */

let reminderTimer: NodeJS.Timeout | null = null;

function resolveIntervalMs(override?: number): number {
  if (override && Number.isFinite(override) && override > 0) return override;
  // Optional env override; not part of the validated env schema on purpose —
  // this module must not require edits to config/env.ts.
  const fromEnv = Number(process.env.REMINDER_WORKER_INTERVAL_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_INTERVAL_MS;
}

export function startReminderWorker(intervalMs?: number): void {
  if (reminderTimer) return;
  const interval = resolveIntervalMs(intervalMs);
  void runReminderSweep().catch((error) => {
    console.error("[reminders] initial sweep failed", error);
  });
  reminderTimer = setInterval(() => {
    void runReminderSweep().catch((error) => {
      console.error("[reminders] sweep failed", error);
    });
  }, interval);
  // Never keep the process alive just for reminders.
  reminderTimer.unref();
}

export function stopReminderWorker(): void {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}
