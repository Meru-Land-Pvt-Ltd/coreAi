import Link from "next/link";
import type { Route } from "next";
import { BuilderIcon } from "./icons";

export function PublishPanel({
  workflowId,
  agentName,
  tagline,
  price,
  saving,
  statusMessage = "",
  errorMessage = "",
  publishLocked = false,
  publishLockedMessage = "",
  onGoConfigure,
  onSave
}: {
  workflowId: string;
  agentName: string;
  tagline: string;
  price: string;
  saving: boolean;
  statusMessage?: string;
  errorMessage?: string;
  publishLocked?: boolean;
  publishLockedMessage?: string;
  onGoConfigure?: () => void;
  onSave: () => void;
}) {
  return (
    <section className="builder-view fade-enter overflow-y-auto bg-gray-50 scroll-thin">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h2 className="text-xl font-bold text-slate-900" data-testid="architect-ui-workflow-builder-publish-panel-publish-to-marketplace-heading">Publish to marketplace</h2>
        <p className="mt-1 text-sm text-slate-500" data-testid="architect-ui-workflow-builder-publish-panel-review-your-listing-and-readiness-then-submit-text">Review your listing and readiness, then submit for approval. Most agents are reviewed within 24 hours.</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-publish-panel-marketplace-preview-text">Marketplace preview</p>
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="h-24 bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500" />
              <div className="px-5 pb-5">
                <div className="-mt-8 flex items-end gap-3">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-gray-100">
                    <BuilderIcon name="message" className="h-8 w-8 text-amber-500" />
                  </div>
                  <div className="pb-1">
                    <span className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700" data-testid="architect-ui-workflow-builder-publish-panel-healthcare-dental-text">Healthcare & Dental</span>
                  </div>
                </div>
                <h3 className="mt-3 text-lg font-bold text-slate-900" data-testid="architect-ui-workflow-builder-publish-panel-agent-heading">{agentName}</h3>
                <p className="mt-1 text-sm text-slate-500" data-testid="architect-ui-workflow-builder-publish-panel-tagline-never-lose-a-patient-to-a-text">{tagline || "Never lose a patient to a missed call again. Turns missed calls into booked appointments - automatically."}</p>
                <div className="mt-4 flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 font-semibold text-amber-500" data-testid="architect-ui-workflow-builder-publish-panel-new-text">
                    <BuilderIcon name="star" className="h-4 w-4" />
                    New
                  </span>
                  <span className="text-slate-400">-</span>
                  <span className="text-slate-500" data-testid="architect-ui-workflow-builder-publish-panel-by-marcus-thompson-text">by <span className="font-medium text-slate-700" data-testid="architect-ui-workflow-builder-publish-panel-marcus-thompson-text">Marcus Thompson</span></span>
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">
                  <div>
                    <span className="text-2xl font-bold text-slate-900" data-testid="architect-ui-workflow-builder-publish-panel-price-text">${price}</span>
                    <span className="text-sm text-slate-400" data-testid="architect-ui-workflow-builder-publish-panel-month-text">/month</span>
                  </div>
                  <Link data-testid="publish-panel-install-agent-link"
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
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-publish-panel-readiness-checklist-text">Readiness checklist</p>
            <div className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <ChecklistItem done title="Workflow configured" text="5 nodes - 4 connections" />
              <ChecklistItem done title="Test run passed" text="Last run completed in 1.6s" />
              <ChecklistItem done title="Pricing set" text={`$${price} / month - 14-day trial`} />
              <ChecklistItem title="Add a cover image" text="Optional, but boosts installs by about 40%" />
            </div>
            {errorMessage ? (
              <div
                data-testid="publish-panel-error"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
              >
                <p data-testid="architect-ui-workflow-builder-publish-panel-error-message-text">{errorMessage}</p>
                {onGoConfigure ? (
                  <button
                    data-testid="publish-panel-go-configure"
                    type="button"
                    onClick={onGoConfigure}
                    className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-100"
                  >
                    Go to Configure
                  </button>
                ) : null}
              </div>
            ) : null}
            {publishLocked && publishLockedMessage ? (
              <div
                data-testid="publish-panel-locked"
                className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800"
              >
                <p data-testid="publish-panel-locked-message">{publishLockedMessage}</p>
              </div>
            ) : null}
            <button
              data-testid="publish-panel-submit"
              type="button"
              onClick={onSave}
              disabled={saving || publishLocked}
              className="mt-4 w-full rounded-xl bg-amber-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Submitting..." : "Submit for review"}
            </button>
            {statusMessage ? (
              <p
                data-testid="publish-panel-status"
                className="mt-2 text-center text-xs font-semibold text-slate-500"
              >
                {saving ? "Submitting for review..." : statusMessage}
              </p>
            ) : null}
            <p className="mt-2 text-center text-[11px] text-slate-400" data-testid="architect-ui-workflow-builder-publish-panel-you-apos-ll-be-notified-once-your-text">You&apos;ll be notified once your agent is approved and live.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChecklistItem({ done = false, title, text }: { done?: boolean; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={done ? "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600" : "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600"} data-testid="architect-ui-workflow-builder-publish-panel-done-text">
        {done ? <BuilderIcon name="check" className="h-3 w-3" /> : <BuilderIcon name="info" className="h-3 w-3" />}
      </span>
      <div>
        <p className="text-sm font-medium text-slate-800" data-testid="architect-ui-workflow-builder-publish-panel-title-text">{title}</p>
        <p className="text-xs text-slate-400" data-testid="architect-ui-workflow-builder-publish-panel-xs-400-text">{text}</p>
      </div>
    </div>
  );
}
