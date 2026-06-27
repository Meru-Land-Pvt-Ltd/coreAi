"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { BUSINESS_MARKETPLACE_PATH, businessCheckoutPath } from "@/lib/routes";

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
  priceCents?: number | null;
  status?: string;
  tags?: string[];
  requiredConnectors?: string[];
  supportedLlms?: string[];
  createdAt?: string;
  updatedAt?: string;
  architect?: ApiArchitect | null;
  workflow?: ApiWorkflow | null;
};

type ListingApiResponse = {
  listing?: ApiListing;
};

function formatLabel(value: string) {
  return value
    .replace(/^category:|^industry:/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getListingCategory(listing: ApiListing) {
  const tags = listing.tags ?? [];
  const categoryTag =
    tags.find((tag) => tag.toLowerCase().startsWith("category:")) ??
    tags.find((tag) => !tag.toLowerCase().startsWith("industry:"));

  if (categoryTag) return formatLabel(categoryTag);
  if (listing.workflow?.name) return "Workflow";
  return "AI Agent";
}

function getListingIndustry(listing: ApiListing) {
  const tags = listing.tags ?? [];
  const industryTag = tags.find((tag) => tag.toLowerCase().startsWith("industry:"));

  if (!industryTag) return "All industries";
  return formatLabel(industryTag);
}

function getWorkflowFeatures(listing: ApiListing) {
  const nodes = listing.workflow?.workflowJson?.nodes ?? [];

  const fromNodes = nodes
    .map((node) => node.data?.label || node.data?.title)
    .filter((value): value is string => Boolean(value?.trim()));

  if (fromNodes.length) return fromNodes;

  const connectors = listing.requiredConnectors ?? [];
  if (connectors.length) {
    return connectors.map((connector) => `Integrates with ${connector}`);
  }

  return [
    listing.shortDescription ||
      listing.description ||
      listing.workflow?.description ||
      "Automates business workflows with AI."
  ];
}

function getIncludedItems(listing: ApiListing) {
  const items = [
    ...(listing.requiredConnectors ?? []).map((connector) => `${connector} integration`),
    ...(listing.supportedLlms ?? []).map((llm) => `${llm} support`),
    "Real-time workflow automation",
    "Business-specific configuration"
  ];

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

function PhoneMockup({ agentName }: { agentName: string }) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[3rem] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(245,158,11,0.12),transparent_70%)]" />

      <div className="mx-auto w-full max-w-[320px] animate-float">
        <div className="rounded-[2.5rem] border border-gray-200 bg-white p-2.5 shadow-2xl">
          <div className="overflow-hidden rounded-[2rem] bg-gray-50">
            <div className="flex items-center justify-between px-5 pb-1 pt-3 text-[10px] font-semibold text-slate-500">
              <span>9:41</span>
              <span className="inline-flex items-center gap-1" aria-hidden="true">
                5G
              </span>
            </div>

            <div className="flex items-center gap-2 border-b border-gray-100 bg-white px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700">
                AI
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900">{agentName}</div>
                <div className="text-[10px] text-slate-500">Text Message · SMS</div>
              </div>
            </div>

            <div className="space-y-3 px-4 py-4">
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
                  <PhoneIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900">Missed call</div>
                  <div className="truncate text-[11px] text-slate-500">{agentName} · just now</div>
                </div>
              </div>

              <div className="flex">
                <div className="max-w-[82%] rounded-2xl rounded-bl-md border border-gray-100 bg-white px-3 py-2 text-[12px] leading-snug text-slate-700 shadow-sm">
                  Hi! Sorry we missed your call. How can we help you today?
                </div>
              </div>

              <div className="flex justify-end">
                <div className="max-w-[82%] rounded-2xl rounded-br-md bg-amber-500 px-3 py-2 text-[12px] font-medium leading-snug text-slate-950 shadow-sm">
                  I need to book an appointment
                </div>
              </div>

              <div className="flex">
                <div className="max-w-[86%] rounded-2xl rounded-bl-md border border-gray-100 bg-white px-3 py-2 text-[12px] leading-snug text-slate-700 shadow-sm">
                  I&apos;d be happy to help! Here are our available slots this week.
                </div>
              </div>

              <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Automated by CORE · replied in 5s
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BusinessAgentDetailPage() {
  const params = useParams<{ agentId: string }>();
  const agentId = params.agentId;

  const [listing, setListing] = useState<ApiListing | null>(null);
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

        const response = await apiGet<ListingApiResponse>(`/architect/listings/${agentId}`);
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
  const industry = useMemo(() => (listing ? getListingIndustry(listing) : ""), [listing]);
  const features = useMemo(() => (listing ? getWorkflowFeatures(listing) : []), [listing]);
  const includedItems = useMemo(() => (listing ? getIncludedItems(listing) : []), [listing]);

  const price = listing ? Math.round((listing.priceCents ?? 0) / 100) : 0;
  const rating = listing?.architect?.architectProfile?.rating ?? 0;
  const installs = listing?.architect?.architectProfile?.completedJobs ?? 0;
  const author =
    listing?.architect?.fullName ||
    listing?.architect?.architectProfile?.title ||
    listing?.architect?.email ||
    "Core AI Architect";

  const description =
    listing?.shortDescription ||
    listing?.description ||
    listing?.workflow?.description ||
    "";

  const checkoutPath = listing ? businessCheckoutPath(listing.id) : "#";

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
        <div className="mx-auto max-w-6xl animate-pulse space-y-6">
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
        <div className="mx-auto max-w-xl rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
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
        <nav className="mx-auto max-w-6xl px-6 py-3 text-sm" aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-slate-500">
            <li>
              <Link href={BUSINESS_MARKETPLACE_PATH} className="transition hover:text-amber-600">
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
        <section className="relative px-6 pb-16 pt-12">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(55%_60%_at_50%_0%,rgba(245,158,11,0.08),rgba(255,255,255,0)_72%)]" />

          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-5 lg:items-start">
            <div className="order-2 lg:order-1 lg:col-span-3">
              <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500 shadow-glow">
                <PhoneIcon className="h-8 w-8 text-slate-950" />
                <span className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-amber-400 ring-2 ring-white">
                  ⚡
                </span>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                  {listing.name}
                </h1>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                  {category}
                </span>
              </div>

              <p className="mt-4 max-w-xl text-lg leading-relaxed text-slate-600">{description}</p>

              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="inline-flex items-center gap-2">
                  <div className="flex gap-0.5 text-amber-400" aria-label={`Rated ${rating} out of 5`}>
                    {Array.from({ length: 5 }).map((_, index) => (
                      <StarIcon key={index} />
                    ))}
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{rating.toFixed(1)}</span>
                  <span className="text-sm text-slate-500">({installs} installs)</span>
                </div>

                <div className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <span className="text-amber-500">🏷️</span>
                  <span>{industry}</span>
                </div>
              </div>

              <div className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600">
                Built by{" "}
                <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                  {author} <span className="text-amber-500">✓</span>
                </span>
              </div>

              <div className="mt-7 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-700">
                  ⚡ $0 for the first 7 days
                </span>

                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold tracking-tight text-slate-900">${price}</span>
                  <span className="text-lg font-medium text-slate-500">/month</span>
                </div>

                <p className="mt-0.5 text-xs text-slate-500">
                  per business location · billed after your free trial
                </p>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <Link
                    ref={heroCtaRef}
                    id="hero-cta"
                    href={checkoutPath}
                    data-testid="agent-detail-start-trial"
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-base font-semibold text-slate-950 shadow-glow transition duration-200 hover:scale-[1.02] hover:bg-amber-400"
                  >
                    Start 7-Day Free Trial
                    <ArrowIcon />
                  </Link>

                  <button
                    type="button"
                    onClick={() => setDemoOpen(true)}
                    data-testid="agent-detail-watch-demo"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-6 py-3.5 text-base font-semibold text-slate-700 transition duration-200 hover:border-amber-400 hover:text-amber-600"
                  >
                    ▶ Watch Demo
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-500">
                  No credit card required to start. ${price}/month after trial.
                </p>
              </div>

              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                {["7-day free trial", "Cancel anytime", "Setup in 2 minutes", "30-day money-back after conversion"].map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                    <CheckIcon className="h-4 w-4 text-emerald-500" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div ref={demoRef} id="demo" className="order-1 scroll-mt-24 lg:order-2 lg:col-span-2">
              <PhoneMockup agentName={listing.name} />
            </div>
          </div>
        </section>

        <section className="bg-gray-50 px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
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
                  <p className="pt-1.5 text-slate-700">{feature}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <SectionHeader title="What's included" description="One flat price. No usage caps on anything that matters." />

            <div className="mt-10 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <ul className="divide-y divide-gray-100">
                {includedItems.map((item) => (
                  <li key={item} className="flex items-center gap-3 px-6 py-3.5">
                    <CheckIcon className="h-5 w-5 shrink-0 text-emerald-500" />
                    <span className="text-slate-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setTechOpen((current) => !current)}
                aria-expanded={techOpen}
                data-testid="agent-detail-tech-toggle"
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              >
                <span className="text-lg font-semibold text-slate-900">Technical Details</span>
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
                <dl className="grid gap-x-8 gap-y-5 border-t border-gray-100 py-6 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Connectors used</dt>
                    <dd className="mt-1 text-slate-700">
                      {(listing.requiredConnectors ?? []).length
                        ? listing.requiredConnectors?.join(", ")
                        : "Configured during setup"}
                    </dd>
                  </div>
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
                href={checkoutPath}
                data-testid="agent-detail-bottom-start-trial"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-9 py-4 text-lg font-semibold text-slate-950 shadow-glow-lg transition duration-200 hover:scale-[1.03] hover:bg-amber-400"
              >
                Start 7-Day Free Trial
                <ArrowIcon className="h-5 w-5" />
              </Link>
            </div>
            <p className="mt-5 text-sm text-slate-500">
              No credit card required. ${price}/month after trial.
            </p>
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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
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

            <h2 id="demo-title" className="mt-5 text-2xl font-bold tracking-tight text-slate-900">
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
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {description ? <p className="mt-3 text-lg text-slate-600">{description}</p> : null}
    </div>
  );
}
