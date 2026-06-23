"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArchitectCard,
  ArchitectField,
  ArchitectPageHeader,
  ArchitectPrimaryButton,
  ArchitectTextarea
} from "@/components/architect/ui/architect-ui";
import { createArchitectWorkflow } from "@/components/architect/features/api";

const starterWorkflowJson = {
  nodes: [
    {
      id: "manual-trigger",
      type: "input",
      position: {
        x: 80,
        y: 120
      },
      data: {
        label: "Manual Trigger"
      }
    },
    {
      id: "ai-prompt",
      position: {
        x: 360,
        y: 120
      },
      data: {
        label: "AI Prompt"
      }
    },
    {
      id: "human-approval",
      type: "output",
      position: {
        x: 640,
        y: 120
      },
      data: {
        label: "Human Approval"
      }
    }
  ],
  edges: [
    {
      id: "manual-trigger-ai-prompt",
      source: "manual-trigger",
      target: "ai-prompt"
    },
    {
      id: "ai-prompt-human-approval",
      source: "ai-prompt",
      target: "human-approval"
    }
  ]
};

export function ArchitectWorkflowCreateView() {
  const router = useRouter();
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const formData = new FormData(event.currentTarget);

    const result = await createArchitectWorkflow({
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      isTemplate: formData.get("isTemplate") === "on",
      workflowJson: starterWorkflowJson
    });

    if (!result.success || !result.data) {
      setMessage(result.error ?? "Workflow creation failed");
      return;
    }

    router.push(`/architect/workflows/${result.data.workflow.id}/builder`);
  }

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="New Workflow"
        title="Create Workflow"
        description="Create the workflow first, then continue inside the visual ReactFlow builder."
      />

      {message ? (
        <div className="mb-5 rounded-[24px] border border-red-100 bg-red-50 px-5 py-4 text-sm font-black text-red-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <ArchitectCard title="Workflow Details">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <ArchitectField
              name="name"
              label="Workflow Name"
              placeholder="Customer Support Reply Workflow"
              required
            />

            <ArchitectTextarea
              name="description"
              label="Description"
              placeholder="Explain what this workflow automates."
            />

            <label className="flex items-center gap-3 rounded-2xl bg-orange-50 px-4 py-3 text-sm font-black text-orange-900">
              <input name="isTemplate" type="checkbox" />
              Save as reusable template
            </label>

            <ArchitectPrimaryButton>Create and Open Builder</ArchitectPrimaryButton>
          </form>
        </ArchitectCard>

        <ArchitectCard title="Starter Flow">
          <div className="grid gap-3">
            {starterWorkflowJson.nodes.map((node, index) => (
              <div key={node.id} className="rounded-2xl bg-orange-50 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-orange-600">
                  Step {index + 1}
                </p>
                <h3 className="mt-1 font-black">{String(node.data.label)}</h3>
              </div>
            ))}
          </div>
        </ArchitectCard>
      </div>
    </div>
  );
}