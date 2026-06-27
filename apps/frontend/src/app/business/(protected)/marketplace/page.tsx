"use client";

import type { Route } from "next";
import { apiPost } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    BUSINESS_LOGIN_PATH,
    BUSINESS_MARKETPLACE_PATH,
    businessSetupPath
} from "@/lib/routes";

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
    tags: string[];
    requiredConnectors: string[];
    supportedLlms: string[];
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

const sortOptions = [
    { value: "popular", label: "Most popular" },
    { value: "rating", label: "Highest rated" },
    { value: "priceLow", label: "Price: low to high" },
    { value: "priceHigh", label: "Price: high to low" },
    { value: "newest", label: "Newest" }
] as const;

type SortValue = (typeof sortOptions)[number]["value"];
type OpenFilter = "industry" | "sort" | null;

function filterDropdownOptionClass(active: boolean) {
    return `flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${active
        ? "bg-amber-50 font-medium text-amber-700"
        : "text-slate-600 hover:bg-slate-50"
        }`;
}

function FilterChevronIcon() {
    return (
        <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
    );
}

function normalizeFilterValue(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function formatLabel(value: string) {
    return value
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getIndustryIcon(label: string) {
    const cleanLabel = label.toLowerCase();

    if (cleanLabel.includes("dental")) return "🦷";
    if (cleanLabel.includes("hvac") || cleanLabel.includes("plumbing")) return "🔧";
    if (cleanLabel.includes("real")) return "🏠";
    if (cleanLabel.includes("legal")) return "⚖️";
    if (cleanLabel.includes("medical") || cleanLabel.includes("wellness")) return "❤️";
    if (cleanLabel.includes("auto")) return "🚗";
    if (cleanLabel.includes("commerce") || cleanLabel.includes("shop")) return "🛍️";

    return "✨";
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
        tags: listing.tags ?? [],
        requiredConnectors: listing.requiredConnectors ?? [],
        supportedLlms: listing.supportedLlms ?? [],
        createdAt: listing.createdAt
    };
}

function buildIndustries(agents: Agent[]): Industry[] {
    const industryMap = new Map<string, Industry>();

    agents.forEach((agent) => {
        const id = agent.industry || "all";
        if (id === "all") return;

        const existing = industryMap.get(id);

        if (existing) {
            industryMap.set(id, {
                ...existing,
                count: existing.count + 1
            });
            return;
        }

        const label = formatLabel(id);

        industryMap.set(id, {
            id,
            label,
            count: 1,
            icon: getIndustryIcon(label)
        });
    });

    return [
        {
            id: "all",
            label: "All industries",
            count: agents.length,
            icon: "✨"
        },
        ...Array.from(industryMap.values()).sort((a, b) => a.label.localeCompare(b.label))
    ];
}

export default function MarketplacePage() {
    const router = useRouter();

    const [authReady, setAuthReady] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [apiError, setApiError] = useState("");
    const [agents, setAgents] = useState<Agent[]>([]);
    const [query, setQuery] = useState("");
    const [industry, setIndustry] = useState("all");
    const [sort, setSort] = useState<SortValue>("popular");
    const [view, setView] = useState<"grid" | "list">("grid");
    const [freeTrialOnly, setFreeTrialOnly] = useState(false);
    const [newOnly, setNewOnly] = useState(false);
    const [openFilter, setOpenFilter] = useState<OpenFilter>(null);
    const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

    useEffect(() => {
        const token =
            localStorage.getItem("coreai-token") ||
            localStorage.getItem("coreai_token");

        const userRaw =
            localStorage.getItem("coreai-user") ||
            localStorage.getItem("coreai_user");

        let role = "";

        try {
            role = userRaw ? JSON.parse(userRaw)?.role ?? "" : "";
        } catch {
            role = "";
        }

        if (!token || role !== "BUSINESS") {
            localStorage.removeItem("coreai-token");
            localStorage.removeItem("coreai_token");
            localStorage.removeItem("coreai-user");
            localStorage.removeItem("coreai_user");
            sessionStorage.clear();
            router.replace(BUSINESS_LOGIN_PATH);
            return;
        }

        setAuthReady(true);
    }, [router]);

    useEffect(() => {
        if (!authReady) return;

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
    }, [authReady]);

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

    function openAgentPage(agent: Agent) {
        // Install / Start free trial → business setup wizard (not architect publish).
        router.push(businessSetupPath(agent.id));
    }

    function openDetailsModal(agent: Agent) {
        setSelectedAgent(agent);
    }

    const industries = useMemo(() => buildIndustries(agents), [agents]);
    const featuredAgent = agents[0] ?? null;

    const industryLabel =
        industries.find((item) => item.id === industry)?.label ?? "All industries";

    const sortLabel =
        sortOptions.find((item) => item.value === sort)?.label ?? "Most popular";

    const filteredAgents = useMemo(() => {
        const cleanQuery = query.trim().toLowerCase();

        const filtered = agents.filter((agent) => {
            const matchesQuery =
                !cleanQuery ||
                `${agent.name} ${agent.category} ${agent.description} ${agent.tags.join(" ")} ${agent.requiredConnectors.join(" ")} ${agent.supportedLlms.join(" ")}`
                    .toLowerCase()
                    .includes(cleanQuery);

            const matchesIndustry =
                industry === "all" ||
                agent.industry === industry ||
                agent.industry === "all";

            const matchesTrial = !freeTrialOnly || agent.freeTrial;
            const matchesNew = !newOnly || agent.isNew;

            return matchesQuery && matchesIndustry && matchesTrial && matchesNew;
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
    }, [agents, query, industry, sort, freeTrialOnly, newOnly]);

    if (!authReady) {
        return <main className="min-h-screen bg-white" />;
    }

    return (
        <main className="min-h-screen bg-white text-slate-900">
            <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur">
                <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
                    <div className="relative mx-auto max-w-3xl">
                        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                            🔍
                        </span>

                        <input data-testid="business-marketplace-search-input"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search agents by name, industry, or problem..."
                            className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3 pl-12 pr-4 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-amber-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-amber-100"
                        />
                    </div>
                </div>
            </nav>

            <section className="relative overflow-hidden bg-gradient-to-br from-amber-50 via-white to-orange-50">
                <div className="pointer-events-none absolute -left-24 top-8 h-72 w-72 rounded-full bg-amber-200/30 blur-3xl" />
                <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-orange-200/30 blur-3xl" />

                <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
                    <div className="mx-auto max-w-3xl text-center">
                        <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/70 px-3.5 py-1.5 text-xs font-semibold text-amber-700" data-testid="business-protected-marketplace-live-marketplace-agents-text">
                            ✨ Live marketplace agents
                        </span>

                        <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl" data-testid="business-protected-marketplace-ai-agents-that-work-while-you-sleep-heading">
                            AI Agents That Work
                            <br className="hidden sm:block" /> While You Sleep
                        </h1>

                        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600 sm:text-xl" data-testid="business-protected-marketplace-browse-pre-built-ai-agents-install-in-text">
                            Browse pre-built AI agents. Install in minutes. No code required.
                        </p>

                        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
                            <Metric label="Agents" value={`${agents.length}`} />
                            <Metric label="Industries" value={`${Math.max(industries.length - 1, 0)}`} />
                            <Metric
                                label="Average rating"
                                value={
                                    agents.length
                                        ? `${(
                                            agents.reduce((total, agent) => total + agent.rating, 0) /
                                            agents.length
                                        ).toFixed(1)} ⭐`
                                        : "0.0 ⭐"
                                }
                            />
                        </div>
                    </div>

                    {featuredAgent ? (
                        <div className="relative mx-auto mt-12 max-w-5xl">
                            <div className="absolute inset-x-8 bottom-2 h-24 rounded-full bg-amber-400/30 blur-2xl" />

                            <div className="relative grid items-center gap-8 overflow-hidden rounded-3xl border border-amber-100 bg-white p-7 shadow-[0_30px_80px_-28px_rgba(245,158,11,.55)] sm:p-9 md:grid-cols-2">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white" data-testid="business-protected-marketplace-featured-text">
                                            ⭐ Featured
                                        </span>

                                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700" data-testid="business-protected-marketplace-featured-agent-category-text">
                                            {featuredAgent.category}
                                        </span>
                                    </div>

                                    <h2 className="mt-4 text-3xl font-extrabold text-slate-900" data-testid="business-protected-marketplace-featured-agent-heading">
                                        {featuredAgent.name}
                                    </h2>

                                    <p className="mt-3 text-slate-600" data-testid="business-protected-marketplace-featured-agent-description-text">
                                        {featuredAgent.description}
                                    </p>

                                    <div className="mt-5 flex flex-wrap items-center gap-3">
                                        <span className="text-2xl font-black text-slate-900" data-testid="business-protected-marketplace-featured-agent-price-text">
                                            ${featuredAgent.price}
                                        </span>
                                        <span className="text-sm text-slate-500" data-testid="business-protected-marketplace-one-time-text">one-time</span>
                                        <span className="h-4 w-px bg-gray-200" />
                                        <span className="text-sm font-semibold text-amber-600" data-testid="business-protected-marketplace-featured-agent-rating-to-fixed-1-text-2">
                                            ⭐ {featuredAgent.rating.toFixed(1)}
                                        </span>
                                    </div>

                                    <div className="mt-6 flex flex-wrap items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => openAgentPage(featuredAgent)}
                                            data-testid="business-marketplace-featured-open"
                                            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600"
                                        >
                                            Open agent
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => openDetailsModal(featuredAgent)}
                                            data-testid="business-marketplace-featured-details"
                                            className="rounded-xl border-2 border-gray-200 px-5 py-3 font-semibold text-slate-700 transition hover:border-amber-300 hover:text-amber-600"
                                        >
                                            View details
                                        </button>
                                    </div>
                                </div>

                                <div className="flex justify-center md:justify-end">
                                    <div className="relative w-[240px] rotate-3 rounded-[2.4rem] border-[10px] border-slate-900 bg-slate-900 shadow-2xl">
                                        <div className="overflow-hidden rounded-[1.7rem] bg-slate-50">
                                            <div className="flex items-center gap-2.5 bg-white px-4 pb-3 pt-6">
                                                <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-500 text-[11px] font-bold text-white" data-testid="business-protected-marketplace-ai-text">
                                                    AI
                                                </span>
                                                <div>
                                                    <p className="text-[13px] font-semibold text-slate-900" data-testid="business-protected-marketplace-featured-agent-text">
                                                        {featuredAgent.name}
                                                    </p>
                                                    <p className="text-[10px] text-emerald-500" data-testid="business-protected-marketplace-active-now-text">● Active now</p>
                                                </div>
                                            </div>

                                            <div className="space-y-2.5 px-3 py-4 text-[12px] leading-snug">
                                                <div className="mx-auto w-fit rounded-full bg-slate-200/70 px-3 py-1 text-[10px] text-slate-500">
                                                    Automation started
                                                </div>
                                                <Message mine>
                                                    Hi! This is your AI agent. How can we help?
                                                </Message>
                                                <Message>
                                                    I need help booking a service.
                                                </Message>
                                                <Message mine>
                                                    Sure. I can collect details and route this to your team.
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
                </div>
            </section>

            {industries.length > 1 ? (
                <section className="bg-white py-16">
                    <div className="mx-auto max-w-6xl px-4 sm:px-6">
                        <div className="text-center">
                            <h2 className="text-3xl font-bold text-slate-900" data-testid="business-protected-marketplace-browse-by-industry-heading">
                                Browse by industry
                            </h2>
                            <p className="mt-2 text-slate-600" data-testid="business-protected-marketplace-find-agents-built-specifically-for-your-business-text">
                                Find agents built specifically for your business type.
                            </p>
                        </div>

                        <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                            {industries
                                .filter((item) => item.id !== "all")
                                .map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        data-testid={`business-marketplace-industry-${item.id}`}
                                        onClick={() => setIndustry(item.id)}
                                        className={`group rounded-2xl border bg-white p-6 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-200 hover:shadow-lg ${industry === item.id
                                            ? "border-amber-300 ring-4 ring-amber-100"
                                            : "border-gray-100"
                                            }`}
                                    >
                                        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl transition group-hover:scale-105 group-hover:bg-amber-500" data-testid="business-protected-marketplace-icon-text">
                                            {item.icon}
                                        </span>
                                        <p className="mt-3 font-semibold text-slate-900" data-testid="business-protected-marketplace-label-text">
                                            {item.label}
                                        </p>
                                        <p className="text-sm text-slate-500" data-testid="business-protected-marketplace-count-agents-text">{item.count} agents</p>
                                    </button>
                                ))}
                        </div>
                    </div>
                </section>
            ) : null}

            <section className="sticky top-[73px] z-40 border-y border-gray-100 bg-white/95 backdrop-blur">
                <div className="mx-auto max-w-7xl px-4 sm:px-6">
                    <div className="flex items-center gap-3 overflow-x-auto py-3">
                        <div className="relative shrink-0">
                            <button
                                type="button"
                                onClick={() => setOpenFilter(openFilter === "industry" ? null : "industry")}
                                data-testid="business-marketplace-filter-industry"
                                data-filter-trigger="industry"
                                className={`inline-flex items-center gap-1.5 rounded-xl border bg-white px-4 py-2 text-sm font-medium outline-none transition hover:border-amber-300 focus:border-amber-300 focus:ring-4 focus:ring-amber-100 ${industry !== "all"
                                    ? "border-amber-300 text-amber-700"
                                    : "border-gray-200 text-slate-600"
                                    }`}
                                aria-haspopup="listbox"
                                aria-expanded={openFilter === "industry"}
                            >
                                <span data-testid="business-protected-marketplace-industry-label-text">{industryLabel}</span>
                                <FilterChevronIcon />
                            </button>

                            {openFilter === "industry" ? (
                                <div
                                    data-filter-panel="industry"
                                    className="absolute left-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]"
                                >
                                    {industries.map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            data-testid={`business-marketplace-industry-option-${item.id}`}
                                            onClick={() => {
                                                setIndustry(item.id);
                                                setOpenFilter(null);
                                            }}
                                            className={filterDropdownOptionClass(industry === item.id)}
                                        >
                                            <span data-testid="business-protected-marketplace-label-text-2">{item.label}</span>
                                            <span className="text-xs text-slate-400" data-testid="business-protected-marketplace-count-text">{item.count}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>

                        <button
                            type="button"
                            onClick={() => {
                                setOpenFilter(null);
                                setFreeTrialOnly((current) => !current);
                            }}
                            data-testid="business-marketplace-filter-free-trial"
                            className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${freeTrialOnly
                                ? "border-amber-300 bg-amber-50 text-amber-700"
                                : "border-gray-200 bg-white text-slate-600 hover:border-amber-300"
                                }`}
                        >
                            Free trial
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                setOpenFilter(null);
                                setNewOnly((current) => !current);
                            }}
                            data-testid="business-marketplace-filter-new"
                            className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${newOnly
                                ? "border-amber-300 bg-amber-50 text-amber-700"
                                : "border-gray-200 bg-white text-slate-600 hover:border-amber-300"
                                }`}
                        >
                            New this month
                        </button>

                        <div className="ml-auto flex shrink-0 items-center gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setOpenFilter(null);
                                    setView("grid");
                                }}
                                data-testid="business-marketplace-view-grid"
                                className={`rounded-lg border px-3 py-2 text-sm ${view === "grid"
                                    ? "border-amber-300 bg-amber-50 text-amber-700"
                                    : "border-gray-200 text-slate-500"
                                    }`}
                            >
                                Grid
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setOpenFilter(null);
                                    setView("list");
                                }}
                                data-testid="business-marketplace-view-list"
                                className={`rounded-lg border px-3 py-2 text-sm ${view === "list"
                                    ? "border-amber-300 bg-amber-50 text-amber-700"
                                    : "border-gray-200 text-slate-500"
                                    }`}
                            >
                                List
                            </button>

                            <div className="relative shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setOpenFilter(openFilter === "sort" ? null : "sort")}
                                    data-testid="business-marketplace-filter-sort"
                                    data-filter-trigger="sort"
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 outline-none transition hover:border-amber-300 focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
                                    aria-haspopup="listbox"
                                    aria-expanded={openFilter === "sort"}
                                >
                                    <span data-testid="business-protected-marketplace-sort-label-text">Sort: {sortLabel}</span>
                                    <FilterChevronIcon />
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
                                                data-testid={`business-marketplace-sort-option-${item.value}`}
                                                onClick={() => {
                                                    setSort(item.value);
                                                    setOpenFilter(null);
                                                }}
                                                className={filterDropdownOptionClass(sort === item.value)}
                                            >
                                                {item.label}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="bg-gray-50 py-12">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
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
                        <div className="rounded-2xl border border-red-100 bg-white py-16 text-center">
                            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-2xl">
                                ⚠️
                            </div>
                            <h3 className="mt-4 text-lg font-semibold text-slate-900" data-testid="business-protected-marketplace-could-not-load-marketplace-agents-heading">
                                Could not load marketplace agents
                            </h3>
                            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500" data-testid="business-protected-marketplace-api-error-text">
                                {apiError}
                            </p>
                        </div>
                    ) : filteredAgents.length ? (
                        <div
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
                                        onOpen={() => openAgentPage(agent)}
                                        onViewDetails={() => openDetailsModal(agent)}
                                    />
                                ) : (
                                    <AgentListCard
                                        key={agent.id}
                                        agent={agent}
                                        onOpen={() => openAgentPage(agent)}
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
                            <h3 className="mt-4 text-lg font-semibold text-slate-900" data-testid="business-protected-marketplace-no-agents-match-those-filters-heading">
                                No agents match those filters
                            </h3>
                            <p className="mt-1 text-sm text-slate-500" data-testid="business-protected-marketplace-try-clearing-search-or-selecting-another-industry-text">
                                Try clearing search or selecting another industry.
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    setQuery("");
                                    setIndustry("all");
                                    setFreeTrialOnly(false);
                                    setNewOnly(false);
                                }}
                                data-testid="business-marketplace-clear-filters"
                                className="mt-5 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                            >
                                Clear filters
                            </button>
                        </div>
                    )}

                    {!isLoading && !apiError ? (
                        <p className="mt-8 text-center text-sm text-slate-400" data-testid="business-protected-marketplace-showing-filtered-agents-of-agents-text">
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
                    <h2 className="text-3xl font-bold text-slate-900" data-testid="business-protected-marketplace-not-sure-which-agent-is-right-heading">
                        Not sure which agent is right?
                    </h2>
                    <p className="mx-auto mt-3 max-w-xl text-slate-600" data-testid="business-protected-marketplace-take-a-free-2-minute-assessment-and-text">
                        Take a free 2-minute assessment and get a personalized
                        recommendation built around your business.
                    </p>
                    <Link data-testid="business-marketplace-ai-score-link"
                        href={"/assignment" as Route}
                        className="mx-auto mt-7 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600"
                    >
                        Get your free AI score →
                    </Link>
                </div>
            </section>

            <section className="bg-slate-900 py-8">
                <div className="mx-auto max-w-7xl px-4 sm:px-6">
                    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-white/80">
                        <TrustItem text="256-bit encryption" />
                        <TrustItem text="99.9% uptime" />
                        <TrustItem text="SOC 2 compliant" />
                        <TrustItem text="30-day money back" />
                        <TrustItem text="24/7 support" />
                    </div>
                </div>
            </section>
            {selectedAgent ? (
                <AgentDetailsModal
                    agent={selectedAgent}
                    onClose={() => setSelectedAgent(null)}
                    onOpenAgent={() => openAgentPage(selectedAgent)}
                />
            ) : null}
        </main>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900" data-testid={`business-marketplace-metric-value-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{value}</span>
            <span className="text-slate-500" data-testid="business-protected-marketplace-label-text-3">{label}</span>
        </div>
    );
}

function Message({
    children,
    mine
}: {
    children: ReactNode;
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
    onOpen,
    onViewDetails
}: {
    agent: Agent;
    onOpen: () => void;
    onViewDetails: () => void;
}) {
    return (
        <article
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen();
                }
            }}
            data-testid={`business-marketplace-agent-card-${agent.id}`}
            className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl"
        >
            <div className="flex-1 p-6">
                <div className="flex items-start justify-between">
                    <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-50 text-xl ring-1 ring-amber-100">
                        🤖
                    </span>

                    <span className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white" data-testid="business-protected-marketplace-agent-price-text">
                        ${agent.price}
                    </span>
                </div>

                <h3 className="mt-4 flex items-center gap-2 text-lg font-bold text-slate-900" data-testid="business-protected-marketplace-agent-is-new-heading">
                    {agent.name}
                    {agent.isNew ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700" data-testid="business-protected-marketplace-new-text">
                            New
                        </span>
                    ) : null}
                </h3>

                <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-slate-600" data-testid="business-protected-marketplace-agent-category-text">
                        {agent.category}
                    </span>

                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700" data-testid="business-protected-marketplace-agent-industry-all-industries-format-label-agent-text">
                        {agent.industry === "all" ? "All industries" : formatLabel(agent.industry)}
                    </span>
                </div>

                <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600" data-testid="business-protected-marketplace-agent-description-text">
                    {agent.description}
                </p>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-gray-50 bg-gray-50/60 px-6 py-3">
                <span className="text-xs text-slate-500" data-testid="business-protected-marketplace-agent-installs-text">{agent.installs} installs</span>
                <span className="text-xs font-semibold text-amber-600" data-testid="business-protected-marketplace-agent-rating-to-fixed-1-text">
                    ⭐ {agent.rating.toFixed(1)}
                </span>
                <span className="truncate text-xs text-slate-500" data-testid="business-protected-marketplace-by-agent-author-text">By {agent.author}</span>
            </div>

            <div className="px-6 pb-6 pt-4">
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onViewDetails();
                    }}
                    data-testid={`business-marketplace-agent-details-${agent.id}`}
                    className="w-full rounded-xl border-2 border-amber-500 py-2.5 font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white"
                >
                    View details
                </button>
            </div>
        </article>
    );
}

function AgentListCard({
    agent,
    onOpen,
    onViewDetails
}: {
    agent: Agent;
    onOpen: () => void;
    onViewDetails: () => void;
}) {
    return (
        <article
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen();
                }
            }}
            data-testid={`business-marketplace-agent-card-${agent.id}`}
            className="group flex cursor-pointer flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-lg sm:flex-row sm:items-center"
        >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-amber-50 text-xl ring-1 ring-amber-100">
                🤖
            </span>

            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900" data-testid="business-protected-marketplace-agent-heading">{agent.name}</h3>

                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600" data-testid="business-protected-marketplace-agent-category-text-2">
                        {agent.category}
                    </span>

                    {agent.isNew ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-amber-700" data-testid="business-protected-marketplace-new-text-2">
                            New
                        </span>
                    ) : null}
                </div>

                <p className="mt-1.5 line-clamp-2 text-sm text-slate-600" data-testid="business-protected-marketplace-agent-description-text-2">
                    {agent.description}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span data-testid="business-protected-marketplace-agent-installs-text-2">{agent.installs} installs</span>
                    <span className="font-semibold text-amber-600" data-testid="business-protected-marketplace-agent-rating-to-fixed-1-text-2">
                        ⭐ {agent.rating.toFixed(1)}
                    </span>
                    <span data-testid="business-protected-marketplace-by-agent-author-text-2">By {agent.author}</span>
                </div>
            </div>

            <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-3">
                <span className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white" data-testid="business-protected-marketplace-agent-price-text-2">
                    ${agent.price}
                </span>

                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onViewDetails();
                    }}
                    data-testid={`business-marketplace-agent-details-${agent.id}`}
                    className="rounded-xl border-2 border-amber-500 px-5 py-2 text-sm font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white"
                >
                    View details
                </button>
            </div>
        </article>
    );
}

function AgentDetailsModal({
    agent,
    onClose,
    onOpenAgent
}: {
    agent: Agent;
    onClose: () => void;
    onOpenAgent: () => void;
}) {
    const features = [
        "Connects to your existing tools and workflow in minutes",
        "Fully editable automation setup based on your business needs",
        "Supports required connectors listed by the architect",
        "Built by a verified Core AI architect"
    ];

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-3 backdrop-blur-sm sm:p-6"
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
                    data-testid="business-marketplace-modal-close"
                    className="absolute right-5 top-5 z-10 grid h-9 w-9 place-items-center rounded-full text-2xl font-light text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Close modal"
                >
                    ×
                </button>

                <div className="border-b border-slate-100 px-6 py-6 sm:px-7">
                    <div className="flex items-start gap-4 pr-10">
                        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-500">
                            <svg
                                className="h-7 w-7"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <path d="M7.5 18.5 4 20l1.2-3.4A8 8 0 1 1 12 20a8 8 0 0 1-4.5-1.5Z" />
                                <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
                            </svg>
                        </span>

                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600" data-testid="business-protected-marketplace-agent-category-text-3">
                                    {agent.category}
                                </span>

                                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700" data-testid="business-protected-marketplace-agent-industry-all-industries-format-label-agent-text-2">
                                    {agent.industry === "all" ? "All industries" : formatLabel(agent.industry)}
                                </span>
                            </div>

                            <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-[26px]" data-testid="business-protected-marketplace-agent-heading-2">
                                {agent.name}
                            </h2>

                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                                <span className="font-semibold text-amber-500" data-testid="business-protected-marketplace-agent-rating-to-fixed-1-text-3">
                                    ★★★★★ {agent.rating.toFixed(1)}
                                </span>

                                <span className="text-slate-300">·</span>

                                <span className="text-slate-500" data-testid="business-protected-marketplace-agent-installs-text-3">{agent.installs} installs</span>

                                <span className="text-slate-300">·</span>

                                <span className="text-slate-500" data-testid="business-protected-marketplace-by-agent-author-text-3">By {agent.author}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="overflow-y-auto px-6 py-7 sm:px-7">
                    <p className="text-[17px] leading-8 text-slate-600" data-testid="business-protected-marketplace-agent-description-text-3">
                        {agent.description}
                    </p>

                    <div className="mt-7">
                        <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-400" data-testid="business-protected-marketplace-what-you-get-heading">
                            What you get
                        </h3>

                        <div className="mt-4 space-y-3">
                            {features.map((feature) => (
                                <div key={feature} className="flex items-start gap-3">
                                    <span className="mt-0.5 text-sm font-black text-amber-500">✓</span>
                                    <p className="text-sm leading-6 text-slate-600" data-testid="business-protected-marketplace-feature-text">{feature}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {agent.requiredConnectors.length ? (
                        <div className="mt-7">
                            <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-400" data-testid="business-protected-marketplace-required-connectors-heading">
                                Required connectors
                            </h3>

                            <div className="mt-4 flex flex-wrap gap-2">
                                {agent.requiredConnectors.map((connector) => (
                                    <span
                                        key={connector}
                                        className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
                                     data-testid="business-protected-marketplace-connector-text">
                                        {connector}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {agent.supportedLlms.length ? (
                        <div className="mt-7">
                            <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-400" data-testid="business-protected-marketplace-supported-llms-heading">
                                Supported LLMs
                            </h3>

                            <div className="mt-4 flex flex-wrap gap-2">
                                {agent.supportedLlms.map((llm) => (
                                    <span
                                        key={llm}
                                        className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600"
                                     data-testid="business-protected-marketplace-llm-text">
                                        {llm}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>

                <div className="flex flex-col gap-4 border-t border-slate-100 bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="flex items-end gap-2">
                        <span className="text-3xl font-black tracking-tight text-slate-950" data-testid="business-protected-marketplace-agent-price-text-3">
                            ${agent.price}
                        </span>
                        <span className="pb-1 text-sm font-medium text-slate-400" data-testid="business-protected-marketplace-one-time-text-2">one-time</span>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                            type="button"
                            onClick={onOpenAgent}
                            data-testid="business-marketplace-modal-start-trial"
                            className="inline-flex min-w-[150px] items-center justify-center rounded-xl border-2 border-amber-500 bg-white px-5 py-3 text-sm font-bold text-amber-600 transition hover:bg-amber-50"
                        >
                            Start free trial
                        </button>

                        <button
                            type="button"
                            onClick={onOpenAgent}
                            data-testid="business-marketplace-modal-install"
                            className="inline-flex min-w-[166px] items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-amber-500/25 transition hover:bg-amber-600"
                        >
                            <span className="text-base">⇩</span>
                            Install agent
                        </button>
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

function FooterGroup({
    title,
    items
}: {
    title: string;
    items: {
        label: string;
        href: string;
    }[];
}) {
    return (
        <div>
            <h4 className="text-sm font-semibold text-slate-900" data-testid="business-protected-marketplace-title-heading">{title}</h4>

            <ul className="mt-3 space-y-2">
                {items.map((item) => (
                    <li key={item.label} data-testid="business-protected-marketplace-label-item">
                        <Link data-testid="business-marketplace-footer-link"
                            href={item.href as any}
                            className="text-sm text-slate-500 transition hover:text-amber-600"
                        >
                            {item.label}
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}