"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { pauseInstalledAgent, resumeInstalledAgent } from "@/components/business/features/api";
import { getAuthToken, getAuthUser } from "@/lib/auth";
import {
    BUSINESS_LOGIN_PATH,
    BUSINESS_MARKETPLACE_PATH,
    businessAgentDetailPath,
    businessCheckoutPath,
    businessSetupPath
} from "@/lib/routes";

const TRIAL_DAYS = 7;

type ApiArchitectProfile = {
    title?: string | null;
    rating?: number | null;
    completedJobs?: number | null;
};

type ApiArchitect = {
    id?: string;
    fullName?: string | null;
    email?: string | null;
    architectProfile?: ApiArchitectProfile | null;
};

type ApiListing = {
    id: string;
    name: string;
    shortDescription?: string | null;
    description?: string | null;
    priceCents?: number | null;
    status?: string | null;
    tags?: string[];
    category?: string | null;
    requiredConnectors?: string[];
    supportedLlms?: string[];
    workflowId?: string | null;
    createdAt?: string;
    architect?: ApiArchitect | null;
};

type ApiPurchasedAgent = {
    purchaseId: string;
    purchasedAt: string;
    purchaseStatus: string;
    installedAgentId?: string | null;
    installedAgentStatus?: string | null;
    listing: ApiListing;
};

type MyAgentsResponse = {
    agents?: ApiPurchasedAgent[];
};

type OwnedAgent = {
    id: string;
    listingId: string;
    name: string;
    category: string;
    industry: string;
    description: string;
    price: number;
    author: string;
    tags: string[];
    purchaseStatus: string;
    purchasedAt: string;
    installedAgentId: string | null;
    installedAgentStatus: string | null;
};

/** Setup is complete once the agent was deployed (ACTIVE) — PAUSED still counts. */
function isSetupCompleted(agent: OwnedAgent) {
    const status = (agent.installedAgentStatus ?? "").toUpperCase();
    return Boolean(agent.installedAgentId) && (status === "ACTIVE" || status === "PAUSED");
}

function isAgentPaused(agent: OwnedAgent) {
    return (agent.installedAgentStatus ?? "").toUpperCase() === "PAUSED";
}

// Trial runs for TRIAL_DAYS from the purchase date. Day of purchase = 7 left,
// counting down to 0 when the trial has fully elapsed.
function getTrialInfo(purchasedAt: string, status: string) {
    const isTrial = status.toUpperCase() === "TRIALING";
    const start = new Date(purchasedAt).getTime();
    const elapsedDays = Number.isFinite(start)
        ? Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24))
        : 0;
    const daysLeft = Math.max(0, TRIAL_DAYS - elapsedDays);
    const trialEnded = isTrial && daysLeft <= 0;
    return { isTrial, daysLeft, trialEnded };
}

function normalizeFilterValue(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function formatLabel(value: string) {
    return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    if (listing.category?.trim()) {
        return formatLabel(listing.category.trim());
    }

    const tags = listing.tags ?? [];
    const categoryTag =
        tags.find((tag) => tag.toLowerCase().startsWith("category:")) ??
        tags.find((tag) => !tag.toLowerCase().startsWith("industry:"));

    if (categoryTag) return formatLabel(categoryTag.replace(/^category:/i, ""));
    return "Uncategorized";
}

function mapPurchasedAgent(entry: ApiPurchasedAgent): OwnedAgent {
    const { listing } = entry;
    const profile = listing.architect?.architectProfile;

    return {
        id: entry.purchaseId,
        listingId: listing.id,
        name: listing.name,
        category: getAgentCategory(listing),
        industry: getAgentIndustry(listing),
        description:
            listing.shortDescription ||
            listing.description ||
            "This AI agent is ready to set up for your business.",
        price: Math.round((listing.priceCents ?? 0) / 100),
        author:
            listing.architect?.fullName ||
            profile?.title ||
            listing.architect?.email ||
            "Triven Architect",
        tags: listing.tags ?? [],
        purchaseStatus: entry.purchaseStatus,
        purchasedAt: entry.purchasedAt,
        installedAgentId: entry.installedAgentId ?? null,
        installedAgentStatus: entry.installedAgentStatus ?? null
    };
}

function statusBadge(status: string) {
    const value = status.toUpperCase();
    if (value === "SUCCEEDED") return { label: "Active", className: "bg-green-50 text-green-700" };
    if (value === "TRIALING") return { label: "Trial", className: "bg-amber-50 text-amber-700" };
    if (value === "PENDING") return { label: "Pending", className: "bg-blue-50 text-blue-700" };
    return { label: formatLabel(value), className: "bg-gray-100 text-slate-600" };
}

export default function BusinessMyAgentsPage() {
    const router = useRouter();

    const [authReady, setAuthReady] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [apiError, setApiError] = useState("");
    const [agents, setAgents] = useState<OwnedAgent[]>([]);

    useEffect(() => {
        const token = getAuthToken();
        const user = getAuthUser();

        if (!token || user?.role !== "BUSINESS") {
            router.replace(BUSINESS_LOGIN_PATH);
            return;
        }

        setAuthReady(true);
    }, [router]);

    useEffect(() => {
        if (!authReady) return;

        let mounted = true;

        async function loadAgents() {
            try {
                setIsLoading(true);
                setApiError("");

                const response = await apiGet<MyAgentsResponse>("/payments/my-agents");

                if (!mounted) return;

                if (!response.success) {
                    setApiError(response.error ?? "Could not load your agents");
                    setAgents([]);
                    return;
                }

                setAgents((response.data?.agents ?? []).map(mapPurchasedAgent));
            } catch (error) {
                if (!mounted) return;
                setApiError(error instanceof Error ? error.message : "Could not load your agents");
                setAgents([]);
            } finally {
                if (mounted) setIsLoading(false);
            }
        }

        loadAgents();

        return () => {
            mounted = false;
        };
    }, [authReady]);

    function setupAgent(agent: OwnedAgent) {
        router.push(businessSetupPath(agent.listingId));
    }

    function payAgent(agent: OwnedAgent) {
        router.push(businessCheckoutPath(agent.listingId));
    }

    function openAgent(agent: OwnedAgent) {
        router.push(businessAgentDetailPath(agent.listingId));
    }

    /** Pause ⇄ resume, reflecting the new status on the card immediately. */
    async function togglePause(agent: OwnedAgent): Promise<string | null> {
        if (!agent.installedAgentId) return "This agent has not been deployed yet.";

        const response = isAgentPaused(agent)
            ? await resumeInstalledAgent(agent.installedAgentId)
            : await pauseInstalledAgent(agent.installedAgentId);

        if (!response.success || !response.data) {
            return response.error ?? "Could not update the agent.";
        }

        const nextStatus = response.data.status;
        setAgents((current) =>
            current.map((item) =>
                item.installedAgentId === agent.installedAgentId
                    ? { ...item, installedAgentStatus: nextStatus }
                    : item
            )
        );
        return null;
    }

    if (!authReady) {
        return <main className="min-h-screen bg-gray-50" />;
    }

    return (
        <main className="min-h-screen bg-gray-50 text-slate-900">
            <div className="mx-auto max-w-full px-4 py-8 sm:px-6 lg:px-8">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight text-slate-900" data-testid="business-my-agents-heading">
                            My Agents
                        </h1>
                        <p className="mt-1 text-sm text-slate-500" data-testid="business-my-agents-subtitle">
                            Agents you&apos;ve purchased. Set each one up to put it to work.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => router.push(BUSINESS_MARKETPLACE_PATH)}
                        data-testid="business-my-agents-browse-marketplace"
                        className="inline-flex items-center gap-2 self-start rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600 sm:self-auto"
                    >
                        Browse marketplace
                    </button>
                </div>

                <div className="mt-8">
                    {isLoading ? (
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            {Array.from({ length: 3 }).map((_, index) => (
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
                            <h3 className="mt-4 text-lg font-semibold text-slate-900" data-testid="business-my-agents-error-heading">
                                Could not load your agents
                            </h3>
                            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500" data-testid="business-my-agents-error-text">
                                {apiError}
                            </p>
                        </div>
                    ) : agents.length ? (
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            {agents.map((agent) => (
                                <OwnedAgentCard
                                    key={agent.id}
                                    agent={agent}
                                    onSetup={() => setupAgent(agent)}
                                    onPay={() => payAgent(agent)}
                                    onOpen={() => openAgent(agent)}
                                    onTogglePause={() => togglePause(agent)}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
                            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl">
                                🤖
                            </div>
                            <h3 className="mt-4 text-lg font-semibold text-slate-900" data-testid="business-my-agents-empty-heading">
                                No agents yet
                            </h3>
                            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500" data-testid="business-my-agents-empty-text">
                                Agents you purchase from the marketplace will appear here, ready to set up.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}

function OwnedAgentCard({
    agent,
    onSetup,
    onPay,
    onOpen,
    onTogglePause
}: {
    agent: OwnedAgent;
    onSetup: () => void;
    onPay: () => void;
    onOpen: () => void;
    /** Resolves with an error message, or null on success. */
    onTogglePause: () => Promise<string | null>;
}) {
    const { isTrial, daysLeft, trialEnded } = getTrialInfo(agent.purchasedAt, agent.purchaseStatus);
    const setupCompleted = isSetupCompleted(agent);
    const paused = isAgentPaused(agent);
    const badge = trialEnded
        ? { label: "Trial ended", className: "bg-red-50 text-red-700" }
        : paused
          ? { label: "Paused", className: "bg-gray-100 text-slate-600" }
          : statusBadge(agent.purchaseStatus);

    const [menuOpen, setMenuOpen] = useState(false);
    const [pausing, setPausing] = useState(false);
    const [menuError, setMenuError] = useState("");
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!menuOpen) return;

        function onPointerDown(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        }

        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [menuOpen]);

    async function handleTogglePause() {
        setPausing(true);
        setMenuError("");
        const error = await onTogglePause();
        setPausing(false);
        if (error) {
            setMenuError(error);
            return;
        }
        setMenuOpen(false);
    }

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
            data-testid={`business-my-agent-card-${agent.listingId}`}
            className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl"
        >
            <div className="flex-1 p-6">
                <div className="flex items-start justify-between gap-2">
                    <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-50 text-xl ring-1 ring-amber-100">
                        🤖
                    </span>

                    <div className="flex items-center gap-2">
                        <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}
                            data-testid="business-my-agent-status-text"
                        >
                            {badge.label}
                        </span>
                        <span className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white" data-testid="business-my-agent-price-text">
                            ${agent.price}
                        </span>

                        {setupCompleted ? (
                            <div ref={menuRef} className="relative">
                                <button
                                    type="button"
                                    aria-label="Agent actions"
                                    aria-haspopup="menu"
                                    aria-expanded={menuOpen}
                                    data-testid={`business-my-agent-menu-${agent.listingId}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setMenuError("");
                                        setMenuOpen((open) => !open);
                                    }}
                                    className="grid h-8 w-8 place-items-center rounded-lg text-lg font-bold leading-none text-slate-400 transition hover:bg-gray-100 hover:text-slate-700"
                                >
                                    ⋮
                                </button>

                                {menuOpen ? (
                                    <div
                                        role="menu"
                                        data-testid={`business-my-agent-menu-dropdown-${agent.listingId}`}
                                        className="absolute right-0 top-9 z-20 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-xl"
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        <button
                                            type="button"
                                            role="menuitem"
                                            data-testid={`business-my-agent-menu-edit-${agent.listingId}`}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onSetup();
                                            }}
                                            className="block w-full px-4 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-gray-50"
                                        >
                                            Edit Configuration
                                        </button>

                                        <button
                                            type="button"
                                            role="menuitem"
                                            disabled={pausing}
                                            data-testid={`business-my-agent-menu-pause-${agent.listingId}`}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void handleTogglePause();
                                            }}
                                            className="block w-full px-4 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-gray-50 disabled:opacity-50"
                                        >
                                            {pausing ? "Updating…" : paused ? "Resume Agent" : "Pause Agent"}
                                        </button>

                                        <button
                                            type="button"
                                            role="menuitem"
                                            data-testid={`business-my-agent-menu-view-${agent.listingId}`}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onOpen();
                                            }}
                                            className="block w-full px-4 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-gray-50"
                                        >
                                            View details
                                        </button>

                                        {menuError ? (
                                            <p
                                                className="px-4 py-2 text-xs font-semibold text-red-600"
                                                data-testid={`business-my-agent-menu-error-${agent.listingId}`}
                                            >
                                                {menuError}
                                            </p>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </div>

                <h3 className="mt-4 text-lg font-bold text-slate-900" data-testid="business-my-agent-name-heading">
                    {agent.name}
                </h3>

                <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-slate-600" data-testid="business-my-agent-category-text">
                        {agent.category}
                    </span>
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700" data-testid="business-my-agent-industry-text">
                        {agent.industry === "all" ? "All industries" : formatLabel(agent.industry)}
                    </span>
                </div>

                <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600" data-testid="business-my-agent-description-text">
                    {agent.description}
                </p>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-gray-50 bg-gray-50/60 px-6 py-3">
                <span className="truncate text-xs text-slate-500" data-testid="business-my-agent-author-text">
                    by {agent.author}
                </span>
            </div>

            <div className="px-6 pb-6 pt-4">
                {trialEnded ? (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onPay();
                        }}
                        data-testid={`business-my-agent-pay-${agent.listingId}`}
                        className="w-full rounded-xl bg-amber-500 py-2.5 font-semibold text-white transition hover:-translate-y-0.5 hover:bg-amber-600"
                    >
                        Pay To Continue
                    </button>
                ) : setupCompleted ? (
                    // Setup is done — the ⋮ menu above replaces the Setup button.
                    <p
                        className={`rounded-xl py-2.5 text-center text-sm font-semibold ${
                            paused ? "bg-gray-100 text-slate-500" : "bg-green-50 text-green-700"
                        }`}
                        data-testid={`business-my-agent-live-status-${agent.listingId}`}
                    >
                        {paused ? "Paused — not answering calls or texts" : "Live and answering"}
                    </p>
                ) : (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onSetup();
                        }}
                        data-testid={`business-my-agent-setup-${agent.listingId}`}
                        className="w-full rounded-xl bg-amber-500 py-2.5 font-semibold text-white transition hover:-translate-y-0.5 hover:bg-amber-600"
                    >
                        Setup
                    </button>
                )}

                {isTrial ? (
                    <p
                        className={`mt-2 text-center text-xs font-semibold ${trialEnded ? "text-red-600" : "text-slate-500"}`}
                        data-testid={`business-my-agent-days-left-${agent.listingId}`}
                    >
                        {daysLeft} {daysLeft === 1 ? "day" : "days"} left
                    </p>
                ) : null}
            </div>
        </article>
    );
}
