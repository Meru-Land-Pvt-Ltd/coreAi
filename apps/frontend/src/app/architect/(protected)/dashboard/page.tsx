"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getArchitectListings } from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";
import { formatMoney } from "@/components/architect/ui/architect-ui";
import { getAuthUser } from "@/lib/auth";

const WORKFLOWS_ROUTE = "/architect/workflows" as Route;
const AGENTS_ROUTE = "/architect/agents" as Route;

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
    default:
      return { label: "Draft", text: "text-slate-500", dot: "bg-slate-400" };
  }
}

function NaPanel({ message, testId }: { message: string; testId?: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-6 py-10 text-center" data-testid={testId}>
      <p className="text-2xl font-black tracking-tight text-slate-300">NA</p>
      <p className="mt-1 text-sm font-medium text-slate-400">{message}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  hint,
  testId
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md sm:p-6">
      <div className="flex items-start justify-between">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">{icon}</span>
      </div>
      <p className="mt-4 text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-black tracking-tight text-slate-900" data-testid={testId}>
        {value}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-400">{hint ?? "NA"}</p>
    </div>
  );
}

export default function ArchitectDashboardPage() {
  const [listings, setListings] = useState<ArchitectListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");

  useEffect(() => {
    const user = getAuthUser();
    setName(user?.fullName?.trim() || user?.email?.trim() || "");
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await getArchitectListings();
      if (!active) return;
      if (result.success && result.data) setListings(result.data.listings);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const [agentFilter, setAgentFilter] = useState<AgentFilter>("All");

  const counts = useMemo(
    () => ({
      total: listings.length,
      approved: listings.filter((l) => l.status === "APPROVED").length,
      review: listings.filter((l) => l.status === "PENDING_REVIEW").length,
      draft: listings.filter((l) => l.status === "DRAFT").length
    }),
    [listings]
  );

  const filteredAgents = useMemo(
    () => (agentFilter === "All" ? listings : listings.filter((l) => statusToFilter(l.status) === agentFilter)),
    [listings, agentFilter]
  );

  const topAgents = filteredAgents.slice(0, 6);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-slate-900">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-100 bg-white/90 px-4 py-3.5 shadow-sm backdrop-blur-md sm:px-6 lg:px-8" data-testid="architect-dashboard-topbar">

        <div className="relative mx-auto hidden w-full max-w-md md:block">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search agents, connectors, docs…"
            data-testid="architect-dashboard-search-input"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-16 text-sm text-slate-700 placeholder:text-slate-400 transition focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-100"
          />
        </div>

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
            value="NA"
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
            value="NA"
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
            hint={loading ? "Loading…" : `${counts.total} total · ${counts.review} in review`}
            testId="architect-dashboard-active-agents-text"
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            }
          />
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8" data-testid="architect-dashboard-revenue-section">
          <h2 className="text-lg font-bold text-slate-900" data-testid="architect-dashboard-revenue-overview-heading">Revenue Overview</h2>
          <div className="mt-6">
            <NaPanel message="No revenue data yet." testId="architect-dashboard-revenue-na" />
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
                const meta = agent.tags.length ? agent.tags.slice(0, 2).join(" • ") : "NA";
                return (
                  <div key={agent.id} className="group flex items-center gap-4 border-t border-gray-50 px-5 py-4 transition hover:bg-gray-50 sm:px-6" data-testid={`architect-dashboard-agent-row-${agent.id}`}>
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
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500" data-testid="architect-dashboard-agent-version-text">NA</span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-slate-500" data-testid="architect-dashboard-agent-meta-text">
                        {meta}
                      </p>
                    </div>
                    <div className="hidden items-center gap-8 md:flex">
                      <span className="w-12 text-right font-semibold text-slate-900" data-testid="architect-dashboard-agent-price-text">{formatMoney(agent.priceCents)}</span>
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-500" data-testid="architect-dashboard-agent-installs-text">
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 17 9 11 13 15 21 7" />
                          <polyline points="14 7 21 7 21 14" />
                        </svg>
                        NA
                      </span>
                      <span className="text-sm font-medium text-amber-600" data-testid="architect-dashboard-agent-rating-text">NA</span>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-medium ${status.text}`} data-testid="architect-dashboard-agent-status-text">
                      <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                      {status.label}
                    </span>
                    <Link
                      href={(agent.workflowId ? `/architect/workflows/${agent.workflowId}/builder` : "/architect/agents/publish") as Route}
                      data-testid={`architect-dashboard-agent-open-${agent.id}`}
                      aria-label={`Open ${agent.name}`}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                        <circle cx="5" cy="12" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="19" cy="12" r="1.6" />
                      </svg>
                    </Link>
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
            </div>
            <div className="mt-5">
              <NaPanel message="No recent activity." testId="architect-dashboard-activity-na" />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-slate-900">This Month&apos;s Earnings</h2>
            <div className="mt-5">
              <NaPanel message="No earnings data yet." testId="architect-dashboard-earnings-na" />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
