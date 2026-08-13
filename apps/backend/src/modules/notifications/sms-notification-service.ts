import type { Prisma, SmsExecution, SmsExecutionStatus, SmsMessageType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  TwilioSmsError,
  sendTwilioSms,
  validateSmsRecipientE164
} from "../architect/twilio-connector";
import {
  canSendTransactionalSms,
  maskPhone,
  messagingProgramForMessageType,
  type SmsConsentDenialReason
} from "./sms-consent";
import {
  formatTransactionalSms,
  isApprovedSmsPurpose,
  smsAttributionPrefix,
  type TransactionalSmsPurpose
} from "./sms-format";

export type AppointmentConfirmationInput = {
  appointmentId: string;
  businessId: string;
  installedAgentId?: string | null;
  /** Provider call id when the booking happened during a voice call. */
  vapiCallId?: string | null;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  appointmentDate: Date | string;
  appointmentTime?: string;
  timeZone: string;
};

export type SmsSendOutcome = {
  attempted: boolean;
  sent: boolean;
  simulated: boolean;
  /** True when the send used Twilio TEST credentials (accepted, never delivered). */
  testCredentials: boolean;
  /** True when the dedupe key matched an existing execution — nothing was re-sent. */
  alreadySent: boolean;
  suppressed: boolean;
  executionId: string | null;
  messageSid: string | null;
  status: string | null;
  from: string | null;
  messagingServiceSid: string | null;
  error: string | null;
  errorCode: string | null;
};

export function appointmentConfirmationDedupeKey(appointmentId: string): string {
  return `appointment-confirmation:${appointmentId}`;
}

/** Map a Twilio message status string onto the SmsExecutionStatus enum. */
export function smsExecutionStatusFromTwilio(status: string | null | undefined): SmsExecutionStatus {
  switch ((status ?? "").toLowerCase()) {
    case "accepted":
      return "ACCEPTED";
    case "queued":
      return "QUEUED";
    case "sending":
      return "SENDING";
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "undelivered":
      return "UNDELIVERED";
    case "failed":
      return "FAILED";
    case "simulated":
      return "SIMULATED";
    default:
      return "QUEUED";
  }
}

function outcomeFromExecution(
  execution: SmsExecution,
  alreadySent: boolean,
  testCredentials = false
): SmsSendOutcome {
  const failed = execution.status === "FAILED" || execution.status === "UNDELIVERED";
  const suppressed = execution.status === "SUPPRESSED";
  return {
    attempted: !suppressed,
    sent: !failed && !suppressed && (Boolean(execution.messageSid) || execution.status === "SIMULATED"),
    simulated: execution.status === "SIMULATED",
    testCredentials,
    alreadySent,
    suppressed,
    executionId: execution.id,
    messageSid: execution.messageSid,
    status: execution.status,
    from: execution.fromPhone,
    messagingServiceSid: execution.messagingServiceSid,
    error: failed || suppressed ? execution.errorMessage : null,
    errorCode: failed || suppressed ? execution.errorCode : null
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

export type TrackedSmsInput = {
  to: string;
  body: string;
  messageType: SmsMessageType;
  businessId?: string | null;
  installedAgentId?: string | null;
  appointmentId?: string | null;
  vapiCallId?: string | null;
  businessName?: string | null;
  smsPurpose?: TransactionalSmsPurpose;
  dedupeKey?: string | null;
};

export function smsDenialDetail(reason: SmsConsentDenialReason): {
  code: string;
  message: string;
} {
  switch (reason) {
    case "SMS_OPTED_OUT":
      return {
        code: "SMS_OPTED_OUT",
        message: "Recipient has opted out of this business's SMS program."
      };
    case "MISSING_BUSINESS":
      return {
        code: "SMS_BUSINESS_UNRESOLVED",
        message:
          "No business is attached to this send, so SMS consent could not be checked. The Twilio number that received the call must resolve to a business (BusinessPhoneNumber or PlatformPhoneNumber → Business)."
      };
    case "INVALID_PHONE":
      return {
        code: "SMS_INVALID_RECIPIENT",
        message: "Recipient number is not a valid E.164 mobile number."
      };
    default:
      return {
        code: "SMS_CONSENT_REQUIRED",
        message: "No affirmative SMS consent on record for this business and recipient."
      };
  }
}

export async function sendTrackedSms(input: TrackedSmsInput): Promise<SmsSendOutcome> {
  const recipient = validateSmsRecipientE164(input.to);
  if (!recipient.ok) {
    return {
      attempted: false,
      sent: false,
      simulated: false,
      testCredentials: false,
      alreadySent: false,
      suppressed: false,
      executionId: null,
      messageSid: null,
      status: null,
      from: null,
      messagingServiceSid: null,
      error: recipient.error,
      errorCode: "SMS_INVALID_RECIPIENT"
    };
  }
  const to = recipient.e164;

  const messagingProgram = messagingProgramForMessageType(input.messageType);
  if (messagingProgram) {
    const authorization = await canSendTransactionalSms({
      businessId: input.businessId ?? null,
      phoneNumber: to,
      messagingProgram
    });
    if (!authorization.allowed) {
      const { code: reason, message: reasonMessage } = smsDenialDetail(authorization.reason);
      const suppressedExecution = await prisma.smsExecution.create({
        data: {
          businessId: input.businessId ?? null,
          installedAgentId: input.installedAgentId ?? null,
          appointmentId: input.appointmentId ?? null,
          vapiCallId: input.vapiCallId ?? null,
          messageType: input.messageType,
          toPhone: to,
          body: input.body,
          status: "SUPPRESSED",
          errorCode: reason,
          errorMessage: reasonMessage,
          failedAt: new Date()
        }
      });
      console.info("[sms-consent] send suppressed", {
        executionId: suppressedExecution.id,
        messageType: input.messageType,
        businessId: input.businessId ?? null,
        to: maskPhone(to),
        reason
      });
      return outcomeFromExecution(suppressedExecution, false);
    }
  }

  let body = input.body;
  if (messagingProgram) {
    const formatted = isApprovedSmsPurpose(input.smsPurpose)
      ? formatTransactionalSms({ body: input.body, businessName: input.businessName })
      : ({
          ok: false,
          code: "SMS_PURPOSE_NOT_ALLOWED",
          reason: `purpose "${String(input.smsPurpose ?? "missing")}" is not an approved transactional campaign purpose`
        } as const);
    if (!formatted.ok) {
      const suppressedExecution = await prisma.smsExecution.create({
        data: {
          businessId: input.businessId ?? null,
          installedAgentId: input.installedAgentId ?? null,
          appointmentId: input.appointmentId ?? null,
          vapiCallId: input.vapiCallId ?? null,
          messageType: input.messageType,
          toPhone: to,
          body: input.body,
          status: "SUPPRESSED",
          errorCode: formatted.code,
          errorMessage: `Message blocked by the transactional-campaign purpose guard (${formatted.reason}).`,
          failedAt: new Date()
        }
      });
      console.warn("[sms-format] send suppressed (purpose guard)", {
        executionId: suppressedExecution.id,
        messageType: input.messageType,
        businessId: input.businessId ?? null,
        to: maskPhone(to),
        reason: formatted.reason
      });
      return outcomeFromExecution(suppressedExecution, false);
    }
    body = formatted.body;
  }

  let execution: SmsExecution;
  try {
    execution = await prisma.smsExecution.create({
      data: {
        businessId: input.businessId ?? null,
        installedAgentId: input.installedAgentId ?? null,
        appointmentId: input.appointmentId ?? null,
        vapiCallId: input.vapiCallId ?? null,
        dedupeKey: input.dedupeKey ?? null,
        messageType: input.messageType,
        toPhone: to,
        body,
        status: "QUEUED",
        queuedAt: new Date()
      }
    });
  } catch (error) {
    if (input.dedupeKey && isUniqueConstraintError(error)) {
      const existing = await prisma.smsExecution.findUnique({ where: { dedupeKey: input.dedupeKey } });
      if (existing) return outcomeFromExecution(existing, true);
    }
    throw error;
  }

  try {
    const result = await sendTwilioSms({ to, body });
    const updated = await prisma.smsExecution.update({
      where: { id: execution.id },
      data: {
        messageSid: result.messageSid,
        messagingServiceSid: result.messagingServiceSid,
        fromPhone: result.from,
        status: result.simulated ? "SIMULATED" : smsExecutionStatusFromTwilio(result.status),
        numSegments: result.numSegments,
        ...(result.status === "sent" ? { sentAt: new Date() } : {})
      }
    });
    return outcomeFromExecution(updated, false, result.testCredentials);
  } catch (error) {
    const twilioError = error instanceof TwilioSmsError ? error : null;
    const message = error instanceof Error ? error.message : "Twilio SMS failed";
    const failed = await prisma.smsExecution
      .update({
        where: { id: execution.id },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          errorCode: twilioError?.twilioCode != null ? String(twilioError.twilioCode) : null,
          errorMessage: message.slice(0, 500)
        }
      })
      .catch(() => null);
    console.error("[sms-notification] send failed", {
      executionId: execution.id,
      messageType: input.messageType,
      twilioCode: twilioError?.twilioCode ?? null,
      httpStatus: twilioError?.httpStatus ?? null
    });
    return {
      attempted: true,
      sent: false,
      simulated: false,
      testCredentials: false,
      alreadySent: false,
      suppressed: false,
      executionId: (failed ?? execution).id,
      messageSid: null,
      status: "FAILED",
      from: null,
      messagingServiceSid: null,
      error: message,
      errorCode: twilioError?.twilioCode != null ? String(twilioError.twilioCode) : null
    };
  }
}

/* ----------------------- appointment confirmation ------------------------- */

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatDateInZone(date: Date, timeZone: string): string {
  try {
    return date.toLocaleDateString("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  } catch {
    return date.toDateString();
  }
}

function formatTimeInZone(date: Date, timeZone: string): string {
  try {
    return date.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  } catch {
    return date.toTimeString().slice(0, 5);
  }
}

// --------------- appointment confirmation SMS template ----------------

export type AppointmentConfirmationTemplateValues = {
  customerName: string;
  businessName: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  businessPhone: string;
};


// --------------- appointment SMS template ----------------
function renderAppointmentSmsLines(
  values: AppointmentConfirmationTemplateValues,
  actionPhrase: string
): string {
  const service = values.serviceName && values.serviceName !== "your" ? `${values.serviceName} ` : "";
  const lines = [
    `${smsAttributionPrefix(values.businessName)}Hi ${values.customerName}, your ${service}appointment ${actionPhrase} ${values.appointmentDate} at ${values.appointmentTime}.`
  ];
  if (values.businessPhone) {
    lines.push(`For assistance call ${values.businessPhone}.`);
  }
  lines.push("Reply STOP to opt out or HELP for assistance. Msg & data rates may apply.");
  return lines.join("\n");
}

export function renderAppointmentConfirmationSms(values: AppointmentConfirmationTemplateValues): string {
  return renderAppointmentSmsLines(values, "is confirmed for");
}

export function renderAppointmentCancellationSms(values: AppointmentConfirmationTemplateValues): string {
  return renderAppointmentSmsLines(values, "has been cancelled for");
}

export function renderAppointmentRescheduleSms(values: AppointmentConfirmationTemplateValues): string {
  return renderAppointmentSmsLines(values, "has been rescheduled for");
}

async function resolveBusinessDisplayPhone(
  businessId: string,
  installedAgentId?: string | null
): Promise<string> {
  if (installedAgentId) {
    const own = await prisma.businessPhoneNumber.findFirst({
      where: { businessId, installedAgentId, isActive: true },
      select: { phoneNumber: true }
    });
    if (own?.phoneNumber) return own.phoneNumber;
  }

  const active = await prisma.businessPhoneNumber.findFirst({
    where: { businessId, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { phoneNumber: true }
  });
  if (active?.phoneNumber) return active.phoneNumber;

  const platform = await prisma.platformPhoneNumber.findFirst({
    where: { businessId, status: "ASSIGNED", isPlatformSmsSender: false },
    orderBy: { assignedAt: "desc" },
    select: { phoneNumber: true }
  });
  if (platform?.phoneNumber) return platform.phoneNumber;

  const profile = await prisma.businessProfile.findUnique({
    where: { businessId },
    select: { teamPhone: true }
  });
  return profile?.teamPhone ?? "";
}

export async function sendAppointmentConfirmationSms(
  input: AppointmentConfirmationInput
): Promise<SmsSendOutcome> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    include: { profile: { select: { timeZone: true } } }
  });
  if (!business) {
    return {
      attempted: false,
      sent: false,
      simulated: false,
      testCredentials: false,
      alreadySent: false,
      suppressed: false,
      executionId: null,
      messageSid: null,
      status: null,
      from: null,
      messagingServiceSid: null,
      error: "Business not found for appointment confirmation.",
      errorCode: null
    };
  }

  const timeZone = input.timeZone || business.profile?.timeZone || "America/New_York";
  const startAt = toDate(input.appointmentDate);
  const businessPhone = await resolveBusinessDisplayPhone(input.businessId, input.installedAgentId);

  const body = renderAppointmentConfirmationSms({
    customerName: input.customerName || "there",
    businessName: business.name,
    serviceName: input.serviceName || "your",
    appointmentDate: formatDateInZone(startAt, timeZone),
    appointmentTime: input.appointmentTime || formatTimeInZone(startAt, timeZone),
    businessPhone
  });

  return sendTrackedSms({
    to: input.customerPhone,
    body,
    messageType: "APPOINTMENT_CONFIRMATION",
    businessId: input.businessId,
    businessName: business.name,
    smsPurpose: "APPOINTMENT_CONFIRMATION",
    installedAgentId: input.installedAgentId ?? null,
    appointmentId: input.appointmentId,
    vapiCallId: input.vapiCallId ?? null,
    dedupeKey: appointmentConfirmationDedupeKey(input.appointmentId)
  });
}

export type DashboardAppointmentNotificationInput = {
  appointmentId: string;
  businessId: string;
  customerPhone: string;
  customerName?: string | null;
  serviceName?: string | null;
  appointmentDate: Date | string;
  appointmentTime?: string;
  timeZone?: string | null;
  reason?: string;
  installedAgentId?: string | null;
};

export async function sendAppointmentDashboardCancellationSms(
  input: DashboardAppointmentNotificationInput
): Promise<SmsSendOutcome> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    include: { profile: { select: { timeZone: true } } }
  });
  if (!business) {
    return {
      attempted: false,
      sent: false,
      simulated: false,
      testCredentials: false,
      alreadySent: false,
      suppressed: false,
      executionId: null,
      messageSid: null,
      status: null,
      from: null,
      messagingServiceSid: null,
      error: "Business not found for appointment cancellation.",
      errorCode: null
    };
  }

  const timeZone = input.timeZone || business.profile?.timeZone || "America/New_York";
  const startAt = toDate(input.appointmentDate);
  const businessPhone = await resolveBusinessDisplayPhone(input.businessId, input.installedAgentId);
  const dateStr = formatDateInZone(startAt, timeZone);
  const timeStr = input.appointmentTime || formatTimeInZone(startAt, timeZone);
  const service = input.serviceName && input.serviceName !== "your" ? `${input.serviceName} ` : "";
  const customerName = input.customerName || "there";

  const lines = [
    `${smsAttributionPrefix(business.name)}Hi ${customerName}, your ${service}appointment on ${dateStr} at ${timeStr} has been cancelled.`
  ];
  if (input.reason?.trim()) {
    lines.push(`Reason: ${input.reason.trim()}`);
  }
  if (businessPhone) {
    lines.push(`To reschedule, please call ${businessPhone}.`);
  }
  lines.push("Reply STOP to opt out or HELP for assistance. Msg & data rates may apply.");

  return sendTrackedSms({
    to: input.customerPhone,
    body: lines.join("\n"),
    messageType: "APPOINTMENT_CANCELLATION",
    businessId: input.businessId,
    businessName: business.name,
    smsPurpose: "CANCELLATION_CONFIRMATION",
    installedAgentId: input.installedAgentId ?? null,
    appointmentId: input.appointmentId
  });
}

export async function sendAppointmentDashboardRescheduleRequestSms(
  input: DashboardAppointmentNotificationInput
): Promise<SmsSendOutcome> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    include: { profile: { select: { timeZone: true } } }
  });
  if (!business) {
    return {
      attempted: false,
      sent: false,
      simulated: false,
      testCredentials: false,
      alreadySent: false,
      suppressed: false,
      executionId: null,
      messageSid: null,
      status: null,
      from: null,
      messagingServiceSid: null,
      error: "Business not found for appointment reschedule request.",
      errorCode: null
    };
  }

  const timeZone = input.timeZone || business.profile?.timeZone || "America/New_York";
  const startAt = toDate(input.appointmentDate);
  const businessPhone = await resolveBusinessDisplayPhone(input.businessId, input.installedAgentId);
  const dateStr = formatDateInZone(startAt, timeZone);
  const timeStr = input.appointmentTime || formatTimeInZone(startAt, timeZone);
  const service = input.serviceName && input.serviceName !== "your" ? `${input.serviceName} ` : "";
  const customerName = input.customerName || "there";

  const lines = [
    `${smsAttributionPrefix(business.name)}Hi ${customerName}, we need to reschedule your ${service}appointment on ${dateStr} at ${timeStr}.`
  ];
  if (input.reason?.trim()) {
    lines.push(`Note: ${input.reason.trim()}`);
  }
  if (businessPhone) {
    lines.push(`Please call us at ${businessPhone} to pick a new time slot.`);
  } else {
    lines.push("Please contact us to pick a new time slot.");
  }
  lines.push("Reply STOP to opt out or HELP for assistance. Msg & data rates may apply.");

  return sendTrackedSms({
    to: input.customerPhone,
    body: lines.join("\n"),
    messageType: "APPOINTMENT_RESCHEDULE",
    businessId: input.businessId,
    businessName: business.name,
    smsPurpose: "RESCHEDULE_REQUEST",
    installedAgentId: input.installedAgentId ?? null,
    appointmentId: input.appointmentId
  });
}


/* ---------------------- delivery status (webhook) ------------------------- */

export type TwilioStatusCallbackParams = {
  MessageSid?: string;
  MessageStatus?: string;
  SmsStatus?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  From?: string;
  To?: string;
  NumSegments?: string;
  Price?: string;
  PriceUnit?: string;
};

/** Forward-only ranking so late/out-of-order callbacks never downgrade state. */
const STATUS_RANK: Record<SmsExecutionStatus, number> = {
  QUEUED: 1,
  ACCEPTED: 1,
  SENDING: 2,
  SENT: 3,
  SIMULATED: 3,
  DELIVERED: 4,
  UNDELIVERED: 4,
  FAILED: 4,
  SUPPRESSED: 5
};

const TERMINAL_SMS_STATUSES: ReadonlySet<SmsExecutionStatus> = new Set([
  "DELIVERED",
  "UNDELIVERED",
  "FAILED",
  "SUPPRESSED"
]);

/** micro-USD from a Twilio price string (prices arrive negative, e.g. "-0.0079"). */
function priceToMicroUsd(price: string | undefined): number | null {
  const parsed = Number(price);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(Math.abs(parsed) * 1_000_000);
}

export async function applyTwilioMessageStatus(
  params: TwilioStatusCallbackParams
): Promise<{ ok: boolean; executionId: string | null; status: string | null }> {
  const messageSid = (params.MessageSid ?? "").trim();
  const rawStatus = (params.MessageStatus ?? params.SmsStatus ?? "").trim();
  if (!messageSid || !rawStatus) return { ok: false, executionId: null, status: null };

  const execution = await prisma.smsExecution.findUnique({ where: { messageSid } });
  if (!execution) {
    console.warn("[sms-status] callback for unknown MessageSid — ignored", { messageSid, status: rawStatus });
    return { ok: true, executionId: null, status: rawStatus };
  }

  const nextStatus = smsExecutionStatusFromTwilio(rawStatus);
  const moveForward =
    !TERMINAL_SMS_STATUSES.has(execution.status) &&
    STATUS_RANK[nextStatus] >= STATUS_RANK[execution.status];
  const now = new Date();
  const isFailure = nextStatus === "FAILED" || nextStatus === "UNDELIVERED";
  const enrichFailure = isFailure && (moveForward || nextStatus === execution.status);

  const data: Prisma.SmsExecutionUpdateInput = {
    ...(moveForward ? { status: nextStatus } : {}),
    ...(moveForward && nextStatus === "SENT" && !execution.sentAt ? { sentAt: now } : {}),
    ...(moveForward && nextStatus === "DELIVERED"
      ? { ...(execution.sentAt ? {} : { sentAt: now }), ...(execution.deliveredAt ? {} : { deliveredAt: now }) }
      : {}),
    ...(enrichFailure
      ? {
          ...(execution.failedAt ? {} : { failedAt: now }),
          errorCode: params.ErrorCode?.trim() || execution.errorCode,
          errorMessage: params.ErrorMessage?.trim() || execution.errorMessage
        }
      : {}),
    ...(params.From && !execution.fromPhone ? { fromPhone: params.From } : {}),
    ...(params.NumSegments && Number.isFinite(Number(params.NumSegments))
      ? { numSegments: Number(params.NumSegments) }
      : {})
  };

  const cost = priceToMicroUsd(params.Price);
  if (cost !== null) {
    data.providerCostMicroUsd = cost;
    data.currency = params.PriceUnit?.trim() || execution.currency || "USD";
  }

  const updated = await prisma.smsExecution.update({ where: { id: execution.id }, data });
  return { ok: true, executionId: updated.id, status: updated.status };
}

