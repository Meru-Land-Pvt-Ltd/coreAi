"use client";

import { useEffect, useState } from "react";
import {
  getAdminArchitects,
  updateAdminArchitectStatus,
  type AdminArchitect,
  type ArchitectApprovalStatus
} from "@/components/admin/features/api";

const STATUSES: ArchitectApprovalStatus[] = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];

export default function AdminArchitectsPage() {
  const [rows, setRows] = useState<AdminArchitect[]>([]);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  async function load(searchValue: string) {
    setState("loading");
    const result = await getAdminArchitects({ search: searchValue, limit: 50 });
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

  async function changeStatus(userId: string, approvalStatus: ArchitectApprovalStatus) {
    setMessage("");
    const result = await updateAdminArchitectStatus(userId, approvalStatus);
    if (!result.success) {
      setMessage(result.error ?? "Could not update architect status.");
      return;
    }
    setMessage("Architect status updated.");
    setRows((current) =>
      current.map((row) =>
        row.id === userId && row.architectProfile
          ? { ...row, architectProfile: { ...row.architectProfile, approvalStatus } }
          : row
      )
    );
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Architects</h1>
        <p className="mt-1 text-sm text-slate-500">Approve and manage AI Architect accounts.</p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(search.trim());
        }}
        className="mb-4 flex gap-2"
      >
        <input
          data-testid="admin-architects-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by email or name"
          className="w-full max-w-md rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm outline-none focus:border-orange-400"
        />
        <button type="submit" className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">Search</button>
      </form>

      {message ? <p data-testid="admin-architects-message" className="mb-3 text-sm font-semibold text-orange-700">{message}</p> : null}

      {state === "loading" ? (
        <p data-testid="admin-architects-loading" className="text-sm font-semibold text-orange-700">Loading…</p>
      ) : state === "error" ? (
        <p data-testid="admin-architects-error" className="text-sm font-semibold text-red-600">Could not load architects.</p>
      ) : rows.length === 0 ? (
        <p data-testid="admin-architects-empty" className="text-sm font-semibold text-slate-500">No architects found.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-orange-100 bg-white">
          <table data-testid="admin-architects-table" className="w-full text-left text-sm">
            <thead className="border-b border-orange-100 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Approval</th>
                <th className="px-4 py-3">Listings</th>
                <th className="px-4 py-3">Workflows</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Set status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-orange-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{a.fullName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{a.email}</td>
                  <td className="px-4 py-3 text-slate-600">{a.architectProfile?.approvalStatus ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{a.listingCount}</td>
                  <td className="px-4 py-3 text-slate-600">{a.workflowCount}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(a.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <select
                      data-testid={`admin-architect-status-${a.id}`}
                      value={a.architectProfile?.approvalStatus ?? "PENDING"}
                      disabled={!a.architectProfile}
                      onChange={(event) => void changeStatus(a.id, event.target.value as ArchitectApprovalStatus)}
                      className="rounded-lg border border-orange-200 bg-white px-2 py-1 text-sm outline-none focus:border-orange-400 disabled:opacity-50"
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
