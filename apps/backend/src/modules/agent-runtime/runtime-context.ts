/**
 * Shared agent runtime context. One runtime powers the Architect browser call
 * test, the Business browser test, and the live Vapi/Twilio call flow —
 * only the provider adapters differ per mode.
 */

import { dateOnlyInZone, isValidTimeZone } from "@coreai/shared";

export type AgentRuntimeMode = "architect_test" | "business_test" | "live";

export type AgentChannel = "browser_voice" | "phone_call" | "sms";

export type AgentMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

export type AgentBusinessContext = {
  name: string;
  type: string;
  assistantName: string;
  timezone: string;
  calendarId: string;
  appointmentService: string;
  services: string[];
  faqs: string[];
  /** Business knowledge entries (manual + document-derived, shared format). */
  knowledge?: string[];
};

export type AgentCallerContext = {
  /** Identity on file (contact match / test context). Placeholders are not confirmed. */
  name: string;
  phone: string;
};

export type AgentRuntimeLog = {
  nodeId: string;
  label: string;
  status: "success" | "waiting" | "error" | "skipped";
  message: string;
  output?: unknown;
};

export type AgentToolCall = {
  name: string;
  status: "simulated" | "skipped" | "error";
  message: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
};


export type AgentConversationState = {
  /** The caller is trying to schedule something (any wording). */
  schedulingIntent: boolean;
  /** The CURRENT message moves the active flow forward (time/identity/scheduling words). */
  currentContributes: boolean;
  /** The current message closes the conversation. */
  ending: boolean;
  /** The current message asks a question. */
  isQuestion: boolean;
  /** The caller asked to receive something by text. */
  smsRequested: boolean;
  /** The caller pointed out their details were never collected. */
  detailsComplaint: boolean;
  /** The current message asks to leave a message for the team. */
  wantsMessage: boolean;
  /** The assistant just asked what message to pass along — this turn is the content. */
  messageFollowUp: boolean;
  /** Vague opener like "I want to know" with no actual question. */
  vagueQuestion: boolean;
  collectedName: string;
  collectedPhone: string;
  requestedService: string;
  requestedDate: string;
  /** Most recent user message mentioning a specific time, if any. */
  lastTimeMessage: string;
};

export type AgentTurnState = {
  bookedThisTurn: boolean;
  smsThisTurn: boolean;
  slotsOffered: boolean;
  /** Variables a blocked node still needs (from node metadata). */
  missingVariables: string[];
  endReached: boolean;
};

export type AgentRuntimeContext = {
  mode: AgentRuntimeMode;
  channel: AgentChannel;
  workflowId: string;
  currentNodeId: string;
  userMessage: string;
  history: AgentMessage[];
  /** Source of truth for data flowing between nodes. */
  variables: Record<string, unknown>;
  business: AgentBusinessContext;
  caller: AgentCallerContext;
  conversation: AgentConversationState;
  turn: AgentTurnState;
  executedNodes: AgentRuntimeLog[];
  toolCalls: AgentToolCall[];
};

export type NodeExecutionStatus = "executed" | "waiting" | "skipped" | "failed" | "ended";

export type NodeExecutionResult = {
  status: NodeExecutionStatus;
};

/* ------------------------------ small helpers ----------------------------- */

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function setVariables(context: AgentRuntimeContext, values: Record<string, unknown>): void {
  Object.assign(context.variables, values);
}

export function stringVariable(context: AgentRuntimeContext, key: string): string {
  const value = context.variables[key];

  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);

  return "";
}

export function hasVariable(context: AgentRuntimeContext, key: string): boolean {
  const value = context.variables[key];

  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;

  return true;
}

/* --------------------------- date/time utilities -------------------------- */

export function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** "YYYY-MM-DD" for `date` in the execution timezone; UTC only when no valid zone. */
export function dateOnlyInExecutionZone(date: Date, timeZone?: string): string {
  const zone = (timeZone ?? "").trim();
  return zone && isValidTimeZone(zone) ? dateOnlyInZone(date, zone) : dateOnly(date);
}

/** "2026-07-06 10:00 AM" -> "tomorrow at 10:00 AM" (relative in the execution timezone). */
export function humanSlotLabel(slot: string, timeZone?: string): string {
  const match = slot.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);

  if (!match) return slot;

  const datePart = match[1] ?? "";
  const timePart = (match[2] ?? "").replace(/^0(\d)/, "$1");
  const base = new Date();

  if (datePart === dateOnlyInExecutionZone(base, timeZone)) return `today at ${timePart}`;
  if (datePart === dateOnlyInExecutionZone(addDays(base, 1), timeZone)) return `tomorrow at ${timePart}`;
  if (datePart === dateOnlyInExecutionZone(addDays(base, 2), timeZone)) {
    return `the day after tomorrow at ${timePart}`;
  }

  const parsed = new Date(`${datePart}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) return slot;

  const dayLabel = parsed.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });

  return `${dayLabel} at ${timePart}`;
}

export function humanSlotList(slots: string[], timeZone?: string): string {
  const labels = slots.map((slot) => humanSlotLabel(slot, timeZone));

  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] ?? "";

  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}

export function mentionsSpecificTime(message: string): boolean {
  const text = message.toLowerCase();

  if (/\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/.test(text)) return true;
  if (/\b\d{1,2}:\d{2}\b/.test(text)) return true;
  if (/\b\d{1,2}\s*o'?\s*clock\b/.test(text)) return true;
  if (/\b(noon|midday|morning|afternoon|evening)\b/.test(text)) return true;
  if (/\b(the\s+)?(first|second|third|last|earliest|latest)\s+(one|slot|option|time)\b/.test(text)) return true;

  return false;
}

/**
 * Match the caller's chosen time against the offered slots. Returns "" when
 * there is no confident match so callers can fall back to the stated time.
 */
export function pickOfferedSlot(message: string, slots: string[]): string {
  const text = message.toLowerCase();

  const ordinal = text.match(/\b(first|second|third|last|earliest|latest)\b/)?.[1];

  if (ordinal === "first" || ordinal === "earliest") return slots[0] ?? "";
  if (ordinal === "second") return slots[1] ?? "";
  if (ordinal === "third") return slots[2] ?? "";
  if (ordinal === "last" || ordinal === "latest") return slots[slots.length - 1] ?? "";

  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/);

  if (timeMatch) {
    const needle = `${(timeMatch[1] ?? "").padStart(2, "0")}:${timeMatch[2] ?? "00"}`;
    const meridiem = timeMatch[3]?.replace(/\./g, "").toUpperCase();
    const found = slots.find(
      (slot) => slot.includes(needle) && (!meridiem || slot.toUpperCase().includes(meridiem))
    );

    if (found) return found;
  }

  if (/\bmorning\b/.test(text)) return slots.find((slot) => slot.includes("AM")) ?? "";
  if (/\b(afternoon|evening)\b/.test(text)) return slots.find((slot) => slot.includes("PM")) ?? "";

  return "";
}

/** "15:00" (24h form input) -> "3:00 PM"; "" when the value is not a valid HH:mm. */
export function timeLabelFrom24h(value: string): string {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return "";

  const hour = Number(match[1]);
  const minutes = match[2] ?? "00";

  if (hour > 23 || Number(minutes) > 59) return "";

  const meridiem = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  return `${hour12}:${minutes} ${meridiem}`;
}

/** "at 9 am" -> "9:00 AM"; used when the caller states a time not in the offered list. */
export function extractTimeLabel(message: string): string {
  const text = message.toLowerCase();
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/);

  if (match) {
    const hour = Number(match[1]);
    const minutes = match[2] ?? "00";
    const meridiem = (match[3] ?? "").replace(/\./g, "").toUpperCase();
    return `${hour}:${minutes} ${meridiem}`;
  }

  if (/\b(noon|midday)\b/.test(text)) return "12:00 PM";
  if (/\bmorning\b/.test(text)) return "10:00 AM";
  if (/\bafternoon\b/.test(text)) return "2:00 PM";
  if (/\bevening\b/.test(text)) return "5:00 PM";

  return "";
}

/* ------------------------- conversation inference ------------------------- */

const NAME_STOPWORDS = new Set([
  "calling", "looking", "interested", "trying", "here", "good", "fine", "great",
  "sorry", "sure", "asking", "wondering", "booking", "available", "not", "just",
  "gonna", "going", "hoping", "curious", "afraid", "happy", "the", "a", "an"
]);

export function extractName(text: string): string {
  const patterns = [
    /\bmy name(?:'s| is)\s+([a-z][a-z .'-]{1,40}?)(?=\s+and\b|[,.!?]|$)/i,
    /\bthis is\s+([a-z][a-z .'-]{1,40}?)(?=\s+and\b|\s+from\b|[,.!?]|$)/i,
    /\bi(?:'m| am)\s+([a-z][a-z .'-]{1,40}?)(?=\s+and\b|[,.!?]|$)/i
  ];

  for (const pattern of patterns) {
    const candidate = text.match(pattern)?.[1]?.trim() ?? "";

    if (!candidate) continue;

    const words = candidate.split(/\s+/).filter(Boolean);
    const firstWord = words[0]?.toLowerCase() ?? "";

    if (!firstWord || NAME_STOPWORDS.has(firstWord)) continue;

    return words
      .slice(0, 4)
      .map((word) => (word[0]?.toUpperCase() ?? "") + word.slice(1))
      .join(" ");
  }

  return "";
}

export function extractPhone(text: string): string {
  const match = text.match(/\+?\d[\d\s()\-]{6,18}\d/);

  if (!match) return "";

  const digits = match[0].replace(/[^\d]/g, "");

  if (digits.length < 7) return "";

  return match[0].trim().replace(/\s+/g, " ");
}

export function wantsScheduling(message: string): boolean {
  if (/\b(available|availability|slot|slots|open|free|appointment|schedule|book(ing|ed)?|reserve|reservation|today|tomorrow)\b/i.test(message)) {
    return true;
  }

  // "check any one time", "what times do you have", "any time that works"
  return /\bcheck\b[^.?!]*\btimes?\b|\bany\s+(one\s+)?times?\b|\btimes?\b[^.?!]*\b(available|free|open|work)/i.test(message);
}

/** The caller wants to leave a message for the team. */
export function wantsToLeaveMessage(message: string): boolean {
  return /\b(take|leave|pass|give)\s+(a\s+|the\s+|your\s+)?message\b|\bmessage\s+for\s+(the\s+)?team\b/i.test(message);
}

/** Vague "I want to know" style opener with no actual question yet. */
export function asksVagueQuestion(message: string): boolean {
  const text = message.toLowerCase().trim();
  return /^(i\s+(want|would like|need)\s+to\s+know|tell me|i have a question)[\s.!,]*$/.test(text);
}

export function wantsSmsMessage(message: string): boolean {
  return /\b(text|sms|send me|notify)\b/i.test(message);
}

export function wantsEnding(message: string): boolean {
  const text = message.toLowerCase().trim();

  if (/\b(bye|goodbye|see you|hang up|end (the )?(call|conversation))\b/.test(text)) return true;
  if (/\b(that'?s all|that is all|nothing else|no more questions|i'?m all set|i'?m done|we'?re done|all set)\b/.test(text)) return true;
  if (/^no[,.! ]*(thanks|thank you)?[,.! ]*$/.test(text)) return true;

  return /^(ok(ay)?[,.! ]*)?(thanks|thank you)( (so|very) much)?[,.! ]*$/.test(text);
}

export function isPureGreeting(message: string): boolean {
  return /^(hi|hello|hey|good (morning|afternoon|evening))[\s!.,]*$/i.test(message.trim());
}

export function asksQuestion(message: string): boolean {
  const text = message.trim().toLowerCase();

  return text.endsWith("?") || /^(what|where|when|who|how|why|do you|does|is there|are you|can you tell)\b/.test(text);
}

export function asksAboutMissingDetails(message: string): boolean {
  return /\b(why (didn'?t|did not) you ask|you (didn'?t|never) (ask|take)|without (asking|my details)|don'?t you need my)\b/i.test(message);
}

const DEFAULT_CALLER_NAMES = new Set(["test caller", "test patient", "caller", "customer", "patient"]);
const DEFAULT_CALLER_PHONES = new Set(["+15555550100", "+15555550123", "5555550100"]);

export function inferConversationState(params: {
  history: AgentMessage[];
  message: string;
  caller: AgentCallerContext;
  business: AgentBusinessContext;
}): AgentConversationState {
  const { history, message, caller, business } = params;
  const userMessages = [
    ...history.filter((item) => item.role === "user").map((item) => item.content),
    message
  ];

  let collectedName = "";
  let collectedPhone = "";
  let lastTimeMessage = "";
  let schedulingIntent = false;
  let smsRequested = false;
  let requestedService = "";
  // "today"/"tomorrow" are the caller's words — interpret them in the business
  // timezone, never the server's.
  const zone = business.timezone;
  let requestedDate = dateOnlyInExecutionZone(addDays(new Date(), 1), zone);

  for (const item of userMessages) {
    const name = extractName(item);
    const phone = extractPhone(item);

    if (name) collectedName = name;
    if (phone) collectedPhone = phone;
    if (mentionsSpecificTime(item)) lastTimeMessage = item;
    if (wantsScheduling(item)) schedulingIntent = true;
    if (wantsSmsMessage(item)) smsRequested = true;
    if (/\btoday\b/i.test(item)) requestedDate = dateOnlyInExecutionZone(new Date(), zone);
    else if (/\btomorrow\b/i.test(item)) requestedDate = dateOnlyInExecutionZone(addDays(new Date(), 1), zone);

    for (const service of business.services) {
      if (service && item.toLowerCase().includes(service.toLowerCase())) {
        requestedService = service;
      }
    }
  }

  // An architect/business-typed caller identity counts as a matched contact;
  // placeholder defaults never count as confirmed customer details.
  if (!collectedName && caller.name && !DEFAULT_CALLER_NAMES.has(caller.name.toLowerCase())) {
    collectedName = caller.name;
  }

  if (!collectedPhone && caller.phone && !DEFAULT_CALLER_PHONES.has(caller.phone)) {
    collectedPhone = caller.phone;
  }

  const currentContributes =
    wantsScheduling(message) ||
    mentionsSpecificTime(message) ||
    Boolean(extractName(message)) ||
    Boolean(extractPhone(message));

  // Message-taking flow: if the assistant just asked what to pass along, the
  // caller's current turn is the message content itself.
  const lastAssistant = [...history].reverse().find((item) => item.role === "assistant")?.content ?? "";
  const messageFollowUp =
    /what would you like me to pass along|what message would you like/i.test(lastAssistant) &&
    !wantsEnding(message);

  return {
    schedulingIntent,
    currentContributes,
    ending: wantsEnding(message),
    isQuestion: asksQuestion(message),
    smsRequested,
    detailsComplaint: asksAboutMissingDetails(message),
    wantsMessage: wantsToLeaveMessage(message),
    messageFollowUp,
    vagueQuestion: asksVagueQuestion(message),
    collectedName,
    collectedPhone,
    requestedService: requestedService || business.appointmentService,
    requestedDate,
    lastTimeMessage
  };
}
