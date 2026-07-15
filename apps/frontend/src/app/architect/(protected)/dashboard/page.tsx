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

function RevenueChart({
  points
}: {
  points: ArchitectPayoutSummary["chart"]["points"];
}) {
  const values = points.map((point) => point.confirmedCents + point.pendingCents);
  const maxCents = Math.max(...values, 1);
  const yLabels = [1, 0.75, 0.5, 0.25, 0].map((ratio) => formatChartUsd(maxCents * ratio));
  const hasRevenue = values.some((value) => value > 0);

  return (
    <div data-testid="architect-dashboard-revenue-chart">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> Confirmed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-200" /> Pending
          </span>
        </div>
        <span className="text-xs font-medium text-slate-400">Last 12 months</span>
      </div>
      <div className="flex gap-3">
        <div className="flex h-56 w-12 shrink-0 flex-col justify-between text-right text-[11px] text-slate-400">
          {yLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="relative h-56 min-w-0 flex-1 border-b border-slate-200">
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-full flex-col justify-between">
            {Array.from({ length: 5 }).map((_, index) => (
              <span key={index} className="h-px w-full bg-slate-100" />
            ))}
          </div>
          <div className="absolute inset-0 flex items-end justify-around gap-1 px-1 sm:gap-2 sm:px-3">
            {points.map((point, index) => {
              const confirmedHeight = (point.confirmedCents / maxCents) * 100;
              const pendingHeight = (point.pendingCents / maxCents) * 100;
              return (
                <div
                  key={`${point.label}-${index}`}
                  className="group relative flex h-full min-w-0 flex-1 flex-col justify-end pt-7"
                  title={`${point.label}: ${formatUsd(point.confirmedCents)} confirmed, ${formatUsd(point.pendingCents)} pending`}
                >
                  <div className="absolute left-1/2 top-0 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow-lg group-hover:block">
                    {formatUsd(point.confirmedCents + point.pendingCents)}
                  </div>
                  <div
                    className="w-full rounded-t bg-amber-200 transition-all group-hover:bg-amber-300"
                    style={{ height: `${pendingHeight}%`, minHeight: point.pendingCents > 0 ? 2 : 0 }}
                  />
                  <div
                    className="w-full bg-amber-500 transition-all group-hover:bg-amber-600"
                    style={{ height: `${confirmedHeight}%`, minHeight: point.confirmedCents > 0 ? 2 : 0 }}
                  />
                </div>
              );
            })}
          </div>
          {!hasRevenue ? (
            <div className="absolute inset-0 grid place-items-center text-sm font-medium text-slate-400">
              No revenue recorded yet
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex gap-3">
        <div className="w-12 shrink-0" />
        <div className="flex flex-1 justify-around text-[10px] font-medium text-slate-400 sm:text-[11px]" data-testid="architect-dashboard-revenue-x-axis">
          {points.map((point, index) => (
            <span key={`${point.label}-${index}`}>{point.label}</span>
          ))}
        </div>
      </div>
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

function activityTone(type: ArchitectDashboardActivity["type"]) {
  if (type === "SALE") return "bg-green-50 text-green-600";
  if (type === "PAYOUT") return "bg-blue-50 text-blue-600";
  return "bg-amber-50 text-amber-600";
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
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-xl bg-gray-50" />
        ))}
      </div>
    );
  }

  if (!activities.length) {
    return <NaPanel message="No recent activity." testId="architect-dashboard-activity-na" />;
  }

  return (
    <div className="divide-y divide-gray-100" data-testid="architect-dashboard-activity-feed">
      {activities.map((activity) => (
        <div key={activity.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${activityTone(activity.type)}`}>
            {activity.type === "SALE" ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            ) : activity.type === "PAYOUT" ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
                <path d="M5 21h14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="8" width="16" height="12" rx="2.5" />
                <path d="M12 8V4.5" />
              </svg>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{activity.title}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{activity.description}</p>
              </div>
              {typeof activity.amountCents === "number" ? (
                <span className="shrink-0 text-sm font-semibold text-green-600">
                  {activity.type === "PAYOUT" ? "" : "+"}{formatUsd(activity.amountCents)}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
              <span>{formatRelativeTime(activity.occurredAt)}</span>
              <span aria-hidden="true">&middot;</span>
              <span>{activity.status}</span>
            </div>
          </div>
        </div>
      ))}
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

  useEffect(() => {
    const user = getAuthUser();
    setName(user?.fullName?.trim() || user?.email?.trim() || "");
  }, []);

  const loadListings = useCallback(async () => {
    const result = await getArchitectListings();
    if (result.success && result.data) setListings(result.data.listings);
    setLoading(false);
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
  const currentMonthPendingCents =
    payoutSummary?.chart.points[payoutSummary.chart.points.length - 1]?.pendingCents ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-slate-900">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-100 bg-white/90 px-4 py-3.5 shadow-sm backdrop-blur-md sm:px-6 lg:px-8" data-testid="architect-dashboard-topbar">

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
            <span className="hidden sm:inline">Create New Agent</span>
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
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            }
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900" data-testid="architect-dashboard-revenue-overview-heading">Revenue Overview</h2>
              <p className="mt-1 text-sm text-slate-500">Confirmed and pending architect earnings from agent sales.</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Pending</p>
              <p className="mt-1 text-sm font-bold text-amber-600" data-testid="architect-dashboard-pending-earnings-text">
                {financialLoading ? "—" : formatUsd(payoutSummary?.pendingCents ?? 0)}
              </p>
            </div>
          </div>
          <div className="mt-6">
            {financialLoading ? (
              <div className="h-72 animate-pulse rounded-xl bg-gray-50" />
            ) : (
              <RevenueChart points={payoutSummary?.chart.points ?? []} />
            )}
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
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 17 9 11 13 15 21 7" />
                          <polyline points="14 7 21 7 21 14" />
                        </svg>
                        {agent.installCount ?? 0} Installs
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
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Activity</h2>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" /> Live
              </span>
            </div>
            <div className="mt-5">
              <ActivityFeed activities={activities} loading={activityLoading} />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-slate-900">This Month&apos;s Earnings</h2>
            {financialLoading ? (
              <div className="mt-5 h-32 animate-pulse rounded-xl bg-gray-50" />
            ) : (
              <div className="mt-5" data-testid="architect-dashboard-monthly-earnings">
                <p className="text-4xl font-black tracking-tight text-slate-900">
                  {formatUsd(payoutSummary?.thisMonthEarningsCents ?? 0)}
                </p>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  {payoutSummary?.thisMonthLabel ?? "This month"}
                </p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-green-50 p-3">
                    <p className="text-xs font-medium text-green-700">Approved sales</p>
                    <p className="mt-1 text-xl font-bold text-green-700">
                      {payoutSummary?.thisMonthSalesCount ?? 0}
                    </p>
                  </div>
                  <div className="rounded-xl bg-amber-50 p-3">
                    <p className="text-xs font-medium text-amber-700">Pending this month</p>
                    <p className="mt-1 text-xl font-bold text-amber-700">
                      {formatUsd(currentMonthPendingCents)}
                    </p>
                  </div>
                </div>
                <Link
                  href="/architect/payouts"
                  className="mt-5 inline-flex text-sm font-semibold text-amber-600 hover:text-amber-700"
                >
                  View payout details →
                </Link>
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
