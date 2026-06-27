"use client";

import type { Route } from "next";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArchitectBadge,
  ArchitectCard,
  ArchitectField,
  ArchitectPageHeader,
  ArchitectPrimaryButton,
  ArchitectTextarea,
  MiniProgress,
  csvToArray
} from "@/components/architect/ui/architect-ui";
import { createArchitectListing, getArchitectWorkflows } from "@/components/architect/features/api";
import type { ArchitectWorkflow } from "@/components/architect/features/types";

const publishSteps = [
  "Choose workflow",
  "Write listing copy",
  "Set pricing",
  "Admin review",
  "Live marketplace"
];

export function PublishAgentView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultWorkflowId = searchParams.get("workflowId") ?? "";

  const [workflows, setWorkflows] = useState<ArchitectWorkflow[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadWorkflows() {
    const result = await getArchitectWorkflows();
    if (result.success && result.data) setWorkflows(result.data.workflows);
  }

  useEffect(() => {
    void loadWorkflows();
  }, []);

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === defaultWorkflowId),
    [defaultWorkflowId, workflows]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSaving(true);

    const formData = new FormData(event.currentTarget);
    const priceRupees = Number(formData.get("priceRupees") ?? 0);
    const selectedWorkflowId = String(formData.get("workflowId") ?? "").trim();

    // A listing must be anchored to a workflow so publish stays consistent with
    // the builder publish flow. Do not create a disconnected listing.
    if (!selectedWorkflowId) {
      setMessage(
        workflows.length
          ? "Choose a workflow to publish before submitting."
          : "Create a workflow in the builder first, then publish it here."
      );
      setSaving(false);
      return;
    }

    const result = await createArchitectListing({
      workflowId: selectedWorkflowId,
      name: String(formData.get("name") ?? ""),
      shortDescription: String(formData.get("shortDescription") ?? ""),
      description: String(formData.get("description") ?? ""),
      priceCents: Math.round(priceRupees * 100),
      tags: csvToArray(String(formData.get("tags") ?? "")),
      requiredConnectors: csvToArray(String(formData.get("requiredConnectors") ?? "")),
      supportedLlms: csvToArray(String(formData.get("supportedLlms") ?? ""))
    });

    if (!result.success) {
      setMessage(result.error ?? "Could not publish agent");
      setSaving(false);
      return;
    }

    router.push("/architect/agents" as Route);
  }

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Publish Agent"
        title="Publish Workflow as Agent"
        description="Turn a builder workflow into a marketplace-ready agent with pricing, tags, connectors, and review details."
      />

      {message ? (
        <div className="mb-5 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-black text-red-700">{message}</div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <ArchitectCard title="Agent Details" description="Use clear business language so buyers understand what outcome this agent delivers.">
          <form data-testid="publish-agent-form" onSubmit={handleSubmit} className="grid gap-4">
            <label className="grid gap-2 text-sm font-bold text-slate-800" data-testid="architect-ui-publish-agent-view-workflow-no-workflow-selected-workflows-workflow-label">
              Workflow
              <select data-testid="publish-agent-workflow-select"
                name="workflowId"
                defaultValue={defaultWorkflowId}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              >
                <option value="">No workflow selected</option>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                ))}
              </select>
            </label>

            <div className="grid gap-4 lg:grid-cols-2">
              <ArchitectField name="name" label="Agent Name" placeholder="Missed Call Text-Back" required minLength={2} />
              <ArchitectField name="priceRupees" label="Price in INR" type="number" placeholder="999" defaultValue="0" min={0} />
            </div>

            <ArchitectTextarea name="shortDescription" label="Short Description" placeholder="Never lose a lead to a missed call again. Automatically texts back in seconds." required minLength={10} />
            <ArchitectTextarea name="description" label="Full Description" placeholder="Explain use cases, benefits, setup requirements, and business outcomes." />

            <div className="grid gap-4 lg:grid-cols-3">
              <ArchitectField name="tags" label="Tags" placeholder="support, calls, crm" />
              <ArchitectField name="requiredConnectors" label="Required Connectors" placeholder="twilio, crm, gmail" />
              <ArchitectField name="supportedLlms" label="Supported LLMs" placeholder="openai, gemini, claude" />
            </div>

            <ArchitectPrimaryButton disabled={saving}>{saving ? "Submitting..." : "Submit for Review"}</ArchitectPrimaryButton>
          </form>
        </ArchitectCard>

        <div className="space-y-5">
          <ArchitectCard title="Listing Preview">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20">
                  <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 5a2 2 0 0 1 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a2 2 0 0 1-2 2A16 16 0 0 1 3 5z" />
                  </svg>
                </span>
                <div>
                  <h3 className="text-lg font-black text-slate-950" data-testid="architect-ui-publish-agent-view-marketplace-card-heading">Marketplace card</h3>
                  <p className="mt-1 text-sm text-slate-500" data-testid="architect-ui-publish-agent-view-selected-workflow-select-a-workflow-to-anchor-text">{selectedWorkflow?.name ?? "Select a workflow to anchor this agent."}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <ArchitectBadge>Automation</ArchitectBadge>
                <ArchitectBadge tone="slate">Draft preview</ArchitectBadge>
              </div>
              <div className="mt-5">
                <MiniProgress value={72} label="Review readiness" />
              </div>
            </div>
          </ArchitectCard>

          <ArchitectCard title="Publishing Flow">
            <div className="space-y-3">
              {publishSteps.map((step, index) => (
                <div key={step} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-500 text-xs font-black text-slate-950" data-testid="architect-ui-publish-agent-view-1-text">{index + 1}</span>
                  <p className="text-sm font-black text-slate-800" data-testid="architect-ui-publish-agent-view-step-text">{step}</p>
                </div>
              ))}
            </div>
          </ArchitectCard>
        </div>
      </div>
    </div>
  );
}
