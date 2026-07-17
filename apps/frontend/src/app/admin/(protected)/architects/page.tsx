"use client";

import { useEffect, useState } from "react";
import {
  getAdminArchitects,
  type AdminArchitect
} from "@/components/admin/features/api";

export default function AdminArchitectsPage() {
  const [rows, setRows] = useState<AdminArchitect[]>([]);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

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

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-normal text-slate-900">Architects</h1>
        <p className="mt-1 text-sm text-slate-500">Architect accounts and marketplace activity.</p>
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
          className="w-full max-w-md rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:border-amber-400"
        />
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white">Search</button>
      </form>

      {state === "loading" ? (
        <p data-testid="admin-architects-loading" className="text-sm font-semibold text-amber-700">Loading…</p>
      ) : state === "error" ? (
        <p data-testid="admin-architects-error" className="text-sm font-semibold text-red-600">Could not load architects.</p>
      ) : rows.length === 0 ? (
        <p data-testid="admin-architects-empty" className="text-sm font-semibold text-slate-500">No architects found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table data-testid="admin-architects-table" className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase tracking-normal text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Listings</th>
                <th className="px-4 py-3">Workflows</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-semibold text-slate-900">{a.fullName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{a.email}</td>
                  <td className="px-4 py-3 text-slate-600">{a.listingCount}</td>
                  <td className="px-4 py-3 text-slate-600">{a.workflowCount}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(a.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
