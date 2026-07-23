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
  /** Opaque reference for follow-up tools — never a raw database id. */
  appointmentRef?: string;
  /** Consent state of the canonical SMS recipient: granted | declined | none. */
  consentStatus?: string;
  /** Last digits of the canonical recipient (never the full number). */
  recipientEnding?: string;
  smsAttempted?: boolean;
  smsStatus?: string;
  deliveryErrorCode?: string;
  /** The EXACT sentence the assistant may speak about the text. */
  customerSafeMessage?: string;
  /** Canonical consent disclosure to read WORD-FOR-WORD when consentStatus is none. */
  requiredDisclosure?: string;
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
  let customerSafeMessage: string | undefined;
  const smsRecord = sms && typeof sms === "object" ? (sms as Record<string, unknown>) : null;
  if (smsRecord) {
    const providerAccepted =
      smsRecord.sent === true &&
      (smsRecord.provider_accepted === true || Boolean(str(smsRecord.messageSid)));
    if (providerAccepted) {
      // Acceptance, not delivery — Twilio has the message; it may still fail.
      customerSafeMessage = "Your confirmation text has been submitted.";
      parts.push(`The provider accepted the confirmation text. Tell the caller EXACTLY: "${customerSafeMessage}" Never claim it was delivered.`);
    } else if (smsRecord.blocked_reason === "SMS_OPTED_OUT") {
      customerSafeMessage = "Your appointment is booked, but I couldn't send the confirmation text.";
      parts.push(
        `The caller previously DECLINED texts. Do NOT ask for SMS consent again on this call and never send or promise a text. If asked, say: "${customerSafeMessage}"`
      );
    } else if (smsRecord.blocked_reason === "SMS_CONSENT_REQUIRED") {
      customerSafeMessage = "Your appointment is booked, but I couldn't send the confirmation text.";
      parts.push(
        "No text was sent — the caller has NOT consented to SMS yet. Read the SMS consent disclosure in requiredDisclosure to them WORD-FOR-WORD (never paraphrase, shorten, or summarize it), wait for their yes or no, then call record_sms_consent."
      );
    } else if (smsRecord.attempted === true || smsRecord.blocked_reason) {
      customerSafeMessage = "Your appointment is booked, but I couldn't send the confirmation text.";
      parts.push(`No confirmation text was sent. Tell the caller EXACTLY: "${customerSafeMessage}" Never claim a text was sent.`);
    }
  }

  const deliveryNote = str(internal.sms_delivery_note);
  if (deliveryNote) parts.push(deliveryNote);

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
    ...(str(internal.appointment_ref) ? { appointmentRef: str(internal.appointment_ref) } : {}),
    ...(str(internal.consent_status) ? { consentStatus: str(internal.consent_status) } : {}),
    ...(str(internal.canonical_recipient_ending)
      ? { recipientEnding: str(internal.canonical_recipient_ending) }
      : {}),
    ...(smsRecord ? { smsAttempted: smsRecord.attempted === true } : {}),
    ...(smsRecord && str(smsRecord.status) ? { smsStatus: str(smsRecord.status) } : {}),
    ...(smsRecord && str(smsRecord.delivery_error_code)
      ? { deliveryErrorCode: str(smsRecord.delivery_error_code) }
      : {}),
    ...(customerSafeMessage ? { customerSafeMessage } : {}),
    ...(str(internal.required_disclosure) ? { requiredDisclosure: str(internal.required_disclosure) } : {}),
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
