import type { ApiErrorStatus } from "../../lib/error-utils";

/**
 * Central Google Calendar error normalization. Every calendar failure that can
 * reach a user is mapped to one public code with a safe message — raw Google
 * payloads, OAuth tokens, and stack traces stay in server logs only.
 */

export type CalendarErrorCode =
  | "CALENDAR_NOT_CONNECTED"
  | "CALENDAR_PERMISSION_REQUIRED"
  | "CALENDAR_TIMEZONE_MISSING"
  | "CALENDAR_TIMEZONE_INVALID"
  | "CALENDAR_EVENT_CREATE_FAILED"
  | "CALENDAR_EVENT_DELETE_FAILED"
  | "CALENDAR_AVAILABILITY_FAILED"
  | "CALENDAR_TOKEN_EXPIRED"
  | "CALENDAR_REAUTH_REQUIRED"
  | "INVALID_APPOINTMENT_TIME"
  | "APPOINTMENT_TIME_IN_PAST"
  | "APPOINTMENT_SLOT_UNAVAILABLE"
  | "TEST_CALENDAR_NOT_CONFIGURED";

export type CalendarError = {
  code: CalendarErrorCode;
  /** Safe to show to any user. Never contains provider payloads. */
  userMessage: string;
  /** What the user can do about it. */
  remediation: string;
  retryable: boolean;
  httpStatus: ApiErrorStatus;
  /** Internal detail for server logs only — never send to the client. */
  internalDetail?: string;
  /** Provider status/code for logs only. */
  providerCode?: string | number;
};

const DEFINITIONS: Record<CalendarErrorCode, Omit<CalendarError, "internalDetail" | "providerCode">> = {
  CALENDAR_NOT_CONNECTED: {
    code: "CALENDAR_NOT_CONNECTED",
    userMessage: "Google Calendar is not connected.",
    remediation: "Connect Google Calendar from the setup page, then try again.",
    retryable: false,
    httpStatus: 409
  },
  CALENDAR_PERMISSION_REQUIRED: {
    code: "CALENDAR_PERMISSION_REQUIRED",
    userMessage: "The connected Google account does not allow calendar access.",
    remediation: "Reconnect Google Calendar and grant calendar permission.",
    retryable: false,
    httpStatus: 403
  },
  CALENDAR_TIMEZONE_MISSING: {
    code: "CALENDAR_TIMEZONE_MISSING",
    userMessage: "No timezone is configured, so appointment times cannot be interpreted safely.",
    remediation: "Set the business timezone (or select a test timezone) and try again.",
    retryable: false,
    httpStatus: 422
  },
  CALENDAR_TIMEZONE_INVALID: {
    code: "CALENDAR_TIMEZONE_INVALID",
    userMessage: "The configured timezone is not a valid IANA timezone.",
    remediation: "Pick a valid timezone such as America/New_York or Asia/Kolkata.",
    retryable: false,
    httpStatus: 422
  },
  CALENDAR_EVENT_CREATE_FAILED: {
    code: "CALENDAR_EVENT_CREATE_FAILED",
    userMessage: "The calendar event could not be created. The appointment was not booked.",
    remediation: "Try again. If the problem continues, reconnect Google Calendar.",
    retryable: true,
    httpStatus: 503
  },
  CALENDAR_EVENT_DELETE_FAILED: {
    code: "CALENDAR_EVENT_DELETE_FAILED",
    userMessage: "The calendar event could not be deleted.",
    remediation: "Try again. If the problem continues, remove the event directly in Google Calendar.",
    retryable: true,
    httpStatus: 503
  },
  CALENDAR_AVAILABILITY_FAILED: {
    code: "CALENDAR_AVAILABILITY_FAILED",
    userMessage: "Calendar availability could not be read.",
    remediation: "Try again, or reconnect Google Calendar if this keeps happening.",
    retryable: true,
    httpStatus: 503
  },
  CALENDAR_TOKEN_EXPIRED: {
    code: "CALENDAR_TOKEN_EXPIRED",
    userMessage: "The Google Calendar connection has expired.",
    remediation: "Reconnect Google Calendar to refresh access.",
    retryable: false,
    httpStatus: 401
  },
  CALENDAR_REAUTH_REQUIRED: {
    code: "CALENDAR_REAUTH_REQUIRED",
    userMessage: "Google Calendar needs to be reconnected.",
    remediation: "Reconnect Google Calendar from the setup page.",
    retryable: false,
    httpStatus: 401
  },
  INVALID_APPOINTMENT_TIME: {
    code: "INVALID_APPOINTMENT_TIME",
    userMessage: "The requested appointment time could not be understood.",
    remediation: "Provide the date and time again, e.g. \"July 25 at 3:00 PM\".",
    retryable: false,
    httpStatus: 422
  },
  APPOINTMENT_TIME_IN_PAST: {
    code: "APPOINTMENT_TIME_IN_PAST",
    userMessage: "The requested appointment time is in the past.",
    remediation: "Choose a future date and time.",
    retryable: false,
    httpStatus: 422
  },
  APPOINTMENT_SLOT_UNAVAILABLE: {
    code: "APPOINTMENT_SLOT_UNAVAILABLE",
    userMessage: "That time slot is no longer available.",
    remediation: "Pick another available time.",
    retryable: false,
    httpStatus: 409
  },
  TEST_CALENDAR_NOT_CONFIGURED: {
    code: "TEST_CALENDAR_NOT_CONFIGURED",
    userMessage: "No test calendar is connected, so the test ran in simulated mode.",
    remediation: "Connect your Google account on the Test tab to create real test events.",
    retryable: false,
    httpStatus: 409
  }
};

export function calendarError(code: CalendarErrorCode, internalDetail?: string, providerCode?: string | number): CalendarError {
  return { ...DEFINITIONS[code], internalDetail, providerCode };
}

function providerStatus(error: unknown): number | null {
  const candidate = error as { code?: unknown; response?: { status?: unknown } } | null;
  const code = candidate?.code ?? candidate?.response?.status;
  if (typeof code === "number") return code;
  return Number.isFinite(Number(code)) ? Number(code) : null;
}

/**
 * Classify a raw error thrown by the Google Calendar connector into a safe
 * {@link CalendarError}. `operation` picks the fallback code when the failure
 * is not a recognizable auth/permission problem.
 */
export function classifyCalendarError(
  error: unknown,
  operation: "availability" | "create" | "delete"
): CalendarError {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  const status = providerStatus(error);

  const fallbackCode: CalendarErrorCode =
    operation === "availability"
      ? "CALENDAR_AVAILABILITY_FAILED"
      : operation === "create"
        ? "CALENDAR_EVENT_CREATE_FAILED"
        : "CALENDAR_EVENT_DELETE_FAILED";

  const detail = error instanceof Error ? error.message : String(error ?? "");

  if (message.includes("not connected")) {
    return calendarError("CALENDAR_NOT_CONNECTED", detail, status ?? undefined);
  }
  if (message.includes("invalid_grant") || message.includes("token has been expired") || message.includes("token expired")) {
    return calendarError("CALENDAR_TOKEN_EXPIRED", detail, status ?? undefined);
  }
  if (status === 401 || message.includes("unauthorized") || message.includes("invalid credentials")) {
    return calendarError("CALENDAR_REAUTH_REQUIRED", detail, status ?? undefined);
  }
  if (status === 403 || message.includes("insufficient permission") || message.includes("forbidden")) {
    return calendarError("CALENDAR_PERMISSION_REQUIRED", detail, status ?? undefined);
  }

  return calendarError(fallbackCode, detail, status ?? undefined);
}

/** Shape safe for API responses — internal detail and provider code stripped. */
export function publicCalendarError(error: CalendarError): {
  code: CalendarErrorCode;
  message: string;
  remediation: string;
  retryable: boolean;
} {
  return {
    code: error.code,
    message: error.userMessage,
    remediation: error.remediation,
    retryable: error.retryable
  };
}
