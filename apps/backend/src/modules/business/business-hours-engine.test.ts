import { describe, expect, it } from "vitest";
import {
  businessOpenStatus,
  describeOpenStatus,
  effectiveHoursForDate,
  formatWeeklySummaryLines,
  hasConfiguredHours,
  isValidIanaTimeZone,
  normalizeWeeklyHours,
  toStoredHoursJson,
  validateSpecialHours,
  validateWeeklyHours,
  weekdayOfDate,
  type SpecialHoursEntry,
  type WeeklyHours
} from "@coreai/shared";

/**
 * Structured Business Hours engine — the single schedule used by the prompt,
 * the live answering decision, SMS replies, and the fact lookup. These tests
 * cover the required scenarios: shared weekday hours, different Saturday,
 * closed Sunday, multiple periods (breaks), timezone correctness, special
 * dates, and the strict no-guessing rule when hours are missing.
 */

function week(input: Partial<Record<string, { periods?: Array<{ open: string; close: string }>; closed?: boolean; note?: string }>>): WeeklyHours {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
  return days.map((day) => {
    const config = input[day];
    if (!config || config.closed) return { day, closed: true, periods: [] };
    return {
      day,
      closed: false,
      periods: config.periods ?? [{ open: "09:00", close: "17:00" }],
      ...(config.note ? { note: config.note } : {})
    };
  });
}

/** A Date whose UTC value corresponds to a wall-clock time in a timezone. */
function atUtc(iso: string): Date {
  return new Date(iso);
}

const MON_FRI = {
  monday: {},
  tuesday: {},
  wednesday: {},
  thursday: {},
  friday: {}
};

describe("normalizeWeeklyHours", () => {
  it("accepts the legacy {day, open, close, closed} shape", () => {
    const weekly = normalizeWeeklyHours([
      { day: "monday", open: "08:00", close: "18:00", closed: false },
      { day: "sunday", closed: true }
    ]);
    expect(weekly?.find((d) => d.day === "monday")?.periods).toEqual([{ open: "08:00", close: "18:00" }]);
    expect(weekly?.find((d) => d.day === "sunday")?.closed).toBe(true);
    // Unlisted days are closed — the buyer listed the days they operate.
    expect(weekly?.find((d) => d.day === "wednesday")?.closed).toBe(true);
  });

  it("accepts the structured periods shape and keeps notes", () => {
    const weekly = normalizeWeeklyHours([
      {
        day: "monday",
        closed: false,
        periods: [
          { open: "09:00", close: "13:00" },
          { open: "15:00", close: "18:00" }
        ],
        note: "Emergency appointments only"
      }
    ]);
    const monday = weekly?.find((d) => d.day === "monday");
    expect(monday?.periods).toHaveLength(2);
    expect(monday?.note).toBe("Emergency appointments only");
  });

  it("returns null when nothing is stored — never invents a schedule", () => {
    expect(normalizeWeeklyHours(null)).toBeNull();
    expect(normalizeWeeklyHours([])).toBeNull();
    expect(hasConfiguredHours(null)).toBe(false);
  });

  it("round-trips through toStoredHoursJson with legacy open/close mirrors", () => {
    const weekly = week({ monday: { periods: [{ open: "09:00", close: "13:00" }, { open: "15:00", close: "18:00" }] } });
    const stored = toStoredHoursJson(weekly);
    const monday = stored.find((row) => row.day === "monday") as Record<string, unknown>;
    // Older readers (appointment fallback) see first open → last close.
    expect(monday.open).toBe("09:00");
    expect(monday.close).toBe("18:00");
    const reparsed = normalizeWeeklyHours(stored);
    expect(reparsed?.find((d) => d.day === "monday")?.periods).toHaveLength(2);
  });
});

describe("validation", () => {
  it("rejects closing before opening", () => {
    const issues = validateWeeklyHours(week({ monday: { periods: [{ open: "17:00", close: "09:00" }] } }));
    expect(issues.some((issue) => issue.day === "monday" && /after opening/.test(issue.message))).toBe(true);
  });

  it("rejects overlapping periods", () => {
    const issues = validateWeeklyHours(
      week({ monday: { periods: [{ open: "09:00", close: "13:00" }, { open: "12:00", close: "18:00" }] } })
    );
    expect(issues.some((issue) => /overlap/.test(issue.message))).toBe(true);
  });

  it("accepts a valid break layout (periods with a gap)", () => {
    const issues = validateWeeklyHours(
      week({ monday: { periods: [{ open: "09:00", close: "13:00" }, { open: "15:00", close: "18:00" }] } })
    );
    expect(issues).toHaveLength(0);
  });

  it("rejects duplicate special-hour dates", () => {
    const entries: SpecialHoursEntry[] = [
      { date: "2026-12-25", closed: true, periods: [], kind: "holiday" },
      { date: "2026-12-25", closed: true, periods: [], kind: "holiday" }
    ];
    expect(validateSpecialHours(entries).some((issue) => /Duplicate/.test(issue.message))).toBe(true);
  });

  it("validates IANA timezones", () => {
    expect(isValidIanaTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidIanaTimeZone("Not/AZone")).toBe(false);
    expect(isValidIanaTimeZone("")).toBe(false);
  });
});

describe("open status (timezone-correct)", () => {
  // 2026-07-20 is a Monday.
  const weekly = week({
    ...MON_FRI,
    monday: { periods: [{ open: "09:00", close: "13:00" }, { open: "15:00", close: "18:00" }] },
    saturday: { periods: [{ open: "10:00", close: "14:00" }] }
    // sunday omitted → closed
  });

  it("answers 'are you open right now' inside a working period", () => {
    // 10:30 IST on Monday = 05:00 UTC.
    const status = businessOpenStatus({ weekly, timeZone: "Asia/Kolkata", now: atUtc("2026-07-20T05:00:00Z") });
    expect(status.state).toBe("open");
    expect(status.closesAt).toBe("1 PM");
    expect(status.weekday).toBe("monday");
  });

  it("reports the break as closed with today's reopening time", () => {
    // 14:00 IST Monday = between the two periods.
    const status = businessOpenStatus({ weekly, timeZone: "Asia/Kolkata", now: atUtc("2026-07-20T08:30:00Z") });
    expect(status.state).toBe("closed");
    expect(status.reopensTodayAt).toBe("3 PM");
  });

  it("respects the timezone: the same instant is open in one zone, closed in another", () => {
    // 2026-07-20T05:00Z = 10:30 IST (open Monday) but 01:00 New York (closed).
    const ist = businessOpenStatus({ weekly, timeZone: "Asia/Kolkata", now: atUtc("2026-07-20T05:00:00Z") });
    const nyc = businessOpenStatus({ weekly, timeZone: "America/New_York", now: atUtc("2026-07-20T05:00:00Z") });
    expect(ist.state).toBe("open");
    expect(nyc.state).toBe("closed");
  });

  it("says Sunday is closed and names the next working day", () => {
    // Sunday 2026-07-19, 12:00 IST.
    const status = businessOpenStatus({ weekly, timeZone: "Asia/Kolkata", now: atUtc("2026-07-19T06:30:00Z") });
    expect(status.state).toBe("closed");
    expect(status.today.closed).toBe(true);
    expect(status.nextOpen?.weekday).toBe("monday");
    expect(status.nextOpen?.opensAt).toBe("9 AM");
    expect(describeOpenStatus(status)).toContain("next open Monday");
  });

  it("gives Saturday its own different hours", () => {
    // Saturday 2026-07-25, 11:00 IST → open (10:00–14:00).
    const status = businessOpenStatus({ weekly, timeZone: "Asia/Kolkata", now: atUtc("2026-07-25T05:30:00Z") });
    expect(status.state).toBe("open");
    expect(status.closesAt).toBe("2 PM");
  });

  it("returns 'unknown' when nothing is configured — never guesses", () => {
    const status = businessOpenStatus({ weekly: null, timeZone: "Asia/Kolkata", now: atUtc("2026-07-20T05:00:00Z") });
    expect(status.state).toBe("unknown");
    expect(describeOpenStatus(status)).toContain("not been confirmed");
  });
});

describe("special dates override the weekly schedule", () => {
  const weekly = week(MON_FRI);
  const special: SpecialHoursEntry[] = [
    { date: "2026-07-20", closed: true, periods: [], note: "Public holiday", kind: "holiday" },
    { date: "2026-07-21", closed: false, periods: [{ open: "11:00", close: "14:00" }], kind: "special" }
  ];

  it("a holiday closure closes an otherwise-open weekday", () => {
    // Monday 2026-07-20, 10:30 IST — normally open, but holiday.
    const status = businessOpenStatus({ weekly, special, timeZone: "Asia/Kolkata", now: atUtc("2026-07-20T05:00:00Z") });
    expect(status.state).toBe("closed");
    expect(status.today.source).toBe("special");
    expect(status.today.note).toBe("Public holiday");
    // Next open is Tuesday's special 11:00 (not the weekly 09:00).
    expect(status.nextOpen?.date).toBe("2026-07-21");
    expect(status.nextOpen?.opensAt).toBe("11 AM");
  });

  it("one-day special hours replace the weekly hours for that date", () => {
    const effective = effectiveHoursForDate({ weekly, special, date: "2026-07-21", timeZone: "Asia/Kolkata" });
    expect(effective.source).toBe("special");
    expect(effective.periods).toEqual([{ open: "11:00", close: "14:00" }]);
  });

  it("other dates keep the weekly schedule", () => {
    const effective = effectiveHoursForDate({ weekly, special, date: "2026-07-22", timeZone: "Asia/Kolkata" });
    expect(effective.source).toBe("weekly");
    expect(effective.closed).toBe(false);
  });
});

describe("summaries", () => {
  it("formats the weekly schedule with breaks and notes", () => {
    const lines = formatWeeklySummaryLines(
      week({
        monday: { periods: [{ open: "09:00", close: "13:00" }, { open: "15:00", close: "18:00" }], note: "Emergency only" }
      })
    );
    expect(lines?.[0]).toBe("Monday: 9 AM–1 PM, 3 PM–6 PM (Emergency only)");
    expect(lines?.[6]).toBe("Sunday: Closed");
  });

  it("returns null (not fabricated text) when unconfigured", () => {
    expect(formatWeeklySummaryLines(null)).toBeNull();
  });

  it("weekdayOfDate is calendar-correct", () => {
    expect(weekdayOfDate("2026-07-19", "Asia/Kolkata")).toBe("sunday");
    expect(weekdayOfDate("2026-07-20", "America/Los_Angeles")).toBe("monday");
  });
});
