"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArchitectField,
  ArchitectPrimaryButton,
  ArchitectTextarea
} from "@/components/architect/ui/architect-ui";
import { createArchitectWorkflow } from "@/components/architect/features/api";

const emptyAgentCanvas = {
  nodes: [],
  edges: []
};

export function ArchitectWorkflowCreateView() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSaving(true);

    const formData = new FormData(event.currentTarget);

    const result = await createArchitectWorkflow({
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      isTemplate: formData.get("isTemplate") === "on",
      workflowJson: emptyAgentCanvas
    });

    if (!result.success || !result.data) {
      setMessage(result.error ?? "Agent creation failed");
      setSaving(false);
      return;
    }

    router.push(`/architect/workflows/${result.data.workflow.id}/builder`);
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-black text-orange-950">Create New Agent</h1>

          <div className="group relative">
            <span className="flex h-6 w-6 cursor-help items-center justify-center rounded-full border border-orange-200 bg-white text-xs font-black text-orange-700">
              i
            </span>

            <div className="pointer-events-none absolute left-0 top-8 z-20 hidden w-72 rounded-2xl border border-orange-100 bg-white p-4 text-sm font-semibold leading-6 text-orange-900/70 shadow-xl shadow-orange-950/10 group-hover:block">
              This creates an empty agent canvas. After this, you will add nodes and connections inside the visual builder.
            </div>
          </div>
        </div>

        <Link
          href="/architect/workflows"
          className="rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm font-black text-orange-800 transition hover:bg-yellow-50"
        >
          Back
        </Link>
      </div>

      {message ? (
        <div className="mb-5 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-black text-red-700">
          {message}
        </div>
      ) : null}

      <div className="max-w-2xl rounded-2xl border border-orange-100 bg-white p-5 shadow-sm">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <ArchitectField
            name="name"
            label="Agent Name"
            placeholder="AI Customer Support Agent"
            required
            minLength={2}
          />

          <ArchitectTextarea
            name="description"
            label="Short Description"
            placeholder="What will this agent automate?"
          />

          <label className="flex items-center gap-3 rounded-xl bg-yellow-50 px-4 py-3 text-sm font-black text-orange-900">
            <input name="isTemplate" type="checkbox" />
            Save as reusable template
          </label>

          <div className="flex justify-end">
            <ArchitectPrimaryButton disabled={saving}>
              {saving ? "Creating..." : "Create & Open Builder"}
            </ArchitectPrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}