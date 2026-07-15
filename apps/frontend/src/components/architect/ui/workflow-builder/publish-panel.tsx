"use client";

import { useEffect, useState } from "react";
import { getWorkflowConfigure } from "@/components/architect/features/api";
import type { AgentConfigurePricing } from "@coreai/shared";
import { BuilderIcon } from "./icons";
import { Dot } from "lucide-react";

function formatPricingText(pricing: AgentConfigurePricing | null, fallbackPrice: string): string {
  if (!pricing) {
    return `$${fallbackPrice} / month`;
  }

  if (pricing.pricingModel === "free") {
    return "Free";
  }

  const amount = `$${Math.round(pricing.price).toLocaleString("en-US")}`;
  const base =
    pricing.pricingModel === "subscription" ? `${amount} / month` : `${amount} one-time`;
  if (pricing.freeTrialEnabled && pricing.trialDays > 0) {
    return `${base} · ${pricing.trialDays}-day trial`;
  }
  return base;
}

export function PublishPanel({
  workflowId,
  agentName,
  tagline,
  price,
  nodeCount = 0,
  connectionCount = 0,
  authorName,
  workflowFlow,
  testRunCompleted = false,
  testRunSummary = "",
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
  nodeCount?: number;
  connectionCount?: number;
  authorName: string;
  workflowFlow?: { nodes: unknown[]; edges: unknown[] };
  testRunCompleted?: boolean;
  testRunSummary?: string;
  saving: boolean;
  statusMessage?: string;
  errorMessage?: string;
  publishLocked?: boolean;
  publishLockedMessage?: string;
  onGoConfigure?: () => void;
  onSave: () => void;
}) {
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [pricing, setPricing] = useState<AgentConfigurePricing | null>(null);

  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;
    void (async () => {
      const result = await getWorkflowConfigure(workflowId);
      if (cancelled || !result.success || !result.data?.configure) return;
      const configure = result.data.configure;
      setCategory(configure.basics.category?.trim() || "");
      setTags(
        (configure.basics.industryTags ?? [])
          .map((tag) => tag.trim())
          .filter(Boolean)
      );
      setCoverUrl(configure.media.screenshotUrls?.[0] ?? null);
      setIconUrl(configure.basics.iconUrl || null);
      setPricing(configure.pricing);
    })();
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  const nodeCount = workflowFlow?.nodes.length ?? 0;
  const edgeCount = workflowFlow?.edges.length ?? 0;
  const workflowConfigured = nodeCount > 0;
  const pricingDone = pricing
    ? pricing.pricingModel === "free" || pricing.price > 0
    : Number(price) > 0 || price.trim() === "0";
  const hasCoverImage = Boolean(coverUrl);


  const previewTags = [...new Set([category, ...tags].filter(Boolean))];
  if (previewTags.length === 0) previewTags.push("Business Automation");
  const visiblePreviewTags = previewTags.slice(0, 3);
  const extraPreviewTagCount = Math.max(0, previewTags.length - 3);
  const coverCategory = category || previewTags[0];
  const pricingText = formatPricingText(pricing, price);

  return (
    <section className="builder-view fade-enter overflow-y-auto bg-gray-50 scroll-thin">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h2 className="text-xl font-bold text-slate-900" data-testid="architect-ui-workflow-builder-publish-panel-publish-to-marketplace-heading">Publish to marketplace</h2>
        <p className="mt-1 text-sm text-slate-500" data-testid="architect-ui-workflow-builder-publish-panel-review-your-listing-and-readiness-then-submit-text">Review your listing and readiness, then submit for approval. Most agents are reviewed within 24 hours.</p>
        {!testRunCompleted ? (
          <p className="mt-2 text-xs font-semibold text-amber-700" data-testid="publish-panel-test-recommendation">
            Recommended: run a dry test or live sandbox test in the Test tab before publishing.
          </p>
        ) : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-publish-panel-marketplace-preview-text">Marketplace preview</p>
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="relative z-0 h-24">
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- configure screenshots can be data URLs
                  <img src={coverUrl} alt="Listing cover" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div
                    className="absolute inset-0 bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500"
                    data-testid="publish-panel-default-cover"
                  />
                )}
                <span
                  className="absolute right-2.5 top-2.5 z-10 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 shadow-sm backdrop-blur"
                  data-testid="architect-ui-workflow-builder-publish-panel-cover-category-text"
                >
                  {coverCategory}
                </span>
              </div>
              <div className="relative z-10 px-5 pb-5">
                <div className="-mt-8 flex items-end gap-3">
                  <div
                    className="relative z-10 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-md ring-4 ring-white"
                    data-testid="publish-panel-preview-icon"
                  >
                    {iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- icons can be data URLs
                      <img src={iconUrl} alt="Agent icon" className="h-full w-full object-cover" />
                    ) : (
                      <BuilderIcon name="message" className="h-8 w-8 text-white" />
                    )}
                  </div>
                  <div className="group/tags relative pb-1">
                    <div className="inline-flex max-w-full flex-wrap items-center rounded-full bg-amber-50 px-2.5 py-0.5">
                      {visiblePreviewTags.map((tag, index) => (
                        <span
                          key={tag}
                          className="flex items-center text-[11px] font-semibold text-amber-700"
                          data-testid="architect-ui-workflow-builder-publish-panel-category-text"
                        >
                          {tag}
                          {index < visiblePreviewTags.length - 1 || extraPreviewTagCount > 0 ? (
                            <span className="text-amber-700">
                              <Dot className="h-3 w-3" />
                            </span>
                          ) : null}
                        </span>
                      ))}
                      {extraPreviewTagCount > 0 ? (
                        <span
                          className="text-[11px] font-bold text-amber-700"
                          data-testid="publish-panel-tags-more"
                          aria-label={`${extraPreviewTagCount} more tags`}
                        >
                          +{extraPreviewTagCount}
                        </span>
                      ) : null}
                    </div>
                    {extraPreviewTagCount > 0 ? (
                      <div
                        role="tooltip"
                        className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden max-w-[min(100%,18rem)] rounded-xl border border-amber-100 bg-white px-3 py-2 shadow-lg group-hover/tags:block"
                        data-testid="publish-panel-tags-tooltip"
                      >
                        <div className="flex flex-wrap gap-1.5">
                          {previewTags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                <h3 className="mt-3 text-lg font-bold text-slate-900" data-testid="architect-ui-workflow-builder-publish-panel-agent-heading">{agentName}</h3>
                <p className="mt-1 text-sm text-slate-500" data-testid="architect-ui-workflow-builder-publish-panel-agent-tagline-text">{tagline || "Automate customer conversations, bookings, and follow-ups with a reusable AI agent."}</p>
                <div className="mt-4 flex items-center gap-4 text-sm">
                  <span className="text-slate-500" data-testid="architect-ui-workflow-builder-publish-panel-by-architect-text">
                    by <span className="font-medium text-slate-700" data-testid="architect-ui-workflow-builder-publish-panel-architect-name-text">{authorName}</span>
                  </span>
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">
                  <div>
                    <span className="text-2xl font-bold text-slate-900" data-testid="architect-ui-workflow-builder-publish-panel-price-text">${price}</span>
                    <span className="text-sm text-slate-400" data-testid="architect-ui-workflow-builder-publish-panel-month-text">/month</span>
                  </div>
                  <span
                    data-testid="publish-panel-install-agent-link"
                    className="cursor-default select-none rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
                  >
                    Install agent
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-publish-panel-readiness-checklist-text">Readiness checklist</p>
            <div className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <ChecklistItem
                done={workflowConfigured}
                title="Workflow configured"
                text={
                  workflowConfigured
                    ? `${nodeCount} node${nodeCount === 1 ? "" : "s"} · ${edgeCount} connection${edgeCount === 1 ? "" : "s"}`
                    : "Add nodes in the Build tab"
                }
              />
              <ChecklistItem
                done={testRunCompleted}
                title="Test run passed"
                text={
                  testRunSummary ||
                  (testRunCompleted
                    ? "Test completed in the Test tab"
                    : "Run a dry test or live sandbox in the Test tab")
                }
              />
              <ChecklistItem
                done={pricingDone}
                title="Pricing set"
                text={pricingDone ? pricingText : "Set pricing in Configure"}
              />
              <ChecklistItem
                done={hasCoverImage}
                title={hasCoverImage ? "Cover image added" : "Add a cover image"}
                text={
                  hasCoverImage
                    ? "Screenshot ready for the marketplace listing"
                    : "Optional, but boosts installs by about 40%"
                }
              />
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
