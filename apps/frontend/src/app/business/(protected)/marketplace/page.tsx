"use client";

import { apiPost } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ARCHITECT_LOGIN_PATH,
  ASSIGNMENT_PATH,
  BUSINESS_CHECKOUT_PATH,
  BUSINESS_LOGIN_PATH,
  BUSINESS_MARKETPLACE_PATH,
  businessAgentPath
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
    const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

    useEffect(() => {
        const token = localStorage.getItem("coreai_token");
        const userRaw = localStorage.getItem("coreai_user");

        let role = "";

        try {
            role = userRaw ? JSON.parse(userRaw)?.role ?? "" : "";
        } catch {
            role = "";
        }

        if (!token || role !== "BUSINESS") {
            localStorage.removeItem("coreai_token");
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

    function handleLogout() {
        localStorage.removeItem("coreai_token");
        localStorage.removeItem("coreai_user");
        sessionStorage.clear();
        router.replace(BUSINESS_LOGIN_PATH);
    }

    function openAgentPage(agent: Agent) {
        router.push(businessAgentPath(agent.id));
    }

    function openDetailsModal(agent: Agent) {
        setSelectedAgent(agent);
    }

    const industries = useMemo(() => buildIndustries(agents), [agents]);
    const featuredAgent = agents[0] ?? null;

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
            <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 shadow-sm backdrop-blur">
                <div className="mx-auto max-w-7xl px-4 sm:px-6">
                    <div className="flex flex-wrap items-center gap-3 py-3">
                        <Link href={BUSINESS_MARKETPLACE_PATH} className="flex shrink-0 items-center gap-2.5">
                            <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-500 text-white shadow-lg shadow-amber-500/30">
                                ●
                            </span>
                            <span className="text-xl font-extrabold tracking-tight text-slate-900">
                                CORE
                            </span>
                        </Link>

                        <div className="order-3 w-full md:order-2 md:flex-1 md:px-4">
                            <div className="relative mx-auto max-w-2xl">
                                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                                    🔍
                                </span>

                                <input
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Search agents by name, industry, or problem..."
                                    className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-11 pr-4 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-amber-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-amber-100"
                                />
                            </div>
                        </div>

                        <div className="order-2 ml-auto flex items-center gap-2 md:order-3">
                            <button
                                type="button"
                                onClick={handleLogout}
                                className="rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-100"
                            >
                                Logout
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            <section className="relative overflow-hidden bg-gradient-to-br from-amber-50 via-white to-orange-50">
                <div className="pointer-events-none absolute -left-24 top-8 h-72 w-72 rounded-full bg-amber-200/30 blur-3xl" />
                <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-orange-200/30 blur-3xl" />

                <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
                    <div className="mx-auto max-w-3xl text-center">
                        <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/70 px-3.5 py-1.5 text-xs font-semibold text-amber-700">
                            ✨ Live marketplace agents
                        </span>

                        <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl">
                            AI Agents That Work
                            <br className="hidden sm:block" /> While You Sleep
                        </h1>

                        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600 sm:text-xl">
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
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                                            ⭐ Featured
                                        </span>

                                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                                            {featuredAgent.category}
                                        </span>
                                    </div>

                                    <h2 className="mt-4 text-3xl font-extrabold text-slate-900">
                                        {featuredAgent.name}
                                    </h2>

                                    <p className="mt-3 text-slate-600">
                                        {featuredAgent.description}
                                    </p>

                                    <div className="mt-5 flex flex-wrap items-center gap-3">
                                        <span className="text-2xl font-black text-slate-900">
                                            ${featuredAgent.price}
                                        </span>
                                        <span className="text-sm text-slate-500">one-time</span>
                                        <span className="h-4 w-px bg-gray-200" />
                                        <span className="text-sm font-semibold text-amber-600">
                                            ⭐ {featuredAgent.rating.toFixed(1)}
                                        </span>
                                    </div>

                                    <div className="mt-6 flex flex-wrap items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => openAgentPage(featuredAgent)}
                                            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600"
                                        >
                                            Open agent
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => openDetailsModal(featuredAgent)}
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
                                                <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
                                                    AI
                                                </span>
                                                <div>
                                                    <p className="text-[13px] font-semibold text-slate-900">
                                                        {featuredAgent.name}
                                                    </p>
                                                    <p className="text-[10px] text-emerald-500">● Active now</p>
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
                            <h2 className="text-3xl font-bold text-slate-900">
                                Browse by industry
                            </h2>
                            <p className="mt-2 text-slate-600">
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
                                        onClick={() => setIndustry(item.id)}
                                        className={`group rounded-2xl border bg-white p-6 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-200 hover:shadow-lg ${industry === item.id
                                                ? "border-amber-300 ring-4 ring-amber-100"
                                                : "border-gray-100"
                                            }`}
                                    >
                                        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl transition group-hover:scale-105 group-hover:bg-amber-500">
                                            {item.icon}
                                        </span>
                                        <p className="mt-3 font-semibold text-slate-900">
                                            {item.label}
                                        </p>
                                        <p className="text-sm text-slate-500">{item.count} agents</p>
                                    </button>
                                ))}
                        </div>
                    </div>
                </section>
            ) : null}

            <section className="sticky top-[68px] z-40 border-y border-gray-100 bg-white/95 backdrop-blur">
                <div className="mx-auto max-w-7xl px-4 sm:px-6">
                    <div className="flex items-center gap-3 overflow-x-auto py-3">
                        <select
                            value={industry}
                            onChange={(event) => setIndustry(event.target.value)}
                            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 outline-none transition hover:border-amber-300 focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
                        >
                            {industries.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.label}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={() => setFreeTrialOnly((current) => !current)}
                            className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${freeTrialOnly
                                    ? "border-amber-300 bg-amber-50 text-amber-700"
                                    : "border-gray-200 bg-white text-slate-600 hover:border-amber-300"
                                }`}
                        >
                            Free trial
                        </button>

                        <button
                            type="button"
                            onClick={() => setNewOnly((current) => !current)}
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
                                onClick={() => setView("grid")}
                                className={`rounded-lg border px-3 py-2 text-sm ${view === "grid"
                                        ? "border-amber-300 bg-amber-50 text-amber-700"
                                        : "border-gray-200 text-slate-500"
                                    }`}
                            >
                                Grid
                            </button>

                            <button
                                type="button"
                                onClick={() => setView("list")}
                                className={`rounded-lg border px-3 py-2 text-sm ${view === "list"
                                        ? "border-amber-300 bg-amber-50 text-amber-700"
                                        : "border-gray-200 text-slate-500"
                                    }`}
                            >
                                List
                            </button>

                            <select
                                value={sort}
                                onChange={(event) => setSort(event.target.value as SortValue)}
                                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 outline-none transition hover:border-amber-300 focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
                            >
                                {sortOptions.map((item) => (
                                    <option key={item.value} value={item.value}>
                                        Sort: {item.label}
                                    </option>
                                ))}
                            </select>
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
                            <h3 className="mt-4 text-lg font-semibold text-slate-900">
                                Could not load marketplace agents
                            </h3>
                            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
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
                            <h3 className="mt-4 text-lg font-semibold text-slate-900">
                                No agents match those filters
                            </h3>
                            <p className="mt-1 text-sm text-slate-500">
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
                                className="mt-5 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                            >
                                Clear filters
                            </button>
                        </div>
                    )}

                    {!isLoading && !apiError ? (
                        <p className="mt-8 text-center text-sm text-slate-400">
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
                    <h2 className="text-3xl font-bold text-slate-900">
                        Not sure which agent is right?
                    </h2>
                    <p className="mx-auto mt-3 max-w-xl text-slate-600">
                        Take a free 2-minute assessment and get a personalized
                        recommendation built around your business.
                    </p>
                    <Link
                        href="/assignment"
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

            <footer className="border-t border-gray-100 bg-white py-12">
                <div className="mx-auto max-w-7xl px-4 sm:px-6">
                    <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
                        <div className="col-span-2 md:col-span-1">
                            <Link href={BUSINESS_MARKETPLACE_PATH} className="flex items-center gap-2.5">
                                <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-500 text-white">
                                    ●
                                </span>
                                <span className="text-xl font-extrabold tracking-tight text-slate-900">
                                    CORE
                                </span>
                            </Link>

                            <p className="mt-3 max-w-xs text-sm text-slate-500">
                                The marketplace for AI agents that run the busywork of your business.
                            </p>
                        </div>

                        <FooterGroup
                            title="Product"
                            items={[
                                { label: "Marketplace", href: "/business/marketplace" },
                                { label: "For Architects", href: "/architect/login" },
                                { label: "Pricing", href: "/business/checkout" }
                            ]}
                        />

                        <FooterGroup
                            title="Company"
                            items={[
                                { label: "About", href: "/about" },
                                { label: "Blog", href: "/blog" },
                                { label: "Contact", href: "/#contact" }
                            ]}
                        />

                        <FooterGroup
                            title="Resources"
                            items={[
                                { label: "Docs", href: "/docs" },
                                { label: "Help center", href: "/help" },
                                { label: "Status", href: "/status" }
                            ]}
                        />

                        <FooterGroup
                            title="Legal"
                            items={[
                                { label: "Privacy", href: "/privacy" },
                                { label: "Terms", href: "/terms" },
                                { label: "Security", href: "/security" }
                            ]}
                        />
                    </div>

                    <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-gray-100 pt-6 sm:flex-row">
                        <p className="text-sm text-slate-400">
                            © {new Date().getFullYear()} CORE AI Agent Platform. All rights reserved.
                        </p>

                        <div className="flex items-center gap-3 text-sm text-slate-400">
                            <Link href="#" className="transition hover:text-amber-600">
                                X
                            </Link>
                            <Link href="#" className="transition hover:text-amber-600">
                                LinkedIn
                            </Link>
                            <Link href="#" className="transition hover:text-amber-600">
                                GitHub
                            </Link>
                        </div>
                    </div>
                </div>
            </footer>

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
            <span className="font-bold text-slate-900">{value}</span>
            <span className="text-slate-500">{label}</span>
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
            className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl"
        >
            <div className="flex-1 p-6">
                <div className="flex items-start justify-between">
                    <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-50 text-xl ring-1 ring-amber-100">
                        🤖
                    </span>

                    <span className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white">
                        ${agent.price}
                    </span>
                </div>

                <h3 className="mt-4 flex items-center gap-2 text-lg font-bold text-slate-900">
                    {agent.name}
                    {agent.isNew ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                            New
                        </span>
                    ) : null}
                </h3>

                <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-slate-600">
                        {agent.category}
                    </span>

                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                        {agent.industry === "all" ? "All industries" : formatLabel(agent.industry)}
                    </span>
                </div>

                <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600">
                    {agent.description}
                </p>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-gray-50 bg-gray-50/60 px-6 py-3">
                <span className="text-xs text-slate-500">{agent.installs} installs</span>
                <span className="text-xs font-semibold text-amber-600">
                    ⭐ {agent.rating.toFixed(1)}
                </span>
                <span className="truncate text-xs text-slate-500">By {agent.author}</span>
            </div>

            <div className="px-6 pb-6 pt-4">
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onViewDetails();
                    }}
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
            className="group flex cursor-pointer flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-lg sm:flex-row sm:items-center"
        >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-amber-50 text-xl ring-1 ring-amber-100">
                🤖
            </span>

            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{agent.name}</h3>

                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                        {agent.category}
                    </span>

                    {agent.isNew ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                            New
                        </span>
                    ) : null}
                </div>

                <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">
                    {agent.description}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>{agent.installs} installs</span>
                    <span className="font-semibold text-amber-600">
                        ⭐ {agent.rating.toFixed(1)}
                    </span>
                    <span>By {agent.author}</span>
                </div>
            </div>

            <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-3">
                <span className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white">
                    ${agent.price}
                </span>

                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onViewDetails();
                    }}
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
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                                    {agent.category}
                                </span>

                                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                                    {agent.industry === "all" ? "All industries" : formatLabel(agent.industry)}
                                </span>
                            </div>

                            <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-[26px]">
                                {agent.name}
                            </h2>

                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                                <span className="font-semibold text-amber-500">
                                    ★★★★★ {agent.rating.toFixed(1)}
                                </span>

                                <span className="text-slate-300">·</span>

                                <span className="text-slate-500">{agent.installs} installs</span>

                                <span className="text-slate-300">·</span>

                                <span className="text-slate-500">By {agent.author}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="overflow-y-auto px-6 py-7 sm:px-7">
                    <p className="text-[17px] leading-8 text-slate-600">
                        {agent.description}
                    </p>

                    <div className="mt-7">
                        <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-400">
                            What you get
                        </h3>

                        <div className="mt-4 space-y-3">
                            {features.map((feature) => (
                                <div key={feature} className="flex items-start gap-3">
                                    <span className="mt-0.5 text-sm font-black text-amber-500">✓</span>
                                    <p className="text-sm leading-6 text-slate-600">{feature}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {agent.requiredConnectors.length ? (
                        <div className="mt-7">
                            <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-400">
                                Required connectors
                            </h3>

                            <div className="mt-4 flex flex-wrap gap-2">
                                {agent.requiredConnectors.map((connector) => (
                                    <span
                                        key={connector}
                                        className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
                                    >
                                        {connector}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {agent.supportedLlms.length ? (
                        <div className="mt-7">
                            <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-400">
                                Supported LLMs
                            </h3>

                            <div className="mt-4 flex flex-wrap gap-2">
                                {agent.supportedLlms.map((llm) => (
                                    <span
                                        key={llm}
                                        className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600"
                                    >
                                        {llm}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>

                <div className="flex flex-col gap-4 border-t border-slate-100 bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="flex items-end gap-2">
                        <span className="text-3xl font-black tracking-tight text-slate-950">
                            ${agent.price}
                        </span>
                        <span className="pb-1 text-sm font-medium text-slate-400">one-time</span>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                            type="button"
                            onClick={onOpenAgent}
                            className="inline-flex min-w-[150px] items-center justify-center rounded-xl border-2 border-amber-500 bg-white px-5 py-3 text-sm font-bold text-amber-600 transition hover:bg-amber-50"
                        >
                            Start free trial
                        </button>

                        <button
                            type="button"
                            onClick={onOpenAgent}
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
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>

      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.label}>
            <Link
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