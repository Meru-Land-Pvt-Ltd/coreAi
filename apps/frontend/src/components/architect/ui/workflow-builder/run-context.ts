import type { WorkflowRunLog } from "@/components/architect/features/types";

function getRunRecord(context: Record<string, unknown>, key: string) {
  const value = context[key];
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function getRunTextFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

export function logColor(status: WorkflowRunLog["status"]) {
  if (status === "error") return "text-red-300";
  if (status === "waiting") return "text-amber-300";
  return "text-green-300";
}

export function getSentSms(context: Record<string, unknown>) {
  const sentSms = getRunRecord(context, "sentSms");
  if (!sentSms) return null;

  return {
    to: getRunTextFromRecord(sentSms, "to"),
    body: getRunTextFromRecord(sentSms, "body"),
    id: getRunTextFromRecord(sentSms, "id"),
    mode: getRunTextFromRecord(sentSms, "mode"),
    providerCalled: Boolean(sentSms.providerCalled),
    twilioTestMode: Boolean(sentSms.twilioTestMode)
  };
}

export function getCapturedLead(context: Record<string, unknown>) {
  const capturedLead = getRunRecord(context, "capturedLead");
  if (!capturedLead) return null;

  return {
    callerNumber: getRunTextFromRecord(capturedLead, "callerNumber"),
    callerName: getRunTextFromRecord(capturedLead, "callerName"),
    businessName: getRunTextFromRecord(capturedLead, "businessName"),
    status: getRunTextFromRecord(capturedLead, "status")
  };
}

export function getDraftEmail(context: Record<string, unknown>) {
  const draftEmail = getRunRecord(context, "draftEmail");
  if (!draftEmail) return null;

  return {
    id: getRunTextFromRecord(draftEmail, "id"),
    to: getRunTextFromRecord(draftEmail, "to"),
    subject: getRunTextFromRecord(draftEmail, "subject"),
    body: getRunTextFromRecord(draftEmail, "body")
  };
}

export function getSentEmail(context: Record<string, unknown>) {
  const sentEmail = getRunRecord(context, "sentEmail");
  if (!sentEmail) return null;

  return {
    id: getRunTextFromRecord(sentEmail, "id"),
    to: getRunTextFromRecord(sentEmail, "to"),
    subject: getRunTextFromRecord(sentEmail, "subject"),
    body: getRunTextFromRecord(sentEmail, "body")
  };
}

export function getGmailRead(context: Record<string, unknown>) {
  const gmail = getRunRecord(context, "gmail");
  if (!gmail) return null;

  return {
    senderEmail: getRunTextFromRecord(gmail, "senderEmail"),
    subject: getRunTextFromRecord(gmail, "subject"),
    body: getRunTextFromRecord(gmail, "body")
  };
}

export function getVapiCall(context: Record<string, unknown>) {
  const vapiCall = getRunRecord(context, "vapiCall");
  if (!vapiCall) return null;

  return {
    id: getRunTextFromRecord(vapiCall, "id"),
    status: getRunTextFromRecord(vapiCall, "status"),
    customerPhone: getRunTextFromRecord(vapiCall, "customerPhone"),
    providerCalled: Boolean(vapiCall.providerCalled)
  };
}

export function getCalendarAppointment(context: Record<string, unknown>) {
  const calendarAppointment = getRunRecord(context, "calendarAppointment");
  if (!calendarAppointment) return null;

  return {
    id: getRunTextFromRecord(calendarAppointment, "id"),
    calendarId: getRunTextFromRecord(calendarAppointment, "calendarId"),
    summary: getRunTextFromRecord(calendarAppointment, "summary"),
    startAt: getRunTextFromRecord(calendarAppointment, "startAt"),
    endAt: getRunTextFromRecord(calendarAppointment, "endAt"),
    timeZone: getRunTextFromRecord(calendarAppointment, "timeZone")
  };
}
