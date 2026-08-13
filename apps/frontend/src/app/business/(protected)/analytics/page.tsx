"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { apiGet } from "@/lib/api";
import { businessAnalyticsPath } from "@/lib/routes";

/**
 * Business Analytics — one page, two modes.
 *
 *   /business/analytics                → every installed agent side by side
 *   /business/analytics?agentId=<id>   → that agent alone, plus the live voice
 *                                        assistant configuration Vapi is running
 *
 * Every number comes from the backend analytics API, which reads only real LIVE
 * data written by the agent runtime (calls, AI outcome/sentiment/summary,
 * bookings, handoffs, texts, billing ledger). Nothing here is sampled or mocked.
 */

type AnalyticsKpi = {
    totalCalls: number;
    completedCalls: number;
    missedCalls: number;
    failedCalls: number;
    inProgressCalls: number;
    bookings: number;
    cancellations: number;
    handoffs: number;
    smsSent: number;
    /** null in the agent-focused view — leads are not attributable per agent. */
    newLeads: number | null;
    platformCostMicroUsd: number;
    voiceUsageMicroUsd: number;
    totalTalkSeconds: number;
};

type BreakdownEntry = { key: string; label: string; count: number };

type AnalyticsInsights = {
    answerRate: number | null;
    bookingRate: number | null;
    avgDurationSeconds: number | null;
    peakHourRange: string | null;
    busiestDay: string | null;
    topAgent: { id: string; name: string; calls: number } | null;
    outcomeBreakdown: BreakdownEntry[];
    sentimentBreakdown: BreakdownEntry[];
};

type ChartPoint = {
    date: string;
    total: number;
    completed: number;
    missed: number;
    failed: number;
    bookings: number;
    costMicroUsd: number;
};

type AgentPerformanceRow = {
    id: string;
    name: string;
    status: string;
    installSource: string;
    listingId: string | null;
    createdAt: string;
    calls: number;
    completed: number;
    missed: number;
    failed: number;
    answerRate: number | null;
    avgDurationSeconds: number | null;
    totalTalkSeconds: number;
    bookings: number;
    handoffs: number;
    smsSent: number;
    costMicroUsd: number;
    lastCallAt: string | null;
    vapiAssistantId: string | null;
    phoneNumbers: string[];
};

type AnalyticsOverview = {
    period: { from: string; to: string };
    kpi: AnalyticsKpi;
    insights: AnalyticsInsights;
    chart: { granularity: "hour" | "day"; points: ChartPoint[] };
    agents: AgentPerformanceRow[];
    focusedAgentId: string | null;
};

type CallRow = {
    id: string;
    callId: string;
    agentId: string | null;
    agentName: string | null;
    customerPhone: string;
    direction: string | null;
    businessNumber: string | null;
    status: string;
    outcome: string;
    outcomeLabel: string;
    sentiment: string | null;
    durationSeconds: number | null;
    summary: string | null;
    recordingUrl: string | null;
    handoffStatus: string | null;
    costMicroUsd: number | null;
    startedAt: string;
    endedAt: string | null;
};

type CallsData = { total: number; page: number; pageSize: number; calls: CallRow[] };

type VoiceAssistant =
    | {
        available: true;
        id: string;
        name: string | null;
        model: { provider: string | null; model: string | null; temperature: number | null } | null;
        voice: { provider: string | null; voiceId: string | null; speed: number | null } | null;
        transcriber: { provider: string | null; model: string | null; language: string | null } | null;
        firstMessage: string | null;
        endCallMessage: string | null;
        toolNames: string[];
        serverUrl: string | null;
        recordingEnabled: boolean | null;
        maxDurationSeconds: number | null;
        silenceTimeoutSeconds: number | null;
        createdAt: string | null;
        updatedAt: string | null;
    }
    | { available: false; reason: string };

type AgentDetail = {
    agent: {
        id: string;
        name: string;
        status: string;
        pausedAt: string | null;
        installSource: string;
        listingId: string | null;
        listingTitle: string | null;
        listingCategory: string | null;
        workflowName: string | null;
        executionFeeCents: number;
        trialExecutionLimit: number;
        trialExecutionsUsed: number;
        knowledgeFileCount: number;
        createdAt: string;
        updatedAt: string;
        lastCallAt: string | null;
        lastCallStatus: string | null;
        lastCallOutcome: string | null;
        phoneNumbers: { phoneNumber: string; forwardToPhone: string | null; assignedAt: string | null }[];
        vapiAssistantId: string | null;
    };
    voiceAssistant: VoiceAssistant;
    activity: { id: string; action: string; actorLabel: string | null; detail: unknown; createdAt: string }[];
};

type AiInsight =
    | {
        available: true;
        insight: { headline: string; observations: string[]; recommendations: string[]; provider: string };
    }
    | { available: false; reason: string };

type LoadState = "loading" | "ready" | "error";
type RangeKey = "today" | "7d" | "month" | "lastMonth" | "90d";
type ChartTab = "total" | "completed" | "missed" | "bookings";
type StatusFilter = "all" | "completed" | "missed" | "failed" | "booked";

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "7d", label: "Last 7 days" },
    { key: "month", label: "This month" },
    { key: "lastMonth", label: "Last month" },
    { key: "90d", label: "Last 90 days" }
];

const CHART_TABS: { key: ChartTab; label: string }[] = [
    { key: "total", label: "All calls" },
    { key: "completed", label: "Answered" },
    { key: "missed", label: "Missed" },
    { key: "bookings", label: "Bookings" }
];

function startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/**
 * Ranges are sent as exact instants, not bare YYYY-MM-DD, so "Today" means the
 * viewer's today rather than a UTC day that starts hours off from it.
 */
function resolveRange(key: RangeKey): { from: string; to: string } {
    const now = new Date();
    const today = startOfDay(now);
    const to = endOfDay(now);

    if (key === "today") return { from: today.toISOString(), to: to.toISOString() };

    if (key === "7d") {
        const start = new Date(today);
        start.setDate(start.getDate() - 6);
        return { from: start.toISOString(), to: to.toISOString() };
    }

    if (key === "lastMonth") {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = endOfDay(new Date(today.getFullYear(), today.getMonth(), 0));
        return { from: start.toISOString(), to: end.toISOString() };
    }

    if (key === "90d") {
        const start = new Date(today);
        start.setDate(start.getDate() - 89);
        return { from: start.toISOString(), to: to.toISOString() };
    }

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: monthStart.toISOString(), to: to.toISOString() };
}

function formatMicroUsd(microUsd: number) {
    return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

function formatDuration(seconds: number | null | undefined) {
    if (seconds === null || seconds === undefined || seconds <= 0) return "—";
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    if (minutes === 0) return `${remainder}s`;
    return `${minutes}m ${remainder}s`;
}

function formatTalkTime(seconds: number) {
    if (seconds <= 0) return "0m";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatPercent(value: number | null) {
    if (value === null) return "—";
    return `${value}%`;
}

function formatDateTime(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function formatChartLabel(point: ChartPoint, granularity: "hour" | "day") {
    if (granularity === "hour") {
        const hour = Number(point.date.slice(11, 13));
        if (Number.isNaN(hour)) return point.date;
        const suffix = hour < 12 ? "AM" : "PM";
        return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
    }
    const date = new Date(`${point.date}T12:00:00`);
    if (Number.isNaN(date.getTime())) return point.date;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function chartValue(point: ChartPoint, tab: ChartTab) {
    if (tab === "completed") return point.completed;
    if (tab === "missed") return point.missed;
    if (tab === "bookings") return point.bookings;
    return point.total;
}

function sentimentTone(sentiment: string | null) {
    if (sentiment === "POSITIVE") return "bg-green-50 text-green-700";
    if (sentiment === "FRUSTRATED" || sentiment === "ANGRY") return "bg-red-50 text-red-600";
    if (sentiment === "CONFUSED") return "bg-amber-50 text-amber-700";
    return "bg-gray-50 text-slate-600";
}

function outcomeTone(outcome: string) {
    if (outcome === "BOOKED" || outcome === "SUPPORT_RESOLVED") return "bg-green-50 text-green-700";
    if (outcome === "MISSED" || outcome === "FAILED") return "bg-red-50 text-red-600";
    if (outcome === "TRANSFERRED" || outcome === "FOLLOW_UP" || outcome === "IN_PROGRESS") {
        return "bg-amber-50 text-amber-700";
    }
    return "bg-gray-50 text-slate-600";
}

function humanizeActivity(action: string) {
    return action
        .toLowerCase()
        .replace(/[._]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function BusinessAnalyticsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const agentId = searchParams.get("agentId");

    const [rangeKey, setRangeKey] = useState<RangeKey>("month");
    const [range, setRange] = useState(() => resolveRange("month"));
    const [chartTab, setChartTab] = useState<ChartTab>("total");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [page, setPage] = useState(1);
    const [refreshToken, setRefreshToken] = useState(0);
    const [refreshing, setRefreshing] = useState(false);

    const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
    const [overviewState, setOverviewState] = useState<LoadState>("loading");
    const [calls, setCalls] = useState<CallsData | null>(null);
    const [callsState, setCallsState] = useState<LoadState>("loading");
    const [detail, setDetail] = useState<AgentDetail | null>(null);
    const [detailState, setDetailState] = useState<LoadState>("loading");
    const [ai, setAi] = useState<AiInsight | null>(null);
    const [aiState, setAiState] = useState<LoadState>("loading");

    const [selectedCall, setSelectedCall] = useState<CallRow | null>(null);

    const periodQuery = useMemo(() => {
        const params = new URLSearchParams({ from: range.from, to: range.to });
        if (agentId) params.set("agentId", agentId);
        return params.toString();
    }, [range.from, range.to, agentId]);

    // Filters change the result set, so a stale page number would show an
    // empty table instead of the first page of the new set.
    useEffect(() => {
        setPage(1);
    }, [range.from, range.to, agentId, statusFilter]);

    useEffect(() => {
        let active = true;

        async function loadOverview() {
            setOverviewState("loading");
            const result = await apiGet<AnalyticsOverview>(`/business/analytics/overview?${periodQuery}`);
            if (!active) return;

            if (result.success && result.data) {
                setOverview(result.data);
                setOverviewState("ready");
            } else {
                setOverview(null);
                setOverviewState("error");
            }
            setRefreshing(false);
        }

        void loadOverview();
        return () => {
            active = false;
        };
    }, [periodQuery, refreshToken]);

    useEffect(() => {
        let active = true;

        async function loadCalls() {
            setCallsState("loading");
            const params = new URLSearchParams(periodQuery);
            params.set("page", String(page));
            params.set("pageSize", "20");
            if (statusFilter !== "all") params.set("status", statusFilter);

            const result = await apiGet<CallsData>(`/business/analytics/calls?${params.toString()}`);
            if (!active) return;

            if (result.success && result.data) {
                setCalls(result.data);
                setCallsState("ready");
            } else {
                setCalls(null);
                setCallsState("error");
            }
        }

        void loadCalls();
        return () => {
            active = false;
        };
    }, [periodQuery, page, statusFilter, refreshToken]);

    useEffect(() => {
        let active = true;

        if (!agentId) {
            setDetail(null);
            setDetailState("ready");
            return;
        }

        async function loadDetail() {
            setDetailState("loading");
            const result = await apiGet<AgentDetail>(`/business/analytics/agents/${agentId}`);
            if (!active) return;

            if (result.success && result.data) {
                setDetail(result.data);
                setDetailState("ready");
            } else {
                setDetail(null);
                setDetailState("error");
            }
        }

        void loadDetail();
        return () => {
            active = false;
        };
    }, [agentId, refreshToken]);

    // The AI read is its own request so the metrics above paint immediately and
    // this panel fills in when the model answers.
    useEffect(() => {
        let active = true;

        async function loadAi() {
            setAiState("loading");
            const result = await apiGet<AiInsight>(`/business/analytics/ai-insights?${periodQuery}`);
            if (!active) return;

            if (result.success && result.data) {
                setAi(result.data);
                setAiState("ready");
            } else {
                setAi(null);
                setAiState("error");
            }
        }

        void loadAi();
        return () => {
            active = false;
        };
    }, [periodQuery, refreshToken]);

    const applyRange = useCallback((key: RangeKey) => {
        setRangeKey(key);
        setRange(resolveRange(key));
    }, []);

    const focusAgent = useCallback(
        (nextAgentId: string | null) => {
            router.push(businessAnalyticsPath(nextAgentId));
        },
        [router]
    );

    function handleRefresh() {
        setRefreshing(true);
        setRefreshToken((token) => token + 1);
    }

    const kpi = overview?.kpi ?? null;
    const insights = overview?.insights ?? null;
    const chartPoints = overview?.chart.points ?? [];
    const granularity = overview?.chart.granularity ?? "day";
    const maxChartValue = Math.max(1, ...chartPoints.map((point) => chartValue(point, chartTab)));
    const focusedAgent = agentId ? overview?.agents.find((agent) => agent.id === agentId) ?? null : null;
    const totalPages = calls ? Math.max(1, Math.ceil(calls.total / calls.pageSize)) : 1;

    return (
        <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5" data-testid="business-analytics-page">
            <BusinessPageHeader
                className="-mx-3 -mt-3 mb-6 sm:-mx-4 sm:-mt-4 sm:mb-8 lg:-mx-5 lg:-mt-5"
                title={
                    <span data-testid="business-analytics-title">
                        {detail?.agent.name ?? focusedAgent?.name ?? "Business Analytics"}
                    </span>
                }
                description={
                    <span data-testid="business-analytics-description">
                        {agentId
                            ? "Performance, activity and live voice configuration for this agent"
                            : "Call performance, bookings and AI insights across every agent"}
                    </span>
                }
                actions={
                    <>
                        {agentId ? (
                            <button
                                type="button"
                                onClick={() => focusAgent(null)}
                                data-testid="business-analytics-clear-agent"
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-amber-300 hover:text-amber-700"
                            >
                                <span aria-hidden="true">←</span> All agents
                            </button>
                        ) : null}

                        <select
                            value={rangeKey}
                            onChange={(event) => applyRange(event.target.value as RangeKey)}
                            data-testid="business-analytics-range-select"
                            aria-label="Date range"
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-amber-300 focus:border-amber-500 focus:outline-none"
                        >
                            {RANGE_OPTIONS.map((option) => (
                                <option key={option.key} value={option.key}>
                                    {option.label}
                                </option>
                            ))}
                        </select>

                        <select
                            value={agentId ?? ""}
                            onChange={(event) => focusAgent(event.target.value || null)}
                            data-testid="business-analytics-agent-select"
                            aria-label="Agent filter"
                            className="max-w-[190px] truncate rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-amber-300 focus:border-amber-500 focus:outline-none"
                        >
                            <option value="">All agents</option>
                            {(overview?.agents ?? []).map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                    {agent.name}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={handleRefresh}
                            data-testid="business-analytics-refresh"
                            aria-label="Refresh analytics"
                            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-gray-50 hover:text-amber-600"
                        >
                            <RefreshIcon className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
                        </button>
                    </>
                }
            />

            {overviewState === "error" ? (
                <section
                    className="mb-6 rounded-2xl border border-gray-100 bg-white px-6 py-10 text-center shadow-sm"
                    data-testid="business-analytics-error"
                >
                    <p className="text-sm font-semibold text-slate-700">Could not load analytics</p>
                    <p className="mt-1 text-sm text-slate-500">
                        Refresh the page, or check that your account has reporting access for this business.
                    </p>
                </section>
            ) : null}

            <section aria-label="Key metrics" className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
                {overviewState === "loading" || !kpi
                    ? Array.from({ length: 6 }).map((_, index) => (
                        <div
                            key={index}
                            className="h-28 animate-pulse rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
                            data-testid="business-analytics-kpi-skeleton"
                        />
                    ))
                    : [
                        { key: "all" as StatusFilter, label: "Total Calls", value: String(kpi.totalCalls), hint: "live calls" },
                        { key: "completed" as StatusFilter, label: "Answered", value: String(kpi.completedCalls), hint: formatPercent(insights?.answerRate ?? null) },
                        { key: "missed" as StatusFilter, label: "Missed", value: String(kpi.missedCalls), hint: "caller left early" },
                        { key: "failed" as StatusFilter, label: "Failed", value: String(kpi.failedCalls), hint: "technical errors" },
                        { key: "booked" as StatusFilter, label: "Bookings", value: String(kpi.bookings), hint: formatPercent(insights?.bookingRate ?? null) },
                        { key: null, label: "Agent Cost", value: formatMicroUsd(kpi.platformCostMicroUsd), hint: "billed this period" }
                    ].map((card) => {
                        const clickable = card.key !== null;
                        const active = clickable && statusFilter === card.key;

                        return (
                            <article
                                key={card.label}
                                data-testid={`business-analytics-kpi-${card.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                                onClick={clickable ? () => setStatusFilter(card.key as StatusFilter) : undefined}
                                className={`min-w-0 rounded-2xl border bg-white p-4 shadow-sm transition-shadow duration-300 hover:shadow-md ${clickable ? "cursor-pointer" : ""
                                    } ${active ? "border-amber-500 ring-1 ring-amber-200" : "border-gray-100"}`}
                            >
                                <p className="truncate text-xs font-semibold uppercase tracking-wider text-slate-400">
                                    {card.label}
                                </p>
                                <p className="mt-2 truncate text-2xl font-black tracking-tight text-slate-900">
                                    {card.value}
                                </p>
                                <p className="mt-1 truncate text-xs text-slate-400">{card.hint}</p>
                            </article>
                        );
                    })}
            </section>

            <section className="mb-6 grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
                <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5 xl:col-span-2">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <h2 className="text-sm font-bold text-slate-900" data-testid="business-analytics-ai-heading">
                            AI performance read
                        </h2>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            AI generated
                        </span>
                    </div>

                    {aiState === "loading" ? (
                        <div className="space-y-2" data-testid="business-analytics-ai-loading">
                            <div className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
                            <div className="h-3 w-full animate-pulse rounded bg-gray-100" />
                            <div className="h-3 w-5/6 animate-pulse rounded bg-gray-100" />
                        </div>
                    ) : ai?.available ? (
                        <div data-testid="business-analytics-ai-insight">
                            <p className="text-sm font-semibold text-slate-900">{ai.insight.headline}</p>

                            {ai.insight.observations.length ? (
                                <ul className="mt-3 space-y-1.5">
                                    {ai.insight.observations.map((observation) => (
                                        <li key={observation} className="flex gap-2 text-sm text-slate-600">
                                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                                            <span>{observation}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}

                            {ai.insight.recommendations.length ? (
                                <div className="mt-4 rounded-xl bg-amber-50 p-3">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                                        Suggested next steps
                                    </p>
                                    <ul className="mt-1.5 space-y-1">
                                        {ai.insight.recommendations.map((recommendation) => (
                                            <li key={recommendation} className="text-sm text-amber-900">
                                                {recommendation}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500" data-testid="business-analytics-ai-unavailable">
                            {ai && !ai.available ? ai.reason : "AI insights are unavailable right now."}
                        </p>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-1">
                    <InsightTile
                        label="Peak call hours"
                        value={insights?.peakHourRange ?? "—"}
                        hint="Busiest 2-hour window"
                        testId="business-analytics-insight-peak"
                    />
                    <InsightTile
                        label="Avg call length"
                        value={formatDuration(insights?.avgDurationSeconds ?? null)}
                        hint={`${formatTalkTime(kpi?.totalTalkSeconds ?? 0)} total talk time`}
                        testId="business-analytics-insight-duration"
                    />
                    <InsightTile
                        label="Human handoffs"
                        value={String(kpi?.handoffs ?? 0)}
                        hint={`${kpi?.smsSent ?? 0} follow-up texts sent`}
                        testId="business-analytics-insight-handoffs"
                    />
                    <InsightTile
                        label={agentId ? "Answer rate" : "Top agent"}
                        value={
                            agentId
                                ? formatPercent(insights?.answerRate ?? null)
                                : insights?.topAgent?.name ?? "—"
                        }
                        hint={
                            agentId
                                ? `${kpi?.completedCalls ?? 0} of ${kpi?.totalCalls ?? 0} calls`
                                : insights?.topAgent
                                    ? `${insights.topAgent.calls} calls handled`
                                    : "By call volume"
                        }
                        testId="business-analytics-insight-top"
                    />
                </div>
            </section>

            <section className="mb-6 min-w-0 overflow-x-hidden rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
                    <h2 className="text-base font-bold text-slate-900 sm:text-lg" data-testid="business-analytics-chart-heading">
                        Calls over time{" "}
                        <span className="font-medium text-slate-400">
                            {granularity === "hour" ? "by hour" : "by day"}
                        </span>
                    </h2>

                    <div className="flex gap-1 rounded-xl bg-gray-50 p-1" role="tablist" aria-label="Chart series">
                        {CHART_TABS.map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                data-testid={`business-analytics-chart-tab-${tab.key}`}
                                onClick={() => setChartTab(tab.key)}
                                className={`rounded-lg px-3 py-1 text-sm transition-colors duration-300 ${chartTab === tab.key
                                    ? "bg-amber-50 font-semibold text-amber-700"
                                    : "font-medium text-slate-500 hover:text-slate-700"
                                    }`}
                                role="tab"
                                aria-selected={chartTab === tab.key}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {overviewState === "loading" ? (
                    <div className="h-48 animate-pulse rounded-xl bg-gray-100 sm:h-64" data-testid="business-analytics-chart-loading" />
                ) : chartPoints.length === 0 ? (
                    <div className="px-6 py-10 text-center" data-testid="business-analytics-chart-empty">
                        <p className="text-sm font-semibold text-slate-700">No calls in this period</p>
                        <p className="mt-1 text-sm text-slate-500">Pick a wider date range to see activity.</p>
                    </div>
                ) : (
                    <>
                        <div className="flex min-w-0 gap-2 sm:gap-3">
                            <div className="flex h-48 w-10 shrink-0 flex-col justify-between py-0 text-right text-[10px] text-slate-400 sm:h-64 sm:w-12 sm:text-xs">
                                {[1, 0.75, 0.5, 0.25, 0].map((step) => (
                                    <span key={step}>{Math.round(maxChartValue * step)}</span>
                                ))}
                            </div>

                            <div className="relative flex h-48 min-w-0 flex-1 items-end gap-0.5 border-b border-slate-100 sm:h-64 sm:gap-1">
                                <div className="pointer-events-none absolute inset-x-0 top-0 flex h-full flex-col justify-between">
                                    {Array.from({ length: 5 }).map((_, index) => (
                                        <span key={index} className="h-px w-full bg-slate-100" />
                                    ))}
                                </div>

                                {chartPoints.map((point) => {
                                    const value = chartValue(point, chartTab);
                                    const height = Math.max(2, (value / maxChartValue) * 100);

                                    return (
                                        <div key={`${chartTab}-${point.date}`} className="group relative z-10 flex h-full flex-1 items-end">
                                            <div
                                                className="w-full rounded-t bg-amber-300 transition-colors hover:bg-amber-500"
                                                style={{ height: `${height}%` }}
                                            />
                                            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
                                                <div className="whitespace-nowrap text-[11px] text-slate-300">
                                                    {formatChartLabel(point, granularity)}
                                                </div>
                                                <div className="whitespace-nowrap font-semibold">
                                                    {value} {chartTab === "bookings" ? "bookings" : "calls"}
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
                                {chartPoints.length > 0 ? <span>{formatChartLabel(chartPoints[0], granularity)}</span> : null}
                                {chartPoints.length > 2 ? (
                                    <span>
                                        {formatChartLabel(chartPoints[Math.floor(chartPoints.length / 2)], granularity)}
                                    </span>
                                ) : null}
                                {chartPoints.length > 1 ? (
                                    <span>{formatChartLabel(chartPoints[chartPoints.length - 1], granularity)}</span>
                                ) : null}
                            </div>
                        </div>
                    </>
                )}
            </section>

            {agentId ? (
                <AgentDetailPanel state={detailState} detail={detail} row={focusedAgent} />
            ) : (
                <section
                    className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
                    data-testid="business-analytics-agents-section"
                >
                    <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-6">
                        <h2 className="text-base font-bold text-slate-900 sm:text-lg" data-testid="business-analytics-agents-heading">
                            Agent performance
                        </h2>
                        <span className="text-sm text-slate-400">Select an agent for its full breakdown</span>
                    </div>

                    {overviewState === "loading" ? (
                        <div className="divide-y divide-gray-50" data-testid="business-analytics-agents-loading">
                            {Array.from({ length: 3 }).map((_, index) => (
                                <div key={index} className="h-14 animate-pulse bg-white px-6 py-5" />
                            ))}
                        </div>
                    ) : (overview?.agents.length ?? 0) === 0 ? (
                        <div className="px-6 py-10 text-center" data-testid="business-analytics-agents-empty">
                            <p className="text-sm font-semibold text-slate-700">No agents installed yet</p>
                            <p className="mt-1 text-sm text-slate-500">
                                Install an agent from the marketplace to start collecting performance data.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[840px] text-left">
                                <thead>
                                    <tr className="bg-gray-50">
                                        {["Agent", "Calls", "Answered", "Answer rate", "Avg length", "Bookings", "Handoffs", "Cost", "Last call"].map(
                                            (heading) => (
                                                <th
                                                    key={heading}
                                                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400"
                                                >
                                                    {heading}
                                                </th>
                                            )
                                        )}
                                    </tr>
                                </thead>
                                <tbody data-testid="business-analytics-agents-rows">
                                    {(overview?.agents ?? []).map((agent) => (
                                        <tr
                                            key={agent.id}
                                            data-testid={`business-analytics-agent-row-${agent.id}`}
                                            onClick={() => focusAgent(agent.id)}
                                            className="cursor-pointer border-t border-gray-50 transition-colors hover:bg-amber-50/40"
                                        >
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <span
                                                        className={`h-2 w-2 shrink-0 rounded-full ${agent.status === "ACTIVE" ? "bg-green-500" : "bg-amber-400"
                                                            }`}
                                                        aria-hidden="true"
                                                    />
                                                    <span className="truncate text-sm font-semibold text-slate-900">{agent.name}</span>
                                                </div>
                                                <p className="mt-0.5 truncate text-xs text-slate-400">
                                                    {agent.phoneNumbers[0] ?? "No number assigned"}
                                                </p>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-700">{agent.calls}</td>
                                            <td className="px-4 py-3 text-sm text-slate-700">{agent.completed}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                                                        <span
                                                            className="block h-full rounded-full bg-amber-500"
                                                            style={{ width: `${Math.min(100, agent.answerRate ?? 0)}%` }}
                                                        />
                                                    </span>
                                                    <span className="text-sm text-slate-700">{formatPercent(agent.answerRate)}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-700">
                                                {formatDuration(agent.avgDurationSeconds)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-700">{agent.bookings}</td>
                                            <td className="px-4 py-3 text-sm text-slate-700">{agent.handoffs}</td>
                                            <td className="px-4 py-3 text-sm text-slate-700">
                                                {formatMicroUsd(agent.costMicroUsd)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-500">
                                                {agent.lastCallAt ? formatDateTime(agent.lastCallAt) : "—"}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            )}

            {insights && (insights.outcomeBreakdown.length > 0 || insights.sentimentBreakdown.length > 0) ? (
                <section className="mb-6 grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                    <BreakdownCard
                        title="What callers wanted"
                        subtitle="AI-classified outcome for every call"
                        entries={insights.outcomeBreakdown}
                        total={kpi?.totalCalls ?? 0}
                        testId="business-analytics-outcome-breakdown"
                    />
                    <BreakdownCard
                        title="How callers sounded"
                        subtitle="AI sentiment read from each transcript"
                        entries={insights.sentimentBreakdown}
                        total={kpi?.totalCalls ?? 0}
                        testId="business-analytics-sentiment-breakdown"
                    />
                </section>
            ) : null}

            <section
                className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
                data-testid="business-analytics-calls-section"
            >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-6">
                    <h2 className="text-base font-bold text-slate-900 sm:text-lg" data-testid="business-analytics-calls-heading">
                        Call activity{" "}
                        {calls ? <span className="font-medium text-slate-400">{calls.total} total</span> : null}
                    </h2>

                    <div className="flex gap-1 rounded-xl bg-gray-50 p-1" role="tablist" aria-label="Call status filter">
                        {(["all", "completed", "missed", "failed", "booked"] as StatusFilter[]).map((status) => (
                            <button
                                key={status}
                                type="button"
                                data-testid={`business-analytics-status-filter-${status}`}
                                onClick={() => setStatusFilter(status)}
                                className={`rounded-lg px-3 py-1 text-sm capitalize transition-colors duration-300 ${statusFilter === status
                                    ? "bg-amber-50 font-semibold text-amber-700"
                                    : "font-medium text-slate-500 hover:text-slate-700"
                                    }`}
                                role="tab"
                                aria-selected={statusFilter === status}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>

                {callsState === "loading" ? (
                    <div className="divide-y divide-gray-50" data-testid="business-analytics-calls-loading">
                        {Array.from({ length: 5 }).map((_, index) => (
                            <div key={index} className="h-14 animate-pulse bg-white px-6 py-5" />
                        ))}
                    </div>
                ) : callsState === "error" ? (
                    <div className="px-6 py-10 text-center" data-testid="business-analytics-calls-error">
                        <p className="text-sm font-semibold text-slate-700">Could not load call activity</p>
                        <p className="mt-1 text-sm text-slate-500">Try refreshing the page.</p>
                    </div>
                ) : (calls?.calls.length ?? 0) === 0 ? (
                    <div className="px-6 py-10 text-center" data-testid="business-analytics-calls-empty">
                        <p className="text-sm font-semibold text-slate-700">No calls match this filter</p>
                        <p className="mt-1 text-sm text-slate-500">Widen the date range or clear the status filter.</p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[900px] text-left">
                                <thead>
                                    <tr className="bg-gray-50">
                                        {["Agent", "When", "Caller", "Duration", "Outcome", "Sentiment", "Summary"].map((heading) => (
                                            <th
                                                key={heading}
                                                className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400"
                                            >
                                                {heading}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody data-testid="business-analytics-calls-rows">
                                    {(calls?.calls ?? []).map((call) => (
                                        <tr
                                            key={call.id}
                                            data-testid={`business-analytics-call-row-${call.id}`}
                                            className="border-t border-gray-50 transition-colors hover:bg-amber-50/40"
                                        >
                                            <td className="max-w-[180px] truncate px-4 py-3 text-sm text-slate-700">
                                                {call.agentName ?? "—"}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
                                                {formatDateTime(call.startedAt)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                                                {call.customerPhone}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                                                {formatDuration(call.durationSeconds)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span
                                                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${outcomeTone(call.outcome)}`}
                                                >
                                                    {call.outcomeLabel}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span
                                                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${sentimentTone(call.sentiment)}`}
                                                >
                                                    {call.sentiment ?? "—"}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedCall(call)}
                                                    data-testid={`business-analytics-call-summary-${call.id}`}
                                                    className="rounded-lg border border-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50"
                                                >
                                                    View
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {totalPages > 1 ? (
                            <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 sm:px-6">
                                <span className="text-sm text-slate-500" data-testid="business-analytics-page-label">
                                    Page {calls?.page ?? 1} of {totalPages}
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        disabled={(calls?.page ?? 1) <= 1}
                                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                                        data-testid="business-analytics-prev-page"
                                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        Previous
                                    </button>
                                    <button
                                        type="button"
                                        disabled={(calls?.page ?? 1) >= totalPages}
                                        onClick={() => setPage((current) => current + 1)}
                                        data-testid="business-analytics-next-page"
                                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </>
                )}
            </section>

            {selectedCall ? (
                <CallSummaryModal call={selectedCall} onClose={() => setSelectedCall(null)} />
            ) : null}
        </main>
    );
}

function InsightTile({
    label,
    value,
    hint,
    testId
}: {
    label: string;
    value: string;
    hint: string;
    testId: string;
}) {
    return (
        <article className="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5" data-testid={testId}>
            <p className="truncate text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
            <p className="mt-1 truncate text-xl font-black tracking-tight text-slate-900">{value}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>
        </article>
    );
}

function BreakdownCard({
    title,
    subtitle,
    entries,
    total,
    testId
}: {
    title: string;
    subtitle: string;
    entries: BreakdownEntry[];
    total: number;
    testId: string;
}) {
    if (entries.length === 0) return null;

    return (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6" data-testid={testId}>
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>

            <div className="mt-4 space-y-2.5">
                {entries.map((entry) => {
                    const share = total > 0 ? Math.round((entry.count / total) * 100) : 0;

                    return (
                        <div key={entry.key} className="flex items-center gap-3">
                            <span className="w-40 shrink-0 truncate text-sm text-slate-600">{entry.label}</span>
                            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
                                <span className="block h-full rounded-full bg-amber-400" style={{ width: `${share}%` }} />
                            </span>
                            <span className="w-16 shrink-0 text-right text-sm font-semibold text-slate-900">
                                {entry.count} · {share}%
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function AgentDetailPanel({
    state,
    detail,
    row
}: {
    state: LoadState;
    detail: AgentDetail | null;
    row: AgentPerformanceRow | null;
}) {
    if (state === "loading") {
        return (
            <section
                className="mb-6 h-64 animate-pulse rounded-2xl border border-gray-100 bg-white shadow-sm"
                data-testid="business-analytics-agent-detail-loading"
            />
        );
    }

    if (state === "error" || !detail) {
        return (
            <section
                className="mb-6 rounded-2xl border border-gray-100 bg-white px-6 py-10 text-center shadow-sm"
                data-testid="business-analytics-agent-detail-error"
            >
                <p className="text-sm font-semibold text-slate-700">Could not load this agent</p>
                <p className="mt-1 text-sm text-slate-500">It may have been removed, or you may not have access to it.</p>
            </section>
        );
    }

    const { agent, voiceAssistant, activity } = detail;

    return (
        <section className="mb-6 grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3" data-testid="business-analytics-agent-detail">
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 xl:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-base font-bold text-slate-900 sm:text-lg" data-testid="business-analytics-agent-detail-name">
                            {agent.name}
                        </h2>
                        <p className="mt-0.5 text-sm text-slate-500">
                            {agent.listingTitle ?? agent.workflowName ?? "Installed agent"}
                            {agent.listingCategory ? ` · ${agent.listingCategory}` : ""}
                        </p>
                    </div>
                    <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${agent.status === "ACTIVE" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                            }`}
                        data-testid="business-analytics-agent-detail-status"
                    >
                        {agent.status}
                    </span>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <DetailField label="Calls this period" value={String(row?.calls ?? 0)} />
                    <DetailField label="Bookings" value={String(row?.bookings ?? 0)} />
                    <DetailField label="Talk time" value={formatTalkTime(row?.totalTalkSeconds ?? 0)} />
                    <DetailField
                        label="Business number"
                        value={agent.phoneNumbers[0]?.phoneNumber ?? "Not assigned"}
                    />
                    <DetailField
                        label="Forwards to"
                        value={agent.phoneNumbers[0]?.forwardToPhone ?? "Not set"}
                    />
                    <DetailField label="Knowledge files" value={String(agent.knowledgeFileCount)} />
                    <DetailField
                        label="Last call"
                        value={agent.lastCallAt ? formatDateTime(agent.lastCallAt) : "No calls yet"}
                    />
                    <DetailField label="Installed" value={formatDateTime(agent.createdAt)} />
                    <DetailField
                        label="Trial usage"
                        value={`${agent.trialExecutionsUsed} / ${agent.trialExecutionLimit}`}
                    />
                </dl>

                <div className="mt-6 border-t border-gray-100 pt-5">
                    <h3 className="text-sm font-bold text-slate-900" data-testid="business-analytics-voice-heading">
                        Live voice configuration
                    </h3>
                    <p className="mt-0.5 text-sm text-slate-500">
                        Read directly from the voice provider — this is the assistant that answered these calls.
                    </p>

                    {voiceAssistant.available ? (
                        <div data-testid="business-analytics-voice-config">
                            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                                <DetailField
                                    label="Model"
                                    value={
                                        voiceAssistant.model?.model
                                            ? `${voiceAssistant.model.provider ?? ""} ${voiceAssistant.model.model}`.trim()
                                            : "—"
                                    }
                                />
                                <DetailField
                                    label="Voice"
                                    value={voiceAssistant.voice?.voiceId ?? voiceAssistant.voice?.provider ?? "—"}
                                />
                                <DetailField
                                    label="Transcriber"
                                    value={
                                        voiceAssistant.transcriber?.model ??
                                        voiceAssistant.transcriber?.provider ??
                                        "—"
                                    }
                                />
                                <DetailField
                                    label="Language"
                                    value={voiceAssistant.transcriber?.language ?? "—"}
                                />
                                <DetailField
                                    label="Recording"
                                    value={
                                        voiceAssistant.recordingEnabled === null
                                            ? "—"
                                            : voiceAssistant.recordingEnabled
                                                ? "Enabled"
                                                : "Disabled"
                                    }
                                />
                                <DetailField
                                    label="Max call length"
                                    value={
                                        voiceAssistant.maxDurationSeconds
                                            ? formatDuration(voiceAssistant.maxDurationSeconds)
                                            : "—"
                                    }
                                />
                            </dl>

                            {voiceAssistant.firstMessage ? (
                                <div className="mt-4 rounded-xl bg-gray-50 p-3">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                                        Greeting
                                    </p>
                                    <p className="mt-1 text-sm text-slate-700">{voiceAssistant.firstMessage}</p>
                                </div>
                            ) : null}

                            {voiceAssistant.toolNames.length ? (
                                <div className="mt-4">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                                        Actions this agent can take
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {voiceAssistant.toolNames.map((tool) => (
                                            <span
                                                key={tool}
                                                className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700"
                                            >
                                                {tool}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <p className="mt-3 text-sm text-slate-500" data-testid="business-analytics-voice-unavailable">
                            {voiceAssistant.reason}
                        </p>
                    )}
                </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
                <h3 className="text-sm font-bold text-slate-900" data-testid="business-analytics-agent-activity-heading">
                    Recent activity
                </h3>
                <p className="mt-0.5 text-sm text-slate-500">Configuration and lifecycle changes</p>

                {activity.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500" data-testid="business-analytics-agent-activity-empty">
                        No recorded changes for this agent yet.
                    </p>
                ) : (
                    <ul className="mt-4 space-y-3" data-testid="business-analytics-agent-activity-list">
                        {activity.map((entry) => (
                            <li key={entry.id} className="flex gap-3">
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-slate-700">
                                        {humanizeActivity(entry.action)}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        {formatDateTime(entry.createdAt)}
                                        {entry.actorLabel ? ` · ${entry.actorLabel}` : ""}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

function DetailField({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <dt className="truncate text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
            <dd className="mt-1 truncate text-sm font-semibold text-slate-900" title={value}>
                {value}
            </dd>
        </div>
    );
}

function CallSummaryModal({ call, onClose }: { call: CallRow; onClose: () => void }) {
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") onClose();
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" data-testid="business-analytics-summary-modal">
            <button
                type="button"
                aria-label="Close summary"
                onClick={onClose}
                data-testid="business-analytics-summary-overlay"
                className="absolute inset-0 h-full w-full cursor-default"
            />

            <div className="relative z-10 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h3 className="text-base font-bold text-slate-900">Call summary</h3>
                        <p className="mt-0.5 text-sm text-slate-500">
                            {call.agentName ? `${call.agentName} · ` : ""}
                            {formatDateTime(call.startedAt)}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        data-testid="business-analytics-summary-close"
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-gray-50 hover:text-slate-700"
                        aria-label="Close"
                    >
                        <span aria-hidden="true">✕</span>
                    </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${outcomeTone(call.outcome)}`}>
                        {call.outcomeLabel}
                    </span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${sentimentTone(call.sentiment)}`}>
                        {call.sentiment ?? "Sentiment unknown"}
                    </span>
                    <span className="inline-flex rounded-full bg-gray-50 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {formatDuration(call.durationSeconds)}
                    </span>
                    {call.handoffStatus ? (
                        <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                            Handoff: {call.handoffStatus}
                        </span>
                    ) : null}
                </div>

                <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-700" data-testid="business-analytics-summary-text">
                    {call.summary?.trim() || "No summary available for this call."}
                </p>

                <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4">
                    <DetailField label="Caller" value={call.customerPhone} />
                    <DetailField label="Business number" value={call.businessNumber ?? "—"} />
                    <DetailField label="Direction" value={call.direction ?? "—"} />
                    <DetailField label="Status" value={call.status} />
                </dl>

                {call.recordingUrl ? (
                    <audio
                        controls
                        src={call.recordingUrl}
                        data-testid="business-analytics-summary-recording"
                        className="mt-4 w-full"
                    >
                        Your browser does not support audio playback.
                    </audio>
                ) : null}
            </div>
        </div>
    );
}

function RefreshIcon({ className = "h-5 w-5" }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <polyline points="21 3 21 9 15 9" />
        </svg>
    );
}
