"use client";

import type { Route } from "next";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
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
      isTemplate: false,
      workflowJson: emptyAgentCanvas
    });

    if (!result.success || !result.data) {
      setMessage(result.error ?? "Agent creation failed");
      setSaving(false);
      return;
    }

    router.push(`/architect/workflows/${result.data.workflow.id}/builder` as Route);
  }

  return (
    <div data-testid="components-architect-ui-workflow-create-view-div-1" className="mx-auto grid min-h-[calc(100vh-48px)] w-full max-w-6xl items-center gap-8 py-4 lg:grid-cols-[1fr_420px]">
      <section data-testid="components-architect-ui-workflow-create-view-section-1" className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:p-10">
        <span data-testid="components-architect-ui-workflow-create-view-span-1" className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-amber-700">
          New agent
        </span>
        <h1 data-testid="components-architect-ui-workflow-create-view-h1-1" className="mt-5 max-w-2xl text-3xl font-black tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
          Start with an empty canvas.
        </h1>
        <p data-testid="components-architect-ui-workflow-create-view-p-1" className="mt-4 max-w-2xl text-base leading-7 text-slate-500 sm:text-lg">
          Every new agent opens as a blank builder. The first CORE template available inside the builder is Missed Call Text-Back.
        </p>

        {message ? (
          <div data-testid="components-architect-ui-workflow-create-view-div-2" className="mt-6 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-black text-red-700">
            {message}
          </div>
        ) : null}

        <form data-testid="components-architect-ui-workflow-create-view-form-1" onSubmit={handleSubmit} className="mt-8 grid gap-5">
          <label data-testid="components-architect-ui-workflow-create-view-label-1" className="grid gap-2 text-sm font-bold text-slate-800">
            Agent Name
            <input data-testid="components-architect-ui-workflow-create-view-input-1"
              name="name"
              placeholder="Missed Call Text-Back"
              required
              minLength={2}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
            />
          </label>

          <label data-testid="components-architect-ui-workflow-create-view-label-2" className="grid gap-2 text-sm font-bold text-slate-800">
            Short Description
            <textarea data-testid="components-architect-ui-workflow-create-view-textarea-1"
              name="description"
              placeholder="Customer calls, no one picks up, agent texts back in 5 seconds and captures the lead."
              className="min-h-28 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
            />
          </label>

          <div data-testid="components-architect-ui-workflow-create-view-div-3" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p data-testid="components-architect-ui-workflow-create-view-p-2" className="text-xs font-semibold leading-5 text-slate-500">
              Canvas will be empty. Add components or load the Missed Call template after opening.
            </p>
            <button data-testid="components-architect-ui-workflow-create-view-button-1"
              type="submit"
              disabled={saving}
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-white shadow-sm shadow-amber-500/25 transition hover:bg-amber-600 disabled:opacity-60"
            >
              {saving ? "Creating..." : "Create & Open Builder"}
            </button>
          </div>
        </form>
      </section>

      <aside data-testid="components-architect-ui-workflow-create-view-aside-1" className="rounded-[2rem] border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 shadow-sm sm:p-7">
        <p data-testid="components-architect-ui-workflow-create-view-p-3" className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">First agent template</p>
        <h2 data-testid="components-architect-ui-workflow-create-view-h2-1" className="mt-3 text-2xl font-black text-slate-950">Missed Call Text-Back</h2>
        <div data-testid="components-architect-ui-workflow-create-view-div-4" className="mt-6 grid gap-3">
          {[
            ["1", "Customer Calls", "Twilio detects when a business call is missed."],
            ["2", "Auto Text in 5 Seconds", "A personalized SMS lets the customer know we care."],
            ["3", "Lead Captured", "The conversation continues by text for bookings, FAQs, or handoff."]
          ].map(([number, title, text]) => (
            <div data-testid="components-architect-ui-workflow-create-view-div-5" key={number} className="rounded-2xl border border-white bg-white/80 p-4 shadow-sm">
              <div data-testid="components-architect-ui-workflow-create-view-div-6" className="flex gap-3">
                <span data-testid="components-architect-ui-workflow-create-view-span-2" className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-500 text-sm font-black text-white">
                  {number}
                </span>
                <div data-testid="components-architect-ui-workflow-create-view-div-7">
                  <p data-testid="components-architect-ui-workflow-create-view-p-4" className="text-sm font-black text-slate-950">{title}</p>
                  <p data-testid="components-architect-ui-workflow-create-view-p-5" className="mt-1 text-sm leading-6 text-slate-500">{text}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
