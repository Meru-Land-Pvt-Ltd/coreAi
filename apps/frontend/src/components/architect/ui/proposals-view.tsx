"use client";

import { useEffect, useState } from "react";
import {
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectPageHeader,
  ArchitectStatusPill,
  formatDate,
  formatMoney
} from "./architect-ui";
import { getArchitectProposals } from "../features/api";
import type { ArchitectProposal } from "../features/types";

export function ArchitectProposalsView() {
  const [proposals, setProposals] = useState<ArchitectProposal[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadProposals() {
    const result = await getArchitectProposals();

    if (result.success && result.data) {
      setProposals(result.data.proposals);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadProposals();
  }, []);

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Proposal Tracker"
        title="My Proposals"
        description="Track every business project proposal you have submitted."
      />

      <ArchitectCard>
        {loading ? (
          <p className="text-sm font-bold text-orange-700">Loading proposals...</p>
        ) : proposals.length ? (
          <div className="grid gap-4">
            {proposals.map((proposal) => (
              <article key={proposal.id} className="rounded-[28px] bg-orange-50 p-5">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                  <div>
                    <h2 className="text-xl font-black">{proposal.project.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-orange-900/70">
                      {proposal.coverLetter}
                    </p>
                  </div>

                  <ArchitectStatusPill status={proposal.status} />
                </div>

                <div className="mt-4 grid gap-3 text-sm font-black text-orange-900 md:grid-cols-3">
                  <p>Bid: {formatMoney(proposal.bidAmountCents)}</p>
                  <p>ETA: {proposal.etaDays ? `${proposal.etaDays} days` : "Not set"}</p>
                  <p>Submitted: {formatDate(proposal.createdAt)}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <ArchitectEmptyState
            title="No proposals yet"
            text="Browse open projects and send your first proposal."
            actionLabel="View Projects"
            actionHref="/architect/projects"
          />
        )}
      </ArchitectCard>
    </div>
  );
}