"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { getAuthToken, getAuthUser, hasAuthRole } from "@/lib/auth";
import {
  ASSIGNMENT_PATH,
  MARKETPLACE_PATH,
  businessAgentDetailPath,
  businessCheckoutPath,
  businessLoginPathWithNext,
  publicAgentPath
} from "@/lib/routes";
import { getHowItWorksSteps } from "@coreai/shared";
import { AgentDescriptionView } from "@/components/agent-description/shared/AgentDescriptionView";
import { NeedHelpModal } from "@/components/common/need-help-modal";
import {
  formatPublicInstallCount,
  getAgentDescription,
  htmlDescriptionToText,
  getIncludedItems,
  getListingAuthor,
  getListingCategory,
  getListingTags,
  getWorkflowFeatures,
  type ApiListing,
  type ListingApiResponse,
  type SimilarListing
} from "@/components/agent-description/shared/agent-listing";

const TRIVEN_LOGO_SRC = "/triven.ai word logo transparent bg.PNG";
const BUSINESS_LOGIN_PATH = "/business/login" as Route;
const ARCHITECT_LOGIN_PATH = "/architect/login" as Route;

const NO_SIMILAR_AGENTS: SimilarListing[] = [];

const LOADING_STYLES = `
.agent-detail-root { font-family: 'Inter', system-ui, -apple-system, sans-serif; background-color: #ffffff; }
`;

function PublicBrandingHeader() {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <header
      data-testid="agent-detail-branding-header"
      className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 sm:flex-nowrap sm:gap-x-3 sm:px-6">
        <a href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Triven home" data-testid="agent-detail-brand-home">
          <Image
            src={TRIVEN_LOGO_SRC}
            alt="Triven logo"
            width={36}
            height={36}
            priority
            className="h-9 w-9 object-contain"
          />
          <span className="text-lg font-extrabold tracking-tight text-amber-500 sm:text-xl">Triven.ai</span>
        </a>

        <nav className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Link
            href={BUSINESS_LOGIN_PATH}
            data-testid="agent-detail-login-link"
            className="rounded-xl border border-amber-500 px-2.5 py-1.5 text-xs font-semibold text-amber-600 transition hover:bg-amber-50 sm:px-4 sm:py-2 sm:text-[13.5px]"
          >
            Log in
          </Link>
          <Link
            href={ASSIGNMENT_PATH}
            data-testid="agent-detail-get-started-link"
            className="rounded-xl bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 sm:px-4 sm:py-2 sm:text-[13.5px]"
          >
            Get started
          </Link>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            data-testid="agent-detail-need-help-button"
            className="whitespace-nowrap text-xs font-semibold text-amber-600 transition-colors hover:text-amber-700 sm:text-sm"
          >
            Need help?
          </button>
        </nav>
      </div>
      <NeedHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </header>
  );
}

export default function PublicAgentDescriptionPage() {
  const params = useParams<{ agentId: string }>();
  const router = useRouter();
  const agentId = params.agentId;

  const [listing, setListing] = useState<ApiListing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState("");

  // Logged-in businesses use the business profile description page instead.
  useEffect(() => {
    const token = getAuthToken();
    const user = getAuthUser();
    if (token && hasAuthRole(user, "BUSINESS") && agentId) {
      router.replace(businessAgentDetailPath(agentId));
    }
  }, [agentId, router]);

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

  const category = useMemo(() => (listing ? getListingCategory(listing) : ""), [listing]);
  const tags = useMemo(() => (listing ? getListingTags(listing) : []), [listing]);
  const features = useMemo(() => (listing ? getWorkflowFeatures(listing) : []), [listing]);
  const includedItems = useMemo(() => (listing ? getIncludedItems(listing) : []), [listing]);
  const agentDescription = useMemo(() => (listing ? getAgentDescription(listing) : ""), [listing]);

  if (isLoading) {
    return (
      <>
        <PublicBrandingHeader />
        <div className="agent-detail-root min-h-screen overflow-x-hidden bg-white px-4 py-12 sm:px-6 sm:py-16">
          <style dangerouslySetInnerHTML={{ __html: LOADING_STYLES }} />
          <div className="mx-auto w-full max-w-6xl animate-pulse space-y-6">
            <div className="h-8 w-48 rounded-lg bg-gray-100" />
            <div className="h-12 w-2/3 rounded-xl bg-gray-100" />
            <div className="h-40 rounded-2xl bg-gray-100" />
          </div>
        </div>
      </>
    );
  }

  if (apiError || !listing) {
    return (
      <>
        <PublicBrandingHeader />
        <div className="agent-detail-root min-h-screen overflow-x-hidden bg-white px-4 py-12 sm:px-6 sm:py-16">
          <style dangerouslySetInnerHTML={{ __html: LOADING_STYLES }} />
          <div className="mx-auto max-w-xl rounded-2xl border border-red-100 bg-white p-6 text-center shadow-sm sm:p-8">
            <h1 className="text-xl font-bold text-slate-900">Could not load agent</h1>
            <p className="mt-2 text-sm text-slate-600">{apiError || "Agent not found."}</p>
            <Link
              href={MARKETPLACE_PATH}
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
            >
              Back to marketplace
            </Link>
          </div>
        </div>
      </>
    );
  }

  const price = Math.round((listing.priceCents ?? 0) / 100);
  const installsLabel = formatPublicInstallCount(listing.installCount ?? 0) || null;
  const author = getListingAuthor(listing);
  const pricingModel = listing.pricingModel ?? "SUBSCRIPTION";
  const freeTrialEnabled = listing.freeTrialEnabled ?? false;
  const trialDays = listing.trialDays ?? 0;
  const canStartTrial = pricingModel !== "FREE" && freeTrialEnabled && trialDays > 0;

  const checkoutPath = businessCheckoutPath(listing.id);
  const primaryCtaHref = businessLoginPathWithNext(checkoutPath);

  const primaryCtaLabel =
    pricingModel === "FREE"
      ? "Start Using This Agent"
      : canStartTrial
        ? `Start ${trialDays}-Day Free Trial`
        : "Buy This Agent";
  const primaryCtaTestId = canStartTrial ? "agent-detail-start-trial" : "agent-detail-pay-now";

  const pricingSubtext =
    pricingModel === "FREE"
      ? "Free to install · Pay only for usage"
      : pricingModel === "ONE_TIME"
        ? "One-time purchase · Usage charges apply"
        : "Monthly subscription · Usage charges billed separately";

  const heroDescription = htmlDescriptionToText(
    listing.shortDescription || listing.tagline || ""
  );

  const howItWorksSteps = getHowItWorksSteps(listing.requiredConnectors, listing.workflow?.workflowJson);

  return (
    <AgentDescriptionView
      header={<PublicBrandingHeader />}
      listing={listing}
      listingId={listing.id}
      listingName={listing.name}
      iconUrl={listing.iconUrl?.trim() || null}
      category={category}
      statusLabel="Ready to install"
      showAuthor={false}
      author={author}
      installsLabel={installsLabel}
      heroDescription={heroDescription}
      agentDescription={agentDescription}
      tags={tags}
      features={features}
      includedItems={includedItems}
      price={price}
      pricingModel={pricingModel}
      pricingSubtext={pricingSubtext}
      canStartTrial={canStartTrial}
      trialDays={trialDays}
      hasActiveAccess={false}
      primaryCtaHref={primaryCtaHref}
      primaryCtaLabel={primaryCtaLabel}
      primaryCtaTestId={primaryCtaTestId}
      howItWorksSteps={howItWorksSteps}
      similar={NO_SIMILAR_AGENTS}
      similarHref={(id) => publicAgentPath(id)}
      showDemo
      demoMode="public"
      demoIndustry={listing.industryTags?.[0] ?? tags[0] ?? ""}
      demoSubindustry={listing.category ?? category}
      demoVideoUrl={listing.demoVideoUrl ?? null}
    />
  );
}
