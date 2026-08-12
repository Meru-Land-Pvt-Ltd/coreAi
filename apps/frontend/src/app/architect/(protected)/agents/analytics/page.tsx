"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  downloadArchitectAgentAnalyticsReport,
  getArchitectAgentAnalytics,
  getAllArchitectListings,
  type ArchitectAgentAnalytics,
  type ArchitectAgentAnalyticsRange
} from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";
import { architectAnalyticsPath } from "@/lib/routes";

const RANGES: ArchitectAgentAnalyticsRange[] = ["7D", "30D", "90D", "6M", "1Y"];

function formatMoney(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds.toLocaleString("en-US", { maximumFractionDigits: 1 })}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatRelativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60]
  ];

  for (const [unit, unitSeconds] of ranges) {
    if (Math.abs(seconds) >= unitSeconds) {
      return formatter.format(Math.round(seconds / unitSeconds), unit);
    }
  }

  return formatter.format(seconds, "second");
}

function formatClock(value: string) {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
}

function listingStatus(status: ArchitectListing["status"]) {
  switch (status) {
    case "APPROVED":
      return { label: "Live", className: "bg-green-50 text-green-700" };
    case "PENDING_REVIEW":
      return { label: "In review", className: "bg-amber-50 text-amber-700" };
    case "REJECTED":
      return { label: "Rejected", className: "bg-red-50 text-red-700" };
    case "SUSPENDED":
      return { label: "Suspended", className: "bg-red-50 text-red-700" };
    case "PAUSED":
      return { label: "Paused", className: "bg-amber-50 text-amber-700" };
    default:
      return { label: "Draft", className: "bg-slate-100 text-slate-600" };
  }
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  visual
}: {
  label: string;
  value: string;
  detail: ReactNode;
  icon: ReactNode;
  visual?: ReactNode;
}) {
  return (
    <div className="group rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
          {icon}
        </span>
        {visual}
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-black tracking-tight text-slate-900">{value}</p>
      <div className="mt-2 text-xs font-semibold text-slate-500">{detail}</div>
    </div>
  );
}

function MiniSparkline({ values }: { values: number[] }) {
  const width = 74;
  const height = 30;
  const max = Math.max(...values, 1);
  const points = values.length
    ? values.map((value, index) => {
        const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
        const y = height - 3 - (value / max) * (height - 7);
        return `${x},${y}`;
      }).join(" ")
    : `0,${height - 3} ${width},${height - 3}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="#d97706"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SuccessRing({ value }: { value: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, value)) / 100);
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" aria-label={`${value}% success rate`}>
      <circle cx="23" cy="23" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="5" />
      <circle
        cx="23"
        cy="23"
        r={radius}
        fill="none"
        stroke="#d97706"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 23 23)"
      />
    </svg>
  );
}

type ChartPoint = [number, number];

function smoothChartPath(points: ChartPoint[]) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0]![0]} ${points[0]![1]}`;
  let path = `M ${points[0]![0]} ${points[0]![1]}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const after = points[Math.min(points.length - 1, index + 2)]!;
    const controlOneX = current[0] + (next[0] - previous[0]) / 6;
    const controlOneY = current[1] + (next[1] - previous[1]) / 6;
    const controlTwoX = next[0] - (after[0] - current[0]) / 6;
    const controlTwoY = next[1] - (after[1] - current[1]) / 6;
    path += ` C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${next[0]} ${next[1]}`;
  }
  return path;
}

function chartAxisValue(value: number) {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(Math.round(value));
}

function chartAxisMoney(cents: number) {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${Math.round(dollars / 100_000) / 10}m`;
  if (dollars >= 1_000) return `$${Math.round(dollars / 100) / 10}k`;
  return `$${Math.round(dollars)}`;
}

function visibleChartLabel(index: number, total: number) {
  if (total <= 8) return true;
  const step = Math.ceil((total - 1) / 6);
  return index === 0 || index === total - 1 || index % step === 0;
}

function ExecutionChart({ series }: { series: ArchitectAgentAnalytics["series"] }) {
  const width = 1000;
  const height = 310;
  const left = 62;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(...series.map((point) => Math.max(point.successful, point.failed)), 1);
  const yMaximum = Math.max(1, Math.ceil(maximum * 1.15));
  const xAt = (index: number) => left + (series.length <= 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);
  const yAt = (value: number) => top + plotHeight - (value / yMaximum) * plotHeight;
  const successfulPoints: ChartPoint[] = series.map((point, index) => [xAt(index), yAt(point.successful)]);
  const failedPoints: ChartPoint[] = series.map((point, index) => [xAt(index), yAt(point.failed)]);
  const successfulPath = smoothChartPath(successfulPoints);
  const failedPath = smoothChartPath(failedPoints);
  const areaPath = successfulPoints.length
    ? `${successfulPath} L ${successfulPoints.at(-1)![0]} ${top + plotHeight} L ${successfulPoints[0]![0]} ${top + plotHeight} Z`
    : "";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Executions</h2>
          <p className="mt-1 text-xs text-slate-400">Successful vs failed runs over the selected period</p>
        </div>
        <div className="flex items-center gap-5 text-xs font-medium text-slate-600">
          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Successful</span>
          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" />Failed</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[310px] min-w-[720px] w-full" role="img" aria-label="Successful and failed executions over time">
          <defs>
            <linearGradient id="execution-area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {Array.from({ length: 5 }).map((_, index) => {
            const y = top + (index / 4) * plotHeight;
            const value = yMaximum * (1 - index / 4);
            return (
              <g key={index}>
                <line x1={left} y1={y} x2={width - right} y2={y} stroke="#e8eef6" strokeDasharray="4 5" />
                <text x={left - 12} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="12">{chartAxisValue(value)}</text>
              </g>
            );
          })}
          <path d={areaPath} fill="url(#execution-area-fill)" />
          <path d={successfulPath} fill="none" stroke="#e99a05" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d={failedPath} fill="none" stroke="#fb7185" strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round" />
          {series.map((point, index) => (
            <g key={`${point.label}-${index}`}>
              <circle cx={xAt(index)} cy={yAt(point.successful)} r="8" fill="transparent"><title>{`${point.label}: ${point.successful} successful`}</title></circle>
              <circle cx={xAt(index)} cy={yAt(point.failed)} r="8" fill="transparent"><title>{`${point.label}: ${point.failed} failed`}</title></circle>
              {visibleChartLabel(index, series.length) ? <text x={xAt(index)} y={height - 10} textAnchor="middle" fill="#94a3b8" fontSize="12">{point.label}</text> : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function RevenueChart({ series }: { series: ArchitectAgentAnalytics["series"] }) {
  const width = 1000;
  const height = 285;
  const left = 62;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = series.map((point) => point.revenueCents + point.pendingRevenueCents);
  const maximum = Math.max(...values, 1);
  const yMaximum = Math.max(1, Math.ceil(maximum * 1.15));
  const slotWidth = plotWidth / Math.max(series.length, 1);
  const barWidth = Math.min(58, slotWidth * 0.58);
  const totalRevenue = values.reduce((sum, value) => sum + value, 0);
  const lastValue = values.at(-1) ?? 0;
  const trend = values.length > 1 ? (lastValue - values[0]!) / (values.length - 1) : 0;
  const projectedRevenue = Math.max(0, Math.round(lastValue + trend));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Revenue</h2>
          <p className="mt-1 text-xs text-slate-400">Approved and pending earnings generated by this agent</p>
        </div>
        <span className="rounded-xl bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700">Total&nbsp; {formatMoney(totalRevenue)}</span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[285px] min-w-[720px] w-full" role="img" aria-label="Agent revenue over time">
          <defs>
            <linearGradient id="revenue-bar-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffd000" />
              <stop offset="100%" stopColor="#e3a91b" />
            </linearGradient>
          </defs>
          {Array.from({ length: 5 }).map((_, index) => {
            const y = top + (index / 4) * plotHeight;
            const value = yMaximum * (1 - index / 4);
            return (
              <g key={index}>
                <line x1={left} y1={y} x2={width - right} y2={y} stroke="#e8eef6" strokeDasharray="4 5" />
                <text x={left - 12} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="12">{chartAxisMoney(value)}</text>
              </g>
            );
          })}
          {series.map((point, index) => {
            const value = values[index] ?? 0;
            const barHeight = (value / yMaximum) * plotHeight;
            const x = left + index * slotWidth + (slotWidth - barWidth) / 2;
            const y = top + plotHeight - barHeight;
            return (
              <g key={`${point.label}-${index}`}>
                <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, value ? 2 : 0)} rx="8" fill="url(#revenue-bar-fill)">
                  <title>{`${point.label}: ${formatMoney(value)}`}</title>
                </rect>
                {visibleChartLabel(index, series.length) ? <text x={x + barWidth / 2} y={height - 10} textAnchor="middle" fill="#94a3b8" fontSize="12">{point.label}</text> : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 17 6-6 4 4 7-8" /><path d="M17 7h4v4" /></svg>
        <span className="text-slate-500">Projected next period:</span>
        <span className="font-bold text-amber-600">{formatMoney(projectedRevenue)}</span>
      </div>
    </div>
  );
}

function ClientRetention({ retention }: { retention: ArchitectAgentAnalytics["retention"] }) {
  const headings = ["At hire", "1 wk", "2 wks", "4 wks"];
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Client Retention</h2>
          <p className="mt-1 text-xs text-slate-400">Cohort activity after each client installed this agent</p>
        </div>
        <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">By install week</span>
      </div>
      {retention.cohorts.length ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-separate [border-spacing:4px]">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="pb-1 pr-2 text-left">Cohort</th>
                  {headings.map((heading) => <th key={heading} className="pb-1 text-center">{heading}</th>)}
                </tr>
              </thead>
              <tbody>
                {retention.cohorts.map((cohort) => (
                  <tr key={cohort.label}>
                    <td className="whitespace-nowrap pr-2 text-left text-xs font-semibold text-slate-600">
                      {cohort.label}
                      <span className="ml-1 font-normal text-slate-400">({cohort.installCount})</span>
                    </td>
                    {cohort.values.map((value, index) => {
                      const opacity = value === null ? 0.06 : 0.12 + (value / 100) * 0.8;
                      return (
                        <td key={headings[index]} className="text-center">
                          <div
                            className="rounded-lg py-2 text-xs font-bold"
                            style={{
                              backgroundColor: `rgba(217, 119, 6, ${opacity})`,
                              color: value !== null && value >= 72 ? "#ffffff" : "#92400e"
                            }}
                            title={value === null ? "This retention window has not completed yet" : `${cohort.label} cohort: ${value}% retained`}
                          >
                            {value === null ? "—" : `${value}%`}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-amber-50/70 px-4 py-3">
            <span className="text-xs font-medium text-slate-600">Average 4-week retention</span>
            <span className="text-lg font-black text-amber-700">
              {retention.averageFourWeekPercent === null ? "Pending" : `${retention.averageFourWeekPercent}%`}
            </span>
          </div>
        </>
      ) : (
        <EmptyState message="Retention appears after this agent has client installations." />
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-6 text-center text-sm font-medium text-slate-400">
      {message}
    </div>
  );
}

export default function ArchitectAgentAnalyticsPage() {
  const router = useRouter();
  const [listings, setListings] = useState<ArchitectListing[]>([]);
  const [selectedListingId, setSelectedListingId] = useState("");
  const [range, setRange] = useState<ArchitectAgentAnalyticsRange>("6M");
  const [analytics, setAnalytics] = useState<ArchitectAgentAnalytics | null>(null);
  const [loadingListings, setLoadingListings] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [livePaused, setLivePaused] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;

    async function loadListings() {
      const result = await getAllArchitectListings();
      if (!active) return;

      if (!result.success || !result.data) {
        setError(result.error ?? "Could not load your agents");
        setLoadingListings(false);
        return;
      }

      const availableListings = result.data.listings;
      const requestedId = new URLSearchParams(window.location.search).get("listingId") ?? "";
      const selected =
        availableListings.find((listing) => listing.id === requestedId) ??
        availableListings.find((listing) => listing.status === "APPROVED") ??
        availableListings[0];

      setListings(availableListings);
      setSelectedListingId(selected?.id ?? "");
      if (selected && selected.id !== requestedId) {
        router.replace(architectAnalyticsPath(selected.id), { scroll: false });
      }
      setLoadingListings(false);
    }

    void loadListings();
    return () => {
      active = false;
    };
  }, [router]);

  const loadAnalytics = useCallback(
    async (showLoading = false) => {
      if (!selectedListingId) return;
      if (showLoading) setLoadingAnalytics(true);

      const result = await getArchitectAgentAnalytics(selectedListingId, range);
      if (result.success && result.data) {
        setAnalytics(result.data);
        setError("");
      } else {
        setError(result.error ?? "Could not load agent analytics");
      }
      if (showLoading) setLoadingAnalytics(false);
    },
    [range, selectedListingId]
  );

  useEffect(() => {
    if (!selectedListingId) return;
    setAnalytics(null);
    void loadAnalytics(true);
  }, [loadAnalytics, selectedListingId]);

  useEffect(() => {
    if (!selectedListingId || livePaused) return;
    const interval = window.setInterval(() => void loadAnalytics(false), 30_000);
    return () => window.clearInterval(interval);
  }, [livePaused, loadAnalytics, selectedListingId]);

  const selectedListing = useMemo(
    () => listings.find((listing) => listing.id === selectedListingId) ?? null,
    [listings, selectedListingId]
  );
  const status = selectedListing ? listingStatus(selectedListing.status) : null;

  function selectAgent(listingId: string) {
    setSelectedListingId(listingId);
    router.replace(architectAnalyticsPath(listingId), { scroll: false });
  }

  async function exportReport() {
    if (!selectedListingId || exporting) return;
    setExporting(true);
    setNotice("");
    const result = await downloadArchitectAgentAnalyticsReport(selectedListingId, range);
    setExporting(false);
    if (result.success) {
      setNotice(`Downloaded the complete ${range} report for ${selectedListing?.name ?? "this agent"}.`);
      window.setTimeout(() => setNotice(""), 3500);
    } else {
      setError(result.error ?? "Could not export this report");
    }
  }

  if (loadingListings) {
    return (
      <div className="min-h-screen bg-gray-50 p-6" data-testid="architect-agent-analytics-loading">
        <div className="animate-pulse space-y-6">
          <div className="h-16 rounded-2xl bg-white" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-36 rounded-2xl bg-white" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!listings.length) {
    return (
      <div className="min-h-screen bg-gray-50 p-6" data-testid="architect-agent-analytics-empty">
        <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Agent Analytics</h1>
          <p className="mt-2 text-sm text-slate-500">Create and publish an agent to start collecting analytics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900" data-testid="architect-analytics-page">
      <header className="border-b border-gray-100 bg-white/90 px-4 py-3 shadow-sm sm:px-6 lg:sticky lg:top-0 lg:z-30 lg:backdrop-blur-md lg:px-8">
        <div className="flex min-h-10 flex-col gap-3 md:flex-row md:items-center">
          <h1 className="whitespace-nowrap text-xl font-bold tracking-tight sm:text-2xl">Agent Analytics</h1>
          <div className="flex flex-1 justify-center">
            <label htmlFor="analytics-agent" className="sr-only">Agent</label>
            <select
              id="analytics-agent"
              value={selectedListingId}
              onChange={(event) => selectAgent(event.target.value)}
              data-testid="architect-agent-analytics-selector"
              className="w-full max-w-md rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none transition focus:border-amber-300 focus:bg-white focus:ring-2 focus:ring-amber-100"
            >
              {listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.name}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void exportReport()}
            disabled={exporting || !analytics}
            data-testid="architect-agent-analytics-export-button"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-amber-600 to-yellow-400 px-4 py-2.5 text-sm font-semibold text-[#1a1206] shadow-lg shadow-amber-200/60 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
            </svg>
            {exporting ? "Exporting…" : "Export Report"}
          </button>
        </div>
      </header>

      <main className="space-y-6 p-4 pb-24 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">{selectedListing?.name}</h2>
              {status ? <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span> : null}
            </div>
            <div className="mt-1 inline-flex items-center gap-2 text-xs font-semibold text-emerald-600">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
              {analytics ? `Live data · updated ${formatRelativeTime(analytics.refreshedAt)}` : "Loading live analytics…"}
            </div>
          </div>
          <div className="inline-flex items-center gap-1 rounded-xl border border-gray-100 bg-white p-1 shadow-sm" aria-label="Analytics date range">
            {RANGES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setRange(item)}
                className={range === item ? "rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white" : "rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-gray-50 hover:text-slate-700"}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}
        {notice ? <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl" role="status">{notice}</div> : null}

        {loadingAnalytics && !analytics ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl bg-white" />)}
          </div>
        ) : analytics ? (
          <>
            <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4" aria-label="Agent metrics">
              <MetricCard
                label="Total executions"
                value={analytics.metrics.totalExecutions.toLocaleString("en-US")}
                detail={`${analytics.metrics.runningExecutions} currently running`}
                icon={<svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" /></svg>}
                visual={<span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />LIVE</span>}
              />
              <MetricCard
                label="Success rate"
                value={`${analytics.metrics.successRate}%`}
                detail={`${analytics.metrics.successfulExecutions} successful · ${analytics.metrics.failedExecutions} failed`}
                icon={<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                visual={<SuccessRing value={analytics.metrics.successRate} />}
              />
              <MetricCard
                label="Average execution time"
                value={formatDuration(analytics.metrics.averageExecutionSeconds)}
                detail={`${analytics.metrics.callCount} voice calls in this range`}
                icon={<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>}
                visual={<MiniSparkline values={analytics.series.map((point) => point.successful + point.failed + point.running)} />}
              />
              <MetricCard
                label="Revenue generated"
                value={formatMoney(analytics.metrics.revenueCents)}
                detail={`${formatMoney(analytics.metrics.pendingRevenueCents)} pending`}
                icon={<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
                visual={<MiniSparkline values={analytics.series.map((point) => point.revenueCents + point.pendingRevenueCents)} />}
              />
            </section>

            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
              <ExecutionChart series={analytics.series} />
            </section>

            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
              <RevenueChart series={analytics.series} />
            </section>

            <ClientRetention retention={analytics.retention} />

            <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-5 sm:px-6">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold text-slate-900">Live Executions</h2>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${livePaused ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-600"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${livePaused ? "bg-slate-400" : "animate-pulse bg-emerald-500"}`} />
                    {livePaused ? "Paused" : "Real-time"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setLivePaused((current) => !current)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-gray-50 hover:text-slate-700"
                >
                  {livePaused ? (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                  )}
                  {livePaused ? "Resume" : "Pause"}
                </button>
              </div>
              {analytics.recentExecutions.length ? (
                <ul className="max-h-[300px] divide-y divide-gray-50 overflow-y-auto" aria-live="polite" aria-label="Live execution feed">
                  {analytics.recentExecutions.map((execution) => {
                    const successful = execution.status === "SUCCESS";
                    const failed = execution.status === "FAILED";
                    return (
                      <li key={execution.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${successful ? "bg-emerald-500" : failed ? "bg-rose-500" : "bg-blue-500"}`} />
                        <time className="w-[82px] shrink-0 font-mono text-[11px] text-slate-400" dateTime={execution.occurredAt}>{formatClock(execution.occurredAt)}</time>
                        <span className="min-w-0 flex-1 truncate">
                          <span className={`text-[13px] font-medium ${failed ? "text-rose-700" : "text-slate-700"}`}>{selectedListing?.name}</span>
                          <span className="text-xs text-slate-400"> · {execution.businessName}</span>
                        </span>
                        {successful ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-600">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5" /></svg>
                            {execution.durationSeconds === null ? "Done" : formatDuration(execution.durationSeconds)}
                          </span>
                        ) : failed ? (
                          <span className="inline-flex max-w-40 shrink-0 items-center gap-1 truncate text-xs font-semibold text-rose-600" title={execution.error ?? "Execution failed"}>
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                            {execution.error ?? "Execution failed"}
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs font-semibold text-blue-600">Running</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : <div className="p-6"><EmptyState message="No executions recorded for this agent in the selected range." /></div>}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
