"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CoreFooter } from "@/components/common/footer";
import { apiPost } from "@/lib/api";
import { ASSIGNMENT_PATH } from "@/lib/routes";

type Agent = {
  id: string;
  name: string;
  category: string;
  industry: string;
  description: string;
  price: number;
  installs: number;
  rating: number;
  author: string;
  isNew?: boolean;
  freeTrial?: boolean;
  createdAt?: string;
};

type ApiArchitectProfile = {
  title?: string | null;
  bio?: string | null;
  portfolioUrl?: string | null;
  skills?: string[];
  hourlyRateCents?: number | null;
  rating?: number | null;
  completedJobs?: number | null;
};

type ApiArchitect = {
  id?: string;
  fullName?: string | null;
  email?: string | null;
  architectProfile?: ApiArchitectProfile | null;
};

type ApiWorkflow = {
  id?: string;
  name?: string;
  description?: string | null;
  isTemplate?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type ApiListing = {
  id: string;
  architectUserId?: string;
  workflowId?: string | null;
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

type ListingsApiResponse = {
  success?: boolean;
  message?: string;
  data?: {
    listings?: ApiListing[];
  };
  listings?: ApiListing[];
};

type Industry = {
  id: string;
  label: string;
  count: number;
  icon: string;
};

const LISTINGS_API_PATH = "/architect/listings/completed";

const baseIndustries: Omit<Industry, "count">[] = [
  { id: "all", label: "All industries", icon: "✨" },
  { id: "dental", label: "Dental", icon: "🦷" },
  { id: "hvac", label: "HVAC & Plumbing", icon: "🔧" },
  { id: "realestate", label: "Real Estate", icon: "🏠" },
  { id: "legal", label: "Legal", icon: "⚖️" },
  { id: "medical", label: "Medical & Wellness", icon: "❤️" },
  { id: "automotive", label: "Automotive", icon: "🚗" },
  { id: "ecommerce", label: "E-commerce", icon: "🛍️" }
];

function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function formatLabel(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getAgentIndustry(listing: ApiListing) {
  const tags = listing.tags ?? [];

  const industryTag =
    tags.find((tag) => tag.toLowerCase().startsWith("industry:")) ??
    tags.find((tag) =>
      [
        "dental",
        "hvac",
        "plumbing",
        "real estate",
        "legal",
        "medical",
        "wellness",
        "automotive",
        "ecommerce",
        "e-commerce"
      ].includes(tag.toLowerCase())
    );

  if (!industryTag) return "all";

  return normalizeFilterValue(industryTag.replace(/^industry:/i, ""));
}

function getAgentCategory(listing: ApiListing) {
  const tags = listing.tags ?? [];

  const categoryTag =
    tags.find((tag) => tag.toLowerCase().startsWith("category:")) ??
    tags.find((tag) => !tag.toLowerCase().startsWith("industry:"));

  if (categoryTag) {
    return formatLabel(categoryTag.replace(/^category:/i, ""));
  }

  if (listing.workflow?.name) {
    return "Workflow";
  }

  return "AI Agent";
}

function isRecentlyCreated(createdAt?: string) {
  if (!createdAt) return false;

  const createdTime = new Date(createdAt).getTime();

  if (Number.isNaN(createdTime)) return false;

  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  return Date.now() - createdTime <= thirtyDays;
}

function mapListingToAgent(listing: ApiListing): Agent {
  const profile = listing.architect?.architectProfile;

  return {
    id: listing.id,
    name: listing.name,
    category: getAgentCategory(listing),
    industry: getAgentIndustry(listing),
    description:
      listing.shortDescription ||
      listing.description ||
      listing.workflow?.description ||
      "This AI agent is ready to help automate business workflows.",
    price: Math.round((listing.priceCents ?? 0) / 100),
    installs: profile?.completedJobs ?? 0,
    rating: profile?.rating ?? 0,
    author:
      listing.architect?.fullName ||
      profile?.title ||
      listing.architect?.email ||
      "Core Architect",
    isNew: isRecentlyCreated(listing.createdAt),
    freeTrial: (listing.priceCents ?? 0) === 0,
    createdAt: listing.createdAt
  };
}

function getIndustryAgentCount(industryId: string, agents: Agent[]) {
  if (industryId === "all") return agents.length;
  return agents.filter(
    (agent) => agent.industry === industryId || agent.industry === "all"
  ).length;
}

function isIndustryAvailable(id: string, agents: Agent[]) {
  if (id === "all") return true;
  return getIndustryAgentCount(id, agents) > 0;
}

function buildIndustriesWithCounts(agents: Agent[]): Industry[] {
  return baseIndustries.map((item) => ({
    ...item,
    count: getIndustryAgentCount(item.id, agents)
  }));
}

const sortOptions = [
  { value: "popular", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
  { value: "priceLow", label: "Price: low to high" },
  { value: "priceHigh", label: "Price: high to low" },
  { value: "newest", label: "Newest" }
] as const;

const TRIVEN_LOGO_SRC = "/triven.ai word logo transparent bg.PNG";

const HOME_PATH = "/" as Route;
const BUSINESS_LOGIN_PATH = "/business/login" as Route;
const BUSINESS_SETUP_PATH = "/business/agents/setup" as Route;
const ARCHITECT_LOGIN_PATH = "/architect/login" as Route;

type SortValue = (typeof sortOptions)[number]["value"];

export default function MarketplacePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [query, setQuery] = useState("");
  const [industry, setIndustry] = useState("all");
  const [sort, setSort] = useState<SortValue>("popular");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [freeTrialOnly, setFreeTrialOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [openFilter, setOpenFilter] = useState<"industry" | "price" | "rating" | "sort" | null>(null);
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(200);
  const [minRating, setMinRating] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadListings() {
      try {
        setIsLoading(true);
        setApiError("");

        const response = (await apiPost(LISTINGS_API_PATH, {})) as ListingsApiResponse;

        const listings = response?.data?.listings ?? response?.listings ?? [];

        if (!mounted) return;

        setAgents(listings.map(mapListingToAgent));
      } catch (error) {
        console.error(error);

        if (!mounted) return;

        setApiError(
          error instanceof Error
            ? error.message
            : "Could not load marketplace agents"
        );
        setAgents([]);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadListings();

    return () => {
      mounted = false;
    };
  }, []);

  const industries = useMemo(() => buildIndustriesWithCounts(agents), [agents]);
  const featuredAgent = agents[0] ?? null;

  const filteredAgents = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();

    const filtered = agents.filter((agent) => {
      const matchesQuery =
        !cleanQuery ||
        `${agent.name} ${agent.category} ${agent.description}`
          .toLowerCase()
          .includes(cleanQuery);

      const matchesIndustry =
        industry === "all" ||
        agent.industry === industry ||
        agent.industry === "all";

      const matchesPrice = agent.price >= priceMin && agent.price <= priceMax;
      const matchesRating = agent.rating >= minRating;
      const matchesTrial = !freeTrialOnly || agent.freeTrial;
      const matchesNew = !newOnly || agent.isNew;

      return (
        matchesQuery &&
        matchesIndustry &&
        matchesPrice &&
        matchesRating &&
        matchesTrial &&
        matchesNew
      );
    });

    return filtered.sort((a, b) => {
      if (sort === "rating") return b.rating - a.rating;
      if (sort === "priceLow") return a.price - b.price;
      if (sort === "priceHigh") return b.price - a.price;
      if (sort === "newest") {
        return (
          new Date(b.createdAt ?? 0).getTime() -
          new Date(a.createdAt ?? 0).getTime()
        );
      }
      return b.installs - a.installs;
    });
  }, [agents, query, industry, priceMin, priceMax, minRating, sort, freeTrialOnly, newOnly]);


  const industryLabel =
    industries.find((item) => item.id === industry)?.label ?? "All industries";

  const sortLabel =
    sortOptions.find((item) => item.value === sort)?.label ?? "Most popular";

  const priceActive = priceMin !== 0 || priceMax !== 200;
  const ratingActive = minRating > 0;

  const activeFilters = [
    query.trim()
      ? {
        key: "query",
        label: `"${query.trim()}"`
      }
      : null,
    industry !== "all"
      ? {
        key: "industry",
        label: industryLabel
      }
      : null,
    priceActive
      ? {
        key: "price",
        label: priceMax >= 200 ? `$${priceMin}+` : `$${priceMin}–$${priceMax}`
      }
      : null,
    ratingActive
      ? {
        key: "rating",
        label: `${minRating}.0+ ★`
      }
      : null,
    freeTrialOnly
      ? {
        key: "free",
        label: "Free trial"
      }
      : null,
    newOnly
      ? {
        key: "new",
        label: "New this month"
      }
      : null
  ].filter(Boolean) as { key: string; label: string }[];

  function clearFilter(key: string) {
    if (key === "query") setQuery("");
    if (key === "industry") setIndustry("all");
    if (key === "price") {
      setPriceMin(0);
      setPriceMax(200);
    }
    if (key === "rating") setMinRating(0);
    if (key === "free") setFreeTrialOnly(false);
    if (key === "new") setNewOnly(false);
  }

  function clearAllFilters() {
    setQuery("");
    setIndustry("all");
    setPriceMin(0);
    setPriceMax(200);
    setMinRating(0);
    setFreeTrialOnly(false);
    setNewOnly(false);
    setOpenFilter(null);
  }

  useEffect(() => {
    if (!openFilter) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const trigger = document.querySelector(`[data-filter-trigger="${openFilter}"]`);
      const panel = document.querySelector(`[data-filter-panel="${openFilter}"]`);

      if (trigger?.contains(target) || panel?.contains(target)) return;

      setOpenFilter(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenFilter(null);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openFilter]);

  useEffect(() => {
    if (!selectedAgent) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedAgent(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [selectedAgent]);

  function openDetailsModal(agent: Agent) {
    setSelectedAgent(agent);
  }

  return (
    <main data-testid="app-marketplace-page-main-1" className="min-h-screen bg-white text-slate-900">
      <nav data-testid="app-marketplace-page-nav-1" className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 shadow-sm backdrop-blur">
        <div data-testid="app-marketplace-page-div-1" className="w-full max-w-none px-4 sm:px-6 lg:px-8">
          <div data-testid="app-marketplace-page-div-2" className="flex items-center gap-3 py-3">
            <a href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Triven home">
              <Image
                src={TRIVEN_LOGO_SRC}
                alt="Triven logo"
                width={36}
                height={36}
                priority
                className="h-9 w-9 object-contain"
              />
              <span className="text-xl font-extrabold tracking-tight text-amber-500">
                Triven.ai
              </span>
            </a>

            <div data-testid="app-marketplace-page-div-3" className="hidden min-w-0 flex-1 justify-center px-4 md:flex lg:px-8">
              <div data-testid="app-marketplace-page-div-4" className="relative w-full max-w-2xl">
                <span data-testid="app-marketplace-page-span-3" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  🔍
                </span>
                <input data-testid="marketplace-search-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search agents by name, industry, or problem..."
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-11 pr-4 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-amber-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-amber-100"
                />
              </div>
            </div>

            <div data-testid="app-marketplace-page-div-5" className="ml-auto flex shrink-0 items-center gap-2">
              <Link data-testid="app-marketplace-page-link-2"
                href={ARCHITECT_LOGIN_PATH}
                className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 sm:block"
              >
                For Architects
              </Link>
              <Link data-testid="marketplace-log-in-link"
                href={BUSINESS_LOGIN_PATH}
                className="rounded-xl border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-600 transition hover:bg-amber-50"
              >
                Log in
              </Link>
              <Link data-testid="marketplace-get-started-link"
                href={ASSIGNMENT_PATH}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-amber-500/30 transition hover:bg-amber-600"
              >
                Get started
              </Link>
            </div>
          </div>

          <div data-testid="app-marketplace-page-div-3-mobile" className="pb-3 md:hidden">
            <div data-testid="app-marketplace-page-div-4-mobile" className="relative w-full">
              <span data-testid="app-marketplace-page-span-3-mobile" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                🔍
              </span>
              <input data-testid="app-marketplace-page-input-1-mobile"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search agents by name, industry, or problem..."
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-11 pr-4 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-amber-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-amber-100"
              />
            </div>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden bg-gradient-to-br from-amber-50 via-white to-orange-50">
        <div className="pointer-events-none absolute -left-24 top-8 h-72 w-72 rounded-full bg-amber-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-orange-200/30 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/70 px-3.5 py-1.5 text-xs font-semibold text-amber-700" data-testid="marketplace-new-agents-added-every-week-text">
              ✨ New agents added every week
            </span>

            <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl" data-testid="marketplace-ai-agents-that-work-while-you-sleep-heading">
              AI Agents That Work
              <br className="hidden sm:block" /> While You Sleep
            </h1>

            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600 sm:text-xl" data-testid="marketplace-browse-pre-built-ai-agents-install-in-text">
              Browse pre-built AI agents. Install in minutes. No code required.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              <Metric label="Agents" value="Verified" />
              <Metric label="Businesses" value="2,400+" />
              <Metric label="Average rating" value="4.9 ⭐" />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-slate-900" data-testid="marketplace-browse-by-industry-heading">
              Browse by industry
            </h2>
            <p className="mt-2 text-slate-600" data-testid="marketplace-find-agents-built-specifically-for-your-business-text">
              Find agents built specifically for your business type.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {industries
              .filter((item) => item.id !== "all")
              .map((item) => {
                const hasAgents = item.count > 0;

                return (
                  <button data-testid="marketplace-industry-card"
                    key={item.id}
                    type="button"
                    disabled={!hasAgents}
                    onClick={() => {
                      if (!hasAgents) return;
                      setIndustry(item.id);
                    }}
                    className={`group relative rounded-2xl border bg-white p-6 text-center shadow-sm transition-all duration-300 ${hasAgents
                      ? `hover:-translate-y-1 hover:border-amber-200 hover:shadow-lg ${industry === item.id
                        ? "border-amber-300 ring-4 ring-amber-100"
                        : "border-gray-100"
                      }`
                      : "cursor-not-allowed border-gray-100 opacity-70"
                      }`}
                  >
                    <span
                      data-testid="app-marketplace-page-span-14"
                      className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl transition ${hasAgents
                        ? "bg-amber-50 group-hover:scale-105 group-hover:bg-amber-500"
                        : "bg-slate-100 grayscale"
                        }`}
                     data-testid="marketplace-icon-text">
                      {item.icon}
                    </span>

                    <p className="mt-3 font-semibold text-slate-900" data-testid="marketplace-label-text">
                      {item.label}
                    </p>

                    <p data-testid="app-marketplace-page-p-7" className="text-sm text-slate-500">
                      {hasAgents ? `${item.count} agents` : "Coming soon"}
                    </p>
                  </button>
                );
              })}
          </div>
        </div>

        {featuredAgent ? (
        <div data-testid="app-marketplace-page-div-11" className="relative mx-auto mt-12 max-w-5xl">
          <div data-testid="app-marketplace-page-div-12" className="absolute inset-x-8 bottom-2 h-24 rounded-full bg-amber-400/30 blur-2xl" />

          <div className="relative grid items-center gap-8 overflow-hidden rounded-3xl border border-amber-100 bg-white p-7 shadow-[0_30px_80px_-28px_rgba(245,158,11,.55)] sm:p-9 md:grid-cols-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white" data-testid="marketplace-featured-text">
                  ⭐ Featured
                </span>
                <span data-testid="app-marketplace-page-span-6" className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                  {featuredAgent.category}
                </span>
              </div>

              <h2 data-testid="app-marketplace-page-h2-1" className="mt-4 text-3xl font-extrabold text-slate-900">
                {featuredAgent.name}
              </h2>

              <p data-testid="app-marketplace-page-p-2" className="mt-3 text-slate-600">
                {featuredAgent.description}
              </p>

              <div data-testid="app-marketplace-page-div-16" className="mt-5 flex flex-wrap items-center gap-3">
                <span data-testid="app-marketplace-page-span-7" className="text-2xl font-black text-slate-900">
                  ${featuredAgent.price}
                </span>
                <span data-testid="app-marketplace-page-span-8" className="text-sm text-slate-500">one-time</span>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link data-testid="marketplace-start-free-trial-link"
                  href={BUSINESS_SETUP_PATH}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600"
                >
                  Start free trial
                </Link>
              </div>
            </div>

            <div className="flex justify-center md:justify-end">
              <div className="relative w-[240px] rotate-3 rounded-[2.4rem] border-[10px] border-slate-900 bg-slate-900 shadow-2xl">
                <div className="overflow-hidden rounded-[1.7rem] bg-slate-50">
                  <div className="flex items-center gap-2.5 bg-white px-4 pb-3 pt-6">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-500 text-[11px] font-bold text-white" data-testid="marketplace-bs-text">
                      BS
                    </span>
                    <div>
                      <p className="text-[13px] font-semibold text-slate-900" data-testid="marketplace-bright-smile-dental-text">
                        Bright Smile Dental
                      </p>
                      <p className="text-[10px] text-emerald-500" data-testid="marketplace-active-now-text">
                        ● Active now
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2.5 px-3 py-4 text-[12px] leading-snug">
                    <div className="mx-auto w-fit rounded-full bg-slate-200/70 px-3 py-1 text-[10px] text-slate-500">
                      Missed call · 9:42 AM
                    </div>
                    <Message mine>
                      Hi! Sorry we missed your call. How can we help?
                    </Message>
                    <Message>
                      Do you have openings this week for a cleaning?
                    </Message>
                    <Message mine>
                      Yes! Thursday 2:00 PM or Friday 10:30 AM.
                    </Message>
                  </div>

                  <div className="flex items-center gap-2 border-t border-gray-100 bg-white px-3 py-2.5">
                    <div className="flex-1 rounded-full bg-gray-100 px-3 py-1.5 text-[11px] text-slate-400">
                      Text message…
                    </div>
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-500 text-white">
                      ➤
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        ) : null}
      </section>

      <section className="sticky top-[73px] z-[70] overflow-visible border-y border-gray-100 bg-white/95 backdrop-blur transition-shadow">
        <div className="w-full max-w-none px-4 sm:px-6 lg:px-8">
          <div className="relative flex flex-wrap items-center gap-3 overflow-visible py-3">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenFilter(openFilter === "industry" ? null : "industry")}
                  data-testid="marketplace-filter-industry"
                  data-filter-trigger="industry"
                  className={filterPillClass(industry !== "all")}
                  aria-haspopup="true"
                  aria-expanded={openFilter === "industry"}
                >
                  <span data-testid="marketplace-industry-label-text">{industryLabel}</span>
                  <ChevronIcon open={openFilter === "industry"} />
                </button>

                {openFilter === "industry" ? (
                  <div
                    data-filter-panel="industry"
                    className="absolute left-0 top-full z-[90] mt-2 w-64 rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]"
                  >
                    {industries.map((item) => {
                      const unlocked = isIndustryAvailable(item.id, agents);

                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={!unlocked}
                          data-testid={`marketplace-industry-option-${item.id}`}
                          onClick={() => {
                            if (!unlocked) return;
                            setIndustry(item.id);
                            setOpenFilter(null);
                          }}
                          className={
                            unlocked
                              ? popoverOptionClass(industry === item.id)
                              : "flex w-full cursor-not-allowed items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-400 opacity-70"
                          }
                        >
                          <span data-testid="marketplace-label-text-2">{item.label}</span>

                          <span className="text-xs text-slate-400" data-testid="marketplace-unlocked-count-coming-soon-text">
                            {unlocked ? item.count : "Coming soon"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenFilter(openFilter === "price" ? null : "price")}
                  data-testid="marketplace-filter-price"
                  data-filter-trigger="price"
                  className={filterPillClass(priceActive)}
                  aria-haspopup="true"
                  aria-expanded={openFilter === "price"}
                >
                  <span data-testid="marketplace-price-active-price-max-200-price-min-text">
                    {priceActive
                      ? priceMax >= 200
                        ? `$${priceMin}+`
                        : `$${priceMin}–$${priceMax}`
                      : "Price range"}
                  </span>
                  <ChevronIcon open={openFilter === "price"} />
                </button>

                {openFilter === "price" ? (
                  <div
                    data-filter-panel="price"
                    className="absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl border border-slate-100 bg-white p-3 shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]"
                  >
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="text-sm font-semibold text-slate-700" data-testid="marketplace-price-range-text">Price range</span>
                      <button
                        type="button"
                        onClick={() => {
                          setPriceMin(0);
                          setPriceMax(200);
                        }}
                        data-testid="marketplace-price-reset"
                        className="text-xs font-medium text-amber-600 transition hover:text-amber-700"
                      >
                        Reset
                      </button>
                    </div>

                    <div className="mb-2 flex items-center justify-between px-1 text-sm text-slate-600">
                      <span data-testid="marketplace-price-min-text">${priceMin}</span>
                      <span data-testid="marketplace-price-max-200-any-price-max-text">{priceMax >= 200 ? "Any" : `$${priceMax}`}</span>
                    </div>

                    <div className="relative h-9 px-1">
                      <div className="absolute left-1 right-1 top-4 h-1 rounded-full bg-slate-200" />
                      <div
                        className="absolute top-4 h-1 rounded-full bg-amber-500"
                        style={{
                          left: `${(priceMin / 200) * 100}%`,
                          width: `${((priceMax - priceMin) / 200) * 100}%`
                        }}
                      />

                      <input data-testid="marketplace-minimum-price-input"
                        type="range"
                        min={0}
                        max={200}
                        step={10}
                        value={priceMin}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setPriceMin(Math.min(value, priceMax));
                        }}
                        className="pointer-events-none absolute left-0 top-2 h-5 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
                        aria-label="Minimum price"
                      />

                      <input data-testid="marketplace-maximum-price-input"
                        type="range"
                        min={0}
                        max={200}
                        step={10}
                        value={priceMax}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setPriceMax(Math.max(value, priceMin));
                        }}
                        className="pointer-events-none absolute left-0 top-2 h-5 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
                        aria-label="Maximum price"
                      />
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {[
                        { label: "Under $80", min: 0, max: 80 },
                        { label: "$80–120", min: 80, max: 120 },
                        { label: "$120+", min: 120, max: 200 }
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setPriceMin(preset.min);
                            setPriceMax(preset.max);
                          }}
                          data-testid={`marketplace-price-preset-${preset.min}-${preset.max}`}
                          className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:border-amber-300 hover:text-amber-600"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenFilter(openFilter === "rating" ? null : "rating")}
                  data-testid="marketplace-filter-rating"
                  data-filter-trigger="rating"
                  className={filterPillClass(ratingActive)}
                  aria-haspopup="true"
                  aria-expanded={openFilter === "rating"}
                >
                  <span data-testid="marketplace-rating-active-min-rating-0-rating-text">{ratingActive ? `${minRating}.0+ ★` : "Rating"}</span>
                  <ChevronIcon open={openFilter === "rating"} />
                </button>

                {openFilter === "rating" ? (
                  <div
                    data-filter-panel="rating"
                    className="absolute left-0 top-full z-50 mt-2 w-60 rounded-2xl border border-slate-100 bg-white p-3 shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]"
                  >
                    <p className="px-1 pb-2 text-sm font-semibold text-slate-700" data-testid="marketplace-minimum-rating-text">
                      Minimum rating
                    </p>

                    <div className="flex items-center gap-1 px-1 py-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => {
                            setMinRating(star);
                            setOpenFilter(null);
                          }}
                          data-testid={`marketplace-rating-star-${star}`}
                          className={star <= minRating ? "text-amber-400" : "text-gray-300"}
                          aria-label={`${star} stars and up`}
                        >
                          <StarIcon className="h-6 w-6" />
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setMinRating(0);
                        setOpenFilter(null);
                      }}
                      data-testid="marketplace-rating-any"
                      className={popoverOptionClass(minRating === 0)}
                    >
                      Any rating
                    </button>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setFreeTrialOnly((current) => !current)}
                data-testid="marketplace-filter-free-trial"
                className={filterPillClass(freeTrialOnly)}
              >
                Free trial
              </button>

              <button
                type="button"
                onClick={() => setNewOnly((current) => !current)}
                data-testid="marketplace-filter-new"
                className={filterPillClass(newOnly)}
              >
                New this month
              </button>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-gray-200 p-0.5">
                <button
                  type="button"
                  onClick={() => setView("grid")}
                  data-testid="marketplace-view-grid"
                  className={viewButtonClass(view === "grid")}
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                >
                  <GridIcon />
                </button>

                <button
                  type="button"
                  onClick={() => setView("list")}
                  data-testid="marketplace-view-list"
                  className={viewButtonClass(view === "list")}
                  aria-label="List view"
                  aria-pressed={view === "list"}
                >
                  <ListIcon />
                </button>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenFilter(openFilter === "sort" ? null : "sort")}
                  data-testid="marketplace-filter-sort"
                  data-filter-trigger="sort"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:border-amber-300 hover:text-slate-900"
                  aria-haspopup="true"
                  aria-expanded={openFilter === "sort"}
                >
                  Sort:
                  <span className="font-semibold text-slate-800" data-testid="marketplace-sort-label-text">{sortLabel}</span>
                  <ChevronIcon open={openFilter === "sort"} />
                </button>

                {openFilter === "sort" ? (
                  <div
                    data-filter-panel="sort"
                    className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]"
                  >
                    {sortOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          setSort(item.value);
                          setOpenFilter(null);
                        }}
                        data-testid={`marketplace-sort-option-${item.value}`}
                        className={popoverOptionClass(sort === item.value)}
                      >
                        <span data-testid="marketplace-label-text-3">{item.label}</span>
                        {sort === item.value ? <CheckIcon /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {activeFilters.length ? (
            <div className="flex flex-wrap items-center gap-2 pb-3">
              <span className="text-xs font-medium text-slate-400" data-testid="marketplace-filters-text">Filters:</span>

              {activeFilters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => clearFilter(filter.key)}
                  data-testid={`marketplace-active-filter-${filter.key}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
                >
                  {filter.label}
                  <XIcon />
                </button>
              ))}

              <button
                type="button"
                onClick={clearAllFilters}
                data-testid="marketplace-clear-all-filters"
                className="text-xs font-semibold text-slate-500 underline-offset-2 transition hover:text-amber-600 hover:underline"
              >
                Clear all
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section data-testid="app-marketplace-page-section-4" className="bg-gray-50 py-12">
        <div data-testid="app-marketplace-page-div-33" className="w-full max-w-none px-4 sm:px-6 lg:px-8">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="h-72 animate-pulse rounded-2xl border border-gray-100 bg-white shadow-sm"
                />
              ))}
            </div>
          ) : apiError ? (
            <div data-testid="app-marketplace-page-div-35" className="rounded-2xl border border-red-100 bg-white py-16 text-center">
              <div data-testid="app-marketplace-page-div-36" className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-2xl">
                ⚠️
              </div>
              <h3 data-testid="app-marketplace-page-h3-1" className="mt-4 text-lg font-semibold text-slate-900">
                Could not load marketplace agents
              </h3>
              <p data-testid="app-marketplace-page-p-8" className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                {apiError}
              </p>
            </div>
          ) : filteredAgents.length ? (
            <div data-testid="app-marketplace-page-div-34"
              className={
                view === "grid"
                  ? "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
                  : "flex flex-col gap-4"
              }
            >
              {filteredAgents.map((agent) =>
                view === "grid" ? (
                  <AgentGridCard
                    key={agent.id}
                    agent={agent}
                    onViewDetails={() => openDetailsModal(agent)}
                  />
                ) : (
                  <AgentListCard
                    key={agent.id}
                    agent={agent}
                    onViewDetails={() => openDetailsModal(agent)}
                  />
                )
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl">
                🔍
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900" data-testid="marketplace-no-agents-match-those-filters-heading">
                No agents match those filters
              </h3>
              <p className="mt-1 text-sm text-slate-500" data-testid="marketplace-try-clearing-search-or-selecting-another-industry-text">
                Try clearing search or selecting another industry.
              </p>
              <button data-testid="marketplace-clear-filters-button"
                onClick={() => {
                  setQuery("");
                  setIndustry("all");
                  setFreeTrialOnly(false);
                  setNewOnly(false);
                }}
                className="mt-5 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
              >
                Clear filters
              </button>
            </div>
          )}

          {!isLoading && !apiError ? (
            <p data-testid="app-marketplace-page-p-9" className="mt-8 text-center text-sm text-slate-400">
              Showing {filteredAgents.length} of {agents.length} agents
            </p>
          ) : null}
        </div>
      </section>

      <section className="border-t border-gray-100 bg-white py-16">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl">
            ✨
          </div>
          <h2 className="text-3xl font-bold text-slate-900" data-testid="marketplace-not-sure-which-agent-is-right-heading">
            Not sure which agent is right?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-600" data-testid="marketplace-take-a-free-2-minute-assessment-and-text">
            Take a free 2-minute assessment and get a personalized
            recommendation built around your business.
          </p>
          <Link data-testid="marketplace-get-your-free-ai-score-link"
            href={BUSINESS_LOGIN_PATH}
            className="mx-auto mt-7 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600"
          >
            Get your free AI score →
          </Link>
        </div>
      </section>

      <section data-testid="app-marketplace-page-section-6" className="bg-slate-900 py-8">
        <div data-testid="app-marketplace-page-div-39" className="w-full max-w-none px-4 sm:px-6 lg:px-8">
          <div data-testid="app-marketplace-page-div-40" className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-white/80">
            <TrustItem text="256-bit encryption" />
            <TrustItem text="99.9% uptime" />
            <TrustItem text="SOC 2 compliant" />
            <TrustItem text="30-day money back" />
            <TrustItem text="24/7 support" />
          </div>
        </div>
      </section>

      <CoreFooter />
      {selectedAgent ? (
        <AgentDetailsModal
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-bold text-slate-900" data-testid={`marketplace-metric-value-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{value}</span>
      <span className="text-slate-500" data-testid="marketplace-label-text-4">{label}</span>
    </div>
  );
}

function Message({
  children,
  mine
}: {
  children: React.ReactNode;
  mine?: boolean;
}) {
  return (
    <div
      className={`max-w-[82%] rounded-2xl px-3 py-2 shadow-sm ${mine
        ? "ml-auto rounded-br-md bg-amber-500 text-white"
        : "mr-auto rounded-bl-md bg-white text-slate-700"
        }`}
    >
      {children}
    </div>
  );
}

function AgentGridCard({
  agent,
  onViewDetails
}: {
  agent: Agent;
  onViewDetails: () => void;
}) {
  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
    >
      <div className="flex-1 p-6">
        <div className="flex items-start justify-between">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-50 text-xl ring-1 ring-amber-100">
            🤖
          </span>

          <span className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white" data-testid="marketplace-agent-price-text">
            ${agent.price}
          </span>
        </div>

        <h3 className="mt-4 flex items-center gap-2 text-lg font-bold text-slate-900" data-testid="marketplace-agent-is-new-heading">
          {agent.name}
          {agent.isNew ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700" data-testid="marketplace-new-text">
              New
            </span>
          ) : null}
        </h3>

        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-slate-600" data-testid="marketplace-agent-category-text">
            {agent.category}
          </span>

          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700" data-testid="marketplace-agent-industry-all-industries-agent-industry-text">
            {agent.industry === "all" ? "All industries" : agent.industry}
          </span>
        </div>

        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600" data-testid="marketplace-agent-description-text">
          {agent.description}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-50 bg-gray-50/60 px-6 py-3">
        <span className="text-xs text-slate-500" data-testid="marketplace-agent-installs-text">
          {agent.installs} installs
        </span>
        <span data-testid="app-marketplace-page-span-29" className="truncate text-xs text-slate-500">
          Triven Team
        </span>
      </div>

      <div className="px-6 pb-6 pt-4">
        <button data-testid="marketplace-agent-open-grid"
          type="button"
          onClick={onViewDetails}
          className="w-full rounded-xl border-2 border-amber-500 py-2.5 font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white"
        >
          Open
        </button>
      </div>
    </article>
  );
}

function AgentListCard({
  agent,
  onViewDetails
}: {
  agent: Agent;
  onViewDetails: () => void;
}) {
  return (
    <article className="group flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg sm:flex-row sm:items-center">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-amber-50 text-xl ring-1 ring-amber-100">
        🤖
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-slate-900" data-testid="marketplace-agent-heading">{agent.name}</h3>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600" data-testid="marketplace-agent-category-text-2">
            {agent.category}
          </span>
          {agent.isNew ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-amber-700" data-testid="marketplace-new-text-2">
              New
            </span>
          ) : null}
        </div>

        <p className="mt-1.5 line-clamp-2 text-sm text-slate-600" data-testid="marketplace-agent-description-text-2">
          {agent.description}
        </p>

        <div data-testid="app-marketplace-page-div-56" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span data-testid="app-marketplace-page-span-33">{agent.installs} installs</span>
          <span data-testid="app-marketplace-page-span-35">Triven Team</span>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-3">
        <span className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white" data-testid="marketplace-agent-price-text-2">
          ${agent.price}
        </span>

        <button data-testid="marketplace-agent-open-list"
          type="button"
          onClick={onViewDetails}
          className="rounded-xl border-2 border-amber-500 px-5 py-2 text-sm font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white"
        >
          Open
        </button>
      </div>
    </article>
  );
}

function AgentDetailsModal({
  agent,
  onClose
}: {
  agent: Agent;
  onClose: () => void;
}) {
  const features = [
    "Connects to your existing tools and workflow in minutes",
    "Fully editable automation setup based on your business needs",
    "Built for service-business automation",
    "Ready to install and test with your team"
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${agent.name} details`}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[94vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[1.6rem] bg-white shadow-2xl ring-1 ring-slate-200"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          data-testid="marketplace-modal-close"
          className="absolute right-5 top-5 z-10 grid h-9 w-9 place-items-center rounded-full text-2xl font-light text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close modal"
        >
          ×
        </button>

        <div className="border-b border-slate-100 px-6 py-6 sm:px-7">
          <div className="flex items-start gap-4 pr-10">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-amber-200 bg-amber-50 text-3xl">
              🤖
            </span>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600" data-testid="marketplace-agent-category-text-3">
                  {agent.category}
                </span>

                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700" data-testid="marketplace-agent-industry-all-industries-agent-industry-text-2">
                  {agent.industry === "all" ? "All industries" : agent.industry}
                </span>

                {agent.freeTrial ? (
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700" data-testid="marketplace-free-trial-text">
                    Free trial
                  </span>
                ) : null}
              </div>

              <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-[26px]" data-testid="marketplace-agent-heading-2">
                {agent.name}
              </h2>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-slate-500">{agent.installs} installs</span>

                <span className="text-slate-300">·</span>

                <span className="text-slate-500">Triven Team</span>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto px-6 py-7 sm:px-7">
          <p className="text-[17px] leading-8 text-slate-600" data-testid="marketplace-agent-description-text-3">
            {agent.description}
          </p>

          <div className="mt-7">
            <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-400" data-testid="marketplace-what-you-get-heading">
              What you get
            </h3>

            <div className="mt-4 space-y-3">
              {features.map((feature) => (
                <div key={feature} className="flex items-start gap-3">
                  <span className="mt-0.5 text-sm font-black text-amber-500">✓</span>
                  <p className="text-sm leading-6 text-slate-600" data-testid="marketplace-feature-text">{feature}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-100 bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-end gap-2">
            <span className="text-3xl font-black tracking-tight text-slate-950" data-testid="marketplace-agent-price-text-3">
              ${agent.price}
            </span>
            <span className="pb-1 text-sm font-medium text-slate-400" data-testid="marketplace-one-time-text-2">one-time</span>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link data-testid="marketplace-start-free-trial-link-2"
              href={BUSINESS_SETUP_PATH}
              className="inline-flex min-w-[166px] items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-amber-500/25 transition hover:bg-amber-600"
            >
              Start free trial
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrustItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-amber-400">✓</span>
      {text}
    </div>
  );
}

function FooterGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-900" data-testid="marketplace-title-heading">{title}</h4>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} data-testid={`marketplace-footer-item-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
            <Link data-testid="marketplace-footer-link"
              href={"#" as Route}
              className="text-sm text-slate-500 transition hover:text-amber-600"
            >
              {item}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function filterPillClass(active: boolean) {
  return [
    "inline-flex shrink-0 items-center gap-1.5 rounded-xl border bg-white px-3.5 py-2 text-sm font-medium transition",
    active
      ? "border-amber-300 bg-amber-50 text-amber-700"
      : "border-gray-200 text-slate-600 hover:border-amber-300 hover:text-slate-900"
  ].join(" ");
}

function popoverOptionClass(active: boolean) {
  return [
    "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition",
    active
      ? "bg-amber-50 font-semibold text-amber-700"
      : "text-slate-600 hover:bg-amber-50 hover:text-amber-700"
  ].join(" ");
}

function viewButtonClass(active: boolean) {
  return [
    "grid h-8 w-8 place-items-center rounded-md transition",
    active ? "bg-amber-50 text-amber-600" : "text-slate-400 hover:text-slate-700"
  ].join(" ");
}

function ChevronIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function StarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m12 3.4 2.6 5.34 5.9.86-4.27 4.16 1 5.88L12 16.9l-5.27 2.77 1-5.88L3.46 9.6l5.9-.86L12 3.4Z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.2 4.2L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}