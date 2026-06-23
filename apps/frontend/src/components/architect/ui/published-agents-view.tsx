"use client";

import { useEffect, useState } from "react";
import {
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectPageHeader,
  formatDate,
  formatMoney
} from "@/components/architect/ui/architect-ui";
import { getArchitectListings } from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";

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

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Approved Marketplace Agents"
        title="Published Agents"
        description="These agents are approved and ready to be shown in the business marketplace."
        actionLabel="Publish Agent"
        actionHref="/architect/agents/publish"
      />

      <ArchitectCard>
        {loading ? (
          <p className="text-sm font-bold text-orange-700">Loading published agents...</p>
        ) : agents.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <article
                key={agent.id}
                className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm"
              >
                <h2 className="text-lg font-black text-orange-950">{agent.name}</h2>
                <p className="mt-2 text-sm leading-6 text-orange-900/65">
                  {agent.shortDescription}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {agent.tags.map((tag) => (
                    <span
                      key={`${agent.id}-${tag}`}
                      className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-5 border-t border-orange-100 pt-4">
                  <p className="text-sm font-black text-orange-950">
                    {formatMoney(agent.priceCents)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-orange-800/55">
                    Published from {formatDate(agent.createdAt)}
                  </p>
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