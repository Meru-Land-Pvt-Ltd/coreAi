"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectPageHeader,
  ArchitectStatusPill,
  formatDate,
  formatMoney
} from "@/components/architect/ui/architect-ui";
import { getArchitectListings } from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";

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

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Agent Marketplace"
        title="My Agents"
        description="Manage all agents created from your workflows. Draft, pending, approved, and suspended agents appear here."
        actionLabel="Publish Agent"
        actionHref="/architect/agents/publish"
      />

      <ArchitectCard>
        {loading ? (
          <p className="text-sm font-bold text-orange-700">Loading agents...</p>
        ) : agents.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <article
                key={agent.id}
                className="rounded-2xl border border-orange-100 bg-orange-50/70 p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black text-orange-950">{agent.name}</h2>
                    <p className="mt-2 text-sm leading-6 text-orange-900/65">
                      {agent.shortDescription}
                    </p>
                  </div>

                  <ArchitectStatusPill status={agent.status} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {agent.tags.map((tag) => (
                    <span
                      key={`${agent.id}-${tag}`}
                      className="rounded-full bg-white px-3 py-1 text-xs font-black text-orange-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-between gap-3 border-t border-orange-100 pt-4">
                  <div>
                    <p className="text-sm font-black text-orange-950">
                      {formatMoney(agent.priceCents)}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-orange-800/55">
                      Created {formatDate(agent.createdAt)}
                    </p>
                  </div>

                  <Link
                    href="/architect/agents/publish"
                    className="rounded-xl bg-white px-3 py-2 text-xs font-black text-orange-700"
                  >
                    Update
                  </Link>
                </div>
              </article>
            ))}
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