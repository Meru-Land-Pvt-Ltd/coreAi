"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArchitectBadge,
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectPageHeader,
  formatDate
} from "@/components/architect/ui/architect-ui";
import { getArchitectWorkflows } from "@/components/architect/features/api";
import type { ArchitectWorkflow } from "@/components/architect/features/types";

export function ArchitectWorkflowsView() {
  const [workflows, setWorkflows] = useState<ArchitectWorkflow[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadWorkflows() {
    const result = await getArchitectWorkflows();

    if (result.success && result.data) {
      setWorkflows(result.data.workflows);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadWorkflows();
  }, []);

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Workflow Builder"
        title="Workflows"
        description="Create automation workflows first. Then publish them as agents for the marketplace."
        actionLabel="New Workflow"
        actionHref="/architect/workflows/new"
      />

      <ArchitectCard>
        {loading ? (
          <p className="text-sm font-bold text-orange-700">Loading workflows...</p>
        ) : workflows.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {workflows.map((workflow) => (
              <article key={workflow.id} className="rounded-[28px] bg-orange-50 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-black">{workflow.name}</h2>
                    <p className="mt-2 text-sm leading-6 text-orange-900/70">
                      {workflow.description ?? "No description added."}
                    </p>
                  </div>

                  <ArchitectBadge>{workflow.isTemplate ? "Template" : "Draft"}</ArchitectBadge>
                </div>

                <p className="mt-4 text-xs font-black uppercase tracking-wide text-orange-600">
                  Created {formatDate(workflow.createdAt)}
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={`/architect/workflows/${workflow.id}/builder`}
                    className="rounded-full bg-orange-500 px-4 py-2 text-sm font-black text-white"
                  >
                    Open Builder
                  </Link>

                  <Link
                    href="/architect/listings/new"
                    className="rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-black text-orange-800"
                  >
                    Publish as Agent
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <ArchitectEmptyState
            title="No workflows yet"
            text="Create your first workflow. The ReactFlow builder will open after workflow creation."
            actionLabel="New Workflow"
            actionHref="/architect/workflows/new"
          />
        )}
      </ArchitectCard>
    </div>
  );
}