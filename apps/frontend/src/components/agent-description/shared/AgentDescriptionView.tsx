"use client";

import type { Route } from "next";
import type {
  ComponentProps,
  ReactNode
} from "react";
import {
  useEffect,
  useState
} from "react";
import Link from "next/link";
import { AgentDemoCall } from "@/components/common/agent-demo-call";
import { AgentWorkflowPreview } from "@/components/business/agent-workflow-preview";
import { CoreFooter } from "@/components/common/footer";

export const AGENT_DESCRIPTION_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

.agent-detail-root {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background-color: #ffffff;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

.agent-detail-root ::selection {
  background: rgba(245, 158, 11, 0.18);
  color: #0f172a;
}

.agent-detail-root :focus-visible {
  outline: 2px solid #f59e0b;
  outline-offset: 2px;
  border-radius: 6px;
}

.shadow-subtle {
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
}

@keyframes subtleFloat {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-7px);
  }
}

.animate-subtle-float {
  animation: subtleFloat 5s ease-in-out infinite;
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}

.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
`;

type PreviewListing =
  ComponentProps<
    typeof AgentWorkflowPreview
  >["listing"];

type HowItWorksStep = {
  step: number | string;
  title: string;
  description: string;
};

export type SimilarAgentItem = {
  id: string;
  name: string;
  iconUrl?: string | null;
  priceCents?: number | null;
  pricingModel?: string | null;
  shortDescription?: string;
};

export type AgentDescriptionViewProps = {
  header?: ReactNode;

  listing: PreviewListing & {
    id: string;
    name: string;
  };

  listingId: string;
  listingName: string;
  iconUrl: string | null;
  category: string;
  statusLabel: string;
  showAuthor: boolean;
  author: string;
  installsLabel?: string | null;
  heroDescription: string;

  agentDescription: string;

  tags: string[];
  features: string[];
  includedItems: string[];
  price: number;
  pricingModel: string;
  pricingSubtext: string;
  canStartTrial: boolean;
  trialDays: number;
  hasActiveAccess: boolean;
  primaryCtaHref: Route | string;
  primaryCtaLabel: string;
  primaryCtaTestId: string;
  howItWorksSteps: HowItWorksStep[];
  similar: SimilarAgentItem[];
  similarHref: (
    id: string
  ) => Route | string;
  showDemo: boolean;
  demoMode?:
    | "public"
    | "authenticated";
  demoVideoUrl?: string | null;
};

function getEmbedUrl(
  url: string
): {
  embedUrl: string;
  provider: "youtube" | "loom";
} | null {
  try {
    const parsedUrl = new URL(url);

    let youtubeId: string | null = null;

    if (
      parsedUrl.hostname.includes(
        "youtube.com"
      )
    ) {
      const embedMatch =
        parsedUrl.pathname.match(
          /\/embed\/([^/?&]+)/
        );

      youtubeId =
        embedMatch?.[1] ??
        parsedUrl.searchParams.get("v");
    } else if (
      parsedUrl.hostname === "youtu.be"
    ) {
      youtubeId =
        parsedUrl.pathname.match(
          /^\/([^/?&]+)/
        )?.[1] ?? null;
    }

    if (youtubeId) {
      return {
        embedUrl:
          `https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0`,
        provider: "youtube"
      };
    }

    if (
      parsedUrl.hostname.includes(
        "loom.com"
      )
    ) {
      const loomId =
        parsedUrl.pathname.match(
          /\/share\/([^/?&]+)/
        )?.[1];

      if (loomId) {
        return {
          embedUrl:
            `https://www.loom.com/embed/${loomId}?autoplay=1`,
          provider: "loom"
        };
      }
    }
  } catch {
    // Invalid demo URLs are ignored.
  }

  return null;
}

function VideoEmbed({
  url,
  title
}: {
  url: string;
  title: string;
}) {
  const [playing, setPlaying] =
    useState(false);

  const parsed = getEmbedUrl(url);

  if (!parsed) {
    return null;
  }

  const {
    embedUrl,
    provider
  } = parsed;

  const youtubeThumbnailId =
    provider === "youtube"
      ? embedUrl.match(
          /embed\/([^?]+)/
        )?.[1]
      : null;

  const thumbnailSource =
    youtubeThumbnailId
      ? `https://img.youtube.com/vi/${youtubeThumbnailId}/maxresdefault.jpg`
      : null;

  return (
    <div className="mx-auto mt-8 max-w-2xl overflow-hidden rounded-2xl border border-slate-200/90 bg-white sm:mt-10">
      <div className="border-b border-amber-100 bg-amber-50/50 px-4 py-2.5 text-center">
        <span className="text-[13px] font-bold text-slate-800">
          Watch how this agent works for
          your business
        </span>
      </div>

      <div className="relative aspect-video w-full bg-slate-900">
        {playing ? (
          <iframe
            src={embedUrl}
            title={title}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
            loading="lazy"
          />
        ) : (
          <button
            type="button"
            onClick={() =>
              setPlaying(true)
            }
            aria-label={`Play demo video: ${title}`}
            className="group absolute inset-0 flex h-full w-full flex-col items-center justify-center"
          >
            {thumbnailSource ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailSource}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-80 transition group-hover:opacity-70"
                onError={(event) => {
                  const image =
                    event.currentTarget;

                  if (
                    image.src.includes(
                      "maxresdefault"
                    )
                  ) {
                    image.src =
                      image.src.replace(
                        "maxresdefault",
                        "hqdefault"
                      );
                  }
                }}
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900" />
            )}

            <div className="absolute inset-0 bg-slate-900/30 transition group-hover:bg-slate-900/40" />

            <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 ring-4 ring-white/20 transition duration-200 group-hover:scale-105 group-hover:bg-amber-400 sm:h-14 sm:w-14">
              <svg
                className="h-5 w-5 translate-x-0.5 text-white sm:h-6 sm:w-6"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5.14v14l11-7-11-7z" />
              </svg>
            </div>

            <span className="relative mt-3 rounded-full bg-white/10 px-3.5 py-1 text-[12px] font-semibold text-white backdrop-blur-sm">
              Click to watch walkthrough
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function ArrowIcon({
  className = "h-4 w-4"
}: {
  className?: string;
}) {
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

function CheckIcon({
  className = "h-5 w-5"
}: {
  className?: string;
}) {
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

function BotIcon({
  className = "h-8 w-8"
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="11"
        width="18"
        height="10"
        rx="2"
      />
      <path d="M12 11V7" />
      <circle
        cx="12"
        cy="5"
        r="2"
      />
      <path
        d="M8 15h0M16 15h0"
        strokeWidth="2.5"
      />
    </svg>
  );
}

function SectionHeader({
  title,
  description
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2
        className="text-[24px] font-bold tracking-tight text-slate-900 sm:text-[28px] md:text-[32px]"
        data-testid="business-protected-agents-title-heading-2"
      >
        {title}
      </h2>

      {description ? (
        <p
          className="mt-2.5 break-words text-[15px] leading-relaxed text-slate-600"
          data-testid="business-protected-agents-description-text"
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

function SimilarAgentCard({
  agent,
  href
}: {
  agent: SimilarAgentItem;
  href: Route | string;
}) {
  const price = Math.round(
    (agent.priceCents ?? 0) / 100
  );

  const pricingModel =
    agent.pricingModel ??
    "SUBSCRIPTION";

  const iconUrl =
    agent.iconUrl?.trim() || null;

  return (
    <Link
      href={href as Route}
      data-testid={`similar-agent-card-${agent.id}`}
      className="block h-full min-w-0"
    >
      <div className="shadow-subtle flex h-full w-full min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white p-5 transition duration-200 hover:border-amber-400 sm:p-6">
        <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-xl text-white">
          {iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={iconUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <BotIcon className="h-6 w-6" />
          )}
        </span>

        <h3 className="mt-4 truncate text-[15px] font-bold leading-tight tracking-tight text-slate-900">
          {agent.name}
        </h3>

        <div className="mt-1.5">
          {pricingModel === "FREE" ? (
            <span className="text-[13px] font-medium text-slate-500">
              Free
            </span>
          ) : (
            <span className="text-[14px] font-extrabold text-slate-900">
              ${price}

              {pricingModel ===
              "SUBSCRIPTION" ? (
                <span className="font-medium text-slate-500">
                  /mo
                </span>
              ) : null}
            </span>
          )}
        </div>

        {agent.shortDescription ? (
          <p className="mt-2 line-clamp-2 flex-1 text-[13px] leading-relaxed text-slate-600">
            {agent.shortDescription}
          </p>
        ) : null}

        <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-amber-600 transition hover:gap-2">
          View agent
          <ArrowIcon />
        </span>
      </div>
    </Link>
  );
}

export function AgentDescriptionView(
  props: AgentDescriptionViewProps
) {
  const {
    header,
    listing,
    listingId,
    listingName,
    iconUrl,
    category,
    statusLabel,
    showAuthor,
    author,
    installsLabel,
    heroDescription,
    agentDescription,
    tags,
    features,
    includedItems,
    price,
    pricingModel,
    pricingSubtext,
    canStartTrial,
    trialDays,
    hasActiveAccess,
    primaryCtaHref,
    primaryCtaLabel,
    primaryCtaTestId,
    howItWorksSteps,
    similar,
    similarHref,
    showDemo,
    demoMode = "public",
    demoVideoUrl
  } = props;

  const [showFullDescription, setShowFullDescription] =
    useState(false);

  useEffect(() => {
    setShowFullDescription(false);
  }, [listingId]);

  const displayedSimilar =
    similar.slice(0, 3);

  const shortDescription =
    heroDescription.trim();

  const fullDescription =
    agentDescription.trim();

  const revealedDescription =
    fullDescription.length > 0
      ? fullDescription
      : shortDescription;

  const hasFullDescription =
    revealedDescription.length > 0;

  return (
    <>
      {header}

      <div className="agent-detail-root min-h-screen overflow-x-hidden bg-white text-slate-700">
        <style
          dangerouslySetInnerHTML={{
            __html:
              AGENT_DESCRIPTION_STYLES
          }}
        />

        <main>
          <section className="relative px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-12">
            <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(50%_55%_at_50%_0%,rgba(245,158,11,0.06),transparent_70%)]" />

            <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-8 lg:grid-cols-5 lg:gap-10 xl:gap-12">
              <div className="min-w-0 lg:col-span-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-700">
                    {category || "AI Agent"}
                  </span>

                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
                    {statusLabel}
                  </span>

                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Verified Voice Agent
                  </span>
                </div>

                <div className="mt-4 flex items-start gap-3.5 sm:gap-4">
                  <div className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 sm:h-14 sm:w-14">
                    {iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={iconUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <BotIcon className="h-6 w-6 text-slate-700 sm:h-7 sm:w-7" />
                    )}
                  </div>

                  <div className="min-w-0 pt-0.5">
                    <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[32px] md:text-[36px]">
                      {listingName}
                    </h1>

                    {showAuthor ||
                    installsLabel ? (
                      <p className="mt-1.5 text-[13px] text-slate-600">
                        {showAuthor ? (
                          <>
                            by{" "}
                            <span className="font-semibold text-slate-800">
                              {author}
                            </span>
                          </>
                        ) : null}

                        {showAuthor &&
                        installsLabel ? (
                          <span className="mx-1.5 text-slate-300">
                            ·
                          </span>
                        ) : null}

                        {installsLabel ? (
                          <>
                            <span className="font-semibold text-slate-900">
                              {installsLabel}
                            </span>{" "}
                            businesses installed
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </div>

                {hasFullDescription ? (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() =>
                        setShowFullDescription(
                          (current) =>
                            !current
                        )
                      }
                      aria-expanded={
                        showFullDescription
                      }
                      aria-controls="agent-full-description"
                      data-testid="agent-detail-view-more-description"
                      className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-amber-600 transition hover:text-amber-700"
                    >
                      {showFullDescription
                        ? "Hide description"
                        : "View full description"}

                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className={`h-4 w-4 transition-transform ${
                          showFullDescription
                            ? "rotate-180"
                            : ""
                        }`}
                        aria-hidden="true"
                      >
                        <path
                          d="M5 7.5l5 5 5-5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>

                    {showFullDescription ? (
                      <div
                        id="agent-full-description"
                        data-testid="agent-detail-full-description"
                        className="mt-3 max-w-xl rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                      >
                        <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-slate-700">
                          {revealedDescription}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {tags.length > 0 ? (
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50/70 px-3 py-1 text-[12.5px] font-medium text-slate-700"
                        data-testid="business-agent-detail-industry-tag"
                      >
                        <span className="text-amber-600">
                          🏷️
                        </span>

                        <span className="truncate">
                          {tag}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="shadow-subtle mt-7 rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6">
                  {canStartTrial &&
                  trialDays > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200/90 bg-amber-50/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800">
                      $0 for the first{" "}
                      {trialDays} days
                    </span>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-baseline gap-2">
                    {pricingModel ===
                    "FREE" ? (
                      <span className="text-[32px] font-extrabold tracking-tight text-slate-900 sm:text-[36px]">
                        Free
                      </span>
                    ) : (
                      <>
                        <span className="text-[32px] font-extrabold tracking-tight text-slate-900 sm:text-[36px]">
                          ${price}
                        </span>

                        {pricingModel ===
                        "SUBSCRIPTION" ? (
                          <span className="text-[15px] font-medium text-slate-500">
                            /month
                          </span>
                        ) : pricingModel ===
                          "ONE_TIME" ? (
                          <span className="text-[15px] font-medium text-slate-500">
                            one-time
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>

                  <p className="mt-1 text-[12.5px] text-slate-600">
                    {pricingSubtext}
                  </p>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <Link
                      id="hero-cta"
                      href={
                        primaryCtaHref as Route
                      }
                      data-testid={
                        primaryCtaTestId
                      }
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-[14px] font-semibold text-slate-950 transition duration-200 hover:bg-amber-400 active:bg-amber-600 sm:px-6 sm:py-3.5 sm:text-[15px]"
                    >
                      {primaryCtaLabel}
                      <ArrowIcon />
                    </Link>
                  </div>

                  {canStartTrial &&
                  trialDays > 0 ? (
                    <p className="mt-3 text-[12.5px] text-slate-500">
                      No credit card required.
                      ${price}
                      {pricingModel ===
                      "ONE_TIME"
                        ? " one-time purchase"
                        : "/month subscription"}{" "}
                      after trial.
                    </p>
                  ) : null}

                  {showDemo &&
                  !hasActiveAccess ? (
                    <div className="mt-5 border-t border-slate-100 pt-5">
                      <AgentDemoCall
                        listingId={listingId}
                        listingName={
                          listingName
                        }
                        mode={demoMode}
                      />
                    </div>
                  ) : null}
                </div>

                {canStartTrial &&
                trialDays > 0 ? (
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                    {[
                      `${trialDays}-day free trial`,
                      "Guided setup",
                      "Cancel anytime"
                    ].map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center gap-1.5 text-[13px] text-slate-700"
                      >
                        <CheckIcon className="h-4 w-4 text-emerald-600" />
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                    {[
                      "Guided setup",
                      "Works with your configured tools",
                      "Manage from your account"
                    ].map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center gap-1.5 text-[13px] text-slate-700"
                      >
                        <CheckIcon className="h-4 w-4 text-emerald-600" />
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div
                id="demo"
                className="flex min-w-0 scroll-mt-24 flex-col items-center self-start lg:sticky lg:top-24 lg:col-span-2 lg:items-end lg:pt-1"
              >
                <div className="animate-subtle-float flex w-full justify-center lg:justify-end">
                  <AgentWorkflowPreview
                    listing={listing}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="border-t border-slate-100 bg-amber-50/30 px-4 py-12 sm:px-6 sm:py-16">
            <div className="mx-auto max-w-6xl">
              <SectionHeader
                title="How It Works"
                description="Connect your business information and tools, then activate the agent from your account."
              />

              <div className="relative mt-10 sm:mt-12">
                <div
                  className="absolute top-7 hidden border-t border-dashed border-amber-300 md:block"
                  style={{
                    left: "16.66%",
                    right: "16.66%"
                  }}
                />

                <div className="relative grid gap-8 md:grid-cols-3 md:gap-10">
                  {howItWorksSteps.map(
                    (step) => (
                      <div
                        key={step.step}
                        className="text-center"
                      >
                        <div className="relative z-10 mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 text-[15px] font-bold text-slate-950 ring-4 ring-white">
                          {step.step}
                        </div>

                        <h3 className="mt-5 text-[16px] font-bold text-slate-900">
                          {step.title}
                        </h3>

                        <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">
                          {step.description}
                        </p>
                      </div>
                    )
                  )}
                </div>
              </div>

              {demoVideoUrl ? (
                <VideoEmbed
                  url={demoVideoUrl}
                  title={`${listingName} video demonstration`}
                />
              ) : null}
            </div>
          </section>

          <section className="border-t border-slate-100 bg-white px-4 py-12 sm:px-6 sm:py-16">
            <div className="mx-auto max-w-6xl">
              <SectionHeader
                title="Built for your business outcomes"
                description={
                  shortDescription ||
                  "Review the capabilities included with this agent."
                }
              />

              <div className="mt-8 grid gap-3.5 sm:grid-cols-2 sm:gap-4">
                {features.map(
                  (feature) => (
                    <div
                      key={feature}
                      className="shadow-subtle flex items-start gap-3.5 rounded-2xl border border-slate-200/80 bg-white p-4 transition duration-200 hover:border-amber-400 sm:p-5"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100/70 text-amber-700">
                        ⚡
                      </span>

                      <p className="min-w-0 break-words pt-1.5 text-[14px] font-medium leading-relaxed text-slate-800">
                        {feature}
                      </p>
                    </div>
                  )
                )}
              </div>
            </div>
          </section>

          <section className="border-t border-slate-100 px-4 py-12 sm:px-6 sm:py-16">
            <div className="mx-auto max-w-3xl">
              <SectionHeader
                title="What's included"
                description="Review the features and tools bundled with this agent."
              />

              <div className="shadow-subtle mt-8 overflow-hidden rounded-2xl border border-slate-200/90 bg-white sm:mt-10">
                <ul className="divide-y divide-slate-100">
                  {includedItems.map(
                    (rawItem) => {
                      const item =
                        rawItem.replace(
                          /\s*—\s*/g,
                          " "
                        );

                      return (
                        <li
                          key={rawItem}
                          className="flex items-center gap-3 px-5 py-3.5 sm:px-6"
                        >
                          <CheckIcon className="h-5 w-5 shrink-0 text-emerald-600" />

                          <span className="min-w-0 break-words text-[14px] text-slate-700">
                            {item}
                          </span>
                        </li>
                      );
                    }
                  )}
                </ul>
              </div>
            </div>
          </section>

          {displayedSimilar.length > 0 ? (
            <section className="border-t border-slate-100 bg-amber-50/30 px-4 py-12 sm:px-6 sm:py-16">
              <div className="mx-auto max-w-6xl">
                <SectionHeader
                  title="More agents businesses love"
                  description="Explore other available agents."
                />

                <div className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
                  {displayedSimilar.map(
                    (agent) => (
                      <SimilarAgentCard
                        key={agent.id}
                        agent={agent}
                        href={similarHref(
                          agent.id
                        )}
                      />
                    )
                  )}
                </div>
              </div>
            </section>
          ) : null}

          <section
            id="bottom-cta"
            className="scroll-mt-24 px-4 py-12 sm:px-6 sm:py-16"
          >
            <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-amber-200/90 bg-gradient-to-b from-amber-50/90 to-amber-100/40 px-5 py-10 text-center sm:px-12 sm:py-14">
              <h2 className="text-balance text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[28px] md:text-[32px]">
                Ready to put{" "}
                {listingName} to work?
              </h2>

              <p className="mx-auto mt-3.5 max-w-xl text-[15px] leading-relaxed text-slate-700">
                Complete the guided setup,
                connect the required tools,
                and manage the agent from your
                account.
              </p>

              <div className="mt-8">
                <Link
                  href={
                    primaryCtaHref as Route
                  }
                  data-testid={
                    hasActiveAccess
                      ? "agent-detail-bottom-manage-agent"
                      : canStartTrial
                        ? "agent-detail-bottom-start-trial"
                        : "agent-detail-bottom-pay-now"
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-[15px] font-semibold text-slate-950 transition duration-200 hover:bg-amber-400 active:bg-amber-600 sm:w-auto sm:px-9 sm:py-4 sm:text-[16px]"
                >
                  {primaryCtaLabel}
                  <ArrowIcon className="h-5 w-5" />
                </Link>
              </div>

              {canStartTrial &&
              trialDays > 0 ? (
                <p className="mt-5 text-[13px] text-slate-600">
                  No credit card required
                  to start. ${price}
                  {pricingModel ===
                  "ONE_TIME"
                    ? " one-time"
                    : "/month"}{" "}
                  after trial.
                </p>
              ) : null}
            </div>
          </section>
        </main>

        <CoreFooter />
      </div>
    </>
  );
}