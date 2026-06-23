"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectField,
  ArchitectPageHeader,
  ArchitectPrimaryButton,
  ArchitectTextarea,
  csvToArray
} from "./architect-ui";
import { createArchitectListing, getArchitectWorkflows } from "../features/api";
import type { ArchitectWorkflow } from "../features/types";

export function ArchitectListingCreateView() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<ArchitectWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const price = String(formData.get("price") ?? "");

    const result = await createArchitectListing({
      workflowId: String(formData.get("workflowId") ?? "") || undefined,
      name: String(formData.get("name") ?? ""),
      shortDescription: String(formData.get("shortDescription") ?? ""),
      description: String(formData.get("description") ?? ""),
      priceCents: price ? Number(price) * 100 : 0,
      tags: csvToArray(String(formData.get("tags") ?? "")),
      requiredConnectors: csvToArray(String(formData.get("connectors") ?? "")),
      supportedLlms: csvToArray(String(formData.get("llms") ?? ""))
    });

    if (!result.success) {
      setMessage(result.error ?? "Listing creation failed");
      return;
    }

    router.push("/architect/listings");
  }

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="New Listing"
        title="Create Marketplace Listing"
        description="Package your workflow as an AI agent that businesses can discover and install."
      />

      {message ? (
        <div className="mb-5 rounded-[24px] border border-red-100 bg-red-50 px-5 py-4 text-sm font-black text-red-700">
          {message}
        </div>
      ) : null}

      {loading ? (
        <ArchitectCard>Loading workflows...</ArchitectCard>
      ) : workflows.length === 0 ? (
        <ArchitectEmptyState
          title="Create workflow first"
          text="A listing works best when it is connected to a workflow."
          actionLabel="Create Workflow"
          actionHref="/architect/workflows/new"
        />
      ) : (
        <ArchitectCard title="Listing Details">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <label className="grid gap-2 text-sm font-bold text-orange-950">
              Select Workflow
              <select
                name="workflowId"
                className="rounded-2xl border border-orange-200 bg-white px-4 py-3 text-sm outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
              >
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
            </label>

            <ArchitectField name="name" label="Agent Name" placeholder="Customer Support Agent" required />
            <ArchitectField
              name="shortDescription"
              label="Short Description"
              placeholder="AI agent that drafts customer support replies."
              required
              minLength={10}
            />
            <ArchitectTextarea
              name="description"
              label="Full Description"
              placeholder="Explain what this agent does, who it is for, and how it works."
            />
            <ArchitectField name="price" label="Price in INR" type="number" placeholder="999" min={0} />
            <ArchitectField name="tags" label="Tags comma separated" placeholder="support, gmail, automation" />
            <ArchitectField name="connectors" label="Required Connectors" placeholder="Gmail, Sheets, Slack" />
            <ArchitectField name="llms" label="Supported LLMs" placeholder="OpenAI, Claude, Gemini" />

            <ArchitectPrimaryButton>Submit for Review</ArchitectPrimaryButton>
          </form>
        </ArchitectCard>
      )}
    </div>
  );
}