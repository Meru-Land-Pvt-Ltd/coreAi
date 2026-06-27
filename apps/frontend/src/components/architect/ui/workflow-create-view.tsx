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
    <div className="mx-auto grid min-h-[calc(100vh-48px)] w-full max-w-6xl items-center gap-8 py-4 lg:grid-cols-[1fr_420px]">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:p-10">
        <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-amber-700" data-testid="architect-ui-workflow-create-view-new-agent-text">
          New agent
        </span>
        <h1 className="mt-5 max-w-2xl text-3xl font-black tracking-tight text-slate-950 sm:text-4xl lg:text-5xl" data-testid="architect-ui-workflow-create-view-start-with-an-empty-canvas-heading">
          Start with an empty canvas.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-500 sm:text-lg" data-testid="architect-ui-workflow-create-view-every-new-agent-opens-as-a-blank-text">
          Every new agent opens as a blank builder. The first CORE template available inside the builder is Missed Call Text-Back.
        </p>

        {message ? (
          <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-black text-red-700">
            {message}
          </div>
        ) : null}

        <form data-testid="workflow-create-form" onSubmit={handleSubmit} className="mt-8 grid gap-5">
          <label className="grid gap-2 text-sm font-bold text-slate-800" data-testid="architect-ui-workflow-create-view-agent-label">
            Agent Name
            <input data-testid="workflow-create-name-input"
              name="name"
              placeholder="Missed Call Text-Back"
              required
              minLength={2}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
            />
          </label>

          <label className="grid gap-2 text-sm font-bold text-slate-800" data-testid="architect-ui-workflow-create-view-short-description-label">
            Short Description
            <textarea data-testid="workflow-create-description-textarea"
              name="description"
              placeholder="Customer calls, no one picks up, agent texts back in 5 seconds and captures the lead."
              className="min-h-28 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold leading-5 text-slate-500" data-testid="architect-ui-workflow-create-view-canvas-will-be-empty-add-components-or-text">
              Canvas will be empty. Add components or load the Missed Call template after opening.
            </p>
            <button data-testid="workflow-create-submit-button"
              type="submit"
              disabled={saving}
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-white shadow-sm shadow-amber-500/25 transition hover:bg-amber-600 disabled:opacity-60"
            >
              {saving ? "Creating..." : "Create & Open Builder"}
            </button>
          </div>
        </form>
      </section>

      <aside className="rounded-[2rem] border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 shadow-sm sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700" data-testid="architect-ui-workflow-create-view-first-agent-template-text">First agent template</p>
        <h2 className="mt-3 text-2xl font-black text-slate-950" data-testid="architect-ui-workflow-create-view-missed-call-back-heading">Missed Call Text-Back</h2>
        <div className="mt-6 grid gap-3">
          {[
            ["1", "Customer Calls", "Twilio detects when a business call is missed."],
            ["2", "Auto Text in 5 Seconds", "A personalized SMS lets the customer know we care."],
            ["3", "Lead Captured", "The conversation continues by text for bookings, FAQs, or handoff."]
          ].map(([number, title, text]) => (
            <div key={number} className="rounded-2xl border border-white bg-white/80 p-4 shadow-sm">
              <div className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-500 text-sm font-black text-white" data-testid="architect-ui-workflow-create-view-number-text">
                  {number}
                </span>
                <div>
                  <p className="text-sm font-black text-slate-950" data-testid="architect-ui-workflow-create-view-title-text">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500" data-testid="architect-ui-workflow-create-view-1-sm-leading-6-text">{text}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
