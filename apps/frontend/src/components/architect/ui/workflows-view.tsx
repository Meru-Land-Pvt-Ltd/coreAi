"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
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
    <svg data-testid="components-architect-ui-workflows-view-svg-1" className={cn("h-5 w-5", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect data-testid="components-architect-ui-workflows-view-rect-1" x="4" y="8" width="16" height="12" rx="2.5" />
      <path data-testid="components-architect-ui-workflows-view-path-1" d="M12 8V4.5" />
      <circle data-testid="components-architect-ui-workflows-view-circle-1" cx="9" cy="14" r="1.1" />
      <circle data-testid="components-architect-ui-workflows-view-circle-2" cx="15" cy="14" r="1.1" />
      <path data-testid="components-architect-ui-workflows-view-path-2" d="M4 13.5H2.5M21.5 13.5H20" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg data-testid="components-architect-ui-workflows-view-svg-2"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path data-testid="components-architect-ui-workflows-view-path-3" d="M3 6h18" />
      <path data-testid="components-architect-ui-workflows-view-path-4" d="M8 6V4h8v2" />
      <path data-testid="components-architect-ui-workflows-view-path-5" d="M19 6l-1 14H6L5 6" />
      <path data-testid="components-architect-ui-workflows-view-path-6" d="M10 11v5" />
      <path data-testid="components-architect-ui-workflows-view-path-7" d="M14 11v5" />
    </svg>
  );
}

function CreateAgentCard({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  return (
    <button data-testid="components-architect-ui-workflows-view-button-1"
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full flex-col items-start justify-between rounded-[1.75rem] border border-dashed border-amber-400 bg-gradient-to-br from-amber-200 via-orange-100 to-amber-50 text-left shadow-sm transition hover:-translate-y-1 hover:border-amber-500 hover:shadow-xl hover:shadow-amber-500/20",
        compact ? "min-h-[20rem] p-6" : "min-h-[24rem] p-7 sm:p-8"
      )}
    >
      <span data-testid="components-architect-ui-workflows-view-span-1" className="grid h-14 w-14 place-items-center rounded-[0.75rem] bg-amber-500 text-white shadow-lg shadow-amber-500/25 transition group-hover:scale-105">
        <svg data-testid="components-architect-ui-workflows-view-svg-3"
          className="h-7 w-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        >
          <path data-testid="components-architect-ui-workflows-view-path-8" d="M12 5v14M5 12h14" />
        </svg>
      </span>

      <div data-testid="components-architect-ui-workflows-view-div-1">
        <h2 data-testid="components-architect-ui-workflows-view-h2-1" className="text-2xl font-black text-slate-950">Create New Agent</h2>
        <p data-testid="components-architect-ui-workflows-view-p-1" className="mt-2 max-w-sm text-sm font-semibold leading-6 text-slate-600">
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

  const router = useRouter();

  function openWorkflow(workflow: ArchitectWorkflow) {
    router.push(`/architect/workflows/${workflow.id}/builder` as Route);
  }

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
    <div data-testid="components-architect-ui-workflows-view-div-2" className="-m-4 min-h-screen w-auto max-w-none bg-white p-4 sm:-m-6 sm:p-6 lg:-m-8 lg:p-8">
      <section data-testid="components-architect-ui-workflows-view-section-1" className="mb-6 w-full overflow-hidden rounded-[0.75rem]">
        <div data-testid="components-architect-ui-workflows-view-div-3" className="relative p-5 sm:p-7 lg:p-8">
          <div data-testid="components-architect-ui-workflows-view-div-4" className="pointer-events-none absolute left-1/2 top-0 h-72 w-full -translate-x-1/2 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.30),rgba(251,191,36,0.16)_36%,transparent_72%)]" />
          <div data-testid="components-architect-ui-workflows-view-div-5" className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div data-testid="components-architect-ui-workflows-view-div-6">
              <p data-testid="components-architect-ui-workflows-view-p-2" className="text-xs font-black uppercase tracking-[0.22em] text-amber-600">Architect Studio</p>
              <h1 data-testid="components-architect-ui-workflows-view-h1-1" className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Agent Builder</h1>
              <p data-testid="components-architect-ui-workflows-view-p-3" className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 sm:text-base sm:leading-7">
                Build responsive, production-ready agents. First CORE template: Missed Call Text-Back — Customer Calls → Auto Text in 5 Seconds → Lead Captured.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div data-testid="components-architect-ui-workflows-view-div-7" className="mb-8 grid gap-4 sm:grid-cols-3">
        <div data-testid="components-architect-ui-workflows-view-div-8" className="border-l-4 border-amber-500 bg-amber-50/40 px-5 py-4">
          <p data-testid="components-architect-ui-workflows-view-p-4" className="text-sm font-semibold text-slate-500">Agents</p>
          <p data-testid="components-architect-ui-workflows-view-p-5" className="mt-2 text-3xl font-black text-slate-950">{workflows.length}</p>
        </div>
      </div>

      {message ? (
        <div data-testid="components-architect-ui-workflows-view-div-9" className="mb-5 rounded-2xl border border-amber-100 bg-white px-5 py-4 text-sm font-black text-amber-700 shadow-sm">
          {message}
        </div>
      ) : null}

      {loading ? (
        <section data-testid="components-architect-ui-workflows-view-section-2" className="border-l-4 border-amber-500 bg-amber-50/40 px-5 py-4">
          <p data-testid="components-architect-ui-workflows-view-p-6" className="text-sm font-bold text-amber-700">Loading agents...</p>
        </section>
      ) : workflows.length ? (
        <div data-testid="components-architect-ui-workflows-view-div-10" className="grid w-full gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <CreateAgentCard onClick={() => setIsCreateOpen(true)} compact />

          {workflows.map((workflow) => {
            const isEmpty = getWorkflowStats(workflow).nodes === 0;

            return (
              <article data-testid="components-architect-ui-workflows-view-article-1"
                key={workflow.id}
                role="button"
                tabIndex={0}
                onClick={() => openWorkflow(workflow)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openWorkflow(workflow);
                  }
                }}
                className="group relative flex min-h-[20rem] cursor-pointer flex-col rounded-[1.75rem] border border-slate-200 bg-white p-6 text-center shadow-sm transition hover:-translate-y-1 hover:border-amber-300 hover:shadow-xl hover:shadow-slate-900/10"
              >
                <div data-testid="components-architect-ui-workflows-view-div-11" className="absolute right-5 top-5 flex items-center gap-2">
                  <span data-testid="components-architect-ui-workflows-view-span-2"
                    className={cn(
                      "rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide",
                      isEmpty
                        ? "bg-slate-100 text-slate-600"
                        : "bg-amber-50 text-amber-700"
                    )}
                  >
                    {isEmpty ? "Empty" : "Draft"}
                  </span>

                  <button data-testid="components-architect-ui-workflows-view-button-2"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDelete(workflow);
                    }}
                    disabled={deletingId === workflow.id}
                    className="grid h-8 w-8 place-items-center rounded-full bg-red-50 text-red-600 transition hover:bg-red-100 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={`Delete ${workflow.name}`}
                  >
                    <TrashIcon />
                  </button>
                </div>

                <div data-testid="components-architect-ui-workflows-view-div-12" className="mx-auto mt-8 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
                  <AgentGlyph />
                </div>

                <div data-testid="components-architect-ui-workflows-view-div-13" className="mt-8 flex flex-1 flex-col items-center justify-center">
                  <h2 data-testid="components-architect-ui-workflows-view-h2-2" className="max-w-[18rem] text-center text-xl font-black leading-tight text-slate-950">
                    {workflow.name || "Enoylity Media Creations LLC"}
                  </h2>

                  <p data-testid="components-architect-ui-workflows-view-p-7" className="mt-3 line-clamp-3 max-w-sm text-center text-sm font-semibold leading-6 text-slate-500">
                    {workflow.description || "Enoylity Media Creations LLC"}
                  </p>
                </div>

                <p data-testid="components-architect-ui-workflows-view-p-8" className="mt-6 text-xs font-semibold text-slate-400">
                  Created {formatDate(workflow.createdAt)}
                </p>
              </article>
            );
          })}
        </div>
      ) : (
        <div data-testid="components-architect-ui-workflows-view-div-14" className="grid min-h-[58vh] w-full place-items-center">
          <div data-testid="components-architect-ui-workflows-view-div-15" className="w-full max-w-[520px]">
            <CreateAgentCard onClick={() => setIsCreateOpen(true)} />
          </div>
        </div>
      )}

      {isCreateOpen ? (
        <div data-testid="components-architect-ui-workflows-view-div-16" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true" onClick={() => setIsCreateOpen(false)}>
          <div data-testid="components-architect-ui-workflows-view-div-17" className="relative my-auto max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-950/20 sm:p-6" onClick={(event) => event.stopPropagation()}>
            <button data-testid="components-architect-ui-workflows-view-button-3" type="button" onClick={() => setIsCreateOpen(false)} aria-label="Close" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-lg font-black text-slate-700 transition hover:bg-slate-50">
              ×
            </button>
            <ArchitectWorkflowCreateView />
          </div>
        </div>
      ) : null}
    </div>
  );
}
