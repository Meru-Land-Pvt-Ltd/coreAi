"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient, apiGet } from "@/lib/api";

type BillingPaymentMethod = {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
};

type BillingInvoice = {
    id: string;
    createdAt: string;
    description: string;
    amountCents: number;
    currency: string;
    status: string;
};

type BillingAgent = {
    id: string;
    name: string;
    priceCents: number;
};

type Billing = {
    plan: { name: string; status: string };
    agents: BillingAgent[];
    summary: {
        totalAgentFeesPaidCents: number;
        currentMonthExecutionCostCents: number | null;
        nextChargeCents: number;
    };
    usage: unknown | null;
    invoices: BillingInvoice[];
    paymentMethod: BillingPaymentMethod | null;
    businessName: string | null;
    billingAddress: string | null;
};

type BillingResponse = { billing: Billing };

const NA = "NA";

const ACCENTS = [
    { dot: "bg-amber-400", chip: "bg-amber-50 text-amber-600", fill: "bg-amber-400" },
    { dot: "bg-green-400", chip: "bg-green-50 text-green-600", fill: "bg-green-400" },
    { dot: "bg-blue-400", chip: "bg-blue-50 text-blue-600", fill: "bg-blue-400" }
];

function formatCurrencyCents(cents: number | null | undefined) {
    if (cents === null || cents === undefined || Number.isNaN(cents)) return NA;
    return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return NA;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusBadgeClass(status: string) {
    const value = status.toUpperCase();
    if (value === "SUCCEEDED" || value === "PAID") return "bg-green-50 text-green-700";
    if (value === "TRIALING") return "bg-amber-50 text-amber-700";
    if (value === "PENDING") return "bg-blue-50 text-blue-700";
    return "bg-gray-100 text-slate-600";
}

function statusLabel(status: string) {
    const value = status.toUpperCase();
    if (value === "SUCCEEDED") return "Paid";
    if (value === "TRIALING") return "Trial";
    if (value === "PENDING") return "Pending";
    if (value === "FAILED") return "Failed";
    if (value === "CANCELED") return "Canceled";
    if (value === "REFUNDED") return "Refunded";
    return status;
}

const DOWNLOAD_STYLES = `
.billing-root { font-variant-numeric: tabular-nums; }
.billing-toast { transform: translateY(12px); opacity: 0; transition: transform .28s cubic-bezier(.16,1,.3,1), opacity .28s ease; }
.billing-toast.show { transform: translateY(0); opacity: 1; }
`;

export default function BusinessBillingUsagePage() {
    const [billing, setBilling] = useState<Billing | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [apiError, setApiError] = useState("");
    const [toast, setToast] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [alertsOn, setAlertsOn] = useState(true);
    const [threshold, setThreshold] = useState("$50");

    useEffect(() => {
        let mounted = true;

        async function loadBilling() {
            try {
                setIsLoading(true);
                setApiError("");

                const response = await apiGet<BillingResponse>("/payments/billing");

                if (!mounted) return;

                if (!response.success || !response.data?.billing) {
                    setApiError(response.error ?? "Could not load billing information");
                    setBilling(null);
                    return;
                }

                setBilling(response.data.billing);
            } catch (error) {
                if (!mounted) return;
                setApiError(error instanceof Error ? error.message : "Could not load billing information");
                setBilling(null);
            } finally {
                if (mounted) setIsLoading(false);
            }
        }

        loadBilling();

        return () => {
            mounted = false;
        };
    }, []);

    function showToast(message: string) {
        setToast(message);
        window.setTimeout(() => setToast(""), 2800);
    }

    async function downloadInvoice(invoice: BillingInvoice) {
        showToast(`Preparing ${invoice.description || "invoice"} PDF…`);

        try {
            const token =
                localStorage.getItem("coreai-token") || localStorage.getItem("coreai_token");
            const base = apiClient.defaults.baseURL ?? "";

            const response = await fetch(`${base}/payments/invoice/${invoice.id}/pdf`, {
                headers: token ? { Authorization: `Bearer ${token}` } : undefined
            });

            if (!response.ok) {
                throw new Error("Download failed");
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `invoice-${invoice.id}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);

            showToast(`Downloaded ${invoice.description || "invoice"}`);
        } catch {
            showToast("Could not download invoice PDF");
        }
    }

    async function downloadAllInvoices() {
        if (invoices.length === 0) {
            showToast("No invoices to download");
            return;
        }

        showToast("Preparing invoices…");

        for (const invoice of invoices) {
            // eslint-disable-next-line no-await-in-loop
            await downloadInvoice(invoice);
        }
    }

    const totalAgentFees = formatCurrencyCents(billing?.summary.totalAgentFeesPaidCents);
    const nextCharge = formatCurrencyCents(billing?.summary.nextChargeCents ?? 0);
    const currentMonthExecution = billing
        ? formatCurrencyCents(billing.summary.currentMonthExecutionCostCents)
        : NA;

    const agents = billing?.agents ?? [];
    const invoices = billing?.invoices ?? [];

    const thresholdLabel = useMemo(() => {
        const num = parseFloat(threshold.replace(/[^0-9.]/g, ""));
        if (Number.isNaN(num) || num <= 0) return NA;
        return `$${Number.isInteger(num) ? num.toFixed(2) : num.toFixed(2)}`;
    }, [threshold]);

    if (isLoading) {
        return (
            <div className="billing-root mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
                <div className="h-7 w-48 animate-pulse rounded bg-gray-200" />
                <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="h-64 animate-pulse rounded-2xl bg-gray-100 lg:col-span-2" />
                    <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />
                </div>
            </div>
        );
    }

    if (apiError) {
        return (
            <div className="billing-root mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
                <h1 className="text-xl font-bold tracking-tight">Billing &amp; Usage</h1>
                <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 p-6 text-sm font-medium text-red-700">
                    {apiError}
                </div>
            </div>
        );
    }

    return (
        <div className="billing-root bg-gray-50 text-slate-900">
            <style dangerouslySetInnerHTML={{ __html: DOWNLOAD_STYLES }} />

            <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between gap-3">
                    <h1 className="text-xl font-bold tracking-tight">Billing &amp; Usage</h1>
                    <button
                        type="button"
                        onClick={downloadAllInvoices}
                        data-testid="billing-download-all"
                        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-300 hover:text-amber-700 sm:px-4"
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v11m0 0l4-4m-4 4l-4-4M5 17v2a2 2 0 002 2h10a2 2 0 002-2v-2" /></svg>
                        <span className="hidden sm:inline">Download all invoices</span>
                        <span className="sm:hidden">Invoices</span>
                    </button>
                </div>

                {/* 1. Plan summary */}
                <section className="grid grid-cols-1 gap-6 lg:grid-cols-3" aria-label="Plan summary">
                    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-500">Current Plan</span>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                                {billing?.plan.status ?? NA}
                            </span>
                        </div>
                        <h2 className="mt-2 text-2xl font-bold">{billing?.plan.name ?? NA}</h2>
                        <p className="mt-1 text-sm text-slate-500">
                            No monthly subscription. Pay once per agent, plus small per-execution fees.
                        </p>

                        <div className="my-5 h-px bg-gray-100" />

                        <div className="space-y-3">
                            {agents.length === 0 ? (
                                <p className="text-sm text-slate-400">No agents purchased yet.</p>
                            ) : (
                                agents.map((agent, index) => {
                                    const accent = ACCENTS[index % ACCENTS.length];
                                    return (
                                        <div key={agent.id} className="flex items-center justify-between">
                                            <div className="flex min-w-0 items-center gap-2.5">
                                                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${accent.chip}`}>
                                                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" /></svg>
                                                </span>
                                                <span className="truncate text-sm font-medium text-slate-800">{agent.name}</span>
                                            </div>
                                            <span className="shrink-0 font-mono text-sm tabular-nums text-slate-600">
                                                {formatCurrencyCents(agent.priceCents)} <span className="text-slate-400">+ {NA}/run</span>
                                            </span>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <div className="my-5 h-px bg-gray-100" />

                        <div className="flex items-center justify-between font-bold">
                            <span>Total agent fees paid</span>
                            <span className="font-mono tabular-nums">{totalAgentFees}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                            <span className="text-sm text-slate-600">This month execution costs (to date)</span>
                            <span className="font-mono text-sm font-semibold tabular-nums text-amber-600">{currentMonthExecution}</span>
                        </div>
                    </div>

                    <div className="flex flex-col rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-6">
                        <span className="text-sm font-semibold text-amber-700">Next Charge</span>
                        <div className="mt-2 font-mono text-3xl font-black tabular-nums text-slate-900">{nextCharge}</div>
                        <p className="mt-1 text-sm text-slate-600">No upcoming agent purchases</p>

                        <div className="my-4 h-px bg-amber-200/60" />

                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Execution fees</span>
                        <p className="mt-1 text-sm text-slate-600">Billed monthly on the 1st</p>
                        <p className="mt-1 text-sm font-semibold text-slate-800">
                            Next execution bill: <span className="font-mono">{NA}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">Usage tracking not available yet</p>
                    </div>
                </section>

                {/* 2. Usage breakdown */}
                <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" aria-label="Usage breakdown">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-lg font-bold">Usage This Month</h2>
                    </div>

                    <div className="mt-6 space-y-5">
                        {agents.length === 0 ? (
                            <p className="text-sm text-slate-400">No usage to display yet.</p>
                        ) : (
                            agents.map((agent, index) => {
                                const accent = ACCENTS[index % ACCENTS.length];
                                return (
                                    <div key={agent.id}>
                                        <div className="mb-1.5 flex items-center justify-between gap-2">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${accent.dot}`} />
                                                <span className="truncate text-sm font-medium text-slate-800">{agent.name}</span>
                                            </div>
                                            <span className="shrink-0 font-mono text-sm tabular-nums text-slate-500">
                                                {NA} executions · {NA}
                                            </span>
                                        </div>
                                        <div className="relative h-3 rounded-full bg-gray-100">
                                            <div className="absolute inset-0 overflow-hidden rounded-full">
                                                <div className={`h-full rounded-full ${accent.fill}`} style={{ width: "0%" }} />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
                        <span className="text-sm font-semibold">
                            Total executions: <span className="font-mono tabular-nums">{NA}</span>
                        </span>
                        <span className="text-sm font-bold text-amber-600">
                            Total cost: <span className="font-mono tabular-nums">{NA}</span>
                        </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                        Average cost per customer interaction: <span className="font-mono">{NA}</span>
                    </p>
                </section>

                {/* 3. Invoice history */}
                <section className="rounded-2xl border border-gray-100 bg-white shadow-sm" aria-label="Invoice history">
                    <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                        <h2 className="text-lg font-bold">Invoices</h2>
                        <button
                            type="button"
                            onClick={downloadAllInvoices}
                            data-testid="billing-invoices-download-all"
                            className="rounded text-sm font-semibold text-amber-600 transition hover:text-amber-700"
                        >
                            Download all
                        </button>
                    </div>

                    {invoices.length === 0 ? (
                        <p className="px-6 py-8 text-center text-sm text-slate-400">No invoices yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr>
                                        <th scope="col" className="bg-gray-50 px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Date</th>
                                        <th scope="col" className="bg-gray-50 px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Description</th>
                                        <th scope="col" className="bg-gray-50 px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</th>
                                        <th scope="col" className="bg-gray-50 px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                                        <th scope="col" className="bg-gray-50 px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Invoice</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoices.map((invoice) => (
                                        <tr key={invoice.id} className="border-b border-gray-50 transition last:border-0 hover:bg-amber-50/30">
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(invoice.createdAt)}</td>
                                            <td className="px-6 py-4 text-sm text-slate-700">{invoice.description || NA}</td>
                                            <td className="px-6 py-4 font-mono text-sm font-semibold tabular-nums text-slate-800">{formatCurrencyCents(invoice.amountCents)}</td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(invoice.status)}`}>
                                                    {statusLabel(invoice.status)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => downloadInvoice(invoice)}
                                                    data-testid="billing-invoice-download"
                                                    aria-label={`Download ${invoice.description || "invoice"} PDF`}
                                                    className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-xs font-semibold text-amber-600 transition hover:text-amber-700"
                                                >
                                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path strokeLinejoin="round" d="M7 3h7l4 4v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" /><path strokeLinejoin="round" d="M14 3v4h4" /></svg>
                                                    PDF
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                {/* 4. Payment method */}
                <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" aria-label="Payment method">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold">Payment Method</h2>
                        <button
                            type="button"
                            onClick={() => setModalOpen(true)}
                            data-testid="billing-update-payment"
                            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-300 hover:text-amber-700"
                        >
                            Update
                        </button>
                    </div>

                    {billing?.paymentMethod ? (
                        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                            <div className="grid h-8 w-12 shrink-0 place-items-center rounded-lg bg-blue-50 text-xs font-extrabold uppercase italic text-blue-800">
                                {billing.paymentMethod.brand}
                            </div>
                            <div className="min-w-0">
                                <div className="text-base font-semibold">
                                    {billing.paymentMethod.brand} ending in{" "}
                                    <span className="font-mono tabular-nums">{billing.paymentMethod.last4}</span>
                                </div>
                                <div className="text-sm text-slate-500">
                                    Expires{" "}
                                    <span className="font-mono tabular-nums">
                                        {String(billing.paymentMethod.expMonth).padStart(2, "0")}/{billing.paymentMethod.expYear}
                                    </span>
                                </div>
                            </div>
                            <span className="self-start rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 sm:ml-auto sm:self-auto">
                                Default
                            </span>
                        </div>
                    ) : (
                        <div className="mt-4 flex items-center gap-3 text-sm text-slate-500">
                            <span className="grid h-8 w-12 shrink-0 place-items-center rounded-lg bg-gray-100 text-xs font-bold text-slate-400">{NA}</span>
                            No payment method on file ({NA}).
                        </div>
                    )}

                    <div className="mt-4 border-t border-gray-50 pt-4">
                        <div className="text-sm font-medium text-slate-800">{billing?.businessName ?? NA}</div>
                        <div className="text-sm text-slate-500">{billing?.billingAddress ?? NA}</div>
                    </div>
                </section>

                {/* 5. Spending alerts */}
                <section className="mb-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" aria-label="Spending alerts">
                    <h2 className="text-base font-bold">Spending Alerts</h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Get notified when your monthly execution costs exceed a threshold.
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-4">
                        <label htmlFor="thresholdInput" className="text-sm text-slate-700">
                            Alert me when monthly costs exceed:
                        </label>
                        <input
                            id="thresholdInput"
                            type="text"
                            inputMode="decimal"
                            value={threshold}
                            onChange={(event) => setThreshold(event.target.value)}
                            data-testid="billing-threshold-input"
                            className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-center font-mono text-sm tabular-nums text-slate-800 focus-visible:border-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                            aria-label="Spending alert threshold in dollars"
                        />
                        <button
                            type="button"
                            role="switch"
                            aria-checked={alertsOn}
                            onClick={() => {
                                setAlertsOn((current) => !current);
                                showToast(!alertsOn ? "Spending alerts on" : "Spending alerts off");
                            }}
                            data-testid="billing-alerts-toggle"
                            aria-label="Enable spending alerts"
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ${alertsOn ? "bg-amber-500" : "bg-gray-300"}`}
                        >
                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${alertsOn ? "translate-x-[22px]" : "translate-x-[2px]"}`} />
                        </button>
                    </div>

                    <p className="mt-3 text-xs text-slate-400">
                        Current month: <span className="font-mono tabular-nums">{currentMonthExecution}</span> of{" "}
                        <span className="font-mono tabular-nums">{thresholdLabel}</span> limit
                    </p>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-amber-400" style={{ width: "0%" }} />
                    </div>
                </section>
            </div>

            {modalOpen ? (
                <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="billing-modal-title">
                    <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
                    <div className="absolute inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4">
                        <div className="relative w-full rounded-t-2xl bg-white p-6 shadow-xl sm:max-w-md sm:rounded-2xl">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h2 id="billing-modal-title" className="text-lg font-bold">Update payment method</h2>
                                    <p className="mt-0.5 text-sm text-slate-500">
                                        {billing?.paymentMethod
                                            ? `Your card replaces the ${billing.paymentMethod.brand} ending ${billing.paymentMethod.last4}.`
                                            : "Add a card to your account."}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(false)}
                                    data-testid="billing-modal-close"
                                    className="-mr-1.5 -mt-1.5 rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-50 hover:text-slate-700"
                                    aria-label="Close dialog"
                                >
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                                </button>
                            </div>

                            <div className="mt-5 space-y-4">
                                <div>
                                    <label htmlFor="billingCardName" className="mb-1.5 block text-sm font-medium text-slate-700">Name on card</label>
                                    <input id="billingCardName" type="text" placeholder="Name" className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus-visible:border-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400" />
                                </div>
                                <div>
                                    <label htmlFor="billingCardNumber" className="mb-1.5 block text-sm font-medium text-slate-700">Card number</label>
                                    <input id="billingCardNumber" type="text" inputMode="numeric" placeholder="1234 5678 9012 3456" className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 font-mono text-sm tabular-nums focus-visible:border-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="billingCardExp" className="mb-1.5 block text-sm font-medium text-slate-700">Expiry</label>
                                        <input id="billingCardExp" type="text" inputMode="numeric" placeholder="MM / YY" className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 font-mono text-sm tabular-nums focus-visible:border-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400" />
                                    </div>
                                    <div>
                                        <label htmlFor="billingCardCvc" className="mb-1.5 block text-sm font-medium text-slate-700">CVC</label>
                                        <input id="billingCardCvc" type="text" inputMode="numeric" placeholder="123" className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 font-mono text-sm tabular-nums focus-visible:border-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400" />
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(false)}
                                    data-testid="billing-modal-cancel"
                                    className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setModalOpen(false);
                                        showToast("Payment method updated");
                                    }}
                                    data-testid="billing-modal-save"
                                    className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                                >
                                    Save changes
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-[70] flex flex-col items-stretch gap-2 sm:left-auto sm:items-end" aria-live="polite">
                {toast ? (
                    <div className="billing-toast show pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg" role="status">
                        <svg className="h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v11m0 0l4-4m-4 4l-4-4M5 17v2a2 2 0 002 2h10a2 2 0 002-2v-2" /></svg>
                        <span>{toast}</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
