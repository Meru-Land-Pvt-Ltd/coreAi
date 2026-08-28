"use client";

import { useEffect, useState } from "react";
import {
  getAgentPageConfig,
  getWorkflowConfigure,
  updateAgentPageConfig
} from "@/components/architect/features/api";
import type {
  AgentPageManageData,
  AgentPageTemplate,
  AgentPageUpdateBody
} from "@/components/architect/features/types";
import type { AgentConfigurePricing } from "@coreai/shared";
import { resolveBrowseIndustries } from "@coreai/shared";
import { CategoryTagsPill } from "@/components/common/category-tags-pill";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Image,
  MessageCircle,
  Mic,
  Plus,
  X,
  type LucideIcon
} from "lucide-react";
import { BuilderIcon } from "./icons";

function formatPricingText(pricing: AgentConfigurePricing | null, fallbackPrice: string): string {
  /* A PRICE WE DO NOT KNOW IS NOT $149. When the pricing load failed or had
     not finished, this printed the fallback as though it were the real price —
     and the fallback was seeded "149" and never once changed, so an architect
     with no price set was shown "$149/month" on the screen where they decide
     to publish, with a green tick beside it. */
  if (!pricing) {
    return fallbackPrice.trim() ? `$${fallbackPrice}/month` : "Price not set yet";
  }

  if (pricing.pricingModel === "free") {
    return "Free";
  }

  const amount = `$${Math.round(pricing.price).toLocaleString("en-US")}`;
  const base =
    pricing.pricingModel === "subscription" ? `${amount}/month` : `${amount} one-time`;
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
  /* And it must not tick green on a price nobody has set. */
  const pricingDone = pricing ? pricing.pricingModel === "free" || pricing.price > 0 : false;
  const hasCoverImage = Boolean(coverUrl);

  const industryLabel = resolveBrowseIndustries(tags)[0] ?? tags[0] ?? "";
  const categoryLabels = [
    ...new Set(
      category
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    )
  ];
  const coverCategory = categoryLabels[0] || industryLabel || "Category";
  const pricingText = formatPricingText(pricing, price);

  return (
    <section className="builder-view fade-enter overflow-y-auto bg-gray-50 scroll-thin">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
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
                    className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100"
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
                  <div className="flex w-full min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden pb-1">
                    {industryLabel ? (
                      <span
                        className="shrink-0 whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600"
                        data-testid="architect-ui-workflow-builder-publish-panel-industry-text"
                      >
                        {industryLabel}
                      </span>
                    ) : null}
                    <CategoryTagsPill
                      labels={categoryLabels}
                      compact
                      className="min-w-0"
                      testId="architect-ui-workflow-builder-publish-panel-category-text"
                      moreTestId="publish-panel-category-more"
                      tooltipTestId="publish-panel-category-tooltip"
                      emptyLabel="Category not set"
                    />
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
                    <span className="text-2xl font-bold text-slate-900" data-testid="architect-ui-workflow-builder-publish-panel-price-text pricingText">{formatPricingText(pricing, price)}</span>
                    
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
                    : "Optional — this is your listing's cover image"
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

        <AgentPageSection workflowId={workflowId} />
      </div>
    </section>
  );
}

/* TWO OF THESE FOUR CANNOT DO REAL WORK ON A BUSINESS'S OWN SITE.
   Media and Form run the agent for real. Chat and Voice run a rehearsal —
   the chat engine books into a test calendar and marks every lead a test,
   and the voice button starts a demonstration call. Pasted onto a paying
   business's website that was invisible: their customer was told an
   appointment was booked and nothing existed the next morning. The backend
   refuses those two on a business's own site now, and an architect choosing
   one should know before they choose it, not after. */
const AGENT_PAGE_TEMPLATE_OPTIONS: Array<{
  value: AgentPageTemplate;
  label: string;
  description: string;
  icon: LucideIcon;
  /** False when this page can only demonstrate, never do the work. */
  worksOnABusinessSite: boolean;
}> = [
  {
    value: "chat",
    label: "Chat",
    description: "Visitors message your agent, like texting.",
    icon: MessageCircle,
    worksOnABusinessSite: false
  },
  {
    value: "voice",
    label: "Voice",
    description: "Visitors talk with your agent out loud.",
    icon: Mic,
    worksOnABusinessSite: false
  },
  {
    value: "media",
    label: "Media",
    description: "Visitors describe it, your agent creates it.",
    icon: Image,
    worksOnABusinessSite: true
  },
  {
    value: "form",
    label: "Form",
    description: "Visitors send one request, get one result.",
    icon: FileText,
    worksOnABusinessSite: true
  }
];

const AGENT_PAGE_HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const AGENT_PAGE_DEFAULT_ACCENT = "#f59e0b";
const AGENT_PAGE_MAX_PROMPTS = 4;

/**
 * The one line a business pastes into their own website.
 *
 * Deliberately a single self-closing script tag: every website builder accepts
 * one, and a business owner can copy it without understanding it. The loader it
 * fetches does the rest.
 */
function embedSnippet(slug: string): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://triven.ai";
  return `<script src="${origin}/embed.js" data-triven-agent="${slug}" async></script>`;
}

function normalizeAccentHex(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function AgentPageSection({ workflowId }: { workflowId: string }) {
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [manage, setManage] = useState<AgentPageManageData | null>(null);
  const [template, setTemplate] = useState<AgentPageTemplate>("chat");
  const [headline, setHeadline] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [prompts, setPrompts] = useState<string[]>([]);
  const [accentColor, setAccentColor] = useState("");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savingPage, setSavingPage] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;
    void (async () => {
      const result = await getAgentPageConfig(workflowId);
      if (cancelled) return;
      if (!result.success || !result.data) {
        setLoadState("error");
        return;
      }
      const data = result.data;
      setManage(data);
      if (data.page) {
        setTemplate(data.page.template);
        setHeadline(data.page.headline ?? "");
        setWelcomeMessage(data.page.welcomeMessage ?? "");
        setPrompts(data.page.suggestedPrompts ?? []);
        setAccentColor(data.page.accentColor ?? "");
      } else {
        setTemplate(data.defaultTemplate);
      }
      setLoadState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  /** Any edit invalidates a previous "Saved" confirmation. */
  function markEdited() {
    setSaveMessage("");
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the URL stays selectable in the field.
    }
  }

  async function savePage() {
    if (savingPage) return;
    const accent = normalizeAccentHex(accentColor);
    if (accent && !AGENT_PAGE_HEX_PATTERN.test(accent)) {
      setSaveMessage("");
      setSaveError("Accent color should be a 6-digit hex value, like #f59e0b.");
      return;
    }
    setSavingPage(true);
    setSaveError("");
    setSaveMessage("");
    const body: AgentPageUpdateBody = {
      template,
      headline: headline.trim(),
      welcomeMessage: welcomeMessage.trim(),
      suggestedPrompts: prompts
        .map((prompt) => prompt.trim())
        .filter(Boolean)
        .slice(0, AGENT_PAGE_MAX_PROMPTS),
      // An emptied field clears the accent back to the default (null);
      // omitting the key would leave the old color in place forever.
      accentColor: accent || null
    };
    const result = await updateAgentPageConfig(workflowId, body);
    setSavingPage(false);
    if (!result.success || !result.data) {
      // Validation errors are already human ("Headline must be…"); anything
      // 5xx-shaped gets a friendly fallback instead of raw server text.
      const friendly =
        result.error && (result.status ?? 0) < 500
          ? result.error
          : "Could not save your page settings. Please try again.";
      setSaveError(friendly);
      return;
    }
    const saved = result.data;
    setManage((prev) =>
      prev
        ? { ...prev, page: saved.page, url: saved.url }
        : { page: saved.page, url: saved.url, defaultTemplate: saved.page.template }
    );
    setTemplate(saved.page.template);
    setHeadline(saved.page.headline ?? "");
    setWelcomeMessage(saved.page.welcomeMessage ?? "");
    setPrompts(saved.page.suggestedPrompts ?? []);
    setAccentColor(saved.page.accentColor ?? "");
    setSaveMessage("Saved — your page is up to date.");
  }

  if (loadState === "loading") {
    return (
      <div className="mt-10" data-testid="agent-page-section-loading">
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
          Your agent&apos;s page
        </p>
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-gray-100" />
          <div className="mt-3 h-9 w-full animate-pulse rounded-xl bg-gray-100" />
        </div>
      </div>
    );
  }

  if (loadState === "error" || !manage) {
    return (
      <div className="mt-10" data-testid="agent-page-section-error">
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
          Your agent&apos;s page
        </p>
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">
            We couldn&apos;t load your page settings. Refresh to try again.
          </p>
        </div>
      </div>
    );
  }

  const page = manage.page;
  const pageUrl = manage.url;
  const accentPreview = normalizeAccentHex(accentColor);

  return (
    <div className="mt-10" data-testid="agent-page-section">
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="agent-page-section-heading">
        Your agent&apos;s page
      </p>
      {!page ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500" data-testid="agent-page-pending-note">
            Your agent&apos;s public page is created when you submit for review.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500" data-testid="agent-page-intro-text">
            Every published agent gets its own page — a polished place where customers can try it before they buy it.
          </p>

          {pageUrl ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <code
                data-testid="agent-page-url"
                className="min-w-0 flex-1 truncate rounded-xl border border-gray-100 bg-gray-50/40 px-3 py-2 font-mono text-sm text-slate-700"
              >
                {pageUrl}
              </code>
              <button
                data-testid="agent-page-copy-url"
                type="button"
                onClick={() => void copyUrl(pageUrl)}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-gray-50"
              >
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <a
                data-testid="agent-page-open"
                href={pageUrl}
                target="_blank"
                rel="noreferrer"
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-gray-50"
              >
                <ExternalLink className="h-4 w-4" />
                Open page
              </a>
            </div>
          ) : null}

          {page?.slug ? (
            <>
              <p className="mt-6 text-sm font-semibold text-slate-800" data-testid="agent-embed-heading">
                Put it on any website
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-500" data-testid="agent-embed-intro">
                One line. A business pastes this into their own site and your
                agent works there, in their page — no coding, nothing to install.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code
                  data-testid="agent-embed-snippet"
                  className="min-w-0 flex-1 truncate rounded-xl border border-gray-100 bg-gray-50/40 px-3 py-2 font-mono text-sm text-slate-700"
                >
                  {embedSnippet(page.slug)}
                </code>
                <button
                  data-testid="agent-embed-copy"
                  type="button"
                  onClick={() => void copyUrl(embedSnippet(page.slug))}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-gray-50"
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500" data-testid="agent-embed-bubble-hint">
                Want a floating button instead of a section? Add{" "}
                <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px]">
                  data-triven-mode=&quot;bubble&quot;
                </code>{" "}
                to the same line.
              </p>
            </>
          ) : null}

          <p className="mt-6 text-sm font-semibold text-slate-800" data-testid="agent-page-template-heading">
            How visitors experience it
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {AGENT_PAGE_TEMPLATE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = template === option.value;
              const recommended = manage.defaultTemplate === option.value;
              return (
                <button
                  key={option.value}
                  data-testid={`agent-page-template-${option.value}`}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    markEdited();
                    setTemplate(option.value);
                  }}
                  className={
                    selected
                      ? "relative rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-left ring-2 ring-amber-500 transition"
                      : "relative rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition hover:border-amber-200"
                  }
                >
                  {recommended ? (
                    <span
                      data-testid={`agent-page-template-${option.value}-recommended`}
                      className="absolute right-3 top-3 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700"
                    >
                      Recommended
                    </span>
                  ) : null}
                  <Icon className={selected ? "h-5 w-5 text-amber-600" : "h-5 w-5 text-slate-400"} />
                  <p className="mt-2 text-sm font-semibold text-slate-900">{option.label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{option.description}</p>
                  {!option.worksOnABusinessSite ? (
                    <p
                      data-testid={`agent-page-template-${option.value}-demo-only`}
                      className="mt-2 text-[11px] font-medium leading-4 text-slate-400"
                    >
                      Shows what the agent does. It cannot take real work on a
                      business&apos;s own website yet.
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>

          <button
            data-testid="agent-page-customize-toggle"
            type="button"
            aria-expanded={customizeOpen}
            onClick={() => setCustomizeOpen((open) => !open)}
            className="mt-6 flex items-center gap-1.5 text-sm font-semibold text-slate-700 transition hover:text-slate-900"
          >
            <ChevronDown className={customizeOpen ? "h-4 w-4 rotate-180 transition-transform" : "h-4 w-4 transition-transform"} />
            Customize
          </button>

          {customizeOpen ? (
            <div className="mt-4 space-y-5">
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="agent-page-headline" className="text-xs font-semibold text-slate-600">
                    Headline
                  </label>
                  <span className="text-[11px] text-slate-400" data-testid="agent-page-headline-counter">
                    {headline.length}/120
                  </span>
                </div>
                <input
                  id="agent-page-headline"
                  data-testid="agent-page-headline"
                  type="text"
                  value={headline}
                  maxLength={120}
                  onChange={(event) => {
                    markEdited();
                    setHeadline(event.target.value);
                  }}
                  placeholder="What your agent does, in one line"
                  className="fld mt-2 w-full rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="agent-page-welcome" className="text-xs font-semibold text-slate-600">
                    Welcome message
                  </label>
                  <span className="text-[11px] text-slate-400" data-testid="agent-page-welcome-counter">
                    {welcomeMessage.length}/500
                  </span>
                </div>
                <textarea
                  id="agent-page-welcome"
                  data-testid="agent-page-welcome"
                  value={welcomeMessage}
                  maxLength={500}
                  rows={3}
                  onChange={(event) => {
                    markEdited();
                    setWelcomeMessage(event.target.value);
                  }}
                  placeholder="The first thing visitors see. e.g. Hi! Ask me anything about booking an appointment."
                  className="fld mt-2 w-full resize-none rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400"
                />
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-600">Suggested prompts</p>
                <p className="mt-0.5 text-[11px] text-slate-400">Give visitors up to 4 ideas to try first.</p>
                <div className="mt-2 space-y-2">
                  {prompts.map((prompt, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        data-testid={`agent-page-prompt-${index}`}
                        type="text"
                        value={prompt}
                        maxLength={80}
                        onChange={(event) => {
                          markEdited();
                          setPrompts((prev) => prev.map((value, i) => (i === index ? event.target.value : value)));
                        }}
                        placeholder="e.g. Book me in for Tuesday morning"
                        className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400"
                      />
                      <button
                        data-testid={`agent-page-prompt-remove-${index}`}
                        type="button"
                        aria-label="Remove prompt"
                        onClick={() => {
                          markEdited();
                          setPrompts((prev) => prev.filter((_, i) => i !== index));
                        }}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-gray-50 hover:text-slate-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                {prompts.length < AGENT_PAGE_MAX_PROMPTS ? (
                  <button
                    data-testid="agent-page-prompt-add"
                    type="button"
                    onClick={() => {
                      markEdited();
                      setPrompts((prev) => [...prev, ""]);
                    }}
                    className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-600 transition hover:text-amber-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add a prompt
                  </button>
                ) : null}
              </div>

              <div>
                <label htmlFor="agent-page-accent-hex" className="text-xs font-semibold text-slate-600">
                  Accent color
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    data-testid="agent-page-accent-color"
                    type="color"
                    aria-label="Pick accent color"
                    value={AGENT_PAGE_HEX_PATTERN.test(accentPreview) ? accentPreview : AGENT_PAGE_DEFAULT_ACCENT}
                    onChange={(event) => {
                      markEdited();
                      setAccentColor(event.target.value);
                    }}
                    className="h-9 w-9 cursor-pointer rounded-lg border border-gray-200 bg-white p-1"
                  />
                  <input
                    id="agent-page-accent-hex"
                    data-testid="agent-page-accent-hex"
                    type="text"
                    value={accentColor}
                    maxLength={7}
                    onChange={(event) => {
                      markEdited();
                      setAccentColor(event.target.value);
                    }}
                    placeholder="#f59e0b"
                    className="fld w-28 rounded-xl border border-gray-100 bg-gray-50/40 px-3 py-2 font-mono text-sm text-slate-800 placeholder:text-slate-400"
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
            <button
              data-testid="agent-page-save"
              type="button"
              onClick={() => void savePage()}
              disabled={savingPage}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingPage ? "Saving..." : "Save page settings"}
            </button>
            {saveMessage ? (
              <p data-testid="agent-page-save-status" className="text-xs font-semibold text-green-600">
                {saveMessage}
              </p>
            ) : null}
            {saveError ? (
              <p data-testid="agent-page-save-error" className="text-xs font-semibold text-red-600">
                {saveError}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
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
