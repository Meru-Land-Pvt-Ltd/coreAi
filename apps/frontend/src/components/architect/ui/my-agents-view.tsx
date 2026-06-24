"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectPageHeader,
  ArchitectStatCard,
  ArchitectStatusPill,
  formatDate,
  formatMoney
} from "@/components/architect/ui/architect-ui";
import { getArchitectListings } from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";

function AgentGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="2.5" />
      <path d="M12 8V4.5" />
      <circle cx="9" cy="14" r="1.1" />
      <circle cx="15" cy="14" r="1.1" />
    </svg>
  );
}

function AgentCard({ agent }: { agent: ArchitectListing }) {
  return (
    <article className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-amber-200 hover:shadow-lg hover:shadow-slate-900/5">
      <div className="h-2 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-200" />
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
              <AgentGlyph />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-black text-slate-950">{agent.name}</h2>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">{agent.shortDescription}</p>
            </div>
          </div>
          <ArchitectStatusPill status={agent.status} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {agent.tags.length ? agent.tags.map((tag) => (
            <span key={`${agent.id}-${tag}`} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {tag}
            </span>
          )) : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">No tags</span>}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Price</p>
            <p className="mt-1 text-sm font-black text-slate-950">{formatMoney(agent.priceCents)}</p>
          </div>
          <div className="rounded-2xl bg-amber-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-amber-600">Created</p>
            <p className="mt-1 text-sm font-black text-slate-950">{formatDate(agent.createdAt)}</p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold text-slate-500">{agent.workflow?.name ? `From ${agent.workflow.name}` : "Marketplace package"}</p>
          <Link href="/architect/agents/publish" className="rounded-xl bg-slate-950 px-3.5 py-2 text-xs font-black text-white transition hover:bg-slate-800">
            Update
          </Link>
        </div>
      </div>
    </article>
  );
}

export function MyAgentsView() {
  const [agents, setAgents] = useState<ArchitectListing[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAgents() {
    const result = await getArchitectListings();
    if (result.success && result.data) setAgents(result.data.listings);
    setLoading(false);
  }

  useEffect(() => {
    void loadAgents();
  }, []);

  const counts = useMemo(() => ({
    total: agents.length,
    approved: agents.filter((agent) => agent.status === "APPROVED").length,
    review: agents.filter((agent) => agent.status === "PENDING_REVIEW").length,
    draft: agents.filter((agent) => agent.status === "DRAFT").length
  }), [agents]);

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Agent Marketplace"
        title="My Agents"
        description="Manage every marketplace agent from one optimized view: drafts, review submissions, approvals, and suspended agents."
        actionLabel="Publish Agent"
        actionHref="/architect/agents/publish"
        secondaryActionLabel="Build Workflow"
        secondaryActionHref="/architect/workflows"
      />

      <div className="mb-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <ArchitectStatCard label="Total agents" value={counts.total} hint="All marketplace packages" icon={<AgentGlyph />} />
        <ArchitectStatCard label="Approved" value={counts.approved} hint="Visible to businesses" tone="green" icon={<AgentGlyph />} />
        <ArchitectStatCard label="In review" value={counts.review} hint="Awaiting admin approval" tone="amber" icon={<AgentGlyph />} />
        <ArchitectStatCard label="Drafts" value={counts.draft} hint="Need final details" tone="slate" icon={<AgentGlyph />} />
      </div>

      <ArchitectCard>
        {loading ? (
          <p className="text-sm font-bold text-amber-700">Loading agents...</p>
        ) : agents.length ? (
          <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)}
          </div>
        ) : (
          <ArchitectEmptyState
            title="No agents yet"
            text="Create a workflow first, then publish it as an agent for businesses."
            actionLabel="Publish Agent"
            actionHref="/architect/agents/publish"
          />
        )}
      </ArchitectCard>
    </div>
  );
}
