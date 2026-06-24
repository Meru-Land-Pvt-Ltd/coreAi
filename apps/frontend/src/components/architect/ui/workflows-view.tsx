"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import {
  ArchitectCard,
  formatDate
} from "@/components/architect/ui/architect-ui";
import { ArchitectWorkflowCreateView } from "@/components/architect/ui/workflow-create-view";
import {
  deleteArchitectWorkflow,
  getArchitectWorkflows
} from "@/components/architect/features/api";
import type { ArchitectWorkflow } from "@/components/architect/features/types";

function getWorkflowStats(workflow: ArchitectWorkflow) {
  const workflowJson = workflow.workflowJson as {
    nodes?: unknown[];
    edges?: unknown[];
  };

  return {
    nodes: Array.isArray(workflowJson?.nodes) ? workflowJson.nodes.length : 0,
    edges: Array.isArray(workflowJson?.edges) ? workflowJson.edges.length : 0
  };
}

function CreateAgentCard({
  onClick,
  square = false
}: {
  onClick: () => void;
  square?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full flex-col items-center justify-center gap-4 rounded-[0.75rem] px-8 text-center transition hover:-translate-y-0.5 cursor-pointer ${
        square
          ? "border border-orange-200 bg-gradient-to-br from-yellow-100 via-orange-100 to-white py-10 shadow-lg shadow-orange-200/60 hover:border-orange-300 hover:shadow-xl hover:shadow-orange-200"
          : "border border-dashed border-orange-200 bg-gradient-to-br from-orange-50 to-yellow-50 py-12 hover:border-orange-300 hover:shadow-lg hover:shadow-orange-100"
      }`}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-[0.75rem] bg-gradient-to-br from-orange-500 to-yellow-400 text-white shadow-md shadow-orange-200 transition group-hover:scale-105">
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </span>

      <div>
        <h2 className="text-xl font-black text-orange-950">
          The world is your playground
        </h2>
        <p className="mt-1 text-sm font-semibold text-orange-700/70">
          What will you make of it?
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

    if (result.success && result.data) {
      setWorkflows(result.data.workflows);
    }

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
    const confirmed = window.confirm(
      `Delete "${workflow.name}"? This will remove the workflow from your builder.`
    );

    if (!confirmed) return;

    setDeletingId(workflow.id);
    setMessage("");

    const result = await deleteArchitectWorkflow(workflow.id);

    if (!result.success) {
      setMessage(result.error ?? "Could not delete workflow");
      setDeletingId(null);
      return;
    }

    setWorkflows((currentWorkflows) =>
      currentWorkflows.filter((item) => item.id !== workflow.id)
    );

    setMessage("Workflow deleted successfully");
    setDeletingId(null);
  }

  return (
    <div>
      <div className="mb-5 flex justify-end">
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-yellow-400 px-5 py-3 text-sm font-black text-white shadow-sm shadow-orange-200 transition hover:scale-[1.01]"
        >
          + New Agent
        </button>
      </div>

      {message ? (
        <div className="mb-5 rounded-2xl border border-orange-100 bg-white px-5 py-4 text-sm font-black text-orange-700">
          {message}
        </div>
      ) : null}

      {loading ? (
        <ArchitectCard>
          <p className="text-sm font-bold text-orange-700">Loading workflows...</p>
        </ArchitectCard>
      ) : workflows.length ? (
        <ArchitectCard>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <CreateAgentCard onClick={() => setIsCreateOpen(true)} />

            {workflows.map((workflow) => {
              const stats = getWorkflowStats(workflow);

              return (
                <article
                  key={workflow.id}
                  className="group rounded-2xl border border-orange-100 bg-white p-5 shadow-none transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-700">
                          <svg
                            className="h-5 w-5"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <rect
                              x="4"
                              y="5"
                              width="6"
                              height="6"
                              rx="1.6"
                              stroke="currentColor"
                              strokeWidth="1.7"
                            />
                            <rect
                              x="14"
                              y="13"
                              width="6"
                              height="6"
                              rx="1.6"
                              stroke="currentColor"
                              strokeWidth="1.7"
                            />
                            <path
                              d="M10 8h2.5A3.5 3.5 0 0 1 16 11.5V13"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                            />
                          </svg>
                        </span>

                        <div className="min-w-0">
                          <h2 className="truncate text-lg font-black text-orange-950">
                            {workflow.name}
                          </h2>
                          <p className="mt-0.5 text-xs font-semibold text-orange-700/65">
                            Created {formatDate(workflow.createdAt)}
                          </p>
                        </div>
                      </div>

                      <p className="mt-4 line-clamp-2 text-sm leading-6 text-orange-900/65">
                        {workflow.description || "No description added yet."}
                      </p>
                    </div>

                    <span className="shrink-0 rounded-full bg-yellow-50 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-orange-700">
                      {workflow.isTemplate ? "Template" : "Draft"}
                    </span>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-orange-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wide text-orange-500">
                        Nodes
                      </p>
                      <p className="mt-1 text-lg font-black text-orange-950">
                        {stats.nodes}
                      </p>
                    </div>

                    <div className="rounded-xl bg-yellow-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wide text-orange-500">
                        Connections
                      </p>
                      <p className="mt-1 text-lg font-black text-orange-950">
                        {stats.edges}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2 border-t border-orange-100 pt-4">
                    <Link
                      href={`/architect/workflows/${workflow.id}/builder` as Route}
                      className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-white transition hover:bg-orange-600"
                    >
                      Open Builder
                    </Link>

                    <Link
                      href={`/architect/agents/publish?workflowId=${workflow.id}` as Route}
                      className="rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm font-black text-orange-800 transition hover:border-orange-400 hover:bg-yellow-50"
                    >
                      Publish
                    </Link>

                    <button
                      type="button"
                      onClick={() => handleDelete(workflow)}
                      disabled={deletingId === workflow.id}
                      className="rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm font-black text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingId === workflow.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </ArchitectCard>
      ) : (
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="w-full max-w-sm">
            <CreateAgentCard onClick={() => setIsCreateOpen(true)} square />
          </div>
        </div>
      )}

      {isCreateOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-orange-950/40 p-4 backdrop-blur-sm sm:p-8"
          role="dialog"
          aria-modal="true"
          onClick={() => setIsCreateOpen(false)}
        >
          <div
            className="relative my-auto w-full max-w-3xl rounded-3xl border border-orange-100 bg-white p-6 shadow-2xl shadow-orange-950/20 max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              aria-label="Close"
              className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-orange-200 bg-white text-lg font-black text-orange-700 transition hover:bg-orange-50"
            >
              ×
            </button>

            <ArchitectWorkflowCreateView />
          </div>
        </div>
      ) : null}
    </div>
  );
}