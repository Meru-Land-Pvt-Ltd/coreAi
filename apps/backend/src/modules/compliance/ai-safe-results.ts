import crypto from "crypto";
import { env } from "../../config/env";

export type InternalCalendarResult = Record<string, unknown>;

export type AiSafeAvailabilityResult = {
  success: boolean;
  date?: string;
  availableTimes?: string[];
  message: string;
};

export type AiSafeBookingResult = {
  success: boolean;
  status?: string;
  date?: string;
  time?: string;
  service?: string;
  message: string;
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function toAiSafeAvailabilityResult(internal: InternalCalendarResult): AiSafeAvailabilityResult {
  const parts: string[] = [];

  const requested = str(internal.requested_time);
  const verdict = str(internal.verdict);
  if (requested && verdict) {
    parts.push(`Requested time ${requested}: ${verdict.replace(/_/g, " ")}.`);
  }

  const openFrom = str(internal.open_from);
  const openUntil = str(internal.open_until);
  if (openFrom && openUntil) parts.push(`Open ${openFrom} to ${openUntil} that day.`);
  else if (openUntil) parts.push(`Open until ${openUntil} that day.`);

  const duration = str(internal.duration);
  if (duration) parts.push(`Each ${str(internal.service) ?? "appointment"} takes ${duration}.`);

  const totalFree = typeof internal.total_free_slots === "number" ? internal.total_free_slots : undefined;
  if (typeof totalFree === "number") parts.push(`${totalFree} free time(s) across the day.`);

  const baseMessage = str(internal.message);
  if (baseMessage) parts.push(baseMessage);

  const availableTimes = (() => {
    const slots = stringList(internal.available_slots);
    if (slots.length) return slots;
    return stringList(internal.alternatives);
  })();

  const failed =
    internal.closed === true ||
    verdict === "calendar_unavailable" ||
    ["error", "needs_reconnect"].includes(str(internal.calendar_status) ?? "");

  return {
    success: !failed,
    ...(str(internal.date) ? { date: str(internal.date) } : {}),
    availableTimes,
    message: parts.join(" ") || "Availability was checked."
  };
}

export function toAiSafeBookingResult(internal: InternalCalendarResult): AiSafeBookingResult {
  const success = internal.success === true;
  const verdict = str(internal.verdict);

  const parts: string[] = [];
  const confirmation = str(internal.confirmation);
  const baseMessage = str(internal.message);
  if (confirmation) parts.push(confirmation);
  if (baseMessage && baseMessage !== confirmation) parts.push(baseMessage);

  const alternatives = stringList(internal.alternatives);
  if (!success && alternatives.length) parts.push(`Open alternatives: ${alternatives.join(", ")}.`);
  const openUntil = str(internal.open_until);
  if (!success && openUntil) parts.push(`Open until ${openUntil} that day.`);

  const sms = internal.sms;
  if (sms && typeof sms === "object") {
    const smsRecord = sms as Record<string, unknown>;
    if (smsRecord.sent === true) {
      parts.push("A confirmation text was sent to the caller.");
    } else if (smsRecord.attempted === true || smsRecord.blocked_reason) {
      parts.push("No confirmation text was sent — do not tell the caller a text was sent.");
    }
  }

  const date = str(internal.date);
  const time = str(internal.time);

  return {
    success,
    status: success ? "confirmed" : verdict ?? "failed",
    ...(date ? { date } : {}),
    ...(time ? { time } : {}),
    ...(str(internal.service_type) ?? str(internal.service)
      ? { service: str(internal.service_type) ?? str(internal.service) }
      : {}),
    message: parts.join(" ") || (success ? "The booking is confirmed." : "The booking could not be completed.")
  };
}

export type AiSafeAppointmentDescriptor = {
  number?: number;
  appointment_id?: string;
  service?: string;
  appointment_date?: string;
  appointment_time?: string;
};

export type AiSafeAppointmentActionResult = {
  cancelled?: boolean;
  rescheduled?: boolean;
  code?: string;
  message: string;
  sms_sent?: boolean;
  appointment?: AiSafeAppointmentDescriptor;
  appointments?: AiSafeAppointmentDescriptor[];
  previous?: { appointment_date?: string; appointment_time?: string };
};

function toSafeDescriptor(value: unknown): AiSafeAppointmentDescriptor | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.number === "number" ? { number: record.number } : {}),
    ...(str(record.appointment_id) ? { appointment_id: str(record.appointment_id) } : {}),
    ...(str(record.service) ? { service: str(record.service) } : {}),
    ...(str(record.appointment_date) ? { appointment_date: str(record.appointment_date) } : {}),
    ...(str(record.appointment_time) ? { appointment_time: str(record.appointment_time) } : {})
  };
}

export function toAiSafeAppointmentActionResult(
  internal: InternalCalendarResult
): AiSafeAppointmentActionResult {
  const appointments = Array.isArray(internal.appointments)
    ? internal.appointments.map(toSafeDescriptor).filter((item): item is AiSafeAppointmentDescriptor => Boolean(item))
    : undefined;
  const previous = toSafeDescriptor(internal.previous);

  return {
    ...(typeof internal.cancelled === "boolean" ? { cancelled: internal.cancelled } : {}),
    ...(typeof internal.rescheduled === "boolean" ? { rescheduled: internal.rescheduled } : {}),
    ...(str(internal.code) ? { code: str(internal.code) } : {}),
    ...(typeof internal.sms_sent === "boolean" ? { sms_sent: internal.sms_sent } : {}),
    ...(toSafeDescriptor(internal.appointment) ? { appointment: toSafeDescriptor(internal.appointment) } : {}),
    ...(appointments?.length ? { appointments } : {}),
    ...(previous && (previous.appointment_date || previous.appointment_time)
      ? { previous: { appointment_date: previous.appointment_date, appointment_time: previous.appointment_time } }
      : {}),
    message: str(internal.message) ?? "Done."
  };
}

export function appointmentAiRef(appointmentId: string): string {
  return crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(`appointment-ai-ref:${appointmentId}`)
    .digest("hex")
    .slice(0, 12);
}

/** Resolve an AI-provided ref (or a raw id, for in-flight back-compat) against candidates. */
export function resolveAppointmentAiRef<T extends { id: string }>(
  requested: string,
  candidates: readonly T[]
): T | undefined {
  return candidates.find(
    (candidate) => candidate.id === requested || appointmentAiRef(candidate.id) === requested
  );
}
