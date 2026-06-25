"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CoreHeader } from "../components/common/header";
import { CoreFooter } from "../components/common/footer";

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

.core-root {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background-color: #ffffff;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.core-root .font-mono { font-family: '"JetBrains Mono"', ui-monospace, monospace; }
.core-root ::selection { background: rgba(245,158,11,0.2); color: #0f172a; }
.core-root :focus-visible { outline: 2px solid #fbbf24; outline-offset: 2px; border-radius: 4px; }

.shadow-glow-sm { box-shadow: 0 0 24px -6px rgba(245,158,11,0.2); }
.shadow-glow { box-shadow: 0 0 48px -8px rgba(245,158,11,0.25); }
.shadow-glow-lg { box-shadow: 0 0 90px -10px rgba(245,158,11,0.3); }

@keyframes pulseRing { 0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.3); } 50% { box-shadow: 0 0 0 16px rgba(245,158,11,0); } }
@keyframes flow { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
.animate-pulse-ring { animation: pulseRing 2.6s cubic-bezier(0.4,0,0.6,1) infinite; }
.animate-flow { animation: flow 2.4s linear infinite; }
.animate-float { animation: float 7s ease-in-out infinite; }
.animate-fade-up { animation: fadeUp 0.7s ease forwards; }

@media (prefers-reduced-motion: reduce) {
  .animate-pulse-ring, .animate-flow, .animate-float, .animate-fade-up { animation: none !important; }
}
`;

function ArrowIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg data-testid="app-page-svg-1" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path data-testid="app-page-path-1" d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}
function CheckBadge() {
  return (
    <span data-testid="app-page-span-1" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
      <svg data-testid="app-page-svg-2" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path data-testid="app-page-path-2" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </span>
  );
}
function Stars() {
  return (
    <div data-testid="app-page-div-1" className="mb-4 flex gap-0.5 text-amber-400" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg data-testid="app-page-svg-3" key={i} className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path data-testid="app-page-path-3" d="M10 1.5 12.5 7l6 .5-4.5 4 1.4 5.9L10 14.3 4.6 17.4 6 11.5 1.5 7.5l6-.5L10 1.5Z" />
        </svg>
      ))}
    </div>
  );
}

function Counter({ target, prefix = "", suffix = "", decimals = 0, active }: { target: number; prefix?: string; suffix?: string; decimals?: number; active: boolean }) {
  const [text, setText] = useState(`${prefix}${decimals > 0 ? (0).toFixed(decimals) : "0"}${suffix}`);
  const done = useRef(false);

  useEffect(() => {
    if (!active || done.current) return;
    done.current = true;
    const fmt = (val: number) => {
      const out = decimals > 0 ? val.toFixed(decimals) : Math.round(val).toLocaleString("en-US");
      return `${prefix}${out}${suffix}`;
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setText(fmt(target));
      return;
    }
    const dur = 1600;
    let start: number | null = null;
    let raf = 0;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      setText(fmt(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
      else setText(fmt(target));
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, target, prefix, suffix, decimals]);

  return <div data-testid="app-page-div-2" className="text-5xl font-extrabold tracking-tight text-slate-900">{text}</div>;
}

export default function HomePage() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  const [navTop, setNavTop] = useState(0);
  const [heroSent, setHeroSent] = useState(false);
  const [stickyShown, setStickyShown] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitSent, setExitSent] = useState(false);
  const [countersActive, setCountersActive] = useState(false);

  const bannerRef = useRef<HTMLDivElement | null>(null);
  const counterSectionRef = useRef<HTMLDivElement | null>(null);

  /* navbar scroll state + promo banner offset */
  useEffect(() => {
    const onScroll = () => {
      setNavScrolled(window.scrollY > 8);
      const bannerH = bannerRef.current ? bannerRef.current.offsetHeight : 0;
      setNavTop(Math.max(0, bannerH - window.scrollY));
      setStickyShown(window.scrollY > 600);
    };
    const onResize = () => {
      const bannerH = bannerRef.current ? bannerRef.current.offsetHeight : 0;
      setNavTop(Math.max(0, bannerH - window.scrollY));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /* counters intersection observer */
  useEffect(() => {
    const node = counterSectionRef.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) {
      setCountersActive(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            setCountersActive(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.4 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  /* exit-intent popup */
  useEffect(() => {
    const openPopup = () => {
      try {
        if (sessionStorage.getItem("coreExitShown")) return;
        sessionStorage.setItem("coreExitShown", "1");
      } catch {
        /* ignore */
      }
      setExitOpen(true);
    };
    const onMouseOut = (e: MouseEvent) => {
      if (e.clientY <= 10 && !e.relatedTarget) openPopup();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExitOpen(false);
    };
    document.addEventListener("mouseout", onMouseOut);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div data-testid="app-page-div-3" className="core-root min-h-screen text-slate-600">
      <style data-testid="app-page-style-1" dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* ============ URGENCY BANNER ============ */}
      <div data-testid="app-page-div-4" ref={bannerRef} className="relative z-40 bg-amber-500 py-2 text-center text-xs font-semibold text-slate-950">
        Early Architect Program — First 100 architects get lifetime free access. <span data-testid="app-page-span-2" className="font-bold">37 spots remaining.</span>
      </div>

      {/* ============ NAVBAR ============ */}
      <CoreHeader
        navTop={navTop}
        navScrolled={navScrolled}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
      />

      <main data-testid="app-page-main-1" id="top">
        {/* ============ HERO ============ */}
        <section data-testid="app-page-section-1" className="relative overflow-hidden px-6 pb-20 pt-36 sm:pt-44">
          <div data-testid="app-page-div-10" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(60%_55%_at_50%_0%,rgba(245,158,11,0.08),rgba(2,6,23,0)_72%)]" />
          <div data-testid="app-page-div-11" className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(70%_50%_at_50%_0%,#000,transparent_85%)]" />

          <div data-testid="app-page-div-12" className="mx-auto max-w-4xl text-center">
            <div data-testid="app-page-div-13" className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">
              <span data-testid="app-page-span-4" className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              The AI Agent Marketplace
            </div>

            <h1 data-testid="app-page-h1-1" className="text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
              Stop Losing Customers.<br data-testid="app-page-br-1" className="hidden sm:block" />
              <span data-testid="app-page-span-5" className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 bg-clip-text text-transparent">Start Building AI Agents.</span>
            </h1>

            <p data-testid="app-page-p-1" className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-slate-600 sm:text-xl">
              <span data-testid="app-page-span-6" className="font-semibold text-slate-900">Businesses:</span> your missed calls and slow follow-ups are costing you thousands.{" "}
              <span data-testid="app-page-span-7" className="font-semibold text-slate-900">AI Architects:</span> build agents that solve this and earn 70% of every sale.
            </p>

            <div data-testid="app-page-div-14" className="mt-6 flex items-center justify-center gap-2 text-base font-semibold text-amber-600">
              <svg data-testid="app-page-svg-6" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path data-testid="app-page-path-5" d="M3 3v18h18" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                <rect data-testid="app-page-rect-1" x="6.5" y="14" width="3" height="4" rx="1" fill="currentColor" />
                <rect data-testid="app-page-rect-2" x="11.5" y="11" width="3" height="7" rx="1" fill="currentColor" />
                <rect data-testid="app-page-rect-3" x="16.5" y="8" width="3" height="10" rx="1" fill="currentColor" />
              </svg>
              Businesses on CORE recover an average of $4,200/month in lost revenue.
            </div>

            <div data-testid="app-page-div-15" className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link data-testid="app-page-link-7" href="/assignment" className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-7 py-3.5 text-base font-semibold text-slate-950 shadow-glow transition hover:scale-[1.03] hover:bg-amber-400 hover:shadow-glow-lg sm:w-auto">
                I&apos;m a Business Find My Agent
                <ArrowIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link data-testid="app-page-link-8" href={"/architect/login" as Route} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400 px-7 py-3.5 text-base font-semibold text-amber-600 transition hover:scale-[1.03] hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700 sm:w-auto">
                I&apos;m an Architect Start Building Free
              </Link>
            </div>

            <p data-testid="app-page-p-2" className="mt-6 text-sm text-slate-500">
              Free forever for Architects&nbsp;&nbsp;•&nbsp;&nbsp;3,200+ agents built&nbsp;&nbsp;•&nbsp;&nbsp;Trusted by 500+ businesses
            </p>

            <div data-testid="app-page-div-16" className="mx-auto mt-8 max-w-md rounded-xl border border-amber-200 bg-white p-2 shadow-sm">
              {!heroSent ? (
                <form data-testid="app-page-form-1"
                  className="flex flex-col gap-2 sm:flex-row"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    setHeroSent(true);
                  }}
                >
                  <label data-testid="app-page-label-1" htmlFor="hero-email" className="sr-only">Work email</label>
                  <input data-testid="app-page-input-1" id="hero-email" type="email" required placeholder="you@company.com" autoComplete="email" className="w-full rounded-lg border border-amber-200 bg-gray-50 px-4 py-3 text-slate-900 placeholder-slate-500 focus:border-amber-400 focus:outline-none" />
                  <button data-testid="app-page-button-2" type="submit" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-amber-400">
                    Get Free Assessment
                    <ArrowIcon />
                  </button>
                </form>
              ) : (
                <p data-testid="app-page-p-3" className="px-2 py-3 text-center text-sm font-semibold text-amber-600">Check your inbox! Your assessment link is on the way.</p>
              )}
              <p data-testid="app-page-p-4" className="mt-1 px-2 text-center text-xs text-slate-500">No credit card required • Unsubscribe anytime</p>
            </div>
          </div>

          {/* workflow node showcase */}
          <div data-testid="app-page-div-17" className="relative mx-auto mt-16 max-w-4xl animate-float">
            <div data-testid="app-page-div-18" className="absolute -inset-x-10 -inset-y-6 -z-10 rounded-[2rem] bg-[radial-gradient(50%_60%_at_50%_50%,rgba(245,158,11,0.07),transparent_70%)]" />
            <div data-testid="app-page-div-19" className="rounded-2xl border border-gray-200 bg-white p-6 shadow-glow backdrop-blur-sm sm:p-10">
              <div data-testid="app-page-div-20" className="mb-8 flex items-center gap-2 border-b border-gray-200 pb-4">
                <span data-testid="app-page-span-8" className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                <span data-testid="app-page-span-9" className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                <span data-testid="app-page-span-10" className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                <span data-testid="app-page-span-11" className="ml-3 font-mono text-xs text-slate-500">missed-call-recovery.agent</span>
              </div>

              <div data-testid="app-page-div-21" className="flex flex-col items-stretch gap-4 md:flex-row md:items-center md:gap-0">
                <div data-testid="app-page-div-22" className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-white px-6 py-5 text-center shadow-sm backdrop-blur md:min-w-[148px]">
                  <div data-testid="app-page-div-23" className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-300">
                    <svg data-testid="app-page-svg-7" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path data-testid="app-page-path-6" d="M3.75 13.5 14.25 2.25 12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" /></svg>
                  </div>
                  <div data-testid="app-page-div-24">
                    <div data-testid="app-page-div-25" className="text-sm font-semibold text-slate-900">Trigger</div>
                    <div data-testid="app-page-div-26" className="text-xs text-slate-500">Missed call</div>
                  </div>
                </div>

                <div data-testid="app-page-div-27" className="flex items-center justify-center md:flex-1">
                  <div data-testid="app-page-div-28" className="hidden h-px w-full bg-gradient-to-r from-transparent via-amber-500/70 to-transparent bg-[length:200%_100%] animate-flow md:block" />
                  <div data-testid="app-page-div-29" className="h-7 w-px bg-gradient-to-b from-amber-500/60 to-amber-500/20 md:hidden" />
                </div>

                <div data-testid="app-page-div-30" className="flex flex-col items-center gap-3 rounded-xl border border-amber-400 bg-white px-7 py-6 text-center shadow-sm shadow-glow backdrop-blur md:min-w-[160px]">
                  <div data-testid="app-page-div-31" className="flex h-14 w-14 items-center justify-center rounded-xl bg-amber-500 text-slate-950 shadow-glow animate-pulse-ring">
                    <svg data-testid="app-page-svg-8" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path data-testid="app-page-path-7" d="M12 1.75 14.1 8.4 21 9.3l-5.1 4.1L17.5 21 12 17.2 6.5 21l1.6-7.6L3 9.3l6.9-.9L12 1.75Z" /></svg>
                  </div>
                  <div data-testid="app-page-div-32">
                    <div data-testid="app-page-div-33" className="text-sm font-semibold text-slate-900">AI Brain</div>
                    <div data-testid="app-page-div-34" className="text-xs text-amber-600/90">Decides &amp; acts</div>
                  </div>
                </div>

                <div data-testid="app-page-div-35" className="flex items-center justify-center md:flex-1">
                  <div data-testid="app-page-div-36" className="hidden h-px w-full bg-gradient-to-r from-transparent via-amber-500/70 to-transparent bg-[length:200%_100%] animate-flow md:block" />
                  <div data-testid="app-page-div-37" className="h-7 w-px bg-gradient-to-b from-amber-500/60 to-amber-500/20 md:hidden" />
                </div>

                <div data-testid="app-page-div-38" className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-white px-6 py-5 text-center shadow-sm backdrop-blur md:min-w-[148px]">
                  <div data-testid="app-page-div-39" className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-300">
                    <svg data-testid="app-page-svg-9" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path data-testid="app-page-path-8" d="M4.5 12.75l6 6 9-13.5" /></svg>
                  </div>
                  <div data-testid="app-page-div-40">
                    <div data-testid="app-page-div-41" className="text-sm font-semibold text-slate-900">Action</div>
                    <div data-testid="app-page-div-42" className="text-xs text-slate-500">Instant follow-up</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ PRODUCT DEMO VISUAL ============ */}
        <section data-testid="app-page-section-2" className="px-6">
          <div data-testid="app-page-div-43" className="relative mx-auto mt-16 max-w-4xl animate-float rounded-2xl border border-gray-200 bg-white p-6 shadow-glow backdrop-blur-sm">
            <div data-testid="app-page-div-44" className="pointer-events-none absolute -inset-x-8 -inset-y-6 -z-10 rounded-[2rem] bg-[radial-gradient(50%_60%_at_50%_50%,rgba(245,158,11,0.06),transparent_70%)]" />
            <div data-testid="app-page-div-45" className="mb-6 flex items-center gap-2 border-b border-gray-200 pb-4">
              <span data-testid="app-page-span-12" className="h-2.5 w-2.5 rounded-full bg-gray-300" />
              <span data-testid="app-page-span-13" className="h-2.5 w-2.5 rounded-full bg-gray-300" />
              <span data-testid="app-page-span-14" className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
              <span data-testid="app-page-span-15" className="ml-3 font-mono text-xs text-slate-500">agent-builder.core</span>
            </div>

            <svg data-testid="app-page-svg-10" viewBox="0 0 820 340" className="h-auto w-full" role="img" aria-label="Drag-and-drop workflow builder: a missed call triggers the AI Brain, which sends an SMS and books an appointment.">
              <defs data-testid="app-page-defs-1">
                <linearGradient data-testid="app-page-lineargradient-1" id="coreLineGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop data-testid="app-page-stop-1" offset="0" stopColor="#f59e0b" stopOpacity="0.25" />
                  <stop data-testid="app-page-stop-2" offset="0.5" stopColor="#fbbf24" stopOpacity="0.9" />
                  <stop data-testid="app-page-stop-3" offset="1" stopColor="#f59e0b" stopOpacity="0.25" />
                </linearGradient>
                <filter id="coreNodeGlow" x="-40%" y="-40%" width="180%" height="180%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#f59e0b" floodOpacity="0.5" />
                </filter>
                <filter id="coreDotGlow" x="-200%" y="-200%" width="500%" height="500%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#fbbf24" floodOpacity="0.9" />
                </filter>
              </defs>

              <g data-testid="app-page-g-1" fill="none" stroke="url(#coreLineGrad)" strokeWidth={2.5} strokeLinecap="round">
                <path data-testid="app-page-path-9" d="M200,170 C250,170 275,170 325,170" />
                <path data-testid="app-page-path-10" d="M495,155 C560,155 565,95 620,95" />
                <path data-testid="app-page-path-11" d="M495,185 C560,185 565,245 620,245" />
              </g>

              <g data-testid="app-page-g-2" transform="translate(30,130)">
                <rect data-testid="app-page-rect-4" width="170" height="80" rx="14" fill="#ffffff" stroke="#d1d5db" strokeOpacity="1" strokeWidth={1.5} />
                <rect data-testid="app-page-rect-5" x="16" y="22" width="36" height="36" rx="10" fill="#fffbeb" stroke="#f59e0b" strokeOpacity="0.3" />
                <g data-testid="app-page-g-3" transform="translate(24,30) scale(0.8)" fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path data-testid="app-page-path-12" d="M3 5a2 2 0 0 1 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a2 2 0 0 1-2 2A16 16 0 0 1 3 5z" />
                </g>
                <text data-testid="app-page-text-1" x="64" y="40" fill="#0f172a" fontFamily="Inter, sans-serif" fontSize="15" fontWeight="600">Missed Call</text>
                <text data-testid="app-page-text-2" x="64" y="58" fill="#475569" fontFamily="Inter, sans-serif" fontSize="11">Incoming trigger</text>
              </g>

              <g data-testid="app-page-g-4" transform="translate(325,120)">
                <rect data-testid="app-page-rect-6" width="170" height="100" rx="16" fill="#ffffff" stroke="#f59e0b" strokeOpacity="0.55" strokeWidth={1.5} filter="url(#coreNodeGlow)" />
                <rect data-testid="app-page-rect-7" x="16" y="32" width="36" height="36" rx="10" fill="#f59e0b" />
                <g data-testid="app-page-g-5" transform="translate(22,38)">
                  <path data-testid="app-page-path-13" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="#0f172a" />
                </g>
                <text data-testid="app-page-text-3" x="64" y="56" fill="#0f172a" fontFamily="Inter, sans-serif" fontSize="15" fontWeight="600">AI Brain</text>
                <text data-testid="app-page-text-4" x="64" y="74" fill="#d97706" fontFamily="Inter, sans-serif" fontSize="11">Decides next step</text>
              </g>

              <g data-testid="app-page-g-6" transform="translate(620,55)">
                <rect data-testid="app-page-rect-8" width="170" height="80" rx="14" fill="#ffffff" stroke="#d1d5db" strokeOpacity="1" strokeWidth={1.5} />
                <rect data-testid="app-page-rect-9" x="16" y="22" width="36" height="36" rx="10" fill="#fffbeb" stroke="#f59e0b" strokeOpacity="0.3" />
                <g data-testid="app-page-g-7" transform="translate(24,30) scale(0.8)" fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path data-testid="app-page-path-14" d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                </g>
                <text data-testid="app-page-text-5" x="64" y="40" fill="#0f172a" fontFamily="Inter, sans-serif" fontSize="15" fontWeight="600">Send SMS</text>
                <text data-testid="app-page-text-6" x="64" y="58" fill="#475569" fontFamily="Inter, sans-serif" fontSize="11">Twilio · WhatsApp</text>
              </g>

              <g data-testid="app-page-g-8" transform="translate(620,205)">
                <rect data-testid="app-page-rect-10" width="170" height="80" rx="14" fill="#ffffff" stroke="#d1d5db" strokeOpacity="1" strokeWidth={1.5} />
                <rect data-testid="app-page-rect-11" x="16" y="22" width="36" height="36" rx="10" fill="#fffbeb" stroke="#f59e0b" strokeOpacity="0.3" />
                <g data-testid="app-page-g-9" transform="translate(24,30) scale(0.8)" fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path data-testid="app-page-path-15" d="M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
                </g>
                <text data-testid="app-page-text-7" x="64" y="40" fill="#0f172a" fontFamily="Inter, sans-serif" fontSize="15" fontWeight="600">Book Appointment</text>
                <text data-testid="app-page-text-8" x="64" y="58" fill="#475569" fontFamily="Inter, sans-serif" fontSize="11">Google Calendar</text>
              </g>

              <g data-testid="app-page-g-10" filter="url(#coreDotGlow)">
                <circle data-testid="app-page-circle-3" r="4.5" fill="#fde68a">
                  <animateMotion dur="2.2s" repeatCount="indefinite" path="M200,170 C250,170 275,170 325,170" />
                </circle>
                <circle data-testid="app-page-circle-4" r="4.5" fill="#fde68a">
                  <animateMotion dur="2.6s" repeatCount="indefinite" path="M495,155 C560,155 565,95 620,95" />
                </circle>
                <circle data-testid="app-page-circle-5" r="4.5" fill="#fde68a">
                  <animateMotion dur="2.6s" begin="0.6s" repeatCount="indefinite" path="M495,185 C560,185 565,245 620,245" />
                </circle>
              </g>
            </svg>

            <p data-testid="app-page-p-5" className="mt-4 text-center text-sm text-slate-500">Build powerful AI agents in minutes — no code required</p>
          </div>
        </section>

        {/* ============ VALUE PROPOSITION ============ */}
        <section data-testid="app-page-section-3" id="platform" className="scroll-mt-24 px-6 py-20 sm:py-28">
          <div data-testid="app-page-div-46" className="mx-auto max-w-7xl">
            <div data-testid="app-page-div-47" className="mx-auto max-w-2xl text-center">
              <p data-testid="app-page-p-6" className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">One platform</p>
              <h2 data-testid="app-page-h2-1" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">One Platform. Two Superpowers.</h2>
              <p data-testid="app-page-p-7" className="mt-4 text-lg text-slate-500">Whether you run a business or build the agents that power it, CORE meets you where you are.</p>
            </div>

            <div data-testid="app-page-div-48" className="mt-14 grid gap-6 lg:grid-cols-2">
              {/* For Businesses */}
              <div data-testid="app-page-div-49" id="businesses" className="group scroll-mt-24 rounded-xl border border-gray-200 bg-white p-8 shadow-sm backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-amber-400 hover:shadow-glow sm:p-10">
                <div data-testid="app-page-div-50" className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-300">
                  <svg data-testid="app-page-svg-11" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path data-testid="app-page-path-16" d="M3.75 21h16.5M5.25 21V5.25A1.5 1.5 0 0 1 6.75 3.75h6A1.5 1.5 0 0 1 14.25 5.25V21M14.25 9.75h3.75a1.5 1.5 0 0 1 1.5 1.5V21M8.25 7.5h2.25M8.25 11.25h2.25M8.25 15h2.25" /></svg>
                </div>
                <h3 data-testid="app-page-h3-1" className="text-xl font-semibold text-slate-900">For Businesses</h3>
                <p data-testid="app-page-p-8" className="mt-3 leading-relaxed text-slate-500">Take a 2-minute assessment to discover which AI agent can recover your lost revenue. We measure and improve:</p>
                <ul data-testid="app-page-ul-1" className="mt-6 space-y-3">
                  <li data-testid="app-page-li-1" className="flex items-center gap-3 text-slate-600"><CheckBadge />Lead Capture Speed</li>
                  <li data-testid="app-page-li-2" className="flex items-center gap-3 text-slate-600"><CheckBadge />Follow-Up Consistency</li>
                  <li data-testid="app-page-li-3" className="flex items-center gap-3 text-slate-600"><CheckBadge />Customer Retention</li>
                </ul>
                <Link data-testid="app-page-link-9" href="/assignment" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-amber-600 transition hover:gap-3 hover:text-amber-600">
                  Take the free assessment
                  <ArrowIcon />
                </Link>
              </div>

              {/* For Architects */}
              <div data-testid="app-page-div-51" id="architects" className="group scroll-mt-24 rounded-xl border border-gray-200 bg-white p-8 shadow-sm backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-amber-400 hover:shadow-glow sm:p-10">
                <div data-testid="app-page-div-52" className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-300">
                  <svg data-testid="app-page-svg-12" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path data-testid="app-page-path-17" d="M21 7.5 12 2.25 3 7.5m18 0-9 5.25m9-5.25v9L12 21.75M3 7.5l9 5.25M3 7.5v9L12 21.75m0-9v9" /></svg>
                </div>
                <h3 data-testid="app-page-h3-2" className="text-xl font-semibold text-slate-900">For AI Architects</h3>
                <p data-testid="app-page-p-9" className="mt-3 leading-relaxed text-slate-500">Build AI agents visually with drag-and-drop. No coding. Publish to the marketplace. Earn 70% recurring revenue from every business that subscribes.</p>
                <ul data-testid="app-page-ul-2" className="mt-6 space-y-3">
                  <li data-testid="app-page-li-4" className="flex items-center gap-3 text-slate-600"><CheckBadge />Visual drag-and-drop builder</li>
                  <li data-testid="app-page-li-5" className="flex items-center gap-3 text-slate-600"><CheckBadge />Publish to a global marketplace</li>
                  <li data-testid="app-page-li-6" className="flex items-center gap-3 text-slate-600"><CheckBadge />Earn 70% recurring revenue</li>
                </ul>

                <div data-testid="app-page-div-53" className="mt-6 rounded-lg border border-amber-200 bg-gray-50 p-5">
                  <div data-testid="app-page-div-54" className="text-sm text-slate-500">Agent price: <span data-testid="app-page-span-16" className="font-semibold text-slate-600">$99/month</span></div>
                  <div data-testid="app-page-div-55" className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                    <div data-testid="app-page-div-56" className="h-2 w-[70%] rounded-full bg-amber-500" />
                  </div>
                  <div data-testid="app-page-div-57" className="mt-3 text-sm font-bold text-amber-600">You earn: $69.30/month</div>
                  <div data-testid="app-page-div-58" className="mt-2 text-xs text-slate-500">10 subscribers = $693/month • 50 subscribers = $3,465/month</div>
                </div>

                <Link data-testid="app-page-link-10" href={"/architect/login" as Route} className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-amber-600 transition hover:gap-3 hover:text-amber-600">
                  Start building free
                  <ArrowIcon />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ============ HOW IT WORKS ============ */}
        <section data-testid="app-page-section-4" id="how" className="scroll-mt-24 px-6 py-20 sm:py-28">
          <div data-testid="app-page-div-59" className="mx-auto max-w-7xl">
            <div data-testid="app-page-div-60" className="mx-auto max-w-2xl text-center">
              <p data-testid="app-page-p-10" className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">The flow</p>
              <h2 data-testid="app-page-h2-2" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">How CORE Works</h2>
            </div>

            <div data-testid="app-page-div-61" className="mt-16">
              <div data-testid="app-page-div-62" className="mb-8 flex items-center gap-3">
                <span data-testid="app-page-span-17" className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-600">For Businesses</span>
                <span data-testid="app-page-span-18" className="h-px flex-1 bg-gradient-to-r from-amber-500/20 to-transparent" />
              </div>
              <div data-testid="app-page-div-63" className="flex flex-col gap-4 md:flex-row md:items-center md:gap-0">
                {[
                  ["1", "Take Assessment", "15 quick questions"],
                  ["2", "Get Matched to an Agent", "Personalized in seconds"],
                  ["3", "Agent Works 24/7 For You", "Never miss a lead again"]
                ].map(([n, title, sub], i) => (
                  <div data-testid="app-page-div-64" key={n} className="contents">
                    <div data-testid="app-page-div-65" className="flex flex-1 items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm backdrop-blur-sm transition hover:border-amber-400 hover:shadow-glow-sm">
                      <span data-testid="app-page-span-19" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950 shadow-glow-sm">{n}</span>
                      <div data-testid="app-page-div-66"><div data-testid="app-page-div-67" className="font-semibold text-slate-900">{title}</div><div data-testid="app-page-div-68" className="text-sm text-slate-500">{sub}</div></div>
                    </div>
                    {i < 2 && (
                      <div data-testid="app-page-div-69" className="flex items-center justify-center px-2"><div data-testid="app-page-div-70" className="hidden h-px w-8 bg-gradient-to-r from-amber-500/50 to-amber-500/20 md:block" /><div data-testid="app-page-div-71" className="h-6 w-px bg-gradient-to-b from-amber-500/50 to-amber-500/20 md:hidden" /></div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div data-testid="app-page-div-72" className="mt-12">
              <div data-testid="app-page-div-73" className="mb-8 flex items-center gap-3">
                <span data-testid="app-page-span-20" className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-600">For Architects</span>
                <span data-testid="app-page-span-21" className="h-px flex-1 bg-gradient-to-r from-amber-500/20 to-transparent" />
              </div>
              <div data-testid="app-page-div-74" className="flex flex-col gap-4 md:flex-row md:items-center md:gap-0">
                {[
                  ["1", "Drag & Drop Nodes", "No code required"],
                  ["2", "Connect AI + Connectors", "180+ integrations"],
                  ["3", "Publish & Earn", "70% recurring revenue"]
                ].map(([n, title, sub], i) => (
                  <div data-testid="app-page-div-75" key={n} className="contents">
                    <div data-testid="app-page-div-76" className="flex flex-1 items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm backdrop-blur-sm transition hover:border-amber-400 hover:shadow-glow-sm">
                      <span data-testid="app-page-span-22" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950 shadow-glow-sm">{n}</span>
                      <div data-testid="app-page-div-77"><div data-testid="app-page-div-78" className="font-semibold text-slate-900">{title}</div><div data-testid="app-page-div-79" className="text-sm text-slate-500">{sub}</div></div>
                    </div>
                    {i < 2 && (
                      <div data-testid="app-page-div-80" className="flex items-center justify-center px-2"><div data-testid="app-page-div-81" className="hidden h-px w-8 bg-gradient-to-r from-amber-500/50 to-amber-500/20 md:block" /><div data-testid="app-page-div-82" className="h-6 w-px bg-gradient-to-b from-amber-500/50 to-amber-500/20 md:hidden" /></div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ CREDIBILITY ============ */}
        <section data-testid="app-page-section-5" id="why" className="scroll-mt-24 px-6 py-20 sm:py-28">
          <div data-testid="app-page-div-83" className="mx-auto max-w-7xl">
            <div data-testid="app-page-div-84" className="mx-auto max-w-2xl text-center">
              <p data-testid="app-page-p-11" className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Why now</p>
              <h2 data-testid="app-page-h2-3" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">Built for the AI Agent Era</h2>
            </div>

            <div data-testid="app-page-div-85" className="mx-auto mt-14 grid max-w-5xl grid-cols-2 gap-y-10 gap-x-6 border-y border-gray-200 py-12 md:grid-cols-4">
              {[
                ["180+", "Connectors"],
                ["6", "Universal Agent Types"],
                ["10M+", "Addressable Businesses"],
                ["$0", "To Start"]
              ].map(([v, l]) => (
                <div data-testid="app-page-div-86" key={l} className="text-center">
                  <div data-testid="app-page-div-87" className="text-4xl font-extrabold tracking-tight text-amber-600 sm:text-5xl">{v}</div>
                  <div data-testid="app-page-div-88" className="mt-2 text-sm text-slate-500">{l}</div>
                </div>
              ))}
            </div>

            <p data-testid="app-page-p-12" className="mx-auto mt-12 max-w-3xl text-pretty text-center text-lg leading-relaxed text-slate-600">
              CORE was built by a team obsessed with one question: what if every business in the world could have an AI employee that never sleeps, never forgets to follow up, and costs less than $5/day? We made it possible.
            </p>

            <div data-testid="app-page-div-89" className="mt-14">
              <p data-testid="app-page-p-13" className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Works with the tools you already use</p>
              <div data-testid="app-page-div-90" className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
                {["Twilio", "WhatsApp", "Gmail", "Slack", "Stripe", "Google Calendar", "HubSpot", "Shopify"].map((t) => (
                  <span data-testid="app-page-span-23" key={t} className="text-lg font-semibold tracking-wide text-slate-500 transition hover:text-slate-600">{t}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ ANIMATED COUNTERS ============ */}
        <section data-testid="app-page-section-6" className="scroll-mt-24 bg-gray-50 px-6 py-16 sm:py-20">
          <div data-testid="app-page-div-91" ref={counterSectionRef} className="mx-auto grid max-w-5xl grid-cols-1 gap-10 text-center sm:grid-cols-3">
            <div data-testid="app-page-div-92">
              <Counter target={500} suffix="+" active={countersActive} />
              <div data-testid="app-page-div-93" className="mt-1 text-sm text-slate-500">Businesses Served</div>
            </div>
            <div data-testid="app-page-div-94">
              <Counter target={2.1} prefix="$" suffix="M+" decimals={1} active={countersActive} />
              <div data-testid="app-page-div-95" className="mt-1 text-sm text-slate-500">Revenue Recovered</div>
            </div>
            <div data-testid="app-page-div-96">
              <Counter target={3200} suffix="+" active={countersActive} />
              <div data-testid="app-page-div-97" className="mt-1 text-sm text-slate-500">Agents Built</div>
            </div>
          </div>
        </section>

        {/* ============ SOCIAL PROOF ============ */}
        <section data-testid="app-page-section-7" id="testimonials" className="scroll-mt-24 px-6 py-20 sm:py-28">
          <div data-testid="app-page-div-98" className="mx-auto max-w-7xl">
            <div data-testid="app-page-div-99" className="mx-auto max-w-2xl text-center">
              <p data-testid="app-page-p-14" className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Social proof</p>
              <h2 data-testid="app-page-h2-4" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">What People Are Saying</h2>
            </div>

            <div data-testid="app-page-div-100" className="mt-14 grid gap-6 md:grid-cols-3">
              {[
                { quote: "“I built a missed-call agent in 20 minutes. It's already earning me $400/month.”", initials: "AR", name: "Alex R.", role: "AI Architect" },
                { quote: "“We were losing 30% of leads to missed calls. CORE's agent recovered $12,000 in the first month.”", initials: "SM", name: "Dr. Sarah M.", role: "Dentist" },
                { quote: "“The simplest platform I've ever used. Drag, drop, publish. That's it.”", initials: "JK", name: "James K.", role: "Freelancer" }
              ].map((t) => (
                <figure data-testid="app-page-figure-1" key={t.initials} className="flex flex-col rounded-xl border border-gray-200 bg-white p-8 shadow-sm backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-amber-400 hover:shadow-glow">
                  <Stars />
                  <blockquote data-testid="app-page-blockquote-1" className="flex-1 text-lg leading-relaxed text-slate-700">{t.quote}</blockquote>
                  <figcaption data-testid="app-page-figcaption-1" className="mt-6 flex items-center gap-3 border-t border-gray-200 pt-6">
                    <span data-testid="app-page-span-24" className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-600 ring-1 ring-amber-300">{t.initials}</span>
                    <span data-testid="app-page-span-25"><span data-testid="app-page-span-26" className="block text-sm font-semibold text-slate-900">{t.name}</span><span data-testid="app-page-span-27" className="block text-xs text-slate-500">{t.role}</span></span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* ============ CTA ============ */}
        <section data-testid="app-page-section-8" id="assessment" className="scroll-mt-24 px-6 py-20 sm:py-28">
          <div data-testid="app-page-div-101" className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-amber-200 bg-white px-6 py-16 text-center shadow-sm backdrop-blur-sm sm:px-12 sm:py-20">
            <div data-testid="app-page-div-102" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_50%_0%,rgba(245,158,11,0.1),transparent_70%)]" />

            <h2 data-testid="app-page-h2-5" className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">Not Sure Which AI Agent Your Business Needs?</h2>
            <p data-testid="app-page-p-15" className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">Take our free 2-minute assessment. Answer 15 questions. Get a personalized recommendation instantly.</p>

            <div data-testid="app-page-div-103" className="mt-10">
              <Link data-testid="app-page-link-11" href="/assignment" className="group inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-9 py-4 text-lg font-semibold text-slate-950 shadow-glow-lg transition hover:scale-[1.03] hover:bg-amber-400">
                Start Free Assessment
                <ArrowIcon className="h-5 w-5 transition group-hover:translate-x-1" />
              </Link>
            </div>

            <p data-testid="app-page-p-16" className="mt-6 text-sm text-slate-500">Takes 2 minutes&nbsp;&nbsp;•&nbsp;&nbsp;Completely free&nbsp;&nbsp;•&nbsp;&nbsp;Immediate results</p>

            <div data-testid="app-page-div-104" className="mt-4 flex flex-wrap justify-center gap-3">
              <span data-testid="app-page-span-28" className="rounded-full border border-amber-200 px-3 py-1 text-xs text-slate-600">🔒 No credit card</span>
              <span data-testid="app-page-span-29" className="rounded-full border border-amber-200 px-3 py-1 text-xs text-slate-600">⚡ Instant results</span>
              <span data-testid="app-page-span-30" className="rounded-full border border-amber-200 px-3 py-1 text-xs text-slate-600">🎯 Personalized for your business</span>
            </div>
          </div>
        </section>
      </main>

      {/* ============ FOOTER ============ */}
      <CoreFooter />

      {/* ============ STICKY BOTTOM CTA BAR ============ */}
      <div data-testid="app-page-div-113"
        id="sticky-cta"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 px-6 py-3 shadow-lg backdrop-blur-md transition-all duration-300"
        style={{ opacity: stickyShown ? 1 : 0, transform: stickyShown ? "translateY(0)" : "translateY(0.5rem)", pointerEvents: stickyShown ? "auto" : "none" }}
      >
        <div data-testid="app-page-div-114" className="mx-auto flex w-full max-w-none items-center justify-between gap-4">
          <p data-testid="app-page-p-19" className="text-sm text-slate-600">Ready to recover lost revenue?</p>
          <form data-testid="app-page-form-2"
            className="flex items-center gap-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              router.push("/assignment");
            }}
          >
            <label data-testid="app-page-label-2" htmlFor="sticky-email" className="sr-only">Work email</label>
            <input data-testid="app-page-input-2" id="sticky-email" type="email" placeholder="you@company.com" autoComplete="email" className="hidden w-56 rounded-lg border border-amber-200 bg-gray-50 px-4 py-2 text-sm text-slate-900 placeholder-slate-500 focus:border-amber-400 focus:outline-none sm:block" />
            <button data-testid="app-page-button-3" type="submit" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-400">
              Start Free
              <ArrowIcon />
            </button>
          </form>
        </div>
      </div>

      {/* ============ EXIT-INTENT POPUP ============ */}
      {exitOpen && (
        <div data-testid="app-page-div-115" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setExitOpen(false); }}>
          <div data-testid="app-page-div-116" role="dialog" aria-modal="true" aria-labelledby="exit-title" className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl">
            <button data-testid="app-page-button-4" type="button" onClick={() => setExitOpen(false)} className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-gray-100 hover:text-slate-900" aria-label="Close">
              <svg data-testid="app-page-svg-14" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path data-testid="app-page-path-18" d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <h2 data-testid="app-page-h2-6" id="exit-title" className="pr-8 text-2xl font-bold tracking-tight text-slate-900">Wait — don&apos;t leave empty-handed.</h2>
            <p data-testid="app-page-p-20" className="mt-3 text-sm leading-relaxed text-slate-500">Get your free AI agent assessment. Takes 2 minutes. Find out exactly which agent can recover your lost revenue.</p>
            {!exitSent ? (
              <form data-testid="app-page-form-3" className="mt-6 flex flex-col gap-3" noValidate onSubmit={(e) => { e.preventDefault(); setExitSent(true); }}>
                <label data-testid="app-page-label-3" htmlFor="exit-email" className="sr-only">Work email</label>
                <input data-testid="app-page-input-3" id="exit-email" type="email" required placeholder="you@company.com" autoComplete="email" className="w-full rounded-lg border border-amber-200 bg-gray-50 px-4 py-3 text-slate-900 placeholder-slate-500 focus:border-amber-400 focus:outline-none" />
                <button data-testid="app-page-button-5" type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-amber-400">Send My Free Assessment</button>
              </form>
            ) : (
              <p data-testid="app-page-p-21" className="mt-4 text-center text-sm font-semibold text-amber-600">Check your inbox! Your assessment link is on the way.</p>
            )}
            <p data-testid="app-page-p-22" className="mt-4 text-center text-xs text-slate-500">No spam. Unsubscribe anytime.</p>
          </div>
        </div>
      )}

      {/* ============ LIVE CHAT BUBBLE ============ */}
      <div data-testid="app-page-div-117" className="fixed right-6 z-50 flex flex-col items-end gap-3 transition-all duration-300" style={{ bottom: stickyShown ? "5.5rem" : "1.5rem" }}>
        {chatOpen && (
          <div data-testid="app-page-div-118" className="relative w-64 rounded-2xl border border-gray-200 bg-white p-4 shadow-lg">
            <button data-testid="app-page-button-6" type="button" onClick={() => setChatOpen(false)} className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-slate-500 transition hover:text-slate-900" aria-label="Close chat">
              <svg data-testid="app-page-svg-15" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path data-testid="app-page-path-19" d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <p data-testid="app-page-p-23" className="text-sm text-slate-600">Hi! Need help finding the right AI agent?</p>
            <a data-testid="app-page-a-23" href="mailto:hello@usecore.ai" className="mt-2 inline-block text-sm font-semibold text-amber-600 transition hover:text-amber-600">hello@usecore.ai</a>
          </div>
        )}
        <button data-testid="app-page-button-7" type="button" onClick={() => setChatOpen((o) => !o)} className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-slate-950 shadow-glow transition hover:scale-110" aria-label="Open chat">
          <svg data-testid="app-page-svg-16" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path data-testid="app-page-path-20" d="M7.5 8.5h9M7.5 12h6M21 11.5a8.5 8.5 0 0 1-12.2 7.7L3 21l1.8-5.8A8.5 8.5 0 1 1 21 11.5z" /></svg>
        </button>
      </div>
    </div>
  );
}
