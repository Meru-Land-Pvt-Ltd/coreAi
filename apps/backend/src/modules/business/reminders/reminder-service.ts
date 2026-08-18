import { prisma } from "../../../lib/prisma";
import { resolveReminderConfig } from "./reminder-config";

/**
 * Appointment-reminder scheduling. All state lives in AppointmentReminder rows
 * (dedupeKey = `${appointmentId}:${offsetMinutes}`, unique), so scheduling is
 * idempotent and the worker survives restarts with no in-memory state.
 *
 * Timezone note: Appointment.startAt is a UTC instant, so
 * `sendAt = startAt - offsetMinutes` is plain instant arithmetic and is
 * DST-safe by construction — no wall-clock/timezone math happens here at all.
 * The appointment's timeZone is only used later, by the worker, to FORMAT the
 * time inside the SMS body.
 */

/** Don't bother scheduling a reminder that would fire within 2 minutes. */
const MIN_LEAD_MS = 2 * 60 * 1000;

/** One reminder per appointment+offset, forever. */
export function reminderDedupeKey(appointmentId: string, offsetMinutes: number): string {
  return `${appointmentId}:${offsetMinutes}`;
}

/** Statuses the worker still considers actionable. */
export const ACTIVE_REMINDER_STATUSES = ["SCHEDULED", "RETRYING"] as const;

export type ScheduleRemindersResult = {
  scheduled: number;
  skippedPast: number;
  skippedReason: "NOT_FOUND" | "NOT_LIVE" | "NOT_BOOKED" | "DISABLED" | null;
};

/**
 * Create/refresh reminder rows for an appointment. Only LIVE + BOOKED
 * appointments get reminders (test/dry-run modes never text real customers).
 * Safe to call repeatedly — rows are keyed on dedupeKey, and a row that has
 * already been SENT is never rewound.
 */
export async function scheduleRemindersForAppointment(input: {
  appointmentId: string;
}): Promise<ScheduleRemindersResult> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: {
      id: true,
      businessId: true,
      installedAgentId: true,
      startAt: true,
      status: true,
      executionMode: true
    }
  });

  if (!appointment) return { scheduled: 0, skippedPast: 0, skippedReason: "NOT_FOUND" };
  if (appointment.executionMode !== "LIVE") {
    return { scheduled: 0, skippedPast: 0, skippedReason: "NOT_LIVE" };
  }
  if (appointment.status !== "BOOKED") {
    return { scheduled: 0, skippedPast: 0, skippedReason: "NOT_BOOKED" };
  }

  const installedAgent = appointment.installedAgentId
    ? await prisma.installedAgent.findUnique({
        where: { id: appointment.installedAgentId },
        select: { configJson: true }
      })
    : null;

  const config = resolveReminderConfig(installedAgent?.configJson);
  if (!config.enabled) return { scheduled: 0, skippedPast: 0, skippedReason: "DISABLED" };

  const now = Date.now();
  const startAtMs = appointment.startAt.getTime();
  let scheduled = 0;
  let skippedPast = 0;

  for (const offsetMinutes of config.offsetsMinutes) {
    // UTC instant math — DST-safe by construction (see module comment).
    const sendAt = new Date(startAtMs - offsetMinutes * 60 * 1000);
    if (sendAt.getTime() < now + MIN_LEAD_MS) {
      skippedPast += 1;
      continue;
    }

    const dedupeKey = reminderDedupeKey(appointment.id, offsetMinutes);

    // Upsert guarantees the row exists exactly once per (appointment, offset).
    await prisma.appointmentReminder.upsert({
      where: { dedupeKey },
      create: {
        businessId: appointment.businessId,
        appointmentId: appointment.id,
        offsetMinutes,
        sendAt,
        channel: "SMS",
        status: "SCHEDULED",
        dedupeKey
      },
      // Intentionally a no-op: the guarded updateMany below is the ONLY write
      // path for existing rows, so a reminder that already SENT is never
      // rewound back to SCHEDULED.
      update: {}
    });

    await prisma.appointmentReminder.updateMany({
      where: { dedupeKey, status: { notIn: ["SENT"] } },
      data: { sendAt, status: "SCHEDULED", attempts: 0, lastError: null }
    });

    scheduled += 1;
  }

  return { scheduled, skippedPast, skippedReason: null };
}

/**
 * Cancel every still-pending reminder for an appointment (used when the
 * appointment itself is cancelled). SENT/FAILED/terminal rows are untouched.
 */
export async function cancelRemindersForAppointment(appointmentId: string): Promise<number> {
  const result = await prisma.appointmentReminder.updateMany({
    where: { appointmentId, status: { in: [...ACTIVE_REMINDER_STATUSES] } },
    data: { status: "CANCELLED" }
  });
  return result.count;
}

/**
 * Recompute sendAt for all non-SENT reminders from the appointment's CURRENT
 * startAt (used after a reschedule). Reminders whose recomputed sendAt is
 * already in the past are cancelled instead. If the appointment is no longer
 * LIVE+BOOKED this degrades to a plain cancel.
 */
export async function rescheduleRemindersForAppointment(appointmentId: string): Promise<{
  rescheduled: number;
  cancelled: number;
}> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, startAt: true, status: true, executionMode: true }
  });

  if (!appointment) return { rescheduled: 0, cancelled: 0 };
  if (appointment.status !== "BOOKED" || appointment.executionMode !== "LIVE") {
    const cancelled = await cancelRemindersForAppointment(appointmentId);
    return { rescheduled: 0, cancelled };
  }

  const reminders = await prisma.appointmentReminder.findMany({
    where: { appointmentId, status: { notIn: ["SENT"] } },
    select: { id: true, offsetMinutes: true }
  });

  const now = Date.now();
  const startAtMs = appointment.startAt.getTime();
  let rescheduled = 0;
  let cancelled = 0;

  for (const reminder of reminders) {
    // Same UTC instant arithmetic as scheduling — DST-safe by construction.
    const sendAt = new Date(startAtMs - reminder.offsetMinutes * 60 * 1000);

    if (sendAt.getTime() < now + MIN_LEAD_MS) {
      await prisma.appointmentReminder.update({
        where: { id: reminder.id },
        data: { status: "CANCELLED", sendAt }
      });
      cancelled += 1;
      continue;
    }

    await prisma.appointmentReminder.update({
      where: { id: reminder.id },
      data: { sendAt, status: "SCHEDULED", attempts: 0, lastError: null }
    });
    rescheduled += 1;
  }

  return { rescheduled, cancelled };
}
