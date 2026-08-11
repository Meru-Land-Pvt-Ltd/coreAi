"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import {
  BUSINESS_AGENTS_PATH,
  BUSINESS_MARKETPLACE_PATH,
  businessAgentDetailPath,
  businessCheckoutPath,
  businessSetupPath
} from "@/lib/routes";
import { getHowItWorksSteps } from "@coreai/shared";
import { AgentDescriptionView } from "@/components/agent-description/shared/AgentDescriptionView";
import {
  formatRealInstallCount,
  getAgentDescription,
  htmlDescriptionToText,
  getIncludedItems,
  getListingAuthor,
  getListingCategory,
  formatLabel,
  getWorkflowFeatures,
  type ApiListing,
  type ListingApiResponse,
  type SimilarListing,
  type SimilarListingsApiResponse
} from "@/components/agent-description/shared/agent-listing";

const TRIAL_DAYS = 7;

const LOADING_STYLES = `
.agent-detail-root {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background-color: #ffffff;
}
`;

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

function getTrialInfo(
  purchasedAt: string,
  status: string,
  isTrialProp?: boolean,
  trialDaysLimit?: number | null
) {
  const normalizedStatus = status.toUpperCase();
  const isTrial = isTrialProp ?? normalizedStatus === "TRIALING";

  const trialDays =
    trialDaysLimit && trialDaysLimit > 0
      ? trialDaysLimit
      : TRIAL_DAYS;

  const start = new Date(purchasedAt).getTime();

  const elapsedDays = Number.isFinite(start)
    ? Math.floor(
        (Date.now() - start) /
          (1000 * 60 * 60 * 24)
      )
    : 0;

  const daysLeft = Math.max(
    0,
    trialDays - elapsedDays
  );

  const trialEnded =
    isTrial &&
    (
      normalizedStatus === "FAILED" ||
      normalizedStatus === "CANCELED" ||
      daysLeft <= 0
    );

  return {
    isTrial,
    daysLeft,
    trialEnded
  };
}

export default function BusinessAgentDescriptionPage() {
  const params = useParams<{ agentId: string }>();
  const agentId = params.agentId;

  const [listing, setListing] =
    useState<ApiListing | null>(null);

  const [ownedAgent, setOwnedAgent] =
    useState<OwnedAgentInfo | null>(null);

  const [similarListings, setSimilarListings] =
    useState<SimilarListing[]>([]);

  const [isLoading, setIsLoading] =
    useState(true);

  const [apiError, setApiError] =
    useState("");

  useEffect(() => {
    if (!agentId) {
      return;
    }

    let mounted = true;

    async function loadListing() {
      try {
        setIsLoading(true);
        setApiError("");

        const response =
          await apiGet<ListingApiResponse>(
            `/architect/listings/public/${agentId}`
          );

        const nextListing =
          response.data?.listing;

        if (!mounted) {
          return;
        }

        if (!response.success || !nextListing) {
          setListing(null);
          setApiError(
            response.error ??
              "Could not load agent details"
          );
          return;
        }

        setListing(nextListing);
      } catch (error) {
        console.error(error);

        if (!mounted) {
          return;
        }

        setListing(null);
        setApiError(
          error instanceof Error
            ? error.message
            : "Could not load agent details"
        );
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadListing();

    return () => {
      mounted = false;
    };
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      return;
    }

    let mounted = true;

    async function loadOwnedAgent() {
      try {
        const response =
          await apiGet<MyAgentsResponse>(
            "/payments/my-agents"
          );

        if (!mounted) {
          return;
        }

        const entry =
          (response.data?.agents ?? []).find(
            (agent) =>
              agent.listing.id === agentId
        );

        if (response.success && entry) {
          setOwnedAgent({
            purchaseId: entry.purchaseId,
            purchasedAt: entry.purchasedAt,
            purchaseStatus: entry.purchaseStatus,
            installedAgentId:
              entry.installedAgentId ?? null,
            installedAgentStatus:
              entry.installedAgentStatus ?? null,
            isTrial: entry.isTrial
          });
        } else {
          setOwnedAgent(null);
        }
      } catch {
        if (mounted) {
          setOwnedAgent(null);
        }
      }
    }

    void loadOwnedAgent();

    return () => {
      mounted = false;
    };
  }, [agentId]);

  useEffect(() => {
    if (!agentId || !listing) {
      return;
    }

    let mounted = true;

    async function loadSimilarListings() {
      try {
        const response =
          await apiGet<SimilarListingsApiResponse>(
            `/architect/listings/public/${agentId}/similar`
          );

        if (!mounted) {
          return;
        }

        if (
          response.success &&
          response.data?.listings
        ) {
          setSimilarListings(
            response.data.listings
          );
        }
      } catch {
        // Similar listings are optional.
      }
    }

    void loadSimilarListings();

    return () => {
      mounted = false;
    };
  }, [agentId, listing]);

  const category = useMemo(
    () =>
      listing
        ? getListingCategory(listing)
        : "",
    [listing]
  );

  const industryLabel = useMemo(() => {
    if (!listing) return "";
    return listing.industryTags?.[0]?.trim() ?? "";
  }, [listing]);

  const categories = useMemo(() => {
    if (!listing?.category) return [];
    return listing.category
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => formatLabel(part));
  }, [listing]);

  const features = useMemo(
    () =>
      listing
        ? getWorkflowFeatures(listing)
        : [],
    [listing]
  );

  const includedItems = useMemo(
    () =>
      listing
        ? getIncludedItems(listing)
        : [],
    [listing]
  );

  const agentDescription = useMemo(
    () =>
      listing
        ? getAgentDescription(listing)
        : "",
    [listing]
  );

  if (isLoading) {
    return (
      <div className="agent-detail-root min-h-screen bg-white px-6 py-16">
        <style
          dangerouslySetInnerHTML={{
            __html: LOADING_STYLES
          }}
        />

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
        <style
          dangerouslySetInnerHTML={{
            __html: LOADING_STYLES
          }}
        />

        <div className="mx-auto w-full max-w-none rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">
            Could not load agent
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            {apiError || "Agent not found."}
          </p>

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

  const price = Math.round(
    (listing.priceCents ?? 0) / 100
  );

  /*
   * Only display the actual listing install count.
   * Do not substitute architect jobs or any generated value.
   */
  const parsedInstallCount =
    Number(listing.installCount ?? 0);

  const realInstallCount =
    Number.isFinite(parsedInstallCount)
      ? Math.max(
          0,
          Math.trunc(parsedInstallCount)
        )
      : 0;

  const installsLabel =
    realInstallCount > 0
      ? formatRealInstallCount(
          realInstallCount
        )
      : null;

  const author =
    getListingAuthor(listing);

  const pricingModel =
    listing.pricingModel ??
    "SUBSCRIPTION";

  const freeTrialEnabled =
    listing.freeTrialEnabled !== false;

  const trialDays =
    listing.trialDays ?? TRIAL_DAYS;

  const checkoutPath =
    businessCheckoutPath(listing.id);

  const setupPath =
    businessSetupPath(listing.id);

  const trialInfo = ownedAgent
    ? getTrialInfo(
        ownedAgent.purchasedAt,
        ownedAgent.purchaseStatus,
        ownedAgent.isTrial,
        listing.trialDays
      )
    : null;

  const purchaseStatus =
    ownedAgent?.purchaseStatus.toUpperCase() ??
    "";

  const isPaid =
    purchaseStatus === "SUCCEEDED";

  const isPaymentFailed =
    purchaseStatus === "FAILED" ||
    purchaseStatus === "CANCELED";

  const showPayButton = Boolean(
    ownedAgent &&
      (
        trialInfo?.isTrial ||
        trialInfo?.trialEnded ||
        purchaseStatus === "TRIALING" ||
        isPaymentFailed
      )
  );

  const showSetupButton = Boolean(
    ownedAgent && isPaid
  );

  const installedAgentStatus =
    (
      ownedAgent?.installedAgentStatus ??
      ""
    ).toUpperCase();

  const isSetupCompleted =
    Boolean(ownedAgent?.installedAgentId) &&
    (
      installedAgentStatus === "ACTIVE" ||
      installedAgentStatus === "PAUSED"
    );

  const canStartTrial =
    !ownedAgent &&
    pricingModel !== "FREE" &&
    freeTrialEnabled &&
    trialDays > 0;

  const hasActiveAccess =
    Boolean(ownedAgent);

  let primaryCtaHref: string =
    checkoutPath;

  let primaryCtaLabel: string;
  let primaryCtaTestId: string;

  if (showSetupButton) {
    primaryCtaHref = setupPath;
    primaryCtaLabel =
      isSetupCompleted
        ? "Edit Configuration"
        : "Set up agent";
    primaryCtaTestId =
      "owned-agent-detail-setup";
  } else if (showPayButton) {
    primaryCtaHref = checkoutPath;
    primaryCtaLabel =
      pricingModel === "ONE_TIME"
        ? `Buy now`
        : `Install Agent`;
    primaryCtaTestId =
      "owned-agent-detail-pay-now";
  } else {
    primaryCtaHref = checkoutPath;

    primaryCtaLabel =
      pricingModel === "FREE"
        ? "Install for Free"
        : canStartTrial
          ? `Start ${trialDays}-Day Free Trial`
          : pricingModel === "ONE_TIME"
            ? `Buy now`
            : `Install Agent`;

    primaryCtaTestId = canStartTrial
      ? "agent-detail-start-trial"
      : "agent-detail-get-agent";
  }

  const pricingSubtext =
    pricingModel === "FREE"
      ? "Free to install · Pay only for usage"
      : pricingModel === "ONE_TIME"
        ? "One-time purchase · Usage charges apply"
        : "Monthly subscription · Usage charges billed separately";

  const heroDescription = htmlDescriptionToText(
    listing.shortDescription?.trim() ||
      listing.tagline?.trim() ||
      ""
  );

  const howItWorksSteps =
    getHowItWorksSteps(
      listing.requiredConnectors,
      listing.workflow?.workflowJson
    );

  return (
    <AgentDescriptionView
      showFooter={false}
      listing={listing}
      listingId={listing.id}
      listingName={listing.name}
      iconUrl={
        listing.iconUrl?.trim() || null
      }
      category={industryLabel || category}
      statusLabel={
        ownedAgent
          ? "In your account"
          : "Ready to install"
      }
      showAuthor
      author={author}
      installsLabel={installsLabel}
      heroDescription={heroDescription}
      agentDescription={agentDescription}
      tags={categories}
      features={features}
      includedItems={includedItems}
      price={price}
      pricingModel={pricingModel}
      pricingSubtext={pricingSubtext}
      canStartTrial={canStartTrial}
      trialDays={trialDays}
      hasActiveAccess={hasActiveAccess}
      primaryCtaHref={primaryCtaHref}
      primaryCtaLabel={primaryCtaLabel}
      primaryCtaTestId={primaryCtaTestId}
      howItWorksSteps={howItWorksSteps}
      similar={similarListings}
      similarHref={(id) =>
        businessAgentDetailPath(id)
      }
      showDemo
      demoMode="authenticated"
      demoIndustry={industryLabel}
      demoSubindustry={listing.category ?? category}
      demoVideoUrl={
        listing.demoVideoUrl ?? null
      }
    />
  );
}