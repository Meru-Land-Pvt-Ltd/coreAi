"use client";

import { useEffect, useState } from "react";
import {
  getAdminAgents,
  updateAdminAgentStatus,
  type AdminAgent,
  type ListingStatus
} from "@/components/admin/features/api";

const STATUSES: ListingStatus[] = ["PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"];

export default function AdminAgentsPage() {
  const [rows, setRows] = useState<AdminAgent[]>([]);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

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
    const result = await updateAdminAgentStatus(listingId, status);
    if (!result.success) {
      setMessage(result.error ?? "Could not update listing status.");
      return;
    }
    setMessage("Listing status updated.");
    setRows((current) => current.map((row) => (row.id === listingId ? { ...row, status } : row)));
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Agent listings</h1>
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
          className="w-full max-w-md rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm outline-none focus:border-orange-400"
        />
        <button type="submit" className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">Search</button>
      </form>

      {message ? <p data-testid="admin-agents-message" className="mb-3 text-sm font-semibold text-orange-700">{message}</p> : null}

      {state === "loading" ? (
        <p data-testid="admin-agents-loading" className="text-sm font-semibold text-orange-700">Loading…</p>
      ) : state === "error" ? (
        <p data-testid="admin-agents-error" className="text-sm font-semibold text-red-600">Could not load agents.</p>
      ) : rows.length === 0 ? (
        <p data-testid="admin-agents-empty" className="text-sm font-semibold text-slate-500">No agent listings found.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-orange-100 bg-white">
          <table data-testid="admin-agents-table" className="w-full text-left text-sm">
            <thead className="border-b border-orange-100 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Architect</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Workflow</th>
                <th className="px-4 py-3">Installs</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Set status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-orange-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{a.name}</td>
                  <td className="px-4 py-3 text-slate-600">{a.architect?.email ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{a.status}</td>
                  <td className="px-4 py-3 text-slate-600">${(a.priceCents / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-slate-600">{a.workflowName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{a.installedAgentsCount}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(a.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <select
                      data-testid={`admin-agent-status-${a.id}`}
                      value={STATUSES.includes(a.status as ListingStatus) ? a.status : "PENDING_REVIEW"}
                      onChange={(event) => void changeStatus(a.id, event.target.value as ListingStatus)}
                      className="rounded-lg border border-orange-200 bg-white px-2 py-1 text-sm outline-none focus:border-orange-400"
                    >
                      {STATUSES.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
