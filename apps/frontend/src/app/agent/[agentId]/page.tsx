"use client";

import type { Route } from "next";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { AgentDemoCall } from "@/components/common/agent-demo-call";
import { AgentWorkflowPreview } from "@/components/business/agent-workflow-preview";
import { ExpandableText } from "@/components/common/expandable-text";
import { BusinessSidebarLayout } from "@/components/business/sidebar";
import { getAuthToken, getAuthUser } from "@/lib/auth";
import {
  BUSINESS_MARKETPLACE_PATH,
  MARKETPLACE_PATH,
  businessCheckoutPath,
  businessLoginPathWithNext,
  businessSetupPath,
  publicAgentPath
} from "@/lib/routes";
import { getConnectorIncludedItem, getLlmIncludedItem, getHowItWorksSteps, getHowItWorksSubtitle } from "@coreai/shared";

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
  freeTrialEnabled?: boolean | null;
  trialDays?: number | null;
  status?: string;
  tags?: string[];
  industryTags?: string[];
  category?: string | null;
  iconUrl?: string | null;
  includedFeatures?: string[];
  screenshotUrls?: string[];
  requiredConnectors?: string[];
  supportedLlms?: string[];
  createdAt?: string;
  updatedAt?: string;
  installCount?: number;
  architect?: ApiArchitect | null;
  workflow?: ApiWorkflow | null;
};

type ListingAccess = {
  canStartTrial: boolean;
  hasActiveAccess: boolean;
  trialUsed: boolean;
  amountCents: number;
  purchaseStatus: string | null;
  pricingModel?: string | null;
  freeTrialEnabled?: boolean | null;
  trialDays?: number | null;
};

type ListingApiResponse = {
  listing?: ApiListing;
};

type SimilarListing = {
  id: string;
  name: string;
  shortDescription?: string;
  priceCents?: number | null;
  pricingModel?: string | null;
  category?: string | null;
  tags?: string[];
  industryTags?: string[];
  iconUrl?: string | null;
  freeTrialEnabled?: boolean;
  trialDays?: number;
  installCount?: number;
  architect?: ApiArchitect | null;
};

type SimilarListingsApiResponse = {
  listings?: SimilarListing[];
};

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

/**
 * "Everything this agent does" — the agent's capabilities/features as defined by the architect.
 * Uses includedFeatures first, then workflow nodes, then connectors, then description fallback.
 */
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

/**
 * "What's included" — the actual deliverables bundled with the agent.
 * Deliberately uses DIFFERENT source than getWorkflowFeatures to avoid duplication.
 * Priority: connectors + LLMs (integrations) + static included items.
 * Does NOT use includedFeatures (those go into "Everything this agent does").
 */
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

/**
 * The long-form agent description shown in the "About this agent" section.
 * Uses fullDescription first (architect's detailed write-up), then description, then shortDescription.
 */
function getAgentDescription(listing: ApiListing): string {
  return (
    listing.fullDescription?.trim() ||
    listing.description?.trim() ||
    listing.shortDescription?.trim() ||
    listing.workflow?.description?.trim() ||
    ""
  );
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

function BotIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M12 11V7" />
      <circle cx="12" cy="5" r="2" />
      <path d="M8 15h0M16 15h0" strokeWidth="2.5" />
    </svg>
  );
}

/** Card for a similar agent in the recommendations section. */
function SimilarAgentCard({ agent }: { agent: SimilarListing }) {
  const price = Math.round((agent.priceCents ?? 0) / 100);
  const pricingModel = agent.pricingModel ?? "SUBSCRIPTION";
  const category = agent.category ? formatLabel(agent.category) : (agent.industryTags?.[0] ? formatLabel(agent.industryTags[0]) : "AI Agent");
  const iconUrl = agent.iconUrl?.trim() || null;

  return (
    
    <Link
      href={publicAgentPath(agent.id)}
      data-testid={`similar-agent-card-${agent.id}`}
    >

      <div className="flex w-[280px] shrink-0 snap-start flex-col rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition duration-200 hover:shadow-md md:w-auto">
        <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-xl bg-amber-50 text-xl ring-1 ring-amber-100">
          {agent.iconUrl ? <img src={agent.iconUrl} alt="" className="h-full w-full object-fill" /> : "🤖"}
        </span>
        <h3 className="mt-4 text-lg font-semibold text-slate-900">{agent.name}</h3>
        <div>
          {pricingModel === "FREE" ? (
            <span className="font-medium text-slate-500">Free</span>
          ) : (
            <span className="mt-1 text-sm font-bold text-amber-600">
              ${price}
              {pricingModel === "SUBSCRIPTION" ? (
                <span className="font-medium text-slate-500">/month</span>
              ) : null}
            </span>
          )}
        </div>
        {agent.shortDescription ? (
          <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600 line-clamp-2">{agent.shortDescription}</p>
        ) : null}

        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-600 transition hover:gap-2.5 hover:text-amber-700">View agent <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></span>
      </div>
      
    </Link>
  );
}


function AgentSharePageShell({
  showSidebar,
  children
}: {
  showSidebar: boolean;
  children: ReactNode;
}) {
  if (!showSidebar) return <>{children}</>;
  return <BusinessSidebarLayout>{children}</BusinessSidebarLayout>;
}

export default function PublicAgentDetailsPage() {
  const params = useParams<{ agentId: string }>();
  const agentId = params.agentId;

  const [listing, setListing] = useState<ApiListing | null>(null);
  const [listingAccess, setListingAccess] = useState<ListingAccess | null>(null);
  const [similarListings, setSimilarListings] = useState<SimilarListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [isBusinessAuthed, setIsBusinessAuthed] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    const user = getAuthUser();
    setIsBusinessAuthed(Boolean(token && user?.role === "BUSINESS"));
  }, []);

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
    if (!agentId || !listing || !isBusinessAuthed) return;

    let mounted = true;

    async function loadListingAccess() {
      try {
        const response = await apiGet<ListingAccess>(`/payments/listing-access/${agentId}`);

        if (!mounted) return;

        if (response.success && response.data) {
          setListingAccess(response.data);
        }
      } catch {
        if (mounted) setListingAccess(null);
      }
    }

    loadListingAccess();

    return () => {
      mounted = false;
    };
  }, [agentId, isBusinessAuthed, listing]);

  useEffect(() => {
    if (!agentId || !listing) return;

    let mounted = true;

    async function loadSimilarListings() {
      try {
        const response = await apiGet<SimilarListingsApiResponse>(`/architect/listings/public/${agentId}/similar?limit=3`);

        if (!mounted) return;

        if (response.success && response.data?.listings) {
          setSimilarListings(response.data.listings);
        }
      } catch {
        // Similar agents failing silently is acceptable
      }
    }

    loadSimilarListings();

    return () => {
      mounted = false;
    };
  }, [agentId, listing]);

  const category = useMemo(() => (listing ? getListingCategory(listing) : ""), [listing]);
  const tags = useMemo(() => (listing ? getListingTags(listing) : []), [listing]);
  const features = useMemo(() => (listing ? getWorkflowFeatures(listing) : []), [listing]);
  const includedItems = useMemo(() => (listing ? getIncludedItems(listing) : []), [listing]);
  const agentDescription = useMemo(() => (listing ? getAgentDescription(listing) : ""), [listing]);

  const price = listing ? Math.round((listing.priceCents ?? 0) / 100) : 0;
  const installs = listing?.installCount ?? 0;
  const author =
    listing?.architect?.fullName ||
    listing?.architect?.architectProfile?.title ||
    listing?.architect?.email ||
    "Core AI Architect";

  // Only apply pricing model / trial info AFTER listingAccess has loaded.
  // Do NOT default freeTrialEnabled=true or trialDays=7 to avoid showing
  // "Start 0-Day Free Trial" or wrong trial text before data arrives.
  const pricingModel = listingAccess?.pricingModel ?? listing?.pricingModel ?? "SUBSCRIPTION";
  const freeTrialEnabled = listingAccess?.freeTrialEnabled ?? listing?.freeTrialEnabled ?? false;
  const trialDays = listingAccess?.trialDays ?? listing?.trialDays ?? 0;

  const canStartTrial = isBusinessAuthed
    ? listingAccess !== null &&
      pricingModel !== "FREE" &&
      freeTrialEnabled &&
      trialDays > 0 &&
      listingAccess.canStartTrial
    : pricingModel !== "FREE" && freeTrialEnabled && trialDays > 0;

  const hasActiveAccess = isBusinessAuthed && (listingAccess?.hasActiveAccess ?? false);

  // shouldPayNow: user has no active access AND can't start a trial
  const shouldPayNow = listingAccess
    ? !hasActiveAccess && !canStartTrial
    : false;

  const checkoutPath = listing ? businessCheckoutPath(listing.id) : "#";
  const managePath = listing ? businessSetupPath(listing.id) : "/business/agents";
  const protectedActionPath = hasActiveAccess ? managePath : checkoutPath;
  const primaryCtaHref = isBusinessAuthed
    ? protectedActionPath
    : businessLoginPathWithNext(protectedActionPath);
  const marketplacePath = isBusinessAuthed ? BUSINESS_MARKETPLACE_PATH : MARKETPLACE_PATH;

  // CTA label logic per spec:
  // - hasActiveAccess → "Manage agent"
  // - FREE → "Start Using This Agent"
  // - canStartTrial → "Start Free Trial"
  // - no trial, paid → "Buy This Agent"
  const primaryCtaLabel = hasActiveAccess
    ? "Manage agent"
    : pricingModel === "FREE"
      ? "Start Using This Agent"
      : canStartTrial
        ? `Start ${trialDays}-Day Free Trial`
        : "Buy This Agent";
  const primaryCtaTestId = hasActiveAccess
    ? "agent-detail-manage-agent"
    : canStartTrial
      ? "agent-detail-start-trial"
      : "agent-detail-pay-now";

  // Pricing subtext per spec
  const pricingSubtext = (() => {
    if (pricingModel === "FREE") return "Free to install · Pay only for usage";
    if (hasActiveAccess) return pricingModel === "ONE_TIME"
      ? "One-time purchase · active on your account · Usage charges apply"
      : "Monthly subscription · active on your account · Usage charges billed separately";
    if (pricingModel === "ONE_TIME") return "One-time purchase · Usage charges apply";
    return "Monthly subscription · Usage charges billed separately";
  })();

  // Short description for hero
  const heroDescription =
    listing?.shortDescription ||
    listing?.tagline ||
    listing?.description ||
    listing?.workflow?.description ||
    "";

  const iconUrl = listing?.iconUrl?.trim() || null;

  if (isLoading) {
    return (
      <AgentSharePageShell showSidebar={isBusinessAuthed}>
        <div className="agent-detail-root min-h-screen bg-white px-6 py-16">
          <style dangerouslySetInnerHTML={{ __html: STYLES }} />
          <div className="mx-auto max-w-6xl animate-pulse space-y-6">
            <div className="h-8 w-48 rounded-lg bg-gray-100" />
            <div className="h-12 w-2/3 rounded-xl bg-gray-100" />
            <div className="h-40 rounded-2xl bg-gray-100" />
          </div>
        </div>
      </AgentSharePageShell>
    );
  }

  if (apiError || !listing) {
    return (
      <AgentSharePageShell showSidebar={isBusinessAuthed}>
        <div className="agent-detail-root min-h-screen bg-white px-6 py-16">
          <style dangerouslySetInnerHTML={{ __html: STYLES }} />
          <div className="mx-auto max-w-xl rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
            <h1 className="text-xl font-bold text-slate-900">Could not load agent</h1>
            <p className="mt-2 text-sm text-slate-600">{apiError || "Agent not found."}</p>
            <Link
              href={marketplacePath}
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
            >
              Back to marketplace
            </Link>
          </div>
        </div>
      </AgentSharePageShell>
    );
  }

  return (
    <AgentSharePageShell showSidebar={isBusinessAuthed}>
    <div className="agent-detail-root min-h-screen bg-white text-slate-600">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* Breadcrumb */}
      <div className="border-b border-gray-100 bg-white">
        <nav className="mx-auto max-w-6xl px-6 py-3 text-sm" aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-slate-500">
            <li data-testid="business-protected-agents-marketplace-item">
              <Link data-testid="agent-detail-marketplace-link-2" href={marketplacePath} className="transition hover:text-amber-600">
                Marketplace
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
        {/* Hero Section */}
        <section className="relative px-6 pb-16 pt-12">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(55%_60%_at_50%_0%,rgba(245,158,11,0.08),rgba(255,255,255,0)_72%)]" />

          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-5 lg:items-start">
            {/* Left: Agent Info + CTA */}
            <div className="order-1 lg:order-1 lg:col-span-3">
              {/* Agent Icon */}
              <div className="relative inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-amber-500 shadow-glow">
                {iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={iconUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <BotIcon className="h-8 w-8 text-slate-950" />
                )}
                <span className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-amber-400 ring-2 ring-white">
                  ⚡
                </span>
              </div>

              {/* Agent Title + Category */}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                  {listing.name}
                </h1>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                  {category}
                </span>
              </div>

              {/* Short Description */}
              {heroDescription ? (
                <p className="mt-4 max-w-xl text-lg leading-relaxed text-slate-600">{heroDescription}</p>
              ) : (
                agentDescription && (
                  <ExpandableText
                    text={agentDescription}
                    className="mt-4 max-w-xl text-lg leading-relaxed text-slate-600"
                  />
                )
              )}

              {heroDescription && agentDescription ? (
                <ExpandableText
                  text={agentDescription}
                  className="mt-4 text-sm leading-relaxed text-slate-600"
                />
              ) : null}

              {/* Industry Tags */}
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

              {/* Author + Install Count */}
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  Built by{" "}
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                    {author} <span className="text-amber-500">✓</span>
                  </span>
                </span>
                {installs > 0 ? (
                  <span className="inline-flex items-center gap-1 text-slate-500">
                    <span className="font-semibold text-slate-700">{installs}</span> installs
                  </span>
                ) : null}
              </div>

              {/* Pricing Card */}
              <div className="mt-7 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                {/* Trial badge — only show when trial is actually available */}
                {canStartTrial && trialDays > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-700" data-testid="business-protected-agents-0-for-the-first-7-days-text">
                    ⚡ $0 for the first {trialDays} days
                  </span>
                ) : null}

                {/* Price Display */}
                <div className="mt-3 flex items-baseline gap-2">
                  {pricingModel === "FREE" ? (
                    <span className="text-4xl font-extrabold tracking-tight text-slate-900">Free</span>
                  ) : (
                    <>
                      <span className="text-4xl font-extrabold tracking-tight text-slate-900">${price}</span>
                      {pricingModel === "SUBSCRIPTION" ? (
                        <span className="text-lg font-medium text-slate-500">
                          /month
                        </span>
                      ) : pricingModel === "ONE_TIME" ? (
                        <span className="text-lg font-medium text-slate-500">
                          one-time
                        </span>
                      ) : null}
                    </>
                  )}
                </div>

                {/* Pricing Subtext */}
                <p className="mt-0.5 text-xs text-slate-500" data-testid="business-protected-agents-per-business-location-billed-after-your-free-text">
                  {pricingSubtext}
                </p>

                {/* CTA Button */}
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <Link
                    id="hero-cta"
                    href={primaryCtaHref}
                    data-testid={primaryCtaTestId}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-base font-semibold text-slate-950 shadow-glow transition duration-200 hover:scale-[1.02] hover:bg-amber-400"
                  >
                    {primaryCtaLabel}
                    <ArrowIcon />
                  </Link>
                </div>

                {/* After-trial price note — only when trial is available */}
                {canStartTrial && trialDays > 0 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    No credit card required to start.{" "}
                    ${price}{pricingModel === "ONE_TIME" ? " one-time purchase (Usage charges apply separately)" : "/month subscription (Usage charges billed separately)"} after trial.
                  </p>
                ) : null}

                {/* Demo Call Widget */}
                {!hasActiveAccess && listing ? (
                  <AgentDemoCall listingId={listing.id} listingName={listing.name} />
                ) : null}
              </div>

              {/* Trial Benefits — only when trial is available */}
              {canStartTrial && trialDays > 0 ? (
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                  {[`${trialDays}-day free trial`, "Cancel anytime", "Setup in 2 minutes", "30-day money-back after conversion"].map((item) => (
                    <span key={item} data-testid={`agent-detail-trial-benefit-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                      <CheckIcon className="h-4 w-4 text-emerald-500" />
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Right: Agent Preview */}
            <div id="demo" className="order-2 scroll-mt-24 lg:order-2 lg:col-span-2">
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

        {/* What this agent does (Architect Description) */}
        <section className="bg-gray-50 px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <SectionHeader
              title="What this agent does"
              description={heroDescription}
            />

            {/* Features Grid */}
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
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

        {/* What's included */}
        <section className="px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <SectionHeader title="What&apos;s included" description="Everything bundled with your agent subscription." />

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

        {/* Similar Agents */}
        {similarListings.length > 0 ? (
          <section className="bg-gray-50 px-6 py-16 sm:py-20">
            <div className="mx-auto max-w-6xl">
              <SectionHeader
                title="Similar agents"
                description="Other agents you might find useful for your business."
              />

              <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {similarListings.map((agent) => (
                  <SimilarAgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {/* Bottom CTA */}
        <section id="bottom-cta" className="scroll-mt-24 px-6 py-16 sm:py-20">
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-amber-200 bg-amber-50 px-6 py-14 text-center shadow-glow sm:px-12">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_70%_at_50%_0%,rgba(245,158,11,0.12),transparent_70%)]" />
            <h2 className="text-balance text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Start using {listing.name}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">
              Install this agent in minutes and automate your customer workflow.
            </p>
            <div className="mt-8">
              <Link
                href={primaryCtaHref}
                data-testid={hasActiveAccess ? "agent-detail-bottom-manage-agent" : canStartTrial ? "agent-detail-bottom-start-trial" : "agent-detail-bottom-pay-now"}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-9 py-4 text-lg font-semibold text-slate-950 shadow-glow-lg transition duration-200 hover:scale-[1.03] hover:bg-amber-400"
              >
                {primaryCtaLabel}
                <ArrowIcon className="h-5 w-5" />
              </Link>
            </div>
            {canStartTrial && trialDays > 0 ? (
              <p className="mt-5 text-sm text-slate-500">
                No credit card required. ${price}{pricingModel === "ONE_TIME" ? " one-time" : "/month"} after trial.
              </p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
    </AgentSharePageShell>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl" data-testid="business-protected-agents-title-heading-2">{title}</h2>
      {description ? <p className="mt-3 text-lg text-slate-600" data-testid="business-protected-agents-description-text">{description}</p> : null}
    </div>
  );
}



