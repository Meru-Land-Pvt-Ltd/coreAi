"use client";

/**
 * THE SCREEN A PAYING BUSINESS OPENS EVERY DAY.
 *
 * Nothing on this page is laid out here. The arrangement — which numbers lead,
 * what they are called, where the controls sit — is whatever Smart Designer
 * composed from the architect's own nodes, stored once and filled with today's
 * real figures on every open.
 *
 * This file's only job is to paint the blocks that design asks for, and to
 * attach the real working controls to the ids it used. That separation is the
 * point: a better composer improves every agent's dashboard without anyone
 * touching this file.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";

type SpecBlock = {
  id: string;
  type: string;
  text?: string;
  label?: string;
  value?: string;
  level?: number;
  variant?: string;
  items?: string[];
  blocks?: SpecBlock[];
};

type ListSummary = {
  id: string;
  name: string;
  status: string;
  waiting: number;
  called: number;
  booked: number;
};

type DashboardResponse = {
  agentName: string;
  window: string;
  dashboard: { pages: Array<{ title?: string; blocks: SpecBlock[] }> } | null;
  surface: { metrics: Array<{ key: string; label: string; help: string }> };
  values: Record<string, string>;
  tables: Record<string, Array<Record<string, string>>>;
  lists: ListSummary[];
};

const WINDOWS: Array<{ key: string; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" }
];

export default function BusinessAgentDashboardPage() {
  const params = useParams<{ agentId: string }>();
  const agentId = params?.agentId ?? "";

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [window, setWindow] = useState("month");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    const response = await apiGet<DashboardResponse>(`/business/agents/${agentId}/dashboard?window=${window}`);
    if (response.success && response.data) setData(response.data);
    setLoading(false);
  }, [agentId, window]);

  useEffect(() => {
    void load();
  }, [load]);

  // A list that is running changes while they watch it. Refreshing on a timer
  // is the difference between a dashboard and a screenshot.
  useEffect(() => {
    const running = data?.lists.some((list) => list.status === "RUNNING");
    if (!running) return;
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [data?.lists, load]);

  const list = data?.lists[0] ?? null;

  const addPeople = async () => {
    if (!list || !pasted.trim()) return;
    setBusy(true);
    const response = await apiPost<{ added: number }>(`/business/call-lists/${list.id}/people`, {
      text: pasted
    });
    setNotice(response.success ? response.message ?? "Added." : response.error ?? "Could not add those.");
    if (response.success) setPasted("");
    setBusy(false);
    void load();
  };

  const toggleCalling = async () => {
    if (!list) return;
    setBusy(true);
    const next = list.status === "RUNNING" ? "PAUSED" : "RUNNING";
    const response = await apiPost<{ status: string }>(`/business/call-lists/${list.id}/status`, {
      status: next
    });
    setNotice(response.success ? response.message ?? "Done." : response.error ?? "Could not change that.");
    setBusy(false);
    void load();
  };

  if (loading) {
    return (
      <div className="p-8 text-sm text-slate-500" data-testid="business-dashboard-loading">
        Loading your results…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-sm text-slate-500" data-testid="business-dashboard-empty">
        We couldn&apos;t load this agent.
      </div>
    );
  }

  const blocks = data.dashboard?.pages?.[0]?.blocks ?? [];

  /** Paint one block from the composed design. */
  const renderBlock = (block: SpecBlock): React.ReactNode => {
    switch (block.type) {
      case "heading":
        return (
          <h2
            key={block.id}
            data-testid={`dash-heading-${block.id}`}
            className={
              block.level === 1
                ? "mt-2 text-2xl font-bold text-slate-900"
                : "mt-8 text-sm font-bold uppercase tracking-wider text-slate-400"
            }
          >
            {block.text}
          </h2>
        );

      case "text":
        return (
          <p key={block.id} className="mt-1 text-sm text-slate-500">
            {block.text}
          </p>
        );

      case "stat":
        return (
          <div
            key={block.id}
            data-testid={`dash-stat-${block.id}`}
            className="rounded-2xl border border-gray-200 bg-white p-5"
          >
            <div className="text-3xl font-bold tabular-nums text-slate-900">{block.value}</div>
            <div className="mt-1 text-sm font-medium text-slate-600">{block.label}</div>
            <div className="mt-0.5 text-[11px] leading-4 text-slate-400">
              {data.surface.metrics.find((metric) => block.id.endsWith(metric.key))?.help ?? ""}
            </div>
          </div>
        );

      case "upload":
        return (
          <div key={block.id} data-testid="dash-upload-people" className="rounded-2xl border border-gray-200 bg-white p-5">
            <label className="text-sm font-semibold text-slate-800">{block.label}</label>
            <p className="mt-1 text-[11px] text-slate-400">
              One person per line — a name and a phone number. You can paste straight from a spreadsheet.
            </p>
            <textarea
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder={"Priya, +15551234567\nSam, +15559876543"}
              data-testid="dash-upload-textarea"
              className="mt-3 h-32 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-400/40"
            />
            <button
              type="button"
              onClick={addPeople}
              disabled={busy || !pasted.trim()}
              data-testid="dash-upload-submit"
              className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              Add them to the list
            </button>
          </div>
        );

      case "button": {
        const running = list?.status === "RUNNING";
        return (
          <div key={block.id} data-testid="dash-start-stop" className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-800">
                  {running ? "Your agent is calling people now" : block.label}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {list
                    ? `${list.waiting} still to call · ${list.called} done`
                    : "Add some people first."}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleCalling}
                disabled={busy || !list}
                data-testid="dash-start-stop-button"
                className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-40 ${
                  running ? "bg-rose-600 hover:bg-rose-500" : "bg-emerald-600 hover:bg-emerald-500"
                }`}
              >
                {running ? "Stop calling" : "Start calling"}
              </button>
            </div>
          </div>
        );
      }

      case "result": {
        const rows = data.tables[block.id] ?? [];
        const columns = rows[0] ? Object.keys(rows[0]) : [];
        return (
          <div
            key={block.id}
            data-testid={`dash-table-${block.id}`}
            className="overflow-x-auto rounded-2xl border border-gray-200 bg-white"
          >
            {rows.length === 0 ? (
              <p className="p-5 text-sm text-slate-400">Nothing here yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wider text-slate-400">
                    {columns.map((column) => (
                      <th key={column} className="px-4 py-3 font-semibold">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="border-b border-gray-50 last:border-0">
                      {columns.map((column) => (
                        <td key={column} className="px-4 py-3 text-slate-700">
                          {row[column]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  };

  // Stat blocks sit together in a grid; everything else runs full width. The
  // composer decides the ORDER, this decides only how a row of numbers packs.
  const grouped: React.ReactNode[] = [];
  let statRun: SpecBlock[] = [];
  const flushStats = () => {
    if (statRun.length === 0) return;
    grouped.push(
      <div key={`stats-${statRun[0].id}`} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {statRun.map(renderBlock)}
      </div>
    );
    statRun = [];
  };
  for (const block of blocks) {
    if (block.type === "stat") statRun.push(block);
    else {
      flushStats();
      grouped.push(<div key={block.id} className="mt-4">{renderBlock(block)}</div>);
    }
  }
  flushStats();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8" data-testid="business-agent-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">{data.agentName}</h1>
        <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
          {WINDOWS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setWindow(option.key)}
              data-testid={`dash-window-${option.key}`}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                window === option.key ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {notice ? (
        <p className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white" data-testid="dash-notice">
          {notice}
        </p>
      ) : null}

      {blocks.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500" data-testid="dash-not-designed">
          This agent&apos;s dashboard hasn&apos;t been designed yet.
        </p>
      ) : (
        grouped
      )}
    </div>
  );
}
