"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createArchitectWorkflow } from "@/components/architect/features/api";

export default function ArchitectWorkflowsPage() {
  const router = useRouter();
  const startedRef = useRef(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(true);

  async function createAndOpen() {
    setCreating(true);
    setError("");

    const result = await createArchitectWorkflow({
      name: "Untitled",
      description: "Untitled",
      isTemplate: false,
      workflowJson: { nodes: [], edges: [] }
    });

    if (result.success && result.data) {
      router.replace(`/architect/workflows/${result.data.workflow.id}/builder` as Route);
      return;
    }

    setError(result.error ?? "Could not create a new agent. Please try again.");
    setCreating(false);
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void createAndOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid min-h-screen place-items-center bg-gray-50 px-4" data-testid="architect-workflows-redirect">
      {error ? (
        <div className="w-full max-w-md rounded-2xl border border-rose-100 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-bold text-rose-600" data-testid="architect-workflows-create-error-text">{error}</p>
          <button
            type="button"
            onClick={() => {
              startedRef.current = true;
              void createAndOpen();
            }}
            data-testid="architect-workflows-create-retry"
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center" aria-busy={creating}>
          <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-amber-200 border-t-amber-500" />
          <p className="text-sm font-semibold text-slate-600" data-testid="architect-workflows-creating-text">
            Setting up your new agent…
          </p>
        </div>
      )}
    </div>
  );
}
