"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectPageHeader,
  ArchitectStatCard,
  ArchitectStatusPill,
  formatDate,
  formatMoney
} from "@/components/architect/ui/architect-ui"

import { getArchitectSummary } from "../features/api";
import type { ArchitectSummary } from "../features/types";

export function ArchitectDashboardView() {
  const [summary, setSummary] = useState<ArchitectSummary | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadSummary() {
    const result = await getArchitectSummary();

    if (result.success && result.data) {
      setSummary(result.data);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  if (loading) {
    return <ArchitectCard>Loading dashboard...</ArchitectCard>;
  }

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Workspace"
        title="Architect Dashboard"
        description="A clean overview of your profile, workflows, marketplace listings, and business opportunities."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <ArchitectStatCard label="Workflows" value={summary?.stats.workflows ?? 0} />
        <ArchitectStatCard label="Listings" value={summary?.stats.listings ?? 0} />
        <ArchitectStatCard label="Proposals" value={summary?.stats.proposals ?? 0} />
        <ArchitectStatCard label="Open Projects" value={summary?.stats.openProjects ?? 0} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_0.8fr]">
        <ArchitectCard title="Profile Snapshot">
          {summary?.profile ? (
            <div>
              <h3 className="text-2xl font-black">
                {summary.profile.title ?? "Untitled Architect"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-orange-900/70">
                {summary.profile.bio ?? "No bio added yet."}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {summary.profile.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700"
                  >
                    {skill}
                  </span>
                ))}
              </div>

              <div className="mt-5 flex items-center gap-3">
                <ArchitectStatusPill status={summary.profile.approvalStatus} />
                <span className="text-sm font-bold text-orange-800/70">
                  Rate: {formatMoney(summary.profile.hourlyRateCents)}
                </span>
              </div>
            </div>
          ) : (
            <ArchitectEmptyState
              title="Complete your profile"
              text="Your architect profile helps businesses understand your skills before sending work."
              actionLabel="Create Profile"
              actionHref="/architect/profile"
            />
          )}
        </ArchitectCard>

        <ArchitectCard title="Next Best Action">
          {!summary?.profile ? (
            <ArchitectEmptyState
              title="Start with profile"
              text="Add your title, bio, skills, portfolio, and hourly rate."
              actionLabel="Complete Profile"
              actionHref="/architect/profile"
            />
          ) : (summary.stats.workflows ?? 0) === 0 ? (
            <ArchitectEmptyState
              title="Create your first workflow"
              text="Build reusable workflow templates for businesses."
              actionLabel="Create Workflow"
              actionHref="/architect/workflows/new"
            />
          ) : (summary.stats.listings ?? 0) === 0 ? (
            <ArchitectEmptyState
              title="Publish your first agent"
              text="Turn your workflow into a marketplace listing."
              actionLabel="Create Listing"
              actionHref="/architect/listings/new"
            />
          ) : (
            <ArchitectEmptyState
              title="Find business projects"
              text="Browse open requirements and submit proposals."
              actionLabel="View Projects"
              actionHref="/architect/projects"
            />
          )}
        </ArchitectCard>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <ArchitectCard title="Recent Workflows">
          {summary?.recent.workflows.length ? (
            <div className="space-y-3">
              {summary.recent.workflows.map((workflow) => (
                <div key={workflow.id} className="rounded-2xl bg-orange-50 p-4">
                  <h3 className="font-black">{workflow.name}</h3>
                  <p className="mt-1 text-xs font-bold text-orange-700">
                    {formatDate(workflow.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <Link className="text-sm font-black text-orange-600 underline" href="/architect/workflows/new">
              Create workflow
            </Link>
          )}
        </ArchitectCard>

        <ArchitectCard title="Recent Listings">
          {summary?.recent.listings.length ? (
            <div className="space-y-3">
              {summary.recent.listings.map((listing) => (
                <div key={listing.id} className="rounded-2xl bg-orange-50 p-4">
                  <h3 className="font-black">{listing.name}</h3>
                  <p className="mt-1 text-xs font-bold text-orange-700">{listing.status}</p>
                </div>
              ))}
            </div>
          ) : (
            <Link className="text-sm font-black text-orange-600 underline" href="/architect/listings/new">
              Create listing
            </Link>
          )}
        </ArchitectCard>

        <ArchitectCard title="Recent Proposals">
          {summary?.recent.proposals.length ? (
            <div className="space-y-3">
              {summary.recent.proposals.map((proposal) => (
                <div key={proposal.id} className="rounded-2xl bg-orange-50 p-4">
                  <h3 className="font-black">{proposal.project.title}</h3>
                  <p className="mt-1 text-xs font-bold text-orange-700">{proposal.status}</p>
                </div>
              ))}
            </div>
          ) : (
            <Link className="text-sm font-black text-orange-600 underline" href="/architect/projects">
              Browse projects
            </Link>
          )}
        </ArchitectCard>
      </div>
    </div>
  );
}