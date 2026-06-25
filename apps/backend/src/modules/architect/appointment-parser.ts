/**
 * Deterministic, dependency-free natural-language appointment parser for the
 * inbound-SMS booking path. It only returns a slot when BOTH a date and a time
 * can be confidently extracted, which keeps false positives low (a bare "3pm"
 * or "tomorrow" alone will not trigger a booking).
 *
 * All wall-clock parsing is anchored to the business time zone so that
 * "tomorrow at 3pm" books the correct absolute instant regardless of where the
 * server runs.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tues: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thurs: 4,
  thur: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6
};

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sept: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11
};

export type ParsedAppointment = {
  startAt: Date;
  endAt: Date;
};

type DateParts = {
  year: number;
  monthIndex: number;
  day: number;
};

type TimeParts = {
  hour: number;
  minute: number;
};

/**
 * Returns the offset (ms) of `timeZone` at the given absolute instant.
 * offset = (wall clock shown in tz, interpreted as if UTC) - actual UTC instant.
 */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  let hour = Number(map.hour);
  if (hour === 24) hour = 0;

  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second)
  );

  return asUTC - date.getTime();
}

/** Convert a wall-clock time in `timeZone` to the correct UTC instant. */
function zonedWallTimeToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const naiveUTC = Date.UTC(year, monthIndex, day, hour, minute, 0);
  const offset = getTimeZoneOffsetMs(new Date(naiveUTC), timeZone);
  return new Date(naiveUTC - offset);
}

/** Today's calendar date (and weekday) as seen in the business time zone. */
function todayInZone(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date())) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  const weekday = WEEKDAYS[(map.weekday || "").toLowerCase()] ?? 0;

  return {
    year: Number(map.year),
    monthIndex: Number(map.month) - 1,
    day: Number(map.day),
    weekday
  };
}

function partsFromUtcMidnight(utcMs: number): DateParts {
  const date = new Date(utcMs);
  return {
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate()
  };
}

function parseTime(message: string): TimeParts | null {
  // "3pm", "3 pm", "3:30pm", "10:00am"
  const meridiem = message.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (meridiem) {
    let hour = Number(meridiem[1]);
    const minute = meridiem[2] ? Number(meridiem[2]) : 0;
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (meridiem[3] === "pm" && hour !== 12) hour += 12;
    if (meridiem[3] === "am" && hour === 12) hour = 0;
    return { hour, minute };
  }

  // 24-hour "14:30"
  const military = message.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (military) {
    return { hour: Number(military[1]), minute: Number(military[2]) };
  }

  // "at 9" / "at 2" — assume daytime business hours (1-7 => afternoon).
  const atHour = message.match(/\bat\s+(\d{1,2})\b/);
  if (atHour) {
    let hour = Number(atHour[1]);
    if (hour < 0 || hour > 23) return null;
    if (hour >= 1 && hour <= 7) hour += 12;
    return { hour, minute: 0 };
  }

  return null;
}

function parseDate(message: string, timeZone: string): DateParts | null {
  const today = todayInZone(timeZone);
  const todayUtcMidnight = Date.UTC(today.year, today.monthIndex, today.day);

  if (/\b(today|tonight)\b/.test(message)) {
    return { year: today.year, monthIndex: today.monthIndex, day: today.day };
  }

  if (/\b(tomorrow|tmrw)\b/.test(message)) {
    return partsFromUtcMidnight(todayUtcMidnight + DAY_MS);
  }

  // weekday name, optionally prefixed with "next"
  const weekday = message.match(
    /\b(?:next\s+)?(sunday|saturday|thursday|wednesday|tuesday|monday|friday|sun|sat|thurs|thur|thu|wed|tues|tue|mon|fri)\b/
  );
  if (weekday) {
    const target = WEEKDAYS[weekday[1]];
    let delta = (target - today.weekday + 7) % 7;
    if (delta === 0) delta = 7; // always the upcoming occurrence, not today
    return partsFromUtcMidnight(todayUtcMidnight + delta * DAY_MS);
  }

  // month name + day: "june 28", "jun 28th"
  const monthName = message.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/
  );
  if (monthName) {
    const monthIndex = MONTHS[monthName[1]];
    const day = Number(monthName[2]);
    if (day >= 1 && day <= 31) {
      let year = today.year;
      if (Date.UTC(year, monthIndex, day) < todayUtcMidnight) year += 1;
      return { year, monthIndex, day };
    }
  }

  // numeric M/D or M/D/YYYY
  const numeric = message.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) {
    const monthIndex = Number(numeric[1]) - 1;
    const day = Number(numeric[2]);
    let year = numeric[3] ? Number(numeric[3]) : today.year;
    if (year < 100) year += 2000;
    if (monthIndex >= 0 && monthIndex <= 11 && day >= 1 && day <= 31) {
      if (!numeric[3] && Date.UTC(year, monthIndex, day) < todayUtcMidnight) year += 1;
      return { year, monthIndex, day };
    }
  }

  return null;
}

export function parseRequestedAppointment(
  rawMessage: string,
  timeZone: string,
  durationMinutes = 30
): ParsedAppointment | null {
  if (!rawMessage || !rawMessage.trim()) return null;

  const message = rawMessage.toLowerCase();
  const time = parseTime(message);
  const date = parseDate(message, timeZone);

  // Require BOTH a date and a time to confidently treat this as a booking.
  if (!time || !date) return null;

  const startAt = zonedWallTimeToUtc(
    date.year,
    date.monthIndex,
    date.day,
    time.hour,
    time.minute,
    timeZone
  );

  if (Number.isNaN(startAt.getTime())) return null;

  // Never book in the past (allow a 1 minute grace for clock skew).
  if (startAt.getTime() < Date.now() - 60 * 1000) return null;

  return {
    startAt,
    endAt: new Date(startAt.getTime() + durationMinutes * 60 * 1000)
  };
}
