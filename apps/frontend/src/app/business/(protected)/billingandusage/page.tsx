"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { BusinessPaymentMethodModal } from "@/components/business/business-payment-method-modal";
import { downloadInvoicePdf } from "@/lib/invoice-print";
import { businessCheckoutPath } from "@/lib/routes";
import { shouldShowSyntheticAccrual } from "@/components/business/current-month-accrual";
import { ExecutionPricingSummary, useBuyerExecutionPricing } from "@/components/business/execution-pricing-summary";

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
    listingName?: string | null;
    invoiceKind?: string | null;
    invoiceType?: string | null;
    trialEndsAt?: string | null;
    dueAt?: string | null;
};

function invoiceNumberFor(id: string) {
    return `INV-${id.slice(-8).toUpperCase()}`;
}

function invoiceDisplayAmount(invoice: BillingInvoice) {
    if (typeof invoice.displayAmountCents === "number") {
        return invoice.displayAmountCents;
    }
    if (["SUCCEEDED", "PAID", "COMPLETED"].includes(invoice.status.toUpperCase())) {
        return invoice.amountCents;
    }
    return 0;
}

type BillingAgent = {
    id: string;
    listingId?: string | null;
    installedAgentId?: string | null;
    name: string;
    priceCents: number;
    monthlyCostCents?: number | null;
    executionFeeCents?: number | null;
    iconUrl?: string | null;
    pricingModel?: string | null;
    trialDays?: number | null;
    isTrial?: boolean;
    status?: string | null;
    purchasedAt?: string | null;
    trialExecutionLimit?: number | null;
    trialExecutionsUsed?: number | null;
    trialExecutionsRemaining?: number | null;
};

type SpendingAlert = {
    enabled: boolean;
    thresholdCents: number;
    currentMonthCostCents?: number;
    lastNotifiedAt?: string | null;
};

type Billing = {
    plan: { name: string; status: string };
    agents: BillingAgent[];
    summary: {
        totalAgentFeesPaidCents: number;
        currentMonthExecutionCostCents: number | null;
        nextChargeCents: number;
        upcomingAgentChargeCents?: number | null;
        monthlySubscriptionCostCents?: number | null;
        projectedExecutionCostCents?: number | null;
    };
    usage: {
        billingMonth?: string;
        availableMonths?: UsageMonthOption[];
    } | null;
    invoices: BillingInvoice[];
    paymentMethod: BillingPaymentMethod | null;
    businessName: string | null;
    billingEmail: string | null;
    billingAddress: string | null;
    spendingAlert?: SpendingAlert | null;
};

type BillingResponse = { billing: Billing };

type UsageBill = {
    month: string;
    monthLabel?: string;
    availableMonths?: UsageMonthOption[];
    totalCalls: number;
    totalExecutions?: number;
    totalDurationMinutes: number;
    totalBilledUsd: number;
    totalCostUsd?: number;
    averageCostUsd?: number;
    updatedAt: string | null;
    agentRollup: Array<{
        agentId: string | null;
        installedAgentId?: string | null;
        listingId?: string | null;
        agentName: string;
        callCount: number;
        executionCount?: number;
        durationMinutes: number;
        billedCostUsd: number;
        amountCents: number;
        executionFeeCents?: number | null;
        iconUrl?: string | null;
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

type UsageMonthOption = {
    value: string;
    label: string;
    year?: number;
    month?: number;
};

type UsageInvoice = {
    id: string;
    invoiceNumber: string;
    billingMonth: string;
    status: "OPEN" | "PENDING" | "OVERDUE" | "PAID" | "VOID";
    amountCents: number;
    issuedAt: string;
    dueAt: string;
    paidAt: string | null;
    callCount: number;
    isAccruing?: boolean;
    agentBreakdown: Array<{
        agentId: string | null;
        installedAgentId?: string | null;
        listingId?: string | null;
        agentName: string;
        callCount: number;
        executionCount?: number;
        durationMinutes: number;
        billedCostUsd: number;
        amountCents: number;
        iconUrl?: string | null;
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

type InvoicePaymentResult = {
    status?: string;
    invoiceIds?: string[];
    carriedForward?: boolean;
    requiresAction?: boolean;
    clientSecret?: string | null;
};

type StripeConfigResponse = {
    publishableKey?: string | null;
};
type InvoiceTab = "paid" | "pending" | "overdue";

const NA = "—";
const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

const ACCENTS = [
    { dot: "bg-amber-400", chip: "bg-amber-50 text-amber-600", fill: "bg-amber-400" },
    { dot: "bg-green-400", chip: "bg-green-50 text-green-600", fill: "bg-green-400" },
    { dot: "bg-blue-400", chip: "bg-blue-50 text-blue-600", fill: "bg-blue-400" }
];

function formatCurrencyCents(cents: number | null | undefined) {
    if (cents === null || cents === undefined || Number.isNaN(cents)) return "$0.00";
    return `$${(cents / 100).toFixed(2)}`;
}

function formatCurrencyUsd(dollars: number | null | undefined, digits = 2) {
    if (dollars === null || dollars === undefined || Number.isNaN(dollars)) return "$0.00";
    return `$${dollars.toFixed(digits)}`;
}

function formatDate(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return NA;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function monthLabel(month: string) {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) return month;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function monthKeyForDate(value: string | null | undefined) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildMonthRange(startMonth: string, endMonth: string) {
    if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
        return [endMonth];
    }

    const [startYear, startNumber] = startMonth.split("-").map(Number);
    const [endYear, endNumber] = endMonth.split("-").map(Number);
    const cursor = new Date(Date.UTC(startYear, startNumber - 1, 1));
    const end = new Date(Date.UTC(endYear, endNumber - 1, 1));
    const months: string[] = [];

    while (cursor <= end && months.length < 120) {
        months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    return months.reverse();
}

function usageDueAt(month: string) {
    const [year, monthNumber] = month.split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber, 1)).toISOString();
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

function isTrialPurchaseInvoice(invoice: BillingInvoice) {
    const invoiceKind = (invoice.invoiceKind ?? invoice.invoiceType)?.toUpperCase();
    const status = invoice.status.toUpperCase();
    if (invoiceKind === "TRIAL" || status === "TRIALING") return true;
    if (invoiceKind) return false;
    return status === "TRIALING"
        || (["COMPLETED", "CANCELED"].includes(status) && /\btrial\b/i.test(invoice.description));
}

function purchaseInvoiceTab(invoice: BillingInvoice): InvoiceTab | null {
    if (isTrialPurchaseInvoice(invoice)) return "paid";
    const status = invoice.status.toUpperCase();
    if (["SUCCEEDED", "PAID", "COMPLETED"].includes(status)) return "paid";
    if (["PENDING", "PROCESSING", "OPEN"].includes(status)) return "pending";
    if (status === "OVERDUE") return "overdue";
    return null;
}

function isDirectlyPayableAgentInvoice(invoice: BillingInvoice) {
    const invoiceKind = (invoice.invoiceKind ?? invoice.invoiceType)?.toUpperCase();
    return invoiceKind === "POST_TRIAL" || invoiceKind === "SUBSCRIPTION_RENEWAL";
}

function statusBadgeClass(status: string, invoice?: BillingInvoice) {
    const value = status.toUpperCase();
    if (invoice && isTrialPurchaseInvoice(invoice)) return "bg-blue-50 text-blue-700";
    if (value === "SUCCEEDED" || value === "PAID" || value === "COMPLETED") return "bg-green-50 text-green-700";
    if (value === "TRIALING") return "bg-blue-50 text-blue-700";
    if (["PENDING", "PROCESSING", "OPEN"].includes(value)) return "bg-amber-50 text-amber-700";
    if (["OVERDUE", "FAILED"].includes(value)) return "bg-red-50 text-red-700";
    return "bg-gray-100 text-slate-600";
}

function statusLabel(status: string, invoice?: BillingInvoice) {
    const value = status.toUpperCase();
    if (invoice && isTrialPurchaseInvoice(invoice)) {
        const ended = invoice.trialEndsAt ? new Date(invoice.trialEndsAt).getTime() <= Date.now() : false;
        return value === "COMPLETED" || value === "PAID" || ended ? "Completed" : "Trial";
    }
    if (value === "SUCCEEDED") return "Paid";
    if (value === "PAID") return "Paid";
    if (value === "COMPLETED") return "Completed";
    if (value === "PENDING") return "Pending";
    if (value === "PROCESSING") return "Pending";
    if (value === "OPEN") return "Pending";
    if (value === "OVERDUE") return "Overdue";
    if (value === "FAILED") return "Failed";
    if (value === "CANCELED") return "Canceled";
    if (value === "REFUNDED") return "Refunded";
    return status;
}

function agentExecutionCount(agent: UsageBill["agentRollup"][number]) {
    return agent.executionCount ?? agent.callCount ?? 0;
}

function agentIdentity(agent: Pick<BillingAgent, "id" | "listingId" | "installedAgentId" | "name">) {
    return agent.installedAgentId || agent.listingId || agent.id || agent.name;
}

function usageAgentIdentity(agent: UsageBill["agentRollup"][number]) {
    return agent.installedAgentId || agent.agentId || agent.listingId || agent.agentName;
}

function AgentLogo({
    name,
    iconUrl,
    accentIndex = 0
}: {
    name: string;
    iconUrl?: string | null;
    accentIndex?: number;
}) {
    const accent = ACCENTS[accentIndex % ACCENTS.length];
    return (
        <span className={`grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg font-bold ${accent.chip}`}>
            {iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- listing icons may be uploaded URLs or data URLs.
                <img src={iconUrl} alt={`${name} logo`} className="h-full w-full object-cover" />
            ) : (
                <span aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "A"}</span>
            )}
        </span>
    );
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
    const [usageByMonth, setUsageByMonth] = useState<Record<string, UsageBill>>({});
    const [selectedMonth, setSelectedMonth] = useState(CURRENT_MONTH);
    const [usageInvoices, setUsageInvoices] = useState<UsageInvoice[]>([]);
    const [invoiceTab, setInvoiceTab] = useState<InvoiceTab>("paid");
    const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isUsageLoading, setIsUsageLoading] = useState(true);
    const [apiError, setApiError] = useState("");
    const [usageError, setUsageError] = useState("");
    const [toast, setToast] = useState("");
    const [paymentModalOpen, setPaymentModalOpen] = useState(false);
    const [spendingAlertEnabled, setSpendingAlertEnabled] = useState(false);
    const [spendingAlertThreshold, setSpendingAlertThreshold] = useState("50.00");
    const [spendingAlertSaving, setSpendingAlertSaving] = useState(false);
    const [spendingAlertError, setSpendingAlertError] = useState("");

    const {
        pricing: executionPricing,
        loading: executionPricingLoading,
        error: executionPricingError
    } = useBuyerExecutionPricing();

    const loadBilling = useCallback(async (initialLoad = false) => {
        try {
            if (initialLoad) setIsLoading(true);
            setApiError("");

            const [response, invoiceResponse] = await Promise.all([
                apiGet<BillingResponse>("/payments/billing"),
                apiGet<UsageInvoicesResponse>("/business/billing/usage-invoices")
            ]);

            if (!response.success || !response.data?.billing) {
                setApiError(response.error ?? "Could not load billing information");
                setBilling(null);
                return;
            }

            setBilling(response.data.billing);
            setUsageInvoices(
                invoiceResponse.success && invoiceResponse.data?.invoices
                    ? invoiceResponse.data.invoices
                    : []
            );
        } catch (error) {
            setApiError(error instanceof Error ? error.message : "Could not load billing information");
            setBilling(null);
        } finally {
            if (initialLoad) setIsLoading(false);
        }
    }, []);

    const loadUsage = useCallback(async (month: string, showLoading = true) => {
        try {
            if (showLoading) setIsUsageLoading(true);
            setUsageError("");
            const response = await apiGet<UsageBill>(
                `/business/billing/usage?month=${encodeURIComponent(month)}`
            );
            if (!response.success || !response.data) {
                setUsageError(response.error ?? "Could not load usage for this month");
                return;
            }
            setUsageByMonth((current) => ({ ...current, [month]: response.data! }));
        } catch (error) {
            setUsageError(error instanceof Error ? error.message : "Could not load usage for this month");
        } finally {
            if (showLoading) setIsUsageLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadBilling(true);
        const refreshTimer = window.setInterval(() => void loadBilling(false), 5 * 60 * 1000);
        return () => window.clearInterval(refreshTimer);
    }, [loadBilling]);

    useEffect(() => {
        void loadUsage(selectedMonth);
    }, [loadUsage, selectedMonth]);

    useEffect(() => {
        const refreshTimer = window.setInterval(() => {
            void loadUsage(selectedMonth, false);
            if (selectedMonth !== CURRENT_MONTH) void loadUsage(CURRENT_MONTH, false);
        }, 5 * 60 * 1000);
        return () => window.clearInterval(refreshTimer);
    }, [loadUsage, selectedMonth]);

    useEffect(() => {
        const alert = billing?.spendingAlert;
        if (!alert) return;
        setSpendingAlertEnabled(alert.enabled);
        setSpendingAlertThreshold((alert.thresholdCents / 100).toFixed(2));
    }, [billing?.spendingAlert]);

    function openInvoice(invoiceId: string) {
        router.push(`/business/billingandusage/billing?invoiceId=${encodeURIComponent(invoiceId)}`);
    }

    function openUsageInvoice(invoice: UsageInvoice) {
        const agentId = invoice.agentBreakdown[0]?.installedAgentId ?? invoice.agentBreakdown[0]?.agentId;
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
            let response = await apiPost<InvoicePaymentResult>(
                `/business/billing/usage-invoices/${invoice.id}/pay`,
                {}
            );
            if (!response.success) {
                showToast(response.error ?? "Could not pay invoice");
                return;
            }

            if (response.data?.carriedForward) {
                showToast("Balance carried forward until it reaches the $0.50 card minimum");
                return;
            }

            if (response.data?.requiresAction && response.data.clientSecret) {
                const config = await apiGet<StripeConfigResponse>("/payments/config");
                const publishableKey = config.data?.publishableKey;
                const stripe = publishableKey ? await loadStripe(publishableKey) : null;
                if (!config.success || !stripe) {
                    showToast("Card authentication could not be started");
                    return;
                }
                const action = await stripe.handleNextAction({
                    clientSecret: response.data.clientSecret
                });
                if (action.error) {
                    showToast(action.error.message ?? "Card authentication was not completed");
                    return;
                }
                response = await apiPost<InvoicePaymentResult>(
                    `/business/billing/usage-invoices/${invoice.id}/pay`,
                    {}
                );
                if (!response.success) {
                    showToast(response.error ?? "Could not finish paying invoice");
                    return;
                }
            }

            if (response.data?.status?.toUpperCase() !== "PAID") {
                showToast("Payment is still pending");
                return;
            }
            const settledIds = new Set(response.data.invoiceIds ?? [invoice.id]);
            const paidAt = new Date().toISOString();
            setUsageInvoices((current) => current.map((item) =>
                settledIds.has(item.id) ? { ...item, status: "PAID", paidAt } : item
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

    async function payAgentInvoice(invoice: BillingInvoice) {
        if (payingInvoiceId) return;
        setPayingInvoiceId(invoice.id);
        try {
            const response = await apiPost(`/payments/invoices/${invoice.id}/pay`, {});
            if (!response.success) {
                showToast(response.error ?? "Could not pay invoice");
                return;
            }
            await loadBilling(false);
            showToast("Invoice paid and eligible services restored");
        } catch (error) {
            showToast(error instanceof Error ? error.message : "Could not pay invoice");
        } finally {
            setPayingInvoiceId(null);
        }
    }

    async function saveSpendingAlert(enabled: boolean, thresholdCents: number) {
        if (spendingAlertSaving) return false;
        setSpendingAlertSaving(true);
        setSpendingAlertError("");
        try {
            const response = await apiPut<{ spendingAlert: SpendingAlert }>(
                "/business/billing/spending-alert",
                { enabled, thresholdCents }
            );
            if (!response.success) {
                const message = response.error ?? "Could not save spending alert";
                setSpendingAlertError(message);
                showToast(message);
                return false;
            }
            if (response.data?.spendingAlert) {
                setSpendingAlertEnabled(response.data.spendingAlert.enabled);
                setSpendingAlertThreshold((response.data.spendingAlert.thresholdCents / 100).toFixed(2));
            }
            showToast(enabled ? "Spending alert updated" : "Spending alert turned off");
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Could not save spending alert";
            setSpendingAlertError(message);
            showToast(message);
            return false;
        } finally {
            setSpendingAlertSaving(false);
        }
    }

    const agents = billing?.agents ?? [];
    const invoices = billing?.invoices ?? [];
    const usage = usageByMonth[selectedMonth] ?? null;
    const currentUsage = usageByMonth[CURRENT_MONTH] ?? (usage?.month === CURRENT_MONTH ? usage : null);

    const monthOptions = useMemo(() => {
        const explicitOptions = [
            ...(billing?.usage?.availableMonths ?? []),
            ...(usage?.availableMonths ?? []),
            ...(currentUsage?.availableMonths ?? [])
        ].filter((option, index, all) =>
            /^\d{4}-\d{2}$/.test(option.value)
            && all.findIndex((candidate) => candidate.value === option.value) === index
        );
        const labels = new Map(explicitOptions.map((option) => [option.value, option.label]));
        const candidateMonths = new Set<string>([CURRENT_MONTH, selectedMonth]);

        for (const option of explicitOptions) candidateMonths.add(option.value);
        for (const invoice of usageInvoices) {
            if (/^\d{4}-\d{2}$/.test(invoice.billingMonth)) candidateMonths.add(invoice.billingMonth);
        }
        for (const invoice of invoices) {
            const value = monthKeyForDate(invoice.createdAt);
            if (value) candidateMonths.add(value);
        }
        for (const agent of agents) {
            const value = monthKeyForDate(agent.purchasedAt);
            if (value) candidateMonths.add(value);
        }

        const earliestMonth = [...candidateMonths].sort()[0] ?? CURRENT_MONTH;
        for (const value of buildMonthRange(earliestMonth, CURRENT_MONTH)) candidateMonths.add(value);

        return [...candidateMonths]
            .sort((a, b) => b.localeCompare(a))
            .map((value) => ({ value, label: labels.get(value) || monthLabel(value) }));
    }, [agents, billing?.usage?.availableMonths, currentUsage?.availableMonths, invoices, selectedMonth, usage?.availableMonths, usageInvoices]);

    const usageAgents = useMemo(() => {
        const rollups = usage?.agentRollup ?? [];
        const usedIndexes = new Set<number>();
        const displayAgents: UsageBill["agentRollup"] = agents
            .filter((agent) => {
                const purchasedMonth = monthKeyForDate(agent.purchasedAt);
                return !purchasedMonth || purchasedMonth <= selectedMonth;
            })
            .map((agent) => {
            const matchIndex = rollups.findIndex((rollup, index) => {
                if (usedIndexes.has(index)) return false;
                const rollupInstalledId = rollup.installedAgentId ?? rollup.agentId;
                if (agent.installedAgentId && rollupInstalledId === agent.installedAgentId) return true;
                const listingId = agent.listingId ?? agent.id;
                if (rollup.listingId && rollup.listingId === listingId) return true;
                return rollup.agentName.trim().toLowerCase() === agent.name.trim().toLowerCase();
            });
            const rollup = matchIndex >= 0 ? rollups[matchIndex] : null;
            if (matchIndex >= 0) usedIndexes.add(matchIndex);
            return {
                agentId: rollup?.agentId ?? agent.installedAgentId ?? agent.id,
                installedAgentId: rollup?.installedAgentId ?? agent.installedAgentId ?? null,
                listingId: rollup?.listingId ?? agent.listingId ?? agent.id,
                agentName: rollup?.agentName ?? agent.name,
                callCount: rollup?.callCount ?? 0,
                executionCount: rollup?.executionCount ?? rollup?.callCount ?? 0,
                durationMinutes: rollup?.durationMinutes ?? 0,
                billedCostUsd: rollup?.billedCostUsd ?? 0,
                amountCents: rollup?.amountCents ?? 0,
                executionFeeCents: rollup?.executionFeeCents ?? agent.executionFeeCents ?? null,
                iconUrl: rollup?.iconUrl ?? agent.iconUrl ?? null,
                serviceCosts: rollup?.serviceCosts ?? []
            };
            });
        rollups.forEach((rollup, index) => {
            if (!usedIndexes.has(index) && agentExecutionCount(rollup) > 0) displayAgents.push(rollup);
        });
        return displayAgents;
    }, [agents, selectedMonth, usage?.agentRollup]);

    const selectedUsageExecutions = usage?.totalExecutions
        ?? usage?.totalCalls
        ?? usageAgents.reduce((sum, agent) => sum + agentExecutionCount(agent), 0);
    const selectedUsageCostUsd = usage?.totalCostUsd
        ?? usage?.totalBilledUsd
        ?? usageAgents.reduce((sum, agent) => sum + agent.billedCostUsd, 0);
    const averageUsageCostUsd = usage?.averageCostUsd
        ?? (selectedUsageExecutions > 0 ? selectedUsageCostUsd / selectedUsageExecutions : 0);
    const currentMonthCostCents = billing?.spendingAlert?.currentMonthCostCents
        ?? (currentUsage
            ? Math.round((currentUsage.totalCostUsd ?? currentUsage.totalBilledUsd) * 100)
            : billing?.summary.currentMonthExecutionCostCents ?? 0);
    const monthlySubscriptionCostCents = billing?.summary.upcomingAgentChargeCents
        ?? billing?.summary.monthlySubscriptionCostCents
        ?? agents
            .filter((agent) => agent.pricingModel?.toUpperCase() === "SUBSCRIPTION")
            .reduce((sum, agent) => sum + (agent.monthlyCostCents ?? agent.priceCents), 0);
    const today = new Date();
    const daysInCurrentMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
    const projectedExecutionCostCents = billing?.summary.projectedExecutionCostCents
        ?? (currentMonthCostCents > 0
            ? Math.round((currentMonthCostCents / Math.max(1, today.getUTCDate())) * daysInCurrentMonth)
            : 0);
    const totalAgentFees = formatCurrencyCents(billing?.summary.totalAgentFeesPaidCents);

    const paidPurchaseInvoices = invoices.filter((invoice) => purchaseInvoiceTab(invoice) === "paid");
    const pendingPurchaseInvoices = invoices.filter((invoice) => purchaseInvoiceTab(invoice) === "pending");
    const overduePurchaseInvoices = invoices.filter((invoice) => purchaseInvoiceTab(invoice) === "overdue");
    const paidUsageInvoices = usageInvoices.filter((invoice) => invoice.status === "PAID");
    const showSyntheticAccrual = currentUsage
        ? shouldShowSyntheticAccrual({
            invoices: usageInvoices,
            currentMonth: CURRENT_MONTH,
            executionCount: currentUsage.totalExecutions ?? currentUsage.totalCalls,
            costUsd: currentUsage.totalCostUsd ?? currentUsage.totalBilledUsd
        })
        : false;
    const currentUsageStatement: UsageInvoice | null = showSyntheticAccrual && currentUsage
        ? {
            id: `accrued-${currentUsage.month}`,
            invoiceNumber: `ACCRUED-${currentUsage.month.replace("-", "")}`,
            billingMonth: currentUsage.month,
            status: "PENDING",
            amountCents: Math.round((currentUsage.totalCostUsd ?? currentUsage.totalBilledUsd) * 100),
            issuedAt: currentUsage.updatedAt ?? new Date().toISOString(),
            dueAt: usageDueAt(currentUsage.month),
            paidAt: null,
            callCount: currentUsage.totalExecutions ?? currentUsage.totalCalls,
            agentBreakdown: currentUsage.agentRollup,
            isAccruing: true
        }
        : null;
    const pendingUsageInvoices = [
        ...usageInvoices.filter((invoice) => invoice.status === "PENDING" || invoice.status === "OPEN"),
        ...(currentUsageStatement ? [currentUsageStatement] : [])
    ];
    const overdueUsageInvoices = usageInvoices.filter((invoice) => invoice.status === "OVERDUE");
    const parsedSpendingAlertDollars = Number.parseFloat(spendingAlertThreshold || "0");
    const spendingAlertCents = Number.isFinite(parsedSpendingAlertDollars) && parsedSpendingAlertDollars > 0
        ? Math.round(parsedSpendingAlertDollars * 100)
        : 1;
    const spendingProgress = Math.min(100, (currentMonthCostCents / spendingAlertCents) * 100);
    const maxUsageExecutions = Math.max(1, ...usageAgents.map((agent) => agentExecutionCount(agent)));

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
                    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2" data-testid="billing-current-plan">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-500">Current Plan</span>
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${billing?.plan.status?.toLowerCase() === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-slate-600"}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${billing?.plan.status?.toLowerCase() === "active" ? "bg-green-500" : "bg-slate-400"}`} />
                                {billing?.plan.status ?? NA}
                            </span>
                        </div>
                        <h2 className="mt-2 text-2xl font-bold">{billing?.plan.name ?? NA}</h2>
                        <p className="mt-1 text-sm text-slate-500">
                            No platform subscription. Pay the listed agent fee, plus the per-execution price shown below.
                        </p>
                        <div className="my-5 h-px bg-gray-100" />
                        <div className="space-y-3">
                            {agents.length === 0 ? (
                                <p className="py-3 text-sm text-slate-400">No purchased agents yet.</p>
                            ) : agents.map((agent, index) => {
                                const pricingModel = agent.pricingModel?.toUpperCase();
                                const listingPriceCents =
                                    pricingModel === "SUBSCRIPTION"
                                        ? agent.monthlyCostCents ?? agent.priceCents
                                        : agent.priceCents;
                                const priceSuffix = pricingModel === "SUBSCRIPTION"
                                    ? "/month"
                                    : pricingModel === "ONE_TIME"
                                        ? " one-time"
                                        : "";
                                const trialLimit = agent.trialExecutionLimit ?? 50;
                                const trialUsed = agent.trialExecutionsUsed
                                    ?? (agent.trialExecutionsRemaining === null || agent.trialExecutionsRemaining === undefined
                                        ? null
                                        : Math.max(0, trialLimit - agent.trialExecutionsRemaining));

                                return (
                                <div key={agentIdentity(agent)} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid="billing-plan-agent">
                                    <div className="flex min-w-0 items-center gap-2.5">
                                        <AgentLogo name={agent.name} iconUrl={agent.iconUrl} accentIndex={index} />
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-slate-800">{agent.name}</p>
                                            {agent.isTrial ? (
                                                <p className="text-xs text-slate-400">
                                                    Trial{trialUsed === null ? "" : ` · ${trialUsed} of ${trialLimit} free executions used`}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center justify-between gap-3 pl-10 sm:justify-end sm:pl-0">
                                        <span className="font-mono text-sm tabular-nums text-slate-600">
                                            {pricingModel === "FREE" ? "$0.00" : formatCurrencyCents(listingPriceCents)}
                                            <span className="text-slate-400">{priceSuffix}</span>
                                            <span className="text-slate-400"> + {formatCurrencyCents(agent.executionFeeCents ?? 0)}/run</span>
                                        </span>
                                        {pricingModel === "SUBSCRIPTION" ? (
                                            <button
                                                type="button"
                                                onClick={() => cancelAgentSubscription(agent.listingId ?? agent.id)}
                                                data-testid="billing-cancel-agent"
                                                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 transition hover:bg-red-100 hover:text-red-700"
                                            >
                                                Cancel
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                        <div className="my-5 h-px bg-gray-100" />
                        <div className="flex items-center justify-between font-bold">
                            <span>Total agent fees paid</span>
                            <span className="font-mono tabular-nums">{totalAgentFees}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                            <span className="text-sm text-slate-600">{monthLabel(CURRENT_MONTH).split(" ")[0]} execution costs (to date)</span>
                            <span className="font-mono text-sm font-semibold tabular-nums text-amber-600">{formatCurrencyCents(currentMonthCostCents)}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => document.getElementById("usage")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                            className="mt-3 rounded text-xs font-semibold text-amber-600 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                            data-testid="billing-view-detailed-usage"
                        >
                            View detailed usage →
                        </button>
                    </div>

                    <div className="flex flex-col rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-6" data-testid="billing-next-charge">
                        <span className="text-sm font-semibold text-amber-700">Next Charge</span>
                        <div className="mt-2 font-mono text-3xl font-black tabular-nums text-slate-900">{formatCurrencyCents(monthlySubscriptionCostCents)}</div>
                        <p className="mt-1 text-sm text-slate-600">
                            {monthlySubscriptionCostCents > 0 ? "Upcoming monthly agent subscriptions" : "No upcoming agent purchases"}
                        </p>

                        <div className="my-4 h-px bg-amber-200/60" />

                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Execution fees</span>
                        <p className="mt-1 text-sm text-slate-600">Billed monthly on the 1st</p>
                        <p className="mt-1 text-sm font-semibold text-slate-800">
                            Next execution bill: <span className="font-mono">{projectedExecutionCostCents > 0 ? "~" : ""}{formatCurrencyCents(projectedExecutionCostCents)}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">Based on current usage trend</p>
                    </div>
                </section>

                {/* 2. Usage breakdown */}
                <section id="usage" className="scroll-mt-20 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" aria-label="Usage breakdown" data-testid="billing-usage-section">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-lg font-bold">Usage This Month — {monthLabel(selectedMonth)}</h2>
                        <div className="relative self-start sm:self-auto">
                            <select
                                value={selectedMonth}
                                onChange={(event) => setSelectedMonth(event.target.value)}
                                aria-label="Select billing month"
                                data-testid="billing-month-select"
                                className="appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-9 text-sm font-medium text-slate-700 transition hover:border-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                            >
                                {monthOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
                        </div>
                    </div>

                    {usageError ? <p className="mt-4 text-sm text-red-600">{usageError}</p> : null}
                    <div className="mt-6 space-y-5">
                        {isUsageLoading && !usage ? (
                            <>
                                <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
                                <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
                            </>
                        ) : usageAgents.length === 0 ? (
                            <p className="py-4 text-sm text-slate-400">No purchased agents or usage to display yet.</p>
                        ) : (
                            usageAgents.map((agent, index) => {
                                const executions = agentExecutionCount(agent);
                                const accent = ACCENTS[index % ACCENTS.length];
                                const percent = Math.min(100, (executions / maxUsageExecutions) * 100);
                                return (
                                <div key={usageAgentIdentity(agent)} data-testid="billing-usage-agent">
                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${accent.dot}`} />
                                            <span className="truncate text-sm font-medium text-slate-800">{agent.agentName}</span>
                                        </div>
                                        <span className="shrink-0 font-mono text-sm tabular-nums text-slate-500">
                                            {executions.toLocaleString("en-US")} executions · {formatCurrencyUsd(agent.billedCostUsd)}
                                        </span>
                                    </div>
                                    <div
                                        role="progressbar"
                                        tabIndex={0}
                                        aria-label={`${agent.agentName} monthly usage`}
                                        aria-valuemin={0}
                                        aria-valuemax={maxUsageExecutions}
                                        aria-valuenow={executions}
                                        aria-valuetext={`${executions} executions, ${formatCurrencyUsd(agent.billedCostUsd)}`}
                                        className="relative h-3 rounded-full bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
                                    >
                                        <div className="absolute inset-0 overflow-hidden rounded-full">
                                            <div className={`h-full rounded-full transition-[width] duration-500 ${accent.fill}`} style={{ width: `${percent}%` }} />
                                        </div>
                                    </div>
                                </div>
                                );
                            })
                        )}
                    </div>
                    <div className="mt-6 flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-sm font-semibold">
                            Total executions: <span className="font-mono tabular-nums" data-testid="billing-total-executions">{selectedUsageExecutions.toLocaleString("en-US")}</span>
                        </span>
                        <span className="text-sm font-bold text-amber-600">
                            Total cost: <span className="font-mono tabular-nums" data-testid="billing-total-cost">{formatCurrencyUsd(selectedUsageCostUsd)}</span>
                        </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                        Average cost per customer interaction: <span className="font-mono" data-testid="billing-average-cost">{formatCurrencyUsd(averageUsageCostUsd, 3)}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                        {usage?.updatedAt ? `Updated ${formatDate(usage.updatedAt)}` : "No usage recorded for this month"}
                    </p>

                    
                </section>

           
                

                {/* 3. Invoice history */}
                <section className="rounded-2xl border border-gray-100 bg-white shadow-sm" aria-label="Invoice history">
                    <div className="flex flex-col gap-3 border-b border-gray-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-lg font-bold">Invoices</h2>
                        <div className="flex flex-wrap rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Invoice status">
                            <button type="button" role="tab" aria-selected={invoiceTab === "paid"} onClick={() => setInvoiceTab("paid")} data-testid="billing-invoice-tab-paid" className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${invoiceTab === "paid" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                                Paid ({paidPurchaseInvoices.length + paidUsageInvoices.length})
                            </button>
                            <button type="button" role="tab" aria-selected={invoiceTab === "pending"} onClick={() => setInvoiceTab("pending")} data-testid="billing-invoice-tab-pending" className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${invoiceTab === "pending" ? "bg-white text-amber-700 shadow-sm" : "text-slate-500"}`}>
                                Pending ({pendingPurchaseInvoices.length + pendingUsageInvoices.length})
                            </button>
                            <button type="button" role="tab" aria-selected={invoiceTab === "overdue"} onClick={() => setInvoiceTab("overdue")} data-testid="billing-invoice-tab-overdue" className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${invoiceTab === "overdue" ? "bg-white text-red-700 shadow-sm" : "text-slate-500"}`}>
                                Overdue ({overdueUsageInvoices.length + overduePurchaseInvoices.length})
                            </button>
                        </div>
                    </div>

                    {invoiceTab === "paid" && paidPurchaseInvoices.length + paidUsageInvoices.length === 0 ? (
                        <p className="px-6 py-8 text-center text-sm text-slate-400">No paid invoices yet.</p>
                    ) : invoiceTab === "pending" && pendingPurchaseInvoices.length + pendingUsageInvoices.length === 0 ? (
                        <p className="px-6 py-8 text-center text-sm text-slate-400">No pending invoices.</p>
                    ) : invoiceTab === "overdue" && overdueUsageInvoices.length + overduePurchaseInvoices.length === 0 ? (
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
                                    {invoiceTab === "paid" && paidPurchaseInvoices.map((invoice) => (
                                        <tr
                                            key={invoice.id}
                                            role="button"
                                            tabIndex={0}
                                            data-testid="billing-purchase-invoice"
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
                                                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(invoice.status, invoice)}`}>
                                                    {statusLabel(invoice.status, invoice)}
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
                                    {invoiceTab === "pending" && pendingPurchaseInvoices.map((invoice) => (
                                        <tr
                                            key={invoice.id}
                                            role="button"
                                            tabIndex={0}
                                            data-testid="billing-purchase-invoice"
                                            onClick={() => openInvoice(invoice.id)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    openInvoice(invoice.id);
                                                }
                                            }}
                                            className="cursor-pointer border-b border-amber-50 bg-amber-50/20 transition last:border-0 hover:bg-amber-50/50 focus-visible:bg-amber-50/40 focus-visible:outline-none"
                                        >
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(invoice.createdAt)}</td>
                                            <td className="px-6 py-4 text-sm text-slate-700">{invoice.description || NA}</td>
                                            <td className="px-6 py-4 font-mono text-sm font-semibold tabular-nums text-slate-800">{formatCurrencyCents(invoice.amountCents)}</td>
                                            <td className="px-6 py-4">
                                                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Pending</span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    type="button"
                                                    disabled={payingInvoiceId === invoice.id}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        if (isDirectlyPayableAgentInvoice(invoice)) {
                                                            void payAgentInvoice(invoice);
                                                        } else {
                                                            router.push(businessCheckoutPath(invoice.listingId ?? undefined));
                                                        }
                                                    }}
                                                    data-testid="billing-pending-purchase-pay"
                                                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
                                                >
                                                    {payingInvoiceId === invoice.id ? "Paying…" : "Pay now"}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {invoiceTab === "paid" && paidUsageInvoices.map((invoice) => (
                                        <tr key={invoice.id} onClick={() => openUsageInvoice(invoice)} data-testid="billing-usage-invoice" className="cursor-pointer border-b border-gray-50 transition last:border-0 hover:bg-amber-50/30">
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(invoice.paidAt ?? invoice.issuedAt)}</td>
                                            <td className="px-6 py-4 text-sm text-slate-700">Usage — {invoice.agentBreakdown.map((agent) => agent.agentName).join(", ") || "Agent"}</td>
                                            <td className="px-6 py-4 font-mono text-sm font-semibold">{formatCurrencyCents(invoice.amountCents)}</td>
                                            <td className="px-6 py-4"><span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">Paid</span></td>
                                            <td className="px-6 py-4 text-right font-mono text-xs text-slate-500">{invoice.invoiceNumber}</td>
                                        </tr>
                                    ))}
                                    {invoiceTab === "pending" && pendingUsageInvoices.map((invoice) => (
                                        <tr key={invoice.id} onClick={() => openUsageInvoice(invoice)} data-testid="billing-usage-invoice" className="cursor-pointer border-b border-amber-50 bg-amber-50/20 transition last:border-0 hover:bg-amber-50/50">
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(invoice.issuedAt)}</td>
                                            <td className="px-6 py-4 text-sm text-slate-700">Usage — {invoice.agentBreakdown.map((agent) => agent.agentName).join(", ") || "Agent"}</td>
                                            <td className="px-6 py-4 font-mono text-sm font-semibold">{formatCurrencyCents(invoice.amountCents)}</td>
                                            <td className="px-6 py-4"><span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">{invoice.isAccruing ? "Accruing" : "Pending"}</span></td>
                                            <td className="px-6 py-4 text-right">
                                                {invoice.id.startsWith("accrued-") ? (
                                                    <span className="text-xs font-semibold text-amber-700">View usage</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        disabled={payingInvoiceId === invoice.id}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            void payUsageInvoice(invoice);
                                                        }}
                                                        data-testid="billing-pending-usage-pay"
                                                        className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
                                                    >
                                                        {payingInvoiceId === invoice.id ? "Paying…" : "Pay now"}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {invoiceTab === "overdue" && overdueUsageInvoices.map((invoice) => (
                                        <tr key={invoice.id} onClick={() => openUsageInvoice(invoice)} data-testid="billing-usage-invoice" className="cursor-pointer border-b border-red-50 bg-red-50/20 transition last:border-0 hover:bg-red-50/50">
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(invoice.issuedAt)}</td>
                                            <td className="px-6 py-4 text-sm text-slate-700">Usage — {invoice.agentBreakdown.map((agent) => agent.agentName).join(", ") || "Agent"}</td>
                                            <td className="px-6 py-4 font-mono text-sm font-semibold">{formatCurrencyCents(invoice.amountCents)}</td>
                                            <td className="px-6 py-4"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${invoice.isAccruing ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{invoice.isAccruing ? "Accruing" : invoice.status === "OVERDUE" ? "Overdue" : "Payment due"}</span></td>
                                            <td className="px-6 py-4 text-right">
                                                {invoice.isAccruing ? (
                                                    <span className="text-xs font-semibold text-amber-700">View invoice</span>
                                                ) : (
                                                    <button type="button" disabled={payingInvoiceId === invoice.id} onClick={(event) => { event.stopPropagation(); void payUsageInvoice(invoice); }} data-testid="billing-overdue-usage-pay" className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50">
                                                        {payingInvoiceId === invoice.id ? "Paying…" : "Pay now"}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {invoiceTab === "overdue" && overduePurchaseInvoices.map((invoice) => (
                                        <tr
                                            key={invoice.id}
                                            role="button"
                                            tabIndex={0}
                                            data-testid="billing-purchase-invoice"
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
                                                    Overdue
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    type="button"
                                                    disabled={payingInvoiceId === invoice.id}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        if (isDirectlyPayableAgentInvoice(invoice)) {
                                                            void payAgentInvoice(invoice);
                                                        } else {
                                                            router.push(businessCheckoutPath(invoice.listingId ?? undefined));
                                                        }
                                                    }}
                                                    data-testid="billing-overdue-purchase-pay"
                                                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
                                                >
                                                    {payingInvoiceId === invoice.id ? "Paying…" : "Pay now"}
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
                            onClick={() => setPaymentModalOpen(true)}
                            data-testid="billing-update-payment-method"
                            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-300 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                        >
                            Update
                        </button>
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

                {/* 5. Spending alerts */}
                <section className="mb-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" aria-label="Spending alerts" data-testid="billing-spending-alerts">
                    <h2 className="text-base font-bold">Spending Alerts</h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Get notified when your monthly execution costs exceed a threshold.
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-4">
                        <label htmlFor="billing-alert-threshold" className="text-sm text-slate-700">Alert me when monthly costs exceed:</label>
                        <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                            <input
                                id="billing-alert-threshold"
                                type="text"
                                inputMode="decimal"
                                value={spendingAlertThreshold}
                                onChange={(event) => {
                                    setSpendingAlertError("");
                                    setSpendingAlertThreshold(event.target.value.replace(/[^0-9.]/g, ""));
                                }}
                                onBlur={() => {
                                    const dollars = Number.parseFloat(spendingAlertThreshold);
                                    if (Number.isFinite(dollars) && dollars > 0) {
                                        setSpendingAlertThreshold(dollars.toFixed(2));
                                    }
                                }}
                                aria-label="Spending alert threshold in dollars"
                                data-testid="billing-spending-alert-input"
                                className="w-28 rounded-lg border border-gray-200 py-2 pl-7 pr-3 text-center font-mono text-sm tabular-nums text-slate-800 focus-visible:border-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                            />
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={spendingAlertEnabled}
                            aria-label="Enable spending alerts"
                            onClick={() => setSpendingAlertEnabled((current) => !current)}
                            data-testid="billing-spending-alert-toggle"
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ${spendingAlertEnabled ? "bg-amber-500" : "bg-gray-300"}`}
                        >
                            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${spendingAlertEnabled ? "translate-x-[22px]" : "translate-x-[2px]"}`} />
                        </button>
                        <button
                            type="button"
                            disabled={spendingAlertSaving}
                            onClick={() => {
                                const dollars = Number.parseFloat(spendingAlertThreshold);
                                if (!Number.isFinite(dollars) || dollars <= 0) {
                                    setSpendingAlertError("Enter an amount greater than $0.");
                                    return;
                                }
                                const thresholdCents = Math.round(dollars * 100);
                                setSpendingAlertThreshold(dollars.toFixed(2));
                                void saveSpendingAlert(spendingAlertEnabled, thresholdCents);
                            }}
                            data-testid="billing-spending-alert-save"
                            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {spendingAlertSaving ? "Saving…" : "Save"}
                        </button>
                    </div>

                    {spendingAlertError ? <p className="mt-2 text-xs font-medium text-red-600">{spendingAlertError}</p> : null}
                    <p className="mt-3 text-xs text-slate-400">
                        Current month: <span className="font-mono tabular-nums">{formatCurrencyCents(currentMonthCostCents)}</span>
                        {" "}of <span className="font-mono tabular-nums">{formatCurrencyCents(spendingAlertCents)}</span> limit
                    </p>
                    <div
                        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100"
                        role="progressbar"
                        aria-label="Spending against alert limit"
                        aria-valuemin={0}
                        aria-valuemax={spendingAlertCents}
                        aria-valuenow={Math.min(currentMonthCostCents, spendingAlertCents)}
                        aria-valuetext={`${formatCurrencyCents(currentMonthCostCents)} of ${formatCurrencyCents(spendingAlertCents)}`}
                        data-testid="billing-spending-alert-progress"
                    >
                        <div className="h-full rounded-full bg-amber-400 transition-[width]" style={{ width: `${spendingProgress}%` }} />
                    </div>
                </section>

            </div>

            {paymentModalOpen ? (
                <BusinessPaymentMethodModal
                    mode="primary"
                    onClose={() => setPaymentModalOpen(false)}
                    onSaved={async () => {
                        await loadBilling(false);
                        setPaymentModalOpen(false);
                        showToast("Payment method updated");
                    }}
                />
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
