"use client";

/**
 * NODES — the two switches.
 *
 * They look similar and they are not, so the screen never lets them look
 * interchangeable.
 *
 *   AVAILABLE — may somebody build something NEW with this? Off takes it out of
 *   the palette and out of the AI composer. Everything already running carries
 *   on. This is the ordinary case, and it is quiet.
 *
 *   RUNNING — may this run AT ALL? Off stops it inside agents businesses have
 *   already bought and are depending on this minute. This is the emergency, and
 *   the screen treats it as one: it shows how many live agents and how many
 *   businesses are about to be affected, and it will not proceed without a
 *   written reason, because that reason is what those businesses read.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  getAdminNodes,
  setAdminNodeExecution,
  setAdminNodeVisibility,
  type AdminNodeControl
} from "@/components/admin/features/api";

function Toggle({
  on,
  onClick,
  busy,
  tone,
  testId,
  label
}: {
  on: boolean;
  onClick: () => void;
  busy: boolean;
  tone: "amber" | "red";
  testId: string;
  label: string;
}) {
  const activeBg = tone === "red" ? "bg-emerald-500" : "bg-amber-500";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={busy}
      data-testid={testId}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
        on ? activeBg : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          on ? "left-[1.375rem]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export default function AdminNodesPage() {
  const [nodes, setNodes] = useState<AdminNodeControl[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  /** The node whose pause is being confirmed, if any. */
  const [pausing, setPausing] = useState<AdminNodeControl | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getAdminNodes();
    setLoading(false);
    if (result.success && result.data) setNodes(result.data.nodes);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? nodes.filter(
          (node) =>
            node.label.toLowerCase().includes(q) ||
            node.type.toLowerCase().includes(q) ||
            node.group.toLowerCase().includes(q)
        )
      : nodes;
    // Paused first — if something is switched off platform-wide, that is the
    // thing somebody opening this page needs to see.
    return [...matched].sort((a, b) => Number(a.executionEnabled) - Number(b.executionEnabled));
  }, [nodes, query]);

  const toggleVisible = useCallback(
    async (node: AdminNodeControl) => {
      setBusy(node.type);
      const result = await setAdminNodeVisibility(node.type, !node.visible);
      setBusy(null);
      if (result.success) {
        setNotice(result.message ?? null);
        setNodes((current) =>
          current.map((entry) => (entry.type === node.type ? { ...entry, visible: !node.visible } : entry))
        );
      }
    },
    []
  );

  const resume = useCallback(async (node: AdminNodeControl) => {
    setBusy(node.type);
    const result = await setAdminNodeExecution(node.type, true);
    setBusy(null);
    if (result.success) {
      setNotice(result.message ?? null);
      void load();
    }
  }, [load]);

  const confirmPause = useCallback(async () => {
    if (!pausing || reason.trim().length < 4) return;
    setBusy(pausing.type);
    const result = await setAdminNodeExecution(pausing.type, false, reason.trim());
    setBusy(null);
    setPausing(null);
    setReason("");
    if (result.success) {
      setNotice(result.message ?? null);
      void load();
    }
  }, [pausing, reason, load]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8" data-testid="admin-nodes-page">
      <h1 className="text-2xl font-black tracking-tight text-slate-900">Nodes</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
        <strong className="font-semibold text-slate-800">Available</strong> decides whether architects can put
        a step into something new. <strong className="font-semibold text-slate-800">Running</strong> decides
        whether it works at all — including inside agents businesses have already bought.
      </p>

      <div className="relative mt-6">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search nodes…"
          data-testid="admin-nodes-search"
          className="h-11 w-full rounded-xl border border-gray-200 pl-9 pr-3 text-sm outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
        />
      </div>

      {notice ? (
        <p
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800"
          data-testid="admin-nodes-notice"
        >
          {notice}
        </p>
      ) : null}

      <div className="mt-6 hidden grid-cols-[minmax(0,1fr)_6rem_6rem] gap-3 px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:grid">
        <span>Node</span>
        <span className="text-center">Available</span>
        <span className="text-center">Running</span>
      </div>

      <div className="mt-2 space-y-2">
        {loading ? <p className="px-4 py-6 text-sm text-slate-500">Loading…</p> : null}

        {shown.map((node) => (
          <div
            key={node.type}
            data-testid={`admin-node-${node.type}`}
            className={`grid gap-3 rounded-xl border p-4 sm:grid-cols-[minmax(0,1fr)_6rem_6rem] sm:items-center ${
              node.executionEnabled ? "border-gray-200 bg-white" : "border-red-200 bg-red-50"
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-slate-900">{node.label}</span>
                {!node.executionEnabled ? (
                  <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    Paused
                  </span>
                ) : null}
                {!node.visible ? (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                    Hidden
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-500">{node.description || node.type}</p>

              <p className="mt-1 text-[11px] text-slate-400">
                {node.liveAgents === 0
                  ? "Not used by any live agent"
                  : `In ${node.liveAgents} live agent${node.liveAgents === 1 ? "" : "s"} across ${node.businesses} business${node.businesses === 1 ? "" : "es"}`}
              </p>

              {!node.executionEnabled && node.pausedReason ? (
                <p className="mt-1.5 text-[12px] font-medium text-red-700">
                  Businesses are being told: {node.pausedReason}
                </p>
              ) : null}
            </div>

            <div className="flex justify-start sm:justify-center">
              <Toggle
                on={node.visible}
                busy={busy === node.type}
                tone="amber"
                onClick={() => void toggleVisible(node)}
                testId={`admin-node-visible-${node.type}`}
                label={`Available in new agents: ${node.label}`}
              />
            </div>

            <div className="flex justify-start sm:justify-center">
              <Toggle
                on={node.executionEnabled}
                busy={busy === node.type}
                tone="red"
                onClick={() => (node.executionEnabled ? setPausing(node) : void resume(node))}
                testId={`admin-node-execution-${node.type}`}
                label={`Running everywhere: ${node.label}`}
              />
            </div>
          </div>
        ))}
      </div>

      {pausing ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            data-testid="admin-node-pause-dialog"
          >
            <h2 className="text-lg font-bold text-slate-900">Stop “{pausing.label}” everywhere?</h2>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              {pausing.liveAgents === 0 ? (
                <>No live agent uses this today, so nobody will notice.</>
              ) : (
                <>
                  This step will stop working inside{" "}
                  <strong className="font-semibold text-slate-900">
                    {pausing.liveAgents} live agent{pausing.liveAgents === 1 ? "" : "s"}
                  </strong>{" "}
                  belonging to {pausing.businesses} business{pausing.businesses === 1 ? "" : "es"}, right now.
                  The rest of each agent keeps running.
                </>
              )}
            </p>

            {pausing.agentNames.length > 0 ? (
              <p className="mt-2 text-[12px] text-slate-500">{pausing.agentNames.join(", ")}</p>
            ) : null}

            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Why? Every affected business reads this
            </label>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="We found a problem with appointment booking and are fixing it today."
              data-testid="admin-node-pause-reason"
              className="mt-1 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
            />

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void confirmPause()}
                disabled={reason.trim().length < 4 || busy !== null}
                data-testid="admin-node-pause-confirm"
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                Stop it everywhere
              </button>
              <button
                type="button"
                onClick={() => {
                  setPausing(null);
                  setReason("");
                }}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
