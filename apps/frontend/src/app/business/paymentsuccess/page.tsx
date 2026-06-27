"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
    BUSINESS_MARKETPLACE_PATH,
    businessSetupPath
} from "@/lib/routes";

const TRIVEN_LOGO_SRC = "/triven.ai word logo transparent bg.PNG";

const SUCCESS_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

.psuccess-root { font-family:'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif; -webkit-font-smoothing:antialiased; }

.psuccess-root .top-glow {
  position:absolute; inset:0 0 auto 0; height:340px; z-index:0; pointer-events:none;
  background:radial-gradient(58% 100% at 50% 0%, rgba(245,158,11,.12), rgba(245,158,11,0) 70%);
}

.rise { opacity:0; transform:translateY(14px); animation:psRise .6s cubic-bezier(.21,.6,.21,1) both; }
@keyframes psRise { to { opacity:1; transform:none; } }

.check-pop { opacity:0; transform:scale(0); animation:psCheckPop .6s cubic-bezier(.18,.89,.32,1.28) .35s both; }
@keyframes psCheckPop { 0%{transform:scale(0);opacity:0} 55%{opacity:1} 100%{transform:scale(1);opacity:1} }

.cta-pulse { animation:psCtaPulse 2.6s ease-in-out infinite; }
.cta-pulse:hover, .cta-pulse:focus-visible { animation-play-state:paused; }
@keyframes psCtaPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.015)} }
.cta-arrow { transition:transform .2s ease; }
.cta:hover .cta-arrow { transform:translateX(3px); }
.btn-glow { box-shadow:0 12px 24px -8px rgba(245,158,11,.45), 0 6px 12px -6px rgba(245,158,11,.30); }

.dot-current { position:relative; }
.dot-current::after { content:''; position:absolute; inset:0; border-radius:9999px; animation:psRing 2s ease-out infinite; }
@keyframes psRing {
  0%{box-shadow:0 0 0 0 rgba(245,158,11,.55)}
  70%{box-shadow:0 0 0 9px rgba(245,158,11,0)}
  100%{box-shadow:0 0 0 0 rgba(245,158,11,0)}
}

.ps-confetti { position:absolute; left:50%; top:40px; width:0; height:0; z-index:30; pointer-events:none; }
.ps-confetti i { position:absolute; left:0; top:0; opacity:0; will-change:transform,opacity; animation:psConfetti 1.1s cubic-bezier(.2,.65,.35,1) forwards; }
@keyframes psConfetti {
  0%   { transform:translate(0,0) scale(0) rotate(0); opacity:0; }
  12%  { transform:translate(calc(var(--tx)*.2), calc(var(--ty)*.2 - 34px)) scale(1) rotate(calc(var(--rot)*.2)); opacity:1; }
  100% { transform:translate(var(--tx), var(--ty)) scale(.85) rotate(var(--rot)); opacity:0; }
}

@media (prefers-reduced-motion: reduce) {
  .psuccess-root *, .psuccess-root *::before, .psuccess-root *::after { animation:none !important; }
  .rise, .check-pop { opacity:1 !important; transform:none !important; }
}
`;

type ConfettiPiece = {
    id: number;
    tx: string;
    ty: string;
    rot: string;
    width: string;
    height: string;
    margin: string;
    background: string;
    borderRadius: string;
    delay: string;
};

const CONFETTI_COLORS = ["#f59e0b", "#fbbf24", "#fcd34d", "#10b981", "#34d399", "#f97316"];

function PaymentSuccessFallback() {
    return (
        <div className="psuccess-root relative min-h-screen overflow-x-clip bg-gray-50 text-slate-900">
            <style dangerouslySetInnerHTML={{ __html: SUCCESS_STYLES }} />
            <div className="top-glow" aria-hidden="true" />
            <div className="relative z-10 mx-auto flex min-h-screen max-w-[640px] items-center justify-center px-4">
                <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-lg">
                    <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-emerald-100" />
                    <p className="text-sm font-semibold text-slate-700">Loading payment status...</p>
                </div>
            </div>
        </div>
    );
}

function BusinessPaymentSuccessContent() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const listingId = searchParams.get("listingId");
    const agentName = searchParams.get("agent") || "Your AI Agent";
    const amountParam = Number(searchParams.get("amount"));
    const amount = Number.isFinite(amountParam) && amountParam > 0 ? amountParam : null;
    const email = searchParams.get("email") || "your email";

    const orderNumber = useMemo(() => {
        const random = Math.floor(10000 + Math.random() * 89999);
        return `TRIVEN-${new Date().getFullYear()}-${random}`;
    }, []);

    const [confetti, setConfetti] = useState<ConfettiPiece[]>([]);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        const pieces: ConfettiPiece[] = Array.from({ length: 20 }).map((_, index) => {
            const angle = Math.random() * Math.PI * 2;
            const dist = 70 + Math.random() * 90;
            const tx = Math.cos(angle) * dist;
            const ty = Math.sin(angle) * dist * 0.6 + (90 + Math.random() * 120);
            const w = 6 + Math.random() * 5;
            const h = 8 + Math.random() * 7;

            return {
                id: index,
                tx: `${tx.toFixed(1)}px`,
                ty: `${ty.toFixed(1)}px`,
                rot: `${(Math.random() * 540 - 180).toFixed(0)}deg`,
                width: `${w.toFixed(0)}px`,
                height: `${h.toFixed(0)}px`,
                margin: `${(-h / 2).toFixed(0)}px ${(-w / 2).toFixed(0)}px`,
                background: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
                borderRadius: Math.random() < 0.4 ? "9999px" : "2px",
                delay: `${(0.35 + Math.random() * 0.12).toFixed(2)}s`
            };
        });

        setConfetti(pieces);

        const timeout = window.setTimeout(() => setConfetti([]), 2400);
        return () => window.clearTimeout(timeout);
    }, []);

    function copyOrder() {
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(`Order #${orderNumber}`).catch(() => undefined);
        }

        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
    }

    return (
        <div className="psuccess-root relative min-h-screen overflow-x-clip bg-gray-50 text-slate-900">
            <style dangerouslySetInnerHTML={{ __html: SUCCESS_STYLES }} />

            <div className="top-glow" aria-hidden="true" />

            <header className="relative z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
                <nav className="mx-auto flex h-16 max-w-[640px] items-center justify-center px-4 sm:px-6" aria-label="Primary">
                    <span className="flex items-center gap-2.5">
                        <Image
                            src={TRIVEN_LOGO_SRC}
                            alt="Triven logo"
                            width={32}
                            height={32}
                            priority
                            className="h-8 w-8 object-contain"
                        />
                        <span className="text-lg font-extrabold tracking-tight text-amber-500">Triven</span>
                    </span>
                </nav>
            </header>

            <main className="relative z-10 mx-auto max-w-[640px] px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
                <section className="relative text-center" aria-labelledby="success-title">
                    <div className="ps-confetti" aria-hidden="true">
                        {confetti.map((piece) => (
                            <i
                                key={piece.id}
                                style={{
                                    width: piece.width,
                                    height: piece.height,
                                    margin: piece.margin,
                                    background: piece.background,
                                    borderRadius: piece.borderRadius,
                                    animationDelay: piece.delay,
                                    "--tx": piece.tx,
                                    "--ty": piece.ty,
                                    "--rot": piece.rot
                                } as CSSProperties}
                            />
                        ))}
                    </div>

                    <div className="check-pop mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-100 ring-8 ring-emerald-50">
                        <svg className="h-10 w-10 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                        </svg>
                    </div>

                    <div role="alert">
                        <h1 id="success-title" className="rise mt-6 text-3xl font-bold tracking-tight sm:text-4xl" style={{ animationDelay: ".15s" }}>
                            Payment Successful!
                        </h1>
                        <p className="rise mx-auto mt-2 max-w-md text-base text-slate-600 sm:text-lg" style={{ animationDelay: ".28s" }}>
                            Thank you. Your 7-day free trial has started and your agent is ready to be set up.
                        </p>
                    </div>

                    <div className="rise mt-4 flex justify-center" style={{ animationDelay: ".4s" }}>
                        <button
                            type="button"
                            onClick={copyOrder}
                            data-testid="payment-success-copy-order"
                            aria-label={`Copy order number ${orderNumber}`}
                            className="group inline-flex items-center gap-2 rounded-full bg-slate-100 px-3.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
                        >
                            <span>{copied ? "Copied!" : `Order #${orderNumber}`}</span>
                            <svg className="h-3.5 w-3.5 text-slate-400 transition-colors group-hover:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="9" y="9" width="11" height="11" rx="2" />
                                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                            </svg>
                        </button>
                    </div>
                </section>

                <section className="rise mt-8" style={{ animationDelay: ".55s" }} aria-label="Order summary">
                    <div className="overflow-hidden rounded-2xl border-l-4 border-amber-500 bg-white shadow-lg ring-1 ring-slate-200/60">
                        <div className="p-6 sm:p-7">
                            <div className="flex items-start gap-4">
                                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-sm">
                                    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 9 9 0 0 1-4-1L3 20l1.5-5a8.4 8.4 0 0 1-1-4 8.5 8.5 0 0 1 8.5-8.5 8.4 8.4 0 0 1 8.5 8.5z" />
                                    </svg>
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-lg font-semibold leading-tight">{agentName}</h2>
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                        <span className="text-sm text-slate-600">Triven AI Agent</span>
                                    </div>
                                </div>
                            </div>

                            <hr className="my-5 border-slate-100" />

                            <dl className="space-y-3 text-sm">
                                <div className="flex items-center justify-between gap-4">
                                    <dt className="text-slate-500">Plan</dt>
                                    <dd className="font-medium text-slate-900">Professional — Monthly</dd>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <dt className="text-slate-500">Price after trial</dt>
                                    <dd className="font-medium text-slate-900">
                                        {amount ? `$${amount.toFixed(2)}` : "—"}
                                        <span className="font-normal text-slate-400">/month</span>
                                    </dd>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <dt className="text-slate-500">Due today</dt>
                                    <dd className="font-medium text-emerald-700">$0.00 — free for 7 days</dd>
                                </div>
                            </dl>

                            <hr className="my-5 border-slate-100" />

                            <div className="flex items-center gap-3 text-[11px] text-slate-400">
                                <span className="inline-flex items-center gap-1">
                                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <rect x="5" y="11" width="14" height="9" rx="2" />
                                        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                                    </svg>
                                    Secured by Stripe
                                </span>
                                <span className="h-3 w-px bg-slate-200" aria-hidden="true" />
                                <span className="inline-flex items-center gap-1">
                                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M12 3l7 3v5c0 4.4-3 7.5-7 9-4-1.5-7-4.6-7-9V6z" />
                                    </svg>
                                    256-bit TLS encrypted
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="mt-9" aria-label="What happens next">
                    <h2 className="rise text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ animationDelay: ".7s" }}>
                        What happens next
                    </h2>
                    <ol className="mt-4">
                        <li className="rise grid grid-cols-[16px_1fr] gap-x-4" style={{ animationDelay: ".75s" }}>
                            <div className="flex flex-col items-center">
                                <span className="dot-current mt-1 block h-3.5 w-3.5 rounded-full bg-amber-500 ring-4 ring-amber-100" />
                                <span className="mt-1.5 w-px flex-1 bg-slate-200" aria-hidden="true" />
                            </div>
                            <div className="pb-7">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-slate-900">Set up your agent</h3>
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Current</span>
                                </div>
                                <p className="mt-1 text-sm text-slate-600">Configure your agent with your business details. Takes about 5 minutes.</p>
                            </div>
                        </li>

                        <li className="rise grid grid-cols-[16px_1fr] gap-x-4" style={{ animationDelay: ".85s" }}>
                            <div className="flex flex-col items-center">
                                <span className="mt-1 block h-3.5 w-3.5 rounded-full bg-white ring-2 ring-slate-300" />
                                <span className="mt-1.5 w-px flex-1 bg-slate-200" aria-hidden="true" />
                            </div>
                            <div className="pb-7">
                                <h3 className="font-semibold text-slate-500">Agent goes live</h3>
                                <p className="mt-1 text-sm text-slate-500">Your agent starts handling tasks automatically.</p>
                            </div>
                        </li>

                        <li className="rise grid grid-cols-[16px_1fr] gap-x-4" style={{ animationDelay: ".95s" }}>
                            <div className="flex flex-col items-center">
                                <span className="mt-1 block h-3.5 w-3.5 rounded-full bg-white ring-2 ring-slate-300" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-500">Track results</h3>
                                <p className="mt-1 text-sm text-slate-500">Monitor performance in your dashboard.</p>
                            </div>
                        </li>
                    </ol>
                </section>

                <section className="mt-9">
                    <div className="rise" style={{ animationDelay: "1s" }}>
                        <button
                            type="button"
                            onClick={() => router.push(businessSetupPath(listingId ?? undefined))}
                            data-testid="payment-success-setup-agent"
                            className="cta cta-pulse btn-glow group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-4 text-base font-semibold text-slate-900 transition-colors hover:bg-amber-600"
                        >
                            Set up your agent
                            <svg className="cta-arrow h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M5 12h14m0 0-5-5m5 5-5 5" />
                            </svg>
                        </button>
                    </div>
                    <div className="rise mt-3 text-center" style={{ animationDelay: "1.1s" }}>
                        <button
                            type="button"
                            onClick={() => router.push(BUSINESS_MARKETPLACE_PATH)}
                            data-testid="payment-success-skip"
                            className="rounded text-sm text-slate-500 underline decoration-slate-300 underline-offset-2 transition-colors hover:text-slate-700 hover:decoration-slate-500"
                        >
                            Skip for now — set up later from your dashboard
                        </button>
                    </div>
                </section>

                <section className="rise mt-9" style={{ animationDelay: "1.2s" }} aria-label="Receipt">
                    <p className="inline-flex items-center gap-2 text-sm text-slate-600">
                        <svg className="h-4 w-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                        </svg>
                        Receipt sent to <span className="font-medium text-slate-800">{email}</span>
                    </p>
                </section>

                <div className="rise mt-10" style={{ animationDelay: "1.3s" }}>
                    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-slate-400">
                        <span className="inline-flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="5" y="11" width="14" height="9" rx="2" />
                                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                            </svg>
                            Secured by Stripe
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M8.5 12.5l2.5 2.5 5-5" />
                            </svg>
                            14-day money-back guarantee
                        </span>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default function BusinessPaymentSuccessPage() {
    return (
        <Suspense fallback={<PaymentSuccessFallback />}>
            <BusinessPaymentSuccessContent />
        </Suspense>
    );
}