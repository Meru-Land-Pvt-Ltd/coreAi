"use client";

import { useEffect, useState } from "react";
import {
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectPageHeader,
  ArchitectStatCard,
  formatDate,
  formatMoney
} from "@/components/architect/ui/architect-ui";
import { getArchitectListings } from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";

function StoreGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6.5V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5L18 2Z" />
      <path d="M3 6.5h18" />
      <path d="M16 10.5a4 4 0 0 1-8 0" />
    </svg>
  );
}

export function PublishedAgentsView() {
  const [agents, setAgents] = useState<ArchitectListing[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAgents() {
    const result = await getArchitectListings();
    if (result.success && result.data) {
      setAgents(result.data.listings.filter((agent) => agent.status === "APPROVED"));
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadAgents();
  }, []);

  const monthlyPotential = agents.reduce((sum, agent) => sum + agent.priceCents, 0);

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Marketplace"
        title="Published Agents"
        description="Approved agents are live-ready for business buyers. This page mirrors the public storefront style with clean marketplace cards."
        actionLabel="Publish Agent"
        actionHref="/architect/agents/publish"
      />

      <div className="mb-5 grid gap-5 sm:grid-cols-3">
        <ArchitectStatCard label="Live agents" value={agents.length} hint="Approved by admin" tone="green" icon={<StoreGlyph />} />
        <ArchitectStatCard label="Monthly list value" value={formatMoney(monthlyPotential)} hint="Combined price of approved agents" icon={<StoreGlyph />} />
        <ArchitectStatCard label="Pending setup" value={0} hint="Connect review data when backend is ready" tone="amber" icon={<StoreGlyph />} />
      </div>

      <ArchitectCard>
        {loading ? (
          <p className="text-sm font-bold text-amber-700" data-testid="architect-ui-published-agents-view-loading-published-agents-text">Loading published agents...</p>
        ) : agents.length ? (
          <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {agents.map((agent) => (
              <article key={agent.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-amber-200 hover:shadow-lg hover:shadow-slate-900/5">
                <div className="flex items-start gap-3">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20">
                    <StoreGlyph />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-black text-slate-950" data-testid="architect-ui-published-agents-view-agent-heading">{agent.name}</h2>
                    <p className="mt-1 text-sm font-bold text-amber-700" data-testid="architect-ui-published-agents-view-core-marketplace-agent-text">CORE Marketplace Agent</p>
                  </div>
                </div>

                <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-500" data-testid="architect-ui-published-agents-view-agent-short-description-text">{agent.shortDescription}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {agent.tags.map((tag) => (
                    <span key={`${agent.id}-${tag}`} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-100" data-testid="architect-ui-published-agents-view-tag-text">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-5 flex items-end justify-between border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-2xl font-black text-slate-950" data-testid="architect-ui-published-agents-view-format-money-agent-price-cents-text">{formatMoney(agent.priceCents)}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500" data-testid="architect-ui-published-agents-view-published-from-format-date-agent-created-at-text">Published from {formatDate(agent.createdAt)}</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100" data-testid="architect-ui-published-agents-view-live-text">Live</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <ArchitectEmptyState
            title="No published agents yet"
            text="Approved agents will appear here after admin review."
            actionLabel="View My Agents"
            actionHref="/architect/agents"
          />
        )}
      </ArchitectCard>
    </div>
  );
}
