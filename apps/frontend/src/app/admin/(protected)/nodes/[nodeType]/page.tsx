"use client";

/**
 * ONE NODE'S WORLD.
 *
 * Everything that configures a node lives here — its two switches, and whatever
 * settings that particular node has. The sidebar keeps a single entry, Nodes,
 * and stops growing: it used to gain an item every time any node gained a
 * setting, which within a year leaves an admin guessing which of twenty entries
 * belongs to which node.
 *
 * Same rule as docs/NODE-SOP.md question 5, applied to the admin side: one
 * node, one home for its settings.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";
import {
  getAdminNodes,
  setAdminNodeExecution,
  setAdminNodeVisibility,
  type AdminNodeControl
} from "@/components/admin/features/api";
import { nodeSettingsPage } from "@/components/admin/features/node-settings-pages";
import { AiBrainModels } from "@/components/admin/features/node-settings/ai-brain-models";
import { MemoryLimitsPanel } from "@/components/admin/features/node-settings/memory-limits";

/** The settings panel for this node, if it has one. */
function SettingsFor({ nodeType }: { nodeType: string }) {
  if (nodeType === "ai.llm_call") return <AiBrainModels />;
  if (nodeType === "ai.memory") return <MemoryLimitsPanel />;
  return null;
}

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

export default function AdminNodePage() {
  const params = useParams<{ nodeType: string }>();
  const router = useRouter();
  const nodeType = decodeURIComponent(String(params?.nodeType ?? ""));

  const [node, setNode] = useState<AdminNodeControl | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await getAdminNodes();
    if (response.success && response.data) {
      setNode(response.data.nodes.find((item) => item.type === nodeType) ?? null);
    }
    setLoading(false);
  }, [nodeType]);

  useEffect(() => {
    void load();
  }, [load]);

  const settings = nodeSettingsPage(nodeType);

  const toggleVisible = async () => {
    if (!node) return;
    setBusy(true);
    await setAdminNodeVisibility(node.type, !node.visible);
    setBusy(false);
    void load();
  };

  const resume = async () => {
    if (!node) return;
    setBusy(true);
    await setAdminNodeExecution(node.type, true);
    setBusy(false);
    void load();
  };

  const pause = async () => {
    if (!node || reason.trim().length < 4) return;
    setBusy(true);
    await setAdminNodeExecution(node.type, false, reason.trim());
    setBusy(false);
    setPausing(false);
    setReason("");
    void load();
  };

  if (loading) {
    return <p className="mx-auto max-w-5xl px-6 py-8 text-sm text-slate-500">Loading…</p>;
  }

  if (!node) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <p className="text-sm text-slate-600" data-testid="admin-node-not-found">
          There is no node called <span className="font-mono">{nodeType}</span>.
        </p>
        <button
          type="button"
          onClick={() => router.push("/admin/nodes" as Route)}
          className="mt-4 text-sm font-semibold text-amber-600 hover:underline"
        >
          Back to all nodes
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8" data-testid={`admin-node-page-${node.type}`}>
      <button
        type="button"
        onClick={() => router.push("/admin/nodes" as Route)}
        data-testid="admin-node-back"
        className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 transition hover:text-slate-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All nodes
      </button>

      <h1 className="mt-4 text-2xl font-black tracking-tight text-slate-900" data-testid="admin-node-page-title">
        {node.label}
      </h1>
      <p className="mt-1 text-sm text-slate-500">{node.description || node.type}</p>
      <p className="mt-1 font-mono text-[11px] text-slate-400">{node.type}</p>

      {/* ------------------------------------------------------- the switches */}
      <section className="mt-6 rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-bold text-slate-900">Switches</h2>
        <p className="mt-1 text-sm text-slate-500">
          {node.liveAgents === 0
            ? "Not used by any live agent."
            : `In ${node.liveAgents} live agent${node.liveAgents === 1 ? "" : "s"} across ${node.businesses} business${node.businesses === 1 ? "" : "es"}.`}
        </p>

        <div className="mt-4 space-y-3">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Available</p>
              <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
                Whether architects can put this into something new. Agents already running are untouched.
              </p>
            </div>
            <Toggle
              on={node.visible}
              busy={busy}
              tone="amber"
              onClick={() => void toggleVisible()}
              testId={`admin-node-visible-${node.type}`}
              label={`Available in new agents: ${node.label}`}
            />
          </div>

          <div
            className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 ${
              node.executionEnabled ? "border-gray-200" : "border-red-200 bg-red-50"
            }`}
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">Running</p>
              <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
                Whether it works at all — including inside agents businesses have already bought.
              </p>
              {!node.executionEnabled && node.pausedReason ? (
                <p className="mt-1.5 text-[12px] font-medium text-red-700">
                  Businesses are being told: {node.pausedReason}
                </p>
              ) : null}
            </div>
            <Toggle
              on={node.executionEnabled}
              busy={busy}
              tone="red"
              onClick={() => (node.executionEnabled ? setPausing(true) : void resume())}
              testId={`admin-node-execution-${node.type}`}
              label={`Running everywhere: ${node.label}`}
            />
          </div>
        </div>

        {pausing ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4" data-testid="admin-node-pause-dialog">
            <p className="text-sm font-semibold text-red-800">
              Stopping this everywhere{node.liveAgents > 0 ? `, including ${node.liveAgents} live agent${node.liveAgents === 1 ? "" : "s"}` : ""}.
            </p>
            <p className="mt-1 text-[12px] leading-5 text-red-700">
              Say why. Businesses read this on their agent, so write it for them.
            </p>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="we found a problem with texts and are fixing it today"
              data-testid="admin-node-pause-reason"
              className="mt-3 h-11 w-full rounded-xl border border-red-200 bg-white px-3 text-sm outline-none focus:border-red-300 focus:ring-4 focus:ring-red-100"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void pause()}
                disabled={reason.trim().length < 4 || busy}
                data-testid="admin-node-pause-confirm"
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
              >
                Pause everywhere
              </button>
              <button
                type="button"
                onClick={() => {
                  setPausing(false);
                  setReason("");
                }}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* -------------------------------------------- this node's own settings */}
      {settings ? (
        <section className="mt-6 rounded-2xl border border-gray-200 p-5" data-testid="admin-node-settings">
          <SettingsFor nodeType={node.type} />
        </section>
      ) : null}
    </div>
  );
}
