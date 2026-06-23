"use client";

import { useEffect, useState } from "react";
import {
  ArchitectBadge,
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectPageHeader,
  formatDate
} from "./architect-ui";
import { getArchitectWorkflows } from "../features/api";
import type { ArchitectWorkflow } from "../features/types";

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
        eyebrow="Workflow Studio"
        title="Your Workflows"
        description="Create reusable AI workflow systems that can later become marketplace agents."
        actionLabel="Create Workflow"
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

                  <ArchitectBadge>{workflow.isTemplate ? "Template" : "Private"}</ArchitectBadge>
                </div>

                <p className="mt-4 text-xs font-black uppercase tracking-wide text-orange-600">
                  Created {formatDate(workflow.createdAt)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <ArchitectEmptyState
            title="No workflows yet"
            text="Create your first AI workflow. Later we will upgrade this into a full visual builder."
            actionLabel="Create Workflow"
            actionHref="/architect/workflows/new"
          />
        )}
      </ArchitectCard>
    </div>
  );
}