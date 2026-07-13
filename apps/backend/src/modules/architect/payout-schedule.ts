import { z } from "zod";

export type PayoutFrequency = "Weekly" | "Bi-weekly" | "Monthly";
export type PayoutDay = "1st" | "15th" | "Last day of month";

export type PayoutSchedule = {
  frequency: PayoutFrequency;
  day: PayoutDay;
  thresholdCents: number;
};

export const DEFAULT_PAYOUT_SCHEDULE: PayoutSchedule = {
  frequency: "Monthly",
  day: "1st",
  thresholdCents: 5000
};

export const payoutScheduleSchema = z.object({
  frequency: z.enum(["Weekly", "Bi-weekly", "Monthly"]),
  day: z.enum(["1st", "15th", "Last day of month"]),
  thresholdCents: z.number().int().min(0).max(10_000_000)
});

/** Normalizes stored JSON back into a complete schedule with safe defaults. */
export function normalizePayoutSchedule(stored: unknown): PayoutSchedule {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_PAYOUT_SCHEDULE };
  const value = stored as Record<string, unknown>;
  const parsed = payoutScheduleSchema.safeParse({
    frequency: value.frequency,
    day: value.day,
    thresholdCents: value.thresholdCents
  });
  return parsed.success ? parsed.data : { ...DEFAULT_PAYOUT_SCHEDULE };
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month + 1, 0);
}

/**
 * Resolves the next payout date from the architect-selected schedule. Monthly
 * uses the chosen payout day (1st / 15th / last day). Bi-weekly pays on the 1st
 * and 15th. Weekly pays 7 days out from `from`.
 */
export function computeNextPayoutDate(schedule: PayoutSchedule, from = new Date()): Date {
  const year = from.getFullYear();
  const month = from.getMonth();

  if (schedule.frequency === "Weekly") {
    return new Date(year, month, from.getDate() + 7);
  }

  const candidates: Date[] = [];

  if (schedule.frequency === "Bi-weekly") {
    candidates.push(new Date(year, month, 1), new Date(year, month, 15), new Date(year, month + 1, 1));
  } else {
    // Monthly — honor the selected payout day for this month and the next.
    if (schedule.day === "15th") {
      candidates.push(new Date(year, month, 15), new Date(year, month + 1, 15));
    } else if (schedule.day === "Last day of month") {
      candidates.push(lastDayOfMonth(year, month), lastDayOfMonth(year, month + 1));
    } else {
      candidates.push(new Date(year, month, 1), new Date(year, month + 1, 1));
    }
  }

  const next = candidates
    .filter((candidate) => candidate.getTime() > from.getTime())
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return next ?? new Date(year, month + 1, 1);
}
