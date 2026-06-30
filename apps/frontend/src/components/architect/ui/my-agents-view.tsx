"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArchitectStatusPill,
  formatDate,
  formatMoney
} from "@/components/architect/ui/architect-ui";
import {
  cleanupDraftWorkflows,
  deleteArchitectWorkflow,
  getArchitectListings
} from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";
import { getAuthUser } from "@/lib/auth";

function AgentGlyph() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="8" width="16" height="12" rx="2.5" />
      <path d="M12 8V4.5" />
      <circle cx="9" cy="14" r="1.1" />
      <circle cx="15" cy="14" r="1.1" />
    </svg>
  );
}

function EmptyAgentsState() {
  return (
    <div className="pt-2">
      <Link
        data-testid="my-agents-empty-publish-agent-link"
        href={"/architect/workflows" as Route}
        className="group relative flex min-h-[360px] w-full max-w-[448px] flex-col overflow-hidden rounded-[1.8rem] border border-dashed border-amber-300 bg-[#fffdf6] p-8 text-left shadow-sm transition duration-300 hover:-translate-y-1 hover:border-amber-400 hover:bg-white hover:shadow-xl hover:shadow-amber-500/10"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.10),transparent_38%)] opacity-80" />

        <div className="relative grid h-14 w-14 place-items-center rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-500/30 transition duration-300 group-hover:scale-105 group-hover:bg-amber-400">
          <svg
            className="h-8 w-8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </div>

        <div className="relative mt-auto">
          <h3 className="text-2xl font-black tracking-tight text-slate-950" data-testid="architect-ui-my-agents-view-publish-new-agent-heading">
            Create your first agent
          </h3>

          <p className="mt-3 max-w-sm text-sm font-semibold leading-6 text-slate-500" data-testid="architect-ui-my-agents-view-start-with-an-empty-canvas-then-load-text">
            Start with an empty canvas, pick a template from the gallery, or build
            your own flow.
          </p>
        </div>
      </Link>
    </div>
  );
}

function AgentCard({
  agent,
  architectName,
  onDelete
}: {
  agent: ArchitectListing;
  architectName: string;
  onDelete?: () => void;
}) {
  const editHref = (agent.workflowId
    ? `/architect/workflows/${agent.workflowId}/builder`
    : "/architect/agents/publish") as Route;

  const isUnderReview = agent.status === "PENDING_REVIEW";
  // Status-specific call to action.
  const actionLabel =
    agent.status === "DRAFT"
      ? "Continue editing"
      : agent.status === "PENDING_REVIEW"
        ? "View submission"
        : agent.status === "APPROVED"
          ? "View live"
          : agent.status === "REJECTED"
            ? "Edit & resubmit"
            : "Manage";

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div className="flex-1 p-6">
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-100">
            <AgentGlyph />
          </span>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <ArchitectStatusPill status={agent.status} />
            <span className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white" data-testid="architect-ui-my-agents-view-format-money-agent-price-cents-text">
              {formatMoney(agent.priceCents)}
            </span>
          </div>
        </div>

        <h2 className="mt-4 flex flex-wrap items-center gap-2 text-lg font-bold text-slate-900" data-testid="architect-ui-my-agents-view-agent-heading">
          {agent.name}
        </h2>

        <div className="mt-2 flex flex-wrap gap-2">
          {agent.tags.length ? (
            agent.tags.slice(0, 3).map((tag) => (
              <span
                key={`${agent.id}-${tag}`}
                className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-slate-600"
                data-testid="architect-ui-my-agents-view-tag-text"
              >
                {tag}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-slate-500" data-testid="architect-ui-my-agents-view-no-tags-text">
              No tags
            </span>
          )}
        </div>

        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600" data-testid="architect-ui-my-agents-view-agent-short-description-no-description-added-yet-text">
          {agent.shortDescription || "No description added yet."}
        </p>

        {isUnderReview ? (
          <div
            className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
            data-testid={`my-agents-review-notice-${agent.id}`}
          >
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <p className="text-xs font-semibold leading-5 text-amber-700">
              Will be live in 24–48 hrs after review
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-50 bg-gray-50/60 px-6 py-3">
        <span className="truncate text-xs text-slate-500" data-testid="architect-ui-my-agents-view-format-date-agent-created-at-text">
          Created {formatDate(agent.createdAt)}
        </span>
        <span className="truncate text-xs text-slate-500" data-testid="architect-ui-my-agents-view-agent-workflow-from-agent-workflow-marketplace-package-text">
          {architectName}
        </span>
      </div>

      <div className="flex items-center gap-2 px-6 pb-6 pt-4">
        <Link
          data-testid={`my-agents-update-${agent.id}-link`}
          href={editHref}
          className="block flex-1 rounded-xl border-2 border-amber-500 py-2.5 text-center font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white"
        >
          {actionLabel}
        </Link>
        {agent.status === "DRAFT" && onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            data-testid={`my-agents-delete-${agent.id}`}
            className="shrink-0 rounded-xl border-2 border-red-200 px-3 py-2.5 text-sm font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50"
          >
            Delete draft
          </button>
        ) : null}
      </div>
    </article>
  );
}

type AgentFilter = "ALL" | "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

const FILTER_TABS: { value: AgentFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Drafts" },
  { value: "PENDING_REVIEW", label: "Pending Review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" }
];

export function MyAgentsView() {
  const [agents, setAgents] = useState<ArchitectListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [architectName, setArchitectName] = useState("Architect");
  const [filter, setFilter] = useState<AgentFilter>("ALL");
  const [confirm, setConfirm] = useState<{ message: string; confirmLabel: string; run: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const user = getAuthUser();
    const name = user?.fullName?.trim() || user?.email?.trim() || "Architect";
    setArchitectName(name);
  }, []);

  async function loadAgents() {
    const result = await getArchitectListings();

    if (result.success && result.data) {
      setAgents(result.data.listings);
    }

    setLoading(false);
  }

  function requestDeleteDraft(agent: ArchitectListing) {
    if (!agent.workflowId) return;
    setConfirm({
      message: "Delete this draft? This cannot be undone.",
      confirmLabel: "Delete draft",
      run: async () => {
        const result = await deleteArchitectWorkflow(agent.workflowId as string);
        if (!result.success) {
          setActionMessage(result.error ?? "Could not delete this draft.");
          return;
        }
        setActionMessage(null);
        await loadAgents();
      }
    });
  }

  function requestClearClutter() {
    setConfirm({
      message: "Clear draft clutter? This deletes untitled and duplicate drafts that aren't submitted or deployed. This cannot be undone.",
      confirmLabel: "Clear drafts",
      run: async () => {
        const result = await cleanupDraftWorkflows({ deleteUntitled: true, deleteDuplicateTemplates: true });
        if (!result.success || !result.data) {
          setActionMessage(result.error ?? "Could not clear drafts.");
          return;
        }
        setActionMessage(`Removed ${result.data.deletedCount} draft${result.data.deletedCount === 1 ? "" : "s"}.`);
        await loadAgents();
      }
    });
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    await confirm.run();
    setBusy(false);
    setConfirm(null);
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

  const visibleAgents = useMemo(
    () => (filter === "ALL" ? agents : agents.filter((agent) => agent.status === filter)),
    [agents, filter]
  );

  return (
    <div className="min-h-screen bg-greay p-4 sm:p-6 lg:p-8">
      <section className="px-1 py-2 sm:px-2">
        <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl" data-testid="architect-ui-my-agents-view-agents-heading">
              My Agents
            </h1>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
      
            <Link
              data-testid="my-agents-publish-agent-link"
              href={"/architect/workflows" as Route}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 hover:shadow-md sm:px-5"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Publish Agent
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="border-l-4 border-amber-500 bg-white/70 px-5 py-4">
            <p className="text-xs font-bold text-slate-500" data-testid="architect-ui-my-agents-view-total-agents-text">Total agents</p>
            <p className="mt-1 text-3xl font-black text-slate-950" data-testid="architect-ui-my-agents-view-counts-total-text">{counts.total}</p>
          </div>

          <div className="border-l-4 border-emerald-500 bg-white/70 px-5 py-4">
            <p className="text-xs font-bold text-slate-500" data-testid="architect-ui-my-agents-view-approved-text">Approved</p>
            <p className="mt-1 text-3xl font-black text-emerald-700" data-testid="architect-ui-my-agents-view-counts-approved-text">{counts.approved}</p>
          </div>

          <div className="border-l-4 border-orange-500 bg-white/70 px-5 py-4">
            <p className="text-xs font-bold text-slate-500" data-testid="architect-ui-my-agents-view-in-review-text">In review</p>
            <p className="mt-1 text-3xl font-black text-orange-700" data-testid="architect-ui-my-agents-view-counts-review-text">{counts.review}</p>
          </div>

          <div className="border-l-4 border-slate-400 bg-white/70 px-5 py-4">
            <p className="text-xs font-bold text-slate-500" data-testid="architect-ui-my-agents-view-drafts-text">Drafts</p>
            <p className="mt-1 text-3xl font-black text-slate-800" data-testid="architect-ui-my-agents-view-counts-draft-text">{counts.draft}</p>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div className="flex items-center gap-3">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-600" data-testid="architect-ui-my-agents-view-inventory-text">
              Inventory
            </p>
            {counts.draft > 0 ? (
              <button
                type="button"
                onClick={requestClearClutter}
                data-testid="my-agents-clear-clutter"
                className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50"
              >
                Clear draft clutter
              </button>
            ) : null}
            {actionMessage ? (
              <span className="text-xs text-slate-500" data-testid="my-agents-action-message">{actionMessage}</span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-1.5" role="tablist" data-testid="my-agents-filter-tabs">
            {FILTER_TABS.map((tab) => {
              const count = tab.value === "ALL" ? agents.length : agents.filter((agent) => agent.status === tab.value).length;
              const active = filter === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(tab.value)}
                  data-testid={`my-agents-filter-${tab.value.toLowerCase()}`}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-gray-200 bg-white text-slate-600 hover:border-amber-300"
                  }`}
                >
                  {tab.label} <span className={active ? "text-white/80" : "text-slate-400"}>({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-80 animate-pulse rounded-2xl bg-white/70 ring-1 ring-amber-100"
              />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="pt-4">
            <EmptyAgentsState />
          </div>
        ) : visibleAgents.length ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {visibleAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                architectName={architectName}
                onDelete={() => requestDeleteDraft(agent)}
              />
            ))}
          </div>
        ) : (
          <p className="pt-4 text-sm text-slate-500" data-testid="my-agents-filter-empty">
            No agents in this view. Switch to “All” to see your other agents.
          </p>
        )}
      </section>

      {confirm ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
          data-testid="my-agents-confirm-modal"
          onClick={() => !busy && setConfirm(null)}
        >
          <div className="w-[min(92vw,420px)] rounded-2xl border border-gray-200 bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-base font-black text-slate-900">Please confirm</h3>
            <p className="mt-2 text-sm text-slate-600">{confirm.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runConfirm()}
                disabled={busy}
                data-testid="my-agents-confirm-delete"
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {busy ? "Working…" : confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}