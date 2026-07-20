"use client";

import type { Route } from "next";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { BUSINESS_AGENTS_PATH, BUSINESS_MARKETPLACE_PATH, businessCheckoutPath, businessSetupPath } from "@/lib/routes";
import { getConnectorIncludedItem, getLlmIncludedItem, getHowItWorksSteps, getHowItWorksSubtitle } from "@coreai/shared";
import { AgentWorkflowPreview } from "@/components/business/agent-workflow-preview";
import { ExpandableText } from "@/components/common/expandable-text";

const TRIAL_DAYS = 7;

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

.agent-detail-root {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background-color: #ffffff;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.agent-detail-root ::selection {
  background: rgba(245,158,11,0.2);
  color: #0f172a;
}

.agent-detail-root :focus-visible {
  outline: 2px solid #fbbf24;
  outline-offset: 2px;
  border-radius: 4px;
}

.shadow-glow-sm {
  box-shadow: 0 0 24px -6px rgba(245,158,11,0.2);
}

.shadow-glow {
  box-shadow: 0 0 48px -8px rgba(245,158,11,0.25);
}

.shadow-glow-lg {
  box-shadow: 0 0 90px -10px rgba(245,158,11,0.3);
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}

.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
}

.animate-float {
  animation: float 7s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .animate-float {
    animation: none !important;
  }

  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
`;

type ApiArchitectProfile = {
  title?: string | null;
  bio?: string | null;
  rating?: number | null;
  completedJobs?: number | null;
};

type ApiArchitect = {
  id?: string;
  fullName?: string | null;
  email?: string | null;
  architectProfile?: ApiArchitectProfile | null;
};

type WorkflowNode = {
  data?: {
    label?: string;
    title?: string;
    subtitle?: string;
    connector?: string;
  };
};

type ApiWorkflow = {
  id?: string;
  name?: string;
  description?: string | null;
  workflowJson?: {
    nodes?: WorkflowNode[];
  } | null;
  createdAt?: string;
  updatedAt?: string;
};

type ApiListing = {
  id: string;
  name: string;
  shortDescription?: string;
  description?: string | null;
  fullDescription?: string | null;
  tagline?: string | null;
  priceCents?: number | null;
  pricingModel?: string | null;
  status?: string;
  tags?: string[];
  industryTags?: string[];
  category?: string | null;
  iconUrl?: string | null;
  includedFeatures?: string[];
  requiredConnectors?: string[];
  supportedLlms?: string[];
  installCount?: number;
  createdAt?: string;
  updatedAt?: string;
  architect?: ApiArchitect | null;
  workflow?: ApiWorkflow | null;
  freeTrialEnabled?: boolean | null;
  trialDays?: number | null;
};

type ListingApiResponse = {
  listing?: ApiListing;
};

type ApiPurchasedAgent = {
  purchaseId: string;
  purchasedAt: string;
  purchaseStatus: string;
  installedAgentId?: string | null;
  installedAgentStatus?: string | null;
  isTrial?: boolean;
  listing: ApiListing;
};

type MyAgentsResponse = {
  agents?: ApiPurchasedAgent[];
};

type OwnedAgentInfo = {
  purchaseId: string;
  purchasedAt: string;
  purchaseStatus: string;
  installedAgentId: string | null;
  installedAgentStatus: string | null;
  isTrial?: boolean;
};

function getTrialInfo(purchasedAt: string, status: string, isTrialProp?: boolean, trialDaysLimit?: number | null) {
  const isTrial = isTrialProp ?? status.toUpperCase() === "TRIALING";
  const trialDays = (trialDaysLimit && trialDaysLimit > 0) ? trialDaysLimit : TRIAL_DAYS;
  const start = new Date(purchasedAt).getTime();
  const elapsedDays = Number.isFinite(start)
    ? Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24))
    : 0;
  const daysLeft = Math.max(0, trialDays - elapsedDays);
  const trialEnded = isTrial && (status.toUpperCase() === "FAILED" || status.toUpperCase() === "CANCELED" || daysLeft <= 0);
  return { isTrial, daysLeft, trialEnded };
}

function formatLabel(value: string) {
  return value
    .replace(/^category:|^industry:/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getListingCategory(listing: ApiListing) {
  if (listing.category?.trim()) {
    return formatLabel(listing.category.trim());
  }

  const industrySet = new Set(
    (listing.industryTags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean)
  );
  const tags = listing.tags ?? [];
  const categoryTag =
    tags.find((tag) => tag.toLowerCase().startsWith("category:")) ??
    tags.find((tag) => {
      const lower = tag.toLowerCase();
      if (lower.startsWith("industry:")) return false;
      return !industrySet.has(lower);
    });

  if (categoryTag) return formatLabel(categoryTag);
  return "Uncategorized";
}

/** Prefer Configure industryTags; otherwise show real listing tags (not "All industries"). */
function getListingTags(listing: ApiListing): string[] {
  const fromIndustryTags = (listing.industryTags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (fromIndustryTags.length > 0) {
    return Array.from(new Set(fromIndustryTags));
  }

  const tags = listing.tags ?? [];
  const prefixed = tags
    .filter((tag) => tag.toLowerCase().startsWith("industry:"))
    .map((tag) => formatLabel(tag));
  if (prefixed.length > 0) {
    return Array.from(new Set(prefixed));
  }

  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag && !tag.toLowerCase().startsWith("category:"))
        .map((tag) => formatLabel(tag))
    )
  );
}

function getWorkflowFeatures(listing: ApiListing) {
  const fromFeatures = (listing.includedFeatures ?? [])
    .map((feature) => feature.trim())
    .filter(Boolean);
  if (fromFeatures.length) return fromFeatures;

  const nodes = listing.workflow?.workflowJson?.nodes ?? [];

  const fromNodes = nodes
    .map((node) => node.data?.label || node.data?.title)
    .filter((value): value is string => Boolean(value?.trim()));

  if (fromNodes.length) return fromNodes;

  const connectors = listing.requiredConnectors ?? [];
  if (connectors.length) {
    return connectors.map((connector) => getConnectorIncludedItem(connector));
  }

  return [
    listing.shortDescription ||
      listing.description ||
      listing.workflow?.description ||
      "Automates business workflows with AI."
  ];
}

function getIncludedItems(listing: ApiListing) {
  const items: string[] = [];

  // Connector integrations
  for (const connector of listing.requiredConnectors ?? []) {
    items.push(getConnectorIncludedItem(connector));
  }

  // LLM support
  for (const llm of listing.supportedLlms ?? []) {
    items.push(getLlmIncludedItem(llm));
  }

  // Always-included items
  items.push("Real-time workflow automation");
  items.push("Business-specific configuration");
  items.push("Dedicated AI agent instance");
  items.push("Ongoing feature updates");

  return Array.from(new Set(items));
}

function ArrowIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

function CheckIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function StarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 1.5 12.5 7l6 .5-4.5 4 1.4 5.9L10 14.3 4.6 17.4 6 11.5 1.5 7.5l6-.5L10 1.5Z" />
    </svg>
  );
}

function PhoneIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5a2 2 0 0 1 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a2 2 0 0 1-2 2A16 16 0 0 1 3 5z" />
    </svg>
  );
}

function getAgentDescription(listing: ApiListing): string {
  return (
    listing.fullDescription?.trim() ||
    listing.description?.trim() ||
    listing.shortDescription?.trim() ||
    listing.workflow?.description?.trim() ||
    ""
  );
}

export default function BusinessAgentDetailPage() {
  const params = useParams<{ agentId: string }>();
  const agentId = params.agentId;

  const [listing, setListing] = useState<ApiListing | null>(null);
  const [ownedAgent, setOwnedAgent] = useState<OwnedAgentInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [techOpen, setTechOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [stickyShown, setStickyShown] = useState(false);

  const heroCtaRef = useRef<HTMLAnchorElement | null>(null);
  const demoRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!agentId) return;

    let mounted = true;

    async function loadListing() {
      try {
        setIsLoading(true);
        setApiError("");

        const response = await apiGet<ListingApiResponse>(`/architect/listings/public/${agentId}`);
        const nextListing = response.data?.listing;

        if (!mounted) return;

        if (!response.success || !nextListing) {
          setListing(null);
          setApiError(response.error ?? "Could not load agent details");
          return;
        }

        setListing(nextListing);
      } catch (error) {
        console.error(error);

        if (!mounted) return;

        setListing(null);
        setApiError(error instanceof Error ? error.message : "Could not load agent details");
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadListing();

    return () => {
      mounted = false;
    };
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;

    let mounted = true;

    async function loadOwnedAgent() {
      try {
        const response = await apiGet<MyAgentsResponse>("/payments/my-agents");

        if (!mounted) return;

        const entry = (response.data?.agents ?? []).find(
          (agent) => agent.listing.id === agentId
        );

        if (response.success && entry) {
          setOwnedAgent({
            purchaseId: entry.purchaseId,
            purchasedAt: entry.purchasedAt,
            purchaseStatus: entry.purchaseStatus,
            installedAgentId: entry.installedAgentId ?? null,
            installedAgentStatus: entry.installedAgentStatus ?? null,
            isTrial: entry.isTrial,
          });
        } else {
          setOwnedAgent(null);
        }
      } catch {
        if (mounted) setOwnedAgent(null);
      }
    }

    loadOwnedAgent();

    return () => {
      mounted = false;
    };
  }, [agentId]);

  useEffect(() => {
    const cta = heroCtaRef.current;

    if (!cta || !("IntersectionObserver" in window)) {
      const onScroll = () => setStickyShown(window.scrollY > 700);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => window.removeEventListener("scroll", onScroll);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setStickyShown(!entry.isIntersecting && entry.boundingClientRect.top < 0);
        });
      },
      { threshold: 0 }
    );

    observer.observe(cta);

    return () => observer.disconnect();
  }, [listing]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDemoOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const category = useMemo(() => (listing ? getListingCategory(listing) : ""), [listing]);
  const tags = useMemo(() => (listing ? getListingTags(listing) : []), [listing]);
  const features = useMemo(() => (listing ? getWorkflowFeatures(listing) : []), [listing]);
  const includedItems = useMemo(() => (listing ? getIncludedItems(listing) : []), [listing]);

  const price = listing ? Math.round((listing.priceCents ?? 0) / 100) : 0;
  const rating = listing?.architect?.architectProfile?.rating ?? 0;
  const installs = listing?.installCount ?? listing?.architect?.architectProfile?.completedJobs ?? 0;
  const author =
    listing?.architect?.fullName ||
    listing?.architect?.architectProfile?.title ||
    listing?.architect?.email ||
    "Triven AI Architect";

  const heroDescription =
    listing?.shortDescription ||
    listing?.tagline ||
    listing?.description ||
    listing?.workflow?.description ||
    "";
  const agentDescription = useMemo(() => (listing ? getAgentDescription(listing) : ""), [listing]);
  const iconUrl = listing?.iconUrl?.trim() || null;

  const checkoutPath = listing ? businessCheckoutPath(listing.id) : "#";
  const setupPath = listing ? businessSetupPath(listing.id) : BUSINESS_AGENTS_PATH;

  const trialInfo = ownedAgent
    ? getTrialInfo(ownedAgent.purchasedAt, ownedAgent.purchaseStatus, ownedAgent.isTrial, listing?.trialDays)
    : null;
  const purchaseStatus = ownedAgent?.purchaseStatus.toUpperCase() ?? "";
  const isPaid = purchaseStatus === "SUCCEEDED";
  const isPaymentFailed = purchaseStatus === "FAILED" || purchaseStatus === "CANCELED";
  const showPayButton = Boolean(
    ownedAgent &&
      (trialInfo?.isTrial || trialInfo?.trialEnded || purchaseStatus === "TRIALING" || isPaymentFailed)
  );
  const showSetupButton = Boolean(ownedAgent && isPaid);

  const installedAgentStatus = (ownedAgent?.installedAgentStatus ?? "").toUpperCase();
  const isSetupCompleted = Boolean(ownedAgent?.installedAgentId) && (installedAgentStatus === "ACTIVE" || installedAgentStatus === "PAUSED");

  function scrollToDemo() {
    setDemoOpen(false);
    demoRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center"
    });
  }

  if (isLoading) {
    return (
      <div className="agent-detail-root min-h-screen bg-white px-6 py-16">
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
        <div className="mx-auto w-full max-w-none animate-pulse space-y-6">
          <div className="h-8 w-48 rounded-lg bg-gray-100" />
          <div className="h-12 w-2/3 rounded-xl bg-gray-100" />
          <div className="h-40 rounded-2xl bg-gray-100" />
        </div>
      </div>
    );
  }

  if (apiError || !listing) {
    return (
      <div className="agent-detail-root min-h-screen bg-white px-6 py-16">
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
        <div className="mx-auto w-full max-w-none rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Could not load agent</h1>
          <p className="mt-2 text-sm text-slate-600">{apiError || "Agent not found."}</p>
          <Link
            href={BUSINESS_MARKETPLACE_PATH}
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
          >
            Back to marketplace
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-detail-root min-h-screen bg-white text-slate-600">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <div className="border-b border-gray-100 bg-white">
        <nav className="mx-auto w-full max-w-none px-6 py-3 text-sm" aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-slate-500">
            <li data-testid="business-protected-agents-my-agents-item">
              <Link data-testid="agent-detail-my-agents-link" href={BUSINESS_AGENTS_PATH} className="transition hover:text-amber-600">
                My Agents
              </Link>
            </li>
            <li className="text-slate-300">›</li>
            <li>
              <span className="transition hover:text-amber-600">{category}</span>
            </li>
            <li className="text-slate-300">›</li>
            <li className="font-medium text-slate-700">{listing.name}</li>
          </ol>
        </nav>
      </div>

      <main>
      <section className="relative px-4 pb-10 pt-8 sm:px-6 sm:pb-16 sm:pt-12">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(55%_60%_at_50%_0%,rgba(245,158,11,0.08),rgba(255,255,255,0)_72%)]" />

          <div
            className="
              mx-auto grid w-full max-w-none
              grid-cols-1 grid-rows-[auto_auto] gap-8
              lg:grid-cols-5 lg:grid-rows-1 lg:items-start lg:gap-12
            "
          >
            <div className="col-start-1 row-start-1 lg:col-span-3 lg:row-start-1">
              <div className="relative inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-amber-500 shadow-glow sm:h-16 sm:w-16">
                {iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- icons may be data URLs
                  <img src={iconUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <PhoneIcon className="h-7 w-7 text-slate-950 sm:h-8 sm:w-8" />
                )}
                <span className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-amber-400 ring-2 ring-white">
                  ⚡
                </span>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl md:text-4xl">
                  {listing.name}
                </h1>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                  {category}
                </span>
              </div>

              {/* Short Description */}
              {heroDescription ? (
                <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">{heroDescription}</p>
              ) : (
                agentDescription && (
                  <ExpandableText
                    text={agentDescription}
                    className="mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg"
                  />
                )
              )}

              {heroDescription && agentDescription ? (
                <ExpandableText
                  text={agentDescription}
                  className="mt-4 text-sm leading-relaxed text-slate-600"
                />
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {tags.length > 0 ? (
                  tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
                      data-testid="business-agent-detail-industry-tag"
                    >
                      <span className="text-amber-500">🏷️</span>
                      {tag}
                    </span>
                  ))
                ) : null}
              </div>

              <div className="mt-3 inline-flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
                Built by{" "}
                <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                  {author} <span className="text-amber-500">✓</span>
                </span>
              </div>

              <div className="mt-7 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
                {trialInfo?.isTrial && !trialInfo.trialEnded ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-700" data-testid="business-owned-agent-trial-days-left">
                    ⏱ {trialInfo.daysLeft} {trialInfo.daysLeft === 1 ? "day" : "days"} left in trial
                  </span>
                ) : (trialInfo?.trialEnded || isPaymentFailed) ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-red-700" data-testid={trialInfo?.isTrial ? "business-owned-agent-trial-ended" : "business-owned-agent-suspended"}>
                    {trialInfo?.isTrial ? "Trial ended" : "Suspended"}
                  </span>
                ) : isPaid ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-green-700" data-testid="business-owned-agent-active">
                    Active
                  </span>
                ) : ownedAgent ? (
                  (listing?.pricingModel ?? "SUBSCRIPTION") === "FREE" ? null : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-700" data-testid="business-protected-agents-0-for-the-first-7-days-text">
                    ⚡ $0 for the first {listing?.trialDays ?? 7} days
                  </span>
                  )
                ) : null}

                {/* Pricing Display */}
                <div className="mt-3">
                  {(listing?.pricingModel ?? "SUBSCRIPTION") === "FREE" ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Free</span>
                      <span className="text-sm font-medium text-slate-500">forever</span>
                    </div>
                  ) : (listing?.pricingModel ?? "SUBSCRIPTION") === "ONE_TIME" ? (
                    <div>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">${price}</span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold text-slate-600">one-time</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">Pay once, use forever — no recurring fees.</p>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">${price}</span>
                        <span className="text-base font-medium text-slate-500 sm:text-lg">/month</span>
                      </div>
                      {!ownedAgent && (listing?.freeTrialEnabled !== false) ? (
                        <p className="mt-1 text-sm text-slate-500">
                          Try free for {listing?.trialDays ?? 7} days, then <strong className="text-slate-700">${price}/mo</strong> — cancel anytime.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>

                {ownedAgent ? (
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    {showPayButton ? (
                      <Link
                        ref={heroCtaRef}
                        href={checkoutPath}
                        data-testid="owned-agent-detail-pay-now"
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-glow transition duration-200 hover:scale-[1.02] hover:bg-amber-400 sm:px-6 sm:py-3.5 sm:text-base"
                      >
                        {(listing?.pricingModel ?? "SUBSCRIPTION") === "ONE_TIME" ? `Buy now — $${price}` : `Pay $${price}/mo`}
                        <ArrowIcon />
                      </Link>
                    ) : null}

                    {showSetupButton ? (
                      <Link
                        ref={showPayButton ? undefined : heroCtaRef}
                        href={setupPath}
                        data-testid="owned-agent-detail-setup"
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-glow transition duration-200 hover:scale-[1.02] hover:bg-amber-400 sm:px-6 sm:py-3.5 sm:text-base"
                      >
                        {isSetupCompleted ? "Edit Configuration" : "Setup agent"}
                        <ArrowIcon />
                      </Link>
                    ) : null}
                  </div>
                ) : (
                  /* Not yet purchased — show Get / Buy CTA */
                  <div className="mt-5">
                    <Link
                      ref={heroCtaRef}
                      href={checkoutPath}
                      data-testid="agent-detail-get-agent"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-glow transition duration-200 hover:scale-[1.02] hover:bg-amber-400 sm:px-6 sm:py-3.5 sm:text-base"
                    >
                      {(listing?.pricingModel ?? "SUBSCRIPTION") === "FREE"
                        ? "Install for Free"
                        : (listing?.pricingModel ?? "SUBSCRIPTION") === "ONE_TIME"
                        ? `Buy now — $${price}`
                        : (listing?.freeTrialEnabled !== false)
                        ? `Start ${listing?.trialDays ?? 7}-day free trial`
                        : `Subscribe — $${price}/mo`}
                      <ArrowIcon />
                    </Link>
                    {(listing?.pricingModel ?? "SUBSCRIPTION") === "SUBSCRIPTION" && (listing?.freeTrialEnabled !== false) ? (
                      <p className="mt-2 text-center text-xs text-slate-400">
                        No charge during your {listing?.trialDays ?? 7}-day trial — cancel anytime.
                      </p>
                    ) : null}
                  </div>
                )}

                {showPayButton ? (
                  <p className="mt-3 text-xs text-slate-500" data-testid="owned-agent-detail-pay-note">
                    {trialInfo?.trialEnded
                      ? `Your trial has ended. Pay $${price} to keep using this agent.`
                      : isPaymentFailed
                      ? `Your payment has failed or was canceled. Pay $${price} to restore access.`
                      : `Pay $${price} now to continue after your trial ends.`}
                  </p>
                ) : null}
              </div>
            </div>

            {/*
              Isolated grid cell for the demo. `grid` + `isolate` + `contain: layout`
              forces this to be its own independent formatting/positioning context —
              any `absolute`/`fixed` element inside AgentWorkflowPreview resolves
              against THIS box, not an ancestor further up the tree, so it can never
              visually creep into the pricing card above it.
            */}
            <div
              ref={demoRef}
              id="demo"
              className="
                col-start-1 row-start-2 lg:col-span-2 lg:row-start-1
                grid scroll-mt-24 isolate
                [contain:layout_paint]
              "
            >
              <AgentWorkflowPreview listing={listing} />
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="bg-gray-50 px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">How It Works</h2>
              <p className="mt-3 text-lg text-slate-600">
                {getHowItWorksSubtitle(listing.requiredConnectors, listing.workflow?.workflowJson)}
              </p>
            </div>

            <div className="relative mt-14">
              <div className="absolute top-7 hidden border-t-2 border-dashed border-amber-300 md:block" style={{ left: "16.66%", right: "16.66%" }}></div>
              <div className="relative grid gap-10 md:grid-cols-3">
                {getHowItWorksSteps(listing.requiredConnectors, listing.workflow?.workflowJson).map((step) => (
                  <div key={step.step} className="text-center">
                    <div className="relative z-10 mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-lg font-bold text-slate-950 shadow-glow-sm ring-4 ring-gray-50">
                      {step.step}
                    </div>
                    <h3 className="mt-5 text-lg font-semibold text-slate-900">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Key Metrics Section */}
        <section className="px-6 py-16 sm:py-20">
          <div id="metrics" className="mx-auto grid max-w-2xl gap-5 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-white p-6 text-center shadow-sm">
              <div className="text-4xl font-extrabold tracking-tight text-amber-600">5 sec</div>
              <div className="mt-2 text-sm text-slate-600">Average response time</div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-6 text-center shadow-sm">
              <div className="text-4xl font-extrabold tracking-tight text-amber-600">24/7</div>
              <div className="mt-2 text-sm text-slate-600">Always active, never sleeps</div>
            </div>
          </div>
        </section>

        <section className="bg-gray-50 px-6 py-16 sm:py-20">
          <div className="mx-auto w-full max-w-none">
            <SectionHeader
              title="Everything this agent does"
              description="Built to automate your workflow and keep customer conversations moving."
            />

            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {features.map((feature) => (
                <div
                  key={feature}
                  className="flex items-start gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition duration-200 hover:border-amber-200 hover:shadow-md"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                    ⚡
                  </span>
                  <p className="pt-1.5 text-slate-700" data-testid="business-protected-agents-feature-text">{feature}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 pt-16 pb-4 sm:pt-20 sm:pb-4">
          <div className="mx-auto w-full max-w-none">
            <SectionHeader title="What's included" description="One flat price. No usage caps on anything that matters." />

            <div className="mt-10 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <ul className="divide-y divide-gray-100">
                {includedItems.map((item) => (
                  <li key={item} data-testid={`agent-detail-included-item-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="flex items-center gap-3 px-6 py-3.5">
                    <CheckIcon className="h-5 w-5 shrink-0 text-emerald-500" />
                    <span className="text-slate-700" data-testid={`agent-detail-included-text-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="px-6 pt-4 pb-16 sm:pt-4 sm:pb-20">
          <div className="mx-auto w-full max-w-none">
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setTechOpen((current) => !current)}
                aria-expanded={techOpen}
                data-testid="agent-detail-tech-toggle"
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              >
                <span className="text-lg font-semibold text-slate-900" data-testid="business-protected-agents-technical-details-text">Technical Details</span>
                <svg
                  className={`h-5 w-5 text-slate-400 transition ${techOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              <div className={`overflow-hidden px-6 transition-all duration-300 ${techOpen ? "max-h-[600px]" : "max-h-0"}`}>
                <dl className="grid gap-x-8 gap-y-5 border-t border-gray-100 py-6 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supported LLMs</dt>
                    <dd className="mt-1 text-slate-700">
                      {(listing.supportedLlms ?? []).length
                        ? listing.supportedLlms?.join(", ")
                        : "Configured during setup"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow</dt>
                    <dd className="mt-1 text-slate-700">{listing.workflow?.name ?? "Custom workflow"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
                    <dd className="mt-1 text-slate-700">{listing.status?.replace(/_/g, " ") ?? "Available"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* <div
        className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 px-6 py-3 shadow-lg backdrop-blur-md transition-all duration-300"
        style={{
          opacity: stickyShown ? 1 : 0,
          transform: stickyShown ? "translateY(0)" : "translateY(0.5rem)",
          pointerEvents: stickyShown ? "auto" : "none"
        }}
      >
        <div className="mx-auto flex w-full max-w-none items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{listing.name}</p>
            <p className="truncate text-xs text-slate-500">
              Start free — $0 for 7 days, then ${price}/mo
            </p>
          </div>

          <Link
            href={checkoutPath}
            data-testid="agent-detail-sticky-start-trial"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-glow-sm transition duration-200 hover:scale-[1.03] hover:bg-amber-400"
          >
            Start Free Trial
            <ArrowIcon className="hidden h-4 w-4 sm:block" />
          </Link>
        </div>
      </div> */}

      {demoOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDemoOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-title"
            className="relative w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setDemoOpen(false)}
              data-testid="agent-detail-demo-close"
              className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-gray-100 hover:text-slate-900"
              aria-label="Close"
            >
              ✕
            </button>

            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500 text-slate-950 shadow-glow">
              ▶
            </div>

            <h2 id="demo-title" className="mt-5 text-2xl font-bold tracking-tight text-slate-900" data-testid="business-protected-agents-see-the-agent-in-action-heading">
              See the agent in action
            </h2>

            <p className="mx-auto mt-2 max-w-sm text-slate-600">
              Scroll up to watch the live preview on the phone mockup.
            </p>

            <button
              type="button"
              onClick={scrollToDemo}
              data-testid="agent-detail-view-preview"
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-slate-950 transition duration-200 hover:bg-amber-400"
            >
              View the live preview
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mx-auto w-full max-w-none text-center">
      <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl" data-testid="business-protected-agents-title-heading-2">{title}</h2>
      {description ? <p className="mt-3 text-lg text-slate-600" data-testid="business-protected-agents-description-text">{description}</p> : null}
    </div>
  );
}

