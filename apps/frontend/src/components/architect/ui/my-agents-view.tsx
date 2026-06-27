"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArchitectStatusPill,
  formatDate,
  formatMoney
} from "@/components/architect/ui/architect-ui";
import { getArchitectListings } from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";

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
        href={"/architect/agents/publish" as Route}
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
            Publish New Agent
          </h3>

          <p className="mt-3 max-w-sm text-sm font-semibold leading-6 text-slate-500" data-testid="architect-ui-my-agents-view-start-with-an-empty-canvas-then-load-text">
            Start with an empty canvas. Then load Missed Call Text-Back or build
            your own flow.
          </p>
        </div>
      </Link>
    </div>
  );
}

function AgentRow({ agent }: { agent: ArchitectListing }) {
  return (
    <div className="grid gap-4 border-b border-amber-100/80 px-5 py-5 transition hover:bg-white/70 lg:grid-cols-[1.4fr_0.7fr_0.55fr_0.55fr_0.45fr] lg:items-center">
      <div className="flex min-w-0 items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700 ring-1 ring-amber-200">
          <AgentGlyph />
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-black text-slate-950" data-testid="architect-ui-my-agents-view-agent-heading">
              {agent.name}
            </h2>
            <ArchitectStatusPill status={agent.status} />
          </div>

          <p className="mt-1 line-clamp-2 max-w-3xl text-sm leading-6 text-slate-600" data-testid="architect-ui-my-agents-view-agent-short-description-no-description-added-yet-text">
            {agent.shortDescription || "No description added yet."}
          </p>

          <div className="mt-3 flex flex-wrap gap-2 lg:hidden">
            {agent.tags.length ? (
              agent.tags.map((tag) => (
                <span
                  key={`${agent.id}-${tag}`}
                  className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-amber-100"
                 data-testid="architect-ui-my-agents-view-tag-text">
                  {tag}
                </span>
              ))
            ) : (
              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500 ring-1 ring-amber-100" data-testid="architect-ui-my-agents-view-no-tags-text">
                No tags
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="hidden flex-wrap gap-2 lg:flex">
        {agent.tags.length ? (
          agent.tags.slice(0, 3).map((tag) => (
            <span
              key={`${agent.id}-${tag}`}
              className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-amber-100"
             data-testid="architect-ui-my-agents-view-tag-text-2">
              {tag}
            </span>
          ))
        ) : (
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500 ring-1 ring-amber-100" data-testid="architect-ui-my-agents-view-no-tags-text-2">
            No tags
          </span>
        )}
      </div>

      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 lg:hidden" data-testid="architect-ui-my-agents-view-price-text">
          Price
        </p>
        <p className="text-sm font-black text-slate-950" data-testid="architect-ui-my-agents-view-format-money-agent-price-cents-text">
          {formatMoney(agent.priceCents)}
        </p>
      </div>

      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 lg:hidden" data-testid="architect-ui-my-agents-view-created-text">
          Created
        </p>
        <p className="text-sm font-bold text-slate-600" data-testid="architect-ui-my-agents-view-format-date-agent-created-at-text">
          {formatDate(agent.createdAt)}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 lg:justify-end">
        <p className="max-w-[12rem] truncate text-xs font-semibold text-slate-500 lg:hidden" data-testid="architect-ui-my-agents-view-agent-workflow-from-agent-workflow-marketplace-package-text">
          {agent.workflow?.name ? `From ${agent.workflow.name}` : "Marketplace package"}
        </p>

        <Link
          data-testid={`my-agents-update-${agent.id}-link`}
          href={
            (agent.workflowId
              ? `/architect/workflows/${agent.workflowId}/builder`
              : "/architect/agents/publish") as Route
          }
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white transition hover:bg-slate-800"
        >
          Update
        </Link>
      </div>
    </div>
  );
}

export function MyAgentsView() {
  const [agents, setAgents] = useState<ArchitectListing[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="-m-4 min-h-screen bg-[#fffaf3] p-4 sm:-m-6 sm:p-6 lg:-m-8 lg:p-8">
      <section className="px-1 py-2 sm:px-2">
        <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl" data-testid="architect-ui-my-agents-view-agents-heading">
              My Agents
            </h1>

            <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600 sm:text-base" data-testid="architect-ui-my-agents-view-manage-marketplace-agents-from-one-clean-workspace-text">
              Manage marketplace agents from one clean workspace. Track drafts, reviews,
              approvals, pricing, and published packages without heavy card layouts.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              data-testid="my-agents-build-workflow-link"
              href={"/architect/workflows" as Route}
              className="inline-flex items-center justify-center rounded-2xl border border-amber-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:border-amber-400 hover:text-amber-700"
            >
              Build Workflow
            </Link>

            <Link
              data-testid="my-agents-publish-agent-link"
              href={"/architect/agents/publish" as Route}
              className="inline-flex items-center justify-center rounded-2xl bg-amber-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-amber-500/20 transition hover:-translate-y-0.5 hover:bg-amber-400"
            >
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
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-600" data-testid="architect-ui-my-agents-view-inventory-text">
              Inventory
            </p>

            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950" data-testid="architect-ui-my-agents-view-marketplace-inventory-heading">
              Marketplace inventory
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-600" data-testid="architect-ui-my-agents-view-loading-your-agents-marketplace-package-agents-1-text">
              {loading
                ? "Loading your agents..."
                : agents.length
                  ? `${agents.length} marketplace package${agents.length === 1 ? "" : "s"} found`
                  : "No marketplace packages found"}
            </p>
          </div>
        </div>

        {agents.length ? (
          <div className="hidden border-b border-amber-100 pb-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 lg:grid lg:grid-cols-[1.4fr_0.7fr_0.55fr_0.55fr_0.45fr]">
            <span data-testid="architect-ui-my-agents-view-agent-text">Agent</span>
            <span data-testid="architect-ui-my-agents-view-tags-text">Tags</span>
            <span data-testid="architect-ui-my-agents-view-price-text-2">Price</span>
            <span data-testid="architect-ui-my-agents-view-created-text-2">Created</span>
            <span className="text-right" data-testid="architect-ui-my-agents-view-action-text">Action</span>
          </div>
        ) : null}

        {loading ? (
          <div className="py-10">
            <div className="h-3 w-48 animate-pulse rounded-full bg-amber-200" />

            <div className="mt-6 space-y-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="h-20 animate-pulse rounded-2xl bg-white/70 ring-1 ring-amber-100"
                />
              ))}
            </div>
          </div>
        ) : agents.length ? (
          <div className="divide-y divide-amber-100/80">
            {agents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} />
            ))}
          </div>
        ) : (
          <div className="pt-4">
            <EmptyAgentsState />
          </div>
        )}
      </section>
    </div>
  );
}