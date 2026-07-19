import type { WorkflowRunStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  effectiveEarningStatus,
  loadArchitectEarnings,
  sumApprovedEarningsCents,
  sumPendingEarningsCents
} from "./payout-earnings";

export const ARCHITECT_ANALYTICS_RANGES = ["7D", "30D", "90D", "6M", "1Y"] as const;
export type ArchitectAnalyticsRange = (typeof ARCHITECT_ANALYTICS_RANGES)[number];

type Bucket = {
  label: string;
  start: Date;
  end: Date;
};

type ExecutionEvent = {
  id: string;
  installedAgentId: string;
  kind: "WORKFLOW" | "CALL";
  status: "SUCCESS" | "FAILED" | "RUNNING";
  occurredAt: Date;
  durationSeconds: number | null;
  businessName: string;
  error: string | null;
};

function utcDayStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function utcWeekStart(value: Date) {
  const dayOffset = (value.getUTCDay() + 6) % 7;
  return addUtcDays(utcDayStart(value), -dayOffset);
}

function buildBuckets(range: ArchitectAnalyticsRange, now: Date): Bucket[] {
  if (range === "7D" || range === "30D") {
    const count = range === "7D" ? 7 : 30;
    const start = addUtcDays(utcDayStart(now), -(count - 1));
    return Array.from({ length: count }, (_, index) => {
      const bucketStart = addUtcDays(start, index);
      return {
        label: bucketStart.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC"
        }),
        start: bucketStart,
        end: addUtcDays(bucketStart, 1)
      };
    });
  }

  if (range === "90D") {
    const count = 13;
    const start = addUtcDays(utcDayStart(now), -(count * 7 - 1));
    return Array.from({ length: count }, (_, index) => {
      const bucketStart = addUtcDays(start, index * 7);
      return {
        label: bucketStart.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC"
        }),
        start: bucketStart,
        end: addUtcDays(bucketStart, 7)
      };
    });
  }

  const count = range === "6M" ? 6 : 12;
  const firstMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1), 1));
  return Array.from({ length: count }, (_, index) => {
    const bucketStart = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + index, 1));
    const bucketEnd = new Date(Date.UTC(bucketStart.getUTCFullYear(), bucketStart.getUTCMonth() + 1, 1));
    return {
      label: bucketStart.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      start: bucketStart,
      end: bucketEnd
    };
  });
}

function workflowEventStatus(status: WorkflowRunStatus): ExecutionEvent["status"] {
  if (status === "COMPLETED") return "SUCCESS";
  if (status === "FAILED" || status === "CANCELLED") return "FAILED";
  return "RUNNING";
}

function callEventStatus(call: { status: string; endedAt: Date | null }): ExecutionEvent["status"] {
  const normalized = call.status.toLowerCase();
  if (/fail|error|cancel|no-answer|busy/.test(normalized)) return "FAILED";
  if (call.endedAt || /end|complete|report/.test(normalized)) return "SUCCESS";
  return "RUNNING";
}

function failureReason(event: ExecutionEvent) {
  const value = `${event.error ?? ""} ${event.status}`.toLowerCase();
  if (value.includes("timeout")) return "Timeout";
  if (value.includes("auth") || value.includes("permission")) return "Authentication";
  if (value.includes("rate") || value.includes("limit")) return "Rate limit";
  if (value.includes("validation") || value.includes("invalid")) return "Invalid input";
  if (event.kind === "CALL") return "Call failed";
  return "Workflow error";
}

export function parseArchitectAnalyticsRange(value?: string): ArchitectAnalyticsRange {
  return ARCHITECT_ANALYTICS_RANGES.includes(value as ArchitectAnalyticsRange)
    ? (value as ArchitectAnalyticsRange)
    : "30D";
}

export async function loadArchitectAgentAnalytics(params: {
  architectUserId: string;
  listingId: string;
  range: ArchitectAnalyticsRange;
  includeAllExecutions?: boolean;
}) {
  const listing = await prisma.agentListing.findFirst({
    where: { id: params.listingId, architectUserId: params.architectUserId },
    select: {
      id: true,
      name: true,
      status: true,
      category: true,
      priceCents: true,
      createdAt: true,
      publishedAt: true
    }
  });

  if (!listing) return null;

  const installsRaw = await prisma.installedAgent.findMany({
    where: { listingId: listing.id },
    select: {
      id: true,
      status: true,
      configJson: true,
      createdAt: true,
      business: { select: { id: true, name: true } }
    }
  });
  const installs = installsRaw.filter((install) => {
    const config = install.configJson;
    return !(
      config &&
      typeof config === "object" &&
      !Array.isArray(config) &&
      (config as Record<string, unknown>).purpose === "ARCHITECT_TEST"
    );
  });
  const installedAgentIds = installs.map((install) => install.id);
  const now = new Date();
  const buckets = buildBuckets(params.range, now);
  const rangeStart = buckets[0]!.start;
  const retentionFloor = addUtcDays(utcDayStart(now), -16 * 7);
  const retentionGroups = new Map<number, typeof installs>();
  for (const install of installs) {
    if (install.createdAt < retentionFloor) continue;
    const cohortStart = utcWeekStart(install.createdAt).getTime();
    retentionGroups.set(cohortStart, [...(retentionGroups.get(cohortStart) ?? []), install]);
  }
  const retentionCohorts = [...retentionGroups.entries()]
    .sort(([left], [right]) => right - left)
    .slice(0, 4)
    .reverse();
  const retentionStart = retentionCohorts[0] ? new Date(retentionCohorts[0][0]) : rangeStart;
  const activityQueryStart = retentionStart < rangeStart ? retentionStart : rangeStart;

  const [workflowRuns, calls, sales] = await Promise.all([
    installedAgentIds.length
      ? prisma.workflowRun.findMany({
          where: {
            installedAgentId: { in: installedAgentIds },
            mode: "LIVE",
            startedAt: { gte: activityQueryStart }
          },
          orderBy: { startedAt: "desc" },
          select: {
            id: true,
            installedAgentId: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            durationMs: true,
            errorMessage: true,
            business: { select: { name: true } }
          }
        })
      : [],
    installedAgentIds.length
      ? prisma.vapiCall.findMany({
          where: {
            installedAgentId: { in: installedAgentIds },
            executionMode: "LIVE",
            startedAt: { gte: activityQueryStart }
          },
          orderBy: { startedAt: "desc" },
          select: {
            id: true,
            installedAgentId: true,
            status: true,
            startedAt: true,
            endedAt: true,
            durationSeconds: true,
            business: { select: { name: true } }
          }
        })
      : [],
    loadArchitectEarnings(params.architectUserId, { listingIds: [listing.id] })
  ]);

  const allEvents: ExecutionEvent[] = [
    ...workflowRuns.map((run) => ({
      id: `workflow:${run.id}`,
      installedAgentId: run.installedAgentId!,
      kind: "WORKFLOW" as const,
      status: workflowEventStatus(run.status),
      occurredAt: run.startedAt,
      durationSeconds:
        typeof run.durationMs === "number"
          ? run.durationMs / 1000
          : run.finishedAt
            ? Math.max(0, (run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
            : null,
      businessName: run.business?.name ?? "Business customer",
      error: run.errorMessage
    })),
    ...calls.map((call) => ({
      id: `call:${call.id}`,
      installedAgentId: call.installedAgentId!,
      kind: "CALL" as const,
      status: callEventStatus(call),
      occurredAt: call.startedAt,
      durationSeconds:
        call.durationSeconds ??
        (call.endedAt ? Math.max(0, (call.endedAt.getTime() - call.startedAt.getTime()) / 1000) : null),
      businessName: call.business.name,
      error: callEventStatus(call) === "FAILED" ? call.status : null
    }))
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const events = allEvents.filter((event) => event.occurredAt >= rangeStart);

  const rangeSales = sales.filter((sale) => sale.createdAt >= rangeStart);
  const completedEvents = events.filter((event) => event.status !== "RUNNING");
  const successfulEvents = events.filter((event) => event.status === "SUCCESS");
  const failedEvents = events.filter((event) => event.status === "FAILED");
  const durations = completedEvents
    .map((event) => event.durationSeconds)
    .filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration));
  const approvedRevenueCents = sumApprovedEarningsCents(rangeSales);
  const pendingRevenueCents = sumPendingEarningsCents(rangeSales);

  const series = buckets.map((bucket) => {
    const bucketEvents = events.filter(
      (event) => event.occurredAt >= bucket.start && event.occurredAt < bucket.end
    );
    const bucketSales = rangeSales.filter(
      (sale) => sale.createdAt >= bucket.start && sale.createdAt < bucket.end
    );
    return {
      label: bucket.label,
      successful: bucketEvents.filter((event) => event.status === "SUCCESS").length,
      failed: bucketEvents.filter((event) => event.status === "FAILED").length,
      running: bucketEvents.filter((event) => event.status === "RUNNING").length,
      revenueCents: sumApprovedEarningsCents(bucketSales),
      pendingRevenueCents: sumPendingEarningsCents(bucketSales)
    };
  });

  const failureCounts = new Map<string, number>();
  for (const event of failedEvents) {
    const reason = failureReason(event);
    failureCounts.set(reason, (failureCounts.get(reason) ?? 0) + 1);
  }

  const retention = retentionCohorts.map(([cohortTimestamp, cohortInstalls]) => {
    const values: Array<number | null> = [100];
    for (const weekOffset of [1, 2, 4]) {
      const windowEnd = addUtcDays(new Date(cohortTimestamp), (weekOffset + 1) * 7);
      if (windowEnd > now) {
        values.push(null);
        continue;
      }

      const retainedCount = cohortInstalls.filter((install) => {
        const windowStart = addUtcDays(install.createdAt, weekOffset * 7);
        const installWindowEnd = addUtcDays(windowStart, 7);
        return allEvents.some(
          (event) =>
            event.installedAgentId === install.id &&
            event.occurredAt >= windowStart &&
            event.occurredAt < installWindowEnd
        );
      }).length;
      values.push(Math.round((retainedCount / cohortInstalls.length) * 100));
    }

    return {
      label: new Date(cohortTimestamp).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC"
      }),
      installCount: cohortInstalls.length,
      values
    };
  });
  const fourWeekValues = retention
    .map((cohort) => cohort.values[3])
    .filter((value): value is number => typeof value === "number");

  return {
    listing: {
      ...listing,
      createdAt: listing.createdAt.toISOString(),
      publishedAt: listing.publishedAt?.toISOString() ?? null
    },
    range: params.range,
    rangeStart: rangeStart.toISOString(),
    refreshedAt: new Date().toISOString(),
    metrics: {
      totalExecutions: events.length,
      successfulExecutions: successfulEvents.length,
      failedExecutions: failedEvents.length,
      runningExecutions: events.filter((event) => event.status === "RUNNING").length,
      successRate:
        completedEvents.length > 0 ? Math.round((successfulEvents.length / completedEvents.length) * 1000) / 10 : 0,
      averageExecutionSeconds:
        durations.length > 0
          ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10
          : 0,
      revenueCents: approvedRevenueCents,
      pendingRevenueCents,
      salesCount: rangeSales.length,
      callCount: events.filter((event) => event.kind === "CALL").length,
      totalInstalls: installs.length,
      activeInstalls: installs.filter((install) => install.status === "ACTIVE").length
    },
    series,
    failures: [...failureCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    retention: {
      cohorts: retention,
      averageFourWeekPercent:
        fourWeekValues.length > 0
          ? Math.round(fourWeekValues.reduce((sum, value) => sum + value, 0) / fourWeekValues.length)
          : null
    },
    recentExecutions: events.slice(0, params.includeAllExecutions ? undefined : 20).map((event) => ({
      id: event.id,
      kind: event.kind,
      status: event.status,
      occurredAt: event.occurredAt.toISOString(),
      durationSeconds: event.durationSeconds,
      businessName: event.businessName,
      error: event.error
    }))
  };
}

function csvCell(value: string | number | null) {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values: Array<string | number | null>) {
  return values.map(csvCell).join(",");
}

function reportSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "agent";
}

export async function buildArchitectAgentAnalyticsCsv(params: {
  architectUserId: string;
  listingId: string;
  range: ArchitectAnalyticsRange;
}) {
  const analytics = await loadArchitectAgentAnalytics({
    ...params,
    includeAllExecutions: true
  });
  if (!analytics) return null;

  const rows = [
    csvRow(["TRIVEN.AI Agent Analytics Report"]),
    csvRow(["Agent", analytics.listing.name]),
    csvRow(["Agent ID", analytics.listing.id]),
    csvRow(["Status", analytics.listing.status]),
    csvRow(["Selected range", analytics.range]),
    csvRow(["Range begins", analytics.rangeStart]),
    csvRow(["Generated at", analytics.refreshedAt]),
    "",
    csvRow(["Summary"]),
    csvRow(["Metric", "Value"]),
    csvRow(["Total executions", analytics.metrics.totalExecutions]),
    csvRow(["Successful executions", analytics.metrics.successfulExecutions]),
    csvRow(["Failed executions", analytics.metrics.failedExecutions]),
    csvRow(["Running executions", analytics.metrics.runningExecutions]),
    csvRow(["Success rate (%)", analytics.metrics.successRate]),
    csvRow(["Average execution time (seconds)", analytics.metrics.averageExecutionSeconds]),
    csvRow(["Approved earnings", (analytics.metrics.revenueCents / 100).toFixed(2)]),
    csvRow(["Pending earnings", (analytics.metrics.pendingRevenueCents / 100).toFixed(2)]),
    csvRow(["Sales", analytics.metrics.salesCount]),
    csvRow(["Voice calls", analytics.metrics.callCount]),
    csvRow(["Total installs", analytics.metrics.totalInstalls]),
    csvRow(["Active installs", analytics.metrics.activeInstalls]),
    "",
    csvRow(["Time series"]),
    csvRow(["Period", "Successful", "Failed", "Running", "Approved earnings", "Pending earnings"]),
    ...analytics.series.map((point) =>
      csvRow([
        point.label,
        point.successful,
        point.failed,
        point.running,
        (point.revenueCents / 100).toFixed(2),
        (point.pendingRevenueCents / 100).toFixed(2)
      ])
    ),
    "",
    csvRow(["Client retention"]),
    csvRow(["Cohort", "Installs", "At hire (%)", "1 week (%)", "2 weeks (%)", "4 weeks (%)"]),
    ...analytics.retention.cohorts.map((cohort) =>
      csvRow([cohort.label, cohort.installCount, ...cohort.values])
    ),
    csvRow(["Average 4-week retention (%)", analytics.retention.averageFourWeekPercent]),
    "",
    csvRow(["Executions"]),
    csvRow(["Execution ID", "Type", "Status", "Occurred at", "Duration (seconds)", "Business", "Error"]),
    ...analytics.recentExecutions.map((execution) =>
      csvRow([
        execution.id,
        execution.kind,
        execution.status,
        execution.occurredAt,
        execution.durationSeconds,
        execution.businessName,
        execution.error
      ])
    )
  ];

  return {
    filename: `triven-agent-analytics-${reportSlug(analytics.listing.name)}-${analytics.range.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: `\uFEFF${rows.join("\r\n")}`
  };
}
