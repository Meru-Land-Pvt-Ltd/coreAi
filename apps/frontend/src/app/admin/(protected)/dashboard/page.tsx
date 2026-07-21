"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bot,
  CircleDollarSign,
  Flag,
  Star,
  UserPlus,
  UsersRound,
  Zap,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAdminSummary, type AdminSummary } from "@/components/admin/features/api";
import { AdminReferenceHeader } from "@/components/admin/ui/admin-reference-header";

type PerformanceMetric = "revenue" | "executions" | "users";

const METRIC_CONFIG: Record<
  PerformanceMetric,
  { label: string; subtitle: string }
> = {
  revenue: { label: "Revenue", subtitle: "Daily revenue across the marketplace" },
  executions: { label: "Executions", subtitle: "Agent executions per day" },
  users: { label: "New Users", subtitle: "New user signups per day" }
};

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "N/A";
}

function formatCurrencyFromCents(
  value: number | null | undefined,
  currency: string | null | undefined,
  maximumFractionDigits = 2
) {
  if (typeof value !== "number" || !Number.isFinite(value) || !currency) return "N/A";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits
    }).format(value / 100);
  } catch {
    return "N/A";
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

type MetricCardProps = {
  label: string;
  value: string;
  icon: LucideIcon;
  iconClass: string;
  children: React.ReactNode;
};

function MetricCard({ label, value, icon: Icon, iconClass, children }: MetricCardProps) {
  return (
    <article className="rounded-2xl border border-gray-100 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.05)] transition duration-200 hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.10)]">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-slate-500">{label}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconClass}`}>
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums">{value}</p>
      <div className="mt-2 min-h-6">{children}</div>
    </article>
  );
}

function performanceValue(point: AdminSummary["performance"][number], metric: PerformanceMetric) {
  if (metric === "revenue") return point.revenueCents;
  if (metric === "executions") return point.executions;
  return point.newUsers;
}

function formatPerformanceValue(
  value: number,
  metric: PerformanceMetric,
  revenueCurrency: string | null | undefined
) {
  if (metric === "revenue") return formatCurrencyFromCents(value, revenueCurrency, 0);
  return value.toLocaleString("en-US");
}

function PerformanceChart({
  points,
  metric,
  revenueCurrency
}: {
  points: AdminSummary["performance"];
  metric: PerformanceMetric;
  revenueCurrency: string | null | undefined;
}) {
  const chart = useMemo(() => {
    const validPoints = points.flatMap((point) => {
      const value = performanceValue(point, metric);
      return typeof value === "number" && Number.isFinite(value)
        ? [{ point, value: Math.max(0, value) }]
        : [];
    });
    const values = validPoints.map((entry) => entry.value);
    const maxValue = values.length > 0 ? Math.max(...values) : 0;
    const ceiling = maxValue > 0 ? maxValue * 1.12 : 1;
    const average = values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0;

    return { validPoints, values, ceiling, average };
  }, [metric, points]);

  if (chart.validPoints.length === 0 || (metric === "revenue" && !revenueCurrency)) {
    return (
      <div className="grid h-[260px] place-items-center rounded-xl bg-gray-50 text-sm font-semibold text-slate-400 sm:h-[300px]">
        N/A
      </div>
    );
  }

  const width = 900;
  const height = 320;
  const left = 72;
  const right = 18;
  const top = 16;
  const bottom = 34;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const columnWidth = innerWidth / chart.validPoints.length;
  const barWidth = Math.max(4, Math.min(20, columnWidth * 0.62));
  const y = (value: number) => top + innerHeight - (value / chart.ceiling) * innerHeight;
  const labelEvery = Math.max(1, Math.ceil(chart.validPoints.length / 7));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[260px] w-full sm:h-[300px]"
      role="img"
      aria-label={`${METRIC_CONFIG[metric].label} performance for the last 30 days`}
    >
      <defs>
        <linearGradient id={`admin-performance-${metric}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {Array.from({ length: 5 }, (_, index) => {
        const value = (chart.ceiling / 4) * index;
        const lineY = y(value);
        return (
          <g key={index}>
            <line x1={left} y1={lineY} x2={width - right} y2={lineY} stroke="#f1f5f9" />
            <text x={left - 10} y={lineY + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
              {formatPerformanceValue(Math.round(value), metric, revenueCurrency)}
            </text>
          </g>
        );
      })}
      {chart.validPoints.map(({ point, value }, index) => {
        const barX = left + index * columnWidth + (columnWidth - barWidth) / 2;
        const barY = y(value);
        return (
          <g key={`${point.date}-${index}`}>
            <rect
              x={barX}
              y={barY}
              width={barWidth}
              height={Math.max(1, top + innerHeight - barY)}
              rx={Math.min(4, barWidth / 2)}
              fill={`url(#admin-performance-${metric})`}
            >
              <title>{`${formatShortDate(point.date)}: ${formatPerformanceValue(value, metric, revenueCurrency)}`}</title>
            </rect>
            {(index % labelEvery === 0 || index === chart.validPoints.length - 1) && (
              <text x={barX + barWidth / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="#94a3b8">
                {formatShortDate(point.date)}
              </text>
            )}
          </g>
        );
      })}
      <line
        x1={left}
        y1={y(chart.average)}
        x2={width - right}
        y2={y(chart.average)}
        stroke="#94a3b8"
        strokeWidth="2"
        strokeDasharray="6 5"
      />
    </svg>
  );
}

function activityStyle(type: string): { icon: LucideIcon; className: string } {
  const normalized = type.toLowerCase();
  if (normalized.includes("user") || normalized.includes("signup")) return { icon: UserPlus, className: "bg-blue-50 text-blue-500" };
  if (normalized.includes("payout") || normalized.includes("revenue")) return { icon: CircleDollarSign, className: "bg-emerald-50 text-emerald-600" };
  if (normalized.includes("flag") || normalized.includes("error")) return { icon: Flag, className: "bg-red-50 text-red-500" };
  if (normalized.includes("subscription")) return { icon: Star, className: "bg-purple-50 text-purple-500" };
  return { icon: Bot, className: "bg-amber-50 text-amber-600" };
}

function HealthCard({ label, value, suffix, detail, healthy }: { label: string; value: string; suffix?: string; detail: string; healthy: boolean | null }) {
  const dotClass = healthy === null ? "bg-slate-300 ring-slate-100" : healthy ? "bg-emerald-500 ring-emerald-100" : "bg-red-500 ring-red-100";
  return (
    <article className="rounded-2xl border border-gray-100 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.05)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.10)]">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
        <span className={`h-2.5 w-2.5 rounded-full ring-4 ${dotClass}`} aria-hidden="true" />
        {label}
      </div>
      <p className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">
        {value}{value !== "N/A" && suffix ? <span className="text-base text-slate-400">{suffix}</span> : null}
      </p>
      <p className={`mt-1 text-xs ${healthy === false ? "font-semibold text-red-600" : healthy === true && label === "Error Rate" ? "font-semibold text-emerald-600" : "text-slate-400"}`}>
        {detail}
      </p>
    </article>
  );
}

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [performanceMetric, setPerformanceMetric] = useState<PerformanceMetric>("revenue");

  useEffect(() => {
    let active = true;

    async function load() {
      const result = await getAdminSummary();
      if (!active) return;

      if (result.success && result.data) {
        setSummary(result.data);
        setState("ready");
      } else {
        setState("error");
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="w-full max-w-full">
        <AdminReferenceHeader active="overview" title="Platform Overview" pendingCount={null} />
        <div data-testid="admin-dashboard-loading" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-2xl border border-gray-100 bg-white" />
          ))}
        </div>
      </div>
    );
  }

  if (state === "error" || !summary) {
    return (
      <div className="w-full max-w-full">
        <AdminReferenceHeader active="overview" title="Platform Overview" pendingCount={null} />
        <div data-testid="admin-dashboard-error" className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
          Could not load dashboard data.
        </div>
      </div>
    );
  }

  const revenueChange = summary.revenueChangePercent;
  const platformRevenueAvailable =
    typeof summary.platformRevenueCents === "number" && Boolean(summary.platformRevenueCurrency);
  const revenueImproved = typeof revenueChange === "number" ? revenueChange >= 0 : null;
  const uptime = summary.platformHealth?.apiUptimePercent;
  const responseTime = summary.platformHealth?.avgResponseTimeMs;
  const errorRate = summary.platformHealth?.errorRatePercent;

  return (
    <div className="w-full max-w-full">
      <AdminReferenceHeader
        active="overview"
        title="Platform Overview"
        pendingCount={summary.pendingAgentListings}
      />

      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4" aria-label="Platform metrics">
        <MetricCard
          label="Total Users"
          value={formatNumber(summary.totalUsers)}
          icon={UsersRound}
          iconClass="bg-blue-50 text-blue-500"
        >
          {typeof summary.newUsersThisWeek === "number" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-600">
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              +{summary.newUsersThisWeek.toLocaleString("en-US")} this week
            </span>
          ) : <span className="text-xs font-semibold text-slate-400">N/A</span>}
        </MetricCard>

        <MetricCard
          label="Active Agents"
          value={formatNumber(summary.activeInstalledAgents)}
          icon={Bot}
          iconClass="bg-amber-50 text-amber-600"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-slate-500">marketplace</span>
            <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 tabular-nums">
              {typeof summary.pendingAgentListings === "number" ? `${summary.pendingAgentListings.toLocaleString("en-US")} pending review` : "N/A"}
            </span>
          </div>
        </MetricCard>

        <MetricCard
          label="Platform Revenue"
          value={formatCurrencyFromCents(
            summary.platformRevenueCents,
            summary.platformRevenueCurrency
          )}
          icon={CircleDollarSign}
          iconClass="bg-emerald-50 text-emerald-600"
        >
          {platformRevenueAvailable && typeof revenueChange === "number" ? (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${revenueImproved ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
              {revenueImproved ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />}
              {revenueChange > 0 ? "+" : ""}{revenueChange.toLocaleString("en-US", { maximumFractionDigits: 1 })}% vs last month
            </span>
          ) : <span className="text-xs font-semibold text-slate-400">N/A</span>}
        </MetricCard>

        <MetricCard
          label="Total Executions"
          value={formatNumber(summary.totalExecutions)}
          icon={Zap}
          iconClass="bg-purple-50 text-purple-500"
        >
          <span className="inline-flex rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-slate-500 tabular-nums">
            {typeof summary.avgExecutionsPerDay30d === "number" ? `avg ${summary.avgExecutionsPerDay30d.toLocaleString("en-US", { maximumFractionDigits: 1 })} / day` : "N/A"}
          </span>
        </MetricCard>
      </section>

      <section className="mt-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.05)]" aria-labelledby="performance-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="performance-heading" className="text-lg font-extrabold tracking-tight text-slate-900">Performance · Last 30 days</h2>
            <p className="mt-0.5 text-sm text-slate-400">{METRIC_CONFIG[performanceMetric].subtitle}</p>
          </div>
          <div className="inline-flex self-start rounded-xl bg-gray-100 p-1" role="group" aria-label="Chart metric">
            {(Object.keys(METRIC_CONFIG) as PerformanceMetric[]).map((metric) => (
              <button
                key={metric}
                type="button"
                onClick={() => setPerformanceMetric(metric)}
                aria-pressed={performanceMetric === metric}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${performanceMetric === metric ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.08)]" : "text-slate-500 hover:text-slate-800"}`}
              >
                {METRIC_CONFIG[metric].label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative mt-6">
          <PerformanceChart
            points={summary.performance ?? []}
            metric={performanceMetric}
            revenueCurrency={summary.performanceRevenueCurrency}
          />
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />Daily total</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-slate-400" />30-day average</span>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.05)]" aria-labelledby="recent-activity-heading">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 id="recent-activity-heading" className="text-lg font-extrabold tracking-tight text-slate-900">Recent Activity</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-6 py-3 font-semibold">Time</th>
                <th className="px-6 py-3 font-semibold">Event</th>
                <th className="px-6 py-3 font-semibold">User</th>
                <th className="px-6 py-3 font-semibold">Details</th>
                <th className="px-6 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(summary.recentActivity ?? []).length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-10 text-center font-semibold text-slate-400">N/A</td></tr>
              ) : (summary.recentActivity ?? []).map((item) => {
                const style = activityStyle(item.type);
                const Icon = style.icon;
                return (
                  <tr key={item.id} className="transition-colors hover:bg-gray-50/70">
                    <td className="whitespace-nowrap px-6 py-4 text-xs text-slate-500 tabular-nums">{formatDateTime(item.occurredAt)}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-3 font-semibold text-slate-900">
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${style.className}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
                        {item.event || "N/A"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{item.user || "N/A"}</td>
                    <td className="max-w-md px-6 py-4 text-slate-500">{item.details || "N/A"}</td>
                    <td className="px-6 py-4 text-right text-slate-400">N/A</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <h2 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wider text-slate-400">Platform Health</h2>
      <section className="grid grid-cols-1 gap-5 sm:grid-cols-3" aria-label="Platform health">
        <HealthCard
          label="API Uptime"
          value={typeof uptime === "number" ? uptime.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "N/A"}
          suffix="%"
          detail={typeof uptime === "number" ? "30-day rolling window" : "N/A"}
          healthy={typeof uptime === "number" ? uptime >= 99 : null}
        />
        <HealthCard
          label="Avg Response Time"
          value={typeof responseTime === "number" ? responseTime.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "N/A"}
          suffix="ms"
          detail={typeof responseTime === "number" ? "Across admin API requests" : "N/A"}
          healthy={typeof responseTime === "number" ? responseTime < 1000 : null}
        />
        <HealthCard
          label="Error Rate"
          value={typeof errorRate === "number" ? errorRate.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "N/A"}
          suffix="%"
          detail={typeof errorRate === "number" ? (errorRate < 1 ? "Healthy" : "Needs attention") : "N/A"}
          healthy={typeof errorRate === "number" ? errorRate < 1 : null}
        />
      </section>
    </div>
  );
}
