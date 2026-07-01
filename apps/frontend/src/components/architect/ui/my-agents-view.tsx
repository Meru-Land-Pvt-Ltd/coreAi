"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatDate, formatMoney } from "@/components/architect/ui/architect-ui";
import {
  createArchitectWorkflow,
  deleteArchitectWorkflow,
  getArchitectListings,
  getArchitectWorkflow
} from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";
import { getAuthUser } from "@/lib/auth";
import { architectPublishingStatusPath, architectAnalyticsPath } from "@/lib/routes";

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
  .ma-pulse-dot, .ma-spin-slow, .ma-card.ma-entering, .ma-pop { animation: none !important; }
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
      ) : null}
      {style.label}
    </span>
  );
}

function StatusBand({ agent }: { agent: ArchitectListing }) {
  if (agent.status === "PENDING_REVIEW") {
    return (
      <div className="ma-band border-t border-amber-100 bg-amber-50/60 px-5 py-3" data-testid={`my-agents-review-notice-${agent.id}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-amber-700">Review in progress</span>
          <span className="text-xs text-amber-600">Pending</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-amber-100">
          <div className="h-full w-2/3 rounded-full bg-amber-500" />
        </div>
        <p className="ma-extra mt-1.5 text-xs text-amber-600">Will be live in 24–48 hrs after review</p>
      </div>
    );
  }

  if (agent.status === "DRAFT") {
    return (
      <div className="ma-band border-t border-gray-100 bg-slate-50 px-5 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">Completion</span>
          <span className="text-xs text-slate-400">Draft</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div className="h-full w-1/3 rounded-full bg-slate-400" />
        </div>
        <p className="ma-extra mt-1.5 text-xs text-slate-500">Finish setup and publish to go live</p>
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

  // APPROVED / live — surface the real listing facts we have.
  return (
    <div className="ma-band grid grid-cols-3 gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
      <div>
        <div className="text-[11px] text-slate-400">Price</div>
        <div className="text-sm font-bold text-amber-600">{formatMoney(agent.priceCents)}</div>
      </div>
      <div>
        <div className="text-[11px] text-slate-400">Connectors</div>
        <div className="text-sm font-bold text-slate-900">{agent.requiredConnectors.length}</div>
      </div>
      <div>
        <div className="text-[11px] text-slate-400">Installed</div>
        <div className="text-sm font-bold text-slate-900" data-testid={`my-agents-install-count-${agent.id}`}>
          {agent.installCount ?? 0}
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
  onDuplicate
}: {
  agent: ArchitectListing;
  onDuplicate: (agent: ArchitectListing) => void;
}) {
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  const builderHref = builderHrefFor(agent);
  const statusHref = architectPublishingStatusPath(agent.id);

  if (agent.status === "APPROVED") {
    return (
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
    );
  }

  if (agent.status === "PENDING_REVIEW") {
    return (
      <Link
        data-testid={`my-agents-update-${agent.id}-link`}
        href={statusHref}
        onClick={stop}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-50"
      >
        View status <ArrowIcon />
      </Link>
    );
  }

  if (agent.status === "DRAFT") {
    return (
      <Link
        data-testid={`my-agents-update-${agent.id}-link`}
        href={builderHref}
        onClick={stop}
        className="ma-continue inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-50"
      >
        Continue Building <ArrowIcon />
      </Link>
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
  architectName,
  index,
  animate,
  onOpen,
  onDots,
  onDuplicate
}: {
  agent: ArchitectListing;
  architectName: string;
  index: number;
  animate: boolean;
  onOpen: (agent: ArchitectListing) => void;
  onDots: (event: React.MouseEvent, agentId: string) => void;
  onDuplicate: (agent: ArchitectListing) => void;
}) {
  const style = STATUS_STYLES[agent.status];
  const dashed = agent.status === "DRAFT" ? "border-dashed border-gray-200" : "border-gray-100";

  return (
    <article
      data-testid={`my-agents-card-${agent.id}`}
      role="button"
      tabIndex={0}
      aria-label={`${agent.name}, ${style.label}. Press Enter to open.`}
      onClick={() => onOpen(agent)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(agent);
        }
      }}
      style={animate ? { animationDelay: `${Math.min(index * 35, 280)}ms` } : undefined}
      className={`ma-card group relative cursor-pointer overflow-hidden rounded-2xl border ${dashed} bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ${
        animate ? "ma-entering" : ""
      }`}
    >
      <div className="ma-top flex items-start justify-between px-5 pb-3 pt-5">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${style.iconBg} ${style.iconBorder} ${style.iconText}`}>
          <PhoneGlyph />
        </span>

        <div className="ma-top-actions flex items-center gap-1">
          <StatusPill status={agent.status} />
          <button
            type="button"
            data-ma-dots
            onClick={(event) => onDots(event, agent.id)}
            data-testid={`my-agents-menu-${agent.id}-button`}
            aria-haspopup="true"
            aria-label={`More actions for ${agent.name}`}
            className="-mr-1 rounded-md p-1 text-slate-300 transition-colors hover:bg-gray-50 hover:text-slate-500 focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <DotsIcon />
          </button>
        </div>
      </div>

      <div className="ma-body min-w-0 px-5 pb-3">
        <h2 className="truncate text-base font-semibold text-slate-900" data-testid="architect-ui-my-agents-view-agent-heading">
          {agent.name}
        </h2>

        <p className="mt-0.5 truncate text-xs text-slate-500" data-testid="architect-ui-my-agents-view-agent-workflow-from-agent-workflow-marketplace-package-text">
          by {architectName}
        </p>

        <p className="ma-desc mt-2 line-clamp-2 text-sm leading-relaxed text-slate-500" data-testid="architect-ui-my-agents-view-agent-short-description-no-description-added-yet-text">
          {agent.shortDescription || "No description added yet."}
        </p>

        <div className="ma-extra mt-2.5 flex flex-wrap gap-1.5">
          {agent.tags.length ? (
            agent.tags.slice(0, 3).map((tag) => (
              <span key={`${agent.id}-${tag}`} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-slate-600" data-testid="architect-ui-my-agents-view-tag-text">
                {tag}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-slate-500" data-testid="architect-ui-my-agents-view-no-tags-text">
              No tags
            </span>
          )}
        </div>
      </div>

      <StatusBand agent={agent} />

      <div className="ma-foot flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
        <span className="ma-updated whitespace-nowrap text-xs text-slate-400" data-testid="architect-ui-my-agents-view-format-date-agent-created-at-text">
          Created {formatDate(agent.createdAt)}
        </span>
        <div className="flex items-center gap-1">
          <FooterActions agent={agent} onDuplicate={onDuplicate} />
        </div>
      </div>
    </article>
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
  return <>{format === "money" ? formatMoney(rounded * 100) : rounded.toLocaleString("en-US")}</>;
}

export function MyAgentsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [agents, setAgents] = useState<ArchitectListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [architectName, setArchitectName] = useState("Architect");
  const [filter, setFilter] = useState<AgentFilter>("ALL");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [view, setView] = useState<ViewMode>("grid");
  const [sortOpen, setSortOpen] = useState(false);
  const [menu, setMenu] = useState<{ agentId: string; top: number; left: number } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; confirmLabel: string; run: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const user = getAuthUser();
    const name = user?.fullName?.trim() || user?.email?.trim() || "Architect";
    setArchitectName(name);
  }, []);

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
    const result = await getArchitectListings();
    if (result.success && result.data) {
      setAgents(result.data.listings);
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

  const approvedShare = counts.total ? `${Math.round((counts.approved / counts.total) * 100)}% of total` : "0% of total";

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
    // Draft and under-review cards open the builder; live/rejected open the status page.
    const target =
      agent.status === "DRAFT" || agent.status === "PENDING_REVIEW"
        ? builderHrefFor(agent)
        : architectPublishingStatusPath(agent.id);
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

  function requestDeleteDraft(agent: ArchitectListing) {
    setMenu(null);
    if (!agent.workflowId) return;
    setConfirm({
      message: `Delete “${agent.name}”? This can’t be undone.`,
      confirmLabel: "Delete draft",
      run: async () => {
        const result = await deleteArchitectWorkflow(agent.workflowId as string);
        if (!result.success) {
          setToast(result.error ?? "Could not delete this draft.");
          return;
        }
        setToast(`Deleted “${agent.name}”.`);
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

  const menuAgent = menu ? agents.find((agent) => agent.id === menu.agentId) ?? null : null;

  const viewBtnOn = "bg-amber-50 text-amber-600";
  const viewBtnOff = "bg-white text-slate-400 hover:text-slate-600";

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <style dangerouslySetInnerHTML={{ __html: MY_AGENTS_STYLES }} />

      <header className="mx-auto w-full max-w-full">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900" data-testid="architect-ui-my-agents-view-agents-heading">
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

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-total-agents-text">
              Total Agents
            </p>
            <p className="mt-1 text-3xl font-bold text-slate-900" data-testid="architect-ui-my-agents-view-counts-total-text">
              <CountUp value={counts.total} />
            </p>
            <p className="mt-1 text-xs text-slate-400">Across all statuses</p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-approved-text">
              Live &amp; Approved
            </p>
            <p className="mt-1 text-3xl font-bold text-green-600" data-testid="architect-ui-my-agents-view-counts-approved-text">
              <CountUp value={counts.approved} />
            </p>
            <p className="mt-1 text-xs text-slate-400">{approvedShare}</p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-in-review-text">
              In Review
            </p>
            <p className="mt-1 text-3xl font-bold text-amber-600" data-testid="architect-ui-my-agents-view-counts-review-text">
              <CountUp value={counts.review} />
            </p>
            <p className="mt-1 text-xs text-slate-400">Awaiting approval</p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500" data-testid="architect-ui-my-agents-view-drafts-text">
              Drafts
            </p>
            <p className="mt-1 text-3xl font-bold text-slate-800" data-testid="architect-ui-my-agents-view-counts-draft-text">
              <CountUp value={counts.draft} />
            </p>
            <p className="mt-1 text-xs text-slate-400">Not published yet</p>
          </div>
        </div>
      </header>

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
                architectName={architectName}
                index={index}
                animate
                onOpen={openAgent}
                onDots={openMenu}
                onDuplicate={duplicateAgent}
              />
            ))}
          </div>
        ) : (
          <EmptyAgentsState message={search.trim() ? "No agents match your search. Try a different keyword or clear the search." : "You have no agents in this category yet. Create one or change the filter to see more."} />
        )}
      </section>

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
          {menuAgent.status !== "APPROVED" ? (
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

          {menuAgent.status === "DRAFT" ? (
            <>
              <div className="my-1 border-t border-gray-100" />
              <button
                type="button"
                role="menuitem"
                onClick={() => requestDeleteDraft(menuAgent)}
                data-testid={`my-agents-menu-delete-${menuAgent.id}`}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
              >
                <TrashIcon />
                <span>Delete Agent</span>
              </button>
            </>
          ) : null}
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

      {confirm ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" data-testid="my-agents-confirm-modal" onClick={() => !busy && setConfirm(null)}>
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
