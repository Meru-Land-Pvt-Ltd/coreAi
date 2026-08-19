/**
 * CALL LISTS — working through people one at a time, safely.
 *
 * A voice agent that dials a list is the point where a product stops being a
 * demo and starts being able to break the law. Every rule in this file exists
 * because getting it wrong is either illegal, expensive, or the thing that
 * makes a person complain:
 *
 *  - 47 CFR 64.1200(c)(1) forbids telemarketing calls before 8am or after 9pm
 *    in the CALLED PARTY's local time. That is a hard floor here: an operator
 *    may narrow the window, never widen it.
 *  - An AI voice is an "artificial voice" under the TCPA (FCC 24-17, Feb 2024),
 *    so every dial needs consent on file. $500-$1,500 per call, private right
 *    of action, no cap.
 *  - Velocify (~3.5M leads): 93% of leads that ever convert are reached by the
 *    6th attempt, and leads needing 7+ attempts are 45% LESS likely to convert.
 *    So six attempts is the ceiling, not a starting point.
 *  - MIT/InsideSales (15,000+ leads): calling an opted-in lead at 5 minutes
 *    rather than 30 changes the odds of reaching them by around 100x. Speed is
 *    the single strongest lever in the whole outbound evidence base, which is
 *    why a list can be fed live instead of imported once.
 */

/** Stable registry slug for the call-list trigger node. */
export const CALL_LIST_NODE_TYPE = "trigger.call_list";

/** Lifecycle of a whole list. */
export const CALL_LIST_STATUSES = ["DRAFT", "RUNNING", "PAUSED", "DONE", "STOPPED_BUDGET"] as const;
export type CallListStatus = (typeof CALL_LIST_STATUSES)[number];

/**
 * Lifecycle of one person on a list.
 *
 * WAITING and RETRY are different on purpose: WAITING has never been tried,
 * RETRY is waiting out a cooldown. An operator reading the board needs to tell
 * "we haven't got to them yet" from "they didn't pick up twice".
 */
export const CALL_PERSON_STATUSES = [
  "WAITING",
  "CALLING",
  "RETRY",
  "ANSWERED",
  "BOOKED",
  "NO_ANSWER",
  "VOICEMAIL",
  "BUSY",
  "FAILED",
  "BAD_NUMBER",
  "OPTED_OUT",
  "SUPPRESSED",
  "DONE"
] as const;
export type CallPersonStatus = (typeof CALL_PERSON_STATUSES)[number];

/** Statuses that mean we are finished with this person, whatever the reason. */
export const TERMINAL_PERSON_STATUSES: readonly CallPersonStatus[] = [
  "BOOKED",
  "OPTED_OUT",
  "SUPPRESSED",
  "BAD_NUMBER",
  "DONE"
];

export type CallListSettings = {
  /** Hard stop. Six is the evidence-backed ceiling. */
  maxAttempts: number;
  /** Earliest local hour we may dial. Never below 8. */
  windowStartHour: number;
  /** Latest local hour we may dial. Never above 21 (9pm). */
  windowEndHour: number;
  /** How many calls may be in flight at once across this list. */
  maxConcurrentCalls: number;
  /** Never ring the same person more than this many times in one day. */
  maxCallsPerPersonPerDay: number;
  /** Stop everything once this much has been spent, in whole dollars. 0 = no cap. */
  budgetUsd: number;
};

export const CALL_LIST_DEFAULTS: CallListSettings = {
  maxAttempts: 6,
  // 9am, not 8: the law allows 8, but the first hour of the working day is
  // where "who is this" turns into "stop calling me".
  windowStartHour: 9,
  windowEndHour: 20,
  // Small on purpose. Ten simultaneous AI calls is ten times the spend per
  // minute and, on most carrier accounts, the point where calls start failing
  // for reasons that look exactly like "nobody answered".
  maxConcurrentCalls: 3,
  maxCallsPerPersonPerDay: 1,
  budgetUsd: 50
};

/** The legal floor. An operator may narrow the window; these cannot be crossed. */
export const LEGAL_EARLIEST_HOUR = 8;
export const LEGAL_LATEST_HOUR = 21;

export function clampCallWindow(settings: CallListSettings): CallListSettings {
  const start = Math.max(LEGAL_EARLIEST_HOUR, Math.min(20, Math.round(settings.windowStartHour)));
  const end = Math.min(LEGAL_LATEST_HOUR, Math.max(start + 1, Math.round(settings.windowEndHour)));
  return {
    ...settings,
    windowStartHour: start,
    windowEndHour: end,
    maxAttempts: Math.max(1, Math.min(6, Math.round(settings.maxAttempts))),
    maxConcurrentCalls: Math.max(1, Math.min(10, Math.round(settings.maxConcurrentCalls))),
    maxCallsPerPersonPerDay: Math.max(1, Math.min(3, Math.round(settings.maxCallsPerPersonPerDay))),
    budgetUsd: Math.max(0, Math.round(settings.budgetUsd))
  };
}

/**
 * How long to wait before trying this person again.
 *
 * One flat retry delay treats "the line was busy" and "they let it ring out"
 * as the same event, and they are not: a busy signal means someone is holding
 * the phone right now, and a voicemail means they are not going to pick up
 * this afternoon either.
 */
export function retryDelayMinutes(status: CallPersonStatus, attempts: number): number | null {
  const backoff = Math.max(1, attempts);
  switch (status) {
    // Someone is on the phone — they are there. Come back soon.
    case "BUSY":
      return 20 * backoff;
    // It rang out. Try a different part of the day.
    case "NO_ANSWER":
      return 240 * backoff;
    // They screen calls. Leave it a day and try a different hour.
    case "VOICEMAIL":
      return 60 * 24;
    // Something broke on our side, not theirs.
    case "FAILED":
      return 30 * backoff;
    default:
      return null;
  }
}

/**
 * Turn Vapi's reason for the call ending into a status a human can read.
 *
 * Zero of the first 159 calls on this platform recorded an outcome, because
 * nothing ever read this field. A status board with an empty outcome column
 * is worse than no board — it looks like the calls went fine.
 */
export function outcomeFromEndedReason(endedReason: string | null | undefined): CallPersonStatus {
  const reason = (endedReason ?? "").toLowerCase();
  if (!reason) return "FAILED";

  if (reason.includes("voicemail")) return "VOICEMAIL";
  if (reason.includes("no-answer") || reason.includes("did-not-answer") || reason.includes("noanswer")) {
    return "NO_ANSWER";
  }
  if (reason.includes("busy")) return "BUSY";
  // A number that does not exist will never exist. Do not spend six attempts
  // proving it.
  if (
    reason.includes("invalid") ||
    reason.includes("does-not-exist") ||
    reason.includes("unallocated") ||
    reason.includes("forbidden") ||
    reason.includes("cannot-be-reached")
  ) {
    return "BAD_NUMBER";
  }
  if (reason.includes("customer-ended") || reason.includes("assistant-ended") || reason.includes("hangup")) {
    return "ANSWERED";
  }
  if (reason.includes("error") || reason.includes("failed") || reason.includes("pipeline")) return "FAILED";
  return "ANSWERED";
}

/** A person actually spoke to the agent — the only outcome worth optimising for. */
export function wasConnected(status: CallPersonStatus): boolean {
  return status === "ANSWERED" || status === "BOOKED";
}

/**
 * Where this phone number's owner probably is, so we can respect their clock.
 *
 * We only ever have a phone number, so this is a guess — and a wrong guess
 * means calling someone at 6am, which is exactly what the law is about. Where
 * the zone is genuinely unknown (any +1 number, since the US spans four zones)
 * the caller must fall back to the conservative window below rather than
 * pretend to know.
 */
export function timeZoneForPhone(phone: string): string | null {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;

  // Country code first. This deliberately does not try to resolve US area
  // codes: there are 300+ of them, they move, and being wrong is the failure
  // mode that matters.
  if (digits.startsWith("91")) return "Asia/Kolkata";
  if (digits.startsWith("44")) return "Europe/London";
  if (digits.startsWith("61")) return "Australia/Sydney";
  if (digits.startsWith("971")) return "Asia/Dubai";
  if (digits.startsWith("65")) return "Asia/Singapore";
  if (digits.startsWith("49")) return "Europe/Berlin";
  if (digits.startsWith("33")) return "Europe/Paris";
  if (digits.startsWith("81")) return "Asia/Tokyo";
  if (digits.startsWith("1")) return null; // US/Canada — four zones, do not guess.
  return null;
}

/**
 * The window to use when we do NOT know where they are.
 *
 * The honest answer to an unknown US timezone is not "assume New York" — it is
 * to only dial during the hours that are legal in EVERY US mainland zone at
 * once. Eastern is three hours ahead of Pacific, so the safe intersection of a
 * 9am-8pm local window is noon-8pm Eastern. Narrower, and never illegal.
 */
export function conservativeWindowFor(settings: CallListSettings): {
  timeZone: string;
  startHour: number;
  endHour: number;
} {
  return {
    timeZone: "America/New_York",
    startHour: Math.min(20, settings.windowStartHour + 3),
    endHour: settings.windowEndHour
  };
}

/** Local hour in a zone, or null when the zone name is not one Node knows. */
export function localHourIn(timeZone: string, at: Date): number | null {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(at)
    );
  } catch {
    return null;
  }
}

/**
 * May we ring this person right now?
 *
 * Returns the reason when the answer is no, because "why is nothing dialling?"
 * is the first question an operator asks, and "outside calling hours" is a
 * much better answer than silence.
 */
export function mayDialNow(
  phone: string,
  settings: CallListSettings,
  at: Date = new Date(),
  knownTimeZone?: string | null
): { allowed: boolean; reason?: string; timeZone: string } {
  const safe = clampCallWindow(settings);
  const zone = knownTimeZone || timeZoneForPhone(phone);

  const window = zone
    ? { timeZone: zone, startHour: safe.windowStartHour, endHour: safe.windowEndHour }
    : conservativeWindowFor(safe);

  const hour = localHourIn(window.timeZone, at);
  if (hour === null) {
    // An unusable zone must never mean "dial anyway".
    return { allowed: false, reason: "Could not work out their local time.", timeZone: window.timeZone };
  }

  if (hour < window.startHour || hour >= window.endHour) {
    return {
      allowed: false,
      reason: `It is ${hour}:00 where they are. This list only calls between ${window.startHour}:00 and ${window.endHour}:00.`,
      timeZone: window.timeZone
    };
  }

  return { allowed: true, timeZone: window.timeZone };
}

/** Strict E.164, or null. One shape in the database means duplicates collapse. */
export function normalizeCallPhone(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, "");
  const withPlus = digits.startsWith("+") ? digits : `+${digits}`;
  const bare = withPlus.slice(1);
  if (bare.length < 8 || bare.length > 15 || !/^\d+$/.test(bare)) return null;
  return `+${bare}`;
}

export type CallListReport = {
  total: number;
  waiting: number;
  called: number;
  connected: number;
  booked: number;
  optedOut: number;
  badNumbers: number;
  /** Of the people we actually reached, how many did we reach at all. */
  connectRatePercent: number;
  /** Of the people we reached, how many booked. This is the only number that pays. */
  bookRatePercent: number;
  spentUsd: number;
};

export function summariseList(
  people: Array<{ status: string; attempts: number }>,
  spentUsd = 0
): CallListReport {
  const total = people.length;
  const count = (predicate: (p: { status: string; attempts: number }) => boolean) =>
    people.filter(predicate).length;

  const called = count((p) => p.attempts > 0);
  const connected = count((p) => wasConnected(p.status as CallPersonStatus));
  const booked = count((p) => p.status === "BOOKED");

  return {
    total,
    waiting: count((p) => p.status === "WAITING" || p.status === "RETRY"),
    called,
    connected,
    booked,
    optedOut: count((p) => p.status === "OPTED_OUT"),
    badNumbers: count((p) => p.status === "BAD_NUMBER"),
    connectRatePercent: called ? Math.round((connected / called) * 100) : 0,
    bookRatePercent: connected ? Math.round((booked / connected) * 100) : 0,
    spentUsd: Number(spentUsd.toFixed(2))
  };
}
