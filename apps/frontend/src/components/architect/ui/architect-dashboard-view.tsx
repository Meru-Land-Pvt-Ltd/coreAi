"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState } from "react";
import {
  ArchitectBadge,
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectPageHeader,
  ArchitectStatCard,
  ArchitectStatusPill,
  MiniProgress,
  formatDate,
  formatMoney
} from "@/components/architect/ui/architect-ui";
import { getArchitectSummary } from "@/components/architect/features/api";
import type { ArchitectSummary } from "@/components/architect/features/types";

function DashboardIcon({ name }: { name: "workflows" | "agents" | "projects" | "proposals" }) {
  const common = "h-5 w-5";

  if (name === "workflows") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="6" height="6" rx="1.5" />
        <rect x="15" y="15" width="6" height="6" rx="1.5" />
        <path d="M9 6h3.5A2.5 2.5 0 0 1 15 8.5V15" />
      </svg>
    );
  }

  if (name === "agents") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="8" width="16" height="12" rx="2.5" />
        <path d="M12 8V4.5" />
        <circle cx="9" cy="14" r="1" />
        <circle cx="15" cy="14" r="1" />
      </svg>
    );
  }

  if (name === "projects") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7.8A2.2 2.2 0 0 1 6.2 5.6h3.1l1.5 1.8h7A2.2 2.2 0 0 1 20 9.6v7.8a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 17.4V7.8Z" />
      </svg>
    );
  }

  return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5" />
      <path d="M4 7h11l-1 4 1 4H4" />
    </svg>
  );
}

export function ArchitectDashboardView() {
  const [summary, setSummary] = useState<ArchitectSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const result = await getArchitectSummary();
      if (result.success && result.data) setSummary(result.data);
      setLoading(false);
    }

    void load();
  }, []);

  const profileCompletion = useMemo(() => {
    const profile = summary?.profile;
    if (!profile) return 0;
    const items = [profile.title, profile.bio, profile.portfolioUrl, profile.skills.length > 0, profile.hourlyRateCents];
    return Math.round((items.filter(Boolean).length / items.length) * 100);
  }, [summary]);

  if (loading) {
    return (
      <ArchitectCard>
        <p className="text-sm font-bold text-amber-700" data-testid="architect-ui-architect-dashboard-view-loading-architect-dashboard-text">Loading architect dashboard...</p>
      </ArchitectCard>
    );
  }

  const stats = summary?.stats;
  const recentListings = summary?.recent.listings ?? [];
  const recentWorkflows = summary?.recent.workflows ?? [];
  const recentProposals = summary?.recent.proposals ?? [];

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Architect Studio"
        title={`Welcome back${summary?.user.fullName ? `, ${summary.user.fullName.split(" ")[0]}` : ""}`}
        description="A polished command center for your agents, workflow builds, marketplace publishing, and earnings readiness."
        actionLabel="Create Agent"
        actionHref="/architect/workflows/new"
        secondaryActionLabel="Publish Listing"
        secondaryActionHref="/architect/agents/publish"
      />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <ArchitectStatCard label="Workflows" value={stats?.workflows ?? 0} hint="Reusable automations in your builder" tone="amber" icon={<DashboardIcon name="workflows" />} />
        <ArchitectStatCard label="Listings" value={stats?.listings ?? 0} hint="Draft, pending, and approved agents" tone="blue" icon={<DashboardIcon name="agents" />} />
        <ArchitectStatCard label="Open projects" value={stats?.openProjects ?? 0} hint="Business requests you can quote" tone="green" icon={<DashboardIcon name="projects" />} />
        <ArchitectStatCard label="Proposals" value={stats?.proposals ?? 0} hint="Submitted project bids" tone="slate" icon={<DashboardIcon name="proposals" />} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_360px]">
        <ArchitectCard title="Marketplace readiness" description="Live metrics will appear here after real installs and payouts are connected.">
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
            <div>
              <ArchitectBadge tone="slate">No live metrics yet</ArchitectBadge>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500" data-testid="architect-ui-architect-dashboard-view-build-and-publish-your-first-agent-real-text">
                Build and publish your first agent. Real install, revenue, and run-quality data will show here after backend events are available.
              </p>
            </div>
          </div>
        </ArchitectCard>

        <ArchitectCard title="Profile strength" description="Complete your storefront profile to improve buyer trust.">
          <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-white p-4 ring-1 ring-amber-100">
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-amber-500 text-lg font-black text-white">
                {summary?.user.fullName?.charAt(0) ?? "A"}
              </div>
              <div>
                <p className="font-black text-slate-950" data-testid="architect-ui-architect-dashboard-view-summary-user-full-architect-text">{summary?.user.fullName ?? "Architect"}</p>
                <p className="text-sm font-semibold text-slate-500" data-testid="architect-ui-architect-dashboard-view-summary-profile-title-ai-workflow-architect-text">{summary?.profile?.title ?? "AI Workflow Architect"}</p>
              </div>
            </div>
            <div className="mt-5">
              <MiniProgress value={profileCompletion} label="Storefront completion" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
                <p className="text-xs font-bold text-slate-500" data-testid="architect-ui-architect-dashboard-view-rating-text">Rating</p>
                <p className="mt-1 text-xl font-black text-slate-950" data-testid="architect-ui-architect-dashboard-view-summary-profile-rating-0-5-text">{summary?.profile?.rating ?? 0}/5</p>
              </div>
              <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
                <p className="text-xs font-bold text-slate-500" data-testid="architect-ui-architect-dashboard-view-jobs-text">Jobs</p>
                <p className="mt-1 text-xl font-black text-slate-950" data-testid="architect-ui-architect-dashboard-view-summary-profile-completed-jobs-0-text">{summary?.profile?.completedJobs ?? 0}</p>
              </div>
            </div>
            <Link data-testid="architect-dashboard-update-profile-link" href={"/architect/profile" as Route} className="mt-5 inline-flex w-full justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800">
              Update profile
            </Link>
          </div>
        </ArchitectCard>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <ArchitectCard title="Recent workflows" className="xl:col-span-1">
          {recentWorkflows.length ? (
            <div className="space-y-3">
              {recentWorkflows.slice(0, 4).map((workflow) => (
                <Link data-testid={`architect-dashboard-workflow-${workflow.id}-link`} key={workflow.id} href={`/architect/workflows/${workflow.id}/builder` as Route} className="block rounded-2xl border border-slate-100 p-4 transition hover:border-amber-200 hover:bg-amber-50/40">
                  <p className="font-black text-slate-950" data-testid="architect-ui-architect-dashboard-view-workflow-text">{workflow.name}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500" data-testid="architect-ui-architect-dashboard-view-created-format-date-workflow-created-at-text">Created {formatDate(workflow.createdAt)}</p>
                </Link>
              ))}
            </div>
          ) : (
            <ArchitectEmptyState title="No workflows yet" text="Start with a blank canvas or use the agent builder to create your first automation." actionLabel="Create workflow" actionHref="/architect/workflows/new" />
          )}
        </ArchitectCard>

        <ArchitectCard title="Marketplace listings" className="xl:col-span-1">
          {recentListings.length ? (
            <div className="space-y-3">
              {recentListings.slice(0, 4).map((listing) => (
                <div key={listing.id} className="rounded-2xl border border-slate-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-slate-950" data-testid="architect-ui-architect-dashboard-view-listing-text">{listing.name}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-500" data-testid="architect-ui-architect-dashboard-view-listing-short-description-text">{listing.shortDescription}</p>
                    </div>
                    <ArchitectStatusPill status={listing.status} />
                  </div>
                  <p className="mt-3 text-sm font-black text-slate-950" data-testid="architect-ui-architect-dashboard-view-format-money-listing-price-cents-text">{formatMoney(listing.priceCents)}</p>
                </div>
              ))}
            </div>
          ) : (
            <ArchitectEmptyState title="No listings yet" text="Package a workflow as an agent and submit it for review." actionLabel="Publish agent" actionHref="/architect/agents/publish" />
          )}
        </ArchitectCard>

        <ArchitectCard title="Proposal activity" className="xl:col-span-1">
          {recentProposals.length ? (
            <div className="space-y-3">
              {recentProposals.slice(0, 4).map((proposal) => (
                <div key={proposal.id} className="rounded-2xl border border-slate-100 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-black text-slate-950" data-testid="architect-ui-architect-dashboard-view-proposal-project-title-text">{proposal.project.title}</p>
                    <ArchitectStatusPill status={proposal.status} />
                  </div>
                  <p className="mt-2 text-sm text-slate-500" data-testid="architect-ui-architect-dashboard-view-proposal-eta-days-proposal-eta-days-day-text">{proposal.etaDays ? `${proposal.etaDays} day ETA` : "ETA not set"}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-50 p-5">
              <ArchitectBadge tone="slate">Quiet inbox</ArchitectBadge>
              <p className="mt-3 text-sm leading-6 text-slate-500" data-testid="architect-ui-architect-dashboard-view-project-proposal-history-will-appear-here-when-text">Project proposal history will appear here when businesses start requesting custom builds.</p>
            </div>
          )}
        </ArchitectCard>
      </div>
    </div>
  );
}
