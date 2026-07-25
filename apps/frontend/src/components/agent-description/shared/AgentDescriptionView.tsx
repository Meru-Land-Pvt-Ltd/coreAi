"use client";

import type { Route } from "next";
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { AgentDemoCall } from "@/components/common/agent-demo-call";
import { AgentWorkflowPreview } from "@/components/business/agent-workflow-preview";
import { ExpandableText } from "@/components/common/expandable-text";
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
  background: rgba(245,158,11,0.18);
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
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-7px); }
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
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
`;

type PreviewListing = ComponentProps<typeof AgentWorkflowPreview>["listing"];

type HowItWorksStep = { step: number | string; title: string; description: string };

export type SimilarAgentItem = {
  id: string;
  name: string;
  iconUrl?: string | null;
  priceCents?: number | null;
  pricingModel?: string | null;
  shortDescription?: string;
};

export type AgentDescriptionViewProps = {
  /** Optional element rendered above the page (e.g. public branding header). */
  header?: ReactNode;
  /** Listing shape used by the phone preview + live demo. */
  listing: PreviewListing & { id: string; name: string };
  listingId: string;
  listingName: string;
  iconUrl: string | null;
  category: string;
  /** Small pill next to the category (e.g. "Ready to install" / "In your account"). */
  statusLabel: string;
  /** Public hides the author, business shows it. */
  showAuthor: boolean;
  author: string;
  /** Pre-formatted install count label (e.g. "12" or "1.2K"). */
  installsLabel: string;
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
  similarHref: (id: string) => Route | string;
  /** Whether to render the live demo widget in the hero card. */
  showDemo: boolean;
  /** Public = IP-limited 2×2min; authenticated = buyer route. */
  demoMode?: "public" | "authenticated";
  /** Optional YouTube or Loom demo video URL shown in the How It Works section. */
  demoVideoUrl?: string | null;
};

/** Parses a YouTube or Loom URL and returns an embed URL, or null if unrecognised. */
function getEmbedUrl(url: string): { embedUrl: string; provider: "youtube" | "loom" } | null {
  try {
    const u = new URL(url);

    // YouTube: youtube.com/watch?v=ID  |  youtu.be/ID  |  youtube.com/embed/ID
    const ytMatch =
      u.hostname.includes("youtube.com")
        ? (u.pathname.match(/\/embed\/([^/?&]+)/) ?? u.searchParams.get("v") ? [null, u.searchParams.get("v")] : null)
        : u.hostname === "youtu.be"
          ? u.pathname.match(/^\/([^/?&]+)/)
          : null;
    if (ytMatch?.[1]) {
      return { embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0`, provider: "youtube" };
    }

    // Loom: loom.com/share/ID
    if (u.hostname.includes("loom.com")) {
      const loomMatch = u.pathname.match(/\/share\/([^/?&]+)/);
      if (loomMatch?.[1]) {
        return { embedUrl: `https://www.loom.com/embed/${loomMatch[1]}?autoplay=1`, provider: "loom" };
      }
    }
  } catch {
    // malformed URL — silently skip
  }
  return null;
}

/** Click-to-play video embed — iframe is NOT loaded until the user clicks play, so page load is not affected. */
function VideoEmbed({ url, title }: { url: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  const parsed = getEmbedUrl(url);
  if (!parsed) return null;

  const { embedUrl, provider } = parsed;

  // YouTube thumbnail (hi-res, then fallback to medium)
  const ytThumbId = provider === "youtube" ? embedUrl.match(/embed\/([^?]+)/)?.[1] : null;
  const thumbSrc = ytThumbId
    ? `https://img.youtube.com/vi/${ytThumbId}/maxresdefault.jpg`
    : null;

  return (
    <div className="mt-8 mx-auto max-w-2xl overflow-hidden rounded-2xl border border-slate-200/90 bg-white sm:mt-10">
      {/* Single Line Header */}
      <div className="border-b border-amber-100 bg-amber-50/50 px-4 py-2.5 text-center">
        <span className="text-[13px] font-bold text-slate-800">
          🎬 Watch how this agent works for your business
        </span>
      </div>

      {/* Video area */}
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
            onClick={() => setPlaying(true)}
            aria-label={`Play demo video: ${title}`}
            className="group absolute inset-0 flex h-full w-full flex-col items-center justify-center"
          >
            {/* Thumbnail */}
            {thumbSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbSrc}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-80 transition group-hover:opacity-70"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.src.includes("maxresdefault")) {
                    img.src = img.src.replace("maxresdefault", "hqdefault");
                  }
                }}
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900" />
            )}

            {/* Overlay */}
            <div className="absolute inset-0 bg-slate-900/30 transition group-hover:bg-slate-900/40" />

            {/* Play button */}
            <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 ring-4 ring-white/20 transition duration-200 group-hover:scale-105 group-hover:bg-amber-400 sm:h-14 sm:w-14">
              <svg className="h-5 w-5 translate-x-0.5 text-white sm:h-6 sm:w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-[24px] font-bold tracking-tight text-slate-900 sm:text-[28px] md:text-[32px]" data-testid="business-protected-agents-title-heading-2">{title}</h2>
      {description ? <p className="mt-2.5 break-words text-[15px] leading-relaxed text-slate-600" data-testid="business-protected-agents-description-text">{description}</p> : null}
    </div>
  );
}

function SimilarAgentCard({ agent, href }: { agent: SimilarAgentItem; href: Route | string }) {
  const price = Math.round((agent.priceCents ?? 0) / 100);
  const pricingModel = agent.pricingModel ?? "SUBSCRIPTION";
  const iconUrl = agent.iconUrl?.trim() || null;

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
            <img src={iconUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            "🤖"
          )}
        </span>
        <h3 className="mt-4 truncate text-[15px] font-bold leading-tight tracking-tight text-slate-900">{agent.name}</h3>
        <div className="mt-1.5">
          {pricingModel === "FREE" ? (
            <span className="text-[13px] font-medium text-slate-500">Free</span>
          ) : (
            <span className="text-[14px] font-extrabold text-slate-900">
              ${price}
              {pricingModel === "SUBSCRIPTION" ? (
                <span className="font-medium text-slate-500">/mo</span>
              ) : null}
            </span>
          )}
        </div>
        {agent.shortDescription ? (
          <p className="mt-2 flex-1 text-[13px] leading-relaxed text-slate-600 line-clamp-2">{agent.shortDescription}</p>
        ) : null}

        <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-amber-600 transition hover:gap-2">
          View agent{" "}
          <ArrowIcon />
        </span>
      </div>
    </Link>
  );
}

export function AgentDescriptionView(props: AgentDescriptionViewProps) {
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

  // Strict limit of max 3 agents for "More agents businesses love"
  const displayedSimilar = similar.slice(0, 3);

  return (
    <>
      {header}
      <div className="agent-detail-root min-h-screen overflow-x-hidden bg-white text-slate-700">
        <style dangerouslySetInnerHTML={{ __html: AGENT_DESCRIPTION_STYLES }} />

        <main>
          {/* Hero Section */}
          <section className="relative px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-12">
            <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(50%_55%_at_50%_0%,rgba(245,158,11,0.06),transparent_70%)]" />

            <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-8 lg:grid-cols-5 lg:gap-10 xl:gap-12">
              {/* Left: Agent Info + CTA + Live Demo */}
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

                {/* Agent Title */}
                <div className="mt-4 flex items-start gap-3.5 sm:gap-4">
                  <div className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 ring-2 ring-amber-100 sm:h-14 sm:w-14">
                    {iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={iconUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <BotIcon className="h-6 w-6 text-white sm:h-7 sm:w-7" />
                    )}
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[32px] md:text-[36px]">
                      {listingName}
                    </h1>
                    <p className="mt-1.5 text-[13px] text-slate-600">
                      {showAuthor ? (
                        <>
                          by <span className="font-semibold text-slate-800">{author}</span>
                          <span className="mx-1.5 text-slate-300">·</span>
                        </>
                      ) : null}
                      <span className="font-semibold text-slate-900">{installsLabel}</span> businesses installed
                    </p>
                  </div>
                </div>

                {/* Short Description */}
                {heroDescription ? (
                  <p className="mt-4 max-w-xl break-words text-[15px] leading-relaxed text-slate-700 sm:text-[16px]">{heroDescription}</p>
                ) : (
                  agentDescription && (
                    <ExpandableText
                      text={agentDescription}
                      className="mt-4 max-w-xl break-words text-[15px] leading-relaxed text-slate-700 sm:text-[16px]"
                    />
                  )
                )}

                {heroDescription && agentDescription ? (
                  <ExpandableText
                    text={agentDescription}
                    className="mt-3 break-words text-[13.5px] leading-relaxed text-slate-600"
                  />
                ) : null}

                {/* Industry Tags */}
                {tags.length > 0 ? (
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50/70 px-3 py-1 text-[12.5px] font-medium text-slate-700"
                        data-testid="business-agent-detail-industry-tag"
                      >
                        <span className="text-amber-600">🏷️</span>
                        <span className="truncate">{tag}</span>
                      </span>
                    ))}
                  </div>
                ) : null}

                {/* Pricing & Primary Action Card */}
                <div className="shadow-subtle mt-7 rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6">
                  {canStartTrial && trialDays > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200/90 bg-amber-50/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800" data-testid="business-protected-agents-0-for-the-first-7-days-text">
                      ⚡ $0 for the first {trialDays} days
                    </span>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-baseline gap-2">
                    {pricingModel === "FREE" ? (
                      <span className="text-[32px] font-extrabold tracking-tight text-slate-900 sm:text-[36px]">Free</span>
                    ) : (
                      <>
                        <span className="text-[32px] font-extrabold tracking-tight text-slate-900 sm:text-[36px]">${price}</span>
                        {pricingModel === "SUBSCRIPTION" ? (
                          <span className="text-[15px] font-medium text-slate-500">/month</span>
                        ) : pricingModel === "ONE_TIME" ? (
                          <span className="text-[15px] font-medium text-slate-500">one-time</span>
                        ) : null}
                      </>
                    )}
                  </div>

                  <p className="mt-1 text-[12.5px] text-slate-600" data-testid="business-protected-agents-per-business-location-billed-after-your-free-text">
                    {pricingSubtext}
                  </p>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <Link
                      id="hero-cta"
                      href={primaryCtaHref as Route}
                      data-testid={primaryCtaTestId}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-[14px] font-semibold text-slate-950 transition duration-200 hover:bg-amber-400 active:bg-amber-600 sm:px-6 sm:py-3.5 sm:text-[15px]"
                    >
                      {primaryCtaLabel}
                      <ArrowIcon />
                    </Link>
                  </div>

                  {canStartTrial && trialDays > 0 ? (
                    <p className="mt-3 text-[12.5px] text-slate-500">
                      No credit card required. ${price}{pricingModel === "ONE_TIME" ? " one-time purchase" : "/month subscription"} after trial.
                    </p>
                  ) : null}

                  {/* Prominent Live Demo callout */}
                  {showDemo && !hasActiveAccess ? (
                    <div className="mt-5 border-t border-slate-100 pt-5">
                      <AgentDemoCall listingId={listingId} listingName={listingName} mode={demoMode} />
                    </div>
                  ) : null}
                </div>

                {/* Trial Benefits */}
                {canStartTrial && trialDays > 0 ? (
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                    {[`${trialDays}-day free trial`, "Cancel anytime", "Setup in 2 minutes", "Money-back guarantee"].map((item) => (
                      <span key={item} data-testid={`agent-detail-trial-benefit-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="inline-flex items-center gap-1.5 text-[13px] text-slate-700">
                        <CheckIcon className="h-4 w-4 text-emerald-600" />
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                    {["Install in minutes", "Works with your tools", "Cancel anytime"].map((item) => (
                      <span key={item} className="inline-flex items-center gap-1.5 text-[13px] text-slate-700">
                        <CheckIcon className="h-4 w-4 text-emerald-600" />
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: Agent Phone Workflow Preview (Sticky Floating) */}
              <div
                id="demo"
                className="flex min-w-0 scroll-mt-24 flex-col items-center lg:sticky lg:top-24 lg:col-span-2 lg:items-end lg:pt-1 self-start"
              >
                <div className="animate-subtle-float w-full flex justify-center lg:justify-end">
                  <AgentWorkflowPreview listing={listing} />
                </div>
              </div>
            </div>
          </section>

          {/* How It Works Section */}
          <section className="border-t border-slate-100 bg-amber-50/30 px-4 py-12 sm:px-6 sm:py-16">
            <div className="mx-auto max-w-6xl">
              <SectionHeader
                title="How It Works"
                description="From setup to live phone calls & texts, get value in minutes without developer help."
              />

              <div className="relative mt-10 sm:mt-12">
                <div className="absolute top-7 hidden border-t border-dashed border-amber-300 md:block" style={{ left: "16.66%", right: "16.66%" }}></div>
                <div className="relative grid gap-8 md:grid-cols-3 md:gap-10">
                  {howItWorksSteps.map((step) => (
                    <div key={step.step} className="text-center">
                      <div className="relative z-10 mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 text-[15px] font-bold text-slate-950 ring-4 ring-white">
                        {step.step}
                      </div>
                      <h3 className="mt-5 text-[16px] font-bold text-slate-900">{step.title}</h3>
                      <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">{step.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Demo video — click-to-play, zero load cost until clicked */}
              {demoVideoUrl ? (
                <VideoEmbed url={demoVideoUrl} title={`${listingName} video demonstration`} />
              ) : null}
            </div>
          </section>

          {/* Key Metrics Section */}
          <section className="px-4 py-12 sm:px-6 sm:py-16">
            <div id="metrics" className="mx-auto grid max-w-2xl gap-4 sm:grid-cols-2 sm:gap-5">
              <div className="shadow-subtle rounded-2xl border border-slate-200/80 bg-white p-5 text-center sm:p-6">
                <div className="text-[28px] font-extrabold tracking-tight text-amber-600 sm:text-[32px]">5 sec</div>
                <div className="mt-1.5 text-[13.5px] font-medium text-slate-700">Average response time</div>
                <div className="mt-1 text-[12px] text-slate-500">Instant customer attention day & night</div>
              </div>
              <div className="shadow-subtle rounded-2xl border border-slate-200/80 bg-white p-5 text-center sm:p-6">
                <div className="text-[28px] font-extrabold tracking-tight text-amber-600 sm:text-[32px]">24/7</div>
                <div className="mt-1.5 text-[13.5px] font-medium text-slate-700">Always active coverage</div>
                <div className="mt-1 text-[12px] text-slate-500">Never miss a lead or booking call</div>
              </div>
            </div>
          </section>

          {/* What this agent does */}
          <section className="border-t border-slate-100 bg-amber-50/30 px-4 py-12 sm:px-6 sm:py-16">
            <div className="mx-auto max-w-6xl">
              <SectionHeader
                title="Built for your business outcomes"
                description={heroDescription || "Key capabilities this agent delivers to grow your business."}
              />

              <div className="mt-8 grid gap-3.5 sm:grid-cols-2 sm:gap-4">
                {features.map((feature) => (
                  <div
                    key={feature}
                    className="shadow-subtle flex items-start gap-3.5 rounded-2xl border border-slate-200/80 bg-white p-4.5 transition duration-200 hover:border-amber-400 sm:p-5"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100/70 text-amber-700">
                      ⚡
                    </span>
                    <p className="min-w-0 break-words pt-1.5 text-[14px] font-medium leading-relaxed text-slate-800" data-testid="business-protected-agents-feature-text">{feature}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* What's included */}
          <section className="px-4 py-12 sm:px-6 sm:py-16">
            <div className="mx-auto max-w-3xl">
              <SectionHeader
                title="What's included"
                description="Everything bundled with this agent is pre-configured and ready for your business."
              />

              <div className="shadow-subtle mt-8 overflow-hidden rounded-2xl border border-slate-200/90 bg-white sm:mt-10">
                <ul className="divide-y divide-slate-100">
                  {includedItems.map((rawItem) => {
                    const item = rawItem.replace(/\s*—\s*/g, " ");
                    return (
                      <li key={rawItem} data-testid={`agent-detail-included-item-${rawItem.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                        <CheckIcon className="h-5 w-5 shrink-0 text-emerald-600" />
                        <span className="min-w-0 break-words text-[14px] text-slate-700" data-testid={`agent-detail-included-text-${rawItem.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{item}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </section>

          {/* Similar Agents - Strictly max 3 agents */}
          {displayedSimilar.length > 0 ? (
            <section className="border-t border-slate-100 bg-amber-50/30 px-4 py-12 sm:px-6 sm:py-16">
              <div className="mx-auto max-w-6xl">
                <SectionHeader
                  title="More agents businesses love"
                  description="Recommended agents to expand your automated customer service."
                />

                <div className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
                  {displayedSimilar.map((agent) => (
                    <SimilarAgentCard key={agent.id} agent={agent} href={similarHref(agent.id)} />
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {/* Bottom CTA */}
          <section id="bottom-cta" className="scroll-mt-24 px-4 py-12 sm:px-6 sm:py-16">
            <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-amber-200/90 bg-gradient-to-b from-amber-50/90 to-amber-100/40 px-5 py-10 text-center sm:px-12 sm:py-14">
              <h2 className="text-balance text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[28px] md:text-[32px]">
                Ready to put {listingName} to work?
              </h2>
              <p className="mx-auto mt-3.5 max-w-xl text-[15px] leading-relaxed text-slate-700">
                Set up in minutes. Automate call handling, SMS follow-ups, and appointment scheduling automatically.
              </p>
              <div className="mt-8">
                <Link
                  href={primaryCtaHref as Route}
                  data-testid={hasActiveAccess ? "agent-detail-bottom-manage-agent" : canStartTrial ? "agent-detail-bottom-start-trial" : "agent-detail-bottom-pay-now"}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-[15px] font-semibold text-slate-950 transition duration-200 hover:bg-amber-400 active:bg-amber-600 sm:w-auto sm:px-9 sm:py-4 sm:text-[16px]"
                >
                  {primaryCtaLabel}
                  <ArrowIcon className="h-5 w-5" />
                </Link>
              </div>
              {canStartTrial && trialDays > 0 ? (
                <p className="mt-5 text-[13px] text-slate-600">
                  No credit card required to start. ${price}{pricingModel === "ONE_TIME" ? " one-time" : "/month"} after trial.
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
