"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  CalendarDays,
  Check,
  CircleDollarSign,
  Download,
  Search,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import {
  deleteAdminAgent,
  getAdminAgents,
  updateAdminAgentStatus,
  type AdminAgent,
  type ListingStatus
} from "@/components/admin/features/api";
import { AdminReferenceHeader } from "@/components/admin/ui/admin-reference-header";

type PriorityFilter = "ALL" | "High" | "Standard";

const PRIORITY_FILTERS: Array<{ label: string; value: PriorityFilter }> = [
  { label: "All", value: "ALL" },
  { label: "High Priority", value: "High" },
  { label: "Standard", value: "Standard" }
];

const REVIEW_CHECKS = [
  "Description quality",
  "Pricing appropriate",
  "No harmful content",
  "Tested successfully"
];

function display(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : "N/A";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "N/A";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function sortableDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value).getTime();
  return Number.isNaN(date) ? null : date;
}

function formatMoney(priceCents: number | null | undefined) {
  if (priceCents === null || priceCents === undefined || !Number.isFinite(priceCents)) return "N/A";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(priceCents / 100);
}

function formatCount(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "N/A" : value.toLocaleString();
}

function architectName(agent: AdminAgent) {
  return display(agent.architect?.fullName ?? agent.architect?.email);
}

function agentDescription(agent: AdminAgent) {
  return display(agent.description ?? agent.shortDescription);
}

function PriorityBadge({ priority }: { priority: AdminAgent["priority"] }) {
  if (!priority) {
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">N/A</span>
    );
  }

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
        priority === "High" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-slate-600"
      }`}
    >
      {priority === "High" ? "High Priority" : "Standard"}
    </span>
  );
}

const AGENT_STATUS_STYLES: Record<AdminAgent["status"], string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  PENDING_REVIEW: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
  SUSPENDED: "bg-violet-100 text-violet-700",
  PAUSED: "bg-gray-100 text-gray-700"
};

const AGENT_STATUS_LABELS: Record<AdminAgent["status"], string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
  PAUSED: "Paused"
};

function AgentStatusBadge({ status }: { status: AdminAgent["status"] }) {
  return (
    <span
      data-testid={`admin-agent-status-${status.toLowerCase()}`}
      className={`inline-flex rounded-xl px-4 py-2 text-sm font-bold ${AGENT_STATUS_STYLES[status]}`}
    >
      {AGENT_STATUS_LABELS[status]}
    </span>
  );
}

type ReviewModalProps = {
  agent: AdminAgent;
  isUpdating: boolean;
  onClose: () => void;
  onDecision: (status: ListingStatus, reason?: string) => Promise<boolean>;
};

function ReviewModal({ agent, isUpdating, onClose, onDecision }: ReviewModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [checks, setChecks] = useState(() => REVIEW_CHECKS.map(() => true));
  const [notes, setNotes] = useState("");
  const allChecked = checks.every(Boolean);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isUpdating) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isUpdating, onClose]);

  async function decide(status: ListingStatus, reason?: string) {
    const saved = await onDecision(status, reason);
    if (saved) onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-agent-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isUpdating) onClose();
      }}
    >
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div>
            <h2 id="review-agent-title" className="text-lg font-extrabold tracking-tight text-slate-900">Review Agent</h2>
            <p className="mt-0.5 text-sm text-slate-400">Verify before publishing to the marketplace</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            disabled={isUpdating}
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Close review"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700">
              <Bot className="h-7 w-7" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-extrabold tracking-tight text-slate-900">{display(agent.name)}</h3>
                <PriorityBadge priority={agent.priority} />
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                by <span className="font-semibold text-slate-700">{architectName(agent)}</span>
                <span aria-hidden="true"> · </span>{display(agent.architectTier)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Category", display(agent.category)],
              ["Price", formatMoney(agent.priceCents)],
              ["Submitted", formatDate(agent.submittedAt)],
              ["Priority", display(agent.priority)]
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="mt-0.5 text-sm font-bold text-slate-800">{value}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Description</p>
            <p className="text-sm leading-relaxed text-slate-600">{agentDescription(agent)}</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-slate-900">Review checklist</p>
            <div className="space-y-2">
              {REVIEW_CHECKS.map((label, index) => (
                <label key={label} className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-100 p-3 transition hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={checks[index]}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setChecks((current) => current.map((value, itemIndex) => itemIndex === index ? checked : value));
                    }}
                    className="h-4 w-4 rounded border-gray-300 accent-amber-500"
                  />
                  <span className="text-sm font-medium text-slate-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="review-notes" className="mb-1.5 block text-sm font-bold text-slate-900">Notes to architect</label>
            <textarea
              id="review-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional feedback the architect will receive…"
              className="w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-gray-100 px-6 py-4 sm:flex-row">
          <button
            type="button"
            disabled={isUpdating || !allChecked}
            onClick={() => void decide("APPROVED", notes.trim() || undefined)}
            className="flex-1 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve &amp; Publish
          </button>
          <button
            type="button"
            disabled={isUpdating}
            onClick={() => void decide("PENDING_REVIEW", notes.trim() || undefined)}
            className="flex-1 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-4 py-2.5 text-sm font-bold text-white transition hover:from-amber-500 hover:to-amber-600 disabled:cursor-wait disabled:opacity-50"
          >
            Request Changes
          </button>
          <button
            type="button"
            disabled={isUpdating}
            onClick={() => void decide("REJECTED", notes.trim() || undefined)}
            className="flex-1 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
          >
            Reject
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

export default function AdminAgentsPage() {
  const [rows, setRows] = useState<AdminAgent[]>([]);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("ALL");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [reviewingAgent, setReviewingAgent] = useState<AdminAgent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminAgent | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load(searchValue: string) {
    setState("loading");
    setMessage("");
    const result = await getAdminAgents({
      search: searchValue,
      limit: 100
    });

    if (result.success && result.data) {
      const pageCount = Math.ceil(result.data.total / result.data.limit);
      const remainingPages = await Promise.all(
        Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
          getAdminAgents({
            search: searchValue,
            page: index + 2,
            limit: result.data!.limit
          })
        )
      );

      if (remainingPages.some((pageResult) => !pageResult.success || !pageResult.data)) {
        setRows([]);
        setState("error");
        return;
      }

      setRows([
        ...result.data.items,
        ...remainingPages.flatMap((pageResult) => pageResult.data?.items ?? [])
      ]);
      setState("ready");
      return;
    }

    setRows([]);
    setState("error");
  }

  useEffect(() => {
    void load("");
  }, []);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((agent) => priorityFilter === "ALL" || agent.priority === priorityFilter);

    return [...filtered].sort((left, right) => {
      const leftDate = sortableDate(left.submittedAt);
      const rightDate = sortableDate(right.submittedAt);
      if (leftDate === null && rightDate === null) return 0;
      if (leftDate === null) return 1;
      if (rightDate === null) return -1;
      return sort === "newest" ? rightDate - leftDate : leftDate - rightDate;
    });
  }, [priorityFilter, rows, sort]);

  const hasPriorityData = rows.some((agent) => agent.priority === "High" || agent.priority === "Standard");
  const pendingCount = state === "ready"
    ? rows.filter((agent) => agent.status === "PENDING_REVIEW").length
    : null;

  async function changeStatus(listingId: string, status: ListingStatus, reason?: string) {
    setMessage("Updating listing status…");
    setUpdatingId(listingId);
    const result = await updateAdminAgentStatus(listingId, status, reason);

    if (!result.success) {
      setMessage(result.error ?? "Could not update listing status.");
      setUpdatingId(null);
      return false;
    }

    setMessage(
      status === "APPROVED"
        ? "Agent approved and published."
        : status === "PENDING_REVIEW"
          ? "Changes requested and sent to the architect."
          : "Agent rejected."
    );
    const updatedStatus = result.data?.listing.status
      ?? (status === "PENDING_REVIEW" ? "REJECTED" : status);
    setRows((current) => current.map((row) => (
      row.id === listingId ? { ...row, status: updatedStatus } : row
    )));
    setUpdatingId(null);
    return true;
  }

  function openDeleteDialog(agent: AdminAgent) {
    setDeleteTarget(agent);
    setDeleteConfirmation("");
    setDeleteError("");
    setMessage("");
  }

  function closeDeleteDialog() {
    if (deletingId) return;
    setDeleteTarget(null);
    setDeleteConfirmation("");
    setDeleteError("");
  }

  async function permanentlyDeleteAgent() {
    if (!deleteTarget || deleteConfirmation !== "DELETE" || deletingId) return;

    const target = deleteTarget;
    setDeletingId(target.id);
    setDeleteError("");
    const result = await deleteAdminAgent(target.id, "DELETE");

    if (!result.success) {
      setDeleteError(result.error ?? "Could not delete agent.");
      setDeletingId(null);
      return;
    }

    setRows((current) => current.filter((agent) => agent.id !== target.id));
    setMessage(
      result.data?.softDeleted
        ? `${target.name} was removed and unpublished. Buyer installs and payment history were preserved.`
        : `${target.name} and its unused workflow were permanently deleted.`
    );
    setDeleteTarget(null);
    setDeleteConfirmation("");
    setDeleteError("");
    setDeletingId(null);
  }

  return (
    <div className="w-full max-w-full">
      <AdminReferenceHeader active="moderation" title="Moderation Queue" pendingCount={pendingCount} />

      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Moderation Queue</h1>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700 tabular-nums">
            {typeof pendingCount === "number" ? `${pendingCount.toLocaleString()} pending review` : "N/A pending review"}
          </span>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void load(search.trim());
            }}
            className="flex w-full gap-2 sm:w-auto"
          >
            <label className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
              <span className="sr-only">Search moderation queue</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                data-testid="admin-agents-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search agent name…"
                className="h-9 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              />
            </label>
            <button type="submit" className="h-9 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white transition hover:bg-amber-600">
              Search
            </button>
          </form>

          <div className="inline-flex w-fit rounded-xl bg-gray-100 p-1" role="group" aria-label="Sort moderation queue">
            {(["newest", "oldest"] as const).map((value) => {
              const selected = sort === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSort(value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    selected ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {value === "newest" ? "Newest First" : "Oldest First"}
                </button>
              );
            })}
          </div>

          <div className="inline-flex w-fit rounded-xl bg-gray-100 p-1" role="group" aria-label="Filter moderation queue by priority">
            {PRIORITY_FILTERS.map((filter) => {
              const selected = priorityFilter === filter.value;
              const unavailable = filter.value !== "ALL" && !hasPriorityData;
              return (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={selected}
                  disabled={unavailable}
                  title={unavailable ? "Priority is not available for these listings" : undefined}
                  onClick={() => setPriorityFilter(filter.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    selected ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  } disabled:cursor-not-allowed disabled:text-slate-300`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {message ? (
        <p data-testid="admin-agents-message" role="status" className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
          {message}
        </p>
      ) : null}

      {state === "loading" ? (
        <div data-testid="admin-agents-loading" className="mt-6 space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-xl border border-gray-100 bg-white" />
          ))}
        </div>
      ) : state === "error" ? (
        <p data-testid="admin-agents-error" className="mt-6 rounded-2xl border border-red-100 bg-red-50 p-5 text-sm font-semibold text-red-700">
          Could not load agents.
        </p>
      ) : visibleRows.length === 0 ? (
        <div data-testid="admin-agents-empty" className="mt-6 rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-500">
            <Check className="h-6 w-6" aria-hidden="true" />
          </span>
          <p className="mt-4 font-bold text-slate-900">No agents found</p>
          <p className="mt-1 text-sm text-slate-400">No agents match this search or filter.</p>
        </div>
      ) : (
        <div data-testid="admin-agents-grid" className="mt-6 space-y-4">
          {visibleRows.map((agent) => {
            const isUpdating = updatingId === agent.id;

            return (
              <article
                key={agent.id}
                data-testid={`admin-agent-card-${agent.id}`}
                className="rounded-xl border border-gray-100 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-[0_10px_28px_-12px_rgba(15,23,42,0.18)]"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700">
                    <Bot className="h-6 w-6" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900">{display(agent.name)}</h2>
                      <PriorityBadge priority={agent.priority} />
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      by <span className="font-semibold text-slate-700">{architectName(agent)}</span>
                      <span aria-hidden="true"> · </span>{display(agent.architectTier)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" aria-hidden="true" />
                        {display(agent.category)}
                      </span>
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                        <CircleDollarSign className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        {formatMoney(agent.priceCents)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        Submitted {formatDate(agent.submittedAt)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Download className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        {formatCount(agent.installedAgentsCount)} listing installs
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        Architect: {formatCount(agent.architectTotalInstalls)} total installs
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                    {agent.status === "PENDING_REVIEW" ? (
                      <>
                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => setReviewingAgent(agent)}
                          className="rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgba(245,158,11,0.65)] transition hover:from-amber-500 hover:to-amber-600 disabled:opacity-50"
                        >
                          Review
                        </button>
                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => void changeStatus(agent.id, "APPROVED")}
                          className="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-50"
                        >
                          Quick Approve
                        </button>
                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => void changeStatus(agent.id, "REJECTED")}
                          className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <AgentStatusBadge status={agent.status} />
                    )}
                    <button
                      type="button"
                      disabled={isUpdating || deletingId === agent.id}
                      onClick={() => openDeleteDialog(agent)}
                      aria-label={`Delete ${agent.name}`}
                      data-testid={`admin-agent-delete-${agent.id}`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {reviewingAgent ? (
        <ReviewModal
          agent={reviewingAgent}
          isUpdating={updatingId === reviewingAgent.id}
          onClose={() => setReviewingAgent(null)}
          onDecision={(status, reason) => changeStatus(reviewingAgent.id, status, reason)}
        />
      ) : null}

      {deleteTarget ? createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-agent-title"
            data-testid="admin-agent-delete-dialog"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h2 id="delete-agent-title" className="text-lg font-extrabold text-slate-900">Permanently delete agent?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This removes <span className="font-semibold text-slate-900">{deleteTarget.name}</span> from the platform. Unsold agents and their unused workflow are permanently deleted. For sold agents, buyer installs and financial history are preserved. This cannot be undone.
            </p>
            <label className="mt-5 block text-sm font-semibold text-slate-700">
              Type <span className="font-mono text-red-600">DELETE</span> to confirm
              <input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                autoFocus
                disabled={Boolean(deletingId)}
                data-testid="admin-agent-delete-confirmation"
                className="mt-2 h-11 w-full rounded-xl border border-gray-200 px-3 font-mono text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:bg-gray-50"
              />
            </label>
            {deleteError ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{deleteError}</p> : null}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={closeDeleteDialog} disabled={Boolean(deletingId)} className="h-10 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-slate-600 disabled:opacity-50">Cancel</button>
              <button
                type="button"
                onClick={() => void permanentlyDeleteAgent()}
                disabled={deleteConfirmation !== "DELETE" || Boolean(deletingId)}
                data-testid="admin-agent-confirm-delete"
                className="h-10 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deletingId ? "Deleting…" : "Permanently delete"}
              </button>
            </div>
          </section>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
