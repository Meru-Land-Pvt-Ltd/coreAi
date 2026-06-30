"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatDate, formatMoney } from "@/components/architect/ui/architect-ui";
import { deleteArchitectWorkflow, getArchitectListings } from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";
import { getAuthUser } from "@/lib/auth";
import { architectPublishingStatusPath } from "@/lib/routes";

type AgentStatus = ArchitectListing["status"];

const MY_AGENTS_STYLES = `
@keyframes myAgentsPulseDot {
  0%   { box-shadow: 0 0 0 0 rgba(34,197,94,.5); }
  70%  { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
  100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
}
.ma-pulse-dot { animation: myAgentsPulseDot 3s ease-out infinite; }
@keyframes myAgentsSpin { to { transform: rotate(360deg); } }
.ma-spin-slow { animation: myAgentsSpin 2.6s linear infinite; transform-origin: center; }
@media (prefers-reduced-motion: reduce) {
  .ma-pulse-dot, .ma-spin-slow { animation: none !important; }
}
`;

const STATUS_STYLES: Record<
  AgentStatus,
  {
    label: string;
    pill: string;
    iconBg: string;
    iconBorder: string;
    iconText: string;
  }
> = {
  APPROVED: {
    label: "Live",
    pill: "bg-green-50 text-green-700",
    iconBg: "bg-green-50",
    iconBorder: "border-green-100",
    iconText: "text-green-600"
  },
  PENDING_REVIEW: {
    label: "Under Review",
    pill: "bg-amber-50 text-amber-700",
    iconBg: "bg-amber-50",
    iconBorder: "border-amber-100",
    iconText: "text-amber-600"
  },
  DRAFT: {
    label: "Draft",
    pill: "bg-slate-100 text-slate-600",
    iconBg: "bg-slate-50",
    iconBorder: "border-slate-100",
    iconText: "text-slate-500"
  },
  REJECTED: {
    label: "Rejected",
    pill: "bg-red-50 text-red-700",
    iconBg: "bg-red-50",
    iconBorder: "border-red-100",
    iconText: "text-red-600"
  },
  SUSPENDED: {
    label: "Suspended",
    pill: "bg-red-50 text-red-700",
    iconBg: "bg-red-50",
    iconBorder: "border-red-100",
    iconText: "text-red-600"
  }
};

function PhoneGlyph() {
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function SpinnerGlyph() {
  return (
    <svg
      className="ma-spin-slow h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2v4" />
      <path d="m16.2 7.8 2.9-2.9" />
      <path d="M18 12h4" />
      <path d="m16.2 16.2 2.9 2.9" />
      <path d="M12 18v4" />
      <path d="m4.9 19.1 2.9-2.9" />
      <path d="M2 12h4" />
      <path d="m4.9 4.9 2.9 2.9" />
    </svg>
  );
}

function StatusPill({ status }: { status: AgentStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.pill}`}
      data-testid="my-agents-status-pill"
    >
      {status === "APPROVED" ? (
        <span className="ma-pulse-dot h-1.5 w-1.5 rounded-full bg-green-500" />
      ) : status === "PENDING_REVIEW" ? (
        <SpinnerGlyph />
      ) : status === "REJECTED" || status === "SUSPENDED" ? (
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      ) : null}
      {style.label}
    </span>
  );
}

function StatusBand({ agent }: { agent: ArchitectListing }) {
  if (agent.status === "PENDING_REVIEW") {
    return (
      <div
        className="border-t border-amber-100 bg-amber-50/60 px-5 py-3"
        data-testid={`my-agents-review-notice-${agent.id}`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-amber-700">Review in progress</span>
          <span className="text-xs text-amber-600">Pending</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-amber-100">
          <div className="h-full w-2/3 rounded-full bg-amber-500" />
        </div>
        <p className="mt-1.5 text-xs text-amber-600">Will be live in 24–48 hrs after review</p>
      </div>
    );
  }

  if (agent.status === "DRAFT") {
    return (
      <div className="border-t border-gray-100 bg-slate-50 px-5 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">Completion</span>
          <span className="text-xs text-slate-400">Draft</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div className="h-full w-1/3 rounded-full bg-slate-400" />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">Finish setup and publish to go live</p>
      </div>
    );
  }

  if (agent.status === "REJECTED" || agent.status === "SUSPENDED") {
    return (
      <div className="border-t border-red-100 bg-red-50/60 px-5 py-3">
        <p className="text-xs font-medium text-red-600">
          {agent.status === "REJECTED"
            ? "Changes requested — edit and resubmit."
            : "Suspended — contact support to restore."}
        </p>
      </div>
    );
  }

  // APPROVED / live — surface the real listing facts we have.
  return (
    <div className="grid grid-cols-3 gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
      <div>
        <div className="text-[11px] text-slate-400">Price</div>
        <div className="text-sm font-bold text-amber-600">{formatMoney(agent.priceCents)}</div>
      </div>
      <div>
        <div className="text-[11px] text-slate-400">Connectors</div>
        <div className="text-sm font-bold text-slate-900">{agent.requiredConnectors.length}</div>
      </div>
      <div>
        <div className="text-[11px] text-slate-400">Models</div>
        <div className="text-sm font-bold text-slate-900">{agent.supportedLlms.length}</div>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  architectName,
  onDeleted
}: {
  agent: ArchitectListing;
  architectName: string;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const style = STATUS_STYLES[agent.status];
  const [deleting, setDeleting] = useState(false);

  const editHref = (agent.workflowId
    ? `/architect/workflows/${agent.workflowId}/builder`
    : "/architect/agents/publish") as Route;

  // Under-review and live agents open the publishing-status page.
  const isStatusViewable = agent.status === "PENDING_REVIEW" || agent.status === "APPROVED";
  const statusHref = architectPublishingStatusPath(agent.id);

  const actionHref = isStatusViewable ? statusHref : editHref;

  const actionLabel =
    agent.status === "DRAFT"
      ? "Continue Building"
      : agent.status === "PENDING_REVIEW"
        ? "View status"
        : agent.status === "APPROVED"
          ? "View status"
          : agent.status === "REJECTED"
            ? "Edit & resubmit"
            : "Manage";

  const dashed = agent.status === "DRAFT" ? "border-dashed border-gray-200" : "border-gray-100";

  const canDelete = agent.status === "DRAFT" && Boolean(agent.workflowId);

  async function handleDelete(event: React.MouseEvent) {
    event.stopPropagation();
    if (!agent.workflowId || deleting) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete draft "${agent.name}"? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    const result = await deleteArchitectWorkflow(agent.workflowId);
    setDeleting(false);

    if (result.success) {
      onDeleted();
    }
  }

  function handleCardClick() {
    if (!isStatusViewable) return;
    router.push(statusHref);
  }

  return (
    <article
      data-testid={`my-agents-card-${agent.id}`}
      onClick={isStatusViewable ? handleCardClick : undefined}
      role={isStatusViewable ? "button" : undefined}
      tabIndex={isStatusViewable ? 0 : undefined}
      onKeyDown={
        isStatusViewable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleCardClick();
              }
            }
          : undefined
      }
      className={`group flex flex-col overflow-hidden rounded-2xl border ${dashed} bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-md ${
        isStatusViewable ? "cursor-pointer" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${style.iconBg} ${style.iconBorder} ${style.iconText}`}
        >
          <PhoneGlyph />
        </span>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusPill status={agent.status} />
          <span
            className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white"
            data-testid="architect-ui-my-agents-view-format-money-agent-price-cents-text"
          >
            {formatMoney(agent.priceCents)}
          </span>
        </div>
      </div>

      <div className="min-w-0 px-5 pb-3">
        <h2
          className="truncate text-base font-semibold text-slate-900"
          data-testid="architect-ui-my-agents-view-agent-heading"
        >
          {agent.name}
        </h2>

        <p
          className="mt-0.5 truncate text-xs text-slate-500"
          data-testid="architect-ui-my-agents-view-agent-workflow-from-agent-workflow-marketplace-package-text"
        >
          by {architectName}
        </p>

        <p
          className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-500"
          data-testid="architect-ui-my-agents-view-agent-short-description-no-description-added-yet-text"
        >
          {agent.shortDescription || "No description added yet."}
        </p>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {agent.tags.length ? (
            agent.tags.slice(0, 3).map((tag) => (
              <span
                key={`${agent.id}-${tag}`}
                className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
                data-testid="architect-ui-my-agents-view-tag-text"
              >
                {tag}
              </span>
            ))
          ) : (
            <span
              className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-slate-500"
              data-testid="architect-ui-my-agents-view-no-tags-text"
            >
              No tags
            </span>
          )}
        </div>
      </div>

      <div className="mt-auto">
        <StatusBand agent={agent} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
        <span
          className="whitespace-nowrap text-xs text-slate-400"
          data-testid="architect-ui-my-agents-view-format-date-agent-created-at-text"
        >
          Created {formatDate(agent.createdAt)}
        </span>

        <div className="flex items-center gap-1.5">
          {canDelete ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              data-testid={`my-agents-delete-${agent.id}-button`}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M10 11v6M14 11v6" />
              </svg>
              {deleting ? "Deleting…" : "Delete"}
            </button>
          ) : null}

          <Link
            data-testid={`my-agents-update-${agent.id}-link`}
            href={actionHref}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-50"
          >
            {actionLabel}
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </article>
  );
}

function EmptyAgentsState() {
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-500">
        <svg
          className="h-8 w-8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="8" width="16" height="12" rx="2.5" />
          <path d="M12 8V4.5" />
          <circle cx="9" cy="14" r="1.1" />
          <circle cx="15" cy="14" r="1.1" />
        </svg>
      </span>

      <h3
        className="mt-4 text-lg font-semibold text-slate-700"
        data-testid="architect-ui-my-agents-view-publish-new-agent-heading"
      >
        No agents yet
      </h3>
      <p
        className="mt-2 text-sm text-slate-500"
        data-testid="architect-ui-my-agents-view-start-with-an-empty-canvas-then-load-text"
      >
        Create your first agent or pick a template from the gallery to get started.
      </p>

      <Link
        data-testid="my-agents-empty-publish-agent-link"
        href={"/architect/workflows" as Route}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Create Agent
      </Link>
    </div>
  );
}

type AgentFilter = "ALL" | "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

const FILTER_TABS: { value: AgentFilter; label: string; dot?: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "PENDING_REVIEW", label: "Under Review", dot: "bg-amber-400" },
  { value: "APPROVED", label: "Live", dot: "bg-green-500" },
  { value: "REJECTED", label: "Rejected" }
];

export function MyAgentsView() {
  const searchParams = useSearchParams();
  const [agents, setAgents] = useState<ArchitectListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [architectName, setArchitectName] = useState("Architect");
  const [filter, setFilter] = useState<AgentFilter>("ALL");

  useEffect(() => {
    const user = getAuthUser();
    const name = user?.fullName?.trim() || user?.email?.trim() || "Architect";
    setArchitectName(name);
  }, []);

  // Honor a ?filter=live (or status) query so other pages can deep-link here.
  useEffect(() => {
    const requested = searchParams.get("filter");
    if (!requested) return;

    const normalized = requested.toLowerCase();
    if (normalized === "live" || normalized === "approved") setFilter("APPROVED");
    else if (normalized === "draft") setFilter("DRAFT");
    else if (normalized === "pending_review" || normalized === "review") setFilter("PENDING_REVIEW");
    else if (normalized === "rejected") setFilter("REJECTED");
  }, [searchParams]);

  async function loadAgents() {
    const result = await getArchitectListings();

    if (result.success && result.data) {
      setAgents(result.data.listings);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadAgents();
  }, []);

  const counts = useMemo(
    () => ({
      total: agents.length,
      approved: agents.filter((agent) => agent.status === "APPROVED").length,
      review: agents.filter((agent) => agent.status === "PENDING_REVIEW").length,
      draft: agents.filter((agent) => agent.status === "DRAFT").length
    }),
    [agents]
  );

  const approvedShare = counts.total
    ? `${Math.round((counts.approved / counts.total) * 100)}% of total`
    : "0% of total";

  const visibleAgents = useMemo(
    () => (filter === "ALL" ? agents : agents.filter((agent) => agent.status === filter)),
    [agents, filter]
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <style dangerouslySetInnerHTML={{ __html: MY_AGENTS_STYLES }} />

      <header className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1
              className="text-2xl font-bold text-slate-900"
              data-testid="architect-ui-my-agents-view-agents-heading"
            >
              My Agents
            </h1>
            <p className="mt-1 text-sm text-slate-500" data-testid="my-agents-subtitle-text">
              Manage and monitor all your AI agents
            </p>
          </div>

          <Link
            data-testid="my-agents-publish-agent-link"
            href={"/architect/workflows" as Route}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Create New Agent
          </Link>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-total-agents-text">
              Total Agents
            </p>
            <p className="mt-1 text-3xl font-bold text-slate-900" data-testid="architect-ui-my-agents-view-counts-total-text">
              {counts.total}
            </p>
            <p className="mt-1 text-xs text-slate-400">Across all statuses</p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-approved-text">
              Live &amp; Approved
            </p>
            <p className="mt-1 text-3xl font-bold text-green-600" data-testid="architect-ui-my-agents-view-counts-approved-text">
              {counts.approved}
            </p>
            <p className="mt-1 text-xs text-slate-400">{approvedShare}</p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-in-review-text">
              In Review
            </p>
            <p className="mt-1 text-3xl font-bold text-amber-600" data-testid="architect-ui-my-agents-view-counts-review-text">
              {counts.review}
            </p>
            <p className="mt-1 text-xs text-slate-400">Awaiting approval</p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-drafts-text">
              Drafts
            </p>
            <p className="mt-1 text-3xl font-bold text-slate-800" data-testid="architect-ui-my-agents-view-counts-draft-text">
              {counts.draft}
            </p>
            <p className="mt-1 text-xs text-slate-400">Not published yet</p>
          </div>
        </div>
      </header>

      {/* Filter controls */}
      <section className="mx-auto mt-6 max-w-7xl">
        <div className="flex flex-wrap items-center gap-2" role="tablist" data-testid="my-agents-filter-tabs">
          {FILTER_TABS.map((tab) => {
            const count =
              tab.value === "ALL"
                ? agents.length
                : agents.filter((agent) => agent.status === tab.value).length;
            const active = filter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(tab.value)}
                data-testid={`my-agents-filter-${tab.value.toLowerCase()}`}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "border border-slate-900 bg-slate-900 text-white"
                    : "border border-gray-200 bg-white text-slate-600 hover:border-amber-300"
                }`}
              >
                {tab.dot ? <span className={`h-1.5 w-1.5 rounded-full ${tab.dot}`} /> : null}
                <span>{tab.label}</span>
                <span className={active ? "text-white/60" : "text-slate-400"}>{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Agent grid */}
      <section className="mx-auto mt-5 max-w-7xl pb-12">
        {loading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-72 animate-pulse rounded-2xl border border-gray-100 bg-white shadow-sm" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <EmptyAgentsState />
        ) : visibleAgents.length ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {visibleAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                architectName={architectName}
                onDeleted={() => {
                  void loadAgents();
                }}
              />
            ))}
          </div>
        ) : (
          <p className="pt-4 text-sm text-slate-500" data-testid="my-agents-filter-empty">
            No agents in this view. Switch to “All” to see your other agents.
          </p>
        )}
      </section>
    </div>
  );
}
