"use client";

import Link from "next/link";
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

/* ---------- inline icons ---------- */
function IconBolt({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg data-testid="app-assignment-page-svg-1" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path data-testid="app-assignment-page-path-1" d="M3.75 13.5 14.25 2.25 12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
    </svg>
  );
}
function IconMoon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg data-testid="app-assignment-page-svg-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path data-testid="app-assignment-page-path-2" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function IconRepeat({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg data-testid="app-assignment-page-svg-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path data-testid="app-assignment-page-path-3" d="M17 2l4 4-4 4" />
      <path data-testid="app-assignment-page-path-4" d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path data-testid="app-assignment-page-path-5" d="M7 22l-4-4 4-4" />
      <path data-testid="app-assignment-page-path-6" d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
function IconBot({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg data-testid="app-assignment-page-svg-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect data-testid="app-assignment-page-rect-1" x="4" y="8" width="16" height="11" rx="3" />
      <path data-testid="app-assignment-page-path-7" d="M12 8V4M9 4h6" />
      <circle data-testid="app-assignment-page-circle-1" cx="9.5" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
      <circle data-testid="app-assignment-page-circle-2" cx="14.5" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconChart({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg data-testid="app-assignment-page-svg-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path data-testid="app-assignment-page-path-8" d="M3 3v18h18" />
      <path data-testid="app-assignment-page-path-9" d="M7 14l3-3 3 3 5-6" />
    </svg>
  );
}
function IconCheck({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg data-testid="app-assignment-page-svg-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path data-testid="app-assignment-page-path-10" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
function IconArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg data-testid="app-assignment-page-svg-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path data-testid="app-assignment-page-path-11" d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}
function IconBack({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg data-testid="app-assignment-page-svg-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path data-testid="app-assignment-page-path-12" d="M19 12H5m6 6-6-6 6-6" />
    </svg>
  );
}

type IconKey = "bolt" | "moon" | "repeat" | "bot" | "chart";
function CatIcon({ name }: { name: IconKey }) {
  switch (name) {
    case "bolt":
      return <IconBolt />;
    case "moon":
      return <IconMoon />;
    case "repeat":
      return <IconRepeat />;
    case "bot":
      return <IconBot />;
    case "chart":
      return <IconChart />;
  }
}

/* ---------- questions ---------- */
type Choice = { key: string; label: string };
type Question = {
  id: string;
  type: "yesno" | "choice" | "text";
  text: string;
  options?: Choice[];
  optional?: boolean;
  placeholder?: string;
};

const QUESTIONS: Question[] = [
  { id: "q1", type: "yesno", text: "Do you respond to every new lead within 5 minutes?" },
  { id: "q2", type: "yesno", text: "Do you have a system that automatically follows up with leads who don't respond?" },
  { id: "q3", type: "yesno", text: "When you miss a phone call, does the caller receive an instant text message?" },
  { id: "q4", type: "yesno", text: "Do you automatically collect reviews from happy customers?" },
  { id: "q5", type: "yesno", text: "Do you re-engage past customers who haven't visited in 90+ days?" },
  { id: "q6", type: "yesno", text: "Can your business capture leads and book appointments 24/7 — even at 2 AM?" },
  { id: "q7", type: "yesno", text: "Do you have a system that qualifies leads before they reach your team?" },
  { id: "q8", type: "yesno", text: "Are your customer follow-ups personalized based on their specific needs?" },
  { id: "q9", type: "yesno", text: "Do you track exactly how many leads you lose each month and why?" },
  { id: "q10", type: "yesno", text: "Can a new customer go from first contact to booked appointment without any human involvement?" },
  {
    id: "q11",
    type: "choice",
    text: "Which best describes your business right now?",
    options: [
      { key: "A", label: "Just getting started — less than 1 year old" },
      { key: "B", label: "Growing — 1-3 years, building momentum" },
      { key: "C", label: "Established — 3-10 years, looking to scale" },
      { key: "D", label: "Mature — 10+ years, optimizing operations" }
    ]
  },
  {
    id: "q12",
    type: "choice",
    text: "What's your biggest frustration right now?",
    options: [
      { key: "A", label: "Not enough new leads coming in" },
      { key: "B", label: "Leads come in but we lose them — too slow to respond" },
      { key: "C", label: "We get customers but they never come back" },
      { key: "D", label: "We're drowning in manual tasks and can't scale" }
    ]
  },
  {
    id: "q13",
    type: "choice",
    text: "In the next 90 days, what would make the biggest impact?",
    options: [
      { key: "A", label: "Never miss another lead or call" },
      { key: "B", label: "Automate follow-ups so no one falls through the cracks" },
      { key: "C", label: "Get past customers to come back and spend again" },
      { key: "D", label: "Free up 10+ hours per week from repetitive tasks" }
    ]
  },
  {
    id: "q14",
    type: "choice",
    text: "What level of investment feels right for solving this?",
    options: [
      { key: "A", label: "Free tools only — I'm bootstrapping" },
      { key: "B", label: "$50-$150/month — if it clearly pays for itself" },
      { key: "C", label: "$150-$500/month — I want premium results" },
      { key: "D", label: "$500+/month — I need enterprise-grade automation" }
    ]
  },
  { id: "q15", type: "text", optional: true, text: "Anything else we should know about your situation?", placeholder: "Tell us about your specific challenges..." }
];

const CIRC = 534.07; // 2 * PI * 85
const KEY = "coreAssessment";
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Contact = { name: string; email: string; phone: string; business: string };
type Insight = { icon: IconKey; gap: boolean; title: string; desc: string };
type Tier = { color: string; cls: string; label: string };
type Results = { score: number; tier: Tier; insights: Insight[]; rec: [string, string]; cta: [string, string] };

const BUSINESS_TYPES = [
  "Dental Practice", "HVAC", "Real Estate", "Law Firm", "Med Spa", "Gym & Fitness",
  "Restaurant", "Auto Repair", "E-commerce", "Coaching", "Insurance", "Salon & Beauty", "Other"
];

export default function AssignmentPage() {
  const [screen, setScreen] = useState<"intro" | "questions" | "results">("intro");
  const [contact, setContact] = useState<Contact>({ name: "", email: "", phone: "", business: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState(0);
  const [errName, setErrName] = useState(false);
  const [errEmail, setErrEmail] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  const restored = useRef(false);

  /* navbar scroll state */
  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* restore */
  useEffect(() => {
    try {
      const s = sessionStorage.getItem(KEY);
      if (s) {
        const p = JSON.parse(s);
        if (p && typeof p === "object") {
          if (p.contact) setContact(p.contact);
          if (p.answers) setAnswers(p.answers);
          let cur = typeof p.current === "number" ? p.current : 0;
          if (cur < 0 || cur >= QUESTIONS.length) cur = 0;
          setCurrent(cur);
          if (p.screen === "questions" || p.screen === "results") setScreen(p.screen);
        }
      }
    } catch {
      /* ignore */
    }
    restored.current = true;
  }, []);

  /* persist */
  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ contact, answers, current, screen }));
    } catch {
      /* ignore */
    }
  }, [contact, answers, current, screen]);

  /* scroll to top on screen change */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [screen]);

  const handleIntroSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const nameOk = contact.name.trim().length > 0;
    const emailOk = emailRe.test(contact.email.trim());
    setErrName(!nameOk);
    setErrEmail(!emailOk);
    if (!nameOk || !emailOk) return;
    setCurrent(0);
    setScreen("questions");
  };

  const advance = (dir: number, fromIndex: number) => {
    const next = fromIndex + dir;
    if (next < 0) {
      setScreen("intro");
      return;
    }
    if (next >= QUESTIONS.length) {
      setScreen("results");
      return;
    }
    setCurrent(next);
  };

  const selectOption = (q: Question, value: string) => {
    setAnswers((prev) => ({ ...prev, [q.id]: value }));
    const idx = current;
    window.setTimeout(() => advance(1, idx), 400);
  };

  const retake = () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setContact({ name: "", email: "", phone: "", business: "" });
    setAnswers({});
    setCurrent(0);
    setErrName(false);
    setErrEmail(false);
    setScreen("intro");
  };

  /* ---------- results computation ---------- */
  const compute = (): Results => {
    const a = answers;
    const ids = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10"];
    let score = 0;
    ids.forEach((id) => {
      if (a[id] === "Yes") score++;
    });

    let tier: Tier;
    if (score <= 3) tier = { color: "#f87171", cls: "text-red-600", label: "Critical — You're losing significant revenue every day" };
    else if (score <= 6) tier = { color: "#fbbf24", cls: "text-amber-600", label: "Needs Work — There's major room for improvement" };
    else tier = { color: "#34d399", cls: "text-emerald-600", label: "Good Foundation — Let's optimize and scale" };

    const isNo = (id: string) => a[id] === "No";
    const cats: { qs: string[]; icon: IconKey; g: [string, string]; s: [string, string] }[] = [
      { qs: ["q1", "q2"], icon: "bolt", g: ["Lead Response Gap", "You're likely losing 30-50% of leads due to slow response times."], s: ["Fast Lead Response", "You reply quickly — that speed wins deals slower competitors lose."] },
      { qs: ["q3", "q6"], icon: "moon", g: ["After-Hours Blind Spot", "Customers reaching out outside business hours are going to competitors."], s: ["Always-On Coverage", "You're capturing interest around the clock, even after hours."] },
      { qs: ["q4", "q5"], icon: "repeat", g: ["Retention Leak", "Past customers aren't being re-engaged — that's leaving money on the table."], s: ["Strong Retention Loop", "You bring customers back instead of only chasing new ones."] },
      { qs: ["q7", "q10"], icon: "bot", g: ["Manual Bottleneck", "Your team is spending hours on tasks an AI agent could handle in seconds."], s: ["Lean Operations", "You've automated the busywork that bogs most teams down."] },
      { qs: ["q8", "q9"], icon: "chart", g: ["No Visibility", "Without tracking and personalization, you're flying blind."], s: ["Data-Driven", "You track and personalize — a genuine competitive edge."] }
    ];
    const gaps: Insight[] = [];
    const strengths: Insight[] = [];
    cats.forEach((c) => {
      const gap = c.qs.some(isNo);
      (gap ? gaps : strengths).push({ icon: c.icon, gap, title: gap ? c.g[0] : c.s[0], desc: gap ? c.g[1] : c.s[1] });
    });
    const insights = gaps.concat(strengths).slice(0, 3);

    const recMap: Record<string, [string, string]> = {
      A: ["Lead Acquisition Agent", "Automatically finds and reaches new prospects for your business."],
      B: ["Missed Call Recovery Agent", "Instantly texts back missed callers and books them before they go to a competitor."],
      C: ["Customer Retention Agent", "Re-engages past customers with personalized offers and reminders."],
      D: ["Full Automation Suite", "Handles capture, follow-up, booking, and retention end-to-end."]
    };
    const rec = recMap[a.q12] || recMap.B;

    let cta: [string, string];
    if (a.q14 === "C" || a.q14 === "D") cta = ["Book a 1-on-1 Strategy Call", "Our team will build a custom AI agent for your exact needs. 15-minute call. No obligation."];
    else if (a.q14 === "B") cta = ["Join Our Next Live Demo", "See CORE in action with other business owners. Free. 30 minutes."];
    else cta = ["Watch the Free Training", "Learn how businesses like yours are using AI agents to recover lost revenue."];

    return { score, tier, insights, rec, cta };
  };

  const firstName = () => {
    const n = (contact.name || "").trim();
    return n ? n.split(/\s+/)[0] : "there";
  };

  /* results state + animated ring */
  const [results, setResults] = useState<Results | null>(null);
  const [displayScore, setDisplayScore] = useState(0);
  const [ringOffset, setRingOffset] = useState(CIRC);

  useEffect(() => {
    if (screen !== "results") return;
    const r = compute();
    setResults(r);
    setDisplayScore(0);
    setRingOffset(CIRC);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const startDelay = window.setTimeout(() => {
      if (reduce) {
        setDisplayScore(r.score);
        setRingOffset(CIRC * (1 - r.score / 10));
        return;
      }
      const dur = 1400;
      let start: number | null = null;
      const step = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min((ts - start) / dur, 1);
        const e = 1 - Math.pow(1 - p, 3);
        setDisplayScore(Math.round(r.score * e));
        setRingOffset(CIRC * (1 - (r.score * e) / 10));
        if (p < 1) raf = requestAnimationFrame(step);
        else {
          setDisplayScore(r.score);
          setRingOffset(CIRC * (1 - r.score / 10));
        }
      };
      raf = requestAnimationFrame(step);
    }, 500);
    return () => {
      window.clearTimeout(startDelay);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const q = QUESTIONS[current];
  const progressPct = Math.round(((current + 1) / QUESTIONS.length) * 100);

  return (
    <div data-testid="app-assignment-page-div-1" className="core-root min-h-screen text-slate-600">
      <style data-testid="app-assignment-page-style-1" dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* ambient backdrop */}
      <div data-testid="app-assignment-page-div-2" className="pointer-events-none fixed inset-0 -z-10">
        <div data-testid="app-assignment-page-div-3" className="absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(60%_55%_at_50%_0%,rgba(245,158,11,0.08),rgba(2,6,23,0)_72%)]" />
        <div data-testid="app-assignment-page-div-4" className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(70%_50%_at_50%_0%,#000,transparent_85%)]" />
      </div>

      {/* navbar */}
      <header data-testid="app-assignment-page-header-1"
        id="navbar"
        className={`fixed inset-x-0 top-0 z-50 border-b backdrop-blur-md transition ${
          navScrolled ? "border-gray-200 bg-white/90 shadow-[0_1px_3px_0_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.06)]" : "border-transparent"
        }`}
      >
        <nav data-testid="app-assignment-page-nav-1" className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link data-testid="app-assignment-page-link-1" href="/" className="flex items-center gap-2.5" aria-label="CORE home">
            <svg data-testid="app-assignment-page-svg-9" className="h-7 w-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <circle data-testid="app-assignment-page-circle-3" cx="14" cy="14" r="11" stroke="#f59e0b" strokeWidth={2} />
              <circle data-testid="app-assignment-page-circle-4" cx="14" cy="14" r="4" fill="#fbbf24" />
            </svg>
            <span data-testid="app-assignment-page-span-1" className="text-xl font-extrabold tracking-tight text-amber-500">CORE</span>
          </Link>
          <Link data-testid="app-assignment-page-link-2" href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900">
            <IconBack />
            Back to Home
          </Link>
        </nav>
      </header>

      <main data-testid="app-assignment-page-main-1" className="relative">
        {/* ============ SCREEN 1 — INTRO ============ */}
        {screen === "intro" && (
          <section data-testid="app-assignment-page-section-1" className="screen animate-fade-up px-6 pb-24 pt-32">
            <div data-testid="app-assignment-page-div-5" className="mx-auto max-w-2xl text-center">
              <div data-testid="app-assignment-page-div-6" className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">
                <span data-testid="app-assignment-page-span-2" className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Free 2-minute assessment
              </div>
              <h1 data-testid="app-assignment-page-h1-1" className="text-balance text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl">Your AI Agent Readiness Assessment</h1>
              <p data-testid="app-assignment-page-p-1" className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-slate-600">Answer 15 quick questions to discover which AI agent can recover your lost revenue. Takes less than 2 minutes.</p>

              <div data-testid="app-assignment-page-div-7" className="mt-6 flex flex-wrap justify-center gap-3">
                <span data-testid="app-assignment-page-span-3" className="rounded-full border border-amber-200 px-3 py-1 text-xs text-slate-600">📊 Get your score</span>
                <span data-testid="app-assignment-page-span-4" className="rounded-full border border-amber-200 px-3 py-1 text-xs text-slate-600">🎯 Personalized recommendation</span>
                <span data-testid="app-assignment-page-span-5" className="rounded-full border border-amber-200 px-3 py-1 text-xs text-slate-600">⚡ Instant results</span>
              </div>
            </div>

            <form data-testid="app-assignment-page-form-1" onSubmit={handleIntroSubmit} className="mx-auto mt-10 max-w-xl space-y-4 rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm backdrop-blur-sm sm:p-8" noValidate>
              <div data-testid="app-assignment-page-div-8">
                <label data-testid="app-assignment-page-label-1" htmlFor="f-name" className="mb-1.5 block text-sm font-medium text-slate-600">Full name</label>
                <input data-testid="app-assignment-page-input-1"
                  id="f-name"
                  name="name"
                  type="text"
                  required
                  placeholder="Jane Doe"
                  autoComplete="name"
                  value={contact.name}
                  onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
                  className={`w-full rounded-lg border bg-gray-50 px-4 py-3 text-slate-900 placeholder-slate-500 transition focus:border-amber-400 focus:outline-none ${errName ? "border-red-500" : "border-gray-300"}`}
                />
                {errName && <p data-testid="app-assignment-page-p-2" className="mt-1.5 text-xs text-red-600">Please enter your name.</p>}
              </div>
              <div data-testid="app-assignment-page-div-9">
                <label data-testid="app-assignment-page-label-2" htmlFor="f-email" className="mb-1.5 block text-sm font-medium text-slate-600">Work email</label>
                <input data-testid="app-assignment-page-input-2"
                  id="f-email"
                  name="email"
                  type="email"
                  required
                  placeholder="you@company.com"
                  autoComplete="email"
                  value={contact.email}
                  onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                  className={`w-full rounded-lg border bg-gray-50 px-4 py-3 text-slate-900 placeholder-slate-500 transition focus:border-amber-400 focus:outline-none ${errEmail ? "border-red-500" : "border-gray-300"}`}
                />
                {errEmail && <p data-testid="app-assignment-page-p-3" className="mt-1.5 text-xs text-red-600">Please enter a valid email address.</p>}
              </div>
              <div data-testid="app-assignment-page-div-10">
                <label data-testid="app-assignment-page-label-3" htmlFor="f-phone" className="mb-1.5 block text-sm font-medium text-slate-600">
                  Phone number <span data-testid="app-assignment-page-span-6" className="font-normal text-slate-500">— Optional, for SMS results</span>
                </label>
                <input data-testid="app-assignment-page-input-3"
                  id="f-phone"
                  name="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  autoComplete="tel"
                  value={contact.phone}
                  onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-slate-900 placeholder-slate-500 transition focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div data-testid="app-assignment-page-div-11">
                <label data-testid="app-assignment-page-label-4" htmlFor="f-biz" className="mb-1.5 block text-sm font-medium text-slate-600">Business type</label>
                <select data-testid="app-assignment-page-select-1"
                  id="f-biz"
                  name="business"
                  value={contact.business}
                  onChange={(e) => setContact((c) => ({ ...c, business: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-slate-900 transition focus:border-amber-400 focus:outline-none"
                >
                  <option data-testid="app-assignment-page-option-1" value="">Select your business type</option>
                  {BUSINESS_TYPES.map((b) => (
                    <option data-testid="app-assignment-page-option-2" key={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div data-testid="app-assignment-page-div-12" className="pt-2">
                <button data-testid="app-assignment-page-button-1" type="submit" className="inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 py-3.5 text-base font-semibold text-slate-950 shadow-glow transition hover:scale-[1.02] hover:bg-amber-400">
                  Start My Assessment
                  <IconArrow />
                </button>
                <p data-testid="app-assignment-page-p-4" className="mt-3 text-xs text-slate-500">🔒 Your information is private and never shared.</p>
              </div>
            </form>
          </section>
        )}

        {/* ============ SCREEN 2 — QUESTION FLOW ============ */}
        {screen === "questions" && (
          <section data-testid="app-assignment-page-section-2" className="screen animate-fade-up px-6 pb-24 pt-32">
            <div data-testid="app-assignment-page-div-13" className="mx-auto max-w-2xl">
              <div data-testid="app-assignment-page-div-14" className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div data-testid="app-assignment-page-div-15" className="h-1.5 rounded-full bg-amber-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
              <p data-testid="app-assignment-page-p-5" className="mt-2 text-xs text-slate-500">Question {current + 1} of {QUESTIONS.length}</p>

              <div data-testid="app-assignment-page-div-16" key={q.id} className="mt-6 animate-fade-up">
                <div data-testid="app-assignment-page-div-17" className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm backdrop-blur-sm sm:p-8">
                  <button data-testid="app-assignment-page-button-2" type="button" onClick={() => advance(-1, current)} className="mb-5 inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-slate-900">
                    <IconBack />
                    {current === 0 ? "Back to start" : "Back"}
                  </button>
                  <h2 data-testid="app-assignment-page-h2-1" className="text-xl font-semibold leading-snug text-slate-900 sm:text-2xl">{q.text}</h2>

                  {q.type === "text" ? (
                    <TextQuestion
                      key={q.id}
                      placeholder={q.placeholder || ""}
                      initial={answers[q.id] || ""}
                      onFinish={(val) => {
                        setAnswers((prev) => ({ ...prev, [q.id]: val }));
                        setScreen("results");
                      }}
                    />
                  ) : (
                    <div data-testid="app-assignment-page-div-18" className="mt-6 grid gap-3">
                      {q.type === "yesno"
                        ? ["Yes", "No"].map((v) => {
                            const sel = answers[q.id] === v;
                            return (
                              <button data-testid="app-assignment-page-button-3"
                                key={v}
                                type="button"
                                onClick={() => selectOption(q, v)}
                                className={`opt flex cursor-pointer items-center justify-between rounded-lg border p-4 text-left text-slate-700 transition hover:border-amber-400 hover:bg-amber-50 ${sel ? "border-amber-500 bg-amber-50" : "border-gray-300 bg-white"}`}
                              >
                                <span data-testid="app-assignment-page-span-7" className="font-medium">{v}</span>
                                <span data-testid="app-assignment-page-span-8" className={`text-amber-600 ${sel ? "" : "opacity-0"}`}>
                                  <IconCheck />
                                </span>
                              </button>
                            );
                          })
                        : (q.options || []).map((o) => {
                            const sel = answers[q.id] === o.key;
                            return (
                              <button data-testid="app-assignment-page-button-4"
                                key={o.key}
                                type="button"
                                onClick={() => selectOption(q, o.key)}
                                className={`opt flex cursor-pointer items-center gap-3 rounded-lg border p-4 text-left text-slate-700 transition hover:border-amber-400 hover:bg-amber-50 ${sel ? "border-amber-500 bg-amber-50" : "border-gray-300 bg-white"}`}
                              >
                                <span data-testid="app-assignment-page-span-9" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-amber-300 bg-amber-50 text-xs font-bold text-amber-600">{o.key}</span>
                                <span data-testid="app-assignment-page-span-10" className="flex-1">{o.label}</span>
                                <span data-testid="app-assignment-page-span-11" className={`text-amber-600 ${sel ? "" : "opacity-0"}`}>
                                  <IconCheck />
                                </span>
                              </button>
                            );
                          })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ============ SCREEN 3 — RESULTS ============ */}
        {screen === "results" && results && (
          <section data-testid="app-assignment-page-section-3" className="screen animate-fade-up px-6 pb-24 pt-32">
            <div data-testid="app-assignment-page-div-19" className="mx-auto max-w-4xl">
              <div data-testid="app-assignment-page-div-20" className="text-center">
                <p data-testid="app-assignment-page-p-6" className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Your assessment results</p>
                <h1 data-testid="app-assignment-page-h1-2" className="text-balance text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{firstName()}, here&apos;s where your business stands</h1>
              </div>

              <div data-testid="app-assignment-page-div-21" className="mt-10 flex flex-col items-center">
                <div data-testid="app-assignment-page-div-22" className="relative h-52 w-52">
                  <svg data-testid="app-assignment-page-svg-10" viewBox="0 0 200 200" className="h-full w-full -rotate-90">
                    <circle data-testid="app-assignment-page-circle-5" cx="100" cy="100" r="85" fill="none" stroke="#e5e7eb" strokeWidth={14} />
                    <circle data-testid="app-assignment-page-circle-6" cx="100" cy="100" r="85" fill="none" stroke={results.tier.color} strokeWidth={14} strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={ringOffset} />
                  </svg>
                  <div data-testid="app-assignment-page-div-23" className="absolute inset-0 flex flex-col items-center justify-center">
                    <div data-testid="app-assignment-page-div-24" className="flex items-end gap-1">
                      <span data-testid="app-assignment-page-span-12" className={`text-6xl font-extrabold ${results.tier.cls}`}>{displayScore}</span>
                      <span data-testid="app-assignment-page-span-13" className="mb-2 text-xl font-semibold text-slate-500">/ 10</span>
                    </div>
                    <span data-testid="app-assignment-page-span-14" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Readiness</span>
                  </div>
                </div>
                <p data-testid="app-assignment-page-p-7" className={`mt-6 max-w-md text-center text-lg font-semibold ${results.tier.cls}`}>{results.tier.label}</p>
              </div>

              <div data-testid="app-assignment-page-div-25" className="mt-12">
                <h2 data-testid="app-assignment-page-h2-2" className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">What we found</h2>
                <div data-testid="app-assignment-page-div-26" className="mt-6 grid gap-4 sm:grid-cols-3">
                  {results.insights.map((i, idx) => (
                    <div data-testid="app-assignment-page-div-27" key={idx} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm backdrop-blur-sm">
                      <div data-testid="app-assignment-page-div-28" className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${i.gap ? "bg-red-50 text-red-600 ring-1 ring-red-200" : "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200"}`}>
                        <CatIcon name={i.icon} />
                      </div>
                      <h3 data-testid="app-assignment-page-h3-1" className="font-semibold text-slate-900">{i.title}</h3>
                      <p data-testid="app-assignment-page-p-8" className="mt-1 text-sm leading-relaxed text-slate-500">{i.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div data-testid="app-assignment-page-div-29" className="mt-10 rounded-xl border border-amber-400 bg-amber-50 p-8 shadow-glow">
                <p data-testid="app-assignment-page-p-9" className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Recommended for you</p>
                <h3 data-testid="app-assignment-page-h3-2" className="mt-2 text-2xl font-bold text-slate-900">{results.rec[0]}</h3>
                <p data-testid="app-assignment-page-p-10" className="mt-2 leading-relaxed text-slate-600">{results.rec[1]}</p>
              </div>

              <div data-testid="app-assignment-page-div-30" className="mt-10 text-center">
                <a data-testid="app-assignment-page-a-1" href="#" className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-8 py-4 text-lg font-semibold text-slate-950 shadow-glow-lg transition hover:scale-[1.03] hover:bg-amber-400">
                  {results.cta[0]}
                  <IconArrow />
                </a>
                <p data-testid="app-assignment-page-p-11" className="mx-auto mt-4 max-w-md leading-relaxed text-slate-500">{results.cta[1]}</p>
                <p data-testid="app-assignment-page-p-12" className="mt-6 text-sm text-slate-500">
                  Your full report has been sent to <span data-testid="app-assignment-page-span-15" className="font-medium text-slate-600">{contact.email || "your inbox"}</span>. Check your inbox.
                </p>
                <button data-testid="app-assignment-page-button-5" type="button" onClick={retake} className="mt-8 text-xs text-slate-500 underline-offset-4 transition hover:text-slate-600 hover:underline">Retake the assessment</button>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ============ FOOTER ============ */}
      <footer data-testid="app-assignment-page-footer-1" className="border-t border-gray-200 bg-gray-50 px-6 py-16">
        <div data-testid="app-assignment-page-div-31" className="mx-auto max-w-7xl">
          <div data-testid="app-assignment-page-div-32" className="grid grid-cols-2 gap-10 md:grid-cols-5">
            <div data-testid="app-assignment-page-div-33" className="col-span-2 md:col-span-1">
              <Link data-testid="app-assignment-page-link-3" href="/" className="flex items-center gap-2.5" aria-label="CORE home">
                <svg data-testid="app-assignment-page-svg-11" className="h-7 w-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                  <circle data-testid="app-assignment-page-circle-7" cx="14" cy="14" r="11" stroke="#f59e0b" strokeWidth={2} />
                  <circle data-testid="app-assignment-page-circle-8" cx="14" cy="14" r="4" fill="#fbbf24" />
                </svg>
                <span data-testid="app-assignment-page-span-16" className="text-xl font-extrabold tracking-tight text-amber-500">CORE</span>
              </Link>
              <p data-testid="app-assignment-page-p-13" className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500">The AI agent marketplace where businesses and architects build the future of work together.</p>
            </div>
            <div data-testid="app-assignment-page-div-34">
              <h4 data-testid="app-assignment-page-h4-1" className="text-sm font-semibold text-slate-900">Product</h4>
              <ul data-testid="app-assignment-page-ul-1" className="mt-4 space-y-3 text-sm">
                <li data-testid="app-assignment-page-li-1"><Link data-testid="app-assignment-page-link-4" href="/#platform" className="text-slate-500 transition hover:text-amber-600">Platform</Link></li>
                <li data-testid="app-assignment-page-li-2"><Link data-testid="app-assignment-page-link-5" href="/#assessment" className="text-slate-500 transition hover:text-amber-600">Pricing</Link></li>
                <li data-testid="app-assignment-page-li-3"><a data-testid="app-assignment-page-a-2" href="#" className="text-slate-500 transition hover:text-amber-600">Docs</a></li>
                <li data-testid="app-assignment-page-li-4"><a data-testid="app-assignment-page-a-3" href="#" className="text-slate-500 transition hover:text-amber-600">API</a></li>
              </ul>
            </div>
            <div data-testid="app-assignment-page-div-35">
              <h4 data-testid="app-assignment-page-h4-2" className="text-sm font-semibold text-slate-900">Company</h4>
              <ul data-testid="app-assignment-page-ul-2" className="mt-4 space-y-3 text-sm">
                <li data-testid="app-assignment-page-li-5"><a data-testid="app-assignment-page-a-4" href="#" className="text-slate-500 transition hover:text-amber-600">About</a></li>
                <li data-testid="app-assignment-page-li-6"><a data-testid="app-assignment-page-a-5" href="#" className="text-slate-500 transition hover:text-amber-600">Blog</a></li>
                <li data-testid="app-assignment-page-li-7"><a data-testid="app-assignment-page-a-6" href="#" className="text-slate-500 transition hover:text-amber-600">Careers</a></li>
              </ul>
            </div>
            <div data-testid="app-assignment-page-div-36">
              <h4 data-testid="app-assignment-page-h4-3" className="text-sm font-semibold text-slate-900">Legal</h4>
              <ul data-testid="app-assignment-page-ul-3" className="mt-4 space-y-3 text-sm">
                <li data-testid="app-assignment-page-li-8"><a data-testid="app-assignment-page-a-7" href="#" className="text-slate-500 transition hover:text-amber-600">Privacy</a></li>
                <li data-testid="app-assignment-page-li-9"><a data-testid="app-assignment-page-a-8" href="#" className="text-slate-500 transition hover:text-amber-600">Terms</a></li>
              </ul>
            </div>
            <div data-testid="app-assignment-page-div-37">
              <h4 data-testid="app-assignment-page-h4-4" className="text-sm font-semibold text-slate-900">Connect</h4>
              <ul data-testid="app-assignment-page-ul-4" className="mt-4 space-y-3 text-sm">
                <li data-testid="app-assignment-page-li-10"><a data-testid="app-assignment-page-a-9" href="#" className="text-slate-500 transition hover:text-amber-600">Twitter</a></li>
                <li data-testid="app-assignment-page-li-11"><a data-testid="app-assignment-page-a-10" href="#" className="text-slate-500 transition hover:text-amber-600">LinkedIn</a></li>
                <li data-testid="app-assignment-page-li-12"><a data-testid="app-assignment-page-a-11" href="#" className="text-slate-500 transition hover:text-amber-600">Email</a></li>
              </ul>
            </div>
          </div>
          <div data-testid="app-assignment-page-div-38" className="mt-12 border-t border-gray-200 pt-8">
            <p data-testid="app-assignment-page-p-14" className="text-sm text-slate-500">© 2026 CORE. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function TextQuestion({ placeholder, initial, onFinish }: { placeholder: string; initial: string; onFinish: (val: string) => void }) {
  const [val, setVal] = useState(initial);
  return (
    <>
      <textarea data-testid="app-assignment-page-textarea-1"
        rows={4}
        placeholder={placeholder}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="mt-6 w-full rounded-lg border border-gray-300 bg-white p-4 text-slate-900 placeholder-slate-500 transition focus:border-amber-400 focus:outline-none"
      />
      <button data-testid="app-assignment-page-button-6"
        type="button"
        onClick={() => onFinish(val.trim())}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 py-3 font-semibold text-slate-950 shadow-glow transition hover:bg-amber-400 sm:w-auto"
      >
        See My Results
        <IconArrow />
      </button>
    </>
  );
}
