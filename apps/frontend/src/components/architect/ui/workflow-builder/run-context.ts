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
    timeZone: getRunTextFromRecord(calendarAppointment, "timeZone"),
    status: getRunTextFromRecord(calendarAppointment, "status"),
    htmlLink: getRunTextFromRecord(calendarAppointment, "htmlLink"),
    testEventId: getRunTextFromRecord(calendarAppointment, "testEventId"),
    errorCode: getRunTextFromRecord(calendarAppointment, "errorCode"),
    remediation: getRunTextFromRecord(calendarAppointment, "remediation")
  };
}

export type CalendlyResultField = { label: string; value: string };
export type CalendlyResultItem = { title: string; detail?: string };

export type CalendlyResultView = {
  event: string;
  calendlyEvent: string;
  action: string;
  actionLabel: string;
  inviteeName: string;
  inviteeEmail: string;
  meetingName: string;
  startTime: string;
  endTime: string;
  eventUri: string;
  summary: string;
  fields: CalendlyResultField[];
  items: CalendlyResultItem[];
};

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickText(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function formatCalendlyActionLabel(action: string): string {
  if (!action) return "Calendly action";
  return action
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCalendlyInstant(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return value;
  }
}

function locationLabel(record: Record<string, unknown> | null): string {
  if (!record) return "";
  const location = asPlainRecord(record.location);
  if (location) {
    return (
      pickText(location, ["location", "join_url", "status"]) ||
      pickText(location, ["type"]) ||
      ""
    );
  }
  return pickText(record, ["location"]);
}

function pushField(fields: CalendlyResultField[], label: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return;
  if (fields.some((field) => field.label === label && field.value === trimmed)) return;
  fields.push({ label, value: trimmed });
}

function fieldsFromResource(resource: Record<string, unknown> | null): CalendlyResultField[] {
  const fields: CalendlyResultField[] = [];
  if (!resource) return fields;

  pushField(fields, "Name", pickText(resource, ["name", "full_name"]));
  pushField(fields, "Email", pickText(resource, ["email"]));
  pushField(fields, "Status", pickText(resource, ["status"]));
  pushField(fields, "Starts", formatCalendlyInstant(pickText(resource, ["start_time", "startTime"])));
  pushField(fields, "Ends", formatCalendlyInstant(pickText(resource, ["end_time", "endTime"])));
  pushField(fields, "Timezone", pickText(resource, ["timezone", "time_zone"]));
  pushField(fields, "Duration", pickText(resource, ["duration", "duration_minutes"]));
  pushField(fields, "Meeting", pickText(resource, ["event_type", "meeting_type"]));
  pushField(fields, "Location", locationLabel(resource));
  pushField(
    fields,
    "Booking link",
    pickText(resource, ["booking_url", "scheduling_url", "join_url", "url"]).replace(
      /^https:\/\/api\.calendly\.com\/.*/i,
      ""
    )
  );
  pushField(fields, "Invitee", pickText(resource, ["invitee"]));

  if (Array.isArray(resource.event_memberships)) {
    const first = asPlainRecord(resource.event_memberships[0]);
    pushField(fields, "Host", pickText(first, ["user_name", "user_email", "user"]));
  }

  return fields;
}

function itemsFromCollection(collection: unknown[]): CalendlyResultItem[] {
  return collection.slice(0, 8).map((entry, index) => {
    const record = asPlainRecord(entry);
    const nested = asPlainRecord(record?.resource) ?? record;
    const title =
      pickText(nested, ["name", "email", "start_time", "booking_url", "scheduling_url"]) ||
      `Item ${index + 1}`;
    const detailParts = [
      pickText(nested, ["email"]),
      formatCalendlyInstant(pickText(nested, ["start_time", "startTime"])),
      pickText(nested, ["status"]),
      pickText(nested, ["duration", "duration_minutes"])
        ? `${pickText(nested, ["duration", "duration_minutes"])} min`
        : ""
    ].filter((part) => part && part !== title);
    return {
      title: title.includes("T") && title.includes(":") ? formatCalendlyInstant(title) || title : title,
      detail: detailParts.length > 0 ? detailParts.join(" · ") : undefined
    };
  });
}

function summarizeCalendlyActionResult(action: string, result: unknown): {
  summary: string;
  fields: CalendlyResultField[];
  items: CalendlyResultItem[];
} {
  if (typeof result === "string") {
    return { summary: result, fields: [], items: [] };
  }
  if (result == null) {
    return { summary: "Calendly action completed.", fields: [], items: [] };
  }

  const root = asPlainRecord(result);
  const resource = asPlainRecord(root?.resource) ?? (root && !Array.isArray(root.collection) ? root : null);
  const collection = Array.isArray(root?.collection)
    ? root.collection
    : Array.isArray(root?.available_times)
      ? root.available_times
      : Array.isArray(result)
        ? result
        : [];

  const fields = fieldsFromResource(resource);
  const items = itemsFromCollection(collection);

  let summary = `${formatCalendlyActionLabel(action)} completed.`;
  if (items.length > 0) {
    const total =
      typeof root?.pagination === "object" && root.pagination !== null
        ? Number((root.pagination as Record<string, unknown>).count)
        : Number.NaN;
    const countLabel = Number.isFinite(total) && total > items.length ? total : collection.length;
    summary =
      action === "find_available_times"
        ? `${countLabel} available time${countLabel === 1 ? "" : "s"} found.`
        : `${countLabel} result${countLabel === 1 ? "" : "s"} found.`;
  } else if (fields.length > 0) {
    const name = fields.find((field) => field.label === "Name")?.value;
    const status = fields.find((field) => field.label === "Status")?.value;
    const link = fields.find((field) => field.label === "Booking link")?.value;
    if (name && status) summary = `${name} · ${status}`;
    else if (name) summary = name;
    else if (link) summary = "Scheduling link ready.";
    else if (status) summary = `Status: ${status}`;
  }

  return { summary, fields, items };
}

export function getCalendlyResult(context: Record<string, unknown>): CalendlyResultView | null {
  const calendly = getRunRecord(context, "calendly");
  if (!calendly) return null;

  const invitee =
    typeof calendly.invitee === "object" && calendly.invitee !== null
      ? (calendly.invitee as Record<string, unknown>)
      : null;
  const scheduledEvent =
    typeof calendly.scheduledEvent === "object" && calendly.scheduledEvent !== null
      ? (calendly.scheduledEvent as Record<string, unknown>)
      : null;
  const action = getRunTextFromRecord(calendly, "action");
  const summarized = summarizeCalendlyActionResult(action, calendly.result);

  return {
    event: getRunTextFromRecord(calendly, "event"),
    calendlyEvent: getRunTextFromRecord(calendly, "calendlyEvent"),
    action,
    actionLabel: formatCalendlyActionLabel(action),
    inviteeName: invitee ? getRunTextFromRecord(invitee, "name") : "",
    inviteeEmail: invitee ? getRunTextFromRecord(invitee, "email") : "",
    meetingName: scheduledEvent ? getRunTextFromRecord(scheduledEvent, "name") : "",
    startTime: scheduledEvent ? getRunTextFromRecord(scheduledEvent, "start_time") : "",
    endTime: scheduledEvent ? getRunTextFromRecord(scheduledEvent, "end_time") : "",
    eventUri: scheduledEvent ? getRunTextFromRecord(scheduledEvent, "uri") : "",
    summary: summarized.summary,
    fields: summarized.fields,
    items: summarized.items
  };
}

export type NodeResultField = { label: string; value: string };

function isIdLikeKey(key: string): boolean {
  const normalized = key.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) return false;
  if (normalized === "id" || normalized === "uuid" || normalized === "uri") return true;
  if (normalized.endsWith("id") || normalized.endsWith("uuid") || normalized.endsWith("uri")) return true;
  if (normalized.includes("uuid") || normalized.includes("eventuri") || normalized.includes("inviteeuri")) {
    return true;
  }
  return false;
}

function isIdLikeValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^SAMPLE[_-]/i.test(trimmed)) return true;
  if (/^https?:\/\/api\.calendly\.com\//i.test(trimmed)) return true;
  // UUID / long opaque ids
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function stringifyOutputValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    if (value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
      return value.map(String).join(", ");
    }
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  const record = asPlainRecord(value);
  if (!record) return "";
  const named = pickText(record, ["name", "email", "status", "summary", "title", "url"]);
  if (named) return named;
  const keyCount = Object.keys(record).length;
  return keyCount > 0 ? `${keyCount} fields` : "";
}

/** Flatten a node log `output` into readable label/value rows for the Test panel. */
export function formatRunLogOutputFields(output: unknown): NodeResultField[] {
  if (output == null) return [];
  if (typeof output === "string" || typeof output === "number" || typeof output === "boolean") {
    const value = String(output).trim();
    return value ? [{ label: "Result", value }] : [];
  }

  const record = asPlainRecord(output);
  if (!record) {
    if (Array.isArray(output)) {
      const items = itemsFromCollection(output);
      return items.map((item, index) => ({
        label: `Item ${index + 1}`,
        value: item.detail ? `${item.title} — ${item.detail}` : item.title
      }));
    }
    return [];
  }

  // Calendly action logs wrap the API payload as `{ result }`.
  if ("result" in record && Object.keys(record).length <= 2) {
    const action = typeof record.action === "string" ? record.action : "";
    const summarized = summarizeCalendlyActionResult(action, record.result);
    const fields: NodeResultField[] = [];
    if (summarized.summary && !isIdLikeValue(summarized.summary)) {
      fields.push({ label: "Summary", value: summarized.summary });
    }
    for (const field of summarized.fields) {
      if (isIdLikeKey(field.label) || isIdLikeValue(field.value)) continue;
      fields.push(field);
    }
    for (const [index, item] of summarized.items.entries()) {
      const value = item.detail ? `${item.title} — ${item.detail}` : item.title;
      if (isIdLikeValue(value)) continue;
      fields.push({
        label: `Item ${index + 1}`,
        value
      });
    }
    if (fields.length > 0) return fields;
  }

  const fields: NodeResultField[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key === "raw" || key === "dryRun") continue;
    if (isIdLikeKey(key)) continue;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const nested = asPlainRecord(value);
      if (nested) {
        for (const [nestedKey, nestedValue] of Object.entries(nested)) {
          if (isIdLikeKey(nestedKey)) continue;
          const nestedText = stringifyOutputValue(nestedValue);
          if (!nestedText || nestedText.endsWith(" fields") || isIdLikeValue(nestedText)) continue;
          fields.push({ label: humanizeKey(nestedKey), value: nestedText });
        }
        continue;
      }
    }
    const text = stringifyOutputValue(value);
    if (!text || isIdLikeValue(text)) continue;
    fields.push({ label: humanizeKey(key), value: text });
  }
  return fields
    .filter((field) => !isIdLikeKey(field.label) && !isIdLikeValue(field.value))
    .slice(0, 12);
}
