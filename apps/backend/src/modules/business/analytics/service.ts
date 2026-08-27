import { prisma } from "../../../lib/prisma";
import { vapiCallBusinessNumber, vapiCallDirection } from "../vapi-call-envelope";

/**
 * Buyer-facing agent analytics.
 *
 * Every number here is derived from data the agent runtime already writes —
 * nothing is estimated, mocked, or back-filled:
 *
 *   VapiCall            real voice calls (Vapi is the source; the webhook
 *                       persists duration/cost/transcript per call)
 *   VapiCall.outcome    AI/deterministic classification (classify.ts)
 *   VapiCall.sentiment  same classifier — how the caller sounded
 *   VapiCall.summary    per-call AI summary written at call end
 *   Appointment         bookings the agent actually created
 *   HandoffEvent        transfers to a human
 *   SmsExecution        texts the agent sent (follow-up / confirmations)
 *   AgentUsageExecution canonical buyer billing ledger (what the buyer pays)
 *
 * Tenant scoping is non-negotiable: every query filters by businessId, and
 * every VapiCall/Appointment query filters executionMode = "LIVE" so architect
 * dry-runs and buyer test calls never inflate a buyer's real numbers.
 */

/** Terminal Vapi status for a call that actually connected and ran. */
const COMPLETED_STATUS = "ENDED";
const FAILED_STATUS = "FAILED";
/** Classifier verdict for "the caller never really engaged". */
const MISSED_OUTCOME = "MISSED";

export type AnalyticsPeriod = { from: Date; to: Date };

export interface AnalyticsFilters extends AnalyticsPeriod {
  businessId: string;
  /** InstalledAgent.id — narrows every metric to a single agent. */
  agentId?: string | null;
}

/**
 * Day/hour bucketing in the BUSINESS's timezone, not the server's.
 *
 * "Peak call hours" is only actionable if 9 AM means 9 AM where the phone
 * rings. Bucketing on server-local or UTC time silently shifts every insight
 * by the offset — so the period's calls get grouped through one formatter
 * built from BusinessProfile.timeZone.
 */
class TimeBucketer {
  private readonly formatter: Intl.DateTimeFormat | null;

  constructor(timeZone: string | null) {
    this.formatter = timeZone ? safeFormatter(timeZone) : null;
  }

  parts(date: Date): { day: string; hour: number } {
    if (!this.formatter) {
      return { day: date.toISOString().slice(0, 10), hour: date.getUTCHours() };
    }

    const parts = this.formatter.formatToParts(date);
    const lookup = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";

    const day = `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
    // Intl emits "24" for midnight under hourCycle h23 in some engines.
    const hour = Number(lookup("hour")) % 24;

    return { day, hour: Number.isFinite(hour) ? hour : 0 };
  }

  dayKey(date: Date): string {
    return this.parts(date).day;
  }

  hourKey(date: Date): string {
    const { day, hour } = this.parts(date);
    return `${day}T${String(hour).padStart(2, "0")}`;
  }

  key(date: Date, granularity: "hour" | "day"): string {
    return granularity === "hour" ? this.hourKey(date) : this.dayKey(date);
  }
}

function safeFormatter(timeZone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23"
    });
  } catch {
    // An invalid stored timezone degrades to UTC rather than erroring the page.
    console.warn("[analytics] invalid business timezone, falling back to UTC", { timeZone });
    return null;
  }
}

export interface AnalyticsKpi {
  totalCalls: number;
  completedCalls: number;
  missedCalls: number;
  failedCalls: number;
  inProgressCalls: number;
  bookings: number;
  cancellations: number;
  handoffs: number;
  smsSent: number;
  /**
   * Business-wide only. Lead rows carry no installedAgentId, so this is null
   * in the agent-focused view rather than quietly reporting a business number
   * next to agent-scoped ones.
   */
  newLeads: number | null;
  /** Buyer-facing execution fees from the canonical ledger. */
  platformCostMicroUsd: number;
  /** Provider voice usage billed on the calls themselves. */
  voiceUsageMicroUsd: number;
  totalTalkSeconds: number;
}

export interface AnalyticsInsights {
  answerRate: number | null;
  bookingRate: number | null;
  avgDurationSeconds: number | null;
  peakHourRange: string | null;
  busiestDay: string | null;
  topAgent: { id: string; name: string; calls: number } | null;
  outcomeBreakdown: { key: string; label: string; count: number }[];
  sentimentBreakdown: { key: string; label: string; count: number }[];
}

export interface AnalyticsChartPoint {
  date: string;
  total: number;
  completed: number;
  missed: number;
  failed: number;
  bookings: number;
  costMicroUsd: number;
}

export interface AgentPerformanceRow {
  id: string;
  name: string;
  status: string;
  installSource: string;
  listingId: string | null;
  createdAt: string;
  calls: number;
  completed: number;
  missed: number;
  failed: number;
  answerRate: number | null;
  avgDurationSeconds: number | null;
  totalTalkSeconds: number;
  bookings: number;
  handoffs: number;
  smsSent: number;
  costMicroUsd: number;
  lastCallAt: string | null;
  /** Present once the agent has been deployed to Vapi. */
  vapiAssistantId: string | null;
  phoneNumbers: string[];
}

export interface AnalyticsCallRow {
  id: string;
  callId: string;
  agentId: string | null;
  agentName: string | null;
  customerPhone: string;
  direction: string | null;
  businessNumber: string | null;
  status: string;
  outcome: string;
  outcomeLabel: string;
  sentiment: string | null;
  durationSeconds: number | null;
  summary: string | null;
  recordingUrl: string | null;
  handoffStatus: string | null;
  costMicroUsd: number | null;
  startedAt: string;
  endedAt: string | null;
}

const OUTCOME_LABELS: Record<string, string> = {
  BOOKED: "Appointment booked",
  RESCHEDULED: "Appointment rescheduled",
  CANCELLED: "Appointment cancelled",
  LEAD: "Lead captured",
  FOLLOW_UP: "Follow-up needed",
  NO_INTEREST: "Not interested",
  MISSED: "Missed",
  TRANSFERRED: "Transferred to human",
  SUPPORT_RESOLVED: "Question answered",
  FAILED: "Failed",
  IN_PROGRESS: "In progress",
  UNKNOWN: "Call completed"
};

const SENTIMENT_LABELS: Record<string, string> = {
  POSITIVE: "Positive",
  NEUTRAL: "Neutral",
  CONFUSED: "Confused",
  FRUSTRATED: "Frustrated",
  ANGRY: "Angry",
  UNKNOWN: "Not classified"
};

export function outcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return OUTCOME_LABELS.UNKNOWN;
  return OUTCOME_LABELS[outcome] ?? outcome;
}

export function sentimentLabel(sentiment: string | null | undefined): string {
  if (!sentiment) return SENTIMENT_LABELS.UNKNOWN;
  return SENTIMENT_LABELS[sentiment] ?? sentiment;
}

/**
 * Rule-based outcome for display. The classifier's stored verdict wins when it
 * exists; otherwise fall back to the transport status so a row is never blank.
 */
export function resolveCallOutcome(call: {
  status: string;
  outcome: string | null;
}): string {
  if (call.outcome) return call.outcome;
  if (call.status === FAILED_STATUS) return "FAILED";
  if (call.status !== COMPLETED_STATUS) return "IN_PROGRESS";
  return "UNKNOWN";
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonString(value: unknown, key: string): string | null {
  const raw = jsonRecord(value)[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Default window: the first of the current month → now. */
export function defaultAnalyticsPeriod(now = new Date()): AnalyticsPeriod {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  return { from, to: now };
}

/**
 * Parse ?from/?to. Invalid or reversed input falls back to the current month
 * rather than erroring — a bad bookmark should still render a page.
 */
export function parseAnalyticsPeriod(
  fromRaw?: string | null,
  toRaw?: string | null,
  now = new Date()
): AnalyticsPeriod {
  const fallback = defaultAnalyticsPeriod(now);

  const from = parseDateBoundary(fromRaw, "start");
  const to = parseDateBoundary(toRaw, "end");
  if (!from || !to || from.getTime() > to.getTime()) return fallback;

  return { from, to };
}

function parseDateBoundary(raw: string | null | undefined, edge: "start" | "end"): Date | null {
  if (!raw || !raw.trim()) return null;
  const value = raw.trim();

  // Bare YYYY-MM-DD is anchored to the whole UTC day so a single-day range
  // ("today") still contains that day's calls.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Hour buckets when the window is a single day, day buckets otherwise. */
export function resolveGranularity(period: AnalyticsPeriod): "hour" | "day" {
  const spanMs = period.to.getTime() - period.from.getTime();
  return spanMs <= 36 * 60 * 60 * 1000 ? "hour" : "day";
}

type CallSlice = {
  id: string;
  callId: string;
  installedAgentId: string | null;
  status: string;
  outcome: string | null;
  sentiment: string | null;
  durationSeconds: number | null;
  billedCostMicroUsd: number | null;
  startedAt: Date;
};

/**
 * One projection of the period's calls, reused by the KPI, insight, chart and
 * per-agent aggregations. Loading once beats five near-identical count queries,
 * and the projection stays narrow (no transcripts) so it is cheap to hold.
 */
async function loadPeriodCalls(filters: AnalyticsFilters): Promise<CallSlice[]> {
  return prisma.vapiCall.findMany({
    where: {
      businessId: filters.businessId,
      executionMode: "LIVE",
      startedAt: { gte: filters.from, lte: filters.to },
      ...(filters.agentId ? { installedAgentId: filters.agentId } : {})
    },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      callId: true,
      installedAgentId: true,
      status: true,
      outcome: true,
      sentiment: true,
      durationSeconds: true,
      billedCostMicroUsd: true,
      startedAt: true
    }
  });
}

function isMissed(call: { status: string; outcome: string | null }): boolean {
  return call.outcome === MISSED_OUTCOME;
}

function isCompleted(call: { status: string; outcome: string | null }): boolean {
  return call.status === COMPLETED_STATUS && !isMissed(call);
}

function isFailed(call: { status: string }): boolean {
  return call.status === FAILED_STATUS;
}

export interface AnalyticsOverview {
  period: { from: string; to: string };
  kpi: AnalyticsKpi;
  insights: AnalyticsInsights;
  chart: { granularity: "hour" | "day"; points: AnalyticsChartPoint[] };
  agents: AgentPerformanceRow[];
  /** Set only when the request focused a single agent. */
  focusedAgentId: string | null;
}

export async function buildAnalyticsOverview(
  filters: AnalyticsFilters
): Promise<AnalyticsOverview> {
  const agentScope = filters.agentId ? { installedAgentId: filters.agentId } : {};

  const profile = await prisma.businessProfile.findUnique({
    where: { businessId: filters.businessId },
    select: { timeZone: true }
  });
  const bucketer = new TimeBucketer(profile?.timeZone ?? null);

  const [calls, installedAgents, appointments, handoffs, smsRows, newLeads, ledger] =
    await Promise.all([
      loadPeriodCalls(filters),
      prisma.installedAgent.findMany({
        where: {
          businessId: filters.businessId,
          ...(filters.agentId ? { id: filters.agentId } : {})
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          status: true,
          listingId: true,
          installSource: true,
          configJson: true,
          createdAt: true,
          phoneNumbers: {
            where: { isActive: true },
            select: { phoneNumber: true }
          }
        }
      }),
      prisma.appointment.findMany({
        where: {
          businessId: filters.businessId,
          executionMode: "LIVE",
          createdAt: { gte: filters.from, lte: filters.to },
          ...agentScope
        },
        select: { id: true, installedAgentId: true, status: true, createdAt: true }
      }),
      prisma.handoffEvent.findMany({
        where: {
          businessId: filters.businessId,
          executionMode: "LIVE",
          createdAt: { gte: filters.from, lte: filters.to },
          ...agentScope
        },
        select: { installedAgentId: true }
      }),
      prisma.smsExecution.groupBy({
        by: ["installedAgentId"],
        where: {
          businessId: filters.businessId,
          createdAt: { gte: filters.from, lte: filters.to },
          ...agentScope
        },
        _count: { _all: true }
      }),
      filters.agentId
        ? Promise.resolve(null)
        : prisma.lead.count({
            where: {
              businessId: filters.businessId,
              createdAt: { gte: filters.from, lte: filters.to }
            }
          }),
      prisma.agentUsageExecution.findMany({
        where: {
          businessId: filters.businessId,
          occurredAt: { gte: filters.from, lte: filters.to },
          ...agentScope
        },
        select: { installedAgentId: true, amountMicroUsd: true, billable: true }
      })
    ]);

  // SMS is attributed per agent where the sender recorded one; texts without an
  // installedAgentId still count toward the business total.
  const smsByAgent = new Map<string, number>();
  let smsCount = 0;
  for (const row of smsRows) {
    smsCount += row._count._all;
    if (row.installedAgentId) smsByAgent.set(row.installedAgentId, row._count._all);
  }

  const kpi: AnalyticsKpi = {
    totalCalls: calls.length,
    completedCalls: calls.filter(isCompleted).length,
    missedCalls: calls.filter(isMissed).length,
    failedCalls: calls.filter(isFailed).length,
    inProgressCalls: calls.filter(
      (call) => call.status !== COMPLETED_STATUS && call.status !== FAILED_STATUS
    ).length,
    bookings: appointments.filter((appointment) => appointment.status === "BOOKED").length,
    cancellations: appointments.filter((appointment) => appointment.status === "CANCELLED").length,
    handoffs: handoffs.length,
    smsSent: smsCount,
    newLeads,
    platformCostMicroUsd: ledger
      .filter((entry) => entry.billable)
      .reduce((sum, entry) => sum + entry.amountMicroUsd, 0),
    voiceUsageMicroUsd: calls.reduce((sum, call) => sum + (call.billedCostMicroUsd ?? 0), 0),
    totalTalkSeconds: calls.reduce((sum, call) => sum + (call.durationSeconds ?? 0), 0)
  };

  const insights = buildInsights(calls, installedAgents, kpi, bucketer);
  const chart = buildChart(filters, calls, appointments, bucketer);
  const agents = buildAgentRows(installedAgents, calls, appointments, handoffs, ledger, smsByAgent);

  return {
    period: { from: filters.from.toISOString(), to: filters.to.toISOString() },
    kpi,
    insights,
    chart,
    agents,
    focusedAgentId: filters.agentId ?? null
  };
}

function buildInsights(
  calls: CallSlice[],
  agents: { id: string; name: string }[],
  kpi: AnalyticsKpi,
  bucketer: TimeBucketer
): AnalyticsInsights {
  const completed = calls.filter(isCompleted);
  const withDuration = completed.filter(
    (call) => typeof call.durationSeconds === "number" && call.durationSeconds > 0
  );

  const hourBuckets = new Array<number>(24).fill(0);
  const dayBuckets = new Map<string, number>();
  const outcomes = new Map<string, number>();
  const sentiments = new Map<string, number>();
  const perAgentCalls = new Map<string, number>();

  for (const call of calls) {
    const { day, hour } = bucketer.parts(call.startedAt);
    hourBuckets[hour] += 1;
    dayBuckets.set(day, (dayBuckets.get(day) ?? 0) + 1);

    const outcome = resolveCallOutcome(call);
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);

    const sentiment = call.sentiment ?? "UNKNOWN";
    sentiments.set(sentiment, (sentiments.get(sentiment) ?? 0) + 1);

    if (call.installedAgentId) {
      perAgentCalls.set(call.installedAgentId, (perAgentCalls.get(call.installedAgentId) ?? 0) + 1);
    }
  }

  let topAgent: AnalyticsInsights["topAgent"] = null;
  for (const [agentId, count] of perAgentCalls) {
    if (topAgent && count <= topAgent.calls) continue;
    const agent = agents.find((candidate) => candidate.id === agentId);
    if (!agent) continue;
    topAgent = { id: agent.id, name: agent.name, calls: count };
  }

  return {
    answerRate: kpi.totalCalls > 0 ? round1((kpi.completedCalls / kpi.totalCalls) * 100) : null,
    bookingRate: kpi.totalCalls > 0 ? round1((kpi.bookings / kpi.totalCalls) * 100) : null,
    avgDurationSeconds: withDuration.length
      ? Math.round(
          withDuration.reduce((sum, call) => sum + (call.durationSeconds ?? 0), 0) /
            withDuration.length
        )
      : null,
    peakHourRange: formatPeakHourRange(hourBuckets),
    busiestDay: pickBusiestDay(dayBuckets),
    topAgent,
    outcomeBreakdown: [...outcomes.entries()]
      .map(([key, count]) => ({ key, label: outcomeLabel(key), count }))
      .sort((left, right) => right.count - left.count),
    sentimentBreakdown: [...sentiments.entries()]
      .map(([key, count]) => ({ key, label: sentimentLabel(key), count }))
      .sort((left, right) => right.count - left.count)
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatPeakHourRange(hourBuckets: number[]): string | null {
  const total = hourBuckets.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;

  // Widest-signal 2-hour window, matching how a receptionist thinks about
  // staffing ("mornings are busy"), not a single spiky hour.
  let bestStart = 0;
  let bestCount = -1;
  for (let hour = 0; hour < 24; hour += 1) {
    const windowCount = hourBuckets[hour] + hourBuckets[(hour + 1) % 24];
    if (windowCount > bestCount) {
      bestCount = windowCount;
      bestStart = hour;
    }
  }
  if (bestCount <= 0) return null;

  return `${formatHour(bestStart)} – ${formatHour((bestStart + 2) % 24)}`;
}

function formatHour(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${suffix}`;
}

function pickBusiestDay(dayBuckets: Map<string, number>): string | null {
  let best: { day: string; count: number } | null = null;
  for (const [day, count] of dayBuckets) {
    if (!best || count > best.count) best = { day, count };
  }
  return best?.day ?? null;
}

function buildChart(
  filters: AnalyticsFilters,
  calls: CallSlice[],
  appointments: { installedAgentId: string | null; createdAt: Date; status: string }[],
  bucketer: TimeBucketer
): { granularity: "hour" | "day"; points: AnalyticsChartPoint[] } {
  const granularity = resolveGranularity(filters);
  const points = new Map<string, AnalyticsChartPoint>();

  for (const key of bucketKeys(filters, granularity, bucketer)) {
    points.set(key, {
      date: key,
      total: 0,
      completed: 0,
      missed: 0,
      failed: 0,
      bookings: 0,
      costMicroUsd: 0
    });
  }

  for (const call of calls) {
    const point = points.get(bucketer.key(call.startedAt, granularity));
    if (!point) continue;
    point.total += 1;
    if (isCompleted(call)) point.completed += 1;
    if (isMissed(call)) point.missed += 1;
    if (isFailed(call)) point.failed += 1;
    point.costMicroUsd += call.billedCostMicroUsd ?? 0;
  }

  for (const appointment of appointments) {
    if (appointment.status !== "BOOKED") continue;
    const point = points.get(bucketer.key(appointment.createdAt, granularity));
    if (point) point.bookings += 1;
  }

  return { granularity, points: [...points.values()] };
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Every bucket in the window, so quiet days render as gaps instead of
 * vanishing. Stepping by a fixed number of hours and de-duplicating keys keeps
 * this correct across DST boundaries, where a calendar day is 23 or 25 hours.
 */
function bucketKeys(
  period: AnalyticsPeriod,
  granularity: "hour" | "day",
  bucketer: TimeBucketer
): string[] {
  // Hour view spans at most ~2 days; day view is capped at ~1 year so an
  // absurd custom range cannot blow up the response.
  const stepMs = granularity === "hour" ? HOUR_MS : 6 * HOUR_MS;
  const maxKeys = granularity === "hour" ? 48 : 400;
  const maxSteps = granularity === "hour" ? 60 : 1600;

  const keys: string[] = [];
  const seen = new Set<string>();

  let cursor = period.from.getTime();
  for (let step = 0; step < maxSteps && cursor <= period.to.getTime(); step += 1) {
    const key = bucketer.key(new Date(cursor), granularity);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
      if (keys.length >= maxKeys) break;
    }
    cursor += stepMs;
  }

  return keys;
}

function buildAgentRows(
  agents: {
    id: string;
    name: string;
    status: string;
    listingId: string | null;
    installSource: string;
    configJson: unknown;
    createdAt: Date;
    phoneNumbers: { phoneNumber: string }[];
  }[],
  calls: CallSlice[],
  appointments: { installedAgentId: string | null; status: string }[],
  handoffs: { installedAgentId: string | null }[],
  ledger: { installedAgentId: string; amountMicroUsd: number; billable: boolean }[],
  smsByAgent: Map<string, number>
): AgentPerformanceRow[] {
  return agents
    .map((agent) => {
      const agentCalls = calls.filter((call) => call.installedAgentId === agent.id);
      const completed = agentCalls.filter(isCompleted);
      const withDuration = completed.filter(
        (call) => typeof call.durationSeconds === "number" && call.durationSeconds > 0
      );
      const lastCall = agentCalls.length ? agentCalls[agentCalls.length - 1] : null;

      return {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        installSource: agent.installSource,
        listingId: agent.listingId,
        createdAt: agent.createdAt.toISOString(),
        calls: agentCalls.length,
        completed: completed.length,
        missed: agentCalls.filter(isMissed).length,
        failed: agentCalls.filter(isFailed).length,
        answerRate: agentCalls.length
          ? round1((completed.length / agentCalls.length) * 100)
          : null,
        avgDurationSeconds: withDuration.length
          ? Math.round(
              withDuration.reduce((sum, call) => sum + (call.durationSeconds ?? 0), 0) /
                withDuration.length
            )
          : null,
        totalTalkSeconds: agentCalls.reduce((sum, call) => sum + (call.durationSeconds ?? 0), 0),
        bookings: appointments.filter(
          (appointment) =>
            appointment.installedAgentId === agent.id && appointment.status === "BOOKED"
        ).length,
        handoffs: handoffs.filter((handoff) => handoff.installedAgentId === agent.id).length,
        smsSent: smsByAgent.get(agent.id) ?? 0,
        costMicroUsd: ledger
          .filter((entry) => entry.installedAgentId === agent.id && entry.billable)
          .reduce((sum, entry) => sum + entry.amountMicroUsd, 0),
        lastCallAt: lastCall ? lastCall.startedAt.toISOString() : null,
        vapiAssistantId: jsonString(agent.configJson, "vapiAssistantId"),
        phoneNumbers: agent.phoneNumbers.map((entry) => entry.phoneNumber)
      };
    })
    .sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name));
}

export interface CallsQuery extends AnalyticsFilters {
  status?: string | null;
  outcome?: string | null;
  page: number;
  pageSize: number;
  sortOrder: "asc" | "desc";
}

export async function listAnalyticsCalls(query: CallsQuery): Promise<{
  total: number;
  page: number;
  pageSize: number;
  calls: AnalyticsCallRow[];
}> {
  const statusFilter = resolveStatusFilter(query.status);

  const where = {
    businessId: query.businessId,
    executionMode: "LIVE",
    startedAt: { gte: query.from, lte: query.to },
    ...(query.agentId ? { installedAgentId: query.agentId } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
    ...statusFilter
  };

  const [total, rows, agents] = await Promise.all([
    prisma.vapiCall.count({ where }),
    prisma.vapiCall.findMany({
      where,
      orderBy: { startedAt: query.sortOrder },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        callId: true,
        installedAgentId: true,
        customerPhone: true,
        status: true,
        outcome: true,
        sentiment: true,
        durationSeconds: true,
        summary: true,
        recordingUrl: true,
        billedCostMicroUsd: true,
        metadataJson: true,
        startedAt: true,
        endedAt: true
      }
    }),
    prisma.installedAgent.findMany({
      where: { businessId: query.businessId },
      select: { id: true, name: true }
    })
  ]);

  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));

  // One batch lookup for handoff state instead of a query per row.
  const callIds = rows.map((row) => row.callId);
  const handoffs = callIds.length
    ? await prisma.handoffEvent.findMany({
        where: { businessId: query.businessId, vapiCallId: { in: callIds } },
        orderBy: { createdAt: "desc" },
        select: { vapiCallId: true, status: true }
      })
    : [];
  const handoffByCall = new Map<string, string>();
  for (const handoff of handoffs) {
    if (handoff.vapiCallId && !handoffByCall.has(handoff.vapiCallId)) {
      handoffByCall.set(handoff.vapiCallId, handoff.status);
    }
  }

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    calls: rows.map((row) => {
      const outcome = resolveCallOutcome(row);
      return {
        id: row.id,
        callId: row.callId,
        agentId: row.installedAgentId,
        agentName: row.installedAgentId ? agentNames.get(row.installedAgentId) ?? null : null,
        customerPhone: row.customerPhone,
        /* A DASH FOR EVERY CALL. These read root keys named "direction" and
           "businessNumber" — the stored envelope is Vapi's own body and has
           neither, so the analytics call list showed "—" in both columns for
           every call ever made. The dashboard reads the same rows correctly;
           it just used different code. Now they share it. */
        direction: vapiCallDirection(row.metadataJson),
        businessNumber: vapiCallBusinessNumber(row.metadataJson),
        status: row.status,
        outcome,
        outcomeLabel: outcomeLabel(outcome),
        sentiment: row.sentiment,
        durationSeconds: row.durationSeconds,
        summary: row.summary,
        recordingUrl: row.recordingUrl,
        handoffStatus: handoffByCall.get(row.callId) ?? null,
        costMicroUsd: row.billedCostMicroUsd,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt ? row.endedAt.toISOString() : null
      };
    })
  };
}

function resolveStatusFilter(status?: string | null) {
  if (!status || status === "all") return {};
  if (status === "completed") return { status: COMPLETED_STATUS, NOT: { outcome: MISSED_OUTCOME } };
  if (status === "missed") return { outcome: MISSED_OUTCOME };
  if (status === "failed") return { status: FAILED_STATUS };
  if (status === "in_progress") {
    return { status: { notIn: [COMPLETED_STATUS, FAILED_STATUS] } };
  }
  if (status === "booked") return { outcome: "BOOKED" };
  return {};
}
