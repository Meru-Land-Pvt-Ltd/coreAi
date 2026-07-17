"use client";

import { Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  getArchitectPayoutSummary,
  getArchitectPayoutTransactions,
  refreshArchitectStripeOnboarding,
  requestArchitectPayout,
  saveArchitectPayoutMethod,
  syncArchitectStripePayoutMethod,
  verifyArchitectIfsc,
  type ArchitectPayoutSummary,
  type ArchitectPayoutTransaction
} from "@/components/architect/features/api";
import { formatDate } from "@/components/architect/ui/architect-ui";

function formatUsd(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatChartAxisUsd(cents: number) {
  const dollars = cents / 100;
  if (dollars >= 1000) {
    return `$${(dollars / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  }
  if (dollars >= 100) {
    return `$${Math.round(dollars).toLocaleString("en-US")}`;
  }
  return `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function buildChartAxisTicks(maxCents: number) {
  const max = Math.max(maxCents, 1);
  return [1, 0.75, 0.5, 0.25, 0].map((ratio) => ({
    ratio,
    valueCents: Math.round(max * ratio)
  }));
}

function formatSignedUsd(cents: number) {
  const prefix = cents >= 0 ? "+" : "-";
  return `${prefix}$${Math.abs(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPayoutDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function statusBadgeClass(status: string) {
  if (status === "Pending") return "bg-amber-50 text-amber-700";
  if (status === "Available") return "bg-blue-50 text-blue-700";
  if (status === "Completed" || status === "Paid" || status === "Paid out") return "bg-green-50 text-green-700";
  if (status === "Rejected" || status === "Failed") return "bg-red-50 text-red-700";
  // In-flight, not an error — must not look like a failure.
  if (status === "Processed" || status === "Processing") return "bg-blue-50 text-blue-700";
  return "bg-gray-100 text-slate-600";
}

function formatScheduleLabel(schedule: ArchitectPayoutSummary["payoutSchedule"]) {
  if (!schedule) return "Monthly (1st of the month)";
  if (schedule.frequency === "Weekly") return `Weekly (every ${schedule.weeklyDay})`;
  if (schedule.frequency === "Bi-weekly") return "Bi-weekly (every 14 days)";
  if (schedule.monthlyDay === "last") return "Monthly (last day of the month)";
  return `Monthly (day ${schedule.monthlyDay})`;
}

export default function ArchitectPayoutsPage() {
  const [summary, setSummary] = useState<ArchitectPayoutSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [pagination, setPagination] = useState({ page: 1, perPage: 10, total: 0, totalPages: 1 });
  const [typeFilter, setTypeFilter] = useState("all");
  const [rangeFilter, setRangeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<ArchitectPayoutTransaction[]>([]);
  const [transactionsError, setTransactionsError] = useState("");
  const [toast, setToast] = useState("");
  const [methodModalOpen, setMethodModalOpen] = useState(false);
  const [payoutModalOpen, setPayoutModalOpen] = useState(false);
  const [payoutDeliveryMethod, setPayoutDeliveryMethod] = useState<"standard" | "instant">("standard");
  const [submittingPayout, setSubmittingPayout] = useState(false);
  const [openingStripe, setOpeningStripe] = useState(false);

  const loadSummary = useCallback(async () => {
    const result = await getArchitectPayoutSummary();
    if (result.success && result.data) {
      setSummary(result.data);
      setSummaryError("");
    } else {
      setSummaryError(result.error ?? "Could not load your payout summary. Please try again.");
    }
  }, []);

  const loadTransactions = useCallback(async (page: number, perPage: number, type: string, range: string) => {
    const result = await getArchitectPayoutTransactions({
      type,
      range,
      page,
      perPage
    });

    if (result.success && result.data) {
      setTransactions(result.data.transactions);
      setPagination(result.data.pagination);
      setTransactionsError("");
    } else {
      setTransactionsError(result.error ?? "Could not load transactions. Please try again.");
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      await loadSummary();
      if (active) setLoading(false);
    }

    void load();

    return () => {
      active = false;
    };
  }, [loadSummary]);

  useEffect(() => {
    void loadTransactions(pagination.page, pagination.perPage, typeFilter, rangeFilter);
  }, [loadTransactions, pagination.page, pagination.perPage, typeFilter, rangeFilter]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onboardingState = new URLSearchParams(window.location.search).get("stripe_onboarding");
    if (!onboardingState) return;

    async function finishStripeOnboarding() {
      if (onboardingState === "refresh") {
        const refreshed = await refreshArchitectStripeOnboarding();
        if (refreshed.success && refreshed.data?.url) {
          window.location.assign(refreshed.data.url);
          return;
        }
        setToast(refreshed.error ?? "Could not reopen Stripe onboarding.");
      } else {
        const synced = await syncArchitectStripePayoutMethod();
        await loadSummary();
        setToast(
          !synced.success
            ? synced.error ?? "Could not check the verification status yet — pull to refresh in a moment."
            : synced.data?.payoutMethod?.verified
              ? "Bank account verified by Stripe."
              : "Details received. Stripe verification is still in progress."
        );
      }

      window.history.replaceState({}, "", window.location.pathname);
    }

    void finishStripeOnboarding();
  }, [loadSummary]);

  async function handleRequestPayout() {
    if (!summary || summary.availableBalanceCents <= 0) return;

    setSubmittingPayout(true);
    const result = await requestArchitectPayout({
      amountCents: summary.availableBalanceCents,
      deliveryMethod: payoutDeliveryMethod
    });

    if (result.success && result.data) {
      setSummary(result.data.summary);
      setPayoutModalOpen(false);
      setToast(payoutDeliveryMethod === "instant" ? "Instant payout requested successfully." : "Payout requested successfully.");
      await loadTransactions(pagination.page, pagination.perPage, typeFilter, rangeFilter);
    } else {
      setToast(result.error ?? "Could not request payout.");
    }

    setSubmittingPayout(false);
  }

  async function handleContinueStripeVerification() {
    if (openingStripe) return;
    setOpeningStripe(true);

    const result = await refreshArchitectStripeOnboarding();
    if (result.success && result.data?.url) {
      window.location.assign(result.data.url);
      return;
    }

    setOpeningStripe(false);
    setToast(result.error ?? "Could not open Stripe verification. Please try again.");
  }

  const chartMax = useMemo(() => {
    const points = summary?.chart.points ?? [];
    const values = points.map((point) => point.confirmedCents + point.pendingCents);
    return Math.max(...values, 1);
  }, [summary]);

  const chartHasData = useMemo(() => {
    return (summary?.chart.points ?? []).some((point) => point.confirmedCents + point.pendingCents > 0);
  }, [summary]);

  const pendingCents = useMemo(() => summary?.pendingCents ?? 0, [summary]);

  if (loading && !summary) {
    return (
      <div className="min-h-screen bg-gray-50 p-6" data-testid="architect-payouts-loading">
        <div className="mx-auto max-w-6xl animate-pulse space-y-6">
          <div className="h-10 w-64 rounded-xl bg-white" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-36 rounded-2xl bg-white" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const data = summary ?? {
    totalEarningsCents: 0,
    availableBalanceCents: 0,
    pendingCents: 0,
    thisMonthEarningsCents: 0,
    thisMonthLabel: "",
    thisMonthSalesCount: 0,
    totalSalesCount: 0,
    agentCount: 0,
    architectSharePercent: 70,
    sales: [],
    listingBreakdown: [],
    chart: { period: "12M", points: [] },
    nextPayout: {
      amountCents: 0,
      scheduledFor: new Date().toISOString(),
      grossSalesCents: 0,
      platformFeeCents: 0,
      earningsCents: 0
    },
    instantPayout: {
      eligible: false,
      destinationType: null,
      destinationLast4: null
    },
    payoutMethod: null
  };

  return (
    <div className="min-h-screen bg-gray-50 text-slate-800">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-100 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
        <h1 className="text-xl font-bold text-slate-900" data-testid="architect-payouts-title">
          Payouts &amp; Earnings
        </h1>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        {summaryError ? (
          <div
            className="flex flex-col justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 sm:flex-row sm:items-center"
            role="alert"
            data-testid="architect-payouts-summary-error"
          >
            <p className="text-sm font-semibold text-red-700">{summaryError}</p>
            <button
              type="button"
              data-testid="architect-payouts-summary-retry"
              onClick={() => {
                setSummaryError("");
                void loadSummary();
              }}
              className="shrink-0 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        ) : null}

        <section aria-label="Earnings overview" data-testid="architect-payouts-overview">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total Earnings"
              value={formatUsd(data.totalEarningsCents)}
              hint={`All time · ${data.agentCount} agents`}
              subHint={`+${formatUsd(data.thisMonthEarningsCents)} this month`}
              testId="architect-payouts-total-earnings"
            />
            <MetricCard
              label="Available Balance"
              value={formatUsd(data.availableBalanceCents)}
              hint="Ready for next payout"
              valueClass="text-green-600"
              badge={`Payout: ${formatPayoutDate(data.nextPayout.scheduledFor).replace(/,.*/, "").split(" ").slice(0, 2).join(" ")}`}
              testId="architect-payouts-available-balance"
            />
            <MetricCard
              label="Pending"
              value={formatUsd(pendingCents)}
              hint="Paid in 7 days"
              testId="architect-payouts-pending"
            />
            <MetricCard
              label={data.thisMonthLabel || "This month"}
              value={formatUsd(data.thisMonthEarningsCents)}
              hint={`${data.thisMonthSalesCount} sales this month · ${data.totalSalesCount} total`}
              testId="architect-payouts-this-month"
            />
          </div>
        </section>

        <EarningsOverTimeChart
          points={data.chart.points}
          chartMax={chartMax}
          hasData={chartHasData}
        />

        <section aria-label="Payout schedule and bank account" data-testid="architect-payouts-next-payout">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-6">
              <p className="text-sm font-semibold text-amber-700">Next Payout</p>
              <p className="mt-2 text-4xl font-black text-slate-900" data-testid="architect-payouts-next-amount">
                {formatUsd(data.nextPayout.amountCents)}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Scheduled for {formatPayoutDate(data.nextPayout.scheduledFor)}
              </p>
              <div className="my-4 h-px bg-amber-200/60" />
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Gross sales</span>
                  <span className="font-mono text-slate-700">{formatUsd(data.nextPayout.grossSalesCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Triven platform fee (30%)</span>
                  <span className="font-mono text-slate-500">-{formatUsd(data.nextPayout.platformFeeCents)}</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="font-bold text-slate-900">Your earnings (70%)</span>
                  <span className="font-mono font-bold text-slate-900">{formatUsd(data.nextPayout.earningsCents)}</span>
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-500" data-testid="architect-payouts-schedule-label">
                Payout schedule: {formatScheduleLabel(data.payoutSchedule)}
              </p>
              {data.payoutMethod?.verified && data.availableBalanceCents > 0 ? (
                <button
                  type="button"
                  data-testid="architect-payouts-request-payout-button"
                  onClick={() => {
                    setPayoutDeliveryMethod("standard");
                    setPayoutModalOpen(true);
                  }}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
                >
                  Request payout
                </button>
              ) : null}
            </div>

            <PayoutMethodCard
              payoutMethod={data.payoutMethod}
              instantPayout={data.instantPayout}
              availableBalanceCents={data.availableBalanceCents}
              onAdd={() => setMethodModalOpen(true)}
              onChange={() => {
                if (data.payoutMethod?.stripeConnected && !data.payoutMethod.verified) {
                  void handleContinueStripeVerification();
                } else {
                  setMethodModalOpen(true);
                }
              }}
              onInstantPayout={() => {
                setPayoutDeliveryMethod("instant");
                setPayoutModalOpen(true);
              }}
              openingStripe={openingStripe}
            />
          </div>
        </section>

        <TransactionHistory
          transactions={transactions}
          error={transactionsError}
          onRetry={() => void loadTransactions(pagination.page, pagination.perPage, typeFilter, rangeFilter)}
          pagination={pagination}
          typeFilter={typeFilter}
          rangeFilter={rangeFilter}
          onTypeChange={(value) => {
            setTypeFilter(value);
            setPagination((current) => ({ ...current, page: 1 }));
          }}
          onRangeChange={(value) => {
            setRangeFilter(value);
            setPagination((current) => ({ ...current, page: 1 }));
          }}
          onPrev={() => setPagination((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
          onNext={() =>
            setPagination((current) => ({
              ...current,
              page: Math.min(current.totalPages, current.page + 1)
            }))
          }
        />
      </main>

      {methodModalOpen ? (
        <AddPayoutMethodModal
          payoutMethod={data.payoutMethod}
          onClose={() => setMethodModalOpen(false)}
          onVerify={handleContinueStripeVerification}
          onSaved={async (saved) => {
            setMethodModalOpen(false);
            setToast(
              saved?.verified
                ? "Payout method saved and verified."
                : "Payout method saved. Complete Stripe verification to enable payouts."
            );
            await loadSummary();
          }}
        />
      ) : null}

      {payoutModalOpen && data.payoutMethod ? (
        <RequestPayoutModal
          summary={data}
          deliveryMethod={payoutDeliveryMethod}
          submitting={submittingPayout}
          onClose={() => setPayoutModalOpen(false)}
          onConfirm={handleRequestPayout}
        />
      ) : null}

      {toast ? (
        <div
          className="fixed bottom-5 right-5 z-[60] max-w-sm rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
          role="status"
          data-testid="architect-payouts-toast"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

type ChartPoint = {
  label: string;
  confirmedCents: number;
  pendingCents: number;
};

function EarningsOverTimeChart({
  points,
  chartMax,
  hasData
}: {
  points: ChartPoint[];
  chartMax: number;
  hasData: boolean;
}) {
  const axisTicks = useMemo(() => buildChartAxisTicks(chartMax), [chartMax]);

  return (
    <section aria-label="Earnings over time" data-testid="architect-payouts-chart">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">Earnings over time</h2>
          <span className="rounded-full bg-gray-50 px-3 py-1 text-xs font-semibold text-slate-600">12M</span>
        </div>

        {hasData ? (
          <div className="mt-6 flex gap-3">
            <div
              className="flex h-52 w-11 shrink-0 flex-col justify-between pb-7 text-right text-[10px] font-medium text-slate-400"
              data-testid="architect-payouts-chart-y-axis"
            >
              {axisTicks.map((tick) => (
                <span key={tick.ratio}>{formatChartAxisUsd(tick.valueCents)}</span>
              ))}
            </div>

            <div className="relative min-w-0 flex-1">
              <div className="pointer-events-none absolute inset-x-0 top-0 bottom-7 flex flex-col justify-between">
                {axisTicks.map((tick) => (
                  <div key={`grid-${tick.ratio}`} className="border-t border-dashed border-gray-100" />
                ))}
              </div>

              <div className="relative flex h-52 items-end gap-2 pb-7">
                {points.map((point) => {
                  const totalCents = point.confirmedCents + point.pendingCents;
                  const barHeight = totalCents > 0 ? Math.max(8, (totalCents / chartMax) * 100) : 0;

                  return (
                    <div key={point.label} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                      {totalCents > 0 ? (
                        <>
                          <div
                            className="pointer-events-none absolute bottom-7 left-1/2 z-20 mb-2 w-max max-w-[9rem] -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-left text-[11px] text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
                            data-testid={`architect-payouts-chart-tooltip-${point.label}`}
                          >
                            <p className="font-semibold">{point.label}</p>
                            <p className="mt-1 font-mono">Total: {formatUsd(totalCents)}</p>
                            {point.confirmedCents > 0 ? (
                              <p className="font-mono text-amber-300">Confirmed: {formatUsd(point.confirmedCents)}</p>
                            ) : null}
                            {point.pendingCents > 0 ? (
                              <p className="font-mono text-amber-100">Pending: {formatUsd(point.pendingCents)}</p>
                            ) : null}
                          </div>

                          <div
                            className="flex w-full cursor-pointer flex-col justify-end overflow-hidden rounded-t-md"
                            style={{ height: `${barHeight}%` }}
                            data-testid={`architect-payouts-chart-bar-${point.label}`}
                          >
                            {point.confirmedCents > 0 ? (
                              <div
                                className="w-full bg-amber-500 transition group-hover:brightness-110"
                                style={{ flexGrow: point.confirmedCents }}
                              />
                            ) : null}
                            {point.pendingCents > 0 ? (
                              <div
                                className="w-full bg-amber-100 transition group-hover:brightness-95"
                                style={{ flexGrow: point.pendingCents }}
                              />
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <div className="w-full" aria-hidden="true" />
                      )}
                      <span className="mt-2 text-[10px] font-medium text-slate-400">{point.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div
            className="mt-6 flex h-52 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm text-slate-400"
            data-testid="architect-payouts-chart-empty"
          >
            No earnings yet. Sales will appear here once agents are purchased.
          </div>
        )}

        <div className="mt-4 flex items-center gap-5 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-amber-500" />
            Confirmed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-amber-100" />
            Pending
          </span>
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  hint,
  subHint,
  badge,
  valueClass = "text-slate-900",
  testId
}: {
  label: string;
  value: string;
  hint: string;
  subHint?: string;
  badge?: string;
  valueClass?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" data-testid={testId}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-black ${valueClass}`}>{value}</p>
      <p className="mt-2 text-xs text-slate-400">{hint}</p>
      {subHint ? <p className="mt-1.5 text-xs font-semibold text-green-600">{subHint}</p> : null}
      {badge ? (
        <span className="mt-2 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function PayoutMethodCard({
  payoutMethod,
  instantPayout,
  availableBalanceCents,
  onAdd,
  onChange,
  onInstantPayout,
  openingStripe = false
}: {
  payoutMethod: ArchitectPayoutSummary["payoutMethod"];
  instantPayout: ArchitectPayoutSummary["instantPayout"];
  availableBalanceCents: number;
  onAdd: () => void;
  onChange: () => void;
  onInstantPayout: () => void;
  openingStripe?: boolean;
}) {
  const instantDisabled = !payoutMethod?.verified || !instantPayout.eligible || availableBalanceCents <= 0;
  const instantTitle = !payoutMethod?.verified
    ? "Complete Stripe verification first"
    : !instantPayout.eligible
      ? "Add an Instant Payouts-eligible account in Stripe"
      : availableBalanceCents <= 0
        ? "No available balance"
        : "Send available funds by Instant Payout";

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" data-testid="architect-payouts-method-card">
      <p className="text-sm font-semibold text-slate-700">Payout Method</p>

      {payoutMethod ? (
        <>
          <div className="mt-4 flex items-center gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
              <BankIcon />
            </div>
            <div className="leading-tight">
              <p className="text-base font-bold text-slate-900">{payoutMethod.bankName}</p>
              <p className="font-mono text-sm text-slate-500">
                {payoutMethod.country === "IN" ? "India" : "United States"} bank
                {payoutMethod.accountLast4 ? ` •••• ${payoutMethod.accountLast4}` : ""}
              </p>
              {payoutMethod.routingLast4 ? (
                <p className="mt-0.5 font-mono text-xs text-slate-400">
                  {payoutMethod.routingLabel} •••• {payoutMethod.routingLast4}
                </p>
              ) : null}
              <p className="mt-0.5 text-xs text-slate-400">Added {formatDate(payoutMethod.createdAt)}</p>
            </div>
          </div>
          <span
            className={`mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
              payoutMethod.verified
                ? "bg-green-50 text-green-600"
                : payoutMethod.verificationStatus === "FAILED"
                  ? "bg-red-50 text-red-600"
                  : "bg-amber-50 text-amber-700"
            }`}
          >
            {payoutMethod.verified ? <CheckIcon className="h-3 w-3" /> : null}
            {payoutMethod.verified
              ? "Verified by Stripe"
              : payoutMethod.verificationStatus === "FAILED"
                ? "Verification needs attention"
                : "Stripe verification pending"}
          </span>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="architect-payouts-change-method-button"
              onClick={onChange}
              disabled={openingStripe}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {payoutMethod.verified ? "Change bank" : "Continue verification"}
            </button>
            <button
              type="button"
              title={instantTitle}
              disabled={instantDisabled}
              onClick={onInstantPayout}
              data-testid="architect-payouts-instant-payout-button"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Zap className="h-4 w-4" aria-hidden="true" />
              Instant payout
            </button>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <p className="text-sm text-slate-500">Add a bank account to receive your architect earnings.</p>
          <button
            type="button"
            data-testid="architect-payouts-add-method-button"
            onClick={onAdd}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
          >
            Add payout method
          </button>
        </div>
      )}
    </div>
  );
}

function TransactionHistory({
  transactions,
  error = "",
  onRetry,
  pagination,
  typeFilter,
  rangeFilter,
  onTypeChange,
  onRangeChange,
  onPrev,
  onNext
}: {
  transactions: ArchitectPayoutTransaction[];
  error?: string;
  onRetry?: () => void;
  pagination: { page: number; perPage: number; total: number; totalPages: number };
  typeFilter: string;
  rangeFilter: string;
  onTypeChange: (value: string) => void;
  onRangeChange: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const from = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.perPage + 1;
  const to = Math.min(pagination.page * pagination.perPage, pagination.total);

  return (
    <section aria-label="Transaction history" data-testid="architect-payouts-transactions">
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-3 border-b border-gray-100 px-6 py-4 sm:flex-row sm:items-center">
          <h2 className="text-lg font-bold text-slate-900">Transaction History</h2>
          <div className="flex items-center gap-2">
            <select
              aria-label="Filter by transaction type"
              data-testid="architect-payouts-type-filter"
              value={typeFilter}
              onChange={(event) => onTypeChange(event.target.value)}
              className="cursor-pointer rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-sm text-slate-600 hover:border-amber-300 focus:border-amber-400"
            >
              <option value="all">All types</option>
              <option value="Sale">Sales</option>
              <option value="Payout">Payouts</option>
            </select>
            <select
              aria-label="Filter by date range"
              data-testid="architect-payouts-range-filter"
              value={rangeFilter}
              onChange={(event) => onRangeChange(event.target.value)}
              className="cursor-pointer rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-sm text-slate-600 hover:border-amber-300 focus:border-amber-400"
            >
              <option value="all">All time</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-6 py-3">Date</th>
                <th scope="col" className="px-6 py-3">Description</th>
                <th scope="col" className="px-6 py-3">Type</th>
                <th scope="col" className="px-6 py-3">Amount</th>
                <th scope="col" className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length ? (
                transactions.map((transaction) => (
                  <tr
                    key={transaction.id}
                    className="border-b border-gray-50 transition hover:bg-amber-50/40"
                    data-testid={`architect-payouts-transaction-${transaction.id}`}
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">
                      {formatDate(transaction.date)}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-800">{transaction.description}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{transaction.type}</td>
                    <td
                      className={`whitespace-nowrap px-6 py-4 font-mono text-sm font-semibold ${
                        transaction.amountCents >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {formatSignedUsd(transaction.amountCents)}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(transaction.status)}`}
                      >
                        {transaction.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center" data-testid="architect-payouts-transactions-error">
                    <p className="text-sm font-semibold text-red-600">{error}</p>
                    {onRetry ? (
                      <button
                        type="button"
                        onClick={onRetry}
                        data-testid="architect-payouts-transactions-retry"
                        className="mt-3 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-300 hover:text-amber-700"
                      >
                        Retry
                      </button>
                    ) : null}
                  </td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-400">
                    No transactions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-6 py-4">
          <p className="text-sm text-slate-500" data-testid="architect-payouts-pagination-info">
            Showing {from}-{to} of {pagination.total} transactions
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="architect-payouts-prev-page"
              disabled={pagination.page <= 1}
              onClick={onPrev}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              data-testid="architect-payouts-next-page"
              disabled={pagination.page >= pagination.totalPages}
              onClick={onNext}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function TaxDocumentsSection({ totalEarningsCents }: { totalEarningsCents: number }) {
  const year = new Date().getFullYear();
  const previousYear = year - 1;

  return (
    <section aria-label="Tax documents" className="pb-4" data-testid="architect-payouts-tax-docs">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Tax Documents</h2>
        <p className="mt-1 text-sm text-slate-500">Download your tax forms for filing.</p>
        <div className="mt-4 divide-y divide-gray-100">
          {[previousYear, year].map((docYear) => (
            <div key={docYear} className="flex items-center justify-between gap-4 py-3">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
                  <DocIcon />
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-slate-800">
                    {docYear} Form 1099-K{docYear === year ? " (YTD)" : ""}
                  </p>
                  <p className="text-xs text-slate-400">
                    {docYear === year ? "Year-to-date preview" : "Annual earnings summary"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={totalEarningsCents <= 0}
                data-testid={`architect-payouts-tax-download-${docYear}`}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Download PDF
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AddPayoutMethodModal({
  payoutMethod,
  onClose,
  onSaved,
  onVerify
}: {
  payoutMethod: ArchitectPayoutSummary["payoutMethod"];
  onClose: () => void;
  onSaved: (saved: ArchitectPayoutSummary["payoutMethod"]) => void | Promise<void>;
  onVerify: () => Promise<void>;
}) {
  const [country, setCountry] = useState<"US" | "IN">(payoutMethod?.country ?? "US");
  const [accountHolderName, setAccountHolderName] = useState(payoutMethod?.accountHolderName ?? "");
  const [bankName, setBankName] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmAccountNumber, setConfirmAccountNumber] = useState("");
  const [routingStatus, setRoutingStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [routingMessage, setRoutingMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Post-save step: the bank is stored but Stripe still needs identity
  // verification — offer to jump straight into the hosted flow.
  const [savedMethod, setSavedMethod] = useState<ArchitectPayoutSummary["payoutMethod"]>(null);
  const [verifying, setVerifying] = useState(false);

  function isValidAba(value: string) {
    if (!/^\d{9}$/.test(value)) return false;
    const digits = value.split("").map(Number);
    return (3 * (digits[0] + digits[3] + digits[6]) + 7 * (digits[1] + digits[4] + digits[7]) + digits[2] + digits[5] + digits[8]) % 10 === 0;
  }

  async function validateRouting(value: string) {
    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      setRoutingStatus("idle");
      setRoutingMessage("");
      return;
    }

    if (country === "US") {
      const valid = isValidAba(normalized);
      setRoutingStatus(valid ? "valid" : "invalid");
      setRoutingMessage(valid ? "Valid ABA routing number format." : "Enter a valid 9-digit ABA routing number.");
      return;
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalized)) {
      setRoutingStatus("invalid");
      setRoutingMessage("Enter a valid IFSC code (e.g. HDFC0001234).");
      return;
    }

    setRoutingStatus("checking");
    setRoutingMessage("Verifying IFSC code…");
    const result = await verifyArchitectIfsc(normalized);
    if (result.success && result.data?.valid) {
      setRoutingStatus("valid");
      setRoutingMessage(`${result.data.bankName}${result.data.branch ? ` · ${result.data.branch}` : ""}`);
      if (!bankName.trim() && result.data.bankName) setBankName(result.data.bankName);
    } else {
      setRoutingStatus("invalid");
      setRoutingMessage(result.error ?? "IFSC code not found.");
    }
  }

  // Validate the routing number as the architect types (debounced) — the save
  // button unlocks without requiring a blur first.
  useEffect(() => {
    if (!routingNumber.trim()) {
      setRoutingStatus("idle");
      setRoutingMessage("");
      return;
    }

    const timer = window.setTimeout(() => {
      void validateRouting(routingNumber);
    }, 600);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- validateRouting reads current field state
  }, [routingNumber, country]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (routingStatus === "checking") {
      setError("Hold on — still verifying the routing details.");
      return;
    }
    if (routingStatus !== "valid") {
      setError(`Verify a valid ${country === "IN" ? "IFSC code" : "ABA routing number"} before saving.`);
      return;
    }
    if (accountNumber.length < 4) {
      setError("Enter a valid account number.");
      return;
    }
    if (accountNumber !== confirmAccountNumber) {
      setError("Account numbers do not match.");
      return;
    }

    setSaving(true);
    const result = await saveArchitectPayoutMethod({
      country,
      bankName: bankName.trim(),
      accountHolderName: accountHolderName.trim(),
      accountNumber,
      confirmAccountNumber,
      routingNumber: routingNumber.trim().toUpperCase()
    });

    if (result.success) {
      const saved = result.data?.payoutMethod ?? null;
      if (saved && !saved.verified) {
        // Keep the dialog open and offer the Stripe identity step right away.
        setSavedMethod(saved);
      } else {
        await onSaved(saved);
      }
    } else {
      setError(result.error ?? "Could not save payout method. Please check the details and try again.");
    }

    setSaving(false);
  }

  async function handleVerifyNow() {
    setVerifying(true);
    setError("");
    await onVerify();
    // onVerify redirects on success; reaching here means it failed.
    setVerifying(false);
    setError("Could not open Stripe verification. You can retry from the Payout Method card.");
  }

  if (savedMethod) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" data-testid="architect-payouts-method-saved-step">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-50 text-green-600">
            <CheckIcon className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-center text-lg font-bold text-slate-900">Bank account saved</h3>
          <p className="mt-2 text-center text-sm leading-6 text-slate-600">
            {savedMethod.bankName}
            {savedMethod.accountLast4 ? ` •••• ${savedMethod.accountLast4}` : ""} is on file. Stripe now needs a quick
            identity verification before payouts can be sent to it.
          </p>

          {error ? (
            <p className="mt-3 text-center text-sm text-red-600" data-testid="architect-payouts-method-error">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              data-testid="architect-payouts-verify-later-button"
              onClick={() => void onSaved(savedMethod)}
              className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-gray-50"
            >
              I&apos;ll do this later
            </button>
            <button
              type="button"
              disabled={verifying}
              data-testid="architect-payouts-verify-now-button"
              onClick={() => void handleVerifyNow()}
              className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {verifying ? "Opening Stripe…" : "Verify with Stripe"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" data-testid="architect-payouts-method-modal">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Add payout method</h3>
            <p className="mt-1 text-sm text-slate-500">Bank transfers are used for architect payouts.</p>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
          >
            ×
          </button>
        </div>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <Field label="Bank country">
            <select
              value={country}
              onChange={(event) => {
                setCountry(event.target.value as "US" | "IN");
                setRoutingNumber("");
                setRoutingStatus("idle");
                setRoutingMessage("");
              }}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
            >
              <option value="US">United States</option>
              <option value="IN">India</option>
            </select>
          </Field>

          <Field label="Account holder name" testId="architect-payouts-account-holder">
            <input
              value={accountHolderName}
              onChange={(event) => setAccountHolderName(event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
              required
            />
          </Field>

          <Field label="Bank name" testId="architect-payouts-bank-name">
            <input value={bankName} onChange={(event) => setBankName(event.target.value)} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" required />
          </Field>

          <Field label={country === "IN" ? "IFSC code" : "ABA routing number"} testId="architect-payouts-routing-number">
            <input
              value={routingNumber}
              onChange={(event) => setRoutingNumber(country === "IN" ? event.target.value.toUpperCase() : event.target.value.replace(/\D/g, ""))}
              onBlur={() => void validateRouting(routingNumber)}
              maxLength={country === "IN" ? 11 : 9}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-sm uppercase text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
              placeholder={country === "IN" ? "HDFC0001234" : "110000000"}
              required
            />
            {routingMessage ? <p className={`mt-1 text-xs ${routingStatus === "valid" ? "text-green-600" : routingStatus === "invalid" ? "text-red-600" : "text-slate-500"}`}>{routingMessage}</p> : null}
          </Field>

          <Field label="Account number" testId="architect-payouts-account-number">
            <input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-sm text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" inputMode="numeric" required />
          </Field>

          <Field label="Confirm account number" testId="architect-payouts-confirm-account-number">
            <input value={confirmAccountNumber} onChange={(event) => setConfirmAccountNumber(event.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-sm text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" inputMode="numeric" required />
          </Field>

          {error ? <p className="text-sm text-red-600" data-testid="architect-payouts-method-error">{error}</p> : null}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || routingStatus !== "valid"}
              data-testid="architect-payouts-save-method-button"
              className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save payout method"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RequestPayoutModal({
  summary,
  deliveryMethod,
  submitting,
  onClose,
  onConfirm
}: {
  summary: ArchitectPayoutSummary;
  deliveryMethod: "standard" | "instant";
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const method = summary.payoutMethod;
  const instant = deliveryMethod === "instant";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" data-testid="architect-payouts-request-modal">
        <h3 className="text-lg font-bold text-slate-900">{instant ? "Request instant payout" : "Request payout"}</h3>
        <p className="mt-2 text-sm text-slate-600">
          Transfer your available balance to{" "}
          <span className="font-semibold text-slate-800">
            {method?.bankName} •••• {method?.accountLast4}
          </span>
          .
        </p>
        {instant ? (
          <p className="mt-2 text-xs text-slate-500">
            Stripe Instant Payout fees and platform limits may apply.
          </p>
        ) : null}
        <div className="mt-4 space-y-2.5 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Available balance</span>
            <span className="font-mono font-semibold text-slate-900">{formatUsd(summary.availableBalanceCents)}</span>
          </div>
          <div className="h-px bg-gray-200" />
          <div className="flex justify-between">
            <span className="font-semibold text-slate-700">You receive</span>
            <span className="font-mono font-bold text-green-600">{formatUsd(summary.availableBalanceCents)}</span>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            data-testid="architect-payouts-confirm-payout-button"
            className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {submitting ? "Processing…" : instant ? "Confirm instant payout" : "Confirm payout"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  testId,
  children
}: {
  label: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <label className="block" data-testid={testId}>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function BankIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="22" x2="21" y2="22" />
      <line x1="6" y1="18" x2="6" y2="11" />
      <line x1="10" y1="18" x2="10" y2="11" />
      <line x1="14" y1="18" x2="14" y2="11" />
      <line x1="18" y1="18" x2="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}
