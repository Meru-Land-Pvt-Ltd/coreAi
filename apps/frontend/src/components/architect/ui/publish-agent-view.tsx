"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArchitectCard,
  ArchitectField,
  ArchitectPageHeader,
  ArchitectPrimaryButton,
  ArchitectTextarea,
  csvToArray
} from "@/components/architect/ui/architect-ui";
import {
  createArchitectListing,
  getArchitectWorkflows
} from "@/components/architect/features/api";
import type { ArchitectWorkflow } from "@/components/architect/features/types";

export function PublishAgentView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultWorkflowId = searchParams.get("workflowId") ?? "";

  const [workflows, setWorkflows] = useState<ArchitectWorkflow[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadWorkflows() {
    const result = await getArchitectWorkflows();

    if (result.success && result.data) {
      setWorkflows(result.data.workflows);
    }
  }

  useEffect(() => {
    void loadWorkflows();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSaving(true);

    const formData = new FormData(event.currentTarget);
    const priceRupees = Number(formData.get("priceRupees") ?? 0);

    const result = await createArchitectListing({
      workflowId: String(formData.get("workflowId") ?? ""),
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

    router.push("/architect/agents");
  }

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Publish Agent"
        title="Publish Workflow as Agent"
        description="Select a workflow, add marketplace details, and submit it for admin review."
      />

      {message ? (
        <div className="mb-5 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-black text-red-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <ArchitectCard title="Agent Details">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <label className="grid gap-2 text-sm font-bold text-orange-950">
              Workflow
              <select
                name="workflowId"
                defaultValue={defaultWorkflowId}
                className="rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
              >
                <option value="">No workflow selected</option>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
            </label>

            <ArchitectField
              name="name"
              label="Agent Name"
              placeholder="AI Customer Support Agent"
              required
              minLength={2}
            />

            <ArchitectTextarea
              name="shortDescription"
              label="Short Description"
              placeholder="A short marketplace-ready explanation of what this agent does."
              required
              minLength={10}
            />

            <ArchitectTextarea
              name="description"
              label="Full Description"
              placeholder="Explain use cases, benefits, setup requirements, and business outcomes."
            />

            <ArchitectField
              name="priceRupees"
              label="Price in INR"
              type="number"
              placeholder="999"
              defaultValue="0"
              min={0}
            />

            <ArchitectField
              name="tags"
              label="Tags"
              placeholder="support, ecommerce, crm"
            />

            <ArchitectField
              name="requiredConnectors"
              label="Required Connectors"
              placeholder="gmail, google sheets, slack"
            />

            <ArchitectField
              name="supportedLlms"
              label="Supported LLMs"
              placeholder="openai, gemini, claude"
            />

            <ArchitectPrimaryButton disabled={saving}>
              {saving ? "Submitting..." : "Submit for Review"}
            </ArchitectPrimaryButton>
          </form>
        </ArchitectCard>

        <ArchitectCard title="Publishing Flow">
          <div className="grid gap-3">
            {[
              "Create workflow",
              "Build logic in Builder",
              "Publish as Agent",
              "Admin review",
              "Visible to businesses"
            ].map((step, index) => (
              <div key={step} className="rounded-2xl bg-orange-50 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-orange-600">
                  Step {index + 1}
                </p>
                <p className="mt-1 text-sm font-black text-orange-950">{step}</p>
              </div>
            ))}
          </div>
        </ArchitectCard>
      </div>
    </div>
  );
}