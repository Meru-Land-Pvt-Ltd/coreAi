"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { CallRecordingPlayer } from "@/components/common/call-recording-player";
import { pauseInstalledAgent, resumeInstalledAgent } from "@/components/business/features/api";
import { AgentPauseConfirmationModal } from "@/components/business/agent-pause-confirmation-modal";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { BUSINESS_AGENTS_PATH, BUSINESS_BILLING_PATH, BUSINESS_MARKETPLACE_PATH, HELP_PATH, businessSetupPath, businessAgentDetailPath } from "@/lib/routes";

type ApiPurchasedAgent = {
    purchaseId: string;
    purchasedAt: string;
    purchaseStatus: string;
    isTrial?: boolean;
    installedAgentId?: string | null;
    installedAgentStatus?: string | null;
    stats?: {
        runsThisMonth: number;
        costThisMonthMicroUsd: number;
    };
    listing: {
        id: string;
        name: string;
        shortDescription?: string | null;
        priceCents?: number | null;
        tags?: string[];
        iconUrl?: string | null;
        trialDays?: number | null;
    };
};

type MyAgentsResponse = {
    agents?: ApiPurchasedAgent[];
};

type DashboardBooking = {
    id: string;
    customerName: string | null;
    customerPhone: string;
    service: string | null;
    startAt: string;
    endAt: string;
    timeZone: string | null;
    status: string;
    onCalendar: boolean;
    calendarEventLink?: string | null;
    createdAt: string;
};

type ActivityChartDay = {
    date: string;
    executions: number;
    bookings: number;
    costMicroUsd: number;
};

type DashboardBookings = {
    month: string;
    total: number;
    upcoming: number;
    agentName?: string | null;
    calendarConnected?: boolean;
    items: DashboardBooking[];
};

type DashboardMonthlyMetrics = {
    callsHandled: number;
    callsHandledPrevMonth: number;
    bookings: number;
    bookingsPrevMonth: number;
};

type DashboardOverview = {
    installedAgent: { name: string; status: string } | null;
    phoneNumber: { phoneNumber: string; forwardToPhone: string | null } | null;
    subscription: { status: string; active: boolean };
    counts: { leads: number; conversations: number; appointments: number };
    monthlyMetrics?: DashboardMonthlyMetrics;
    recentMissedCalls: { id: string; phoneNumber: string; name: string | null; status: string }[];
    bookings?: DashboardBookings;
    activityChart?: { days: ActivityChartDay[] };
    agentActivity?: DashboardActivityApi[];
    callHistory?: DashboardCallHistoryItem[];
    executions?: DashboardExecutionItem[];
    calendarConnected: boolean;
    totalSpendCents?: number;
    activities?: DashboardActivityApi[];
};

type DashboardActivityApi = {
    id: string;
    type: string;
    text: string;
    badge: string;
    tone: "green" | "amber" | "slate";
    check?: boolean;
    createdAt: string;
    /** Call recording playback URL — present only when recording was enabled for the call. */
    recordingUrl?: string | null;
    /** VapiCall row id — lets the client mint a fresh recording URL at play time. */
    vapiCallId?: string | null;
};

type DashboardCallHistoryItem = {
    id: string;
    customerPhone: string;
    direction: "inbound" | "outbound";
    status: string;
    durationSeconds: number | null;
    recordingUrl: string | null;
    summary: string | null;
    createdAt: string;
};

type DashboardExecutionItem = {
    id: string;
    status: string;
    workflowName: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    errorMessage: string | null;
    externalCallId: string | null;
};

type MetricCard = {
    label: string;
    value: string;
    subtitle: string;
    trend?: string;
    badge?: string;
    icon: IconName;
    /** Metric definition shown on hover — keeps counts explainable. */
    tooltip?: string;
};

type Agent = {
    id: string;
    listingId: string;
    name: string;
    since: string;
    runs: string;
    cost: string;
    icon: IconName;
    iconUrl?: string | null;
    purchaseStatus: string;
    trialEnded: boolean;
    isActive: boolean;
    installedAgentId?: string | null;
    installedAgentStatus?: string | null;
};

type Activity = {
    time: string;
    text: string;
    badge: string;
    tone: "green" | "amber" | "slate";
    check?: boolean;
    recordingUrl?: string | null;
    vapiCallId?: string | null;
};

type ChartMetric = "executions" | "cost";

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
        label: "Calls Handled",
        value: "0",
        subtitle: "this month · vs last month",
        trend: "0%",
        icon: "phone",
        tooltip: "Unique live phone/browser-call sessions handled by your agents, plus captured missed calls. Test and preview calls are excluded."
    },
    {
        label: "Appointments Booked",
        value: "0",
        subtitle: "this month · vs last month",
        trend: "0%",
        icon: "calendar"
    },
    {
        label: "Total Spend",
        value: "$0.00",
        subtitle: "All time",
        icon: "receipt"
    }
];



function formatCurrencyCents(cents: number) {
    return `$${(cents / 100).toFixed(2)}`;
}

function formatTrend(current: number, previous: number) {
    if (previous === 0) return current > 0 ? "+100%" : "0%";
    const change = Math.round(((current - previous) / previous) * 100);
    return `${change > 0 ? "+" : ""}${change}%`;
}

function formatRelativeTime(iso: string) {
    const timestamp = new Date(iso).getTime();
    if (Number.isNaN(timestamp)) return "Recently";

    const diffMs = Date.now() - timestamp;
    const minutes = Math.floor(diffMs / 60000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

    return formatPurchasedDate(iso);
}

const CHART_DAYS = 30;

function fallbackChartDays(): ActivityChartDay[] {
    const today = new Date();
    return Array.from({ length: CHART_DAYS }, (_, index) => {
        const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (CHART_DAYS - 1 - index)));
        return { date: day.toISOString().slice(0, 10), executions: 0, bookings: 0, costMicroUsd: 0 };
    });
}

function chartMetricValue(day: ActivityChartDay, metric: ChartMetric) {
    if (metric === "executions") return day.executions;
    if (metric === "cost") return day.costMicroUsd / 1_000_000;
    return 0;
}

function formatChartDate(isoDate: string) {
    const date = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return isoDate;
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

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

function isTrialEnded(
    purchasedAt: string,
    status: string,
    isTrialProp?: boolean,
    trialDaysLimit?: number | null
) {
    const normalizedStatus = status.toUpperCase();
    const isTrial = normalizedStatus !== "SUCCEEDED" && (normalizedStatus === "TRIALING" || isTrialProp === true);
    if (!isTrial) return false;

    const trialDays = trialDaysLimit && trialDaysLimit > 0 ? trialDaysLimit : 7;
    const start = new Date(purchasedAt).getTime();
    const elapsedDays = Number.isFinite(start)
        ? Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24))
        : 0;

    return normalizedStatus === "FAILED" || normalizedStatus === "CANCELED" || elapsedDays >= trialDays;
}

function formatUsageCostUsd(microUsd: number): string {
    if (microUsd <= 0) return "$0.00";
    return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

function mapPurchasedToDashboardAgent(entry: ApiPurchasedAgent): Agent {
    const { listing } = entry;
    const runsThisMonth = entry.stats?.runsThisMonth ?? 0;
    const costMicroUsd = entry.stats?.costThisMonthMicroUsd ?? 0;
    const trialEnded = isTrialEnded(
        entry.purchasedAt,
        entry.purchaseStatus,
        entry.isTrial,
        entry.listing.trialDays
    );
    const installedAgentStatus = (entry.installedAgentStatus ?? "").toUpperCase();

    return {
        id: entry.purchaseId,
        listingId: listing.id,
        name: listing.name,
        since: `Purchased ${formatPurchasedDate(entry.purchasedAt)}`,
        runs: String(runsThisMonth),
        cost: formatUsageCostUsd(costMicroUsd),
        icon: pickAgentIcon(listing.name, listing.tags ?? []),
        iconUrl: listing.iconUrl?.trim() || null,
        purchaseStatus: entry.purchaseStatus,
        trialEnded,
        isActive: isActivePurchaseStatus(entry.purchaseStatus) && !trialEnded && installedAgentStatus === "ACTIVE",
        installedAgentId: entry.installedAgentId ?? null,
        installedAgentStatus: entry.installedAgentStatus ?? null
    };
}

export default function BusinessDashboardPage() {
    const router = useRouter();
    const [bellOpen, setBellOpen] = useState(false);
    const [activeAgentMenu, setActiveAgentMenu] = useState<string | null>(null);
    const [chartMetric, setChartMetric] = useState<ChartMetric>("executions");
    const [currentUser, setCurrentUser] = useState<CoreAiUser | null>(null);
    const [fullDate, setFullDate] = useState("");
    const [overview, setOverview] = useState<DashboardOverview | null>(null);
    const [overviewState, setOverviewState] = useState<"loading" | "ready" | "error">("loading");
    const [agents, setAgents] = useState<Agent[]>([]);
    const [agentsState, setAgentsState] = useState<"loading" | "ready" | "error">("loading");

    const chartDays = useMemo(() => {
        const days = overview?.activityChart?.days ?? [];
        return days.length > 0 ? days : fallbackChartDays();
    }, [overview?.activityChart?.days]);

    const currentData = useMemo(
        () => chartDays.map((day) => chartMetricValue(day, chartMetric)),
        [chartDays, chartMetric]
    );
    const maxValue = Math.max(...currentData, 1);

    const chartLabels = useMemo(() => {
        if (chartDays.length === 0) return [];
        const labelCount = 6;
        return Array.from({ length: labelCount }, (_, index) => {
            const dayIndex = Math.round((index * (chartDays.length - 1)) / (labelCount - 1));
            return formatChartDate(chartDays[dayIndex]?.date ?? "");
        });
    }, [chartDays]);

    const yAxis = useMemo(() => getYAxis(maxValue, chartMetric), [maxValue, chartMetric]);

    const dashboardMetrics = useMemo(() => {
        const totalSpendCents = overview?.totalSpendCents ?? 0;
        const monthly = overview?.monthlyMetrics;
        const bookingsThisMonth = monthly?.bookings ?? overview?.bookings?.total ?? 0;
        const callsHandled = monthly?.callsHandled ?? 0;

        return metrics.map((metric) => {
            if (metric.label === "Total Spend") {
                return { ...metric, value: formatCurrencyCents(totalSpendCents) };
            }
            if (metric.label === "Appointments Booked") {
                return {
                    ...metric,
                    value: String(bookingsThisMonth),
                    trend: formatTrend(bookingsThisMonth, monthly?.bookingsPrevMonth ?? 0)
                };
            }
            if (metric.label === "Calls Handled") {
                return {
                    ...metric,
                    value: String(callsHandled),
                    trend: formatTrend(callsHandled, monthly?.callsHandledPrevMonth ?? 0)
                };
            }
            return metric;
        });
    }, [overview?.totalSpendCents, overview?.bookings?.total, overview?.monthlyMetrics]);

    const liveActivities = useMemo(
        () =>
            (overview?.activities ?? []).map((activity) => ({
                id: activity.id,
                time: formatRelativeTime(activity.createdAt),
                text: activity.text,
                badge: activity.badge,
                tone: activity.tone,
                check: activity.check,
                recordingUrl: activity.recordingUrl ?? null,
                vapiCallId: activity.vapiCallId ?? null
            })),
        [overview?.activities]
    );

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

    function setupAgent(agent: Agent) {
        router.push(businessSetupPath(agent.listingId));
    }

    function openAgent(agent: Agent) {
        router.push(businessAgentDetailPath(agent.listingId));
    }

    async function togglePause(agent: Agent): Promise<string | null> {
        if (!agent.installedAgentId) return "This agent has not been deployed yet.";

        const isPaused = (agent.installedAgentStatus ?? "").toUpperCase() === "PAUSED";
        const response = isPaused
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

    function closeMenus() {
        setBellOpen(false);
        setActiveAgentMenu(null);
    }

    return (
        <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5">
            <BusinessPageHeader
                className="-mx-3 -mt-3 mb-6 sm:-mx-4 sm:-mt-4 sm:mb-8 lg:-mx-5 lg:-mt-5"
                title={(
                    <span className="flex flex-wrap items-center gap-2" data-testid="business-protected-dashboard-get-greeting-user-first-heading">
                        <span className="min-w-0 truncate">{getGreeting()}, {userFirstName}</span>
                        <WaveIcon />
                    </span>
                )}
                description={(
                    <span data-testid="business-protected-dashboard-here-apos-s-how-your-agents-performed-text">
                        Here&apos;s how your agents performed today.
                    </span>
                )}
                actions={(
                    <>
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

                    <Link
                        href={BUSINESS_MARKETPLACE_PATH}
                        onClick={closeMenus}
                        data-testid="dashboard-add-agent"
                        className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:bg-amber-600 hover:shadow-md sm:px-5"
                    >
                        <Icon name="plus" className="h-4 w-4" />
                        <span className="hidden sm:inline" data-testid="business-protected-dashboard-add-agent-text">Add Agent</span>
                    </Link>
                    </>
                )}
            />

            <section aria-label="Key metrics" className="mb-6 grid grid-cols-1 gap-4 sm:mb-8 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
                {dashboardMetrics.map((metric) => (
                    <MetricCard key={metric.label} metric={metric} />
                ))}
            </section>

            <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
                <div className="min-w-0 space-y-4 sm:space-y-6 xl:col-span-2">
                    <section
                        id="agents"
                        className="scroll-mt-24 overflow-visible rounded-2xl border border-gray-100 bg-white shadow-sm"
                    >
                        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-6">
                            <h2 className="text-base font-bold text-slate-900 sm:text-lg" data-testid="business-protected-dashboard-agents-heading">My Agents</h2>
                            <Link data-testid="dashboard-view-all-link"
                                href={BUSINESS_AGENTS_PATH}
                                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-amber-600 transition-colors hover:text-amber-700"
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
                                    onSetup={() => setupAgent(agent)}
                                    onOpen={() => openAgent(agent)}
                                    onTogglePause={() => togglePause(agent)}
                                />
                            ))}
                        </div>
                        )}
                    </section>

                    <section
                        id="bookings"
                        className="scroll-mt-24 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
                        data-testid="dashboard-bookings-section"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-6">
                            <div className="min-w-0">
                                <h2 className="text-base font-bold text-slate-900 sm:text-lg" data-testid="dashboard-bookings-heading">
                                    Bookings{" "}
                                    <span className="font-medium text-slate-400" data-testid="dashboard-bookings-month-label">
                                        {formatBookingsMonth(overview?.bookings?.month)}
                                    </span>
                                </h2>
                                {overview?.bookings?.agentName ? (
                                    <p className="mt-0.5 text-xs text-slate-400" data-testid="dashboard-bookings-agent-name">
                                        Booked by agents via Google Calendar
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-4">
                                <div className="text-right">
                                    <p className="text-2xl font-black tracking-tight text-slate-900" data-testid="dashboard-bookings-total">
                                        {overview?.bookings?.total ?? 0}
                                    </p>
                                    <p className="text-xs text-slate-400" data-testid="dashboard-bookings-total-label">total this month</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-2xl font-black tracking-tight text-green-600" data-testid="dashboard-bookings-upcoming">
                                        {overview?.bookings?.upcoming ?? 0}
                                    </p>
                                    <p className="text-xs text-slate-400" data-testid="dashboard-bookings-upcoming-label">upcoming</p>
                                </div>
                            </div>
                        </div>

                        {overviewState === "loading" ? (
                            <div className="divide-y divide-gray-50" data-testid="dashboard-bookings-loading">
                                {Array.from({ length: 3 }).map((_, index) => (
                                    <div key={index} className="flex animate-pulse items-center gap-4 px-6 py-4">
                                        <div className="h-10 w-10 rounded-xl bg-gray-100" />
                                        <div className="flex-1 space-y-2">
                                            <div className="h-4 w-44 rounded bg-gray-100" />
                                            <div className="h-3 w-32 rounded bg-gray-100" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (overview?.bookings?.items?.length ?? 0) === 0 ? (
                            <div className="px-6 py-10 text-center" data-testid="dashboard-bookings-empty">
                                <p className="text-sm font-semibold text-slate-700">No bookings yet this month</p>
                                <p className="mt-1 text-sm text-slate-500">
                                    When your agent books an appointment for a caller, it will appear here.
                                </p>
                            </div>
                        ) : (
                            <div className="max-h-96 divide-y divide-gray-50 overflow-y-auto" data-testid="dashboard-bookings-list">
                                {(overview?.bookings?.items ?? []).map((booking) => (
                                    <BookingRow key={booking.id} booking={booking} />
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="min-w-0 overflow-x-hidden rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
                            <h2 className="text-base font-bold text-slate-900 sm:text-lg" data-testid="business-protected-dashboard-agent-activity-last-30-days-heading">
                                Agent Activity{" "}
                                <span className="font-medium text-slate-400" data-testid="business-protected-dashboard-last-30-days-text">Last 30 days</span>
                            </h2>

                            <div className="flex gap-1 rounded-xl bg-gray-50 p-1" role="tablist" aria-label="Chart metric">
                                {(["executions", "cost"] as ChartMetric[]).map((metric) => (
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

                        <div className="flex min-w-0 gap-2 sm:gap-3">
                            <div className="flex h-48 w-10 shrink-0 flex-col justify-between py-0 text-right text-[10px] text-slate-400 sm:h-64 sm:w-12 sm:text-xs">
                                {yAxis.map((label, index) => (
                                    <span key={`${index}-${label}`} data-testid="business-protected-dashboard-label-text">{label}</span>
                                ))}
                            </div>

                            <div className="relative flex h-48 min-w-0 flex-1 items-end gap-0.5 border-b border-slate-100 sm:h-64 sm:gap-1">
                                <div className="pointer-events-none absolute inset-x-0 top-0 flex h-full flex-col justify-between">
                                    {Array.from({ length: 5 }).map((_, index) => (
                                        <span key={index} className="h-px w-full bg-slate-100" />
                                    ))}
                                </div>

                                {currentData.map((value, index) => {
                                    const height = Math.max(2, (value / maxValue) * 100);

                                    return (
                                        <div key={`${chartMetric}-${index}`} className="group relative z-10 flex h-full flex-1 items-end">
                                            <div
                                                className="w-full rounded-t bg-amber-300 transition-colors hover:bg-amber-500"
                                                style={{ height: `${height}%` }}
                                            />
                                            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
                                                <div className="whitespace-nowrap text-[11px] text-slate-300">
                                                    {formatChartDate(chartDays[index]?.date ?? "") || `Day ${index + 1}`}
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

                        <div className="mt-2 flex min-w-0 gap-2 sm:gap-3">
                            <div className="w-10 shrink-0 sm:w-12" />
                            <div className="flex min-w-0 flex-1 justify-between text-[10px] text-slate-400 sm:text-xs">
                                {chartLabels.map((label, index) => (
                                    <span key={`${index}-${label}`} data-testid="business-protected-dashboard-label-text-2">{label}</span>
                                ))}
                            </div>
                        </div>

                    </section>

                    {/* Call history — real inbound/outbound phone calls only, with recordings. */}
                    <section
                        id="call-history"
                        className="scroll-mt-24 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
                        data-testid="dashboard-call-history"
                    >
                        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-4 sm:px-5">
                            <h2 className="font-bold text-slate-900" data-testid="dashboard-call-history-heading">Call history</h2>
                            <span className="ml-auto text-xs font-medium text-slate-400">Inbound &amp; outbound calls</span>
                        </div>
                        {(overview?.callHistory ?? []).length === 0 ? (
                            <p className="px-5 py-8 text-center text-sm font-medium text-slate-400" data-testid="dashboard-call-history-empty">
                                No calls yet — they appear here as soon as your agent handles one.
                            </p>
                        ) : (
                            <div className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
                                {(overview?.callHistory ?? []).map((call) => (
                                    <div key={call.id} className="px-4 py-3.5 sm:px-5" data-testid="dashboard-call-history-row">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span
                                                aria-hidden="true"
                                                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                                                    call.direction === "outbound"
                                                        ? "bg-blue-50 text-blue-600"
                                                        : "bg-green-50 text-green-600"
                                                }`}
                                            >
                                                {call.direction === "outbound" ? "↗" : "↙"}
                                            </span>
                                            <span className="text-sm font-semibold text-slate-800" data-testid="dashboard-call-history-phone">
                                                {call.customerPhone || "Unknown caller"}
                                            </span>
                                            <span className="text-xs capitalize text-slate-400">{call.direction}</span>
                                            <span className="ml-auto text-xs text-slate-400">{formatRelativeTime(call.createdAt)}</span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 pl-8 text-xs text-slate-500">
                                            {call.durationSeconds ? <span>{formatCallDuration(call.durationSeconds)}</span> : null}
                                            {call.summary ? <span className="min-w-0 flex-1 truncate">{call.summary}</span> : null}
                                        </div>
                                        {call.recordingUrl ? (
                                            <div className="mt-2 pl-8">
                                                <CallRecordingPlayer
                                                    src={call.recordingUrl}
                                                    refreshPath={`/business/calls/${call.id}/recording-url`}
                                                    testIdPrefix="dashboard-call-history-recording"
                                                />
                                            </div>
                                        ) : (
                                            <p className="mt-1 pl-8 text-xs text-slate-300" data-testid="dashboard-call-history-no-recording">
                                                No recording for this call
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Executions — one workflow run per handled live call. */}
                    <section
                        id="executions"
                        className="scroll-mt-24 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
                        data-testid="dashboard-executions"
                    >
                        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-4 sm:px-5">
                            <h2 className="font-bold text-slate-900" data-testid="dashboard-executions-heading">Executions</h2>
                            <span className="ml-auto text-xs font-medium text-slate-400">Live workflow runs</span>
                        </div>
                        {(overview?.executions ?? []).length === 0 ? (
                            <p className="px-5 py-8 text-center text-sm font-medium text-slate-400" data-testid="dashboard-executions-empty">
                                No executions yet.
                            </p>
                        ) : (
                            <div className="max-h-80 divide-y divide-gray-100 overflow-y-auto">
                                {(overview?.executions ?? []).map((run) => (
                                    <div key={run.id} className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5" data-testid="dashboard-execution-row">
                                        <span
                                            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                                run.status === "COMPLETED"
                                                    ? "bg-green-50 text-green-700"
                                                    : run.status === "FAILED"
                                                        ? "bg-rose-50 text-rose-700"
                                                        : "bg-amber-50 text-amber-700"
                                            }`}
                                            data-testid="dashboard-execution-status"
                                        >
                                            {run.status === "COMPLETED" ? "Completed" : run.status === "FAILED" ? "Failed" : "Running"}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{run.workflowName}</span>
                                        {run.durationMs ? (
                                            <span className="text-xs text-slate-400">{formatCallDuration(Math.round(run.durationMs / 1000))}</span>
                                        ) : null}
                                        <span className="text-xs text-slate-400">{formatRelativeTime(run.startedAt)}</span>
                                        {run.errorMessage ? (
                                            <p className="w-full truncate text-xs text-rose-500">{run.errorMessage}</p>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>

                <div className="min-w-0 space-y-4 sm:space-y-6 xl:col-span-1">
                    <section
                        id="activity"
                        className="scroll-mt-24 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
                    >
                        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-4 sm:px-5">
                            <h2 className="font-bold text-slate-900" data-testid="business-protected-dashboard-live-activity-heading">Live Activity</h2>
                            <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-green-600">
                                <span className="relative flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                                </span>
                                Real-time
                            </span>
                        </div>

                        {overviewState === "loading" ? (
                            <div className="max-h-96 divide-y divide-gray-100 overflow-y-auto" data-testid="dashboard-activity-loading">
                                {Array.from({ length: 4 }).map((_, index) => (
                                    <div key={index} className="animate-pulse space-y-2 px-5 py-4">
                                        <div className="h-3 w-16 rounded bg-gray-100" />
                                        <div className="h-4 w-full rounded bg-gray-100" />
                                        <div className="h-5 w-24 rounded-full bg-gray-100" />
                                    </div>
                                ))}
                            </div>
                        ) : liveActivities.length === 0 ? (
                            <div className="flex h-96 items-center justify-center overflow-y-auto px-5 text-center">
                                <p className="text-sm font-medium text-slate-400" data-testid="business-protected-dashboard-no-activity-text">
                                    No Activity Found
                                </p>
                            </div>
                        ) : (
                            <div className="max-h-96 divide-y divide-gray-100 overflow-y-auto" data-testid="dashboard-activity-list">
                                {liveActivities.map((activity) => (
                                    <ActivityItem
                                        key={activity.id}
                                        activity={activity}
                                    />
                                ))}
                            </div>
                        )}
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

                            <Link data-testid="dashboard-view-billing" href={BUSINESS_BILLING_PATH} className="block w-full rounded-xl border border-gray-200 py-3 text-center text-slate-600 transition-all duration-300 hover:border-amber-300 hover:text-amber-700">
                                View billing details
                            </Link>

                            <Link data-testid="dashboard-pause-all-agents" href={BUSINESS_AGENTS_PATH} className="block w-full rounded-xl border border-gray-200 py-3 text-center text-slate-600 transition-all duration-300 hover:border-red-300 hover:text-red-600">
                                Pause all agents
                            </Link>
                        </div>
                    </section>
                </div>
            </div>
        </main>
    );
}

function MetricCard({ metric }: { metric: MetricCard }) {
    return (
        <article className="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow duration-300 hover:shadow-md sm:p-6">
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

            <p className="mt-5 text-sm font-medium text-slate-500" title={metric.tooltip} data-testid="business-protected-dashboard-metric-label-text">{metric.label}</p>
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
    onToggle,
    onSetup,
    onOpen,
    onTogglePause
}: {
    agent: Agent;
    open: boolean;
    onToggle: () => void;
    onSetup: () => void;
    onOpen: () => void;
    onTogglePause: () => Promise<string | null>;
}) {
    const [pausing, setPausing] = useState(false);
    const [pauseConfirmationOpen, setPauseConfirmationOpen] = useState(false);
    const [menuError, setMenuError] = useState("");
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;

        function onPointerDown(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onToggle();
            }
        }

        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [open, onToggle]);

    const paused = (agent.installedAgentStatus ?? "").toUpperCase() === "PAUSED";
    const setupCompleted = Boolean(agent.installedAgentId) &&
        ((agent.installedAgentStatus ?? "").toUpperCase() === "ACTIVE" || (agent.installedAgentStatus ?? "").toUpperCase() === "PAUSED");
    const purchaseStatus = agent.purchaseStatus.toUpperCase();
    const canManageAgent = setupCompleted && !agent.trialEnded && purchaseStatus !== "FAILED" && purchaseStatus !== "CANCELED";

    async function handleTogglePause() {
        setPausing(true);
        setMenuError("");
        const error = await onTogglePause();
        setPausing(false);
        if (error) {
            setMenuError(error);
            return;
        }
        if (open) onToggle();
        setPauseConfirmationOpen(false);
    }

    function handlePauseMenuAction() {
        if (paused) {
            void handleTogglePause();
            return;
        }

        setMenuError("");
        onToggle();
        setPauseConfirmationOpen(true);
    }

    return (
        <div className="group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-4 sm:px-6 sm:py-5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
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

                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-100 sm:h-11 sm:w-11">
                    {agent.iconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- listing icons may be remote or data URLs
                        <img src={agent.iconUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                        <Icon name={agent.icon} className="h-5 w-5" />
                    )}
                </span>

                <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900" data-testid="business-protected-dashboard-agent-text">{agent.name}</p>
                    <p className="truncate text-xs text-slate-400" data-testid="business-protected-dashboard-agent-since-text">{agent.since}</p>
                </div>
            </div>

            <div className="flex items-center justify-between gap-4 pl-5 sm:justify-end sm:gap-6 sm:pl-0 md:gap-8">
                <div className="text-left sm:text-right">
                    <p className="text-sm font-semibold text-slate-700" title="Unique live workflow executions: one per handled call plus captured missed calls. Test runs are excluded." data-testid="business-protected-dashboard-agent-runs-text">{agent.runs} runs</p>
                    <p className="text-xs text-slate-400" data-testid="business-protected-dashboard-this-month-text">this month</p>
                </div>

                <div className="text-left sm:text-right">
                    <p className="text-sm font-semibold text-slate-700" data-testid="business-protected-dashboard-agent-cost-text">{agent.cost}</p>
                    <p className="text-xs text-slate-400" data-testid="business-protected-dashboard-cost-text">cost</p>
                </div>

                <div ref={menuRef} className="relative shrink-0">
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            setMenuError("");
                            onToggle();
                        }}
                        data-testid={`dashboard-agent-menu-${agent.id}`}
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-gray-100 hover:text-slate-600"
                        aria-label={`Manage ${agent.name}`}
                        aria-haspopup="true"
                        aria-expanded={open}
                    >
                        <Icon name="settings" className="h-5 w-5" />
                    </button>

                    {open ? (
                        <AgentRowMenu
                            canManageAgent={canManageAgent}
                            paused={paused}
                            pausing={pausing}
                            menuError={menuError}
                            onSetup={onSetup}
                            onOpen={onOpen}
                            onToggle={onToggle}
                            onTogglePause={handlePauseMenuAction}
                        />
                    ) : null}
                </div>
            </div>

            {pauseConfirmationOpen ? (
                <AgentPauseConfirmationModal
                    agentName={agent.name}
                    isSubmitting={pausing}
                    error={menuError}
                    onCancel={() => {
                        setMenuError("");
                        setPauseConfirmationOpen(false);
                    }}
                    onConfirm={() => void handleTogglePause()}
                />
            ) : null}
        </div>
    );
}

function AgentRowMenu({
    canManageAgent,
    paused,
    pausing,
    menuError,
    onSetup,
    onOpen,
    onToggle,
    onTogglePause
}: {
    canManageAgent: boolean;
    paused: boolean;
    pausing: boolean;
    menuError: string;
    onSetup: () => void;
    onOpen: () => void;
    onToggle: () => void;
    onTogglePause: () => void;
}) {
    return (
        <div className="absolute right-0 top-9 z-30 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg" onClick={(event) => event.stopPropagation()}>
            {canManageAgent ? (
                <>
                    <AgentMenuButton
                        icon="settings"
                        label="Edit Configuration"
                        onClick={() => {
                            onSetup();
                            onToggle();
                        }}
                    />

                    <AgentMenuButton
                        icon="pause"
                        label={pausing ? "Updating…" : paused ? "Resume Agent" : "Pause Agent"}
                        disabled={pausing}
                        onClick={onTogglePause}
                    />
                </>
            ) : null}

            <AgentMenuButton
                icon="bot"
                label="View details"
                onClick={() => {
                    onOpen();
                    onToggle();
                }}
            />

            {menuError ? (
                <p className="px-4 py-2 text-xs font-semibold text-red-600">
                    {menuError}
                </p>
            ) : null}
        </div>
    );
}

function AgentMenuButton({
    icon,
    label,
    danger,
    onClick,
    disabled
}: {
    icon: IconName;
    label: string;
    danger?: boolean;
    onClick?: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            data-testid={`dashboard-agent-action-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors ${danger ? "text-red-600 hover:bg-red-50" : "text-slate-600 hover:bg-gray-50"
                } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
            <Icon name={icon} className={`h-4 w-4 ${danger ? "" : "text-slate-400"}`} />
            {label}
        </button>
    );
}

function formatBookingsMonth(month?: string) {
    const source = month ? new Date(`${month}-01T00:00:00Z`) : new Date();
    if (Number.isNaN(source.getTime())) return "This month";

    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(source);
}

function formatWithOptions(date: Date, options: Intl.DateTimeFormatOptions, timeZone?: string | null) {
    try {
        return new Intl.DateTimeFormat("en-US", { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
    } catch {
        return new Intl.DateTimeFormat("en-US", options).format(date);
    }
}

function formatBookingDate(iso: string, timeZone?: string | null) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return formatWithOptions(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }, timeZone);
}

function formatBookingClock(iso: string, timeZone?: string | null) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return formatWithOptions(date, { hour: "numeric", minute: "2-digit" }, timeZone);
}

/** Google Calendar day-view URL for the booking date (fallback when no event link is stored). */
function calendarDayUrl(iso: string, timeZone?: string | null) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "https://calendar.google.com/calendar/u/0/r";

    let parts: { year: string; month: string; day: string } | null = null;
    try {
        const formatted = new Intl.DateTimeFormat("en-CA", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            ...(timeZone ? { timeZone } : {})
        }).formatToParts(date);
        parts = {
            year: formatted.find((part) => part.type === "year")?.value ?? "",
            month: formatted.find((part) => part.type === "month")?.value ?? "",
            day: formatted.find((part) => part.type === "day")?.value ?? ""
        };
    } catch {
        parts = null;
    }

    if (!parts?.year || !parts.month || !parts.day) {
        return "https://calendar.google.com/calendar/u/0/r";
    }

    return `https://calendar.google.com/calendar/u/0/r/day/${parts.year}/${Number(parts.month)}/${Number(parts.day)}`;
}

function bookingStatusTone(status: string) {
    const value = status.toUpperCase();
    if (value === "BOOKED" || value === "CONFIRMED") return "bg-green-50 text-green-700";
    if (value === "CANCELLED" || value === "CANCELED") return "bg-red-50 text-red-600";
    return "bg-slate-100 text-slate-600";
}

function BookingRow({ booking }: { booking: DashboardBooking }) {
    const customer = booking.customerName?.trim() || booking.customerPhone;
    const isUpcoming = new Date(booking.startAt).getTime() > Date.now();
    const startClock = formatBookingClock(booking.startAt, booking.timeZone);
    const endClock = formatBookingClock(booking.endAt, booking.timeZone);
    const calendarUrl = booking.calendarEventLink || calendarDayUrl(booking.startAt, booking.timeZone);

    return (
        <div className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-4 sm:px-6" data-testid={`dashboard-booking-row-${booking.id}`}>
            <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <Icon name="calendar" className="h-5 w-5" />
                </span>

                <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900" data-testid="dashboard-booking-customer">
                        {customer}
                        {booking.service ? <span className="font-normal text-slate-500"> · {booking.service}</span> : null}
                    </p>
                    <p className="text-xs text-slate-500" data-testid="dashboard-booking-time">
                        {formatBookingDate(booking.startAt, booking.timeZone)}
                        {startClock ? ` · ${startClock}${endClock ? ` – ${endClock}` : ""}` : ""}
                    </p>
                    <p className="truncate text-xs text-slate-400" data-testid="dashboard-booking-meta">
                        {booking.customerName ? `${booking.customerPhone} · ` : ""}
                        Booked {formatBookingDate(booking.createdAt, booking.timeZone)}
                    </p>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pl-12 sm:justify-end sm:pl-0">
                {isUpcoming ? (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700" data-testid="dashboard-booking-upcoming-badge">
                        Upcoming
                    </span>
                ) : null}
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${bookingStatusTone(booking.status)}`} data-testid="dashboard-booking-status">
                    {booking.status}
                </span>
                {booking.onCalendar ? (
                    <a
                        href={calendarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
                        data-testid="dashboard-booking-open-calendar"
                    >
                        <Icon name="calendar" className="h-3 w-3" />
                        Open calendar
                    </a>
                ) : null}
            </div>
        </div>
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
            {activity.recordingUrl ? (
                <div className="mt-2">
                    <CallRecordingPlayer
                        src={activity.recordingUrl}
                        refreshPath={activity.vapiCallId ? `/business/calls/${activity.vapiCallId}/recording-url` : undefined}
                        testIdPrefix="dashboard-activity-call-recording"
                    />
                </div>
            ) : null}
        </div>
    );
}

/** "1:05" / "0:42" duration label from seconds. */
function formatCallDuration(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.max(0, Math.round(totalSeconds % 60));
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

        if (metric === "cost") return `$${value.toFixed(value < 10 ? 1 : 0)}`;
        return Math.round(value).toString();
    });
}

function chartLabel(metric: ChartMetric) {
    if (metric === "executions") return "Executions";
    return "Cost";
}

function formatChartValue(value: number, metric: ChartMetric) {
    if (metric === "cost") return `$${value.toFixed(2)}`;
    return `${Math.round(value)} executions`;
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
