import {
  addDaysToDate,
  businessOpenStatus,
  dateInTimeZone,
  formatSpecialHoursLines,
  formatWeeklySummaryLines,
  hasConfiguredHours,
  normalizeWeeklyHours,
  type BusinessOpenStatus,
  type SpecialHoursEntry,
  type WeeklyHours
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";

/**
 * Read-side of structured Business Hours (no deploy imports — safe for the
 * prompt builder, live routing, and fact lookup to depend on).
 */

type SpecialRow = {
  date: string;
  kind: string;
  closed: boolean;
  periodsJson: unknown;
  note: string | null;
};

export function specialEntriesFromRows(rows: SpecialRow[]): SpecialHoursEntry[] {
  return rows.map((row) => ({
    date: row.date,
    closed: row.closed,
    periods: Array.isArray(row.periodsJson)
      ? (row.periodsJson as Array<{ open?: unknown; close?: unknown }>)
          .filter((period) => typeof period?.open === "string" && typeof period?.close === "string")
          .map((period) => ({ open: String(period.open), close: String(period.close) }))
      : [],
    ...(row.note ? { note: row.note } : {}),
    kind: (["holiday", "special", "closure"].includes(row.kind)
      ? row.kind
      : "special") as SpecialHoursEntry["kind"]
  }));
}

export type BusinessHoursState = {
  weekly: WeeklyHours | null;
  special: SpecialHoursEntry[];
  timeZone: string;
  source: string | null;
  confirmedAt: Date | null;
  configured: boolean;
};

/** Per-agent hours saved by the setup wizard (configJson.businessDetails.hours). */
async function loadAgentWeeklyHours(installedAgentId?: string | null): Promise<unknown | undefined> {
  if (!installedAgentId) return undefined;

  const agent = await prisma.installedAgent.findUnique({
    where: { id: installedAgentId },
    select: { configJson: true }
  });

  const config =
    agent?.configJson && typeof agent.configJson === "object" && !Array.isArray(agent.configJson)
      ? (agent.configJson as Record<string, unknown>)
      : {};
  const details =
    config.businessDetails && typeof config.businessDetails === "object" && !Array.isArray(config.businessDetails)
      ? (config.businessDetails as Record<string, unknown>)
      : {};

  if (details.contextVersion !== 2) return undefined;

  return details.hours;
}

export async function loadBusinessHoursState(
  businessId: string,
  installedAgentId?: string | null
): Promise<BusinessHoursState> {
  const [profile, specialRows, agentHours] = await Promise.all([
    prisma.businessProfile.findUnique({
      where: { businessId },
      select: { hoursJson: true, timeZone: true, hoursSource: true, hoursConfirmedAt: true }
    }),
    prisma.businessSpecialHours.findMany({
      // This agent's own closures plus legacy business-wide rows (agent NULL).
      // A sibling agent's holiday must never close this one.
      where: {
        businessId,
        ...(installedAgentId
          ? { OR: [{ installedAgentId: null }, { installedAgentId }] }
          : { installedAgentId: null })
      },
      orderBy: { date: "asc" },
      select: { date: true, kind: true, closed: true, periodsJson: true, note: true }
    }),
    loadAgentWeeklyHours(installedAgentId)
  ]);

  const weekly = normalizeWeeklyHours(agentHours !== undefined ? agentHours : profile?.hoursJson);

  return {
    weekly,
    special: specialEntriesFromRows(specialRows),
    timeZone: profile?.timeZone ?? "America/New_York",
    source: profile?.hoursSource ?? null,
    confirmedAt: profile?.hoursConfirmedAt ?? null,
    configured: hasConfiguredHours(weekly)
  };
}

/** Truthful "open right now" for one business — weekly + special dates. */
export async function businessOpenStatusNow(
  businessId: string,
  now: Date = new Date()
): Promise<BusinessOpenStatus> {
  const state = await loadBusinessHoursState(businessId);
  return businessOpenStatus({
    weekly: state.weekly,
    special: state.special,
    timeZone: state.timeZone,
    now
  });
}

export function buildHoursPromptLines(state: BusinessHoursState): string[] {
  if (!state.configured) {
    return [
      "Business hours: NOT CONFIGURED. If asked about opening hours or whether the business is open, say the operating hours have not been confirmed yet and offer to have the team follow up. NEVER guess or invent hours."
    ];
  }

  const lines = formatWeeklySummaryLines(state.weekly) ?? [];
  const result = [`Business hours (${state.timeZone}):`, ...lines.map((line) => `  ${line}`)];

  const today = dateInTimeZone(state.timeZone);
  const horizon = addDaysToDate(today, 45);
  const upcoming = state.special.filter((entry) => entry.date >= today && entry.date <= horizon);
  if (upcoming.length > 0) {
    result.push("Special dates (override the weekly schedule):");
    result.push(...formatSpecialHoursLines(upcoming).map((line) => `  ${line}`));
  }

  result.push(
    "Business hours answer general open/closed questions. Appointment availability can differ — always use the availability tools for booking questions."
  );

  return result;
}
