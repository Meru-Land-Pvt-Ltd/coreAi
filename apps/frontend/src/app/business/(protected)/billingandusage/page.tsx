"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { CallRecordingPlayer } from "@/components/common/call-recording-player";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { downloadInvoicePdf } from "@/lib/invoice-print";
import { businessCheckoutPath } from "@/lib/routes";

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
    displayAmountCents?: number;
    currency: string;
    status: string;
    billingName?: string | null;
    billingEmail?: string | null;
    billingAddress?: string | null;
    listingId?: string | null;
};

function invoiceNumberFor(id: string) {
    return `INV-${id.slice(-8).toUpperCase()}`;
}

function invoiceDisplayAmount(invoice: BillingInvoice) {
    if (typeof invoice.displayAmountCents === "number") {
        return invoice.displayAmountCents;
    }
    if (invoice.status.toUpperCase() === "TRIALING") return 0;
    if (invoice.status.toUpperCase() === "SUCCEEDED") return invoice.amountCents;
    return 0;
}

type BillingAgent = {
    id: string;
    name: string;
    priceCents: number;
    pricingModel?: string | null;
    trialDays?: number | null;
    isTrial?: boolean;
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
    billingEmail: string | null;
    billingAddress: string | null;
};

type BillingResponse = { billing: Billing };

type UsageBill = {
    month: string;
    totalCalls: number;
    totalDurationMinutes: number;
    totalBilledUsd: number;
    updatedAt: string | null;
    agentRollup: Array<{
        agentId: string | null;
        agentName: string;
        callCount: number;
        durationMinutes: number;
        billedCostUsd: number;
        amountCents: number;
        serviceCosts: Array<{
            serviceCode: string;
            serviceName: string;
            unit: string;
            quantity: number;
            billedCostUsd: number;
            amountCents: number;
        }>;
    }>;
    serviceRollup: Array<{
        serviceCode: string;
        serviceName: string;
        quantity: number;
        billedCostUsd: number;
    }>;
    calls: Array<{
        callId: string;
        customerPhone: string;
        installedAgentId: string | null;
        durationMinutes: number | null;
        durationSeconds: number | null;
        billedCostUsd: number;
        recordedAt: string | null;
        /** Present only when call recording was enabled for this call. */
        recordingUrl: string | null;
    }>;
};

type UsageInvoice = {
    id: string;
    invoiceNumber: string;
    billingMonth: string;
    status: "OPEN" | "OVERDUE" | "PAID" | "VOID";
    amountCents: number;
    issuedAt: string;
    dueAt: string;
    paidAt: string | null;
    callCount: number;
    isAccruing?: boolean;
    agentBreakdown: Array<{
        agentId: string | null;
        agentName: string;
        callCount: number;
        durationMinutes: number;
        billedCostUsd: number;
        amountCents: number;
        serviceCosts: Array<{
            serviceCode: string;
            serviceName: string;
            unit: string;
            quantity: number;
            billedCostUsd: number;
            amountCents: number;
        }>;
    }>;
};

type UsageInvoicesResponse = { invoices: UsageInvoice[] };
type InvoiceTab = "trial" | "paid" | "overdue";

const NA = "0";

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

function usageDueAt(month: string) {
    const [year, monthNumber] = month.split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber, 8)).toISOString();
}

function formatCallTimestamp(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return NA;
    return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatCallDuration(call: { durationSeconds: number | null; durationMinutes: number | null }) {
    const seconds = call.durationSeconds ?? (call.durationMinutes ? Math.round(call.durationMinutes * 60) : 0);
    if (!seconds || seconds <= 0) return "0:00";
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function isTrialPurchaseInvoice(status: string) {
    return status.toUpperCase() === "TRIALING";
}

function isPaidPurchaseInvoice(status: string) {
    return status.toUpperCase() === "SUCCEEDED";
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

function VisaIcon() {
    return (
        <svg viewBox="0 0 38 16" className="h-5 w-auto" fill="none" xmlns="http://www.w3.org/2000/svg">
            <text
                x="2"
                y="12.5"
                fontFamily="'Inter', 'Arial Black', sans-serif"
                fontWeight="900"
                fontStyle="italic"
                fontSize="12"
                fill="#1A1F71"
                letterSpacing="-0.3"
            >
                VISA
            </text>
            <polygon points="2,4.5 4.5,4.5 3,6" fill="#F7B600" />
        </svg>
    );
}

function MastercardIcon() {
    return (
        <svg viewBox="0 0 76 16" className="h-5 w-auto" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="7" fill="#EB001B" />
            <circle cx="17" cy="8" r="7" fill="#F79E1B" fillOpacity="0.85" />
            <text x="28" y="11.5" fontFamily="'Inter', sans-serif" fontWeight="700" fontSize="8" fill="#1F2937" letterSpacing="-0.2">mastercard</text>
        </svg>
    );
}

function AmexIcon() {
    return (
        <svg viewBox="0 0 28 16" className="h-5 w-auto" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="28" height="16" rx="2" fill="#01A6E5" />
            <text x="14" y="10.5" textAnchor="middle" fontFamily="'Inter', sans-serif" fontWeight="900" fontSize="5.5" fill="#FFFFFF" letterSpacing="0.2">AMEX</text>
        </svg>
    );
}

function DiscoverIcon() {
    return (
        <svg viewBox="0 0 54 16" className="h-5 w-auto" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="discGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#FF8A00" />
                    <stop offset="100%" stopColor="#FF5000" />
                </linearGradient>
            </defs>
            <text x="1" y="11.5" fontFamily="'Inter', 'Arial Black', sans-serif" fontWeight="900" fontSize="9" fill="#111827" letterSpacing="-0.2">DISC</text>
            <circle cx="28.5" cy="8" r="3.2" fill="url(#discGrad)" />
            <text x="33.5" y="11.5" fontFamily="'Inter', 'Arial Black', sans-serif" fontWeight="900" fontSize="9" fill="#111827" letterSpacing="-0.2">VER</text>
        </svg>
    );
}

function DinersClubIcon() {
    return (
        <svg viewBox="0 0 68 16" className="h-5 w-auto" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6.5" stroke="#0079C1" strokeWidth="1.5" />
            <path d="M8 1.5a6.5 6.5 0 0 0 0 13v-13z" fill="#0079C1" />
            <circle cx="8" cy="8" r="3" stroke="#0079C1" strokeWidth="1" fill="#FFFFFF" />
            <text x="18" y="11" fontFamily="'Inter', sans-serif" fontWeight="800" fontSize="7" fill="#0D4B81" letterSpacing="-0.1">Diners Club</text>
        </svg>
    );
}

function JcbIcon() {
    return (
        <svg viewBox="0 0 32 16" className="h-5 w-auto" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="2" width="9" height="12" rx="1.5" fill="#003580" />
            <rect x="11" y="2" width="9" height="12" rx="1.5" fill="#D0021B" />
            <rect x="21" y="2" width="9" height="12" rx="1.5" fill="#00875A" />
            <text x="3" y="10.5" fontFamily="'Inter', sans-serif" fontWeight="900" fontSize="7.5" fill="#FFFFFF">J</text>
            <text x="13" y="10.5" fontFamily="'Inter', sans-serif" fontWeight="900" fontSize="7.5" fill="#FFFFFF">C</text>
            <text x="23" y="10.5" fontFamily="'Inter', sans-serif" fontWeight="900" fontSize="7.5" fill="#FFFFFF">B</text>
        </svg>
    );
}

function UnionPayIcon() {
    return (
        <svg viewBox="0 0 38 16" className="h-5 w-auto" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="2" width="17" height="12" rx="1" fill="#C51A1B" />
            <rect x="18" y="2" width="19" height="12" rx="1" fill="#004D95" />
            <text x="3" y="10.5" fontFamily="'Inter', sans-serif" fontWeight="900" fontSize="6" fill="#FFFFFF">Union</text>
            <text x="19.5" y="10.5" fontFamily="'Inter', sans-serif" fontWeight="900" fontSize="6" fill="#00B0FF">Pay</text>
        </svg>
    );
}

function DefaultCardIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-5 w-auto text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
            <rect width="20" height="14" x="2" y="5" rx="2" />
            <line x1="2" x2="22" y1="10" y2="10" />
        </svg>
    );
}

function CardBrandIcon({ brand }: { brand: string }) {
    const brandKey = brand.toLowerCase().trim();

    let iconElement: React.ReactNode;
    switch (brandKey) {
        case "visa":
            iconElement = <VisaIcon />;
            break;
        case "mastercard":
            iconElement = <MastercardIcon />;
            break;
        case "amex":
        case "american express":
            iconElement = <AmexIcon />;
            break;
        case "discover":
            iconElement = <DiscoverIcon />;
            break;
        case "diners":
        case "diners club":
            iconElement = <DinersClubIcon />;
            break;
        case "jcb":
            iconElement = <JcbIcon />;
            break;
        case "unionpay":
            iconElement = <UnionPayIcon />;
            break;
        default:
            iconElement = <DefaultCardIcon />;
            break;
    }

    return (
        <div className="flex h-8 w-14 shrink-0 items-center justify-start">
            {iconElement}
        </div>
    );
}

function formatBrandName(brand: string) {
    const b = brand.trim().toLowerCase();
    if (b === "visa") return "Visa";
    if (b === "mastercard") return "Mastercard";
    if (b === "amex" || b === "american express") return "American Express";
    if (b === "discover") return "Discover";
    if (b === "diners" || b === "diners club") return "Diners Club";
    if (b === "jcb") return "JCB";
    if (b === "unionpay") return "UnionPay";
    return brand.charAt(0).toUpperCase() + brand.slice(1);
}

export default function BusinessBillingUsagePage() {
    const router = useRouter();

    const [billing, setBilling] = useState<Billing | null>(null);
    const [usage, setUsage] = useState<UsageBill | null>(null);
    const [usageInvoices, setUsageInvoices] = useState<UsageInvoice[]>([]);
    const [invoiceTab, setInvoiceTab] = useState<InvoiceTab>("paid");
    const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [apiError, setApiError] = useState("");
    const [toast, setToast] = useState("");

    useEffect(() => {
        let mounted = true;

        async function loadBilling(initialLoad = true) {
            try {
                if (initialLoad) setIsLoading(true);
                setApiError("");

                const [response, usageResponse, invoiceResponse] = await Promise.all([
                    apiGet<BillingResponse>("/payments/billing"),
                    apiGet<UsageBill>("/business/billing/usage"),
                    apiGet<UsageInvoicesResponse>("/business/billing/usage-invoices")
                ]);

                if (!mounted) return;

                if (!response.success || !response.data?.billing) {
                    setApiError(response.error ?? "Could not load billing information");
                    setBilling(null);
                    return;
                }

                setBilling(response.data.billing);
                setUsage(usageResponse.success && usageResponse.data ? usageResponse.data : null);
                setUsageInvoices(
                    invoiceResponse.success && invoiceResponse.data?.invoices
                        ? invoiceResponse.data.invoices
                        : []
                );
            } catch (error) {
                if (!mounted) return;
                setApiError(error instanceof Error ? error.message : "Could not load billing information");
                setBilling(null);
            } finally {
                if (mounted) setIsLoading(false);
            }
        }

        void loadBilling();
        const refreshTimer = window.setInterval(() => void loadBilling(false), 5 * 60 * 1000);

        return () => {
            mounted = false;
            window.clearInterval(refreshTimer);
        };
    }, []);

    function openInvoice(invoiceId: string) {
        router.push(`/business/billingandusage/billing?invoiceId=${encodeURIComponent(invoiceId)}`);
    }

    function openUsageInvoice(invoice: UsageInvoice) {
        const agentId = invoice.agentBreakdown[0]?.agentId;
        const suffix = agentId ? `&agentId=${encodeURIComponent(agentId)}` : "";
        router.push(`/business/billingandusage/billing?invoiceId=${encodeURIComponent(invoice.id)}${suffix}`);
    }

    function showToast(message: string) {
        setToast(message);
        window.setTimeout(() => setToast(""), 2800);
    }

    async function downloadInvoice(invoice: BillingInvoice) {
        showToast(`Preparing ${invoice.description || "invoice"} PDF…`);

        try {
            await downloadInvoicePdf(invoice.id, `invoice-${invoiceNumberFor(invoice.id)}.pdf`);
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

    async function payUsageInvoice(invoice: UsageInvoice) {
        if (payingInvoiceId) return;
        setPayingInvoiceId(invoice.id);
        try {
            const response = await apiPost(`/business/billing/usage-invoices/${invoice.id}/pay`, {});
            if (!response.success) {
                showToast(response.error ?? "Could not pay invoice");
                return;
            }
            setUsageInvoices((current) => current.map((item) =>
                item.id === invoice.id ? { ...item, status: "PAID", paidAt: new Date().toISOString() } : item
            ));
            showToast("Invoice paid and services restored");
        } catch (error) {
            showToast(error instanceof Error ? error.message : "Could not pay invoice");
        } finally {
            setPayingInvoiceId(null);
        }
    }

    async function cancelAgentSubscription(agentId: string) {
        if (!window.confirm("Are you sure you want to cancel this agent subscription?")) return;
        try {
            const response = await apiPost(`/payments/cancel-agent/${agentId}`, {});
            if (response.success) {
                showToast("Subscription cancelled successfully");
                window.location.reload();
            } else {
                showToast(response.error ?? "Failed to cancel subscription");
            }
        } catch (error) {
            showToast(error instanceof Error ? error.message : "Failed to cancel subscription");
        }
    }

    const totalAgentFees = formatCurrencyCents(billing?.summary.totalAgentFeesPaidCents);
    const nextCharge = formatCurrencyCents(billing?.summary.nextChargeCents ?? 0);
    const currentMonthExecution = formatCurrencyCents(Math.round((usage?.totalBilledUsd ?? 0) * 100));
    const usageCalls = usage?.calls ?? [];
    const agentNameById = useMemo(
        () => new Map((usage?.agentRollup ?? []).map((agent) => [agent.agentId ?? "", agent.agentName])),
        [usage?.agentRollup]
    );

    const agents = billing?.agents ?? [];
    const invoices = billing?.invoices ?? [];
    const trialPurchaseInvoices = invoices.filter((invoice) => isTrialPurchaseInvoice(invoice.status));
    const paidPurchaseInvoices = invoices.filter((invoice) => isPaidPurchaseInvoice(invoice.status));
    const failedPurchaseInvoices = invoices.filter(
        (invoice) => invoice.status.toUpperCase() === "FAILED" || invoice.status.toUpperCase() === "CANCELED"
    );
    const paidUsageInvoices = usageInvoices.filter((invoice) => invoice.status === "PAID");
    const currentUsageStatement: UsageInvoice | null = usage && usage.totalCalls > 0
        ? {
            id: `accrued-${usage.month}`,
            invoiceNumber: `ACCRUED-${usage.month.replace("-", "")}`,
            billingMonth: usage.month,
            status: "OPEN",
            amountCents: Math.round(usage.totalBilledUsd * 100),
            issuedAt: usage.updatedAt ?? new Date().toISOString(),
            dueAt: usageDueAt(usage.month),
            paidAt: null,
            callCount: usage.totalCalls,
            agentBreakdown: usage.agentRollup,
            isAccruing: true
        }
        : null;
    const overdueUsageInvoices = [
        ...usageInvoices.filter((invoice) => invoice.status === "OPEN" || invoice.status === "OVERDUE"),
        ...(currentUsageStatement ? [currentUsageStatement] : [])
    ];

    if (isLoading) {
        return (
            <div className="billing-root w-full overflow-x-hidden px-3 py-4 sm:px-4 lg:px-5">
                <BusinessPageHeader
                    className="-mx-3 -mt-4 sm:-mx-4 lg:-mx-5"
                    title="Billing & Usage"
                    description="Manage your plan, payment methods, and invoices."
                />
                <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="h-64 animate-pulse rounded-2xl bg-gray-100 lg:col-span-2" />
                    <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />
                </div>
            </div>
        );
    }

    if (apiError) {
        return (
            <div className="billing-root w-full overflow-x-hidden px-3 py-4 sm:px-4 lg:px-5">
                <BusinessPageHeader
                    className="-mx-3 -mt-4 sm:-mx-4 lg:-mx-5"
                    title="Billing & Usage"
                    description="Manage your plan, payment methods, and invoices."
                />
                <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 p-6 text-sm font-medium text-red-700">
                    {apiError}
                </div>
            </div>
        );
    }

    return (
        <div className="billing-root bg-gray-50 text-slate-900">
            <style dangerouslySetInnerHTML={{ __html: DOWNLOAD_STYLES }} />

            <div className="w-full space-y-4 overflow-x-hidden px-3 py-4 sm:px-4 lg:px-5">
                <BusinessPageHeader
                    className="-mx-3 -mt-4 sm:-mx-4 lg:-mx-5"
                    title="Billing & Usage"
                    description="Manage your plan, payment methods, and invoices."
                    actions={(
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
                    )}
                />

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
                            Agent access is billed based on its model (one-time or monthly subscription). Usage charges apply separately.
                        </p>
                        <div className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-100">
                            {agents.length === 0 ? (
                                <p className="px-4 py-4 text-sm text-slate-400">No purchased agents yet.</p>
                            ) : agents.map((agent) => (
                                <div key={agent.id} className="flex items-center justify-between gap-4 px-4 py-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-semibold text-slate-800">{agent.name}</p>
                                        <p className="text-xs text-slate-400">
                                            {agent.pricingModel === "FREE"
                                                ? "Free to install (Pay only for usage)"
                                                : agent.pricingModel === "ONE_TIME"
                                                    ? "One-time purchase (Usage charges apply separately)"
                                                    : "Monthly subscription (Usage charges billed separately)"}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="shrink-0 font-mono text-sm font-bold text-green-700">
                                            {agent.isTrial
                                                ? "Trial"
                                                : agent.pricingModel === "FREE"
                                                    ? "$0"
                                                    : `${formatCurrencyCents(agent.priceCents)} paid`}
                                        </span>
                                        {agent.pricingModel === "SUBSCRIPTION" ? (
                                            <button
                                                type="button"
                                                onClick={() => cancelAgentSubscription(agent.id)}
                                                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 transition hover:bg-red-100 hover:text-red-700"
                                            >
                                                Cancel
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 flex items-center justify-between text-sm font-semibold">
                            <span className="text-slate-500">Total amount paid</span>
                            <span className="font-mono text-slate-900">{totalAgentFees}</span>
                        </div>
                    </div>

                    <div className="flex flex-col rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-6">
                        <span className="text-sm font-semibold text-amber-700">Current accrued usage</span>
                        <div className="mt-2 font-mono text-3xl font-black tabular-nums text-slate-900">{currentMonthExecution}</div>
                        <p className="mt-1 text-sm text-slate-600">Updates automatically as agents are used</p>

                        <div className="my-4 h-px bg-amber-200/60" />

                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Execution fees</span>
                        <p className="mt-1 text-sm text-slate-600">Billed monthly on the 1st</p>
                        <p className="mt-1 text-sm font-semibold text-slate-800">
                            Unpaid invoices: <span className="font-mono">{nextCharge}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">Finalized on the 1st; payment is due by the 7th</p>
                    </div>
                </section>

                {/* 2. Usage breakdown */}
                <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" aria-label="Usage breakdown">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-lg font-bold">Usage This Month</h2>
                        <span className="text-xs text-slate-400">
                            {usage?.updatedAt ? `Updated ${formatDate(usage.updatedAt)}` : "No usage recorded"}
                        </span>
                    </div>

                    <div className="mt-4 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
                        {(usage?.agentRollup.length ?? 0) === 0 ? (
                            <p className="px-4 py-6 text-sm text-slate-400">No usage to display yet.</p>
                        ) : (
                            usage!.agentRollup.map((agent) => (
                                <div key={agent.agentId ?? agent.agentName} className="flex items-center justify-between gap-4 bg-white px-4 py-4">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">{agent.agentName}</p>
                                        <p className="mt-1 text-xs text-slate-400">{agent.callCount} calls · {agent.durationMinutes.toFixed(1)} minutes</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-3">
                                        <span className="font-mono text-base font-bold text-amber-600">${agent.billedCostUsd.toFixed(2)}</span>
                                        <button
                                            type="button"
                                            onClick={() => router.push(`/business/checkout?mode=usage&agentId=${encodeURIComponent(agent.agentId ?? "")}`)}
                                            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-amber-600"
                                        >
                                            Pay
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                {/* Call history & recordings */}
                <section
                    className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
                    aria-label="Call history"
                    data-testid="usage-call-history"
                >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-lg font-bold" data-testid="usage-call-history-heading">Call History</h2>
                        <span className="text-xs text-slate-400">
                            {usageCalls.length === 0
                                ? "No calls this month"
                                : `${usageCalls.length} call${usageCalls.length === 1 ? "" : "s"} this month`}
                        </span>
                    </div>

                    <div className="mt-4 max-h-[28rem] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-100">
                        {usageCalls.length === 0 ? (
                            <p className="px-4 py-6 text-sm text-slate-400" data-testid="usage-call-history-empty">
                                Calls will appear here after your agent answers them. Recordings are available when
                                call recording is enabled for the agent.
                            </p>
                        ) : (
                            usageCalls.map((call) => (
                                <div key={call.callId} className="bg-white px-4 py-4" data-testid="usage-call-row">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900" data-testid="usage-call-phone">
                                                {call.customerPhone}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-400" data-testid="usage-call-meta">
                                                {agentNameById.get(call.installedAgentId ?? "") ?? "AI agent"}
                                                {call.recordedAt ? ` · ${formatCallTimestamp(call.recordedAt)}` : ""}
                                                {` · ${formatCallDuration(call)}`}
                                            </p>
                                        </div>
                                        <span className="shrink-0 font-mono text-sm font-bold text-slate-700" data-testid="usage-call-cost">
                                            ${call.billedCostUsd.toFixed(2)}
                                        </span>
                                    </div>

                                    {call.recordingUrl ? (
                                        <div className="mt-3">
                                            <CallRecordingPlayer
                                                src={call.recordingUrl}
                                                testIdPrefix="usage-call-recording"
                                            />
                                        </div>
                                    ) : (
                                        <p className="mt-2 text-[11px] font-medium text-slate-300" data-testid="usage-call-no-recording">
                                            No recording for this call
                                        </p>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </section>

                {/* 3. Invoice history */}
                <section className="rounded-2xl border border-gray-100 bg-white shadow-sm" aria-label="Invoice history">
                    <div className="flex flex-col gap-3 border-b border-gray-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-lg font-bold">Invoices</h2>
                        <div className="flex flex-wrap rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Invoice status">
                            <button type="button" role="tab" aria-selected={invoiceTab === "trial"} onClick={() => setInvoiceTab("trial")} className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${invoiceTab === "trial" ? "bg-white text-amber-700 shadow-sm" : "text-slate-500"}`}>
                                Trial ({trialPurchaseInvoices.length})
                            </button>
                            <button type="button" role="tab" aria-selected={invoiceTab === "paid"} onClick={() => setInvoiceTab("paid")} className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${invoiceTab === "paid" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                                Paid ({paidPurchaseInvoices.length + paidUsageInvoices.length})
                            </button>
                            <button type="button" role="tab" aria-selected={invoiceTab === "overdue"} onClick={() => setInvoiceTab("overdue")} className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${invoiceTab === "overdue" ? "bg-white text-red-700 shadow-sm" : "text-slate-500"}`}>
                                Overdue ({overdueUsageInvoices.length + failedPurchaseInvoices.length})
                            </button>
                        </div>
                    </div>

                    {invoiceTab === "trial" && trialPurchaseInvoices.length === 0 ? (
                        <p className="px-6 py-8 text-center text-sm text-slate-400">No trial invoices yet.</p>
                    ) : invoiceTab === "paid" && paidPurchaseInvoices.length + paidUsageInvoices.length === 0 ? (
                        <p className="px-6 py-8 text-center text-sm text-slate-400">No paid invoices yet.</p>
                    ) : invoiceTab === "overdue" && overdueUsageInvoices.length === 0 && failedPurchaseInvoices.length === 0 ? (
                        <p className="px-6 py-8 text-center text-sm text-slate-400">No overdue invoices.</p>
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
                                    {invoiceTab === "trial" && trialPurchaseInvoices.map((invoice) => (
                                        <tr
                                            key={invoice.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => openInvoice(invoice.id)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    openInvoice(invoice.id);
                                                }
                                            }}
                                            className="cursor-pointer border-b border-gray-50 transition last:border-0 hover:bg-amber-50/30 focus-visible:bg-amber-50/40 focus-visible:outline-none"
                                        >
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(invoice.createdAt)}</td>
                                            <td className="px-6 py-4 text-sm text-slate-700">{invoice.description || NA}</td>
                                            <td className="px-6 py-4 font-mono text-sm font-semibold tabular-nums text-slate-800">{formatCurrencyCents(invoiceDisplayAmount(invoice))}</td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(invoice.status)}`}>
                                                    {statusLabel(invoice.status)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        void downloadInvoice(invoice);
                                                    }}
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
                                    {invoiceTab === "paid" && paidPurchaseInvoices.map((invoice) => (
                                        <tr
                                            key={invoice.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => openInvoice(invoice.id)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    openInvoice(invoice.id);
                                                }
                                            }}
                                            className="cursor-pointer border-b border-gray-50 transition last:border-0 hover:bg-amber-50/30 focus-visible:bg-amber-50/40 focus-visible:outline-none"
                                        >
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(invoice.createdAt)}</td>
                                            <td className="px-6 py-4 text-sm text-slate-700">{invoice.description || NA}</td>
                                            <td className="px-6 py-4 font-mono text-sm font-semibold tabular-nums text-slate-800">{formatCurrencyCents(invoiceDisplayAmount(invoice))}</td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(invoice.status)}`}>
                                                    {statusLabel(invoice.status)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        void downloadInvoice(invoice);
                                                    }}
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
                                    {invoiceTab === "paid" && paidUsageInvoices.map((invoice) => (
                                        <tr key={invoice.id} onClick={() => openUsageInvoice(invoice)} className="cursor-pointer border-b border-gray-50 transition last:border-0 hover:bg-amber-50/30">
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(invoice.paidAt ?? invoice.issuedAt)}</td>
                                            <td className="px-6 py-4 text-sm text-slate-700">Usage — {invoice.agentBreakdown.map((agent) => agent.agentName).join(", ") || "Agent"}</td>
                                            <td className="px-6 py-4 font-mono text-sm font-semibold">{formatCurrencyCents(invoice.amountCents)}</td>
                                            <td className="px-6 py-4"><span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">Paid</span></td>
                                            <td className="px-6 py-4 text-right font-mono text-xs text-slate-500">{invoice.invoiceNumber}</td>
                                        </tr>
                                    ))}
                                    {invoiceTab === "overdue" && overdueUsageInvoices.map((invoice) => (
                                        <tr key={invoice.id} onClick={() => openUsageInvoice(invoice)} className="cursor-pointer border-b border-red-50 bg-red-50/20 transition last:border-0 hover:bg-red-50/50">
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(invoice.issuedAt)}</td>
                                            <td className="px-6 py-4 text-sm text-slate-700">Usage — {invoice.agentBreakdown.map((agent) => agent.agentName).join(", ") || "Agent"}</td>
                                            <td className="px-6 py-4 font-mono text-sm font-semibold">{formatCurrencyCents(invoice.amountCents)}</td>
                                            <td className="px-6 py-4"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${invoice.isAccruing ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{invoice.isAccruing ? "Accruing" : invoice.status === "OVERDUE" ? "Overdue" : "Payment due"}</span></td>
                                            <td className="px-6 py-4 text-right">
                                                {invoice.isAccruing ? (
                                                    <span className="text-xs font-semibold text-amber-700">View invoice</span>
                                                ) : (
                                                    <button type="button" disabled={payingInvoiceId === invoice.id} onClick={(event) => { event.stopPropagation(); void payUsageInvoice(invoice); }} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50">
                                                        {payingInvoiceId === invoice.id ? "Paying…" : "Pay now"}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {invoiceTab === "overdue" && failedPurchaseInvoices.map((invoice) => (
                                        <tr
                                            key={invoice.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => openInvoice(invoice.id)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    openInvoice(invoice.id);
                                                }
                                            }}
                                            className="cursor-pointer border-b border-red-50 bg-red-50/20 transition last:border-0 hover:bg-red-50/50 focus-visible:bg-red-50/40 focus-visible:outline-none"
                                        >
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(invoice.createdAt)}</td>
                                            <td className="px-6 py-4 text-sm text-slate-700">{invoice.description || NA}</td>
                                            <td className="px-6 py-4 font-mono text-sm font-semibold tabular-nums text-slate-800">{formatCurrencyCents(invoice.amountCents)}</td>
                                            <td className="px-6 py-4">
                                                <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                                                    Suspended
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        router.push(businessCheckoutPath(invoice.listingId ?? undefined));
                                                    }}
                                                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600"
                                                >
                                                    Pay now
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
                    </div>

                    {billing?.paymentMethod ? (
                        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                            <CardBrandIcon brand={billing.paymentMethod.brand} />
                            <div className="min-w-0">
                                <div className="text-base font-semibold">
                                    {formatBrandName(billing.paymentMethod.brand)} ending in{" "}
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
                            <CardBrandIcon brand="" />
                            No payment method on file.
                        </div>
                    )}

                    {(billing?.businessName || billing?.billingAddress || billing?.billingEmail) ? (
                        <div className="mt-4 border-t border-gray-50 pt-4">
                            {billing?.businessName ? (
                                <div className="text-sm font-medium text-slate-800" data-testid="billing-saved-name">{billing.businessName}</div>
                            ) : null}
                            {billing?.billingAddress ? (
                                <div className="text-sm text-slate-500" data-testid="billing-saved-address">{billing.billingAddress}</div>
                            ) : null}
                            {billing?.billingEmail ? (
                                <div className="text-sm text-slate-500" data-testid="billing-saved-email">{billing.billingEmail}</div>
                            ) : null}
                        </div>
                    ) : null}
                </section>

            </div>

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
