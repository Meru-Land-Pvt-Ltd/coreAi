"use client";

import { useEffect, useState } from "react";
import { getAdminBusinesses, type AdminBusiness } from "@/components/admin/features/api";

export default function AdminBusinessesPage() {
  const [rows, setRows] = useState<AdminBusiness[]>([]);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  async function load(searchValue: string) {
    setState("loading");
    const result = await getAdminBusinesses({ search: searchValue, limit: 50 });
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
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Businesses</h1>
        <p className="mt-1 text-sm text-slate-500">All signed-up businesses and their installs.</p>
      </header>

      <form
        data-testid="admin-businesses-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void load(search.trim());
        }}
        className="mb-4 flex gap-2"
      >
        <input
          data-testid="admin-businesses-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, type, or owner email"
          className="w-full max-w-md rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm outline-none focus:border-orange-400"
        />
        <button type="submit" className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">Search</button>
      </form>

      {state === "loading" ? (
        <p data-testid="admin-businesses-loading" className="text-sm font-semibold text-orange-700">Loading…</p>
      ) : state === "error" ? (
        <p data-testid="admin-businesses-error" className="text-sm font-semibold text-red-600">Could not load businesses.</p>
      ) : rows.length === 0 ? (
        <p data-testid="admin-businesses-empty" className="text-sm font-semibold text-slate-500">No businesses found.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-orange-100 bg-white">
          <table data-testid="admin-businesses-table" className="w-full text-left text-sm">
            <thead className="border-b border-orange-100 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Subscription</th>
                <th className="px-4 py-3">Agents</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-orange-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{b.name}</td>
                  <td className="px-4 py-3 text-slate-600">{b.type}</td>
                  <td className="px-4 py-3 text-slate-600">{b.owner?.email ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{b.subscriptionStatus}</td>
                  <td className="px-4 py-3 text-slate-600">{b.installedAgentsCount}</td>
                  <td className="px-4 py-3 text-slate-600">{b.activePhoneNumber ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(b.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
