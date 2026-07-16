"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDate, formatMoney } from "@/components/architect/ui/architect-ui";
import {
  createArchitectWorkflow,
  deleteArchitectListing,
  deleteArchitectWorkflow,
  getArchitectAgentsStats,
  getArchitectListings,
  getArchitectWorkflow,
  updateArchitectListingStatus,
  type ArchitectAgentsStats
} from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";
import { architectPublishingStatusPath, architectAnalyticsPath, MARKETPLACE_PATH } from "@/lib/routes";
import { ArrowDown, ArrowUp, Dot } from "lucide-react";

const EMPTY_AGENT_STATS: ArchitectAgentsStats = {
  totalAgents: 0,
  agentsAddedThisMonth: 0,
  liveAndEarning: 0,
  liveSharePercent: 0,
  totalExecutions: 0,
  executionsThisMonth: 0,
  executionsPrevMonth: 0,
  executionsChangePercent: null,
  totalEarningsCents: 0,
  revenue30dCents: 0,
  revenuePrev30dCents: 0,
  revenueChangePercent: null
};

type TrendDirection = "up" | "down" | "flat";

function getTrendDirection(change: number | null): TrendDirection {
  if (change == null || change === 0) return "flat";
  return change > 0 ? "up" : "down";
}

function TrendFooter({
  direction,
  children,
  testId
}: {
  direction: TrendDirection;
  children: ReactNode;
  testId?: string;
}) {
  const colorClass =
    direction === "up" ? "text-green-600" : direction === "down" ? "text-red-500" : "text-slate-400";
  return (
    <p className={`mt-1 flex items-center gap-1 text-xs font-semibold ${colorClass}`} data-testid={testId}>
      {direction === "up" ? <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      {direction === "down" ? <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      <span>{children}</span>
    </p>
  );
}

function formatTrendPercentLabel(change: number | null, emptyLabel = "0% vs last month"): string {
  if (change === null || change === 0) return emptyLabel;
  return `${Math.abs(change)}% vs last month`;
}

/** Reusable click-ripple for cards. Spawns a temporary element that self-removes. */
function spawnCardRipple(
  card: HTMLElement | null,
  event?: { clientX?: number; clientY?: number; touches?: TouchList }
) {
  if (!card || typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const layer = card.querySelector<HTMLElement>("[data-ma-ripple-layer]");
  const host = layer ?? card;
  const rect = host.getBoundingClientRect();
  const touch = event?.touches?.[0];
  const clientX = touch?.clientX ?? event?.clientX ?? rect.left + rect.width / 2;
  const clientY = touch?.clientY ?? event?.clientY ?? rect.top + rect.height / 2;
  const size = Math.max(rect.width, rect.height);

  const ripple = document.createElement("span");
  ripple.className = "ma-ripple";
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${clientX - rect.left - size / 2}px`;
  ripple.style.top = `${clientY - rect.top - size / 2}px`;
  host.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
}

type AgentStatus = ArchitectListing["status"];
type ViewMode = "grid" | "list";
type SortKey = "newest" | "oldest" | "alpha" | "priceHigh" | "priceLow";

const MY_AGENTS_STYLES = `
@keyframes myAgentsPulseDot {
  0%   { box-shadow: 0 0 0 0 rgba(34,197,94,.5); }
  70%  { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
  100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
}
.ma-pulse-dot { animation: myAgentsPulseDot 3s ease-out infinite; }
@keyframes myAgentsSpin { to { transform: rotate(360deg); } }
.ma-spin-slow { animation: myAgentsSpin 2.6s linear infinite; transform-origin: center; }

@keyframes maCardIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.ma-card.ma-entering { animation: maCardIn .32s cubic-bezier(.16,1,.3,1) both; }

@keyframes maPop { from { opacity: 0; transform: translateY(4px) scale(.98); } to { opacity: 1; transform: none; } }
.ma-pop { animation: maPop .14s ease-out both; }

@keyframes maRipple { to { transform: scale(2.4); opacity: 0; } }
.ma-ripple-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
  z-index: 1;
}
.ma-ripple {
  position: absolute;
  border-radius: 9999px;
  background: rgba(245,158,11,.20);
  transform: scale(0);
  animation: maRipple .6s ease-out forwards;
  pointer-events: none;
  z-index: 5;
}

.ma-card { display: flex; flex-direction: column; }
.ma-card .ma-band { margin-top: auto; }
.ma-card:active { transform: translateY(-2px) scale(0.997); }
.ma-continue .ma-arrow { transition: transform .2s ease; }
.ma-continue:hover .ma-arrow { transform: translateX(2px); }

/* List view layout */
.ma-grid.view-list { grid-template-columns: 1fr !important; }
.ma-grid.view-list .ma-card {
  display: grid;
  grid-template-columns: 76px minmax(0,1fr) 232px auto;
  align-items: center;
}
.ma-grid.view-list .ma-card .ma-band { margin-top: 0; }
.ma-grid.view-list .ma-top { flex-direction: column; align-items: center; gap: 10px; padding: 16px; }
.ma-grid.view-list .ma-top-actions { flex-direction: column; gap: 8px; align-items: center; }
.ma-grid.view-list .ma-body { padding: 16px 10px; }
.ma-grid.view-list .ma-band { background: transparent !important; border: none !important; padding: 14px 16px; min-width: 232px; }
.ma-grid.view-list .ma-foot { border: none !important; flex-direction: column; align-items: flex-end; gap: 8px; padding: 16px; }
.ma-grid.view-list .ma-extra { display: none; }
.ma-grid.view-list .ma-desc { -webkit-line-clamp: 1; }
@media (max-width: 720px) {
  .ma-grid.view-list .ma-card { grid-template-columns: 64px minmax(0,1fr); }
  .ma-grid.view-list .ma-band, .ma-grid.view-list .ma-foot { grid-column: 1 / -1; align-items: flex-start; }
  .ma-grid.view-list .ma-foot { flex-direction: row; justify-content: space-between; }
}

@media (prefers-reduced-motion: reduce) {
  .ma-pulse-dot, .ma-spin-slow, .ma-card.ma-entering, .ma-pop, .ma-ripple { animation: none !important; }
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
  },
  PAUSED: {
    label: "Paused",
    pill: "bg-amber-50 text-amber-700",
    iconBg: "bg-amber-50",
    iconBorder: "border-amber-100",
    iconText: "text-amber-600"
  }
};

const SORTS: { key: SortKey; label: string; fn: (a: ArchitectListing, b: ArchitectListing) => number }[] = [
  { key: "newest", label: "Newest first", fn: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() },
  { key: "oldest", label: "Oldest first", fn: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() },
  { key: "alpha", label: "Alphabetical", fn: (a, b) => a.name.localeCompare(b.name) },
  { key: "priceHigh", label: "Price: High to Low", fn: (a, b) => b.priceCents - a.priceCents },
  { key: "priceLow", label: "Price: Low to High", fn: (a, b) => a.priceCents - b.priceCents }
];

function PhoneGlyph() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function SpinnerGlyph() {
  return (
    <svg className="ma-spin-slow h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="ma-arrow h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2.5" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function TrashIcon({ className = "h-[15px] w-[15px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function StatusGlyphIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l2.5 2.5" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="M7 16v-5" />
      <path d="M12 16V8" />
      <path d="M17 16v-3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "just now";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(value);
}

function formatUsdFromCents(cents: number): string {
  return `$${Math.max(0, Math.round(cents / 100)).toLocaleString("en-US")}`;
}

function formatUsdMoney(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function liveDeleteRefundCents(agent: ArchitectListing): {
  installs: number;
  perInstallCents: number;
  totalCents: number;
} {
  const installs = Math.max(0, agent.installCount ?? 0);
  const perInstallCents = Math.max(0, agent.priceCents ?? 0);
  return {
    installs,
    perInstallCents,
    totalCents: installs * perInstallCents
  };
}

function StatusPill({ status }: { status: AgentStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={`ma-status inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.pill}`}
      data-testid="my-agents-status-pill"
    >
      {status === "APPROVED" ? (
        <span className="ma-pulse-dot h-1.5 w-1.5 rounded-full bg-green-500" />
      ) : status === "PENDING_REVIEW" ? (
        <SpinnerGlyph />
      ) : status === "REJECTED" || status === "SUSPENDED" ? (
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      ) : status === "PAUSED" ? (
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      ) : null}
      {style.label}
    </span>
  );
}

function StatusBand({ agent }: { agent: ArchitectListing }) {
  if (agent.status === "PENDING_REVIEW") {
    const review = agent.reviewProgress ?? {
      percent: 75,
      passed: 3,
      total: 4,
      items: [
        { label: "Listing details", done: true },
        { label: "Compliance checks", done: true },
        { label: "Marketplace ready", done: true },
        { label: "Manual review", done: false }
      ]
    };
    return (
      <div className="ma-band border-t border-amber-100 bg-amber-50/60 px-5 py-3" data-testid={`my-agents-review-notice-${agent.id}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-amber-700">Review progress</span>
          <span className="text-xs font-semibold text-amber-600">{review.percent}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-amber-100">
          <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, Math.max(0, review.percent))}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-amber-700">
          {review.passed} of {review.total} checks passed
        </p>
        <ul className="ma-extra mt-2 space-y-1">
          {review.items.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5 text-xs text-amber-800/80">
              {item.done ? (
                <span className="text-green-600">
                  <CheckIcon />
                </span>
              ) : (
                <span className="inline-block h-3 w-3 rounded-full border border-amber-400" />
              )}
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (agent.status === "DRAFT") {
    const draft = agent.draftProgress ?? {
      stepsCompleted: 0,
      stepsTotal: 7,
      percent: 0,
      missing: ["Name", "Tagline", "Category", "Industry", "Description", "Pricing", "Compliance"]
    };
    return (
      <div className="ma-band border-t border-gray-100 bg-slate-50 px-5 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">Completion</span>
          <span className="text-xs font-semibold text-slate-500">{draft.percent}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div className="h-full rounded-full bg-slate-400" style={{ width: `${Math.min(100, Math.max(0, draft.percent))}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {draft.stepsCompleted} of {draft.stepsTotal} steps completed
        </p>
        {draft.missing.length ? (
          <p className="ma-extra mt-1 text-xs text-slate-400">Missing: {draft.missing.slice(0, 3).join(", ")}</p>
        ) : null}
      </div>
    );
  }

  if (agent.status === "REJECTED" || agent.status === "SUSPENDED") {
    return (
      <div className="ma-band border-t border-red-100 bg-red-50/60 px-5 py-3">
        <p className="text-xs font-medium text-red-600">
          {agent.status === "REJECTED" ? "Changes requested — edit and resubmit." : "Suspended — contact support to restore."}
        </p>
      </div>
    );
  }

  if (agent.status === "PAUSED") {
    return (
      <div className="ma-band border-t border-amber-100 bg-amber-50/60 px-5 py-3" data-testid={`my-agents-paused-notice-${agent.id}`}>
        <p className="text-xs font-medium text-amber-700">Paused — removed from marketplace. Reactivate anytime.</p>
      </div>
    );
  }

  // APPROVED / live
  const executions = agent.executionCount ?? 0;
  const revenue = agent.revenueCents ?? 0;
  const installs = agent.installCount ?? 0;

  return (
    <div className="ma-band grid grid-cols-3 gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
      <div>
        <div className="text-xs text-slate-400">Executions</div>
        <div className="text-sm font-bold text-slate-900" data-testid={`my-agents-executions-${agent.id}`}>
          {executions.toLocaleString("en-US")}
        </div>
      </div>
      <div>
        <div className="text-xs text-slate-400">Revenue</div>
        <div className="text-sm font-bold text-amber-600" data-testid={`my-agents-revenue-${agent.id}`}>
          {formatUsdFromCents(revenue)}
        </div>
      </div>
      <div>
        <div className="text-xs text-slate-400">Installs</div>
        <div className="text-sm font-bold text-slate-900" data-testid={`my-agents-installs-${agent.id}`}>
          {installs.toLocaleString("en-US")}
        </div>
      </div>
    </div>
  );
}

function builderHrefFor(agent: ArchitectListing): Route {
  return (agent.workflowId ? `/architect/workflows/${agent.workflowId}/builder` : "/architect/agents/publish") as Route;
}

function FooterActions({
  agent,
  onDuplicate,
  onPause,
  onDelete,
  onCancelSubmission
}: {
  agent: ArchitectListing;
  onDuplicate: (agent: ArchitectListing) => void;
  onPause: (agent: ArchitectListing) => void;
  onDelete: (agent: ArchitectListing) => void;
  onCancelSubmission: (agent: ArchitectListing) => void;
}) {
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  const builderHref = builderHrefFor(agent);
  const statusHref = architectPublishingStatusPath(agent.id);

  // Live and Under Review agents are intentionally not editable — cancel the
  // submission (back to Draft) or pause first.
  if (agent.status === "APPROVED") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        <button
          type="button"
          onClick={(event) => {
            stop(event);
            onPause(agent);
          }}
          data-testid={`my-agents-pause-${agent.id}-button`}
          className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-amber-50 hover:text-amber-700"
        >
          Pause
        </button>
        <button
          type="button"
          onClick={(event) => {
            stop(event);
            onDuplicate(agent);
          }}
          data-testid={`my-agents-duplicate-${agent.id}-button`}
          className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
        >
          Duplicate
        </button>
      </div>
    );
  }

  if (agent.status === "PENDING_REVIEW") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Link
          data-testid={`my-agents-feedback-${agent.id}-link`}
          href={statusHref}
          onClick={stop}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-50"
        >
          View Feedback
        </Link>
      </div>
    );
  }

  if (agent.status === "PAUSED") {
    return null;
  }

  if (agent.status === "DRAFT") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Link
          data-testid={`my-agents-update-${agent.id}-link`}
          href={builderHref}
          onClick={stop}
          className="ma-continue inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-50"
        >
          Continue Building <ArrowIcon />
        </Link>
        {agentCanBeDeleted(agent) ? (
          <button
            type="button"
            onClick={(event) => {
              stop(event);
              onDelete(agent);
            }}
            data-testid={`my-agents-delete-${agent.id}-button`}
            className="rounded-lg px-2 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
          >
            Delete
          </button>
        ) : null}
      </div>
    );
  }

  // REJECTED / SUSPENDED
  return (
    <Link
      data-testid={`my-agents-update-${agent.id}-link`}
      href={builderHref}
      onClick={stop}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-50"
    >
      Edit &amp; resubmit <ArrowIcon />
    </Link>
  );
}

function AgentCard({
  agent,
  index,
  animate,
  onOpen,
  onDots,
  onDuplicate,
  onPause,
  onDelete,
  onCancelSubmission
}: {
  agent: ArchitectListing;
  index: number;
  animate: boolean;
  onOpen: (agent: ArchitectListing) => void;
  onDots: (event: React.MouseEvent, agentId: string) => void;
  onDuplicate: (agent: ArchitectListing) => void;
  onPause: (agent: ArchitectListing) => void;
  onDelete: (agent: ArchitectListing) => void;
  onCancelSubmission: (agent: ArchitectListing) => void;
}) {
  const style = STATUS_STYLES[agent.status];
  const category = agent.category?.trim() || null;
  const dashed = agent.status === "DRAFT" ? "border-dashed border-gray-200" : "border-gray-100";
  const iconUrl = agent.iconUrl?.trim() || null;
  const industryTags = (
    agent.industryTags?.length
      ? agent.industryTags
      : agent.tags?.length
        ? agent.tags
        : []
  )
    .map((tag) => tag.trim())
    .filter(Boolean);
  const visibleIndustryTags = industryTags.slice(0, 3);
  const extraIndustryCount = Math.max(0, industryTags.length - 3);
  const hiddenIndustryTags = industryTags.slice(3);
  const visibleTagParts = visibleIndustryTags.map((tag) => ({
    full: tag,
    ...splitLongTag(tag, 25)
  }));
  const truncatedOverflowTags = visibleTagParts
    .map((part) => part.overflow)
    .filter((value): value is string => Boolean(value));
  const popupTags = [...truncatedOverflowTags, ...hiddenIndustryTags];
  const showTagsPopup = popupTags.length > 0;
  const title = agent.name?.trim() || "Untitled Agent";
  const hasDescription = Boolean(agent.shortDescription?.trim() || agent.tagline?.trim());
  const description = agent.shortDescription?.trim() || agent.tagline?.trim() || "No description added yet.";
  const activityAt = agent.updatedAt || agent.submittedAt || agent.createdAt;
  const activityLabel =
    agent.status === "PENDING_REVIEW"
      ? `Submitted ${formatRelativeTime(agent.submittedAt || agent.createdAt)}`
      : agent.status === "DRAFT"
        ? `Last edited ${formatRelativeTime(activityAt)}`
        : `Updated ${formatRelativeTime(activityAt)}`;
  const cardRef = useRef<HTMLElement | null>(null);

  return (
    <article
      ref={cardRef}
      data-testid={`my-agents-card-${agent.id}`}
      role="button"
      tabIndex={0}
      aria-label={`${title}, ${style.label}. Press Enter to open.`}
      onClick={(event) => {
        spawnCardRipple(cardRef.current, event);
        onOpen(agent);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          spawnCardRipple(cardRef.current);
          onOpen(agent);
        }
      }}
      style={animate ? { animationDelay: `${Math.min(index * 35, 280)}ms` } : undefined}
      className={`ma-card group relative cursor-pointer overflow-visible rounded-2xl border ${dashed} bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ${
        animate ? "ma-entering" : ""
      }`}
    >
      <div className="ma-ripple-layer rounded-2xl" data-ma-ripple-layer aria-hidden="true" />
      <div className="ma-top flex items-start justify-between px-5 pb-3 pt-5">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border ${
            iconUrl ? "border-amber-100 bg-white" : `${style.iconBg} ${style.iconBorder} ${style.iconText}`
          }`}
          data-testid={`my-agents-icon-${agent.id}`}
        >
          {iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- icons can be data URLs
            <img src={iconUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <PhoneGlyph />
          )}
        </span>

        <div className="ma-top-actions flex items-center gap-1">
          <StatusPill status={agent.status} />
          <button
            type="button"
            data-ma-dots
            onClick={(event) => onDots(event, agent.id)}
            data-testid={`my-agents-menu-${agent.id}-button`}
            aria-haspopup="true"
            aria-label={`More actions for ${title}`}
            className="-mr-1 rounded-md p-1 text-slate-300 transition-colors hover:bg-gray-50 hover:text-slate-500 focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <DotsIcon />
          </button>
        </div>
      </div>

      <div className="ma-body min-w-0 px-5 pb-3">
        <h3 className="truncate text-base font-semibold text-slate-900" data-testid="architect-ui-my-agents-view-agent-heading">
          {title}
        </h3>
        <div className="mt-1.5 flex min-w-0 items-center gap-1">
        <span className="shrink-0 text-xs font-semibold text-slate-500 rounded-full bg-gray-300/50 px-2 py-0.5 whitespace-nowrap flex items-center justify-center">{category ?? "Industry not set"}</span>
        <div className="group/tags relative min-w-0 flex-1 flex items-center gap-1" data-testid={`my-agents-industry-${agent.id}`}>
          
          {industryTags.length > 0 ? (
            <>
              <div className="inline-flex max-w-full min-w-0 flex-nowrap items-center overflow-hidden rounded-full bg-amber-50 px-2 py-0.5">
                {visibleTagParts.map((part, index) => (
                  <span key={part.full} className="flex shrink-0 items-center whitespace-nowrap text-xs font-semibold text-amber-700" title={part.overflow ? part.full : undefined}>
                    {part.visible}
                    {part.overflow ? "…" : null}
                    {index < visibleTagParts.length - 1 || extraIndustryCount > 0 ? (
                      <span className="text-amber-700">
                        <Dot className="h-3 w-3" />
                      </span>
                    ) : null}
                  </span>
                ))}
                {extraIndustryCount > 0 ? (
                  <span
                    className="shrink-0 text-xs font-bold text-amber-700"
                    data-testid={`my-agents-industry-more-${agent.id}`}
                    aria-label={`${extraIndustryCount} more industr${extraIndustryCount === 1 ? "y" : "ies"}`}
                  >
                    +{extraIndustryCount}
                  </span>
                ) : null}
              </div>
              {showTagsPopup ? (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden max-w-[min(100%,18rem)] rounded-xl border border-amber-100 bg-white px-3 py-2 shadow-lg group-hover/tags:block"
                  data-testid={`my-agents-industry-tooltip-${agent.id}`}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {popupTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5">
              <span className="text-xs font-semibold text-amber-700/70">Industry not set</span>
            </div>
          )}
        </div>
        </div>

        <p
          className={`ma-desc mt-2 line-clamp-2 text-sm ${hasDescription ? "text-slate-500" : "italic text-slate-400"}`}
          data-testid="architect-ui-my-agents-view-agent-short-description-no-description-added-yet-text"
        >
          {description}
        </p>
      </div>

      <StatusBand agent={agent} />

      <div className="ma-foot flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
        <span className="ma-updated whitespace-nowrap text-xs text-slate-400" data-testid="architect-ui-my-agents-view-format-date-agent-created-at-text">
          {activityLabel}
        </span>
        <div className="flex items-center gap-1">
          <FooterActions
            agent={agent}
            onDuplicate={onDuplicate}
            onPause={onPause}
            onDelete={onDelete}
            onCancelSubmission={onCancelSubmission}
          />
        </div>
      </div>
    </article>
  );
}

function PlayIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4" />
      <path d="m15.4 6.5-6.8 4" />
    </svg>
  );
}

function isWorkflowOnlyDraft(agent: ArchitectListing): boolean {
  return agent.id.startsWith("draft-");
}

/** Keep words that fit in maxLen; remaining last word(s) go into the hover popup. */
function splitLongTag(tag: string, maxLen = 25): { visible: string; overflow: string | null } {
  const trimmed = tag.trim();
  if (trimmed.length <= maxLen) return { visible: trimmed, overflow: null };

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return {
      visible: trimmed.slice(0, maxLen).trimEnd(),
      overflow: trimmed.slice(maxLen).trim() || trimmed
    };
  }

  let visible = "";
  const overflowWords: string[] = [];
  for (const word of words) {
    const next = visible ? `${visible} ${word}` : word;
    if (!overflowWords.length && next.length <= maxLen) {
      visible = next;
    } else {
      overflowWords.push(word);
    }
  }

  if (!visible) {
    const [first, ...rest] = words;
    return {
      visible: first.slice(0, maxLen).trimEnd(),
      overflow: [first.slice(maxLen), ...rest].join(" ").trim() || first
    };
  }

  return {
    visible,
    overflow: overflowWords.length ? overflowWords.join(" ") : null
  };
}

function agentIsLive(agent: ArchitectListing): boolean {
  return agent.status === "APPROVED" || agent.status === "PAUSED";
}

function agentCanBeDeleted(agent: ArchitectListing): boolean {
  if (isWorkflowOnlyDraft(agent)) return Boolean(agent.workflowId);
  return agent.status === "DRAFT" || agent.status === "REJECTED";
}

function deleteAgentModalCopy(agent: ArchitectListing): { title: string; lines: string[] } {
  if (agent.status === "APPROVED" || agent.status === "PAUSED") {
    const { installs, totalCents } = liveDeleteRefundCents(agent);
    if (installs > 0) {
      return {
        title: `Delete ${agent.name}?`,
        lines: [
          totalCents > 0
            ? "To delete this live agent you must pay the buyer refund shown below."
            : "Buyers currently use this free agent. Deleting it may disrupt their installs — pause it instead if you only want to stop new sales."
        ]
      };
    }

    return {
      title: `Delete ${agent.name}?`,
      lines: ["Live agents cannot be deleted.", "Pause the agent from Settings if you want to stop new sales."]
    };
  }

  if ((agent.installCount ?? 0) > 0) {
    return {
      title: `Delete ${agent.name}?`,
      lines: ["This agent has active installs and cannot be deleted.", "Pause the agent from Settings if you want to stop new sales."]
    };
  }

  if (agent.status === "PENDING_REVIEW") {
    return {
      title: `Delete ${agent.name}?`,
      lines: ["Are you sure you want to delete this agent?"]
    };
  }

  if (agent.status === "SUSPENDED") {
    return {
      title: `Delete ${agent.name}?`,
      lines: ["Suspended agents cannot be deleted from here.", "Contact support if you need this agent removed."]
    };
  }

  return {
    title: `Delete ${agent.name}?`,
    lines: ["This permanently removes the agent and its workflow.", "This can't be undone."]
  };
}

function ReactivateAgentModal({
  agent,
  reactivating,
  onClose,
  onConfirm
}: {
  agent: ArchitectListing;
  reactivating: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid={`my-agents-reactivate-modal-${agent.id}`}>
      <button type="button" className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-label="Close modal" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-slate-900">Reactivate {agent.name}?</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-500">
          <p>This agent will go live again and appear in the marketplace.</p>
          <p>Existing buyers keep access. New buyers can purchase again.</p>
          <p>You can pause all agents again anytime from Settings.</p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-gray-50" data-testid={`my-agents-reactivate-cancel-${agent.id}`}>Cancel</button>
          <button type="button" disabled={reactivating} onClick={onConfirm} className="rounded-xl border border-green-300 px-5 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50" data-testid={`my-agents-reactivate-confirm-${agent.id}`}>
            {reactivating ? "Reactivating…" : "Make agent live"}
          </button>
        </div>
      </div>
    </div>
  );
}

const DELETE_REASONS = [
  "Replacing with a better version",
  "No longer maintaining this agent",
  "Too many support requests",
  "Compliance/legal reasons",
  "Other"
] as const;

function LiveAgentDeleteModal({
  agent,
  deleting,
  deactivating,
  onClose,
  onConfirm,
  onDeactivate
}: {
  agent: ArchitectListing;
  deleting: boolean;
  deactivating: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<boolean> | boolean;
  onDeactivate: () => void;
}) {
  const [nameInput, setNameInput] = useState("");
  const [reason, setReason] = useState("");
  const [comments, setComments] = useState("");
  const [step, setStep] = useState<"confirm" | "success">("confirm");
  const [showNameError, setShowNameError] = useState(false);

  const installs = Math.max(0, agent.installCount ?? 0);
  const priceCents = Math.max(0, agent.priceCents ?? 0);
  const isSubscription = (agent.pricingModel ?? "SUBSCRIPTION") === "SUBSCRIPTION";
  const monthlyRevenueCents =
    isSubscription && priceCents > 0 ? installs * priceCents : Math.max(0, agent.revenueCents ?? 0);
  const refundCents = installs * priceCents;
  const pendingPayoutCents = Math.round(monthlyRevenueCents * 0.3);
  const nameMatches = nameInput.trim() === agent.name.trim();
  const busy = deleting || deactivating;
  const iconUrl = agent.iconUrl?.trim() || null;
  const statusLabel =
    agent.status === "PAUSED" ? "Paused — removed from marketplace" : "Published — Active";

  async function handleDelete() {
    if (!nameMatches) {
      setShowNameError(true);
      return;
    }
    const composedReason = [reason.trim(), comments.trim()].filter(Boolean).join(" — ");
    const ok = await onConfirm(composedReason.length >= 5 ? composedReason : "Deleted by architect");
    if (ok) setStep("success");
  }

  if (step === "success") {
    return (
      <div
        className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 backdrop-blur-sm md:items-center"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`my-agents-live-delete-success-title-${agent.id}`}
        data-testid={`my-agents-live-delete-modal-${agent.id}`}
      >
        <div className="w-full max-h-[90vh] overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl md:max-w-[480px] md:rounded-2xl">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
              <svg className="h-7 w-7 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 id={`my-agents-live-delete-success-title-${agent.id}`} className="text-lg font-semibold text-slate-900">
              Agent Deleted
            </h2>
            <p className="mt-1 mb-4 text-sm text-slate-500">{agent.name} has been permanently deleted.</p>
            <ul className="mb-4 space-y-1.5 rounded-xl bg-slate-50 p-4 text-left text-sm text-slate-600">
              <li>
                {installs.toLocaleString("en-US")} buyer subscription{installs === 1 ? "" : "s"} cancelled
              </li>
              <li>Refunds will be processed within 3–5 business days</li>
              <li>Buyers have been notified via email</li>
            </ul>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] w-full rounded-lg bg-slate-900 font-medium text-white hover:bg-slate-800"
              data-testid={`my-agents-live-delete-success-close-${agent.id}`}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 backdrop-blur-sm md:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`my-agents-live-delete-title-${agent.id}`}
      aria-describedby={`my-agents-live-delete-desc-${agent.id}`}
      data-testid={`my-agents-live-delete-modal-${agent.id}`}
    >
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close dialog"
        onClick={onClose}
        disabled={busy}
      />
      <div className="relative w-full max-h-[90vh] overflow-y-auto rounded-t-2xl bg-white shadow-2xl md:max-w-[480px] md:rounded-2xl">
        <div className="flex items-start justify-between px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
              <svg className="h-5 w-5 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            </div>
            <h2 id={`my-agents-live-delete-title-${agent.id}`} className="text-lg font-semibold text-slate-900">
              Delete Agent Permanently?
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            disabled={busy}
            className="-mr-1 -mt-1 p-1 text-slate-400 hover:text-slate-600 disabled:opacity-50"
            data-testid={`my-agents-live-delete-close-${agent.id}`}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div id={`my-agents-live-delete-desc-${agent.id}`} className="space-y-4 px-6 pt-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-amber-100 text-amber-700">
              {iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- icons can be data URLs
                <img src={iconUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <PhoneGlyph />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{agent.name}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${agent.status === "PAUSED" ? "bg-amber-500" : "bg-green-500"}`}
                />
                {statusLabel}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {installs.toLocaleString("en-US")} business{installs === 1 ? "" : "es"} currently using this agent
                {monthlyRevenueCents > 0 ? ` · ${formatUsdMoney(monthlyRevenueCents)}/month from this agent` : ""}
              </p>
            </div>
          </div>

          <div className="rounded-r-lg border-l-4 border-red-500 bg-red-50 p-4">
            <p className="mb-2 text-sm font-medium text-slate-900">
              This action is permanent and cannot be undone. Deleting this agent will:
            </p>
            <ul className="space-y-1.5 text-sm text-slate-600">
              <li className="flex gap-2">
                <span className="font-bold text-red-500">✕</span>
                Remove it from the marketplace immediately
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-red-500">✕</span>
                Terminate all {installs.toLocaleString("en-US")} active subscription{installs === 1 ? "" : "s"}
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-red-500">✕</span>
                Trigger refund processing for current billing period
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-red-500">✕</span>
                Delete all agent configurations, workflows, and versions
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-red-500">✕</span>
                Remove all reviews and ratings
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-red-500">✕</span>
                Cancel pending payouts related to this agent
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="mb-2 text-sm font-medium text-slate-900">Financial impact:</p>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Lost recurring revenue</dt>
                <dd className="font-medium text-slate-900">{formatUsdMoney(monthlyRevenueCents)}/month</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Refunds to process</dt>
                <dd className="font-medium text-slate-900">~{formatUsdMoney(refundCents)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Pending payouts cancelled</dt>
                <dd className="font-medium text-slate-900">{formatUsdMoney(pendingPayoutCents)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-medium text-slate-900">Consider deactivating instead?</p>
            <p className="mb-3 mt-1 text-xs text-slate-600">
              Deactivating hides your agent from the marketplace but preserves all data, reviews, and configurations.
              You can reactivate anytime.
            </p>
            <button
              type="button"
              onClick={onDeactivate}
              disabled={busy || agent.status === "PAUSED"}
              className="min-h-[44px] rounded-lg border border-blue-300 px-3 text-sm font-medium text-blue-600 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid={`my-agents-live-delete-deactivate-${agent.id}`}
            >
              {deactivating ? "Deactivating…" : agent.status === "PAUSED" ? "Already deactivated" : "Deactivate Instead"}
            </button>
          </div>

          <div>
            <label htmlFor={`my-agents-live-delete-name-${agent.id}`} className="mb-1 block text-sm text-slate-700">
              To confirm deletion, type the agent name exactly as shown below:
            </label>
            <p className="mb-2 select-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm font-bold text-slate-900">
              {agent.name}
            </p>
            <div className="relative">
              <input
                id={`my-agents-live-delete-name-${agent.id}`}
                type="text"
                autoComplete="off"
                placeholder="Type agent name here"
                value={nameInput}
                disabled={busy}
                onChange={(event) => {
                  setNameInput(event.target.value);
                  setShowNameError(false);
                }}
                className="w-full rounded-lg border-2 border-slate-300 py-2.5 pl-3 pr-9 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:opacity-50"
                data-testid={`my-agents-live-delete-name-input-${agent.id}`}
              />
              {nameMatches ? (
                <svg
                  className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-green-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : null}
            </div>
            {showNameError ? <p className="mt-1 text-xs text-red-600">Name doesn&apos;t match</p> : null}
          </div>

          <div>
            <label htmlFor={`my-agents-live-delete-reason-${agent.id}`} className="mb-1 block text-sm text-slate-700">
              Why are you deleting this agent? <span className="text-slate-400">(optional)</span>
            </label>
            <select
              id={`my-agents-live-delete-reason-${agent.id}`}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:opacity-50"
              data-testid={`my-agents-live-delete-reason-${agent.id}`}
            >
              <option value="">Select a reason</option>
              {DELETE_REASONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <textarea
              maxLength={500}
              rows={2}
              placeholder="Additional comments (optional)"
              value={comments}
              disabled={busy}
              onChange={(event) => setComments(event.target.value)}
              className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:opacity-50"
              data-testid={`my-agents-live-delete-comments-${agent.id}`}
            />
            <p className="mt-1 text-right text-xs text-slate-400">{comments.length}/500</p>
          </div>
        </div>

        <div className="sticky bottom-0 mt-2 flex flex-col gap-3 border-t border-slate-100 bg-white px-6 py-5 md:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[48px] flex-1 rounded-lg border border-slate-300 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-testid={`my-agents-live-delete-cancel-${agent.id}`}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !nameMatches}
            aria-disabled={!nameMatches || busy}
            onClick={() => void handleDelete()}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg bg-red-500 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            data-testid={`my-agents-live-delete-confirm-${agent.id}`}
          >
            {deleting ? "Deleting…" : "Delete Agent Permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteAgentModal({
  agent,
  deleting,
  deactivating = false,
  onClose,
  onConfirm,
  onDeactivate
}: {
  agent: ArchitectListing;
  deleting: boolean;
  deactivating?: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<boolean> | boolean;
  onDeactivate?: () => void;
}) {
  const [reason, setReason] = useState("");
  const isLiveAgent = agent.status === "APPROVED" || agent.status === "PAUSED";

  if (isLiveAgent && onDeactivate) {
    return (
      <LiveAgentDeleteModal
        agent={agent}
        deleting={deleting}
        deactivating={deactivating}
        onClose={onClose}
        onConfirm={onConfirm}
        onDeactivate={onDeactivate}
      />
    );
  }

  const deletable = agentCanBeDeleted(agent);
  const isLive = agentIsLive(agent);
  const copy = deleteAgentModalCopy(agent);
  const reasonMissing = isLive && reason.trim().length < 5;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid={`my-agents-delete-modal-${agent.id}`}>
      <button type="button" className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-label="Close modal" onClick={onClose} disabled={deleting} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-slate-900">{copy.title}</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-500">
          {copy.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        {isLive ? (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-gray-50 p-3 text-center" data-testid={`my-agents-delete-impact-${agent.id}`}>
              <div>
                <div className="text-[11px] text-slate-400">Installs</div>
                <div className="text-sm font-bold text-slate-900">{(agent.installCount ?? 0).toLocaleString("en-US")}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Executions</div>
                <div className="text-sm font-bold text-slate-900">{(agent.executionCount ?? 0).toLocaleString("en-US")}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Revenue</div>
                <div className="text-sm font-bold text-amber-600">{formatUsdFromCents(agent.revenueCents ?? 0)}</div>
              </div>
            </div>

            <label className="mt-4 block text-xs font-semibold text-slate-600" htmlFor={`delete-reason-${agent.id}`}>
              Reason for deletion (required)
            </label>
            <textarea
              id={`delete-reason-${agent.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Why are you removing this live agent?"
              data-testid={`my-agents-delete-reason-${agent.id}`}
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-red-300 focus:ring-2 focus:ring-red-200"
            />
          </>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-gray-50 disabled:opacity-50"
            data-testid={`my-agents-delete-cancel-${agent.id}`}
          >
            {deletable ? "Cancel" : "Close"}
          </button>
          {deletable ? (
            <button
              type="button"
              disabled={deleting || reasonMissing}
              onClick={() => void onConfirm(reason)}
              className="rounded-xl border border-red-300 px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              data-testid={`my-agents-delete-confirm-${agent.id}`}
            >
              {deleting ? "Deleting…" : "Delete agent"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PauseAgentModal({
  agent,
  pausing,
  onClose,
  onConfirm
}: {
  agent: ArchitectListing;
  pausing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid={`my-agents-pause-modal-${agent.id}`}>
      <button type="button" className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-label="Close modal" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-slate-900">Pause {agent.name}?</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-500">
          <p>The agent will no longer be discoverable or available for purchase in the marketplace.</p>
          <p>New installs and new sales stop immediately.</p>
          <p>Existing buyers keep their installed agents — their live calls, texts, and bookings keep working.</p>
          <p>You can reactivate anytime from My Agents.</p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-gray-50" data-testid={`my-agents-pause-cancel-${agent.id}`}>Cancel</button>
          <button type="button" disabled={pausing} onClick={onConfirm} className="rounded-xl border border-amber-300 px-5 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50" data-testid={`my-agents-pause-confirm-${agent.id}`}>
            {pausing ? "Pausing…" : "Pause agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CancelSubmissionModal({
  agent,
  cancelling,
  onClose,
  onConfirm
}: {
  agent: ArchitectListing;
  cancelling: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid={`my-agents-cancel-submission-modal-${agent.id}`}>
      <button type="button" className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-label="Close modal" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-slate-900">Cancel submission for {agent.name}?</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-500">
          <p>The review will be withdrawn and the agent returns to Draft.</p>
          <p>You can edit it and resubmit for review anytime.</p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-gray-50" data-testid={`my-agents-cancel-submission-keep-${agent.id}`}>Keep in review</button>
          <button type="button" disabled={cancelling} onClick={onConfirm} className="rounded-xl border border-red-300 px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50" data-testid={`my-agents-cancel-submission-confirm-${agent.id}`}>
            {cancelling ? "Cancelling…" : "Cancel submission"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyAgentsState({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-500">
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="8" width="16" height="12" rx="2.5" />
          <path d="M12 8V4.5" />
          <circle cx="9" cy="14" r="1.1" />
          <circle cx="15" cy="14" r="1.1" />
        </svg>
      </span>

      <h3 className="mt-4 text-lg font-semibold text-slate-700" data-testid="architect-ui-my-agents-view-publish-new-agent-heading">
        {message ? "No agents in this view" : "No agents yet"}
      </h3>
      <p className="mt-2 text-sm text-slate-500" data-testid="architect-ui-my-agents-view-start-with-an-empty-canvas-then-load-text">
        {message ?? "Create your first agent or pick a template from the gallery to get started."}
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

function CountUp({ value, format = "int" }: { value: number; format?: "int" | "money" }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || value <= 0) {
      setDisplay(value);
      return;
    }

    let raf = 0;
    const duration = 900;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setDisplay(value);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const rounded = Math.round(display);
  if (format === "money") {
    // Revenue must show $0 (formatMoney(0) returns "Free" for listing prices).
    return <>{`$${rounded.toLocaleString("en-US")}`}</>;
  }
  return <>{rounded.toLocaleString("en-US")}</>;
}

export function MyAgentsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [agents, setAgents] = useState<ArchitectListing[]>([]);
  const [stats, setStats] = useState<ArchitectAgentsStats>(EMPTY_AGENT_STATS);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AgentFilter>("ALL");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [view, setView] = useState<ViewMode>("grid");
  const [sortOpen, setSortOpen] = useState(false);
  const [menu, setMenu] = useState<{ agentId: string; top: number; left: number } | null>(null);
  const [reactivateAgent, setReactivateAgent] = useState<ArchitectListing | null>(null);
  const [deleteAgent, setDeleteAgent] = useState<ArchitectListing | null>(null);
  const [pauseAgent, setPauseAgent] = useState<ArchitectListing | null>(null);
  const [cancelSubmissionAgent, setCancelSubmissionAgent] = useState<ArchitectListing | null>(null);
  const [reactivating, setReactivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [cancellingSubmission, setCancellingSubmission] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
    const [listingsResult, statsResult] = await Promise.all([
      getArchitectListings(),
      getArchitectAgentsStats()
    ]);
    if (listingsResult.success && listingsResult.data) {
      setAgents(listingsResult.data.listings);
    }
    if (statsResult.success && statsResult.data) {
      setStats(statsResult.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadAgents();
  }, []);

  // Close floating layers on outside click / scroll.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (menu && !target.closest("[data-ma-menu]") && !target.closest("[data-ma-dots]")) {
        setMenu(null);
      }
      if (sortOpen && !target.closest("[data-ma-sort]")) {
        setSortOpen(false);
      }
    }
    function onScroll() {
      setMenu(null);
      setSortOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, sortOpen]);

  // Auto-dismiss the action toast.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const counts = useMemo(
    () => ({
      total: agents.length,
      approved: agents.filter((agent) => agent.status === "APPROVED").length,
      review: agents.filter((agent) => agent.status === "PENDING_REVIEW").length,
      draft: agents.filter((agent) => agent.status === "DRAFT").length
    }),
    [agents]
  );

  const liveShareLabel =
    stats.totalAgents > 0 ? `${stats.liveSharePercent}% of total` : "0% of total";
  const agentsAddedDirection: TrendDirection =
    stats.agentsAddedThisMonth > 0 ? "up" : "flat";
  const agentsAddedText =
    stats.agentsAddedThisMonth > 0
      ? `${stats.agentsAddedThisMonth} this month`
      : "No new agents this month";
  const executionsTrendDirection = getTrendDirection(stats.executionsChangePercent);
  const executionsTrendText = formatTrendPercentLabel(stats.executionsChangePercent);

  const visibleAgents = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = agents.filter((agent) => {
      if (filter !== "ALL" && agent.status !== filter) return false;
      if (query) {
        const hay = `${agent.name} ${agent.shortDescription} ${agent.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
    const sorter = SORTS.find((item) => item.key === sort) ?? SORTS[0];
    return [...list].sort(sorter.fn);
  }, [agents, filter, search, sort]);

  // Cards re-run the entrance animation whenever the layout (not the search text) changes.
  const animationKey = `${filter}|${sort}|${view}`;

  function openAgent(agent: ArchitectListing) {
    // Live, draft, and under-review cards open the builder; rejected/suspended open status.
    const target =
      agent.status === "REJECTED" || agent.status === "SUSPENDED"
        ? architectPublishingStatusPath(agent.id)
        : builderHrefFor(agent);
    router.push(target);
  }

  function openMenu(event: React.MouseEvent, agentId: string) {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 192;
    let left = rect.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + 6;
    if (top + 230 > window.innerHeight) {
      top = Math.max(8, rect.top - 6 - 230);
    }
    setMenu((prev) => (prev?.agentId === agentId ? null : { agentId, top, left }));
  }

  async function duplicateAgent(agent: ArchitectListing) {
    setMenu(null);
    if (!agent.workflowId) {
      setToast("This agent has no workflow to duplicate yet.");
      return;
    }

    const workflowResult = await getArchitectWorkflow(agent.workflowId);
    if (!workflowResult.success || !workflowResult.data) {
      setToast(workflowResult.error ?? "Could not load this agent to duplicate.");
      return;
    }

    const source = workflowResult.data.workflow;
    const created = await createArchitectWorkflow({
      name: `${agent.name} (Copy)`,
      description: agent.shortDescription || agent.description || source.description || "",
      isTemplate: false,
      workflowJson: {
        nodes: source.workflowJson?.nodes ?? [],
        edges: source.workflowJson?.edges ?? []
      }
    });

    if (!created.success) {
      setToast(created.error ?? "Could not duplicate this agent.");
      return;
    }

    setToast(`Duplicated “${agent.name}” as a new draft.`);
    setFilter("DRAFT");
    await loadAgents();
  }

  function requestReactivateAgent(agent: ArchitectListing) {
    setMenu(null);
    setReactivateAgent(agent);
  }

  async function executeReactivateAgent() {
    if (!reactivateAgent) return;
    setReactivating(true);
    const result = await updateArchitectListingStatus(reactivateAgent.id, "APPROVED");
    setReactivating(false);
    if (!result.success) {
      setToast(result.error ?? "Could not reactivate this agent.");
      return;
    }
    setReactivateAgent(null);
    setToast(`“${reactivateAgent.name}” is live again.`);
    await loadAgents();
  }

  function requestPauseAgent(agent: ArchitectListing) {
    setMenu(null);
    setPauseAgent(agent);
  }

  async function executePauseAgent() {
    if (!pauseAgent) return;

    setPausing(true);
    const result = await updateArchitectListingStatus(pauseAgent.id, "PAUSED");
    setPausing(false);

    if (!result.success) {
      setToast(result.error ?? "Could not pause this agent.");
      return;
    }

    setPauseAgent(null);
    setToast(`“${pauseAgent.name}” is paused and no longer visible in the marketplace.`);
    await loadAgents();
  }

  function requestCancelSubmission(agent: ArchitectListing) {
    setMenu(null);
    setCancelSubmissionAgent(agent);
  }

  async function executeCancelSubmission() {
    if (!cancelSubmissionAgent) return;

    setCancellingSubmission(true);
    const result = await updateArchitectListingStatus(cancelSubmissionAgent.id, "DRAFT");
    setCancellingSubmission(false);

    if (!result.success) {
      setToast(result.error ?? "Could not cancel this submission.");
      return;
    }

    setCancelSubmissionAgent(null);
    setToast(`Submission cancelled — “${cancelSubmissionAgent.name}” is back in Draft.`);
    await loadAgents();
  }

  async function shareAgent(agent: ArchitectListing) {
    setMenu(null);
    const shareUrl = `${window.location.origin}${MARKETPLACE_PATH}`;

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({
          title: agent.name,
          text: `Check out ${agent.name} on the Triven marketplace.`,
          url: shareUrl
        });
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setToast(`Marketplace link copied for ${agent.name}.`);
        return;
      }

      setToast("Sharing is not available in this browser.");
    } catch {
      setToast("Could not share this agent.");
    }
  }

  function requestDeleteAgent(agent: ArchitectListing) {
    setMenu(null);
    setDeleteAgent(agent);
  }

  async function executeDeleteAgent(reason?: string): Promise<boolean> {
    if (!deleteAgent) return false;

    const isLive = deleteAgent.status === "APPROVED" || deleteAgent.status === "PAUSED";
    if (!isLive && !agentCanBeDeleted(deleteAgent)) return false;

    setDeleting(true);

    // Deleting an Under Review agent first withdraws the submission (the
    // backend only hard-deletes DRAFT/REJECTED listings).
    if (!isWorkflowOnlyDraft(deleteAgent) && deleteAgent.status === "PENDING_REVIEW") {
      const withdrawn = await updateArchitectListingStatus(deleteAgent.id, "DRAFT");
      if (!withdrawn.success) {
        setDeleting(false);
        setToast(withdrawn.error ?? "Could not cancel the review submission.");
        return false;
      }
    }

    const result = isWorkflowOnlyDraft(deleteAgent)
      ? await deleteArchitectWorkflow(deleteAgent.workflowId as string)
      : await deleteArchitectListing(deleteAgent.id, reason);
    setDeleting(false);

    if (!result.success) {
      setToast(result.error ?? "Could not delete this agent.");
      return false;
    }

    if (!isLive) {
      setDeleteAgent(null);
    }
    setToast(`Deleted ${deleteAgent.name}.`);
    await loadAgents();
    return true;
  }

  async function executeDeactivateFromDelete() {
    if (!deleteAgent) return;
    if (deleteAgent.status === "PAUSED") return;

    setDeactivating(true);
    const result = await updateArchitectListingStatus(deleteAgent.id, "PAUSED");
    setDeactivating(false);

    if (!result.success) {
      setToast(result.error ?? "Could not deactivate this agent.");
      return;
    }

    setDeleteAgent(null);
    setToast(`“${deleteAgent.name}” is deactivated (paused).`);
    await loadAgents();
  }

  const menuAgent = menu ? agents.find((agent) => agent.id === menu.agentId) ?? null : null;

  const viewBtnOn = "bg-amber-50 text-amber-600";
  const viewBtnOff = "bg-white text-slate-400 hover:text-slate-600";

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900">
      <style dangerouslySetInnerHTML={{ __html: MY_AGENTS_STYLES }} />

      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 " data-testid="architect-ui-my-agents-view-agents-heading">
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
      </header>

      <main className="p-4 sm:p-6 lg:p-8">
        {/* Stats — values from GET /architect/agents/stats */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {/* Total Agents */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-total-agents-text">
              Total Agents
            </p>
            <p className="mt-1 text-3xl font-bold text-slate-900" data-testid="architect-ui-my-agents-view-counts-total-text">
              <CountUp value={stats.totalAgents} />
            </p>
            <TrendFooter direction={agentsAddedDirection} testId="my-agents-stats-agents-added-trend">
              {agentsAddedText}
            </TrendFooter>
          </div>

          {/* Live & earning */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-approved-text">
              Live &amp; Earning
            </p>
            <p className="mt-1 text-3xl font-bold text-green-600" data-testid="architect-ui-my-agents-view-counts-approved-text">
              <CountUp value={stats.liveAndEarning} />
            </p>
            <TrendFooter direction="flat" testId="my-agents-stats-live-share">
              {liveShareLabel}
            </TrendFooter>
          </div>

          {/* Total Executions */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-in-review-text">
              Total Executions
            </p>
            <p className="mt-1 text-3xl font-bold text-slate-900" data-testid="architect-ui-my-agents-view-counts-review-text">
              <CountUp value={stats.totalExecutions} />
            </p>
            <TrendFooter direction={executionsTrendDirection} testId="my-agents-stats-executions-trend">
              {executionsTrendText}
            </TrendFooter>
          </div>

          {/* Total approved earnings — same value as the Payouts page. */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-drafts-text">
              Revenue
            </p>
            <p className="mt-1 text-3xl font-bold text-orange-500" data-testid="architect-ui-my-agents-view-counts-draft-text">
              <CountUp value={stats.totalEarningsCents / 100} format="money" />
            </p>
            <p className="mt-1 text-xs font-semibold text-slate-400">Total approved earnings</p>
          </div>
        </div>

      {/* Filter + view controls */}
      <section className="mx-auto mt-6 w-full max-w-full">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2" role="tablist" data-testid="my-agents-filter-tabs">
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
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    active ? "border border-slate-900 bg-slate-900 text-white" : "border border-gray-200 bg-white text-slate-600 hover:border-amber-300"
                  }`}
                >
                  {tab.dot ? <span className={`h-1.5 w-1.5 rounded-full ${tab.dot}`} /> : null}
                  <span>{tab.label}</span>
                  <span className={active ? "text-white/60" : "text-slate-400"}>{count}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search agents…"
                aria-label="Search agents"
                data-testid="my-agents-search-input"
                className="w-56 rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 placeholder-slate-400 transition-all focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
              />
            </div>

            <div className="relative" data-ma-sort>
              <button
                type="button"
                onClick={() => setSortOpen((open) => !open)}
                aria-haspopup="true"
                aria-expanded={sortOpen}
                data-testid="my-agents-sort-button"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-slate-500 transition-colors hover:border-amber-300 hover:text-slate-700"
              >
                <span className="text-slate-400">Sort:</span>
                <span className="font-medium text-slate-600">{SORTS.find((item) => item.key === sort)?.label}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {sortOpen ? (
                <div className="ma-pop absolute right-0 z-40 mt-2 w-52 rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl" role="menu" data-testid="my-agents-sort-menu">
                  {SORTS.map((item) => {
                    const active = sort === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setSort(item.key);
                          setSortOpen(false);
                        }}
                        className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors ${
                          active ? "bg-amber-50/60 font-medium text-amber-600" : "text-slate-700 hover:bg-gray-50"
                        }`}
                      >
                        <span>{item.label}</span>
                        {active ? <span className="text-amber-500"><CheckIcon /></span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="flex overflow-hidden rounded-lg border border-gray-200" role="group" aria-label="View mode">
              <button
                type="button"
                onClick={() => setView("grid")}
                aria-label="Grid view"
                aria-pressed={view === "grid"}
                data-testid="my-agents-view-grid"
                className={`p-2 transition-colors ${view === "grid" ? viewBtnOn : viewBtnOff}`}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                aria-label="List view"
                aria-pressed={view === "list"}
                data-testid="my-agents-view-list"
                className={`p-2 transition-colors ${view === "list" ? viewBtnOn : viewBtnOff}`}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3.5" y1="6" x2="3.51" y2="6" />
                  <line x1="3.5" y1="12" x2="3.51" y2="12" />
                  <line x1="3.5" y1="18" x2="3.51" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Agent grid / list */}
      <section className="mx-auto mt-5 w-full max-w-full pb-12">
        {loading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-72 animate-pulse rounded-2xl border border-gray-100 bg-white shadow-sm" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <EmptyAgentsState />
        ) : visibleAgents.length ? (
          <div
            key={animationKey}
            className={`ma-grid grid grid-cols-1 gap-5 ${view === "list" ? "view-list" : "md:grid-cols-2 lg:grid-cols-3"}`}
          >
            {visibleAgents.map((agent, index) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                index={index}
                animate
                onOpen={openAgent}
                onDots={openMenu}
                onDuplicate={duplicateAgent}
                onPause={requestPauseAgent}
                onDelete={requestDeleteAgent}
                onCancelSubmission={requestCancelSubmission}
              />
            ))}
          </div>
        ) : (
          <EmptyAgentsState message={search.trim() ? "No agents match your search. Try a different keyword or clear the search." : "You have no agents in this category yet. Create one or change the filter to see more."} />
        )}
      </section>
      </main>

      {/* Floating 3-dot menu */}
      {menu && menuAgent ? (
        <div
          data-ma-menu
          role="menu"
          aria-label="Agent actions"
          data-testid={`my-agents-actions-menu-${menuAgent.id}`}
          className="ma-pop fixed z-[60] w-48 rounded-xl border border-gray-100 bg-white py-2 shadow-xl"
          style={{ top: menu.top, left: menu.left }}
        >
          {menuAgent.status !== "APPROVED" && menuAgent.status !== "PENDING_REVIEW" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                router.push(builderHrefFor(menuAgent));
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-gray-50"
            >
              <PencilIcon />
              <span>Edit Agent</span>
            </button>
          ) : null}

          {menuAgent.status === "PAUSED" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => requestReactivateAgent(menuAgent)}
              data-testid={`my-agents-menu-reactivate-${menuAgent.id}`}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-green-700 transition-colors hover:bg-green-50"
            >
              <PlayIcon />
              <span>Reactivate</span>
            </button>
          ) : null}

          <button
            type="button"
            role="menuitem"
            onClick={() => void duplicateAgent(menuAgent)}
            data-testid={`my-agents-menu-duplicate-${menuAgent.id}`}
            className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-gray-50"
          >
            <CopyIcon />
            <span>Duplicate</span>
          </button>

          {menuAgent.status === "APPROVED" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void shareAgent(menuAgent)}
              data-testid={`my-agents-menu-share-${menuAgent.id}`}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-gray-50"
            >
              <ShareIcon />
              <span>Share</span>
            </button>
          ) : null}

          {menuAgent.status === "APPROVED" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                router.push(architectAnalyticsPath(menuAgent.id));
              }}
              data-testid={`my-agents-menu-analytics-${menuAgent.id}`}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-gray-50"
            >
              <ChartIcon />
              <span>View analytics</span>
            </button>
          ) : null}

          {menuAgent.status !== "DRAFT" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                router.push(architectPublishingStatusPath(menuAgent.id));
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-gray-50"
            >
              <StatusGlyphIcon />
              <span>View status</span>
            </button>
          ) : null}

          <div className="my-1 border-t border-gray-100" />
          {menuAgent.status === "PENDING_REVIEW" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => requestCancelSubmission(menuAgent)}
              data-testid={`my-agents-menu-withdraw-${menuAgent.id}`}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-amber-700 transition-colors hover:bg-amber-50"
            >
              <StatusGlyphIcon />
              <span>Withdraw</span>
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => requestDeleteAgent(menuAgent)}
              data-testid={`my-agents-menu-delete-${menuAgent.id}`}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              <TrashIcon />
              <span>Delete</span>
            </button>
          )}
        </div>
      ) : null}

      {/* Toast */}
      {toast ? (
        <div className="fixed bottom-5 right-5 z-[70] flex flex-col items-end gap-2" aria-live="polite">
          <div className="ma-pop max-w-xs rounded-xl border border-gray-100 border-l-4 border-l-amber-500 bg-white px-4 py-3 text-sm text-slate-700 shadow-lg" data-testid="my-agents-toast">
            {toast}
          </div>
        </div>
      ) : null}

      {reactivateAgent ? (
        <ReactivateAgentModal
          agent={reactivateAgent}
          reactivating={reactivating}
          onClose={() => !reactivating && setReactivateAgent(null)}
          onConfirm={() => void executeReactivateAgent()}
        />
      ) : null}

      {deleteAgent ? (
        <DeleteAgentModal
          agent={deleteAgent}
          deleting={deleting}
          deactivating={deactivating}
          onClose={() => !deleting && !deactivating && setDeleteAgent(null)}
          onConfirm={(reason) => executeDeleteAgent(reason)}
          onDeactivate={() => void executeDeactivateFromDelete()}
        />
      ) : null}

      {pauseAgent ? (
        <PauseAgentModal
          agent={pauseAgent}
          pausing={pausing}
          onClose={() => !pausing && setPauseAgent(null)}
          onConfirm={() => void executePauseAgent()}
        />
      ) : null}

      {cancelSubmissionAgent ? (
        <CancelSubmissionModal
          agent={cancelSubmissionAgent}
          cancelling={cancellingSubmission}
          onClose={() => !cancellingSubmission && setCancelSubmissionAgent(null)}
          onConfirm={() => void executeCancelSubmission()}
        />
      ) : null}
    </div>
  );
}
