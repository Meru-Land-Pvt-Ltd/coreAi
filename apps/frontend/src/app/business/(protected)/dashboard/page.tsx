"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { BUSINESS_AGENTS_PATH, BUSINESS_MARKETPLACE_PATH, HELP_PATH } from "@/lib/routes";

type ApiPurchasedAgent = {
    purchaseId: string;
    purchasedAt: string;
    purchaseStatus: string;
    listing: {
        id: string;
        name: string;
        shortDescription?: string | null;
        priceCents?: number | null;
        tags?: string[];
    };
};

type MyAgentsResponse = {
    agents?: ApiPurchasedAgent[];
};

type DashboardOverview = {
    installedAgent: { name: string; status: string } | null;
    phoneNumber: { phoneNumber: string; forwardToPhone: string | null } | null;
    subscription: { status: string; active: boolean };
    counts: { leads: number; conversations: number; appointments: number };
    recentMissedCalls: { id: string; phoneNumber: string; name: string | null; status: string }[];
    calendarConnected: boolean;
};

type MetricCard = {
    label: string;
    value: string;
    subtitle: string;
    trend?: string;
    badge?: string;
    icon: IconName;
};

type Agent = {
    id: string;
    listingId: string;
    name: string;
    since: string;
    runs: string;
    cost: string;
    icon: IconName;
    purchaseStatus: string;
    isActive: boolean;
};

type Activity = {
    time: string;
    text: string;
    badge: string;
    tone: "green" | "amber" | "slate";
    check?: boolean;
};

type ChartMetric = "executions" | "revenue" | "cost";

type IconName =
    | "dashboard"
    | "bot"
    | "activity"
    | "card"
    | "settings"
    | "marketplace"
    | "help"
    | "phone"
    | "calendar"
    | "receipt"
    | "chat"
    | "clock"
    | "star"
    | "bell"
    | "plus"
    | "dollar"
    | "external"
    | "pause"
    | "stats"
    | "trash"
    | "arrowUp";


type CoreAiUser = {
    id?: string;
    fullName?: string | null;
    email?: string | null;
    role?: string | null;
    isSuspended?: boolean;
    createdAt?: string | null;
    architectProfile?: unknown;
};

function readCoreAiUser(): CoreAiUser | null {
    if (typeof window === "undefined") return null;

    try {
        const raw = localStorage.getItem("coreai-user");
        return raw ? (JSON.parse(raw) as CoreAiUser) : null;
    } catch {
        return null;
    }
}

function getDisplayName(user: CoreAiUser | null) {
    const fullName = user?.fullName?.trim();

    if (fullName) return fullName;

    if (user?.email) {
        return user.email
            .split("@")[0]
            .replace(/[._-]+/g, " ")
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    return "";
}

function getFirstName(user: CoreAiUser | null) {
    const displayName = getDisplayName(user);
    return displayName.split(" ")[0] || "";
}

function getGreeting() {
    const hour = new Date().getHours();

    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
}

function getFullDate() {
    return new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
    }).format(new Date());
}

const metrics: MetricCard[] = [
    {
        label: "Revenue Saved",
        value: "$4,280",
        subtitle: "this month · vs last month",
        trend: "23%",
        icon: "dollar"
    },
    {
        label: "Calls Handled",
        value: "147",
        subtitle: "this month · vs last month",
        trend: "18%",
        icon: "phone"
    },
    {
        label: "Appointments Booked",
        value: "34",
        subtitle: "this month · vs last month",
        trend: "12%",
        icon: "calendar"
    },
    {
        label: "Total Spend",
        value: "$62.40",
        subtitle: "execution fees this month",
        badge: "ROI 6,859%",
        icon: "receipt"
    }
];

const notifications = [
    {
        title: "New 5-star review posted",
        meta: "Google Review Booster · 6 min ago",
        icon: "star" as IconName,
        tone: "amber"
    },
    {
        title: "Agent update available",
        meta: "Missed Call Text-Back v2.1 · 2 hr ago",
        icon: "arrowUp" as IconName,
        tone: "blue"
    },
    {
        title: "January invoice is ready",
        meta: "$62.40 due Feb 1 · 1 day ago",
        icon: "card" as IconName,
        tone: "slate"
    }
];

const initialActivities: Activity[] = [
    {
        time: "2 min ago",
        text: "Missed Call Text-Back sent an SMS to (555) 012-3456",
        badge: "Reply received",
        tone: "green",
        check: true
    },
    {
        time: "8 min ago",
        text: "Appointment reminder delivered to Jordan P.",
        badge: "Confirmed",
        tone: "green",
        check: true
    },
    {
        time: "15 min ago",
        text: "Review request sent to Maria L.",
        badge: "5★ review posted",
        tone: "green"
    },
    {
        time: "32 min ago",
        text: "Missed call detected — text-back initiated",
        badge: "In progress",
        tone: "amber"
    },
    {
        time: "1 hr ago",
        text: "New patient booked a cleaning via AI chat",
        badge: "Booked",
        tone: "green",
        check: true
    },
    {
        time: "2 hr ago",
        text: "Follow-up sequence started for a new lead",
        badge: "Sent",
        tone: "slate"
    },
    {
        time: "3 hr ago",
        text: "Review request sent to Daniel R.",
        badge: "Pending",
        tone: "slate"
    },
    {
        time: "5 hr ago",
        text: "Missed Call Text-Back sent an SMS to (555) 660-1192",
        badge: "No reply yet",
        tone: "slate"
    }
];

const chartData: Record<ChartMetric, number[]> = {
    executions: [6, 8, 7, 9, 4, 3, 7, 5, 2, 6, 8, 5, 4, 9, 6, 3, 8, 10, 6, 5, 11, 9, 12, 10, 13, 7, 6, 14, 11, 15],
    revenue: [120, 180, 90, 340, 60, 0, 210, 150, 0, 130, 280, 90, 60, 360, 120, 0, 240, 420, 150, 90, 480, 300, 390, 330, 540, 180, 120, 620, 450, 680],
    cost: [0.9, 1.2, 1.05, 1.35, 0.6, 0.45, 1.05, 0.75, 0.3, 0.9, 1.2, 0.75, 0.6, 1.35, 0.9, 0.45, 1.2, 1.5, 0.9, 0.75, 1.65, 1.35, 1.8, 1.5, 1.95, 1.05, 0.9, 2.1, 1.65, 2.25]
};

const chartLabels = ["Dec 17", "Dec 23", "Dec 29", "Jan 4", "Jan 10", "Jan 15"];

function formatPurchasedDate(value: string) {
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    }).format(new Date(value));
}

function pickAgentIcon(name: string, tags: string[] = []): IconName {
    const haystack = `${name} ${tags.join(" ")}`.toLowerCase();
    if (haystack.includes("call") || haystack.includes("sms") || haystack.includes("text") || haystack.includes("chat")) {
        return "chat";
    }
    if (haystack.includes("appointment") || haystack.includes("reminder") || haystack.includes("calendar")) {
        return "clock";
    }
    if (haystack.includes("review")) {
        return "star";
    }
    return "bot";
}

function isActivePurchaseStatus(status: string) {
    const value = status.toUpperCase();
    return value === "SUCCEEDED" || value === "TRIALING";
}

function mapPurchasedToDashboardAgent(entry: ApiPurchasedAgent): Agent {
    const { listing } = entry;
    const priceCents = listing.priceCents ?? 0;

    return {
        id: entry.purchaseId,
        listingId: listing.id,
        name: listing.name,
        since: `Purchased ${formatPurchasedDate(entry.purchasedAt)}`,
        runs: "NA",
        cost: priceCents > 0 ? `$${(priceCents / 100).toFixed(0)}/mo` : "NA",
        icon: pickAgentIcon(listing.name, listing.tags ?? []),
        purchaseStatus: entry.purchaseStatus,
        isActive: isActivePurchaseStatus(entry.purchaseStatus)
    };
}

export default function BusinessDashboardPage() {
    const [bellOpen, setBellOpen] = useState(false);
    const [activeAgentMenu, setActiveAgentMenu] = useState<string | null>(null);
    const [chartMetric, setChartMetric] = useState<ChartMetric>("executions");
    const [currentUser, setCurrentUser] = useState<CoreAiUser | null>(null);
    const [fullDate, setFullDate] = useState("");
    const [overview, setOverview] = useState<DashboardOverview | null>(null);
    const [overviewState, setOverviewState] = useState<"loading" | "ready" | "error">("loading");
    const [agents, setAgents] = useState<Agent[]>([]);
    const [agentsState, setAgentsState] = useState<"loading" | "ready" | "error">("loading");

    const currentData = chartData[chartMetric];
    const maxValue = Math.max(...currentData);
    const avgValue = currentData.reduce((sum, value) => sum + value, 0) / currentData.length;

    const yAxis = useMemo(() => getYAxis(maxValue, chartMetric), [maxValue, chartMetric]);
    useEffect(() => {
        setCurrentUser(readCoreAiUser());
        setFullDate(getFullDate());
    }, []);

    useEffect(() => {
        let active = true;
        async function loadOverview() {
            const result = await apiGet<DashboardOverview>("/business/dashboard");
            if (!active) return;
            if (result.success && result.data) {
                setOverview(result.data);
                setOverviewState("ready");
            } else {
                setOverviewState("error");
            }
        }
        void loadOverview();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;

        async function loadAgents() {
            setAgentsState("loading");
            const result = await apiGet<MyAgentsResponse>("/payments/my-agents");
            if (!active) return;

            if (result.success && result.data) {
                setAgents((result.data.agents ?? []).map(mapPurchasedToDashboardAgent));
                setAgentsState("ready");
            } else {
                setAgents([]);
                setAgentsState("error");
            }
        }

        void loadAgents();

        return () => {
            active = false;
        };
    }, []);

    const userFirstName = getFirstName(currentUser);
    function closeMenus() {
        setBellOpen(false);
        setActiveAgentMenu(null);
    }

    return (
        <main className="p-5 sm:p-8">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900" data-testid="business-protected-dashboard-get-greeting-user-first-heading">
                        {getGreeting()}, {userFirstName}
                        <WaveIcon />
                    </h1>

                    <p className="mt-1 text-sm text-slate-500" data-testid="business-protected-dashboard-here-apos-s-how-your-agents-performed-text">
                        Here&apos;s how your agents performed today.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <span className="hidden items-center gap-2 rounded-full border border-green-100 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 sm:inline-flex">
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                        </span>
                        All systems operational
                    </span>

                    {fullDate ? (
                        <span className="hidden text-sm font-medium text-slate-600 md:inline" data-testid="business-protected-dashboard-full-date-text">
                            {fullDate}
                        </span>
                    ) : null}

                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => {
                                setBellOpen((open) => !open);
                                setActiveAgentMenu(null);
                            }}
                            data-testid="dashboard-notifications-toggle"
                            className="relative rounded-xl border border-gray-200 bg-white p-2.5 text-slate-600 shadow-sm transition-colors hover:border-amber-300 hover:text-amber-600"
                            aria-label="Notifications"
                            aria-haspopup="true"
                            aria-expanded={bellOpen}
                        >
                            <Icon name="bell" className="h-5 w-5" />
                            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-gray-50" data-testid="business-protected-dashboard-3-text">
                                3
                            </span>
                        </button>

                        {bellOpen ? (
                            <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl">
                                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                                    <p className="text-sm font-bold text-slate-900" data-testid="business-protected-dashboard-notifications-text">Notifications</p>
                                    <button type="button" data-testid="dashboard-mark-all-read" className="text-xs font-medium text-amber-600 hover:text-amber-700">
                                        Mark all read
                                    </button>
                                </div>

                                <div className="divide-y divide-gray-50">
                                    {notifications.map((item) => (
                                        <Link data-testid="dashboard-control-link"
                                            key={item.title}
                                            href={"#" as Route}
                                            className="flex gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
                                        >
                                            <span
                                                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.tone === "amber"
                                                    ? "bg-amber-50 text-amber-600"
                                                    : item.tone === "blue"
                                                        ? "bg-blue-50 text-blue-600"
                                                        : "bg-slate-100 text-slate-600"
                                                    }`}
                                            >
                                                <Icon name={item.icon} className="h-4 w-4" />
                                            </span>

                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-slate-800" data-testid="business-protected-dashboard-title-text">{item.title}</p>
                                                <p className="mt-0.5 text-xs text-slate-400" data-testid="business-protected-dashboard-meta-text">{item.meta}</p>
                                            </div>
                                        </Link>
                                    ))}
                                </div>

                                <Link data-testid="dashboard-view-all-notifications-link"
                                    href={"#" as Route}
                                    className="block border-t border-gray-100 px-4 py-3 text-center text-sm font-medium text-amber-600 transition-colors hover:bg-amber-50"
                                >
                                    View all notifications
                                </Link>
                            </div>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        onClick={closeMenus}
                        data-testid="dashboard-add-agent"
                        className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:bg-amber-600 hover:shadow-md"
                    >
                        <Icon name="plus" className="h-4 w-4" />
                        <span className="hidden sm:inline" data-testid="business-protected-dashboard-add-agent-text">Add Agent</span>
                    </button>
                </div>
            </div>

            <section data-testid="dashboard-overview" aria-label="Account overview" className="mb-8 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                {overviewState === "loading" ? (
                    <p data-testid="dashboard-overview-loading" className="text-sm font-medium text-slate-500">Loading your account…</p>
                ) : overviewState === "error" ? (
                    <p data-testid="dashboard-overview-error" className="text-sm font-medium text-red-600">Could not load your account data. Please refresh.</p>
                ) : (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
                        <div data-testid="dashboard-overview-subscription">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400" data-testid="business-protected-dashboard-subscription-text">Subscription</p>
                            <p className="mt-1 text-sm font-bold text-slate-900" data-testid="business-protected-dashboard-overview-subscription-active-overview-subscription-status-inactive">
                                {overview?.subscription.active ? "Active" : (overview?.subscription.status ?? "inactive")}
                            </p>
                        </div>
                        <div data-testid="dashboard-overview-agent">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400" data-testid="business-protected-dashboard-installed-agent-text">Installed agent</p>
                            <p className="mt-1 truncate text-sm font-bold text-slate-900" data-testid="business-protected-dashboard-overview-installed-agent-not-installed-text">{overview?.installedAgent?.name ?? "Not installed"}</p>
                        </div>
                        <div data-testid="dashboard-overview-number">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400" data-testid="business-protected-dashboard-core-ai-number-text">CoreAI number</p>
                            <p className="mt-1 text-sm font-bold text-slate-900" data-testid="business-protected-dashboard-overview-phone-number-phone-number-not-assigned-text">{overview?.phoneNumber?.phoneNumber ?? "Not assigned"}</p>
                        </div>
                        <div data-testid="dashboard-overview-leads">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400" data-testid="business-protected-dashboard-leads-text">Leads</p>
                            <p className="mt-1 text-sm font-bold text-slate-900" data-testid="business-protected-dashboard-overview-counts-leads-0-text">{overview?.counts.leads ?? 0}</p>
                        </div>
                        <div data-testid="dashboard-overview-conversations">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400" data-testid="business-protected-dashboard-conversations-text">Conversations</p>
                            <p className="mt-1 text-sm font-bold text-slate-900" data-testid="business-protected-dashboard-overview-counts-conversations-0-text">{overview?.counts.conversations ?? 0}</p>
                        </div>
                        <div data-testid="dashboard-overview-appointments">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400" data-testid="business-protected-dashboard-appointments-text">Appointments</p>
                            <p className="mt-1 text-sm font-bold text-slate-900" data-testid="business-protected-dashboard-overview-counts-appointments-0-text">{overview?.counts.appointments ?? 0}</p>
                        </div>
                        <div data-testid="dashboard-overview-calendar">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400" data-testid="business-protected-dashboard-calendar-text">Calendar</p>
                            <p className="mt-1 text-sm font-bold text-slate-900" data-testid="business-protected-dashboard-overview-calendar-connected-not-connected-text">{overview?.calendarConnected ? "Connected" : "Not connected"}</p>
                        </div>
                        <div data-testid="dashboard-overview-missed">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400" data-testid="business-protected-dashboard-recent-missed-calls-text">Recent missed calls</p>
                            <p className="mt-1 text-sm font-bold text-slate-900" data-testid="business-protected-dashboard-overview-recent-missed-calls-0-text">{overview?.recentMissedCalls.length ?? 0}</p>
                        </div>
                    </div>
                )}
            </section>

            <section aria-label="Key metrics" className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
                {metrics.map((metric) => (
                    <MetricCard key={metric.label} metric={metric} />
                ))}
            </section>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <div className="space-y-6 xl:col-span-2">
                    <section
                        id="agents"
                        className="scroll-mt-24 overflow-visible rounded-2xl border border-gray-100 bg-white shadow-sm"
                    >
                        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                            <h2 className="text-lg font-bold text-slate-900" data-testid="business-protected-dashboard-agents-heading">My Agents</h2>
                            <Link data-testid="dashboard-view-all-link"
                                href={BUSINESS_AGENTS_PATH}
                                className="inline-flex items-center gap-1 text-sm font-medium text-amber-600 transition-colors hover:text-amber-700"
                            >
                                View all <span aria-hidden="true">→</span>
                            </Link>
                        </div>

                        {agentsState === "loading" ? (
                            <div className="divide-y divide-gray-50" data-testid="dashboard-agents-loading">
                                {Array.from({ length: 2 }).map((_, index) => (
                                    <div key={index} className="flex animate-pulse items-center gap-4 px-6 py-5">
                                        <div className="h-11 w-11 rounded-xl bg-gray-100" />
                                        <div className="flex-1 space-y-2">
                                            <div className="h-4 w-40 rounded bg-gray-100" />
                                            <div className="h-3 w-28 rounded bg-gray-100" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : agentsState === "error" ? (
                            <div className="px-6 py-10 text-center" data-testid="dashboard-agents-error">
                                <p className="text-sm font-semibold text-slate-700">Could not load your agents</p>
                                <p className="mt-1 text-sm text-slate-500">Refresh the page or open My Agents to try again.</p>
                            </div>
                        ) : agents.length === 0 ? (
                            <div className="px-6 py-10 text-center" data-testid="dashboard-agents-empty">
                                <p className="text-sm font-semibold text-slate-700">No agents yet</p>
                                <p className="mt-1 text-sm text-slate-500">Purchase an agent from the marketplace to get started.</p>
                                <Link
                                    href={BUSINESS_MARKETPLACE_PATH}
                                    data-testid="dashboard-agents-empty-browse"
                                    className="mt-4 inline-flex rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                                >
                                    Browse marketplace
                                </Link>
                            </div>
                        ) : (
                        <div className="divide-y divide-gray-50">
                            {agents.map((agent) => (
                                <AgentRow
                                    key={agent.id}
                                    agent={agent}
                                    open={activeAgentMenu === agent.id}
                                    onToggle={() => {
                                        setActiveAgentMenu(activeAgentMenu === agent.id ? null : agent.id);
                                        setBellOpen(false);
                                    }}
                                />
                            ))}
                        </div>
                        )}
                    </section>

                    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                            <h2 className="text-lg font-bold text-slate-900" data-testid="business-protected-dashboard-agent-activity-last-30-days-heading">
                                Agent Activity{" "}
                                <span className="font-medium text-slate-400" data-testid="business-protected-dashboard-last-30-days-text">— Last 30 days</span>
                            </h2>

                            <div className="flex gap-1 rounded-xl bg-gray-50 p-1" role="tablist" aria-label="Chart metric">
                                {(["executions", "revenue", "cost"] as ChartMetric[]).map((metric) => (
                                    <button
                                        key={metric}
                                        type="button"
                                        data-testid={`dashboard-chart-metric-${metric}`}
                                        onClick={() => setChartMetric(metric)}
                                        className={`rounded-lg px-3 py-1 text-sm transition-colors duration-300 ${chartMetric === metric
                                            ? "bg-amber-50 font-semibold text-amber-700"
                                            : "font-medium text-slate-500 hover:text-slate-700"
                                            }`}
                                        role="tab"
                                        aria-selected={chartMetric === metric}
                                    >
                                        {chartLabel(metric)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <div className="flex h-64 w-12 flex-col justify-between py-0 text-right text-xs text-slate-400">
                                {yAxis.map((label) => (
                                    <span key={label} data-testid="business-protected-dashboard-label-text">{label}</span>
                                ))}
                            </div>

                            <div className="relative flex h-64 flex-1 items-end gap-1 border-b border-slate-100">
                                <div className="pointer-events-none absolute inset-x-0 top-0 flex h-full flex-col justify-between">
                                    {Array.from({ length: 5 }).map((_, index) => (
                                        <span key={index} className="h-px w-full bg-slate-100" />
                                    ))}
                                </div>

                                <div
                                    className="pointer-events-none absolute right-0 rounded bg-white/90 px-1.5 text-[11px] font-medium text-slate-400 backdrop-blur-sm"
                                    style={{
                                        bottom: `${Math.max(6, Math.min(92, (avgValue / maxValue) * 100))}%`
                                    }}
                                >
                                    avg: {formatAverage(avgValue, chartMetric)}
                                </div>

                                {currentData.map((value, index) => {
                                    const height = Math.max(2, (value / maxValue) * 100);

                                    return (
                                        <div key={`${chartMetric}-${index}`} className="group relative z-10 flex flex-1 items-end">
                                            <div
                                                className="w-full rounded-t bg-amber-300 transition-colors hover:bg-amber-500"
                                                style={{ height: `${height}%` }}
                                            />
                                            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
                                                <div className="whitespace-nowrap text-[11px] text-slate-300">
                                                    Day {index + 1}
                                                </div>
                                                <div className="whitespace-nowrap font-semibold">
                                                    {formatChartValue(value, chartMetric)}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="mt-2 flex gap-3">
                            <div className="w-12" />
                            <div className="flex flex-1 justify-between text-xs text-slate-400">
                                {chartLabels.map((label) => (
                                    <span key={label} data-testid="business-protected-dashboard-label-text-2">{label}</span>
                                ))}
                            </div>
                        </div>
                    </section>
                </div>

                <div className="space-y-6 xl:col-span-1">
                    <section
                        id="activity"
                        className="scroll-mt-24 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
                    >
                        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
                            <h2 className="font-bold text-slate-900" data-testid="business-protected-dashboard-live-activity-heading">Live Activity</h2>
                            <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-green-600">
                                <span className="relative flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                                </span>
                                Real-time
                            </span>
                        </div>

                        <div className="max-h-96 divide-y divide-gray-50 overflow-y-auto">
                            {initialActivities.map((activity, index) => (
                                <ActivityItem key={`${activity.time}-${index}`} activity={activity} />
                            ))}
                        </div>
                    </section>

                    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                        <h2 className="mb-4 font-bold text-slate-900" data-testid="business-protected-dashboard-quick-actions-heading">Quick Actions</h2>

                        <div className="flex flex-col gap-3">
                            <Link data-testid="dashboard-browse-more-agents-link"
                                href={BUSINESS_MARKETPLACE_PATH}
                                className="w-full rounded-xl border-2 border-amber-500 py-3 text-center font-semibold text-amber-600 transition-all duration-300 hover:bg-amber-500 hover:text-white"
                            >
                                Browse more agents
                            </Link>

                            <button data-testid="dashboard-view-billing" className="w-full rounded-xl border border-gray-200 py-3 text-slate-600 transition-all duration-300 hover:border-amber-300 hover:text-amber-700">
                                View billing details
                            </button>

                            <button data-testid="dashboard-pause-all-agents" className="w-full rounded-xl border border-gray-200 py-3 text-slate-600 transition-all duration-300 hover:border-red-300 hover:text-red-600">
                                Pause all agents
                            </button>
                        </div>
                    </section>

                    <section
                        id="billing"
                        className="scroll-mt-24 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-5"
                    >
                        <div className="flex items-center justify-between">
                            <h2 className="font-bold text-slate-900" data-testid="business-protected-dashboard-january-summary-heading">January summary</h2>
                            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-amber-700" data-testid="business-protected-dashboard-day-15-of-31-text">
                                Day 15 of 31
                            </span>
                        </div>

                        <div className="mt-4 space-y-3 text-sm">
                            <SummaryRow label="Missed calls recovered" value="89" />
                            <SummaryRow label="Appointments booked" value="34" />
                            <SummaryRow label="Reviews generated" value="12" />
                            <SummaryRow label="Estimated revenue" value="$4,280" green />
                        </div>

                        <div className="my-3 border-t border-amber-200" />

                        <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-900" data-testid="business-protected-dashboard-total-cost-text">Total cost</span>
                            <span className="text-sm font-bold text-slate-900" data-testid="business-protected-dashboard-62-40-text">$62.40</span>
                        </div>

                        <p className="mt-1 text-xs text-amber-700" data-testid="business-protected-dashboard-that-apos-s-just-0-42-per-text">
                            That&apos;s just $0.42 per customer interaction.
                        </p>
                    </section>
                </div>
            </div>

            <p className="mt-8 text-center text-xs text-slate-400" data-testid="business-protected-dashboard-core-ai-agent-platform-syncs-in-real-text">
                CORE AI Agent Platform · Data syncs in real time · Last updated just now
            </p>
        </main>
    );
}

function MetricCard({ metric }: { metric: MetricCard }) {
    return (
        <article className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow duration-300 hover:shadow-md">
            <div className="flex items-start justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                    <Icon name={metric.icon} className="h-5 w-5" />
                </span>

                {metric.trend ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-600" data-testid="business-protected-dashboard-metric-trend-text">
                        <TrendIcon />
                        {metric.trend}
                    </span>
                ) : null}

                {metric.badge ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-600" data-testid="business-protected-dashboard-metric-badge-text">
                        {metric.badge}
                    </span>
                ) : null}
            </div>

            <p className="mt-5 text-sm font-medium text-slate-500" data-testid="business-protected-dashboard-metric-label-text">{metric.label}</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-slate-900" data-testid="business-protected-dashboard-metric-text">
                {metric.value}
            </p>
            <p className="mt-1 text-sm text-slate-400" data-testid="business-protected-dashboard-metric-subtitle-includes-vs-last-month-this-text">
                {metric.subtitle.includes("vs last month") ? (
                    <>
                        this month · <span className="text-green-600" data-testid="business-protected-dashboard-vs-last-month-text">vs last month</span>
                    </>
                ) : (
                    metric.subtitle
                )}
            </p>
        </article>
    );
}

function AgentRow({
    agent,
    open,
    onToggle
}: {
    agent: Agent;
    open: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="group flex flex-wrap items-center gap-4 px-6 py-5 transition-colors hover:bg-gray-50">
            <span
                className="relative flex h-2.5 w-2.5 shrink-0"
                title={agent.isActive ? "Active" : "Inactive"}
                data-testid="business-protected-dashboard-active-text"
            >
                {agent.isActive ? (
                    <>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                    </>
                ) : (
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-slate-300" />
                )}
            </span>

            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <Icon name={agent.icon} className="h-5 w-5" />
            </span>

            <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900" data-testid="business-protected-dashboard-agent-text">{agent.name}</p>
                <p className="text-xs text-slate-400" data-testid="business-protected-dashboard-agent-since-text">{agent.since}</p>
            </div>

            <div className="flex items-center gap-8">
                <div className="text-right">
                    <p className="text-sm font-semibold text-slate-700" data-testid="business-protected-dashboard-agent-runs-text">{agent.runs}</p>
                    <p className="text-xs text-slate-400" data-testid="business-protected-dashboard-this-month-text">this month</p>
                </div>

                <div className="text-right">
                    <p className="text-sm font-semibold text-slate-700" data-testid="business-protected-dashboard-agent-cost-text">{agent.cost}</p>
                    <p className="text-xs text-slate-400" data-testid="business-protected-dashboard-cost-text">plan</p>
                </div>
            </div>

            <div className="relative">
                <button
                    type="button"
                    onClick={onToggle}
                    data-testid={`dashboard-agent-menu-${agent.id}`}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-gray-100 hover:text-slate-600"
                    aria-label={`Manage ${agent.name}`}
                    aria-haspopup="true"
                    aria-expanded={open}
                >
                    <Icon name="settings" className="h-5 w-5" />
                </button>

                {open ? (
                    <div className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
                        <AgentMenuButton icon="pause" label="Pause agent" />
                        <AgentMenuButton icon="stats" label="View stats" />
                        <AgentMenuButton icon="settings" label="Configure" />
                        <div className="my-1 border-t border-gray-100" />
                        <AgentMenuButton icon="trash" label="Remove" danger />
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function AgentMenuButton({
    icon,
    label,
    danger
}: {
    icon: IconName;
    label: string;
    danger?: boolean;
}) {
    return (
        <button
            type="button"
            data-testid={`dashboard-agent-action-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors ${danger ? "text-red-600 hover:bg-red-50" : "text-slate-600 hover:bg-gray-50"
                }`}
        >
            <Icon name={icon} className={`h-4 w-4 ${danger ? "" : "text-slate-400"}`} />
            {label}
        </button>
    );
}

function ActivityItem({ activity }: { activity: Activity }) {
    const toneClass =
        activity.tone === "green"
            ? "bg-green-50 text-green-700"
            : activity.tone === "amber"
                ? "bg-amber-50 text-amber-700"
                : "bg-slate-100 text-slate-600";

    return (
        <div className="px-5 py-4">
            <p className="mb-1 text-xs text-slate-400" data-testid="business-protected-dashboard-activity-time-text">{activity.time}</p>
            <p className="text-sm text-slate-700" data-testid="business-protected-dashboard-activity-text">{activity.text}</p>
            <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`} data-testid="business-protected-dashboard-activity-badge-activity-check-text">
                {activity.badge}
                {activity.check ? <CheckIcon /> : null}
            </span>
        </div>
    );
}

function SummaryRow({
    label,
    value,
    green
}: {
    label: string;
    value: string;
    green?: boolean;
}) {
    return (
        <div className="flex justify-between">
            <span className="text-slate-600" data-testid="business-protected-dashboard-label-text-3">{label}</span>
            <span data-testid={`business-dashboard-detail-value-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className={`font-semibold ${green ? "text-green-700" : "text-slate-900"}`}>
                {value}
            </span>
        </div>
    );
}

function getYAxis(max: number, metric: ChartMetric) {
    const steps = [1, 0.75, 0.5, 0.25, 0];

    return steps.map((step) => {
        const value = max * step;

        if (metric === "revenue") return `$${Math.round(value).toLocaleString()}`;
        if (metric === "cost") return `$${value.toFixed(value < 10 ? 1 : 0)}`;
        return Math.round(value).toString();
    });
}

function chartLabel(metric: ChartMetric) {
    if (metric === "executions") return "Executions";
    if (metric === "revenue") return "Revenue Saved";
    return "Cost";
}

function formatChartValue(value: number, metric: ChartMetric) {
    if (metric === "revenue") return `$${Math.round(value).toLocaleString()} saved`;
    if (metric === "cost") return `$${value.toFixed(2)}`;
    return `${Math.round(value)} executions`;
}

function formatAverage(value: number, metric: ChartMetric) {
    if (metric === "revenue") return `$${Math.round(value)}/day`;
    if (metric === "cost") return `$${value.toFixed(2)}/day`;
    return `${Math.round(value)}/day`;
}

function TrendIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

function WaveIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
            <path
                d="M7.5 13c-1.8 1.8-1.8 4.7 0 6.5s4.7 1.8 6.5 0l3.2-3.2c.6-.6.6-1.5 0-2.1s-1.5-.6-2.1 0"
                stroke="#f59e0b"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M11 9.5 8.3 6.8c-.6-.6-.6-1.5 0-2.1s1.5-.6 2.1 0L14 8.3"
                stroke="#f59e0b"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="m13.5 11 2.1-2.1c.6-.6 1.5-.6 2.1 0s.6 1.5 0 2.1L17 12"
                stroke="#f59e0b"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M2.5 11.5 4 11M5 5.5 5.8 7M9.5 2.5 9.5 4"
                stroke="#fbbf24"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    );
}

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
    const common = {
        className,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.75",
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        "aria-hidden": true
    };

    if (name === "dashboard") {
        return (
            <svg {...common}>
                <rect width="7" height="7" x="3" y="3" rx="1.5" />
                <rect width="7" height="7" x="14" y="3" rx="1.5" />
                <rect width="7" height="7" x="14" y="14" rx="1.5" />
                <rect width="7" height="7" x="3" y="14" rx="1.5" />
            </svg>
        );
    }

    if (name === "bot") {
        return (
            <svg {...common}>
                <path d="M12 8V4H8" />
                <rect width="16" height="12" x="4" y="8" rx="2.5" />
                <path d="M2 14h2" />
                <path d="M20 14h2" />
                <path d="M15 13v2" />
                <path d="M9 13v2" />
            </svg>
        );
    }

    if (name === "activity") {
        return (
            <svg {...common}>
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
        );
    }

    if (name === "card") {
        return (
            <svg {...common}>
                <rect width="20" height="14" x="2" y="5" rx="2.5" />
                <line x1="2" x2="22" y1="10" y2="10" />
            </svg>
        );
    }

    if (name === "settings") {
        return (
            <svg {...common}>
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
            </svg>
        );
    }

    if (name === "phone") {
        return (
            <svg {...common}>
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
        );
    }

    if (name === "calendar") {
        return (
            <svg {...common}>
                <rect x="3" y="4" width="18" height="18" rx="2.5" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
        );
    }

    if (name === "receipt") {
        return (
            <svg {...common}>
                <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
                <path d="M8 7h8" />
                <path d="M8 11h8" />
                <path d="M8 15h5" />
            </svg>
        );
    }

    if (name === "chat") {
        return (
            <svg {...common}>
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            </svg>
        );
    }

    if (name === "clock") {
        return (
            <svg {...common}>
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15.5 14" />
            </svg>
        );
    }

    if (name === "star") {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
        );
    }

    if (name === "bell") {
        return (
            <svg {...common}>
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
        );
    }

    if (name === "plus") {
        return (
            <svg {...common} strokeWidth="2.25">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
        );
    }

    if (name === "dollar") {
        return (
            <svg {...common} strokeWidth="2">
                <line x1="12" y1="2" x2="12" y2="22" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
        );
    }

    if (name === "pause") {
        return (
            <svg {...common} strokeWidth="2">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
        );
    }

    if (name === "stats") {
        return (
            <svg {...common} strokeWidth="2">
                <path d="M3 3v18h18" />
                <path d="m19 9-5 5-4-4-3 3" />
            </svg>
        );
    }

    if (name === "trash") {
        return (
            <svg {...common} strokeWidth="2">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
        );
    }

    return (
        <svg {...common} strokeWidth="2">
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
        </svg>
    );
}