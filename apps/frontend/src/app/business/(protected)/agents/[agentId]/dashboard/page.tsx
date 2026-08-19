"use client";

/**
 * THE BUSINESS'S OWN SCREENS.
 *
 * Two surfaces, both designed by Smart Designer from the architect's nodes:
 * the setup form that asks for what the agent needs, and the daily screen that
 * shows what it did. Nothing about their content is decided here.
 *
 * The architect's preview renders the same component with the same payload, so
 * what they sign off is literally what this business gets.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { BuyerSurface, type BuyerContractLite, type SurfaceSpec } from "@/components/buyer-surface/buyer-surface";

type SurfacesResponse = {
  agentName: string;
  window: string;
  contract: BuyerContractLite;
  setup: SurfaceSpec;
  dashboard: SurfaceSpec;
  answers: Record<string, unknown>;
  values: Record<string, string>;
  tables: Record<string, Array<Record<string, string>>>;
  lists: Array<{ id: string; name: string; status: string; waiting: number; called: number; booked: number }>;
};

const WINDOWS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" }
];

export default function BusinessAgentSurfacesPage() {
  const params = useParams<{ agentId: string }>();
  const agentId = params?.agentId ?? "";

  const [data, setData] = useState<SurfacesResponse | null>(null);
  const [tab, setTab] = useState<"results" | "setup">("results");
  const [window, setWindow] = useState("month");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    const response = await apiGet<SurfacesResponse>(`/business/agents/${agentId}/surfaces?window=${window}`);
    if (response.success && response.data) setData(response.data);
    setLoading(false);
  }, [agentId, window]);

  useEffect(() => {
    void load();
  }, [load]);

  // A running list changes while they watch it.
  useEffect(() => {
    if (!data?.lists.some((list) => list.status === "RUNNING")) return;
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [data?.lists, load]);

  const list = data?.lists[0] ?? null;

  const saveAnswers = async () => {
    if (Object.keys(pending).length === 0) return;
    setBusy(true);
    const response = await apiPost<{ saved: number; missing: string[] }>(
      `/business/agents/${agentId}/setup-answers`,
      pending
    );
    setNotice(response.success ? response.message ?? "Saved." : response.error ?? "Could not save.");
    if (response.success) setPending({});
    setBusy(false);
    void load();
  };

  const runAction = async (key: string) => {
    if (!list) return;
    setBusy(true);
    if (key === "uploadPeople") {
      const text = pending[key] ?? "";
      const response = await apiPost<{ added: number }>(`/business/call-lists/${list.id}/people`, { text });
      setNotice(response.success ? response.message ?? "Added." : response.error ?? "Could not add those.");
      if (response.success) setPending((current) => ({ ...current, [key]: "" }));
    } else if (key === "startStop") {
      const next = list.status === "RUNNING" ? "PAUSED" : "RUNNING";
      const response = await apiPost<{ status: string }>(`/business/call-lists/${list.id}/status`, { status: next });
      setNotice(response.success ? response.message ?? "Done." : response.error ?? "Could not change that.");
    }
    setBusy(false);
    void load();
  };

  if (loading) {
    return (
      <div className="p-8 text-sm text-slate-500" data-testid="business-surfaces-loading">
        Loading…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-sm text-slate-500" data-testid="business-surfaces-empty">
        We couldn&apos;t load this agent.
      </div>
    );
  }

  const running = list?.status === "RUNNING";

  return (
    <div className="mx-auto max-w-5xl px-6 py-8" data-testid="business-agent-surfaces">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">{data.agentName}</h1>
        <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
          {(["results", "setup"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTab(option)}
              data-testid={`surfaces-tab-${option}`}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                tab === option ? "bg-amber-500 text-white shadow-sm shadow-amber-500/30" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {option === "results" ? "What it did" : "Settings"}
            </button>
          ))}
        </div>
      </div>

      {tab === "results" ? (
        <div className="mt-4 flex gap-1 rounded-lg border border-gray-200 bg-white p-1 w-fit">
          {WINDOWS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setWindow(option.key)}
              data-testid={`surfaces-window-${option.key}`}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                window === option.key ? "bg-amber-50 text-amber-700" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {notice ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800" data-testid="surfaces-notice">
          {notice}
        </p>
      ) : null}

      {running && tab === "results" ? (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800" data-testid="surfaces-running">
          Your agent is calling people right now.
        </p>
      ) : null}

      <BuyerSurface
        spec={tab === "results" ? data.dashboard : data.setup}
        contract={data.contract}
        answers={data.answers}
        tables={data.tables}
        mode="live"
        onAnswer={(key, value) => setPending((current) => ({ ...current, [key]: value }))}
        onAction={runAction}
        actionState={{
          startStop: running
            ? { label: "Stop calling", danger: true }
            : { label: "Start calling" }
        }}
        emptyMessage={
          tab === "results"
            ? "Your results screen hasn't been designed yet."
            : "This agent doesn't need any settings from you."
        }
      />

      {tab === "setup" && Object.keys(pending).length > 0 ? (
        <button
          type="button"
          onClick={saveAnswers}
          disabled={busy}
          data-testid="surfaces-save"
          className="mt-6 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40"
        >
          Save
        </button>
      ) : null}
    </div>
  );
}
