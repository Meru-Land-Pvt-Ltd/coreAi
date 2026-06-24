"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState } from "react";
import { cn, formatDate } from "@/components/architect/ui/architect-ui";
import { ArchitectWorkflowCreateView } from "@/components/architect/ui/workflow-create-view";
import { deleteArchitectWorkflow, getArchitectWorkflows } from "@/components/architect/features/api";
import type { ArchitectWorkflow } from "@/components/architect/features/types";

function getWorkflowStats(workflow: ArchitectWorkflow) {
  const workflowJson = workflow.workflowJson as { nodes?: unknown[]; edges?: unknown[] };
  return {
    nodes: Array.isArray(workflowJson?.nodes) ? workflowJson.nodes.length : 0,
    edges: Array.isArray(workflowJson?.edges) ? workflowJson.edges.length : 0
  };
}

function AgentGlyph({ className = "" }: { className?: string }) {
  return (
    <svg className={cn("h-5 w-5", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="2.5" />
      <path d="M12 8V4.5" />
      <circle cx="9" cy="14" r="1.1" />
      <circle cx="15" cy="14" r="1.1" />
      <path d="M4 13.5H2.5M21.5 13.5H20" />
    </svg>
  );
}

function CreateAgentCard({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full flex-col items-start justify-between rounded-[1.75rem] border border-dashed border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 text-left transition hover:-translate-y-1 hover:border-amber-300 hover:shadow-lg hover:shadow-amber-500/10",
        compact ? "min-h-72 p-6" : "min-h-[24rem] p-7 sm:p-8"
      )}
    >
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-500/25 transition group-hover:scale-105">
        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <div>
        <h2 className="text-2xl font-black text-slate-950">Create New Agent</h2>
        <p className="mt-2 max-w-sm text-sm font-semibold leading-6 text-slate-500">
          Start with an empty canvas. Then load Missed Call Text-Back or build your own flow.
        </p>
      </div>
    </button>
  );
}

export function ArchitectWorkflowsView() {
  const [workflows, setWorkflows] = useState<ArchitectWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  async function loadWorkflows() {
    setLoading(true);
    const result = await getArchitectWorkflows();
    if (result.success && result.data) setWorkflows(result.data.workflows);
    setLoading(false);
  }

  useEffect(() => {
    void loadWorkflows();
  }, []);

  useEffect(() => {
    if (!isCreateOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsCreateOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isCreateOpen]);

  async function handleDelete(workflow: ArchitectWorkflow) {
    const confirmed = window.confirm(`Delete "${workflow.name}"? This will remove the agent canvas from your builder.`);
    if (!confirmed) return;

    setDeletingId(workflow.id);
    setMessage("");
    const result = await deleteArchitectWorkflow(workflow.id);

    if (!result.success) {
      setMessage(result.error ?? "Could not delete agent");
      setDeletingId(null);
      return;
    }

    setWorkflows((current) => current.filter((item) => item.id !== workflow.id));
    setMessage("Agent deleted successfully");
    setDeletingId(null);
  }

  const totals = useMemo(() => {
    return workflows.reduce(
      (acc, workflow) => {
        const stats = getWorkflowStats(workflow);
        acc.nodes += stats.nodes;
        acc.edges += stats.edges;
        return acc;
      },
      { nodes: 0, edges: 0 }
    );
  }, [workflows]);

  return (
    <div className="mx-auto w-full max-w-7xl">
      <section className="mb-6 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="relative p-5 sm:p-7 lg:p-8">
          <div className="pointer-events-none absolute right-0 top-0 h-56 w-72 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_62%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-600">Architect Studio</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Agent Builder</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 sm:text-base sm:leading-7">
                Build responsive, production-ready agents. First CORE template: Missed Call Text-Back — Customer Calls → Auto Text in 5 Seconds → Lead Captured.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center justify-center rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-white shadow-sm shadow-amber-500/25 transition hover:bg-amber-600"
            >
              New Agent
            </button>
          </div>
        </div>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Agents</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{workflows.length}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Nodes</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{totals.nodes}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Connections</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{totals.edges}</p>
        </div>
      </div>

      {message ? (
        <div className="mb-5 rounded-2xl border border-amber-100 bg-white px-5 py-4 text-sm font-black text-amber-700 shadow-sm">
          {message}
        </div>
      ) : null}

      {loading ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-amber-700">Loading agents...</p>
        </section>
      ) : workflows.length ? (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          <CreateAgentCard onClick={() => setIsCreateOpen(true)} compact />
          {workflows.map((workflow) => {
            const stats = getWorkflowStats(workflow);
            const isEmpty = stats.nodes === 0;

            return (
              <article key={workflow.id} className="group rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-amber-200 hover:shadow-lg hover:shadow-slate-900/5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
                      <AgentGlyph />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-black text-slate-950">{workflow.name}</h2>
                      <p className="mt-0.5 text-xs font-semibold text-slate-500">Created {formatDate(workflow.createdAt)}</p>
                    </div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide", isEmpty ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700")}>
                    {isEmpty ? "Empty" : "Draft"}
                  </span>
                </div>

                <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-500">
                  {workflow.description || "No description added yet."}
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Nodes</p>
                    <p className="mt-1 text-lg font-black text-slate-950">{stats.nodes}</p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-amber-600">Connections</p>
                    <p className="mt-1 text-lg font-black text-slate-950">{stats.edges}</p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <Link href={`/architect/workflows/${workflow.id}/builder` as Route} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-white transition hover:bg-amber-600">
                    Open Builder
                  </Link>
                  <Link href={`/architect/agents/publish?workflowId=${workflow.id}` as Route} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700">
                    Publish
                  </Link>
                  <button type="button" onClick={() => handleDelete(workflow)} disabled={deletingId === workflow.id} className="rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm font-black text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60">
                    {deletingId === workflow.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="grid min-h-[58vh] place-items-center">
          <div className="w-full max-w-md">
            <CreateAgentCard onClick={() => setIsCreateOpen(true)} />
          </div>
        </div>
      )}

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true" onClick={() => setIsCreateOpen(false)}>
          <div className="relative my-auto max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-950/20 sm:p-6" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setIsCreateOpen(false)} aria-label="Close" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-lg font-black text-slate-700 transition hover:bg-slate-50">
              ×
            </button>
            <ArchitectWorkflowCreateView />
          </div>
        </div>
      ) : null}
    </div>
  );
}
