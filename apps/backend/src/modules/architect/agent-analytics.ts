import { prisma } from "../../lib/prisma";
import { loadArchitectEarnings } from "./payout-earnings";

type RangeKey = "7D" | "30D" | "90D" | "6M" | "1Y";

const RANGE_DAYS: Record<RangeKey, number> = {
  "7D": 7,
  "30D": 30,
  "90D": 90,
  "6M": 182,
  "1Y": 365
};

type SeriesBucket = { start: Date; end: Date; label: string };

type CallRow = {
  createdAt: Date;
  durationSeconds: number | null;
  listingId: string | null;
};

type SaleRow = { date: Date; earningsCents: number; listingId: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short" });
}

function bucketsFor(key: RangeKey, now: Date): SeriesBucket[] {
  const buckets: SeriesBucket[] = [];

  if (key === "7D") {
    for (let i = 6; i >= 0; i -= 1) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      buckets.push({ start, end, label: WEEKDAYS[start.getDay()] });
    }
    return buckets;
  }

  if (key === "30D") {
    for (let i = 3; i >= 0; i -= 1) {
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7 + 1);
      const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 7);
      buckets.push({ start, end, label: `Wk ${4 - i}` });
    }
    return buckets;
  }

  const months = key === "90D" ? 3 : key === "6M" ? 6 : 12;
  for (let i = months - 1; i >= 0; i -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    buckets.push({ start, end, label: monthLabel(start) });
  }
  return buckets;
}

function inBucket(at: Date, bucket: SeriesBucket): boolean {
  return at.getTime() >= bucket.start.getTime() && at.getTime() < bucket.end.getTime();
}

function isSuccess(call: CallRow): boolean {
  return (call.durationSeconds ?? 0) > 0;
}

function deltaLabel(current: number, previous: number, suffix = "%"): string {
  if (previous <= 0) return current > 0 ? "New" : "0" + suffix;
  const percent = Math.round(((current - previous) / previous) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}${suffix === "%" ? "%" : suffix}`;
}

function rangeAggregate(params: {
  key: RangeKey;
  now: Date;
  calls: CallRow[];
  sales: SaleRow[];
}) {
  const { key, now } = params;
  const days = RANGE_DAYS[key];
  const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const previousStart = new Date(windowStart.getTime() - days * 24 * 60 * 60 * 1000);

  const calls = params.calls.filter((call) => call.createdAt >= windowStart);
  const previousCalls = params.calls.filter(
    (call) => call.createdAt >= previousStart && call.createdAt < windowStart
  );
  const sales = params.sales.filter((sale) => sale.date >= windowStart);
  const previousSales = params.sales.filter(
    (sale) => sale.date >= previousStart && sale.date < windowStart
  );

  const successes = calls.filter(isSuccess);
  const successRate = calls.length > 0 ? Math.round((successes.length / calls.length) * 100) : 0;
  const previousSuccessRate =
    previousCalls.length > 0
      ? Math.round((previousCalls.filter(isSuccess).length / previousCalls.length) * 100)
      : 0;
  const avgDuration =
    successes.length > 0
      ? successes.reduce((sum, call) => sum + (call.durationSeconds ?? 0), 0) / successes.length
      : 0;
  const revenueCents = sales.reduce((sum, sale) => sum + sale.earningsCents, 0);
  const previousRevenueCents = previousSales.reduce((sum, sale) => sum + sale.earningsCents, 0);

  const buckets = bucketsFor(key, now);
  const execSeries = {
    labels: buckets.map((bucket) => bucket.label),
    success: buckets.map((bucket) => calls.filter((call) => isSuccess(call) && inBucket(call.createdAt, bucket)).length),
    fail: buckets.map((bucket) => calls.filter((call) => !isSuccess(call) && inBucket(call.createdAt, bucket)).length)
  };
  const revSeries = {
    labels: buckets.map((bucket) => bucket.label),
    vals: buckets.map((bucket) =>
      Math.round(
        params.sales
          .filter((sale) => inBucket(sale.date, bucket))
          .reduce((sum, sale) => sum + sale.earningsCents, 0) / 100
      )
    )
  };

  // Simple linear projection for the next period based on the current run-rate.
  const elapsedMs = Math.max(now.getTime() - windowStart.getTime(), 1);
  const projectedCents = Math.round((revenueCents / elapsedMs) * days * 24 * 60 * 60 * 1000);

  return {
    exec: calls.length,
    sr: successRate,
    avg: Number(avgDuration.toFixed(1)),
    rev: Math.round(revenueCents / 100),
    dExec: deltaLabel(calls.length, previousCalls.length),
    dSr: `${successRate - previousSuccessRate >= 0 ? "+" : ""}${successRate - previousSuccessRate}%`,
    dAvg: "0",
    dRev: deltaLabel(revenueCents, previousRevenueCents),
    proj: `$${Math.round(projectedCents / 100).toLocaleString("en-US")}`,
    execN: buckets.length,
    revKind: key === "7D" ? "day" : key === "30D" ? "week4" : key === "90D" ? "month3" : key === "6M" ? "month6" : "month12",
    execSeries,
    revSeries
  };
}

export async function buildArchitectAgentAnalytics(architectUserId: string, listingId?: string | null) {
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const listings = await prisma.agentListing.findMany({
    where: {
      architectUserId,
      ...(listingId ? { id: listingId } : {})
    },
    select: { id: true, name: true, status: true, _count: { select: { installedAgents: true } } }
  });

  const listingIds = listings.map((listing) => listing.id);

  const [callRows, earnings] = await Promise.all([
    listingIds.length
      ? prisma.vapiCall.findMany({
          where: {
            createdAt: { gte: yearAgo },
            installedAgent: { is: { listingId: { in: listingIds } } }
          },
          select: {
            createdAt: true,
            durationSeconds: true,
            installedAgent: { select: { listingId: true } }
          },
          orderBy: { createdAt: "desc" }
        })
      : Promise.resolve(
          [] as Array<{
            createdAt: Date;
            durationSeconds: number | null;
            installedAgent: { listingId: string | null } | null;
          }>
        ),
    loadArchitectEarnings(architectUserId, listingId ? { listingIds: [listingId] } : undefined)
  ]);

  const calls: CallRow[] = callRows.map((row) => ({
    createdAt: row.createdAt,
    durationSeconds: row.durationSeconds,
    listingId: row.installedAgent?.listingId ?? null
  }));

  const sales: SaleRow[] = earnings
    .filter((sale) => sale.architectEarningStatus !== "REJECTED" && sale.createdAt >= yearAgo)
    .map((sale) => ({
      date: sale.createdAt,
      earningsCents: sale.earningsCents,
      listingId: sale.listingId
    }));

  const ranges = Object.fromEntries(
    (Object.keys(RANGE_DAYS) as RangeKey[]).map((key) => [key, rangeAggregate({ key, now, calls, sales })])
  ) as Record<RangeKey, ReturnType<typeof rangeAggregate>>;

  // Per-agent performance table (all-time within the year window).
  const agents = listings.map((listing) => {
    const listingCalls = calls.filter((call) => call.listingId === listing.id);
    const listingSuccesses = listingCalls.filter(isSuccess);
    const listingRevenueCents = sales
      .filter((sale) => sale.listingId === listing.id)
      .reduce((sum, sale) => sum + sale.earningsCents, 0);
    const successRate =
      listingCalls.length > 0 ? Math.round((listingSuccesses.length / listingCalls.length) * 100) : 0;
    const avgSeconds =
      listingSuccesses.length > 0
        ? listingSuccesses.reduce((sum, call) => sum + (call.durationSeconds ?? 0), 0) / listingSuccesses.length
        : 0;

    return {
      name: listing.name,
      ver: listing.status === "APPROVED" ? "Live" : listing.status === "PAUSED" ? "Paused" : "Draft",
      exec: listingCalls.length,
      sr: successRate,
      time: Number(avgSeconds.toFixed(1)),
      rev: Math.round(listingRevenueCents / 100),
      status: listingCalls.length === 0 || successRate >= 80 ? "Healthy" : "Attention",
      installs: listing._count.installedAgents
    };
  });

  // 12-month execution sparkline.
  const spark = bucketsFor("1Y", now).map(
    (bucket) => calls.filter((call) => inBucket(call.createdAt, bucket)).length
  );

  const liveExecutions = calls.slice(0, 8).map((call) => ({
    at: call.createdAt.toISOString(),
    listingName: listings.find((listing) => listing.id === call.listingId)?.name ?? "Agent",
    durationSeconds: call.durationSeconds ?? 0,
    ok: isSuccess(call)
  }));

  return { ranges, agents, spark, liveExecutions };
}
