"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createArchitectWorkflow,
  deleteArchitectWorkflow,
  getArchitectDashboardActivity,
  getArchitectListings,
  getArchitectPayoutSummary,
  getArchitectWorkflow,
  type ArchitectDashboardActivity,
  type ArchitectPayoutSummary
} from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";
import { formatMoney } from "@/components/architect/ui/architect-ui";
import { getAuthUser } from "@/lib/auth";
import { architectAnalyticsPath, architectPublishingStatusPath } from "@/lib/routes";

const WORKFLOWS_ROUTE = "/architect/workflows" as Route;
const AGENTS_ROUTE = "/architect/agents" as Route;

function builderHrefFor(agent: ArchitectListing): Route {
  return (agent.workflowId
    ? `/architect/workflows/${agent.workflowId}/builder`
    : "/architect/agents/publish") as Route;
}

function formatLabel(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Best-effort category label from the listing's tags, falling back to a generic
// "AI Agent" when no explicit category/industry tag is present.
function getAgentCategory(agent: ArchitectListing) {
  const tags = agent.tags ?? [];
  const categoryTag =
    tags.find((tag) => tag.toLowerCase().startsWith("category:")) ??
    tags.find((tag) => !tag.toLowerCase().startsWith("industry:"));

  if (categoryTag) return formatLabel(categoryTag.replace(/^category:/i, ""));
  return "AI Agent";
}

function DuplicateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2.5" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function AnalyticsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="M7 16v-5" />
      <path d="M12 16V8" />
      <path d="M17 16v-3" />
    </svg>
  );
}

function StatusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l2.5 2.5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function ChartLineUpIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4v15a1 1 0 0 0 1 1h15" />
      <polyline points="7 15 11 11 14 14 20 8" />
      <polyline points="14 8 20 8 20 14" />
    </svg>
  );
}

const AGENT_FILTERS = ["All", "Live", "Draft", "In Review"] as const;
type AgentFilter = (typeof AGENT_FILTERS)[number];

function statusToFilter(status: ArchitectListing["status"]): AgentFilter | null {
  if (status === "APPROVED") return "Live";
  if (status === "DRAFT") return "Draft";
  if (status === "PENDING_REVIEW") return "In Review";
  return null;
}

function statusDisplay(status: ArchitectListing["status"]) {
  switch (status) {
    case "APPROVED":
      return { label: "Live", text: "text-green-600", dot: "bg-green-500" };
    case "PENDING_REVIEW":
      return { label: "In Review", text: "text-amber-600", dot: "bg-amber-500" };
    case "REJECTED":
      return { label: "Rejected", text: "text-rose-600", dot: "bg-rose-500" };
    case "SUSPENDED":
      return { label: "Suspended", text: "text-rose-600", dot: "bg-rose-500" };
    case "PAUSED":
      return { label: "Paused", text: "text-amber-600", dot: "bg-amber-500" };
    default:
      return { label: "Draft", text: "text-slate-500", dot: "bg-slate-400" };
  }
}

function NaPanel({ message, testId }: { message: string; testId?: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-6 py-10 text-center" data-testid={testId}>
      <p className="mt-1 text-sm font-medium text-slate-400">{message}</p>
    </div>
  );
}

function formatUsd(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatChartUsd(cents: number) {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

function formatRelativeTime(value: string) {
  const elapsedSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60]
  ];

  for (const [unit, seconds] of ranges) {
    if (Math.abs(elapsedSeconds) >= seconds) {
      return formatter.format(Math.round(elapsedSeconds / seconds), unit);
    }
  }

  return formatter.format(elapsedSeconds, "second");
}

const REVENUE_RANGES = ["7D", "30D", "90D", "6M", "1Y"] as const;
type RevenueRange = (typeof REVENUE_RANGES)[number];
const EARNINGS_COLORS = ["#f59e0b", "#fbbf24", "#fcd34d", "#fde68a"];

function revenuePointsForRange(
  summary: ArchitectPayoutSummary | null,
  range: RevenueRange
): ArchitectPayoutSummary["chart"]["points"] {
  if (!summary) return [];

  const now = new Date();
  const bucketSales = (
    buckets: Array<{ label: string; start: Date; end: Date }>
  ) =>
    buckets.map((bucket) => {
      const sales = summary.sales.filter((sale) => {
        const occurredAt = new Date(sale.date);
        return occurredAt >= bucket.start && occurredAt < bucket.end;
      });
      return {
        label: bucket.label,
        confirmedCents: sales
          .filter((sale) => sale.architectEarningStatus === "APPROVED")
          .reduce((sum, sale) => sum + sale.earningsCents, 0),
        pendingCents: sales
          .filter((sale) => sale.architectEarningStatus === "PENDING")
          .reduce((sum, sale) => sum + sale.earningsCents, 0)
      };
    });

  if (range === "7D") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    return bucketSales(
      Array.from({ length: 7 }, (_, index) => {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
        return {
          label: day.toLocaleDateString("en-US", { weekday: "short" }),
          start: day,
          end: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
        };
      })
    );
  }

  if (range === "30D") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    return bucketSales(
      Array.from({ length: 6 }, (_, index) => {
        const bucketStart = new Date(
          start.getFullYear(),
          start.getMonth(),
          start.getDate() + index * 5
        );
        const bucketEnd = new Date(
          start.getFullYear(),
          start.getMonth(),
          start.getDate() + (index + 1) * 5
        );
        return {
          label: bucketStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          start: bucketStart,
          end: bucketEnd
        };
      })
    );
  }

  const monthCount = range === "90D" ? 3 : range === "6M" ? 6 : 12;
  return bucketSales(
    Array.from({ length: monthCount }, (_, index) => {
      const offset = monthCount - 1 - index;
      const month = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return {
        label: month.toLocaleDateString("en-US", { month: "short" }),
        start: month,
        end: new Date(month.getFullYear(), month.getMonth() + 1, 1)
      };
    })
  );
}

function RevenueChart({
  points
}: {
  points: ArchitectPayoutSummary["chart"]["points"];
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 960;
  const height = 280;
  const padding = { left: 52, right: 14, top: 18, bottom: 30 };
  const baseline = height - padding.bottom;
  const chartHeight = baseline - padding.top;
  const chartWidth = width - padding.left - padding.right;
  const values = points.map((point) => point.confirmedCents + point.pendingCents);
  const hasRevenue = values.some((value) => value > 0);
  const rawMaximum = Math.max(...values, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawMaximum));
  const normalizedMaximum = rawMaximum / magnitude;
  const roundedMaximum =
    normalizedMaximum <= 1
      ? 1
      : normalizedMaximum <= 2
        ? 2
        : normalizedMaximum <= 2.5
          ? 2.5
          : normalizedMaximum <= 5
            ? 5
            : 10;
  const maxCents = Math.max(100, roundedMaximum * magnitude);
  const coordinates = points.map((point, index) => {
    const value = point.confirmedCents + point.pendingCents;
    return {
      ...point,
      value,
      x:
        points.length <= 1
          ? padding.left + chartWidth / 2
          : padding.left + (index / (points.length - 1)) * chartWidth,
      y: baseline - (value / maxCents) * chartHeight
    };
  });
  const smoothPath = (chartPoints: Array<{ x: number; y: number }>) => {
    if (!chartPoints.length) return "";
    if (chartPoints.length === 1) {
      return `M ${chartPoints[0].x.toFixed(2)} ${chartPoints[0].y.toFixed(2)}`;
    }

    let path = `M ${chartPoints[0].x.toFixed(2)} ${chartPoints[0].y.toFixed(2)}`;
    for (let index = 0; index < chartPoints.length - 1; index += 1) {
      const point0 = chartPoints[index - 1] ?? chartPoints[index];
      const point1 = chartPoints[index];
      const point2 = chartPoints[index + 1];
      const point3 = chartPoints[index + 2] ?? point2;
      const control1X = point1.x + (point2.x - point0.x) / 6;
      const control1Y = point1.y + (point2.y - point0.y) / 6;
      const control2X = point2.x - (point3.x - point1.x) / 6;
      const control2Y = point2.y - (point3.y - point1.y) / 6;
      path += ` C ${control1X.toFixed(2)} ${control1Y.toFixed(2)}, ${control2X.toFixed(2)} ${control2Y.toFixed(2)}, ${point2.x.toFixed(2)} ${point2.y.toFixed(2)}`;
    }
    return path;
  };
  const linePath = smoothPath(coordinates);
  const areaPath = coordinates.length
    ? `${linePath} L ${coordinates[coordinates.length - 1].x} ${baseline} L ${coordinates[0].x} ${baseline} Z`
    : "";
  const activePoint = activeIndex === null ? null : coordinates[activeIndex];
  const activeTooltipLeft = activePoint
    ? Math.min(89, Math.max(11, (activePoint.x / width) * 100))
    : 50;
  const activeTooltipAbove = Boolean(activePoint && activePoint.y > 112);
  const visibleLabelStep = Math.max(1, Math.ceil(points.length / 7));

  return (
    <div
      className="relative h-[280px] w-full"
      data-testid="architect-dashboard-revenue-chart"
      onMouseLeave={() => setActiveIndex(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-full w-full"
        role="img"
        aria-label="Revenue over time"
      >
        <defs>
          <linearGradient id="architect-revenue-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.015" />
          </linearGradient>
        </defs>

        {[1, 0.75, 0.5, 0.25, 0].map((ratio) => {
          const y = baseline - ratio * chartHeight;
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="#eef2f7"
                strokeWidth="1"
                strokeDasharray="4 5"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={padding.left - 12}
                y={y + 4}
                textAnchor="end"
                fill="#8ba0bd"
                fontSize="11"
              >
                {formatChartUsd(maxCents * ratio)}
              </text>
            </g>
          );
        })}

        {areaPath ? <path d={areaPath} fill="url(#architect-revenue-area)" /> : null}
        {linePath ? (
          <path
            d={linePath}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {activePoint ? (
          <g aria-hidden="true">
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={padding.top}
              y2={baseline}
              stroke="#f59e0b"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.5"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r="5"
              fill="#f59e0b"
              stroke="#ffffff"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}

        {coordinates.map((point, index) => {
          const previousX = coordinates[index - 1]?.x ?? padding.left;
          const nextX = coordinates[index + 1]?.x ?? width - padding.right;
          const left = index === 0 ? padding.left : (previousX + point.x) / 2;
          const right =
            index === coordinates.length - 1
              ? width - padding.right
              : (point.x + nextX) / 2;
          const showLabel =
            index % visibleLabelStep === 0 || index === coordinates.length - 1;

          return (
            <g key={`${point.label}-${index}`}>
              {showLabel ? (
                <text
                  x={point.x}
                  y={height - 8}
                  textAnchor="middle"
                  fill="#8ba0bd"
                  fontSize="11"
                  data-testid="architect-dashboard-revenue-x-axis"
                >
                  {point.label}
                </text>
              ) : null}
              <rect
                x={left}
                y={padding.top}
                width={Math.max(1, right - left)}
                height={chartHeight}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${point.label}: total ${formatUsd(point.value)}, confirmed ${formatUsd(point.confirmedCents)}, pending ${formatUsd(point.pendingCents)}`}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
              />
            </g>
          );
        })}
      </svg>

      {activePoint ? (
        <div
          className="pointer-events-none absolute z-20 min-w-40 rounded-[10px] bg-slate-900 px-3 py-2 text-xs text-white shadow-xl"
          style={{
            left: `${activeTooltipLeft}%`,
            top: `${(activePoint.y / height) * 100}%`,
            transform: activeTooltipAbove
              ? "translate(-50%, calc(-100% - 12px))"
              : "translate(-50%, 12px)"
          }}
          role="status"
        >
          <p className="mb-1.5 font-semibold">{activePoint.label}</p>
          <div className="space-y-1 text-slate-300">
            <p className="flex justify-between gap-5">
              <span>Total</span>
              <strong className="font-semibold text-white">{formatUsd(activePoint.value)}</strong>
            </p>
            <p className="flex justify-between gap-5">
              <span>Confirmed</span>
              <strong className="font-semibold text-white">{formatUsd(activePoint.confirmedCents)}</strong>
            </p>
            <p className="flex justify-between gap-5">
              <span>Pending</span>
              <strong className="font-semibold text-white">{formatUsd(activePoint.pendingCents)}</strong>
            </p>
          </div>
        </div>
      ) : null}

      {!hasRevenue ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm font-medium text-slate-400">
          No revenue recorded yet
        </div>
      ) : null}
    </div>
  );
}

// Small decorative upward-trending sparkline shown at the top-right of each
// metric card (matches the marketing dashboard aesthetic).
function MiniSparkline() {
  return (
    <svg
      width="76"
      height="28"
      viewBox="0 0 76 28"
      fill="none"
      aria-hidden="true"
      className="text-amber-500"
    >
      <defs>
        <linearGradient id="metric-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M2 24 L14 20 L26 22 L38 14 L50 16 L62 8 L74 4 L74 28 L2 28 Z" fill="url(#metric-spark-fill)" />
      <polyline
        points="2,24 14,20 26,22 38,14 50,16 62,8 74,4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function MetricCard({
  label,
  value,
  icon,
  hint,
  testId,
  showSparkline = true
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: React.ReactNode;
  testId?: string;
  showSparkline?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md sm:p-6">
      <div className="flex items-start justify-between">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">{icon}</span>
        {showSparkline ? <MiniSparkline /> : null}
      </div>
      <p className="mt-4 text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-black tracking-tight text-slate-900" data-testid={testId}>
        {value}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-400">{hint ?? "NA"}</p>
    </div>
  );
}

function ActivityFeed({
  activities,
  loading
}: {
  activities: ArchitectDashboardActivity[];
  loading: boolean;
}) {
  if (loading && !activities.length) {
    return (
      <div className="space-y-5 border-l border-gray-100 pl-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-10 animate-pulse rounded-lg bg-gray-50" />
        ))}
      </div>
    );
  }

  if (!activities.length) {
    return <NaPanel message="No recent activity." testId="architect-dashboard-activity-na" />;
  }

  return (
    <div className="activity-scrollbar h-[184px] overflow-y-auto pr-2">
      <ol
        className="relative min-h-full space-y-5 pl-8 pr-1 before:absolute before:bottom-6 before:left-2 before:top-2 before:w-px before:bg-slate-100"
        data-testid="architect-dashboard-activity-feed"
      >
        {activities.map((activity) => {
          const dotTone =
            activity.type === "PAYOUT"
              ? "bg-green-500 ring-green-100"
              : activity.type === "SALE"
                ? "bg-amber-500 ring-amber-100"
                : "bg-slate-300 ring-slate-100";

          return (
            <li key={activity.id} className="relative min-h-11">
              <span
                className={`absolute -left-7 top-1 h-2.5 w-2.5 rounded-full ring-4 ${dotTone}`}
                aria-hidden="true"
              />
              <p className="text-sm leading-5 text-slate-700">
                <span className="font-semibold text-slate-900">{activity.title}</span>
                {activity.description ? ` — ${activity.description}` : ""}
                {typeof activity.amountCents === "number" ? (
                  <span className="ml-1 font-semibold text-green-600">
                    {activity.type === "PAYOUT" ? "" : "+"}{formatUsd(activity.amountCents)}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {formatRelativeTime(activity.occurredAt)} · {activity.status}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EarningsDonut({
  totalCents,
  items
}: {
  totalCents: number;
  items: Array<{ id: string; name: string; cents: number; color: string; percentage: number }>;
}) {
  const radius = 60;
  const strokeWidth = 18;
  const circumference = 2 * Math.PI * radius;
  const segmentTotal = items.reduce((sum, item) => sum + item.cents, 0);
  const segmentGap = items.length > 1 ? circumference * 0.018 : 0;
  let consumed = 0;
  const segments = items.map((item) => {
    const fraction = segmentTotal > 0 ? item.cents / segmentTotal : 0;
    const length = Math.max(fraction * circumference - segmentGap, 0);
    const segment = { ...item, length, offset: consumed };
    consumed += fraction * circumference;
    return segment;
  });

  return (
    <div className="relative h-40 w-40 shrink-0">
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" role="img" aria-label="This month's earnings by agent">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="#f1f5f9" strokeWidth={strokeWidth} />
        {segments.map((segment) => (
          <circle
            key={segment.id}
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${segment.length} ${circumference}`}
            strokeDashoffset={-segment.offset}
            strokeLinecap="butt"
          >
            <title>{segment.name}: {formatUsd(segment.cents)}</title>
          </circle>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-slate-400">Earned</span>
        <span className="text-xl font-black tracking-tight text-slate-900">
          {formatUsd(totalCents)}
        </span>
      </div>
    </div>
  );
}

export default function ArchitectDashboardPage() {
  const router = useRouter();
  const [listings, setListings] = useState<ArchitectListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [menu, setMenu] = useState<{ agentId: string; top: number; left: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [payoutSummary, setPayoutSummary] = useState<ArchitectPayoutSummary | null>(null);
  const [financialLoading, setFinancialLoading] = useState(true);
  const [activities, setActivities] = useState<ArchitectDashboardActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [revenueRange, setRevenueRange] = useState<RevenueRange>("6M");

  useEffect(() => {
    const user = getAuthUser();
    setName(user?.fullName?.trim() || user?.email?.trim() || "");
  }, []);

  const loadListings = useCallback(async () => {
    const result = await getArchitectListings();
    if (result.success && result.data) setListings(result.data.listings);
    setLoading(false);
  }, []);

  const [payout, setPayout] = useState<ArchitectPayoutSummary | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadPayoutSummary() {
      const result = await getArchitectPayoutSummary();
      if (mounted && result.success && result.data) setPayout(result.data);
    }

    void loadPayoutSummary();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  const loadFinancials = useCallback(async () => {
    const result = await getArchitectPayoutSummary();
    if (result.success && result.data) {
      setPayoutSummary(result.data);
    }
    setFinancialLoading(false);
  }, []);

  const loadActivity = useCallback(async () => {
    const result = await getArchitectDashboardActivity(8);
    if (result.success && result.data) {
      setActivities(result.data.activities);
    }
    setActivityLoading(false);
  }, []);

  useEffect(() => {
    void loadFinancials();
  }, [loadFinancials]);

  useEffect(() => {
    void loadActivity();
    const interval = window.setInterval(() => void loadActivity(), 30_000);
    return () => window.clearInterval(interval);
  }, [loadActivity]);

  // Close the row action menu on outside click or scroll.
  useEffect(() => {
    if (!menu) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest("[data-dash-menu]") && !target.closest("[data-dash-dots]")) {
        setMenu(null);
      }
    }
    function onScroll() {
      setMenu(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  function openMenu(event: React.MouseEvent, agentId: string) {
    event.stopPropagation();
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 208;
    let left = rect.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + 6;
    if (top + 180 > window.innerHeight) {
      top = Math.max(8, rect.top - 6 - 180);
    }
    setMenu((prev) => (prev?.agentId === agentId ? null : { agentId, top, left }));
  }

  async function duplicateAgent(agent: ArchitectListing) {
    setMenu(null);
    if (!agent.workflowId) {
      setToast("This agent has no workflow to duplicate yet.");
      return;
    }

    const workflowResult = await getArchitectWorkflow(agent.workflowId);
    if (!workflowResult.success || !workflowResult.data) {
      setToast(workflowResult.error ?? "Could not load this agent to duplicate.");
      return;
    }

    const source = workflowResult.data.workflow;
    const created = await createArchitectWorkflow({
      name: `${agent.name} (Copy)`,
      description: agent.shortDescription || agent.description || source.description || "",
      isTemplate: false,
      workflowJson: {
        nodes: source.workflowJson?.nodes ?? [],
        edges: source.workflowJson?.edges ?? []
      }
    });

    if (!created.success) {
      setToast(created.error ?? "Could not duplicate this agent.");
      return;
    }

    setToast(`Duplicated “${agent.name}” as a new draft.`);
    await loadListings();
  }

  async function deleteDraft(agent: ArchitectListing) {
    setMenu(null);
    if (!agent.workflowId) return;
    if (!window.confirm(`Delete “${agent.name}”? This can’t be undone.`)) return;

    const result = await deleteArchitectWorkflow(agent.workflowId);
    if (!result.success) {
      setToast(result.error ?? "Could not delete this draft.");
      return;
    }
    setToast(`Deleted “${agent.name}”.`);
    await loadListings();
  }

  const [agentFilter, setAgentFilter] = useState<AgentFilter>("All");

  const counts = useMemo(
    () => ({
      total: listings.length,
      approved: listings.filter((l) => l.status === "APPROVED").length,
      review: listings.filter((l) => l.status === "PENDING_REVIEW").length,
      draft: listings.filter((l) => l.status === "DRAFT").length,
      installs: listings.reduce((sum, l) => sum + (l.installCount ?? 0), 0)
    }),
    [listings]
  );

  const filteredAgents = useMemo(
    () => (agentFilter === "All" ? listings : listings.filter((l) => statusToFilter(l.status) === agentFilter)),
    [listings, agentFilter]
  );

  const topAgents = filteredAgents.slice(0, 6);
  const revenuePoints = useMemo(
    () => revenuePointsForRange(payoutSummary, revenueRange),
    [payoutSummary, revenueRange]
  );
  const projectedEarningsCents = useMemo(() => {
    const earned = payoutSummary?.thisMonthEarningsCents ?? 0;
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return now.getDate() > 0
      ? Math.round((earned / now.getDate()) * daysInMonth)
      : earned;
  }, [payoutSummary?.thisMonthEarningsCents]);
  const monthlyEarningsBreakdown = useMemo(() => {
    if (!payoutSummary) return [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const byListing = new Map<string, { id: string; name: string; cents: number }>();

    for (const sale of payoutSummary.sales) {
      const date = new Date(sale.date);
      if (
        sale.architectEarningStatus !== "APPROVED" ||
        date < monthStart ||
        date >= nextMonth
      ) {
        continue;
      }
      const current = byListing.get(sale.listingId) ?? {
        id: sale.listingId,
        name: sale.listingName,
        cents: 0
      };
      current.cents += sale.earningsCents;
      byListing.set(sale.listingId, current);
    }

    const sorted = [...byListing.values()].sort((left, right) => right.cents - left.cents);
    const visible = sorted.slice(0, 3);
    const remainingCents = sorted
      .slice(3)
      .reduce((sum, item) => sum + item.cents, 0);
    if (remainingCents > 0) {
      visible.push({ id: "other-agents", name: "Other agents", cents: remainingCents });
    }
    if (visible.length === 0 && payoutSummary.thisMonthEarningsCents > 0) {
      visible.push({
        id: "agent-earnings",
        name: "Agent earnings",
        cents: payoutSummary.thisMonthEarningsCents
      });
    }

    const total = Math.max(
      payoutSummary.thisMonthEarningsCents,
      visible.reduce((sum, item) => sum + item.cents, 0)
    );
    return visible.map((item, index) => ({
      ...item,
      color: EARNINGS_COLORS[index % EARNINGS_COLORS.length],
      percentage: total > 0 ? Math.round((item.cents / total) * 100) : 0
    }));
  }, [payoutSummary]);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-slate-900">
      <header className="flex items-center gap-3 border-b border-gray-100 bg-white/90 px-4 py-3.5 shadow-sm sm:px-6 lg:sticky lg:top-0 lg:z-30 lg:backdrop-blur-md lg:px-8" data-testid="architect-dashboard-topbar">

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link
            href={WORKFLOWS_ROUTE}
            data-testid="architect-dashboard-create-agent-link"
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 hover:shadow-md sm:px-5"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="">Create New Agent</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 space-y-6 p-4 pb-28 sm:p-6 lg:p-8 lg:pb-8">
        <div className="relative overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 p-5 sm:p-6" data-testid="architect-dashboard-welcome-banner">
          <p className="text-base font-semibold text-slate-800 sm:text-lg">
            Welcome back{name ? `, ${name}` : ""}. Here&apos;s your agent overview.
          </p>
          <Link href={AGENTS_ROUTE} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-amber-600 hover:text-amber-700" data-testid="architect-dashboard-manage-agents-link">
            Manage agents
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
          <MetricCard
            label="Total Earnings"
            value={financialLoading ? "—" : formatUsd(payoutSummary?.totalEarningsCents ?? 0)}
            hint={
              <span className="font-semibold text-green-600" data-testid="architect-dashboard-earnings-this-month-text">
                +{formatUsd(payoutSummary?.thisMonthEarningsCents ?? 0)} this month
              </span>
            }
            testId="architect-dashboard-total-earnings-text"
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1.5" x2="12" y2="22.5" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            }
          />
          <MetricCard
            label="Total Installs"
            value={loading ? "—" : String(counts.installs)}
            hint={
              loading ? (
                "Loading…"
              ) : (
                <span className="font-semibold text-green-600" data-testid="architect-dashboard-installs-this-month-text">
                  +{counts.installs} this month
                </span>
              )
            }
            testId="architect-dashboard-total-installs-text"
            icon={<ChartLineUpIcon className="h-5 w-5" />}
          />
          <MetricCard
            label="Active Agents"
            value={loading ? "—" : String(counts.approved)}
            showSparkline={false}
            hint={
              loading ? (
                "Loading…"
              ) : (
                <span className="font-semibold text-green-600" data-testid="architect-dashboard-active-agents-health-text">
                  All healthy
                </span>
              )
            }
            testId="architect-dashboard-active-agents-text"
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            }
          />
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8" data-testid="architect-dashboard-revenue-section">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900" data-testid="architect-dashboard-revenue-overview-heading">Revenue Overview</h2>
            <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1" aria-label="Revenue range">
              {REVENUE_RANGES.map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setRevenueRange(range)}
                  aria-pressed={revenueRange === range}
                  className={
                    revenueRange === range
                      ? "rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                      : "rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:text-slate-700"
                  }
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-6">
            {financialLoading ? (
              <div className="h-72 animate-pulse rounded-xl bg-gray-50" />
            ) : (
              <RevenueChart points={revenuePoints} />
            )}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-gray-50 pt-4">
            <p className="text-sm text-slate-600">
              This month so far:{" "}
              <span className="font-semibold text-slate-900">
                {financialLoading ? "—" : formatUsd(payoutSummary?.thisMonthEarningsCents ?? 0)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              Projected:{" "}
              <span className="font-semibold text-amber-600">
                {financialLoading ? "—" : formatUsd(projectedEarningsCents)}
              </span>
            </p>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm" data-testid="architect-dashboard-agents-section">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-6">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-slate-900">Your Agents</h2>
              <Link href={AGENTS_ROUTE} className="text-sm font-medium text-amber-600 hover:text-amber-700" data-testid="architect-dashboard-view-all-agents-link">
                View all →
              </Link>
            </div>
            <div className="flex items-center gap-1 text-sm" data-testid="architect-dashboard-agent-filters">
              {AGENT_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setAgentFilter(filter)}
                  data-testid={`architect-dashboard-agent-filter-${filter.toLowerCase().replace(/\s+/g, "-")}`}
                  className={
                    agentFilter === filter
                      ? "rounded-lg bg-amber-50 px-3 py-1.5 font-semibold text-amber-700"
                      : "rounded-lg px-3 py-1.5 font-medium text-slate-500 transition hover:bg-gray-50 hover:text-slate-700"
                  }
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="space-y-px">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-[72px] animate-pulse border-t border-gray-50 bg-gray-50/60" />
              ))}
            </div>
          ) : topAgents.length ? (
            <>
              {topAgents.map((agent) => {
                const status = statusDisplay(agent.status);
                // Live and in-review agents surface their category; drafts show nothing.
                const showCategory = agent.status !== "DRAFT";
                const category = getAgentCategory(agent);
                return (
                  <div
                    key={agent.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(builderHrefFor(agent))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(builderHrefFor(agent));
                      }
                    }}
                    className="group flex cursor-pointer items-center gap-4 border-t border-gray-50 px-5 py-4 transition hover:bg-gray-50 sm:px-6"
                    data-testid={`architect-dashboard-agent-row-${agent.id}`}
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="8" width="16" height="12" rx="2.5" />
                        <path d="M12 8V4.5" />
                        <circle cx="9" cy="14" r="1.1" />
                        <circle cx="15" cy="14" r="1.1" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold text-slate-900" data-testid="architect-dashboard-agent-name-text">{agent.name}</p>
                      </div>
                      {showCategory ? (
                        <p className="mt-0.5 truncate text-sm text-slate-500" data-testid="architect-dashboard-agent-meta-text">
                          {category}
                        </p>
                      ) : null}
                    </div>
                    <div className="hidden items-center gap-8 md:flex">
                      <span className="w-12 text-right font-semibold text-slate-900" data-testid="architect-dashboard-agent-price-text">{formatMoney(agent.priceCents)}</span>
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-500" data-testid="architect-dashboard-agent-installs-text">
                        <ChartLineUpIcon />
                        {agent.installCount ?? 0}
                      </span>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-medium ${status.text}`} data-testid="architect-dashboard-agent-status-text">
                      <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                      {status.label}
                    </span>
                    <button
                      type="button"
                      data-dash-dots
                      onClick={(event) => openMenu(event, agent.id)}
                      data-testid={`architect-dashboard-agent-menu-${agent.id}-button`}
                      aria-label={`Actions for ${agent.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menu?.agentId === agent.id}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                        <circle cx="5" cy="12" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="19" cy="12" r="1.6" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </>
          ) : (
            <div className="border-t border-gray-50 p-6">
              <NaPanel message="No agents in this view yet." testId="architect-dashboard-agents-na" />
            </div>
          )}

          <div className="border-t border-gray-50 p-4 sm:p-5">
            <Link
              href={WORKFLOWS_ROUTE}
              data-testid="architect-dashboard-create-agent-cta-link"
              className="flex w-full items-center justify-center gap-2 rounded-[0.75rem] border-2 border-dashed border-gray-200 py-3 text-sm font-medium text-slate-500 transition hover:border-amber-300 hover:bg-amber-50/40 hover:text-amber-600"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create New Agent
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-slate-900">Activity</h2>
            <div className="mt-5">
              <ActivityFeed activities={activities} loading={activityLoading} />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-slate-900">This Month&apos;s Earnings</h2>
            {financialLoading ? (
              <div className="mt-5 h-40 animate-pulse rounded-xl bg-gray-50" />
            ) : (
              <div data-testid="architect-dashboard-monthly-earnings">
                <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
                  <EarningsDonut
                    totalCents={payoutSummary?.thisMonthEarningsCents ?? 0}
                    items={monthlyEarningsBreakdown}
                  />
                  <ul className="w-full flex-1 space-y-3">
                    {monthlyEarningsBreakdown.length ? (
                      monthlyEarningsBreakdown.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2.5 text-sm text-slate-600">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: item.color }}
                            />
                            <span className="truncate">{item.name}</span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold text-slate-900">
                            {formatUsd(item.cents)}{" "}
                            <span className="font-normal text-slate-400">{item.percentage}%</span>
                          </span>
                        </li>
                      ))
                    ) : (
                      <li className="text-sm text-slate-400">No earnings recorded this month.</li>
                    )}
                  </ul>
                </div>
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-50 pt-4">
                  <p className="text-sm text-slate-600">
                    Available for withdrawal:{" "}
                    <span className="font-bold text-slate-900">
                      {formatUsd(payoutSummary?.availableBalanceCents ?? 0)}
                    </span>
                  </p>
                  <Link
                    href="/architect/payouts"
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 hover:shadow-md"
                  >
                    Withdraw
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {menu
        ? (() => {
          const agent = listings.find((item) => item.id === menu.agentId);
          if (!agent) return null;
          const isLive = agent.status === "APPROVED";
          const isDraft = agent.status === "DRAFT";
          const itemClass =
            "flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-gray-50";
          return (
            <div
              data-dash-menu
              role="menu"
              aria-label={`Actions for ${agent.name}`}
              data-testid={`architect-dashboard-actions-menu-${agent.id}`}
              className="fixed z-50 w-52 rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl"
              style={{ top: menu.top, left: menu.left }}
            >
              {isDraft ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    router.push(builderHrefFor(agent));
                  }}
                  data-testid={`architect-dashboard-menu-edit-${agent.id}`}
                  className={itemClass}
                >
                  <EditIcon />
                  <span>Edit Agent</span>
                </button>
              ) : null}

              <button
                type="button"
                role="menuitem"
                onClick={() => void duplicateAgent(agent)}
                data-testid={`architect-dashboard-menu-duplicate-${agent.id}`}
                className={itemClass}
              >
                <DuplicateIcon />
                <span>Duplicate</span>
              </button>

              {isLive ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    router.push(architectAnalyticsPath(agent.id));
                  }}
                  data-testid={`architect-dashboard-menu-analytics-${agent.id}`}
                  className={itemClass}
                >
                  <AnalyticsIcon />
                  <span>View analytics</span>
                </button>
              ) : null}

              {!isDraft ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    router.push(architectPublishingStatusPath(agent.id));
                  }}
                  data-testid={`architect-dashboard-menu-status-${agent.id}`}
                  className={itemClass}
                >
                  <StatusIcon />
                  <span>View status</span>
                </button>
              ) : null}

              {isDraft ? (
                <>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void deleteDraft(agent)}
                    data-testid={`architect-dashboard-menu-delete-${agent.id}`}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
                  >
                    <TrashIcon />
                    <span>Delete Agent</span>
                  </button>
                </>
              ) : null}
            </div>
          );
        })()
        : null}

      {toast ? (
        <div className="fixed bottom-5 right-5 z-[70]" aria-live="polite">
          <div className="max-w-xs rounded-xl border border-gray-100 border-l-4 border-l-amber-500 bg-white px-4 py-3 text-sm text-slate-700 shadow-lg" data-testid="architect-dashboard-toast">
            {toast}
          </div>
        </div>
      ) : null}
    </div>
  );
}
