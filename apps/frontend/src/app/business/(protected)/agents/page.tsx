"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  BUSINESS_MARKETPLACE_PATH,
  FOOTER_HASH_PATH,
  HOME_PATH
} from "@/lib/routes";

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

.agent-detail-root {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background-color: #ffffff;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.agent-detail-root ::selection {
  background: rgba(245,158,11,0.2);
  color: #0f172a;
}

.agent-detail-root :focus-visible {
  outline: 2px solid #fbbf24;
  outline-offset: 2px;
  border-radius: 4px;
}

.shadow-glow-sm {
  box-shadow: 0 0 24px -6px rgba(245,158,11,0.2);
}

.shadow-glow {
  box-shadow: 0 0 48px -8px rgba(245,158,11,0.25);
}

.shadow-glow-lg {
  box-shadow: 0 0 90px -10px rgba(245,158,11,0.3);
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}

.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
}

.animate-float {
  animation: float 7s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .animate-float {
    animation: none !important;
  }

  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
`;

const features = [
  "Instant text-back within 5 seconds of a missed call",
  "Personalized messages with your business name and context",
  "Smart conversation handling — books appointments and answers FAQs",
  "Works with any US phone number via Twilio",
  "Google Calendar integration for real-time availability",
  "Custom response templates you can edit anytime",
  "Multi-location support — one agent per location",
  "Real-time dashboard with full conversation logs",
  "Escalation to a human when the agent can't handle a request",
  "HIPAA-compliant for healthcare businesses"
];

const includedItems = [
  "Unlimited missed call text-backs",
  "Unlimited text conversations",
  "Smart appointment booking",
  "Custom message templates",
  "Real-time analytics dashboard",
  "Google Calendar sync",
  "Business hours configuration",
  "Escalation to human fallback"
];

const excludedItems = [
  "Outbound cold calling — available in the “Acquire” agent",
  "Email follow-up sequences — available in the “Follow Up” agent"
];

const reviews = [
  {
    initials: "SM",
    name: "Dr. Sarah Mitchell",
    company: "Mitchell Family Dentistry",
    quote:
      "“We were missing 15-20 calls a week. Within the first month, this agent recovered 11 patients who would have gone to competitors. Paid for itself 10x over.”"
  },
  {
    initials: "JR",
    name: "James Rodriguez",
    company: "Rodriguez HVAC",
    quote:
      "“The speed is insane. The customer gets a text before they even put their phone down. Our booking rate went up 40%.”"
  },
  {
    initials: "AC",
    name: "Amanda Chen",
    company: "Luxe Med Spa",
    quote:
      "“My receptionist can't answer every call during treatments. This agent handles the overflow perfectly. Clients love the instant response.”"
  }
];

const similarAgents = [
  {
    title: "Lead Follow-Up Agent",
    price: "$129",
    description: "Automatically follows up with leads who don't respond."
  },
  {
    title: "Appointment Reminder Agent",
    price: "$99",
    description: "Reduces no-shows by 60% with smart reminders."
  },
  {
    title: "Review Request Agent",
    price: "$79",
    description: "Asks happy customers for Google reviews at the perfect time."
  }
];

function ArrowIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

function CheckIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function StarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 1.5 12.5 7l6 .5-4.5 4 1.4 5.9L10 14.3 4.6 17.4 6 11.5 1.5 7.5l6-.5L10 1.5Z" />
    </svg>
  );
}

function PhoneIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5a2 2 0 0 1 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a2 2 0 0 1-2 2A16 16 0 0 1 3 5z" />
    </svg>
  );
}

function Counter({
  target,
  prefix = "",
  suffix = "",
  active
}: {
  target: number;
  prefix?: string;
  suffix?: string;
  active: boolean;
}) {
  const [value, setValue] = useState(`${prefix}0${suffix}`);
  const completed = useRef(false);

  useEffect(() => {
    if (!active || completed.current) return;

    completed.current = true;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const format = (number: number) => {
      return `${prefix}${Math.round(number).toLocaleString("en-US")}${suffix}`;
    };

    if (reduceMotion) {
      setValue(format(target));
      return;
    }

    const duration = 1500;
    let start: number | null = null;
    let raf = 0;

    function step(timestamp: number) {
      if (start === null) start = timestamp;

      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      setValue(format(target * eased));

      if (progress < 1) {
        raf = requestAnimationFrame(step);
      } else {
        setValue(format(target));
      }
    }

    raf = requestAnimationFrame(step);

    return () => cancelAnimationFrame(raf);
  }, [active, prefix, suffix, target]);

  return <div className="text-4xl font-extrabold tracking-tight text-amber-600">{value}</div>;
}

function Stars() {
  return (
    <div className="mb-4 flex gap-0.5 text-amber-400" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, index) => (
        <StarIcon key={index} />
      ))}
    </div>
  );
}

function PhoneMockup() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[3rem] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(245,158,11,0.12),transparent_70%)]" />

      <div className="mx-auto w-full max-w-[320px] animate-float">
        <div className="rounded-[2.5rem] border border-gray-200 bg-white p-2.5 shadow-2xl">
          <div className="overflow-hidden rounded-[2rem] bg-gray-50">
            <div className="flex items-center justify-between px-5 pb-1 pt-3 text-[10px] font-semibold text-slate-500">
              <span data-testid="business-protected-agents-9-41-text">9:41</span>
              <span className="inline-flex items-center gap-1" aria-hidden="true">
                5G
              </span>
            </div>

            <div className="flex items-center gap-2 border-b border-gray-100 bg-white px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700" data-testid="business-protected-agents-bs-text">
                BS
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900">Bright Smile Dental</div>
                <div className="text-[10px] text-slate-500">Text Message · SMS</div>
              </div>
            </div>

            <div className="space-y-3 px-4 py-4">
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
                  <PhoneIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900">Missed call</div>
                  <div className="truncate text-[11px] text-slate-500">Bright Smile Dental · just now</div>
                </div>
              </div>

              <div className="flex">
                <div className="max-w-[82%] rounded-2xl rounded-bl-md border border-gray-100 bg-white px-3 py-2 text-[12px] leading-snug text-slate-700 shadow-sm">
                  Hi! Sorry we missed your call at Bright Smile Dental. How can we help?
                  Reply here or we&apos;ll call you back within 5 minutes.
                </div>
              </div>

              <div className="flex justify-end">
                <div className="max-w-[82%] rounded-2xl rounded-br-md bg-amber-500 px-3 py-2 text-[12px] font-medium leading-snug text-slate-950 shadow-sm">
                  I need to book a cleaning appointment
                </div>
              </div>

              <div className="flex">
                <div className="max-w-[86%] rounded-2xl rounded-bl-md border border-gray-100 bg-white px-3 py-2 text-[12px] leading-snug text-slate-700 shadow-sm">
                  I&apos;d be happy to help! Here are our available slots this week:{" "}
                  <span className="font-semibold text-amber-600 underline" data-testid="business-protected-agents-view-available-times-text">View available times</span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Automated by CORE · replied in 5s
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MissedCallTextBackPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [stickyShown, setStickyShown] = useState(false);
  const [countersActive, setCountersActive] = useState(false);

  const heroCtaRef = useRef<HTMLAnchorElement | null>(null);
  const demoRef = useRef<HTMLDivElement | null>(null);
  const metricsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onScroll() {
      setNavScrolled(window.scrollY > 8);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const cta = heroCtaRef.current;

    if (!cta || !("IntersectionObserver" in window)) {
      const onScroll = () => setStickyShown(window.scrollY > 700);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => window.removeEventListener("scroll", onScroll);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setStickyShown(!entry.isIntersecting && entry.boundingClientRect.top < 0);
        });
      },
      { threshold: 0 }
    );

    observer.observe(cta);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = metricsRef.current;

    if (!node || !("IntersectionObserver" in window)) {
      setCountersActive(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setCountersActive(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.4 }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDemoOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function scrollToDemo() {
    setDemoOpen(false);
    demoRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center"
    });
  }

  return (
    <div className="agent-detail-root min-h-screen bg-white text-slate-600">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <header
        className={`sticky top-0 z-50 border-b backdrop-blur-md transition ${
          navScrolled
            ? "border-gray-200 bg-white/90 shadow-[0_1px_3px_0_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.06)]"
            : "border-transparent"
        }`}
      >
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link data-testid="agent-detail-core-link" href={"/" as Route} className="flex items-center gap-2.5" aria-label="CORE home">
            <svg className="h-7 w-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <circle cx="14" cy="14" r="11" stroke="#f59e0b" strokeWidth="2" />
              <circle cx="14" cy="14" r="4" fill="#f59e0b" />
            </svg>
            <span className="text-xl font-extrabold tracking-tight text-amber-500" data-testid="business-protected-agents-core-text">CORE</span>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            <Link data-testid="agent-detail-home-link" href={"/" as Route} className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              Home
            </Link>
            <Link data-testid="agent-detail-marketplace-link" href={BUSINESS_MARKETPLACE_PATH} className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              Marketplace
            </Link>
            <a data-testid="agent-detail-pricing-link" href={"#bottom-cta" as Route} className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              Pricing
            </a>
            <a data-testid="agent-detail-about-link" href={"#reviews" as Route} className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              About
            </a>
            <a data-testid="agent-detail-contact-link" href={"#footer" as Route} className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              Contact
            </a>
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <a data-testid="agent-detail-get-started-link"
              href={"#hero-cta" as Route}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-glow-sm transition duration-200 hover:scale-[1.03] hover:bg-amber-400"
            >
              Get Started
            </a>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            data-testid="agent-detail-menu-toggle"
            className="inline-flex items-center justify-center rounded-lg p-2 text-slate-600 transition hover:bg-gray-100 hover:text-slate-900 md:hidden"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        </nav>

        {menuOpen ? (
          <div className="border-t border-gray-200 bg-white/95 backdrop-blur-md md:hidden">
            <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-4">
{[
  { label: "Home", href: HOME_PATH },
  { label: "Marketplace", href: BUSINESS_MARKETPLACE_PATH },
  { label: "Pricing", href: FOOTER_HASH_PATH },
  { label: "About", href: FOOTER_HASH_PATH },
  { label: "Contact", href: FOOTER_HASH_PATH }
].map((item) => (
  <Link data-testid="agent-detail-link"
    key={item.label}
    href={item.href}
    onClick={() => setMenuOpen(false)}
    className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
  >
    {item.label}
  </Link>
))}

              <a data-testid="agent-detail-get-started-link-2"
                href={"#hero-cta" as Route}
                onClick={() => setMenuOpen(false)}
                className="mt-3 rounded-xl bg-amber-500 px-4 py-2.5 text-center text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
              >
                Get Started
              </a>
            </div>
          </div>
        ) : null}
      </header>

      <div className="border-b border-gray-100 bg-white">
        <nav className="mx-auto max-w-6xl px-6 py-3 text-sm" aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-slate-500">
            <li data-testid="business-protected-agents-marketplace-item">
              <Link data-testid="agent-detail-marketplace-link-2" href={BUSINESS_MARKETPLACE_PATH} className="transition hover:text-amber-600">
                Marketplace
              </Link>
            </li>
            <li className="text-slate-300" data-testid="agent-detail-breadcrumb-separator-1">›</li>
            <li data-testid="business-protected-agents-communication-item">
              <a data-testid="agent-detail-communication-link" href={"#" as Route} className="transition hover:text-amber-600">
                Communication
              </a>
            </li>
            <li className="text-slate-300" data-testid="agent-detail-breadcrumb-separator-2">›</li>
            <li className="font-medium text-slate-700" data-testid="business-protected-agents-missed-call-back-item">Missed Call Text-Back</li>
          </ol>
        </nav>
      </div>

      <main>
        <section className="relative px-6 pb-16 pt-12">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(55%_60%_at_50%_0%,rgba(245,158,11,0.08),rgba(255,255,255,0)_72%)]" />

          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-5 lg:items-start">
            <div className="order-2 lg:order-1 lg:col-span-3">
              <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500 shadow-glow">
                <PhoneIcon className="h-8 w-8 text-slate-950" />
                <span className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-amber-400 ring-2 ring-white">
                  ⚡
                </span>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl" data-testid="business-protected-agents-missed-call-back-heading">
                  Missed Call Text-Back
                </h1>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700" data-testid="business-protected-agents-communication-text">
                  Communication
                </span>
              </div>

              <p className="mt-4 max-w-xl text-lg leading-relaxed text-slate-600" data-testid="business-protected-agents-never-lose-a-lead-to-a-missed-text">
                Never lose a lead to a missed call again. Automatically texts back within 5 seconds.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="inline-flex items-center gap-2">
                  <div className="flex gap-0.5 text-amber-400" aria-label="Rated 4.9 out of 5">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <StarIcon key={index} />
                    ))}
                  </div>
                  <span className="text-sm font-semibold text-slate-900" data-testid="business-protected-agents-4-9-text">4.9</span>
                  <span className="text-sm text-slate-500" data-testid="business-protected-agents-47-reviews-text">(47 reviews)</span>
                </div>

                <div className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <span className="text-amber-500">👥</span>
                  <span className="font-semibold text-slate-900" data-testid="business-protected-agents-1-240-text">1,240+</span> businesses using this agent
                </div>
              </div>

              <div className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600">
                Built by{" "}
                <span className="inline-flex items-center gap-1 font-semibold text-slate-900" data-testid="business-protected-agents-core-official-text">
                  CORE Official <span className="text-amber-500">✓</span>
                </span>
              </div>

              <div className="mt-7 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-700" data-testid="business-protected-agents-0-for-the-first-7-days-text">
                  ⚡ $0 for the first 7 days
                </span>

                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold tracking-tight text-slate-900" data-testid="business-protected-agents-149-text">$149</span>
                  <span className="text-lg font-medium text-slate-500" data-testid="business-protected-agents-month-text">/month</span>
                </div>

                <p className="mt-0.5 text-xs text-slate-500" data-testid="business-protected-agents-per-business-location-billed-after-your-free-text">
                  per business location · billed after your free trial
                </p>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <a data-testid="agent-detail-start-7-day-free-trial-link"
                    ref={heroCtaRef}
                    id="hero-cta"
                    href={"#bottom-cta" as Route}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-base font-semibold text-slate-950 shadow-glow transition duration-200 hover:scale-[1.02] hover:bg-amber-400"
                  >
                    Start 7-Day Free Trial
                    <ArrowIcon />
                  </a>

                  <button
                    type="button"
                    onClick={() => setDemoOpen(true)}
                    data-testid="agent-detail-watch-demo"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-6 py-3.5 text-base font-semibold text-slate-700 transition duration-200 hover:border-amber-400 hover:text-amber-600"
                  >
                    ▶ Watch Demo
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-500" data-testid="business-protected-agents-no-credit-card-required-to-start-149-text">
                  No credit card required to start. $149/month after trial.
                </p>
              </div>

              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                {["7-day free trial", "Cancel anytime", "Setup in 2 minutes", "30-day money-back after conversion"].map((item) => (
                  <span key={item} data-testid={`agent-detail-trial-benefit-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                    <CheckIcon className="h-4 w-4 text-emerald-500" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div ref={demoRef} id="demo" className="order-1 scroll-mt-24 lg:order-2 lg:col-span-2">
              <PhoneMockup />
            </div>
          </div>
        </section>

        <section className="bg-gray-50 px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl" data-testid="business-protected-agents-how-it-works-heading">How It Works</h2>
              <p className="mt-3 text-lg text-slate-600" data-testid="business-protected-agents-from-missed-call-to-captured-lead-in-text">From missed call to captured lead in three automatic steps.</p>
            </div>

            <div className="relative mt-14">
              <div className="absolute top-7 hidden border-t-2 border-dashed border-amber-300 md:block" style={{ left: "16.66%", right: "16.66%" }} />

              <div className="relative grid gap-10 md:grid-cols-3">
                {[
                  ["1", "Customer Calls", "When someone calls your business and no one picks up, the agent detects it instantly via Twilio."],
                  ["2", "Auto Text in 5 Seconds", "A personalized text message is sent immediately. The customer knows you care and haven't ignored them."],
                  ["3", "Lead Captured", "The conversation continues via text. The agent can book appointments, answer FAQs, or route to your team."]
                ].map(([number, title, text]) => (
                  <div key={number} className="text-center">
                    <div className="relative z-10 mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-lg font-bold text-slate-950 shadow-glow-sm ring-4 ring-gray-50">
                      {number}
                    </div>
                    <h3 className="mt-5 text-lg font-semibold text-slate-900" data-testid="business-protected-agents-title-heading">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600" data-testid="business-protected-agents-2-sm-leading-relaxed-text">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 py-16 sm:py-20">
          <div ref={metricsRef} className="mx-auto grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Metric value={<Counter target={5} suffix=" sec" active={countersActive} />} label="Average response time" />
            <Metric value={<Counter target={62} suffix="%" active={countersActive} />} label="Lead recovery rate" />
            <Metric value={<Counter target={4200} prefix="$" active={countersActive} />} label="Avg. monthly revenue recovered" />
            <Metric value={<Counter target={24} suffix="/7" active={countersActive} />} label="Always active, never sleeps" />
          </div>
        </section>

        <section className="bg-gray-50 px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <SectionHeader
              title="Everything this agent does"
              description="Built to capture every lead and keep the conversation moving — automatically."
            />

            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {features.map((feature) => (
                <div
                  key={feature}
                  className="flex items-start gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition duration-200 hover:border-amber-200 hover:shadow-md"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                    ⚡
                  </span>
                  <p className="pt-1.5 text-slate-700" data-testid="business-protected-agents-feature-text">{feature}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <SectionHeader title="What's included" description="One flat price. No usage caps on anything that matters." />

            <div className="mt-10 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <ul className="divide-y divide-gray-100">
                {includedItems.map((item) => (
                  <li key={item} data-testid={`agent-detail-included-item-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="flex items-center gap-3 px-6 py-3.5">
                    <CheckIcon className="h-5 w-5 shrink-0 text-emerald-500" />
                    <span className="text-slate-700" data-testid={`agent-detail-included-text-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{item}</span>
                  </li>
                ))}

                {excludedItems.map((item) => (
                  <li key={item} data-testid={`agent-detail-excluded-item-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="flex items-center gap-3 px-6 py-3.5">
                    <span className="text-gray-300" data-testid={`agent-detail-excluded-icon-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>✕</span>
                    <span className="text-slate-400" data-testid={`agent-detail-excluded-text-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="reviews" className="bg-gray-50 px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <SectionHeader title="What Business Owners Say" />

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {reviews.map((review) => (
                <figure key={review.initials} className="flex flex-col rounded-xl border border-gray-100 bg-white p-7 shadow-sm">
                  <Stars />
                  <blockquote className="flex-1 leading-relaxed text-slate-700">{review.quote}</blockquote>
                  <figcaption className="mt-6 flex items-center gap-3 border-t border-gray-100 pt-6">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700" data-testid="business-protected-agents-review-initials-text">
                      {review.initials}
                    </span>
                    <span data-testid="business-protected-agents-review-text">
                      <span className="block text-sm font-semibold text-slate-900" data-testid="business-protected-agents-review-text-2">{review.name}</span>
                      <span className="block text-xs text-slate-500" data-testid="business-protected-agents-review-company-text">{review.company}</span>
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>

            <div className="mt-8 text-center">
              <a data-testid="agent-detail-see-all-47-reviews-link" href={"#" as Route} className="inline-flex items-center gap-2 text-sm font-semibold text-amber-600 transition hover:gap-3 hover:text-amber-700">
                See all 47 reviews <ArrowIcon />
              </a>
            </div>
          </div>
        </section>

        <section className="px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setTechOpen((current) => !current)}
                aria-expanded={techOpen}
                data-testid="agent-detail-tech-toggle"
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              >
                <span className="text-lg font-semibold text-slate-900" data-testid="business-protected-agents-technical-details-text">Technical Details</span>
                <svg
                  className={`h-5 w-5 text-slate-400 transition ${techOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              <div className={`overflow-hidden px-6 transition-all duration-300 ${techOpen ? "max-h-[600px]" : "max-h-0"}`}>
                <dl className="grid gap-x-8 gap-y-5 border-t border-gray-100 py-6 sm:grid-cols-2">
                  {[
                    ["Connectors used", "Twilio (SMS/Voice), Google Calendar, OpenAI (conversation AI)"],
                    ["Response time", "< 5 seconds"],
                    ["Uptime", "99.9% SLA"],
                    ["Data retention", "90 days (configurable)"],
                    ["Compliance", "TCPA compliant, HIPAA available"],
                    ["Languages", "English (Spanish coming soon)"]
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500" data-testid="business-protected-agents-label-term">{label}</dt>
                      <dd className="mt-1 text-slate-700" data-testid={`agent-detail-spec-value-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-gray-50 px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <SectionHeader
              title="Similar agents"
              description="Pair the text-back agent with these to cover the whole funnel."
            />

            <div className="no-scrollbar mt-12 flex snap-x gap-5 overflow-x-auto pb-2 md:grid md:grid-cols-3 md:overflow-visible">
              {similarAgents.map((agent) => (
                <div
                  key={agent.title}
                  className="flex w-[280px] shrink-0 snap-start flex-col rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition duration-200 hover:shadow-md md:w-auto"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    ⚡
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-slate-900" data-testid="business-protected-agents-agent-title-heading">{agent.title}</h3>
                  <div className="mt-1 text-sm font-bold text-amber-600">
                    {agent.price}
                    <span className="font-medium text-slate-500" data-testid="business-protected-agents-month-text-2">/month</span>
                  </div>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600" data-testid="business-protected-agents-agent-description-text">{agent.description}</p>
                  <a data-testid="agent-detail-view-agent-link" href={"#" as Route} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-600 transition hover:gap-2.5 hover:text-amber-700">
                    View agent <ArrowIcon />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="bottom-cta" className="scroll-mt-24 px-6 py-16 sm:py-20">
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-amber-200 bg-amber-50 px-6 py-14 text-center shadow-glow sm:px-12">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_70%_at_50%_0%,rgba(245,158,11,0.12),transparent_70%)]" />
            <h2 className="text-balance text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl" data-testid="business-protected-agents-stop-losing-4-200-month-to-missed-heading">
              Stop Losing $4,200/Month to Missed Calls
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600" data-testid="business-protected-agents-1-240-businesses-that-never-miss-a-text">
              Join 1,240+ businesses that never miss a lead. Start free, cancel anytime.
            </p>
            <div className="mt-8">
              <a data-testid="agent-detail-start-7-day-free-trial-link-2"
                href={"#" as Route}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-9 py-4 text-lg font-semibold text-slate-950 shadow-glow-lg transition duration-200 hover:scale-[1.03] hover:bg-amber-400"
              >
                Start 7-Day Free Trial
                <ArrowIcon className="h-5 w-5" />
              </a>
            </div>
            <p className="mt-5 text-sm text-slate-500" data-testid="business-protected-agents-no-credit-card-required-149-month-after-text">
              No credit card required. $149/month after trial. 30-day money-back guarantee.
            </p>
          </div>
        </section>
      </main>

      <footer id="footer" className="scroll-mt-24 border-t border-gray-200 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
            <div className="col-span-2 md:col-span-1">
              <Link data-testid="agent-detail-core-link-2" href={"/" as Route} className="flex items-center gap-2.5" aria-label="CORE home">
                <svg className="h-7 w-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                  <circle cx="14" cy="14" r="11" stroke="#f59e0b" strokeWidth="2" />
                  <circle cx="14" cy="14" r="4" fill="#f59e0b" />
                </svg>
                <span className="text-xl font-extrabold tracking-tight text-amber-500" data-testid="business-protected-agents-core-text-2">CORE</span>
              </Link>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500" data-testid="business-protected-agents-the-ai-agent-marketplace-where-businesses-and-text">
                The AI agent marketplace where businesses and architects build the future of work together.
              </p>
            </div>

            <FooterColumn title="Product" items={["Platform", "Pricing", "Docs", "API"]} />
            <FooterColumn title="Company" items={["About", "Blog", "Careers"]} />
            <FooterColumn title="Legal" items={["Privacy", "Terms"]} />
            <FooterColumn title="Connect" items={["Twitter", "LinkedIn", "Email"]} />
          </div>

          <div className="mt-12 border-t border-gray-200 pt-8">
            <p className="text-sm text-slate-500" data-testid="business-protected-agents-2026-core-all-rights-reserved-text">© 2026 CORE. All rights reserved.</p>
          </div>
        </div>
      </footer>

      <div
        className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 px-6 py-3 shadow-lg backdrop-blur-md transition-all duration-300"
        style={{
          opacity: stickyShown ? 1 : 0,
          transform: stickyShown ? "translateY(0)" : "translateY(0.5rem)",
          pointerEvents: stickyShown ? "auto" : "none"
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900" data-testid="business-protected-agents-missed-call-back-text">Missed Call Text-Back</p>
            <p className="truncate text-xs text-slate-500" data-testid="business-protected-agents-start-free-0-for-7-days-then-text">Start free — $0 for 7 days, then $149/mo</p>
          </div>

          <a data-testid="agent-detail-start-free-trial-link"
            href={"#bottom-cta" as Route}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-glow-sm transition duration-200 hover:scale-[1.03] hover:bg-amber-400"
          >
            Start Free Trial
            <ArrowIcon className="hidden h-4 w-4 sm:block" />
          </a>
        </div>
      </div>

      {demoOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDemoOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-title"
            className="relative w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setDemoOpen(false)}
              data-testid="agent-detail-demo-close"
              className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-gray-100 hover:text-slate-900"
              aria-label="Close"
            >
              ✕
            </button>

            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500 text-slate-950 shadow-glow">
              ▶
            </div>

            <h2 id="demo-title" className="mt-5 text-2xl font-bold tracking-tight text-slate-900" data-testid="business-protected-agents-see-the-agent-in-action-heading">
              See the agent in action
            </h2>

            <p className="mx-auto mt-2 max-w-sm text-slate-600" data-testid="business-protected-agents-the-full-90-second-product-walkthrough-is-text">
              The full 90-second product walkthrough is on the way. In the meantime,
              scroll up to watch the live text-back flow on the phone preview.
            </p>

            <button
              type="button"
              onClick={scrollToDemo}
              data-testid="agent-detail-view-preview"
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-slate-950 transition duration-200 hover:bg-amber-400"
            >
              View the live preview
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl" data-testid="business-protected-agents-title-heading-2">{title}</h2>
      {description ? <p className="mt-3 text-lg text-slate-600" data-testid="business-protected-agents-description-text">{description}</p> : null}
    </div>
  );
}

function Metric({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-6 text-center shadow-sm">
      {value}
      <div className="mt-2 text-sm text-slate-600">{label}</div>
    </div>
  );
}

function FooterColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-900" data-testid="business-protected-agents-title-heading-3">{title}</h4>
      <ul className="mt-4 space-y-3 text-sm">
        {items.map((item) => (
          <li key={item} data-testid={`agent-detail-footer-item-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
            <a data-testid="agent-detail-link-2" href={"#" as Route} className="text-slate-500 transition hover:text-amber-600">
              {item}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}