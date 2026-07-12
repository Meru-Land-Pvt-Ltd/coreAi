"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { downloadInvoicePdf, openInvoiceForPrint } from "@/lib/invoice-print";
import { getAuthToken, getAuthUser } from "@/lib/auth";
import { BUSINESS_BILLING_PATH, BUSINESS_LOGIN_PATH } from "@/lib/routes";

const TRIVEN_LOGO_SRC = "/triven.ai word logo transparent bg.PNG";

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
};

function invoiceDisplayAmount(invoice: BillingInvoice) {
    if (typeof invoice.displayAmountCents === "number") {
        return invoice.displayAmountCents;
    }
    if (invoice.status.toUpperCase() === "TRIALING") return 0;
    if (invoice.status.toUpperCase() === "SUCCEEDED") return invoice.amountCents;
    return 0;
}

type Billing = {
    invoices: BillingInvoice[];
    paymentMethod: BillingPaymentMethod | null;
    businessName: string | null;
    billingEmail: string | null;
    billingAddress: string | null;
};

type BillingResponse = { billing: Billing };
type AgentUsageBreakdown = {
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
    agentBreakdown: AgentUsageBreakdown[];
    isAccruing?: boolean;
};
type UsageInvoicesResponse = { invoices: UsageInvoice[] };
type UsageBill = {
    month: string;
    totalCalls: number;
    totalDurationMinutes: number;
    totalBilledUsd: number;
    updatedAt: string | null;
    agentRollup: AgentUsageBreakdown[];
};

const INVOICE_STYLES = `
.invoice-root { font-family: 'Inter', system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.invoice-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.invoice-toast { transform: translateY(12px); opacity: 0; transition: transform .28s cubic-bezier(.16,1,.3,1), opacity .28s ease; }
.invoice-toast.show { transform: translateY(0); opacity: 1; }
@media print {
    .no-print { display: none !important; }
    body { background: #fff !important; }
    #invoice-card { box-shadow: none !important; border: none !important; border-radius: 0 !important; max-width: 100% !important; }
}
`;

// Mirror the backend invoice number so the detail page matches the PDF.
function invoiceNumberFor(id: string) {
    return `INV-${id.slice(-8).toUpperCase()}`;
}

function formatCurrencyCents(cents: number | null | undefined) {
    if (cents === null || cents === undefined || Number.isNaN(cents)) return "$0.00";
    return `$${(cents / 100).toFixed(2)}`;
}

function formatFullDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function usageDueAt(month: string) {
    const [year, monthNumber] = month.split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber, 8)).toISOString();
}

type StatusView = {
    label: string;
    badgeClass: string;
    balanceColor: string;
    isPaid: boolean;
};

function statusView(status: string): StatusView {
    const value = status.toUpperCase();
    if (value === "SUCCEEDED" || value === "PAID") {
        return { label: "PAID", badgeClass: "bg-green-100 text-green-700", balanceColor: "text-green-600", isPaid: true };
    }
    if (value === "TRIALING") {
        return { label: "TRIAL", badgeClass: "bg-amber-100 text-amber-700", balanceColor: "text-amber-600", isPaid: false };
    }
    if (value === "PENDING") {
        return { label: "PENDING", badgeClass: "bg-blue-100 text-blue-700", balanceColor: "text-amber-600", isPaid: false };
    }
    if (value === "FAILED") {
        return { label: "FAILED", badgeClass: "bg-red-100 text-red-700", balanceColor: "text-red-600", isPaid: false };
    }
    if (value === "REFUNDED") {
        return { label: "REFUNDED", badgeClass: "bg-slate-100 text-slate-600", balanceColor: "text-slate-600", isPaid: false };
    }
    if (value === "CANCELED") {
        return { label: "CANCELED", badgeClass: "bg-slate-100 text-slate-600", balanceColor: "text-slate-600", isPaid: false };
    }
    return { label: value, badgeClass: "bg-slate-100 text-slate-600", balanceColor: "text-slate-600", isPaid: false };
}

export default function BusinessInvoiceDetailPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const invoiceId = searchParams.get("invoiceId");
    const agentId = searchParams.get("agentId");

    const [authReady, setAuthReady] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [apiError, setApiError] = useState("");
    const [billing, setBilling] = useState<Billing | null>(null);
    const [usageInvoices, setUsageInvoices] = useState<UsageInvoice[]>([]);
    const [usage, setUsage] = useState<UsageBill | null>(null);
    const [invoiceTab, setInvoiceTab] = useState<"paid" | "overdue">("paid");
    const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
    const [toast, setToast] = useState("");

    const authUser = useMemo(() => (authReady ? getAuthUser() : null), [authReady]);

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

        async function loadBilling() {
            try {
                setIsLoading(true);
                setApiError("");

                const [response, invoiceResponse, usageResponse] = await Promise.all([
                    apiGet<BillingResponse>("/payments/billing"),
                    apiGet<UsageInvoicesResponse>("/business/billing/usage-invoices"),
                    apiGet<UsageBill>("/business/billing/usage")
                ]);

                if (!mounted) return;

                if (!response.success || !response.data?.billing) {
                    setApiError(response.error ?? "Could not load invoice");
                    setBilling(null);
                    return;
                }

                setBilling(response.data.billing);
                setUsageInvoices(invoiceResponse.success ? invoiceResponse.data?.invoices ?? [] : []);
                setUsage(usageResponse.success ? usageResponse.data ?? null : null);
            } catch (error) {
                if (!mounted) return;
                setApiError(error instanceof Error ? error.message : "Could not load invoice");
                setBilling(null);
            } finally {
                if (mounted) setIsLoading(false);
            }
        }

        loadBilling();

        return () => {
            mounted = false;
        };
    }, [authReady]);

    const invoice = useMemo(() => {
        if (!billing) return null;
        if (invoiceId) {
            return billing.invoices.find((entry) => entry.id === invoiceId) ?? null;
        }
        return billing.invoices[0] ?? null;
    }, [billing, invoiceId]);

    function showToast(message: string) {
        setToast(message);
        window.setTimeout(() => setToast(""), 2800);
    }

    async function downloadPdf() {
        if (!invoice) return;

        showToast("Preparing invoice PDF…");

        try {
            await downloadInvoicePdf(invoice.id, `invoice-${invoiceNumberFor(invoice.id)}.pdf`);
            showToast("Invoice PDF downloaded");
        } catch {
            showToast("Could not download invoice PDF");
        }
    }

    async function printInvoice() {
        if (!invoice) return;

        showToast("Preparing invoice…");

        try {
            await openInvoiceForPrint(invoice.id);
        } catch {
            showToast("Could not open invoice for printing");
        }
    }

    async function payUsageInvoice(invoice: UsageInvoice) {
        setPayingInvoiceId(invoice.id);
        try {
            const response = await apiPost(`/business/billing/usage-invoices/${invoice.id}/pay`, {});
            if (!response.success) {
                showToast(response.error ?? "Could not pay invoice");
                return;
            }
            setUsageInvoices((current) => current.map((item) =>
                item.id === invoice.id ? { ...item, status: "PAID" } : item
            ));
            showToast("Invoice paid and services restored");
        } catch (error) {
            showToast(error instanceof Error ? error.message : "Could not pay invoice");
        } finally {
            setPayingInvoiceId(null);
        }
    }

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
    const allUsageInvoices = [...usageInvoices, ...(currentUsageStatement ? [currentUsageStatement] : [])];
    const scopedUsageInvoices = agentId
        ? allUsageInvoices.filter((item) => item.agentBreakdown.some((agent) => agent.agentId === agentId))
        : allUsageInvoices;
    const selectedUsageInvoice = allUsageInvoices.find((item) => item.id === invoiceId) ?? null;
    const selectedAgentName = agentId
        ? scopedUsageInvoices.flatMap((item) => item.agentBreakdown).find((agent) => agent.agentId === agentId)?.agentName ?? "Agent"
        : null;
    const showAgentHistory = Boolean(agentId || selectedUsageInvoice);
    const overdueInvoices = scopedUsageInvoices.filter((item) => item.status === "OPEN" || item.status === "OVERDUE");
    const paidUsageInvoices = scopedUsageInvoices.filter((item) => item.status === "PAID");
    const paidCount = showAgentHistory
        ? paidUsageInvoices.length
        : (billing?.invoices.filter((item) => item.status === "SUCCEEDED").length ?? 0) + paidUsageInvoices.length;

    useEffect(() => {
        if (selectedUsageInvoice?.status === "OPEN" || selectedUsageInvoice?.status === "OVERDUE") {
            setInvoiceTab("overdue");
        }
    }, [selectedUsageInvoice?.id, selectedUsageInvoice?.status]);

    if (!authReady) {
        return <main className="min-h-screen bg-slate-100" />;
    }

    return (
        <div className="invoice-root min-h-screen bg-slate-100 text-slate-900">
            <style dangerouslySetInnerHTML={{ __html: INVOICE_STYLES }} />

            <main className="p-4 sm:p-6 lg:p-10">
                {/* breadcrumb */}
                <nav className="no-print mb-5 flex flex-wrap items-center gap-2 text-sm text-slate-500" aria-label="Breadcrumb">
                    <Link href={BUSINESS_BILLING_PATH} className="hover:text-slate-700" data-testid="invoice-breadcrumb-billing">
                        Billing
                    </Link>
                    <span aria-hidden="true">/</span>
                    <span className="font-medium text-slate-900" data-testid="invoice-breadcrumb-current">
                        {selectedAgentName ? `${selectedAgentName} invoices` : invoice ? `Invoice #${invoiceNumberFor(invoice.id)}` : "Invoice"}
                    </span>
                </nav>

                {/* top bar: back + actions */}
                <div className="no-print mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <Link
                        href={BUSINESS_BILLING_PATH}
                        data-testid="invoice-back-link"
                        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900"
                    >
                        <span aria-hidden="true">←</span> Back to Billing History
                    </Link>

                    {!showAgentHistory ? <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                            type="button"
                            onClick={downloadPdf}
                            disabled={!invoice}
                            data-testid="invoice-download-pdf"
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 disabled:opacity-50"
                        >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
                            Download PDF
                        </button>
                        <button
                            type="button"
                            onClick={printInvoice}
                            data-testid="invoice-print"
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-50"
                        >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V4h12v5M6 18h12v3H6v-3zM4 9h16v7H4V9z" /></svg>
                            Print
                        </button>
                    </div> : null}
                </div>

                <div className="no-print mb-6 flex w-fit rounded-xl bg-slate-200/70 p-1" role="tablist" aria-label="Invoice status">
                    <button type="button" role="tab" aria-selected={invoiceTab === "paid"} onClick={() => setInvoiceTab("paid")} className={`rounded-lg px-5 py-2 text-sm font-semibold ${invoiceTab === "paid" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Paid ({paidCount})</button>
                    <button type="button" role="tab" aria-selected={invoiceTab === "overdue"} onClick={() => setInvoiceTab("overdue")} className={`rounded-lg px-5 py-2 text-sm font-semibold ${invoiceTab === "overdue" ? "bg-white text-red-700 shadow-sm" : "text-slate-500"}`}>Overdue ({overdueInvoices.length})</button>
                </div>

                {invoiceTab === "overdue" || showAgentHistory ? (
                    selectedUsageInvoice ? (
                        <UsageInvoiceCard
                            invoice={selectedUsageInvoice}
                            agentId={agentId}
                            billing={billing}
                            paying={payingInvoiceId === selectedUsageInvoice.id}
                            onPay={payUsageInvoice}
                        />
                    ) : (
                        <AgentInvoiceList
                            invoices={invoiceTab === "paid" ? paidUsageInvoices : overdueInvoices}
                            agentId={agentId}
                            agentName={selectedAgentName}
                            payingInvoiceId={payingInvoiceId}
                            onPay={payUsageInvoice}
                        />
                    )
                ) : isLoading ? (
                    <div className="mx-auto h-[600px] max-w-[800px] animate-pulse rounded-xl border border-slate-200 bg-white" />
                ) : apiError ? (
                    <div className="mx-auto max-w-[800px] rounded-xl border border-red-100 bg-red-50 p-6 text-sm font-medium text-red-700" data-testid="invoice-error">
                        {apiError}
                    </div>
                ) : !invoice ? (
                    <div className="mx-auto max-w-[800px] rounded-xl border border-slate-200 bg-white p-10 text-center" data-testid="invoice-not-found">
                        <p className="text-lg font-semibold text-slate-900">Invoice not found</p>
                        <p className="mt-1 text-sm text-slate-500">
                            We couldn&apos;t find this invoice. It may have been removed.
                        </p>
                        <Link
                            href={BUSINESS_BILLING_PATH}
                            className="mt-5 inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
                        >
                            Back to Billing
                        </Link>
                    </div>
                ) : (
                    <InvoiceCard
                        invoice={invoice}
                        billing={billing}
                        businessName={
                            invoice.billingName ??
                            billing?.businessName ??
                            authUser?.fullName ??
                            "Customer"
                        }
                        businessEmail={
                            invoice.billingEmail ??
                            billing?.billingEmail ??
                            authUser?.email ??
                            ""
                        }
                        billingAddress={
                            invoice.billingAddress ??
                            billing?.billingAddress ??
                            null
                        }
                    />
                )}
            </main>

            <div className="no-print pointer-events-none fixed bottom-4 left-4 right-4 z-[70] flex flex-col items-stretch gap-2 sm:left-auto sm:items-end" aria-live="polite">
                {toast ? (
                    <div className="invoice-toast show pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg" role="status">
                        <svg className="h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v11m0 0l4-4m-4 4l-4-4M5 17v2a2 2 0 002 2h10a2 2 0 002-2v-2" /></svg>
                        <span>{toast}</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function UsageInvoiceCard({
    invoice,
    agentId,
    billing,
    paying,
    onPay
}: {
    invoice: UsageInvoice;
    agentId: string | null;
    billing: Billing | null;
    paying: boolean;
    onPay: (invoice: UsageInvoice) => Promise<void>;
}) {
    const allocation = agentId
        ? invoice.agentBreakdown.find((agent) => agent.agentId === agentId) ?? null
        : null;
    const displayedAgents = allocation ? [allocation] : invoice.agentBreakdown;
    const amountCents = allocation?.amountCents ?? invoice.amountCents;
    const serviceMap = new Map<string, AgentUsageBreakdown["serviceCosts"][number]>();
    for (const agent of displayedAgents) {
        for (const item of agent.serviceCosts) {
            const existing = serviceMap.get(item.serviceCode) ?? { ...item, quantity: 0, billedCostUsd: 0, amountCents: 0 };
            existing.quantity += item.quantity;
            existing.billedCostUsd += item.billedCostUsd;
            existing.amountCents += item.amountCents;
            serviceMap.set(item.serviceCode, existing);
        }
    }
    const services = [...serviceMap.values()];
    const isPaid = invoice.status === "PAID";
    const statusLabel = invoice.isAccruing ? "ACCRUING" : isPaid ? "PAID" : invoice.status;

    return (
        <article id="invoice-card" className="relative mx-auto max-w-[800px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="pointer-events-none absolute right-8 top-10 hidden select-none text-[88px] font-extrabold leading-none text-slate-100 sm:block" aria-hidden="true">INVOICE</div>
            <div className="relative p-6 sm:p-12">
                <div className="flex flex-col justify-between gap-8 border-b border-slate-100 pb-8 sm:flex-row">
                    <div>
                        <Image src={TRIVEN_LOGO_SRC} alt="Triven" width={130} height={38} priority className="h-9 w-auto object-contain" />
                        <p className="mt-3 text-sm font-medium text-slate-700">Triven AI Agent Platform</p>
                        <p className="text-sm text-slate-500">info@triven.ai</p>
                    </div>
                    <div className="text-left sm:text-right">
                        <p className="text-2xl font-extrabold uppercase tracking-wide text-slate-400">Invoice</p>
                        <p className="invoice-mono mt-2 text-sm text-slate-700">#{invoice.invoiceNumber}</p>
                        <p className="mt-2 text-sm text-slate-500">{invoice.isAccruing ? "Last updated" : "Date issued"}: <span className="font-medium text-slate-700">{formatFullDate(invoice.issuedAt)}</span></p>
                        <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${invoice.isAccruing ? "bg-amber-100 text-amber-700" : isPaid ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{statusLabel}</span>
                    </div>
                </div>

                <div className="grid gap-6 py-8 sm:grid-cols-2">
                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Bill To</p>
                        <p className="text-sm font-semibold text-slate-900">{billing?.businessName ?? "Customer"}</p>
                        {billing?.billingAddress ? <p className="text-sm text-slate-600">{billing.billingAddress}</p> : null}
                        {billing?.billingEmail ? <p className="text-sm text-slate-600">{billing.billingEmail}</p> : null}
                    </div>
                    <div className="sm:text-right">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Agent</p>
                        <p className="text-sm font-semibold text-slate-900">{allocation?.agentName ?? displayedAgents.map((agent) => agent.agentName).join(", ")}</p>
                        <p className="text-sm text-slate-500">{displayedAgents.reduce((sum, agent) => sum + agent.callCount, 0)} calls · {displayedAgents.reduce((sum, agent) => sum + agent.durationMinutes, 0).toFixed(1)} minutes</p>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                        <thead><tr className="bg-slate-50 text-slate-600"><th className="px-3 py-2.5 text-left">#</th><th className="px-3 py-2.5 text-left">Service</th><th className="px-3 py-2.5 text-right">Usage</th><th className="px-3 py-2.5 text-right">Amount</th></tr></thead>
                        <tbody>
                            {services.map((service, index) => (
                                <tr key={service.serviceCode} className="border-b border-slate-100">
                                    <td className="px-3 py-3 text-slate-400">{index + 1}</td>
                                    <td className="px-3 py-3 font-medium text-slate-700">{service.serviceName}</td>
                                    <td className="px-3 py-3 text-right text-slate-500">{service.quantity.toFixed(2)}</td>
                                    <td className="px-3 py-3 text-right font-mono font-semibold">${service.billedCostUsd.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="mt-6 flex justify-end">
                    <div className="w-full space-y-2 text-sm sm:w-72">
                        <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatCurrencyCents(amountCents)}</span></div>
                        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold"><span>Total</span><span>{formatCurrencyCents(amountCents)}</span></div>
                        <div className="flex justify-between text-slate-500"><span>Amount Paid</span><span>{isPaid ? formatCurrencyCents(amountCents) : "$0.00"}</span></div>
                        <div className="flex justify-between font-bold"><span>Balance Due</span><span className={isPaid ? "text-green-600" : "text-red-600"}>{isPaid ? "$0.00" : formatCurrencyCents(amountCents)}</span></div>
                    </div>
                </div>

                <div className="mt-8 border-t border-slate-100 pt-6">
                    {invoice.isAccruing ? (
                        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">This statement updates with new usage. The final invoice is generated on the 1st of next month and is due by the 7th.</p>
                    ) : !isPaid ? (
                        <button type="button" disabled={paying} onClick={() => void onPay(invoice)} className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50">{paying ? "Paying…" : `Pay ${formatCurrencyCents(invoice.amountCents)}`}</button>
                    ) : (
                        <p className="text-sm font-medium text-green-600">✓ Paid successfully{invoice.paidAt ? ` on ${formatFullDate(invoice.paidAt)}` : ""}</p>
                    )}
                </div>
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 text-xs text-slate-400 sm:px-12">Triven AI Agent Platform — Usage invoice for {invoice.billingMonth}</div>
        </article>
    );
}

function AgentInvoiceList({
    invoices,
    agentId,
    agentName,
    payingInvoiceId,
    onPay
}: {
    invoices: UsageInvoice[];
    agentId: string | null;
    agentName: string | null;
    payingInvoiceId: string | null;
    onPay: (invoice: UsageInvoice) => Promise<void>;
}) {
    return (
        <section className="mx-auto max-w-[800px]" aria-label="Agent invoices">
            {agentName ? (
                <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Agent invoice history</p>
                    <h1 className="mt-1 text-xl font-bold text-slate-900">{agentName}</h1>
                </div>
            ) : null}

            {invoices.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                    No invoices in this section.
                </div>
            ) : (
                <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    {invoices.map((invoice) => {
                        const allocation = agentId
                            ? invoice.agentBreakdown.find((agent) => agent.agentId === agentId)
                            : null;
                        const amountCents = allocation?.amountCents ?? invoice.amountCents;
                        const calls = allocation?.callCount ?? invoice.callCount;
                        const minutes = allocation?.durationMinutes ?? invoice.agentBreakdown.reduce((sum, item) => sum + item.durationMinutes, 0);
                        const isPaid = invoice.status === "PAID";

                        return (
                            <article key={invoice.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-mono text-xs font-semibold text-slate-500">{invoice.invoiceNumber}</p>
                                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isPaid ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                                            {isPaid ? "Paid" : invoice.status === "OVERDUE" ? "Overdue" : "Payment due"}
                                        </span>
                                    </div>
                                    <p className="mt-2 font-semibold text-slate-900">Usage for {invoice.billingMonth}</p>
                                    <p className="mt-1 text-sm text-slate-500">
                                        {calls} calls · {minutes.toFixed(1)} minutes · {isPaid && invoice.paidAt ? `Paid ${formatFullDate(invoice.paidAt)}` : `Due ${formatFullDate(invoice.dueAt)}`}
                                    </p>
                                    {allocation && invoice.agentBreakdown.length > 1 ? (
                                        <p className="mt-1 text-xs text-slate-400">Agent allocation from full business invoice {formatCurrencyCents(invoice.amountCents)}</p>
                                    ) : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-4">
                                    <span className="font-mono text-lg font-bold text-slate-900">{formatCurrencyCents(amountCents)}</span>
                                    {!isPaid ? (
                                        <button
                                            type="button"
                                            disabled={payingInvoiceId === invoice.id}
                                            onClick={() => void onPay(invoice)}
                                            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"
                                        >
                                            {payingInvoiceId === invoice.id ? "Paying…" : "Pay invoice"}
                                        </button>
                                    ) : null}
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

function InvoiceCard({
    invoice,
    billing,
    businessName,
    businessEmail,
    billingAddress
}: {
    invoice: BillingInvoice;
    billing: Billing | null;
    businessName: string;
    businessEmail: string;
    billingAddress: string | null;
}) {
    const status = statusView(invoice.status);
    const displayCents = invoiceDisplayAmount(invoice);
    const amount = formatCurrencyCents(displayCents);
    const amountPaid = status.isPaid ? formatCurrencyCents(invoice.amountCents) : amount;
    const balanceDue = status.isPaid ? "$0.00" : amount;

    return (
        <div
            id="invoice-card"
            data-testid="invoice-card"
            className="relative mx-auto max-w-[800px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
            {/* watermark */}
            <div className="pointer-events-none absolute right-8 top-10 hidden select-none text-[88px] font-extrabold leading-none text-slate-100 sm:block" aria-hidden="true">
                INVOICE
            </div>

            <div className="relative p-6 sm:p-12">
                {/* header: seller / invoice meta */}
                <div className="flex flex-col justify-between gap-8 border-b border-slate-100 pb-8 sm:flex-row">
                    <div>
                        <div className="mb-3 flex items-center gap-2">
                            <Image
                                src={TRIVEN_LOGO_SRC}
                                alt="Triven"
                                width={130}
                                height={38}
                                priority
                                className="h-9 w-auto object-contain"
                            />
                        </div>
                        <p className="text-sm font-medium text-slate-700">Triven AI Agent Platform</p>
                        <p className="text-sm text-slate-500">info@triven.ai</p>
                    </div>

                    <div className="text-left sm:text-right">
                        <p className="text-2xl font-extrabold uppercase tracking-wide text-slate-400">Invoice</p>
                        <p className="invoice-mono mt-2 text-sm text-slate-700" data-testid="invoice-number">
                            #{invoiceNumberFor(invoice.id)}
                        </p>
                        <p className="mt-2 text-sm text-slate-500">
                            Date issued:{" "}
                            <span className="font-medium text-slate-700" data-testid="invoice-date">
                                {formatFullDate(invoice.createdAt)}
                            </span>
                        </p>
                        <span
                            className={`mt-3 inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${status.badgeClass}`}
                            data-testid="invoice-status-badge"
                            aria-label={`Invoice status: ${status.label}`}
                        >
                            {status.label}
                        </span>
                    </div>
                </div>

                {/* bill to */}
                <div className="py-8">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Bill To</p>
                    <p className="text-sm font-semibold text-slate-900" data-testid="invoice-bill-to-name">{businessName}</p>
                    {billingAddress ? (
                        <p className="text-sm text-slate-600" data-testid="invoice-bill-to-address">{billingAddress}</p>
                    ) : null}
                    {businessEmail ? (
                        <p className="text-sm text-slate-600" data-testid="invoice-bill-to-email">{businessEmail}</p>
                    ) : null}
                </div>

                {/* line items */}
                <div className="-mx-1 overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                        <thead>
                            <tr className="bg-slate-50 text-slate-600">
                                <th scope="col" className="w-10 px-3 py-2.5 text-left font-semibold">#</th>
                                <th scope="col" className="px-3 py-2.5 text-left font-semibold">Description</th>
                                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Qty</th>
                                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Unit Price</th>
                                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="border-b border-slate-100 bg-white">
                                <td className="px-3 py-3 text-slate-500">1</td>
                                <td className="px-3 py-3" data-testid="invoice-line-description">{invoice.description || "Agent purchase"}</td>
                                <td className="px-3 py-3 text-right">1</td>
                                <td className="px-3 py-3 text-right">{amount}</td>
                                <td className="px-3 py-3 text-right font-medium">{amount}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* totals */}
                <div className="mt-6 flex justify-end">
                    <div className="w-full space-y-2 text-sm sm:w-72">
                        <div className="flex justify-between text-slate-500">
                            <span>Subtotal</span>
                            <span className="text-slate-700">{amount}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
                            <span>Total</span>
                            <span data-testid="invoice-total">{amount}</span>
                        </div>
                        <div className="flex justify-between text-slate-500">
                            <span>Amount Paid</span>
                            <span className="text-slate-700" data-testid="invoice-amount-paid">{amountPaid}</span>
                        </div>
                        <div className="flex justify-between font-bold">
                            <span>Balance Due</span>
                            <span className={status.balanceColor} data-testid="invoice-balance-due">{balanceDue}</span>
                        </div>
                    </div>
                </div>

                {/* payment info */}
                <div className="mt-8 border-t border-slate-100 pt-8">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Payment Information</p>

                    {status.isPaid ? (
                        <div className="grid gap-2 text-sm sm:grid-cols-2">
                            <p className="text-slate-500">
                                Payment method
                                <span className="block font-medium text-slate-800" data-testid="invoice-payment-method">
                                    {billing?.paymentMethod
                                        ? `${billing.paymentMethod.brand} ending in ${billing.paymentMethod.last4}`
                                        : "—"}
                                </span>
                            </p>
                            <p className="text-slate-500">
                                Transaction ID
                                <span className="invoice-mono block font-medium text-slate-800" data-testid="invoice-transaction-id">
                                    {invoice.id}
                                </span>
                            </p>
                            <p className="text-slate-500">
                                Payment date
                                <span className="block font-medium text-slate-800">{formatFullDate(invoice.createdAt)}</span>
                            </p>
                            <p className="text-slate-500">
                                Status
                                <span className="mt-0.5 flex items-center gap-1.5 font-medium text-green-600">
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" /></svg>
                                    Successful
                                </span>
                            </p>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500" data-testid="invoice-payment-unpaid">
                            Awaiting payment. No transaction has been recorded for this invoice yet.
                        </p>
                    )}
                </div>

                {/* notes */}
                <div className="mt-8 space-y-1 border-t border-slate-100 pt-8 text-sm text-slate-500">
                    <p>Thank you for your business!</p>
                    <p>For questions about this invoice, contact info@triven.ai</p>
                    <p>Payment terms: Due upon receipt</p>
                </div>
            </div>

            {/* invoice footer */}
            <div className="flex flex-col gap-1 border-t border-slate-100 bg-slate-50 px-6 py-4 text-xs text-slate-400 sm:flex-row sm:justify-between sm:px-12">
                <span>Triven AI Agent Platform — Empowering businesses with intelligent automation</span>
                <span>Page 1 of 1</span>
            </div>
        </div>
    );
}
