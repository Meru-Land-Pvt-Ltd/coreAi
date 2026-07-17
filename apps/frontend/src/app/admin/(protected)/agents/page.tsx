"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  CalendarDays,
  CircleDollarSign,
  Download,
  Search,
  UserRound,
  Workflow
} from "lucide-react";
import {
  getAdminAgents,
  updateAdminAgentStatus,
  type AdminAgent,
  type ListingStatus
} from "@/components/admin/features/api";

const STATUSES: ListingStatus[] = ["PENDING_REVIEW", "APPROVED", "REJECTED"];

const STATUS_STYLES: Record<AdminAgent["status"], string> = {
  DRAFT: "border-gray-200 bg-gray-50 text-slate-600",
  PENDING_REVIEW: "border-amber-200 bg-amber-50 text-amber-700",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
  SUSPENDED: "border-slate-300 bg-slate-100 text-slate-700"
};

function formatStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

export default function AdminAgentsPage() {
  const [rows, setRows] = useState<AdminAgent[]>([]);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load(searchValue: string) {
    setState("loading");
    const result = await getAdminAgents({ search: searchValue, limit: 50 });
    if (result.success && result.data) {
      setRows(result.data.items);
      setState("ready");
    } else {
      setState("error");
    }
  }

  useEffect(() => {
    void load("");
  }, []);

  async function changeStatus(listingId: string, status: ListingStatus) {
    setMessage("Updating…");
    setUpdatingId(listingId);
    const result = await updateAdminAgentStatus(listingId, status);
    if (!result.success) {
      setMessage(result.error ?? "Could not update listing status.");
      setUpdatingId(null);
      return;
    }
    setMessage("Listing status updated.");
    setRows((current) => current.map((row) => (row.id === listingId ? { ...row, status } : row)));
    setUpdatingId(null);
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-normal text-slate-900">Agent listings</h1>
        <p className="mt-1 text-sm text-slate-500">Review and moderate marketplace listings.</p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(search.trim());
        }}
        className="mb-4 flex gap-2"
      >
        <input
          data-testid="admin-agents-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by agent name"
          className="w-full max-w-md rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:border-amber-400"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-300"
        >
          <Search aria-hidden="true" className="h-4 w-4" />
          Search
        </button>
      </form>

      {message ? <p data-testid="admin-agents-message" className="mb-3 text-sm font-semibold text-amber-700">{message}</p> : null}

      {state === "loading" ? (
        <p data-testid="admin-agents-loading" className="text-sm font-semibold text-amber-700">Loading…</p>
      ) : state === "error" ? (
        <p data-testid="admin-agents-error" className="text-sm font-semibold text-red-600">Could not load agents.</p>
      ) : rows.length === 0 ? (
        <p data-testid="admin-agents-empty" className="text-sm font-semibold text-slate-500">No agent listings found.</p>
      ) : (
        <div
          data-testid="admin-agents-grid"
          className="grid w-full max-w-full grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
        >
          {rows.map((agent) => {
            const isUpdating = updatingId === agent.id;
            const architectName = agent.architect?.fullName ?? agent.architect?.email ?? "Unknown architect";

            return (
              <article
                key={agent.id}
                data-testid={`admin-agent-card-${agent.id}`}
                className="flex min-h-[360px] min-w-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm transition hover:border-amber-200 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700">
                      <Bot aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-bold text-slate-900">{agent.name}</h2>
                      <p className="mt-1 truncate text-xs text-slate-400">{agent.id}</p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[agent.status]}`}
                  >
                    {formatStatus(agent.status)}
                  </span>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <p className="line-clamp-3 min-h-[60px] text-sm leading-5 text-slate-600">
                    {agent.shortDescription || "No description provided."}
                  </p>

                  <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                        <UserRound aria-hidden="true" className="h-3.5 w-3.5" />
                        Architect
                      </dt>
                      <dd className="mt-1 truncate font-semibold text-slate-700" title={architectName}>
                        {architectName}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                        <CircleDollarSign aria-hidden="true" className="h-3.5 w-3.5" />
                        Price
                      </dt>
                      <dd className="mt-1 font-semibold text-slate-700">${(agent.priceCents / 100).toFixed(2)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                        <Workflow aria-hidden="true" className="h-3.5 w-3.5" />
                        Workflow
                      </dt>
                      <dd className="mt-1 truncate font-semibold text-slate-700" title={agent.workflowName ?? undefined}>
                        {agent.workflowName ?? "Not linked"}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                        <Download aria-hidden="true" className="h-3.5 w-3.5" />
                        Installs
                      </dt>
                      <dd className="mt-1 font-semibold text-slate-700">{agent.installedAgentsCount}</dd>
                    </div>
                  </dl>

                  <div className="mt-5 flex min-h-7 flex-wrap gap-1.5">
                    {agent.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {tag}
                      </span>
                    ))}
                    {agent.tags.length > 3 ? (
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                        +{agent.tags.length - 3}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-auto flex items-center gap-1.5 pt-5 text-xs text-slate-400">
                    <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
                    Created {new Date(agent.createdAt).toLocaleDateString()}
                  </div>
                </div>

                <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                  <label htmlFor={`agent-status-${agent.id}`} className="mb-1.5 block text-xs font-semibold text-slate-500">
                    Moderation status
                  </label>
                  <select
                    id={`agent-status-${agent.id}`}
                    data-testid={`admin-agent-status-${agent.id}`}
                    value={STATUSES.includes(agent.status as ListingStatus) ? agent.status : ""}
                    disabled={isUpdating}
                    onChange={(event) => void changeStatus(agent.id, event.target.value as ListingStatus)}
                    className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    <option value="" disabled>Select status</option>
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>{formatStatus(status)}</option>
                    ))}
                  </select>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
