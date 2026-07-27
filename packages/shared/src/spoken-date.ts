
const ORDINAL_WORDS: Record<number, string> = {
  1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth",
  6: "sixth", 7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth",
  11: "eleventh", 12: "twelfth", 13: "thirteenth", 14: "fourteenth", 15: "fifteenth",
  16: "sixteenth", 17: "seventeenth", 18: "eighteenth", 19: "nineteenth", 20: "twentieth",
  21: "twenty-first", 22: "twenty-second", 23: "twenty-third", 24: "twenty-fourth", 25: "twenty-fifth",
  26: "twenty-sixth", 27: "twenty-seventh", 28: "twenty-eighth", 29: "twenty-ninth", 30: "thirtieth",
  31: "thirty-first"
};

/** The day-of-month as an English ordinal word (1 → "first", 25 → "twenty-fifth"). */
export function ordinalDayWord(day: number): string {
  return ORDINAL_WORDS[day] ?? `${day}th`;
}

function coerceDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function spokenDateInTimeZone(value: Date | string, timeZone: string): string {
  const date = coerceDate(value);
  if (!date) return "";
  const tz = timeZone && timeZone.trim() ? timeZone.trim() : "UTC";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "long",
      day: "numeric"
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric"
    }).formatToParts(date);
  }
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "0");
  if (!weekday || !month || !day) return "";
  return `${weekday}, ${month} ${ordinalDayWord(day)}`;
}

/** "Saturday, July twenty-fifth at 9:00 AM" — spoken date plus a spoken time. */
export function spokenDateTimeInTimeZone(value: Date | string, timeZone: string, timeLabel: string): string {
  const datePart = spokenDateInTimeZone(value, timeZone);
  if (!datePart) return timeLabel;
  return timeLabel ? `${datePart} at ${timeLabel}` : datePart;
}
