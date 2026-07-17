"use client";

import { Fragment, useEffect, useState } from "react";
import { Bot, ChevronDown, LoaderCircle } from "lucide-react";
import {
  getAdminBusinesses,
  getPhoneAssignOptions,
  type AdminBusiness
} from "@/components/admin/features/api";

type InstalledAgent = {
  id: string;
  name: string;
  status: string;
};

export default function AdminBusinessesPage() {
  const [rows, setRows] = useState<AdminBusiness[]>([]);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [openBusinessId, setOpenBusinessId] = useState<string | null>(null);
  const [loadingBusinessId, setLoadingBusinessId] = useState<string | null>(null);
  const [agentsByBusiness, setAgentsByBusiness] = useState<Record<string, InstalledAgent[]>>({});
  const [agentErrors, setAgentErrors] = useState<Record<string, string>>({});

  async function load(searchValue: string) {
    setState("loading");
    const result = await getAdminBusinesses({ search: searchValue, limit: 50 });
    if (result.success && result.data) {
      setRows(result.data.items.filter((business) => business.owner !== null));
      setOpenBusinessId(null);
      setState("ready");
    } else {
      setState("error");
    }
  }

  async function toggleInstalledAgents(businessId: string) {
    if (openBusinessId === businessId) {
      setOpenBusinessId(null);
      return;
    }

    setOpenBusinessId(businessId);
    if (Object.prototype.hasOwnProperty.call(agentsByBusiness, businessId)) return;

    setLoadingBusinessId(businessId);
    setAgentErrors((current) => ({ ...current, [businessId]: "" }));
    const result = await getPhoneAssignOptions(businessId);

    if (result.success && result.data) {
      const installedAgents = result.data.agents;
      setAgentsByBusiness((current) => ({ ...current, [businessId]: installedAgents }));
    } else {
      setAgentErrors((current) => ({
        ...current,
        [businessId]: result.error ?? "Could not load installed agents."
      }));
    }

    setLoadingBusinessId((current) => (current === businessId ? null : current));
  }

  useEffect(() => {
    void load("");
  }, []);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-normal text-slate-900">Businesses</h1>
        <p className="mt-1 text-sm text-slate-500">Registered business accounts and their installed agents.</p>
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
          className="w-full max-w-md rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:border-amber-400"
        />
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white">Search</button>
      </form>

      {state === "loading" ? (
        <p data-testid="admin-businesses-loading" className="text-sm font-semibold text-amber-700">Loading…</p>
      ) : state === "error" ? (
        <p data-testid="admin-businesses-error" className="text-sm font-semibold text-red-600">Could not load businesses.</p>
      ) : rows.length === 0 ? (
        <p data-testid="admin-businesses-empty" className="text-sm font-semibold text-slate-500">No businesses found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table data-testid="admin-businesses-table" className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase tracking-normal text-slate-400">
              <tr>
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Subscription</th>
                <th className="px-4 py-3">Agents</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const isOpen = openBusinessId === b.id;
                const installedAgents = agentsByBusiness[b.id] ?? [];
                const isLoadingAgents = loadingBusinessId === b.id;
                const agentError = agentErrors[b.id];

                return (
                  <Fragment key={b.id}>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-3 font-semibold text-slate-900">{b.name}</td>
                      <td className="px-4 py-3 text-slate-600">{b.type}</td>
                      <td className="px-4 py-3 text-slate-600">{b.owner?.email ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{b.subscriptionStatus}</td>
                      <td className="px-4 py-3 text-slate-600">{b.installedAgentsCount}</td>
                      <td className="px-4 py-3 text-slate-600">{b.activePhoneNumber ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          data-testid={`admin-business-agents-${b.id}`}
                          aria-expanded={isOpen}
                          aria-controls={`business-agents-${b.id}`}
                          onClick={() => void toggleInstalledAgents(b.id)}
                          className="inline-flex min-w-32 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-300"
                        >
                          <Bot aria-hidden="true" className="h-4 w-4" />
                          View agents
                          <ChevronDown
                            aria-hidden="true"
                            className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                      </td>
                    </tr>

                    {isOpen ? (
                      <tr id={`business-agents-${b.id}`} className="border-b border-gray-200 bg-slate-50">
                        <td colSpan={7} className="px-4 py-4">
                          <div className="ml-auto w-full max-w-xl rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm">
                            <div className="flex items-center justify-between gap-4 border-b border-gray-100 pb-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">Installed agents</p>
                                <p className="mt-0.5 text-xs text-slate-500">{b.name}</p>
                              </div>
                              {!isLoadingAgents && !agentError ? (
                                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                  {installedAgents.length}
                                </span>
                              ) : null}
                            </div>

                            {isLoadingAgents ? (
                              <div className="flex items-center gap-2 py-5 text-sm text-slate-500">
                                <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                                Loading installed agents...
                              </div>
                            ) : agentError ? (
                              <p className="py-5 text-sm font-medium text-red-600">{agentError}</p>
                            ) : installedAgents.length === 0 ? (
                              <p className="py-5 text-sm text-slate-500">No agents are installed for this business.</p>
                            ) : (
                              <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto">
                                {installedAgents.map((agent) => (
                                  <li key={agent.id} className="flex items-center justify-between gap-4 py-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-semibold text-slate-800">{agent.name}</p>
                                      <p className="mt-0.5 truncate text-xs text-slate-400">{agent.id}</p>
                                    </div>
                                    <span
                                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                        agent.status === "ACTIVE"
                                          ? "bg-emerald-50 text-emerald-700"
                                          : "bg-gray-100 text-slate-600"
                                      }`}
                                    >
                                      {agent.status.replaceAll("_", " ")}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
