import Link from "next/link";
import type { Route } from "next";
import { BuilderIcon } from "./icons";

export function PublishPanel({
  workflowId,
  agentName,
  tagline,
  price,
  saving,
  onSave
}: {
  workflowId: string;
  agentName: string;
  tagline: string;
  price: string;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <section className="absolute inset-0 overflow-y-auto bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <h2 className="text-xl font-black text-slate-900">Publish to Marketplace</h2>
        <p className="mt-1 text-sm text-slate-500">Review the first CORE marketplace agent before submission.</p>
        <div className="mt-6 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-amber-500 text-white shadow-sm shadow-amber-500/25">
              <BuilderIcon name="phone" className="h-8 w-8" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-2xl font-black text-slate-900">{agentName}</h3>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Communication</span>
              </div>
              <p className="mt-2 max-w-xl text-slate-600">{tagline}</p>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <span className="text-3xl font-black text-slate-900">${price}</span>
                <span className="text-sm text-slate-500">/month after trial</span>
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {["Customer calls", "Auto text in 5 seconds", "Lead captured"].map((item, index) => (
              <div key={item} className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                <p className="text-xs font-black text-amber-600">0{index + 1}</p>
                <p className="mt-2 text-sm font-black text-slate-900">{item}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:border-amber-300 hover:text-amber-700 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Draft"}
            </button>
            <Link
              href={`/architect/agents/publish?workflowId=${workflowId}` as Route}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-white shadow-sm shadow-amber-500/25 transition hover:bg-amber-600"
            >
              Submit for Review
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
