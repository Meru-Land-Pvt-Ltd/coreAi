"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { businessCheckoutPath } from "@/lib/routes";

const TRIVEN_LOGO_SRC = "/triven.ai word logo transparent bg.PNG";

const FAILED_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

.pfailed-root { font-family:'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif; -webkit-font-smoothing:antialiased; }
.pfailed-root .tnum { font-variant-numeric:tabular-nums; }

.pf-fade-up { animation:pfFadeUp .5s cubic-bezier(.16,1,.3,1) both; }
@keyframes pfFadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }

.pf-pulse-ring { position:relative; }
.pf-pulse-ring::before { content:""; position:absolute; inset:-6px; border-radius:9999px; background:currentColor; opacity:.25; z-index:-1; animation:pfPulseRing 2.4s cubic-bezier(.4,0,.6,1) infinite; }
@keyframes pfPulseRing { 0%{transform:scale(.85);opacity:.35} 70%{transform:scale(1.6);opacity:0} 100%{transform:scale(1.6);opacity:0} }

.pf-reason { display:flex; gap:.625rem; }
.pf-reason::before { content:""; flex:0 0 auto; margin-top:.375rem; width:.375rem; height:.375rem; border-radius:9999px; background:#f59e0b; }

@media (prefers-reduced-motion: reduce) {
  .pfailed-root *, .pfailed-root *::before, .pfailed-root *::after { animation:none !important; }
}
`;

const REASONS = [
    "Insufficient funds",
    "Card expired",
    "Bank security block — a quick call to your bank usually clears it",
    "Incorrect card details",
    "Daily transaction limit reached"
];

function PaymentFailedFallback() {
    return (
        <div className="pfailed-root min-h-screen bg-white text-slate-900">
            <style dangerouslySetInnerHTML={{ __html: FAILED_STYLES }} />
            <div className="mx-auto flex min-h-screen max-w-[560px] items-center justify-center px-5">
                <div className="w-full rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                    <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-amber-100" />
                    <p className="text-sm font-semibold text-slate-700">Loading payment status...</p>
                </div>
            </div>
        </div>
    );
}

function resolvePaymentMode(searchParams: URLSearchParams) {
    const mode = searchParams.get("mode");
    if (mode === "trial" || mode === "purchase") return mode;
    const amountParam = Number(searchParams.get("amount"));
    if (Number.isFinite(amountParam) && amountParam > 0) return "purchase";
    return "trial";
}

function BusinessPaymentFailedContent() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const listingId = searchParams.get("listingId");
    const failureReason = searchParams.get("reason");
    const agentName = searchParams.get("agent") || "your agent";
    const amountParam = Number(searchParams.get("amount"));
    const amount = Number.isFinite(amountParam) && amountParam > 0 ? amountParam : null;
    const trialDaysParam = searchParams.get("trialDays");
    const trialDays = trialDaysParam ? Number(trialDaysParam) : 7;
    const paymentMode = resolvePaymentMode(searchParams);
    const isTrial = paymentMode === "trial";

    const [pricingModel, setPricingModel] = useState<string | null>(null);

    useEffect(() => {
        if (!listingId) return;

        let mounted = true;

        void apiGet<{ pricingModel?: string | null }>(
            `/payments/listing-access/${listingId}`
        ).then((response) => {
            if (!mounted) return;

            if (response.success && response.data) {
                setPricingModel(response.data.pricingModel ?? null);
            }
        });

        return () => {
            mounted = false;
        };
    }, [listingId]);

    function backToCheckout() {
        router.push(businessCheckoutPath(listingId ?? undefined));
    }

    return (
        <div className="pfailed-root min-h-screen bg-white text-slate-900">
            <style dangerouslySetInnerHTML={{ __html: FAILED_STYLES }} />

            <nav className="border-b border-slate-200">
                <div className="mx-auto flex h-16 max-w-6xl items-center justify-center px-5">
                    <span className="flex items-center gap-2.5">
                        <Image
                            src={TRIVEN_LOGO_SRC}
                            alt="Triven logo"
                            width={32}
                            height={32}
                            priority
                            className="h-8 w-8 object-contain"
                        />
                        <span className="text-lg font-extrabold tracking-tight text-amber-500">
                            Triven.ai
                        </span>
                    </span>
                </div>
            </nav>

            <div className="mx-auto max-w-[560px] px-5 py-10 sm:py-14">
                <div className="pf-fade-up mb-6 flex justify-center">
                    <span className="pf-pulse-ring text-amber-400">
                        <span className="grid h-16 w-16 place-items-center rounded-full bg-amber-100 text-amber-600">
                            <svg
                                className="h-8 w-8"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 8v4" />
                                <path d="M12 16h.01" />
                            </svg>
                        </span>
                    </span>
                </div>

                <header className="pf-fade-up text-center" style={{ animationDelay: ".05s" }}>
                    <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl" data-testid="payment-failed-title">
                        {isTrial ? "Trial couldn't be started" : "Payment couldn't be processed"}
                    </h1>
                    <p className="mt-2 text-slate-600" data-testid="payment-failed-subtitle">
                        {isTrial
                            ? `We couldn't start your ${trialDays}-day free trial. This is usually a quick fix.`
                            : amount
                                ? `Your payment of $${amount.toFixed(2)} was declined. This is usually a quick fix.`
                                : "Your payment was declined. This is usually a quick fix."}
                    </p>
                </header>

                <section
                    className="pf-fade-up mt-8 rounded-xl border border-slate-200 border-l-4 border-l-amber-500 bg-white p-5 shadow-md"
                    style={{ animationDelay: ".1s" }}
                    data-testid="payment-failed-summary"
                >
                    <div className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-slate-500">{agentName}</span>
                        <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${isTrial ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}
                            data-testid="payment-failed-status-badge"
                        >
                            {isTrial ? "Trial not started" : "Payment failed"}
                        </span>
                    </div>
                    {amount ? (
                        <p className="mt-3 text-sm text-slate-600" data-testid="payment-failed-amount-note">
                            {isTrial
                                ? `$${amount.toFixed(2)}${pricingModel === "ONE_TIME" ? "" : "/month"} after your trial — nothing was charged today.`
                                : `$${amount.toFixed(2)} was not charged. You can retry when ready.`}
                        </p>
                    ) : null}
                </section>

                <section
                    className="pf-fade-up mt-6 rounded-xl border border-slate-200 border-l-4 border-l-amber-500 bg-white p-5 shadow-md"
                    style={{ animationDelay: ".12s" }}
                >
                    {failureReason ? (
                        <>
                            <h2 className="text-sm font-semibold">What happened</h2>
                            <p className="mt-2 text-sm text-slate-700" data-testid="payment-failed-reason">
                                {failureReason}
                            </p>
                            <hr className="my-4 border-slate-100" />
                        </>
                    ) : null}
                    <h2 className="text-sm font-semibold">{failureReason ? "Other possible reasons" : "Possible reasons"}</h2>
                    <ul className="mt-3 space-y-2.5 text-sm text-slate-600">
                        {REASONS.map((reason) => (
                            <li key={reason} className="pf-reason">
                                {reason}
                            </li>
                        ))}
                    </ul>
                </section>

                <div className="pf-fade-up mt-6 space-y-3" style={{ animationDelay: ".15s" }}>
                    <button
                        type="button"
                        onClick={backToCheckout}
                        data-testid="payment-failed-retry"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 font-semibold text-slate-900 shadow-sm transition-transform duration-150 hover:scale-[1.02] hover:bg-amber-400 hover:shadow-md"
                    >
                        {isTrial ? "Try starting trial again" : "Try payment again"}
                    </button>

                    <button
                        type="button"
                        onClick={backToCheckout}
                        data-testid="payment-failed-different-card"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-3 font-semibold text-slate-800 transition-transform duration-150 hover:scale-[1.02] hover:bg-slate-50"
                    >
                        Use a different card
                    </button>
                </div>

                <footer className="pf-fade-up mt-8 space-y-4" style={{ animationDelay: ".2s" }}>
                    <p className="flex items-center justify-center gap-2 text-sm text-slate-600">
                        <svg
                            className="h-4 w-4 text-emerald-600"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <rect x="3" y="11" width="18" height="11" rx="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        Your {isTrial ? "trial setup" : "checkout"} is saved. Nothing has been lost.
                    </p>

                    <p className="mx-auto flex w-fit items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">
                        <svg
                            className="h-3.5 w-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 7v5l3 2" />
                        </svg>
                        {/* A 30-minute countdown ran here saying the agent was
                            "reserved". Nothing was reserved — no record, no
                            expiry — and it restarted at 30:00 on every page
                            load. When it hit zero, nothing happened. */}
                        {agentName} is still waiting for you
                    </p>

                    <p className="text-center text-xs leading-relaxed text-slate-500">
                        Need help? Email{" "}
                        <a
                            href="mailto:support@triven.ai"
                            className="font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900"
                        >
                            support@triven.ai
                        </a>
                    </p>
                </footer>
            </div>
        </div>
    );
}

export default function BusinessPaymentFailedPage() {
    return (
        <Suspense fallback={<PaymentFailedFallback />}>
            <BusinessPaymentFailedContent />
        </Suspense>
    );
}