"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}
function CheckBadge() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </span>
  );
}
function Stars() {
  return (
    <div className="mb-4 flex gap-0.5 text-amber-400" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 1.5 12.5 7l6 .5-4.5 4 1.4 5.9L10 14.3 4.6 17.4 6 11.5 1.5 7.5l6-.5L10 1.5Z" />
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

  return <div className="text-5xl font-extrabold tracking-tight text-slate-900">{text}</div>;
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
    <div className="core-root min-h-screen text-slate-600">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* ============ URGENCY BANNER ============ */}
      <div ref={bannerRef} className="relative z-40 bg-amber-500 py-2 text-center text-xs font-semibold text-slate-950">
        Early Architect Program — First 100 architects get lifetime free access. <span className="font-bold">37 spots remaining.</span>
      </div>

      {/* ============ NAVBAR ============ */}
      <header
        id="navbar"
        style={{ top: navTop }}
        className={`fixed inset-x-0 z-50 border-b backdrop-blur-md transition ${navScrolled ? "border-gray-200 bg-white/90 shadow-[0_1px_3px_0_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.06)]" : "border-transparent"
          }`}
      >
        <nav className="mx-auto flex w-full max-w-none items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex items-center gap-2.5" aria-label="CORE home">
            <svg className="h-7 w-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <circle cx="14" cy="14" r="11" stroke="#f59e0b" strokeWidth={2} />
              <circle cx="14" cy="14" r="4" fill="#fbbf24" />
            </svg>
            <span className="text-xl font-extrabold tracking-tight text-amber-500">CORE</span>
          </a>

          <div className="hidden min-w-0 flex-1 items-center justify-center gap-4 md:flex lg:gap-7 xl:gap-8">
            <a href="#architects" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              For Architects
            </a>

            <a href="#businesses" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              For Businesses
            </a>

            <Link href="/marketplace" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              Marketplace
            </Link>

            <a href="#assessment" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              Pricing
            </a>

            <a href="#footer" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              Docs
            </a>
          </div>

          <div className="hidden shrink-0 items-center gap-2 md:flex lg:gap-3">
            <Link href="/business/login" className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 transition hover:text-slate-900">Login</Link>
            <Link href="/assignment" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-glow-sm transition hover:scale-[1.03] hover:bg-amber-400 hover:shadow-glow">Get Started Free</Link>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="inline-flex items-center justify-center rounded-lg p-2 text-slate-600 transition hover:bg-gray-100 hover:text-slate-900 md:hidden"
            aria-label="Toggle menu"
            aria-controls="mobile-menu"
            aria-expanded={menuOpen}
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
              <path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        </nav>

        {menuOpen && (
          <div id="mobile-menu" className="border-t border-gray-200 bg-white/95 backdrop-blur-md md:hidden">
            <div className="mx-auto flex w-full max-w-none flex-col gap-1 px-4 py-4 sm:px-6 lg:px-8">
              <a
                href="#architects"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
              >
                For Architects
              </a>

              <a
                href="#businesses"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
              >
                For Businesses
              </a>

              <Link
                href="/marketplace"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
              >
                Marketplace
              </Link>

              <a
                href="#assessment"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
              >
                Pricing
              </a>

              <a
                href="#footer"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
              >
                Docs
              </a>

              <div className="mt-3 flex flex-col gap-2 border-t border-gray-200 pt-4">
                <Link href="/business/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:text-slate-900 lg:px-4">
                  Login
                </Link>

                <Link href="/assignment" className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 shadow-glow-sm transition hover:scale-[1.03] hover:bg-amber-400 hover:shadow-glow lg:px-4">
                  Get Started Free
                </Link>
              </div>
            </div>
          </div>
        )}
      </header>

      <main id="top">
        {/* ============ HERO ============ */}
        <section className="relative overflow-hidden px-6 pb-20 pt-36 sm:pt-44">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(60%_55%_at_50%_0%,rgba(245,158,11,0.08),rgba(2,6,23,0)_72%)]" />
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(70%_50%_at_50%_0%,#000,transparent_85%)]" />

          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              The AI Agent Marketplace
            </div>

            <h1 className="text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
              Stop Losing Customers.<br className="hidden sm:block" />
              <span className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 bg-clip-text text-transparent">Start Building AI Agents.</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-slate-600 sm:text-xl">
              <span className="font-semibold text-slate-900">Businesses:</span> your missed calls and slow follow-ups are costing you thousands.{" "}
              <span className="font-semibold text-slate-900">AI Architects:</span> build agents that solve this — and earn 70% of every sale.
            </p>

            <div className="mt-6 flex items-center justify-center gap-2 text-base font-semibold text-amber-600">
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 3v18h18" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                <rect x="6.5" y="14" width="3" height="4" rx="1" fill="currentColor" />
                <rect x="11.5" y="11" width="3" height="7" rx="1" fill="currentColor" />
                <rect x="16.5" y="8" width="3" height="10" rx="1" fill="currentColor" />
              </svg>
              Businesses on CORE recover an average of $4,200/month in lost revenue.
            </div>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/assignment" className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-7 py-3.5 text-base font-semibold text-slate-950 shadow-glow transition hover:scale-[1.03] hover:bg-amber-400 hover:shadow-glow-lg sm:w-auto">
                I&apos;m a Business — Find My Agent
                <ArrowIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link href="/architect/login" className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400 px-7 py-3.5 text-base font-semibold text-amber-600 transition hover:scale-[1.03] hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700 sm:w-auto">
                I&apos;m an Architect — Start Building Free
              </Link>
            </div>

            <p className="mt-6 text-sm text-slate-500">
              Free forever for Architects&nbsp;&nbsp;•&nbsp;&nbsp;3,200+ agents built&nbsp;&nbsp;•&nbsp;&nbsp;Trusted by 500+ businesses
            </p>

            <div className="mx-auto mt-8 max-w-md rounded-xl border border-amber-200 bg-white p-2 shadow-sm">
              {!heroSent ? (
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    setHeroSent(true);
                  }}
                >
                  <label htmlFor="hero-email" className="sr-only">Work email</label>
                  <input id="hero-email" type="email" required placeholder="you@company.com" autoComplete="email" className="w-full rounded-lg border border-amber-200 bg-gray-50 px-4 py-3 text-slate-900 placeholder-slate-500 focus:border-amber-400 focus:outline-none" />
                  <button type="submit" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-amber-400">
                    Get Free Assessment
                    <ArrowIcon />
                  </button>
                </form>
              ) : (
                <p className="px-2 py-3 text-center text-sm font-semibold text-amber-600">Check your inbox! Your assessment link is on the way.</p>
              )}
              <p className="mt-1 px-2 text-center text-xs text-slate-500">No credit card required • Unsubscribe anytime</p>
            </div>
          </div>

          {/* workflow node showcase */}
          <div className="relative mx-auto mt-16 max-w-4xl animate-float">
            <div className="absolute -inset-x-10 -inset-y-6 -z-10 rounded-[2rem] bg-[radial-gradient(50%_60%_at_50%_50%,rgba(245,158,11,0.07),transparent_70%)]" />
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-glow backdrop-blur-sm sm:p-10">
              <div className="mb-8 flex items-center gap-2 border-b border-gray-200 pb-4">
                <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                <span className="ml-3 font-mono text-xs text-slate-500">missed-call-recovery.agent</span>
              </div>

              <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center md:gap-0">
                <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-white px-6 py-5 text-center shadow-sm backdrop-blur md:min-w-[148px]">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-300">
                    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.75 13.5 14.25 2.25 12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" /></svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Trigger</div>
                    <div className="text-xs text-slate-500">Missed call</div>
                  </div>
                </div>

                <div className="flex items-center justify-center md:flex-1">
                  <div className="hidden h-px w-full bg-gradient-to-r from-transparent via-amber-500/70 to-transparent bg-[length:200%_100%] animate-flow md:block" />
                  <div className="h-7 w-px bg-gradient-to-b from-amber-500/60 to-amber-500/20 md:hidden" />
                </div>

                <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-400 bg-white px-7 py-6 text-center shadow-sm shadow-glow backdrop-blur md:min-w-[160px]">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-amber-500 text-slate-950 shadow-glow animate-pulse-ring">
                    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.75 14.1 8.4 21 9.3l-5.1 4.1L17.5 21 12 17.2 6.5 21l1.6-7.6L3 9.3l6.9-.9L12 1.75Z" /></svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">AI Brain</div>
                    <div className="text-xs text-amber-600/90">Decides &amp; acts</div>
                  </div>
                </div>

                <div className="flex items-center justify-center md:flex-1">
                  <div className="hidden h-px w-full bg-gradient-to-r from-transparent via-amber-500/70 to-transparent bg-[length:200%_100%] animate-flow md:block" />
                  <div className="h-7 w-px bg-gradient-to-b from-amber-500/60 to-amber-500/20 md:hidden" />
                </div>

                <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-white px-6 py-5 text-center shadow-sm backdrop-blur md:min-w-[148px]">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-300">
                    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Action</div>
                    <div className="text-xs text-slate-500">Instant follow-up</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ PRODUCT DEMO VISUAL ============ */}
        <section className="px-6">
          <div className="relative mx-auto mt-16 max-w-4xl animate-float rounded-2xl border border-gray-200 bg-white p-6 shadow-glow backdrop-blur-sm">
            <div className="pointer-events-none absolute -inset-x-8 -inset-y-6 -z-10 rounded-[2rem] bg-[radial-gradient(50%_60%_at_50%_50%,rgba(245,158,11,0.06),transparent_70%)]" />
            <div className="mb-6 flex items-center gap-2 border-b border-gray-200 pb-4">
              <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
              <span className="ml-3 font-mono text-xs text-slate-500">agent-builder.core</span>
            </div>

            <svg viewBox="0 0 820 340" className="h-auto w-full" role="img" aria-label="Drag-and-drop workflow builder: a missed call triggers the AI Brain, which sends an SMS and books an appointment.">
              <defs>
                <linearGradient id="coreLineGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#f59e0b" stopOpacity="0.25" />
                  <stop offset="0.5" stopColor="#fbbf24" stopOpacity="0.9" />
                  <stop offset="1" stopColor="#f59e0b" stopOpacity="0.25" />
                </linearGradient>
                <filter id="coreNodeGlow" x="-40%" y="-40%" width="180%" height="180%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#f59e0b" floodOpacity="0.5" />
                </filter>
                <filter id="coreDotGlow" x="-200%" y="-200%" width="500%" height="500%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#fbbf24" floodOpacity="0.9" />
                </filter>
              </defs>

              <g fill="none" stroke="url(#coreLineGrad)" strokeWidth={2.5} strokeLinecap="round">
                <path d="M200,170 C250,170 275,170 325,170" />
                <path d="M495,155 C560,155 565,95 620,95" />
                <path d="M495,185 C560,185 565,245 620,245" />
              </g>

              <g transform="translate(30,130)">
                <rect width="170" height="80" rx="14" fill="#ffffff" stroke="#d1d5db" strokeOpacity="1" strokeWidth={1.5} />
                <rect x="16" y="22" width="36" height="36" rx="10" fill="#fffbeb" stroke="#f59e0b" strokeOpacity="0.3" />
                <g transform="translate(24,30) scale(0.8)" fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 5a2 2 0 0 1 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a2 2 0 0 1-2 2A16 16 0 0 1 3 5z" />
                </g>
                <text x="64" y="40" fill="#0f172a" fontFamily="Inter, sans-serif" fontSize="15" fontWeight="600">Missed Call</text>
                <text x="64" y="58" fill="#475569" fontFamily="Inter, sans-serif" fontSize="11">Incoming trigger</text>
              </g>

              <g transform="translate(325,120)">
                <rect width="170" height="100" rx="16" fill="#ffffff" stroke="#f59e0b" strokeOpacity="0.55" strokeWidth={1.5} filter="url(#coreNodeGlow)" />
                <rect x="16" y="32" width="36" height="36" rx="10" fill="#f59e0b" />
                <g transform="translate(22,38)">
                  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="#0f172a" />
                </g>
                <text x="64" y="56" fill="#0f172a" fontFamily="Inter, sans-serif" fontSize="15" fontWeight="600">AI Brain</text>
                <text x="64" y="74" fill="#d97706" fontFamily="Inter, sans-serif" fontSize="11">Decides next step</text>
              </g>

              <g transform="translate(620,55)">
                <rect width="170" height="80" rx="14" fill="#ffffff" stroke="#d1d5db" strokeOpacity="1" strokeWidth={1.5} />
                <rect x="16" y="22" width="36" height="36" rx="10" fill="#fffbeb" stroke="#f59e0b" strokeOpacity="0.3" />
                <g transform="translate(24,30) scale(0.8)" fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                </g>
                <text x="64" y="40" fill="#0f172a" fontFamily="Inter, sans-serif" fontSize="15" fontWeight="600">Send SMS</text>
                <text x="64" y="58" fill="#475569" fontFamily="Inter, sans-serif" fontSize="11">Twilio · WhatsApp</text>
              </g>

              <g transform="translate(620,205)">
                <rect width="170" height="80" rx="14" fill="#ffffff" stroke="#d1d5db" strokeOpacity="1" strokeWidth={1.5} />
                <rect x="16" y="22" width="36" height="36" rx="10" fill="#fffbeb" stroke="#f59e0b" strokeOpacity="0.3" />
                <g transform="translate(24,30) scale(0.8)" fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
                </g>
                <text x="64" y="40" fill="#0f172a" fontFamily="Inter, sans-serif" fontSize="15" fontWeight="600">Book Appointment</text>
                <text x="64" y="58" fill="#475569" fontFamily="Inter, sans-serif" fontSize="11">Google Calendar</text>
              </g>

              <g filter="url(#coreDotGlow)">
                <circle r="4.5" fill="#fde68a">
                  <animateMotion dur="2.2s" repeatCount="indefinite" path="M200,170 C250,170 275,170 325,170" />
                </circle>
                <circle r="4.5" fill="#fde68a">
                  <animateMotion dur="2.6s" repeatCount="indefinite" path="M495,155 C560,155 565,95 620,95" />
                </circle>
                <circle r="4.5" fill="#fde68a">
                  <animateMotion dur="2.6s" begin="0.6s" repeatCount="indefinite" path="M495,185 C560,185 565,245 620,245" />
                </circle>
              </g>
            </svg>

            <p className="mt-4 text-center text-sm text-slate-500">Build powerful AI agents in minutes — no code required</p>
          </div>
        </section>

        {/* ============ VALUE PROPOSITION ============ */}
        <section id="platform" className="scroll-mt-24 px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">One platform</p>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">One Platform. Two Superpowers.</h2>
              <p className="mt-4 text-lg text-slate-500">Whether you run a business or build the agents that power it, CORE meets you where you are.</p>
            </div>

            <div className="mt-14 grid gap-6 lg:grid-cols-2">
              {/* For Businesses */}
              <div id="businesses" className="group scroll-mt-24 rounded-xl border border-gray-200 bg-white p-8 shadow-sm backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-amber-400 hover:shadow-glow sm:p-10">
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-300">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.75 21h16.5M5.25 21V5.25A1.5 1.5 0 0 1 6.75 3.75h6A1.5 1.5 0 0 1 14.25 5.25V21M14.25 9.75h3.75a1.5 1.5 0 0 1 1.5 1.5V21M8.25 7.5h2.25M8.25 11.25h2.25M8.25 15h2.25" /></svg>
                </div>
                <h3 className="text-xl font-semibold text-slate-900">For Businesses</h3>
                <p className="mt-3 leading-relaxed text-slate-500">Take a 2-minute assessment to discover which AI agent can recover your lost revenue. We measure and improve:</p>
                <ul className="mt-6 space-y-3">
                  <li className="flex items-center gap-3 text-slate-600"><CheckBadge />Lead Capture Speed</li>
                  <li className="flex items-center gap-3 text-slate-600"><CheckBadge />Follow-Up Consistency</li>
                  <li className="flex items-center gap-3 text-slate-600"><CheckBadge />Customer Retention</li>
                </ul>
                <Link href="/assignment" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-amber-600 transition hover:gap-3 hover:text-amber-600">
                  Take the free assessment
                  <ArrowIcon />
                </Link>
              </div>

              {/* For Architects */}
              <div id="architects" className="group scroll-mt-24 rounded-xl border border-gray-200 bg-white p-8 shadow-sm backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-amber-400 hover:shadow-glow sm:p-10">
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-300">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 7.5 12 2.25 3 7.5m18 0-9 5.25m9-5.25v9L12 21.75M3 7.5l9 5.25M3 7.5v9L12 21.75m0-9v9" /></svg>
                </div>
                <h3 className="text-xl font-semibold text-slate-900">For AI Architects</h3>
                <p className="mt-3 leading-relaxed text-slate-500">Build AI agents visually with drag-and-drop. No coding. Publish to the marketplace. Earn 70% recurring revenue from every business that subscribes.</p>
                <ul className="mt-6 space-y-3">
                  <li className="flex items-center gap-3 text-slate-600"><CheckBadge />Visual drag-and-drop builder</li>
                  <li className="flex items-center gap-3 text-slate-600"><CheckBadge />Publish to a global marketplace</li>
                  <li className="flex items-center gap-3 text-slate-600"><CheckBadge />Earn 70% recurring revenue</li>
                </ul>

                <div className="mt-6 rounded-lg border border-amber-200 bg-gray-50 p-5">
                  <div className="text-sm text-slate-500">Agent price: <span className="font-semibold text-slate-600">$99/month</span></div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                    <div className="h-2 w-[70%] rounded-full bg-amber-500" />
                  </div>
                  <div className="mt-3 text-sm font-bold text-amber-600">You earn: $69.30/month</div>
                  <div className="mt-2 text-xs text-slate-500">10 subscribers = $693/month • 50 subscribers = $3,465/month</div>
                </div>

                <Link href="/architect/login" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-amber-600 transition hover:gap-3 hover:text-amber-600">
                  Start building free
                  <ArrowIcon />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ============ HOW IT WORKS ============ */}
        <section id="how" className="scroll-mt-24 px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">The flow</p>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">How CORE Works</h2>
            </div>

            <div className="mt-16">
              <div className="mb-8 flex items-center gap-3">
                <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-600">For Businesses</span>
                <span className="h-px flex-1 bg-gradient-to-r from-amber-500/20 to-transparent" />
              </div>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-0">
                {[
                  ["1", "Take Assessment", "15 quick questions"],
                  ["2", "Get Matched to an Agent", "Personalized in seconds"],
                  ["3", "Agent Works 24/7 For You", "Never miss a lead again"]
                ].map(([n, title, sub], i) => (
                  <div key={n} className="contents">
                    <div className="flex flex-1 items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm backdrop-blur-sm transition hover:border-amber-400 hover:shadow-glow-sm">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950 shadow-glow-sm">{n}</span>
                      <div><div className="font-semibold text-slate-900">{title}</div><div className="text-sm text-slate-500">{sub}</div></div>
                    </div>
                    {i < 2 && (
                      <div className="flex items-center justify-center px-2"><div className="hidden h-px w-8 bg-gradient-to-r from-amber-500/50 to-amber-500/20 md:block" /><div className="h-6 w-px bg-gradient-to-b from-amber-500/50 to-amber-500/20 md:hidden" /></div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-12">
              <div className="mb-8 flex items-center gap-3">
                <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-600">For Architects</span>
                <span className="h-px flex-1 bg-gradient-to-r from-amber-500/20 to-transparent" />
              </div>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-0">
                {[
                  ["1", "Drag & Drop Nodes", "No code required"],
                  ["2", "Connect AI + Connectors", "180+ integrations"],
                  ["3", "Publish & Earn", "70% recurring revenue"]
                ].map(([n, title, sub], i) => (
                  <div key={n} className="contents">
                    <div className="flex flex-1 items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm backdrop-blur-sm transition hover:border-amber-400 hover:shadow-glow-sm">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950 shadow-glow-sm">{n}</span>
                      <div><div className="font-semibold text-slate-900">{title}</div><div className="text-sm text-slate-500">{sub}</div></div>
                    </div>
                    {i < 2 && (
                      <div className="flex items-center justify-center px-2"><div className="hidden h-px w-8 bg-gradient-to-r from-amber-500/50 to-amber-500/20 md:block" /><div className="h-6 w-px bg-gradient-to-b from-amber-500/50 to-amber-500/20 md:hidden" /></div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ CREDIBILITY ============ */}
        <section id="why" className="scroll-mt-24 px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Why now</p>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">Built for the AI Agent Era</h2>
            </div>

            <div className="mx-auto mt-14 grid max-w-5xl grid-cols-2 gap-y-10 gap-x-6 border-y border-gray-200 py-12 md:grid-cols-4">
              {[
                ["180+", "Connectors"],
                ["6", "Universal Agent Types"],
                ["10M+", "Addressable Businesses"],
                ["$0", "To Start"]
              ].map(([v, l]) => (
                <div key={l} className="text-center">
                  <div className="text-4xl font-extrabold tracking-tight text-amber-600 sm:text-5xl">{v}</div>
                  <div className="mt-2 text-sm text-slate-500">{l}</div>
                </div>
              ))}
            </div>

            <p className="mx-auto mt-12 max-w-3xl text-pretty text-center text-lg leading-relaxed text-slate-600">
              CORE was built by a team obsessed with one question: what if every business in the world could have an AI employee that never sleeps, never forgets to follow up, and costs less than $5/day? We made it possible.
            </p>

            <div className="mt-14">
              <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Works with the tools you already use</p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
                {["Twilio", "WhatsApp", "Gmail", "Slack", "Stripe", "Google Calendar", "HubSpot", "Shopify"].map((t) => (
                  <span key={t} className="text-lg font-semibold tracking-wide text-slate-500 transition hover:text-slate-600">{t}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ ANIMATED COUNTERS ============ */}
        <section className="scroll-mt-24 bg-gray-50 px-6 py-16 sm:py-20">
          <div ref={counterSectionRef} className="mx-auto grid max-w-5xl grid-cols-1 gap-10 text-center sm:grid-cols-3">
            <div>
              <Counter target={500} suffix="+" active={countersActive} />
              <div className="mt-1 text-sm text-slate-500">Businesses Served</div>
            </div>
            <div>
              <Counter target={2.1} prefix="$" suffix="M+" decimals={1} active={countersActive} />
              <div className="mt-1 text-sm text-slate-500">Revenue Recovered</div>
            </div>
            <div>
              <Counter target={3200} suffix="+" active={countersActive} />
              <div className="mt-1 text-sm text-slate-500">Agents Built</div>
            </div>
          </div>
        </section>

        {/* ============ SOCIAL PROOF ============ */}
        <section id="testimonials" className="scroll-mt-24 px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Social proof</p>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">What People Are Saying</h2>
            </div>

            <div className="mt-14 grid gap-6 md:grid-cols-3">
              {[
                { quote: "“I built a missed-call agent in 20 minutes. It's already earning me $400/month.”", initials: "AR", name: "Alex R.", role: "AI Architect" },
                { quote: "“We were losing 30% of leads to missed calls. CORE's agent recovered $12,000 in the first month.”", initials: "SM", name: "Dr. Sarah M.", role: "Dentist" },
                { quote: "“The simplest platform I've ever used. Drag, drop, publish. That's it.”", initials: "JK", name: "James K.", role: "Freelancer" }
              ].map((t) => (
                <figure key={t.initials} className="flex flex-col rounded-xl border border-gray-200 bg-white p-8 shadow-sm backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-amber-400 hover:shadow-glow">
                  <Stars />
                  <blockquote className="flex-1 text-lg leading-relaxed text-slate-700">{t.quote}</blockquote>
                  <figcaption className="mt-6 flex items-center gap-3 border-t border-gray-200 pt-6">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-600 ring-1 ring-amber-300">{t.initials}</span>
                    <span><span className="block text-sm font-semibold text-slate-900">{t.name}</span><span className="block text-xs text-slate-500">{t.role}</span></span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* ============ CTA ============ */}
        <section id="assessment" className="scroll-mt-24 px-6 py-20 sm:py-28">
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-amber-200 bg-white px-6 py-16 text-center shadow-sm backdrop-blur-sm sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_50%_0%,rgba(245,158,11,0.1),transparent_70%)]" />

            <h2 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">Not Sure Which AI Agent Your Business Needs?</h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">Take our free 2-minute assessment. Answer 15 questions. Get a personalized recommendation instantly.</p>

            <div className="mt-10">
              <Link href="/assignment" className="group inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-9 py-4 text-lg font-semibold text-slate-950 shadow-glow-lg transition hover:scale-[1.03] hover:bg-amber-400">
                Start Free Assessment
                <ArrowIcon className="h-5 w-5 transition group-hover:translate-x-1" />
              </Link>
            </div>

            <p className="mt-6 text-sm text-slate-500">Takes 2 minutes&nbsp;&nbsp;•&nbsp;&nbsp;Completely free&nbsp;&nbsp;•&nbsp;&nbsp;Immediate results</p>

            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <span className="rounded-full border border-amber-200 px-3 py-1 text-xs text-slate-600">🔒 No credit card</span>
              <span className="rounded-full border border-amber-200 px-3 py-1 text-xs text-slate-600">⚡ Instant results</span>
              <span className="rounded-full border border-amber-200 px-3 py-1 text-xs text-slate-600">🎯 Personalized for your business</span>
            </div>
          </div>
        </section>
      </main>

      {/* ============ FOOTER ============ */}
      <footer id="footer" className="scroll-mt-24 border-t border-gray-200 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
            <div className="col-span-2 md:col-span-1">
              <a href="#top" className="flex items-center gap-2.5" aria-label="CORE home">
                <svg className="h-7 w-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                  <circle cx="14" cy="14" r="11" stroke="#f59e0b" strokeWidth={2} />
                  <circle cx="14" cy="14" r="4" fill="#fbbf24" />
                </svg>
                <span className="text-xl font-extrabold tracking-tight text-amber-500">CORE</span>
              </a>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500">The AI agent marketplace where businesses and architects build the future of work together.</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Product</h4>
              <ul className="mt-4 space-y-3 text-sm">
                <li><a href="#platform" className="text-slate-500 transition hover:text-amber-600">Platform</a></li>
                <li><a href="#assessment" className="text-slate-500 transition hover:text-amber-600">Pricing</a></li>
                <li><a href="#" className="text-slate-500 transition hover:text-amber-600">Docs</a></li>
                <li><a href="#" className="text-slate-500 transition hover:text-amber-600">API</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Company</h4>
              <ul className="mt-4 space-y-3 text-sm">
                <li><a href="/about" className="text-slate-500 transition hover:text-amber-600">About</a></li>
                <li><a href="#" className="text-slate-500 transition hover:text-amber-600">Blog</a></li>
                <li><a href="#" className="text-slate-500 transition hover:text-amber-600">Careers</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Legal</h4>
              <ul className="mt-4 space-y-3 text-sm">
                <li><a href="/privacy" className="text-slate-500 transition hover:text-amber-600">Privacy</a></li>
                <li><a href="/terms" className="text-slate-500 transition hover:text-amber-600">Terms</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Connect</h4>
              <ul className="mt-4 space-y-3 text-sm">
                <li><a href="#" className="text-slate-500 transition hover:text-amber-600">Twitter</a></li>
                <li><a href="#" className="text-slate-500 transition hover:text-amber-600">LinkedIn</a></li>
                <li><a href="#" className="text-slate-500 transition hover:text-amber-600">Email</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 border-t border-gray-200 pt-8">
            <p className="text-sm text-slate-500">© 2026 CORE. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* ============ STICKY BOTTOM CTA BAR ============ */}
      <div
        id="sticky-cta"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 px-6 py-3 shadow-lg backdrop-blur-md transition-all duration-300"
        style={{ opacity: stickyShown ? 1 : 0, transform: stickyShown ? "translateY(0)" : "translateY(0.5rem)", pointerEvents: stickyShown ? "auto" : "none" }}
      >
        <div className="mx-auto flex w-full max-w-none items-center justify-between gap-4">
          <p className="text-sm text-slate-600">Ready to recover lost revenue?</p>
          <form
            className="flex items-center gap-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              router.push("/assignment");
            }}
          >
            <label htmlFor="sticky-email" className="sr-only">Work email</label>
            <input id="sticky-email" type="email" placeholder="you@company.com" autoComplete="email" className="hidden w-56 rounded-lg border border-amber-200 bg-gray-50 px-4 py-2 text-sm text-slate-900 placeholder-slate-500 focus:border-amber-400 focus:outline-none sm:block" />
            <button type="submit" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-400">
              Start Free
              <ArrowIcon />
            </button>
          </form>
        </div>
      </div>

      {/* ============ EXIT-INTENT POPUP ============ */}
      {exitOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setExitOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="exit-title" className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl">
            <button type="button" onClick={() => setExitOpen(false)} className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-gray-100 hover:text-slate-900" aria-label="Close">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <h2 id="exit-title" className="pr-8 text-2xl font-bold tracking-tight text-slate-900">Wait — don&apos;t leave empty-handed.</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">Get your free AI agent assessment. Takes 2 minutes. Find out exactly which agent can recover your lost revenue.</p>
            {!exitSent ? (
              <form className="mt-6 flex flex-col gap-3" noValidate onSubmit={(e) => { e.preventDefault(); setExitSent(true); }}>
                <label htmlFor="exit-email" className="sr-only">Work email</label>
                <input id="exit-email" type="email" required placeholder="you@company.com" autoComplete="email" className="w-full rounded-lg border border-amber-200 bg-gray-50 px-4 py-3 text-slate-900 placeholder-slate-500 focus:border-amber-400 focus:outline-none" />
                <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-amber-400">Send My Free Assessment</button>
              </form>
            ) : (
              <p className="mt-4 text-center text-sm font-semibold text-amber-600">Check your inbox! Your assessment link is on the way.</p>
            )}
            <p className="mt-4 text-center text-xs text-slate-500">No spam. Unsubscribe anytime.</p>
          </div>
        </div>
      )}

      {/* ============ LIVE CHAT BUBBLE ============ */}
      <div className="fixed right-6 z-50 flex flex-col items-end gap-3 transition-all duration-300" style={{ bottom: stickyShown ? "5.5rem" : "1.5rem" }}>
        {chatOpen && (
          <div className="relative w-64 rounded-2xl border border-gray-200 bg-white p-4 shadow-lg">
            <button type="button" onClick={() => setChatOpen(false)} className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-slate-500 transition hover:text-slate-900" aria-label="Close chat">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <p className="text-sm text-slate-600">Hi! Need help finding the right AI agent?</p>
            <a href="mailto:hello@usecore.ai" className="mt-2 inline-block text-sm font-semibold text-amber-600 transition hover:text-amber-600">hello@usecore.ai</a>
          </div>
        )}
        <button type="button" onClick={() => setChatOpen((o) => !o)} className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-slate-950 shadow-glow transition hover:scale-110" aria-label="Open chat">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7.5 8.5h9M7.5 12h6M21 11.5a8.5 8.5 0 0 1-12.2 7.7L3 21l1.8-5.8A8.5 8.5 0 1 1 21 11.5z" /></svg>
        </button>
      </div>
    </div>
  );
}
