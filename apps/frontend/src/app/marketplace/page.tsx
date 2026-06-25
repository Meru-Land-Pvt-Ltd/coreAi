"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";

type Agent = {
  id: string;
  name: string;
  category: string;
  industry: string;
  description: string;
  price: number;
  installs: number;
  rating: number;
  author: string;
  isNew?: boolean;
  freeTrial?: boolean;
};

type Industry = {
  id: string;
  label: string;
  count: number;
  icon: string;
};

const industries: Industry[] = [
  { id: "all", label: "All industries", count: 54, icon: "✨" },
  { id: "dental", label: "Dental", count: 12, icon: "🦷" },
  { id: "hvac", label: "HVAC & Plumbing", count: 8, icon: "🔧" },
  { id: "realestate", label: "Real Estate", count: 10, icon: "🏠" },
  { id: "legal", label: "Legal", count: 6, icon: "⚖️" },
  { id: "medical", label: "Medical & Wellness", count: 9, icon: "❤️" },
  { id: "automotive", label: "Automotive", count: 5, icon: "🚗" },
  { id: "ecommerce", label: "E-commerce", count: 11, icon: "🛍️" }
];

const agents: Agent[] = [
  {
    id: "missed-call",
    name: "Missed Call Text-Back",
    category: "Communication",
    industry: "dental",
    description:
      "Turns every missed call into a text conversation in seconds so a busy line never costs you another customer.",
    price: 100,
    installs: 180,
    rating: 4.9,
    author: "Marcus T.",
    freeTrial: true
  },
  {
    id: "lead-followup",
    name: "Lead Follow-Up Sequence",
    category: "Nurture",
    industry: "all",
    description:
      "A multi-step text and email sequence that follows up with new leads until they book or opt out.",
    price: 149,
    installs: 134,
    rating: 4.8,
    author: "Priya N.",
    freeTrial: true
  },
  {
    id: "appointment-reminder",
    name: "Appointment Reminder Pro",
    category: "Scheduling",
    industry: "medical",
    description:
      "Smart reminders that reduce no-shows with confirm, reschedule, and waitlist replies built in.",
    price: 79,
    installs: 98,
    rating: 4.7,
    author: "Dana K.",
    freeTrial: true
  },
  {
    id: "review-booster",
    name: "Google Review Booster",
    category: "Reputation",
    industry: "all",
    description:
      "Asks happy customers for a review at the perfect moment and routes unhappy ones privately first.",
    price: 89,
    installs: 210,
    rating: 4.9,
    author: "Marcus T.",
    freeTrial: true
  },
  {
    id: "after-hours",
    name: "After-Hours Receptionist",
    category: "Communication",
    industry: "legal",
    description:
      "Answers, qualifies, and books callers around the clock so nights and weekends stay covered.",
    price: 129,
    installs: 76,
    rating: 4.6,
    author: "Sofia R."
  },
  {
    id: "estimate-followup",
    name: "Estimate Follow-Up",
    category: "Sales",
    industry: "hvac",
    description:
      "Chases open estimates with timely check-ins so quotes become booked jobs instead of silence.",
    price: 119,
    installs: 62,
    rating: 4.5,
    author: "Leo M."
  },
  {
    id: "open-house",
    name: "Open House Lead Capture",
    category: "Lead Gen",
    industry: "realestate",
    description:
      "Captures every open-house visitor by text and follows up while the home is still fresh in mind.",
    price: 99,
    installs: 88,
    rating: 4.7,
    author: "Hana W.",
    freeTrial: true
  },
  {
    id: "abandoned-cart",
    name: "Abandoned Cart Rescuer",
    category: "E-commerce",
    industry: "ecommerce",
    description:
      "Recovers stalled checkouts with perfectly timed reminders and gentle incentives to finish.",
    price: 99,
    installs: 156,
    rating: 4.8,
    author: "Priya N.",
    freeTrial: true
  },
  {
    id: "quote-to-cash",
    name: "Quote-to-Cash Chaser",
    category: "Sales",
    industry: "hvac",
    description:
      "Follows every quote through to payment with reminders, payment links, and invoice nudges.",
    price: 139,
    installs: 41,
    rating: 4.4,
    author: "Leo M.",
    isNew: true
  }
];

const sortOptions = [
  { value: "popular", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
  { value: "priceLow", label: "Price: low to high" },
  { value: "priceHigh", label: "Price: high to low" },
  { value: "newest", label: "Newest" }
] as const;

const HOME_PATH = "/" as Route;
const BUSINESS_LOGIN_PATH = "/business/login" as Route;
const BUSINESS_SETUP_PATH = "/business/agents/setup" as Route;
const ARCHITECT_LOGIN_PATH = "/architect/login" as Route;

type SortValue = (typeof sortOptions)[number]["value"];

export default function MarketplacePage() {
  const [query, setQuery] = useState("");
  const [industry, setIndustry] = useState("all");
  const [sort, setSort] = useState<SortValue>("popular");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [freeTrialOnly, setFreeTrialOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);

  const filteredAgents = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();

    const filtered = agents.filter((agent) => {
      const matchesQuery =
        !cleanQuery ||
        `${agent.name} ${agent.category} ${agent.description}`
          .toLowerCase()
          .includes(cleanQuery);

      const matchesIndustry =
        industry === "all" ||
        agent.industry === industry ||
        agent.industry === "all";

      const matchesTrial = !freeTrialOnly || agent.freeTrial;
      const matchesNew = !newOnly || agent.isNew;

      return matchesQuery && matchesIndustry && matchesTrial && matchesNew;
    });

    return filtered.sort((a, b) => {
      if (sort === "rating") return b.rating - a.rating;
      if (sort === "priceLow") return a.price - b.price;
      if (sort === "priceHigh") return b.price - a.price;
      if (sort === "newest") return Number(b.isNew) - Number(a.isNew);
      return b.installs - a.installs;
    });
  }, [query, industry, sort, freeTrialOnly, newOnly]);

  return (
    <main data-testid="app-marketplace-page-main-1" className="min-h-screen bg-white text-slate-900">
      <nav data-testid="app-marketplace-page-nav-1" className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 shadow-sm backdrop-blur">
        <div data-testid="app-marketplace-page-div-1" className="mx-auto max-w-7xl px-4 sm:px-6">
          <div data-testid="app-marketplace-page-div-2" className="flex flex-wrap items-center gap-3 py-3">
            <Link data-testid="app-marketplace-page-link-1" href={HOME_PATH} className="flex shrink-0 items-center gap-2.5">
              <span data-testid="app-marketplace-page-span-1" className="grid h-9 w-9 place-items-center rounded-full bg-amber-500 text-white shadow-lg shadow-amber-500/30">
                ●
              </span>
              <span data-testid="app-marketplace-page-span-2" className="text-xl font-extrabold tracking-tight text-slate-900">
                CORE
              </span>
            </Link>

            <div data-testid="app-marketplace-page-div-3" className="order-3 w-full md:order-2 md:flex-1 md:px-4">
              <div data-testid="app-marketplace-page-div-4" className="relative mx-auto max-w-2xl">
                <span data-testid="app-marketplace-page-span-3" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  🔍
                </span>
                <input data-testid="app-marketplace-page-input-1"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search agents by name, industry, or problem..."
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-11 pr-4 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-amber-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-amber-100"
                />
              </div>
            </div>

            <div data-testid="app-marketplace-page-div-5" className="order-2 ml-auto flex items-center gap-2 md:order-3">
              <Link data-testid="app-marketplace-page-link-2"
                href={ARCHITECT_LOGIN_PATH}
                className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 sm:block"
              >
                For Architects
              </Link>
              <Link data-testid="app-marketplace-page-link-3"
                href={BUSINESS_LOGIN_PATH}
                className="rounded-xl border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-600 transition hover:bg-amber-50"
              >
                Log in
              </Link>
              <Link data-testid="app-marketplace-page-link-4"
                href={BUSINESS_LOGIN_PATH}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-amber-500/30 transition hover:bg-amber-600"
              >
                Get started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <section data-testid="app-marketplace-page-section-1" className="relative overflow-hidden bg-gradient-to-br from-amber-50 via-white to-orange-50">
        <div data-testid="app-marketplace-page-div-6" className="pointer-events-none absolute -left-24 top-8 h-72 w-72 rounded-full bg-amber-200/30 blur-3xl" />
        <div data-testid="app-marketplace-page-div-7" className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-orange-200/30 blur-3xl" />

        <div data-testid="app-marketplace-page-div-8" className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div data-testid="app-marketplace-page-div-9" className="mx-auto max-w-3xl text-center">
            <span data-testid="app-marketplace-page-span-4" className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/70 px-3.5 py-1.5 text-xs font-semibold text-amber-700">
              ✨ New agents added every week
            </span>

            <h1 data-testid="app-marketplace-page-h1-1" className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl">
              AI Agents That Work
              <br data-testid="app-marketplace-page-br-1" className="hidden sm:block" /> While You Sleep
            </h1>

            <p data-testid="app-marketplace-page-p-1" className="mx-auto mt-4 max-w-2xl text-lg text-slate-600 sm:text-xl">
              Browse pre-built AI agents. Install in minutes. No code required.
            </p>

            <div data-testid="app-marketplace-page-div-10" className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              <Metric label="Agents" value="50+" />
              <Metric label="Businesses" value="2,400+" />
              <Metric label="Average rating" value="4.8 ⭐" />
            </div>
          </div>

          <div data-testid="app-marketplace-page-div-11" className="relative mx-auto mt-12 max-w-5xl">
            <div data-testid="app-marketplace-page-div-12" className="absolute inset-x-8 bottom-2 h-24 rounded-full bg-amber-400/30 blur-2xl" />

            <div data-testid="app-marketplace-page-div-13" className="relative grid items-center gap-8 overflow-hidden rounded-3xl border border-amber-100 bg-white p-7 shadow-[0_30px_80px_-28px_rgba(245,158,11,.55)] sm:p-9 md:grid-cols-2">
              <div data-testid="app-marketplace-page-div-14">
                <div data-testid="app-marketplace-page-div-15" className="flex flex-wrap items-center gap-2">
                  <span data-testid="app-marketplace-page-span-5" className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                    ⭐ Featured
                  </span>
                  <span data-testid="app-marketplace-page-span-6" className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                    Communication
                  </span>
                </div>

                <h2 data-testid="app-marketplace-page-h2-1" className="mt-4 text-3xl font-extrabold text-slate-900">
                  Missed Call Text-Back
                </h2>

                <p data-testid="app-marketplace-page-p-2" className="mt-3 text-slate-600">
                  Turn every missed call into a text conversation in seconds —
                  so a busy line never costs you another customer.
                </p>

                <div data-testid="app-marketplace-page-div-16" className="mt-5 flex flex-wrap items-center gap-3">
                  <span data-testid="app-marketplace-page-span-7" className="text-2xl font-black text-slate-900">
                    $100
                  </span>
                  <span data-testid="app-marketplace-page-span-8" className="text-sm text-slate-500">one-time</span>
                  <span data-testid="app-marketplace-page-span-9" className="h-4 w-px bg-gray-200" />
                  <span data-testid="app-marketplace-page-span-10" className="text-sm font-semibold text-amber-600">
                    ⭐ 4.9{" "}
                    <span data-testid="app-marketplace-page-span-11" className="font-normal text-slate-400">
                      (47 reviews)
                    </span>
                  </span>
                </div>

                <div data-testid="app-marketplace-page-div-17" className="mt-6 flex flex-wrap items-center gap-3">
                  <Link data-testid="app-marketplace-page-link-5"
                    href={BUSINESS_SETUP_PATH}
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600"
                  >
                    Start free trial
                  </Link>
                  <button data-testid="app-marketplace-page-button-1" className="rounded-xl border-2 border-gray-200 px-5 py-3 font-semibold text-slate-700 transition hover:border-amber-300 hover:text-amber-600">
                    View details
                  </button>
                </div>
              </div>

              <div data-testid="app-marketplace-page-div-18" className="flex justify-center md:justify-end">
                <div data-testid="app-marketplace-page-div-19" className="relative w-[240px] rotate-3 rounded-[2.4rem] border-[10px] border-slate-900 bg-slate-900 shadow-2xl">
                  <div data-testid="app-marketplace-page-div-20" className="overflow-hidden rounded-[1.7rem] bg-slate-50">
                    <div data-testid="app-marketplace-page-div-21" className="flex items-center gap-2.5 bg-white px-4 pb-3 pt-6">
                      <span data-testid="app-marketplace-page-span-12" className="grid h-8 w-8 place-items-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
                        BS
                      </span>
                      <div data-testid="app-marketplace-page-div-22">
                        <p data-testid="app-marketplace-page-p-3" className="text-[13px] font-semibold text-slate-900">
                          Bright Smile Dental
                        </p>
                        <p data-testid="app-marketplace-page-p-4" className="text-[10px] text-emerald-500">
                          ● Active now
                        </p>
                      </div>
                    </div>

                    <div data-testid="app-marketplace-page-div-23" className="space-y-2.5 px-3 py-4 text-[12px] leading-snug">
                      <div data-testid="app-marketplace-page-div-24" className="mx-auto w-fit rounded-full bg-slate-200/70 px-3 py-1 text-[10px] text-slate-500">
                        Missed call · 9:42 AM
                      </div>
                      <Message mine>
                        Hi! Sorry we missed your call. How can we help?
                      </Message>
                      <Message>
                        Do you have openings this week for a cleaning?
                      </Message>
                      <Message mine>
                        Yes! Thursday 2:00 PM or Friday 10:30 AM.
                      </Message>
                    </div>

                    <div data-testid="app-marketplace-page-div-25" className="flex items-center gap-2 border-t border-gray-100 bg-white px-3 py-2.5">
                      <div data-testid="app-marketplace-page-div-26" className="flex-1 rounded-full bg-gray-100 px-3 py-1.5 text-[11px] text-slate-400">
                        Text message…
                      </div>
                      <span data-testid="app-marketplace-page-span-13" className="grid h-7 w-7 place-items-center rounded-full bg-amber-500 text-white">
                        ➤
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section data-testid="app-marketplace-page-section-2" className="bg-white py-16">
        <div data-testid="app-marketplace-page-div-27" className="mx-auto max-w-6xl px-4 sm:px-6">
          <div data-testid="app-marketplace-page-div-28" className="text-center">
            <h2 data-testid="app-marketplace-page-h2-2" className="text-3xl font-bold text-slate-900">
              Browse by industry
            </h2>
            <p data-testid="app-marketplace-page-p-5" className="mt-2 text-slate-600">
              Find agents built specifically for your business type.
            </p>
          </div>

          <div data-testid="app-marketplace-page-div-29" className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {industries
              .filter((item) => item.id !== "all")
              .map((item) => (
                <button data-testid="app-marketplace-page-button-2"
                  key={item.id}
                  onClick={() => setIndustry(item.id)}
                  className={`group rounded-2xl border bg-white p-6 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-200 hover:shadow-lg ${
                    industry === item.id
                      ? "border-amber-300 ring-4 ring-amber-100"
                      : "border-gray-100"
                  }`}
                >
                  <span data-testid="app-marketplace-page-span-14" className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl transition group-hover:scale-105 group-hover:bg-amber-500">
                    {item.icon}
                  </span>
                  <p data-testid="app-marketplace-page-p-6" className="mt-3 font-semibold text-slate-900">
                    {item.label}
                  </p>
                  <p data-testid="app-marketplace-page-p-7" className="text-sm text-slate-500">{item.count} agents</p>
                </button>
              ))}
          </div>
        </div>
      </section>

      <section data-testid="app-marketplace-page-section-3" className="sticky top-[68px] z-40 border-y border-gray-100 bg-white/95 backdrop-blur">
        <div data-testid="app-marketplace-page-div-30" className="mx-auto max-w-7xl px-4 sm:px-6">
          <div data-testid="app-marketplace-page-div-31" className="flex items-center gap-3 overflow-x-auto py-3">
            <select data-testid="app-marketplace-page-select-1"
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 outline-none transition hover:border-amber-300 focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
            >
              {industries.map((item) => (
                <option data-testid="app-marketplace-page-option-1" key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>

            <button data-testid="app-marketplace-page-button-3"
              onClick={() => setFreeTrialOnly((current) => !current)}
              className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                freeTrialOnly
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-gray-200 bg-white text-slate-600 hover:border-amber-300"
              }`}
            >
              Free trial
            </button>

            <button data-testid="app-marketplace-page-button-4"
              onClick={() => setNewOnly((current) => !current)}
              className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                newOnly
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-gray-200 bg-white text-slate-600 hover:border-amber-300"
              }`}
            >
              New this month
            </button>

            <div data-testid="app-marketplace-page-div-32" className="ml-auto flex shrink-0 items-center gap-3">
              <button data-testid="app-marketplace-page-button-5"
                onClick={() => setView("grid")}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  view === "grid"
                    ? "border-amber-300 bg-amber-50 text-amber-700"
                    : "border-gray-200 text-slate-500"
                }`}
              >
                Grid
              </button>
              <button data-testid="app-marketplace-page-button-6"
                onClick={() => setView("list")}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  view === "list"
                    ? "border-amber-300 bg-amber-50 text-amber-700"
                    : "border-gray-200 text-slate-500"
                }`}
              >
                List
              </button>

              <select data-testid="app-marketplace-page-select-2"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortValue)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 outline-none transition hover:border-amber-300 focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
              >
                {sortOptions.map((item) => (
                  <option data-testid="app-marketplace-page-option-2" key={item.value} value={item.value}>
                    Sort: {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section data-testid="app-marketplace-page-section-4" className="bg-gray-50 py-12">
        <div data-testid="app-marketplace-page-div-33" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {filteredAgents.length ? (
            <div data-testid="app-marketplace-page-div-34"
              className={
                view === "grid"
                  ? "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
                  : "flex flex-col gap-4"
              }
            >
              {filteredAgents.map((agent) =>
                view === "grid" ? (
                  <AgentGridCard key={agent.id} agent={agent} />
                ) : (
                  <AgentListCard key={agent.id} agent={agent} />
                )
              )}
            </div>
          ) : (
            <div data-testid="app-marketplace-page-div-35" className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
              <div data-testid="app-marketplace-page-div-36" className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl">
                🔍
              </div>
              <h3 data-testid="app-marketplace-page-h3-1" className="mt-4 text-lg font-semibold text-slate-900">
                No agents match those filters
              </h3>
              <p data-testid="app-marketplace-page-p-8" className="mt-1 text-sm text-slate-500">
                Try clearing search or selecting another industry.
              </p>
              <button data-testid="app-marketplace-page-button-7"
                onClick={() => {
                  setQuery("");
                  setIndustry("all");
                  setFreeTrialOnly(false);
                  setNewOnly(false);
                }}
                className="mt-5 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
              >
                Clear filters
              </button>
            </div>
          )}

          <p data-testid="app-marketplace-page-p-9" className="mt-8 text-center text-sm text-slate-400">
            Showing {filteredAgents.length} of {agents.length} agents
          </p>
        </div>
      </section>

      <section data-testid="app-marketplace-page-section-5" className="border-t border-gray-100 bg-white py-16">
        <div data-testid="app-marketplace-page-div-37" className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <div data-testid="app-marketplace-page-div-38" className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl">
            ✨
          </div>
          <h2 data-testid="app-marketplace-page-h2-3" className="text-3xl font-bold text-slate-900">
            Not sure which agent is right?
          </h2>
          <p data-testid="app-marketplace-page-p-10" className="mx-auto mt-3 max-w-xl text-slate-600">
            Take a free 2-minute assessment and get a personalized
            recommendation built around your business.
          </p>
          <Link data-testid="app-marketplace-page-link-6"
            href={BUSINESS_LOGIN_PATH}
            className="mx-auto mt-7 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600"
          >
            Get your free AI score →
          </Link>
        </div>
      </section>

      <section data-testid="app-marketplace-page-section-6" className="bg-slate-900 py-8">
        <div data-testid="app-marketplace-page-div-39" className="mx-auto max-w-7xl px-4 sm:px-6">
          <div data-testid="app-marketplace-page-div-40" className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-white/80">
            <TrustItem text="256-bit encryption" />
            <TrustItem text="99.9% uptime" />
            <TrustItem text="SOC 2 compliant" />
            <TrustItem text="30-day money back" />
            <TrustItem text="24/7 support" />
          </div>
        </div>
      </section>

      <footer data-testid="app-marketplace-page-footer-1" className="border-t border-gray-100 bg-white py-12">
        <div data-testid="app-marketplace-page-div-41" className="mx-auto max-w-7xl px-4 sm:px-6">
          <div data-testid="app-marketplace-page-div-42" className="grid grid-cols-2 gap-8 md:grid-cols-5">
            <div data-testid="app-marketplace-page-div-43" className="col-span-2 md:col-span-1">
              <div data-testid="app-marketplace-page-div-44" className="flex items-center gap-2.5">
                <span data-testid="app-marketplace-page-span-15" className="grid h-9 w-9 place-items-center rounded-full bg-amber-500 text-white">
                  ●
                </span>
                <span data-testid="app-marketplace-page-span-16" className="text-xl font-extrabold tracking-tight text-slate-900">
                  CORE
                </span>
              </div>
              <p data-testid="app-marketplace-page-p-11" className="mt-3 max-w-xs text-sm text-slate-500">
                The marketplace for AI agents that run the busywork of your
                business.
              </p>
            </div>

            <FooterGroup title="Product" items={["Marketplace", "For Architects", "Pricing"]} />
            <FooterGroup title="Company" items={["About", "Blog", "Contact"]} />
            <FooterGroup title="Resources" items={["Docs", "Help center", "Status"]} />
            <FooterGroup title="Legal" items={["Privacy", "Terms", "Security"]} />
          </div>

          <div data-testid="app-marketplace-page-div-45" className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-gray-100 pt-6 sm:flex-row">
            <p data-testid="app-marketplace-page-p-12" className="text-sm text-slate-400">
              © {new Date().getFullYear()} CORE AI Agent Platform. All rights
              reserved.
            </p>
            <div data-testid="app-marketplace-page-div-46" className="flex items-center gap-3 text-sm text-slate-400">
              <span data-testid="app-marketplace-page-span-17">X</span>
              <span data-testid="app-marketplace-page-span-18">LinkedIn</span>
              <span data-testid="app-marketplace-page-span-19">GitHub</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div data-testid="app-marketplace-page-div-47" className="flex items-center gap-2">
      <span data-testid="app-marketplace-page-span-20" className="font-bold text-slate-900">{value}</span>
      <span data-testid="app-marketplace-page-span-21" className="text-slate-500">{label}</span>
    </div>
  );
}

function Message({
  children,
  mine
}: {
  children: React.ReactNode;
  mine?: boolean;
}) {
  return (
    <div data-testid="app-marketplace-page-div-48"
      className={`max-w-[82%] rounded-2xl px-3 py-2 shadow-sm ${
        mine
          ? "ml-auto rounded-br-md bg-amber-500 text-white"
          : "mr-auto rounded-bl-md bg-white text-slate-700"
      }`}
    >
      {children}
    </div>
  );
}

function AgentGridCard({ agent }: { agent: Agent }) {
  return (
    <article data-testid="app-marketplace-page-article-1" className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div data-testid="app-marketplace-page-div-49" className="flex-1 p-6">
        <div data-testid="app-marketplace-page-div-50" className="flex items-start justify-between">
          <span data-testid="app-marketplace-page-span-22" className="grid h-12 w-12 place-items-center rounded-xl bg-amber-50 text-xl ring-1 ring-amber-100">
            🤖
          </span>
          <span data-testid="app-marketplace-page-span-23" className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white">
            ${agent.price}
          </span>
        </div>

        <h3 data-testid="app-marketplace-page-h3-2" className="mt-4 flex items-center gap-2 text-lg font-bold text-slate-900">
          {agent.name}
          {agent.isNew ? (
            <span data-testid="app-marketplace-page-span-24" className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
              New
            </span>
          ) : null}
        </h3>

        <div data-testid="app-marketplace-page-div-51" className="mt-2 flex flex-wrap gap-2">
          <span data-testid="app-marketplace-page-span-25" className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-slate-600">
            {agent.category}
          </span>
          <span data-testid="app-marketplace-page-span-26" className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            {agent.industry === "all" ? "All industries" : agent.industry}
          </span>
        </div>

        <p data-testid="app-marketplace-page-p-13" className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600">
          {agent.description}
        </p>
      </div>

      <div data-testid="app-marketplace-page-div-52" className="flex items-center justify-between gap-2 border-t border-gray-50 bg-gray-50/60 px-6 py-3">
        <span data-testid="app-marketplace-page-span-27" className="text-xs text-slate-500">{agent.installs} installs</span>
        <span data-testid="app-marketplace-page-span-28" className="text-xs font-semibold text-amber-600">
          ⭐ {agent.rating.toFixed(1)}
        </span>
        <span data-testid="app-marketplace-page-span-29" className="truncate text-xs text-slate-500">By {agent.author}</span>
      </div>

      <div data-testid="app-marketplace-page-div-53" className="px-6 pb-6 pt-4">
        <button data-testid="app-marketplace-page-button-8" className="w-full rounded-xl border-2 border-amber-500 py-2.5 font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white">
          View details
        </button>
      </div>
    </article>
  );
}

function AgentListCard({ agent }: { agent: Agent }) {
  return (
    <article data-testid="app-marketplace-page-article-2" className="group flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg sm:flex-row sm:items-center">
      <span data-testid="app-marketplace-page-span-30" className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-amber-50 text-xl ring-1 ring-amber-100">
        🤖
      </span>

      <div data-testid="app-marketplace-page-div-54" className="min-w-0 flex-1">
        <div data-testid="app-marketplace-page-div-55" className="flex flex-wrap items-center gap-2">
          <h3 data-testid="app-marketplace-page-h3-3" className="text-base font-bold text-slate-900">{agent.name}</h3>
          <span data-testid="app-marketplace-page-span-31" className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
            {agent.category}
          </span>
          {agent.isNew ? (
            <span data-testid="app-marketplace-page-span-32" className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-amber-700">
              New
            </span>
          ) : null}
        </div>

        <p data-testid="app-marketplace-page-p-14" className="mt-1.5 line-clamp-2 text-sm text-slate-600">
          {agent.description}
        </p>

        <div data-testid="app-marketplace-page-div-56" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span data-testid="app-marketplace-page-span-33">{agent.installs} installs</span>
          <span data-testid="app-marketplace-page-span-34" className="font-semibold text-amber-600">
            ⭐ {agent.rating.toFixed(1)}
          </span>
          <span data-testid="app-marketplace-page-span-35">By {agent.author}</span>
        </div>
      </div>

      <div data-testid="app-marketplace-page-div-57" className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-3">
        <span data-testid="app-marketplace-page-span-36" className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white">
          ${agent.price}
        </span>
        <button data-testid="app-marketplace-page-button-9" className="rounded-xl border-2 border-amber-500 px-5 py-2 text-sm font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white">
          View details
        </button>
      </div>
    </article>
  );
}

function TrustItem({ text }: { text: string }) {
  return (
    <div data-testid="app-marketplace-page-div-58" className="flex items-center gap-2">
      <span data-testid="app-marketplace-page-span-37" className="text-amber-400">✓</span>
      {text}
    </div>
  );
}

function FooterGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div data-testid="app-marketplace-page-div-59">
      <h4 data-testid="app-marketplace-page-h4-1" className="text-sm font-semibold text-slate-900">{title}</h4>
      <ul data-testid="app-marketplace-page-ul-1" className="mt-3 space-y-2">
        {items.map((item) => (
          <li data-testid="app-marketplace-page-li-1" key={item}>
            <Link data-testid="app-marketplace-page-link-7"
              href="#"
              className="text-sm text-slate-500 transition hover:text-amber-600"
            >
              {item}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}