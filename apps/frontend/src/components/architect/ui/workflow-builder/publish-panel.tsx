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
    <section className="builder-view fade-enter overflow-y-auto bg-gray-50 scroll-thin">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h2 className="text-xl font-bold text-slate-900">Publish to marketplace</h2>
        <p className="mt-1 text-sm text-slate-500">Review your listing and readiness, then submit for approval. Most agents are reviewed within 24 hours.</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Marketplace preview</p>
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="h-24 bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500" />
              <div className="px-5 pb-5">
                <div className="-mt-8 flex items-end gap-3">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-gray-100">
                    <BuilderIcon name="message" className="h-8 w-8 text-amber-500" />
                  </div>
                  <div className="pb-1">
                    <span className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">Healthcare & Dental</span>
                  </div>
                </div>
                <h3 className="mt-3 text-lg font-bold text-slate-900">{agentName}</h3>
                <p className="mt-1 text-sm text-slate-500">{tagline || "Never lose a patient to a missed call again. Turns missed calls into booked appointments - automatically."}</p>
                <div className="mt-4 flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 font-semibold text-amber-500">
                    <BuilderIcon name="star" className="h-4 w-4" />
                    New
                  </span>
                  <span className="text-slate-400">-</span>
                  <span className="text-slate-500">by <span className="font-medium text-slate-700">Marcus Thompson</span></span>
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">
                  <div>
                    <span className="text-2xl font-bold text-slate-900">${price}</span>
                    <span className="text-sm text-slate-400">/month</span>
                  </div>
                  <Link
                    href={`/architect/agents/publish?workflowId=${workflowId}` as Route}
                    className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Install agent
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Readiness checklist</p>
            <div className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <ChecklistItem done title="Workflow configured" text="5 nodes - 4 connections" />
              <ChecklistItem done title="Test run passed" text="Last run completed in 1.6s" />
              <ChecklistItem done title="Pricing set" text={`$${price} / month - 14-day trial`} />
              <ChecklistItem title="Add a cover image" text="Optional, but boosts installs by about 40%" />
            </div>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-amber-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
            >
              {saving ? "Submitting..." : "Submit for review"}
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-400">You&apos;ll be notified once your agent is approved and live.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChecklistItem({ done = false, title, text }: { done?: boolean; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={done ? "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600" : "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600"}>
        {done ? <BuilderIcon name="check" className="h-3 w-3" /> : <BuilderIcon name="info" className="h-3 w-3" />}
      </span>
      <div>
        <p className="text-sm font-medium text-slate-800">{title}</p>
        <p className="text-xs text-slate-400">{text}</p>
      </div>
    </div>
  );
}
