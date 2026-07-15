import { z } from "zod";

export type PayoutFrequency = "Weekly" | "Bi-weekly" | "Monthly";

export const PAYOUT_WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
] as const;

export type PayoutWeekday = (typeof PAYOUT_WEEKDAYS)[number];

export type PayoutSchedule = {
  frequency: PayoutFrequency;
  monthlyDay: string;
  /** Weekly payouts repeat on this weekday. */
  weeklyDay: PayoutWeekday;
  /** Bi-weekly payouts repeat every 14 days from this first payout date (YYYY-MM-DD). */
  firstPayoutDate: string | null;
  thresholdCents: number;
};

export const DEFAULT_PAYOUT_SCHEDULE: PayoutSchedule = {
  frequency: "Monthly",
  monthlyDay: "1",
  weeklyDay: "Monday",
  firstPayoutDate: null,
  thresholdCents: 5000
};

const MONTHLY_DAY_PATTERN = /^(last|[1-9]|1\d|2[0-8])$/;

export const payoutScheduleSchema = z.object({
  frequency: z.enum(["Weekly", "Bi-weekly", "Monthly"]),
  monthlyDay: z.string().regex(MONTHLY_DAY_PATTERN, "Pick a day between 1 and 28 or the last day of the month."),
  weeklyDay: z.enum(PAYOUT_WEEKDAYS),
  firstPayoutDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a full date (YYYY-MM-DD).")
    .nullable(),
  thresholdCents: z.number().int().min(0).max(10_000_000)
});

/** Maps the legacy stored shape ({day: "1st" | "15th" | "Last day of month"}). */
function legacyMonthlyDay(day: unknown): string | null {
  if (day === "1st") return "1";
  if (day === "15th") return "15";
  if (day === "Last day of month") return "last";
  return null;
}

/** Normalizes stored JSON back into a complete schedule with safe defaults. */
export function normalizePayoutSchedule(stored: unknown): PayoutSchedule {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_PAYOUT_SCHEDULE };
  const value = stored as Record<string, unknown>;

  const parsed = payoutScheduleSchema.safeParse({
    frequency: value.frequency,
    monthlyDay:
      typeof value.monthlyDay === "string" && MONTHLY_DAY_PATTERN.test(value.monthlyDay)
        ? value.monthlyDay
        : legacyMonthlyDay(value.day) ?? DEFAULT_PAYOUT_SCHEDULE.monthlyDay,
    weeklyDay: typeof value.weeklyDay === "string" ? value.weeklyDay : DEFAULT_PAYOUT_SCHEDULE.weeklyDay,
    firstPayoutDate: typeof value.firstPayoutDate === "string" ? value.firstPayoutDate : null,
    thresholdCents: value.thresholdCents
  });

  return parsed.success ? parsed.data : { ...DEFAULT_PAYOUT_SCHEDULE };
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month + 1, 0);
}

export function computeNextPayoutDate(schedule: PayoutSchedule, from = new Date()): Date {
  const year = from.getFullYear();
  const month = from.getMonth();

  if (schedule.frequency === "Weekly") {
    const targetIndex = PAYOUT_WEEKDAYS.indexOf(schedule.weeklyDay);
    // Date.getDay(): Sunday = 0 … Saturday = 6; PAYOUT_WEEKDAYS starts Monday.
    const currentIndex = (from.getDay() + 6) % 7;
    const daysAhead = ((targetIndex - currentIndex + 7) % 7) || 7;
    return new Date(year, month, from.getDate() + daysAhead);
  }

  if (schedule.frequency === "Bi-weekly") {
    if (schedule.firstPayoutDate) {
      const anchor = new Date(`${schedule.firstPayoutDate}T00:00:00`);

      if (!Number.isNaN(anchor.getTime())) {
        if (anchor.getTime() > from.getTime()) return anchor;

        const periodMs = 14 * 24 * 60 * 60 * 1000;
        const periodsElapsed = Math.floor((from.getTime() - anchor.getTime()) / periodMs) + 1;
        return new Date(anchor.getTime() + periodsElapsed * periodMs);
      }
    }

    // No anchor chosen yet — legacy 1st/15th cadence until one is saved.
    const candidates = [new Date(year, month, 1), new Date(year, month, 15), new Date(year, month + 1, 1)];
    return (
      candidates.filter((candidate) => candidate.getTime() > from.getTime()).sort((a, b) => a.getTime() - b.getTime())[0] ??
      new Date(year, month + 1, 1)
    );
  }

  // Monthly — honor the selected payout day for this month and the next.
  const candidates =
    schedule.monthlyDay === "last"
      ? [lastDayOfMonth(year, month), lastDayOfMonth(year, month + 1)]
      : [new Date(year, month, Number(schedule.monthlyDay)), new Date(year, month + 1, Number(schedule.monthlyDay))];

  return (
    candidates.filter((candidate) => candidate.getTime() > from.getTime()).sort((a, b) => a.getTime() - b.getTime())[0] ??
    new Date(year, month + 1, 1)
  );
}
