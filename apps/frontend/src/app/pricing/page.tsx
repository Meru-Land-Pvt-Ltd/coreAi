"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { CoreHeader } from "@/components/common/header";
import { CoreFooter } from "@/components/common/footer";
import {
  ASSIGNMENT_PATH,
  BUSINESS_LOGIN_PATH,
  BUSINESS_MARKETPLACE_PATH
} from "@/lib/routes";

const pricingSteps = [
  {
    title: "Choose Your Agent",
    description:
      "Browse the marketplace. Each agent has a one-time price set by its builder.",
    badge: "$49 — $500",
    icon: "grid"
  },
  {
    title: "Agent Works 24/7",
    description:
      "Your agent handles calls, texts, and bookings automatically. Every action = one execution.",
    badge: "Active",
    icon: "bolt"
  },
  {
    title: "Pay Per Execution",
    description:
      "No monthly fee. If it runs 0 times, you pay $0. Only pay when it delivers value.",
    badge: undefined,
    icon: "gauge"
  }
] as const;

const executionFees = [
  { title: "SMS Text Message", price: "$0.15", icon: "message" },
  { title: "Phone Call", subtitle: "outbound", price: "$0.50", icon: "phone" },
  { title: "Email Send", price: "$0.10", icon: "mail" },
  { title: "Appointment Booking", price: "$0.25", icon: "calendar" },
  { title: "Lead Capture & CRM Update", price: "$0.10", icon: "database" },
  { title: "AI Conversation", subtitle: "multi-turn", price: "$0.30", icon: "chat" }
] as const;

const priceOptions = [49, 100, 149, 249, 499];

const faqItems = [
  {
    question: "Is there a monthly subscription?",
    answer:
      "No. Buy the agent once, then pay per execution only — there’s no recurring subscription."
  },
  {
    question: "What counts as one execution?",
    answer:
      "One complete action: one text sent, one call placed, or one booking made."
  },
  {
    question: "What if my agent doesn’t run?",
    answer:
      "You pay $0. There are zero minimum fees — you’re only charged for actions the agent actually performs."
  },
  {
    question: "Can I set a spending cap?",
    answer:
      "Yes. Set a maximum monthly budget and the agent automatically pauses when it’s reached."
  },
  {
    question: "Do I own the agent forever?",
    answer:
      "Yes — lifetime access. The only ongoing charges are execution fees when it works for you."
  },
  {
    question: "What about agent updates?",
    answer:
      "Free forever. Architects push improvements automatically — you always run the latest version."
  },
  {
    question: "What’s your refund policy?",
    answer:
      "30-day money-back guarantee on all agent purchases — no questions asked."
  }
];

export default function PricingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(true);
  const [agentPrice, setAgentPrice] = useState(100);
  const [executions, setExecutions] = useState(200);
  const [feeCents, setFeeCents] = useState(20);
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 8);

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const fee = feeCents / 100;
  const monthlyCost = executions * fee;
  const revenueRecovered = executions * 12;
  const roi = monthlyCost > 0 ? ((revenueRecovered - monthlyCost) / monthlyCost) * 100 : 0;

  const execPercent = getRangePercent(executions, 50, 1000);
  const feePercent = getRangePercent(feeCents, 10, 50);

  return (
    <div className="min-h-screen bg-white font-sans text-slate-600 antialiased selection:bg-amber-500/20 selection:text-slate-900">
      <CoreHeader
        navTop={0}
        navScrolled={navScrolled}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
      />

      <main>
        <section className="relative px-6 pb-24 pt-36 md:pt-40">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(55%_60%_at_50%_0%,rgba(245,158,11,0.09),rgba(255,255,255,0)_72%)]" />

          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Simple, transparent pricing
            </span>

            <h1 className="mt-6 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Pay for Results. Not Promises.
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-pretty text-xl leading-relaxed text-slate-600">
              Buy an agent once. Pay only when it works for you. No subscriptions, no
              monthly fees, no surprises.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="#free-trial"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-base font-semibold text-slate-950 shadow-[0_0_48px_-8px_rgba(245,158,11,0.25)] transition duration-200 hover:scale-[1.03] hover:bg-amber-400 sm:w-auto"
              >
                Start Free Trial
                <ArrowIcon />
              </Link>

              <Link
                href="#calculator"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 px-7 py-3.5 text-base font-semibold text-slate-700 transition duration-200 hover:border-amber-400 hover:text-amber-600 sm:w-auto"
              >
                See the calculator
              </Link>
            </div>
          </div>

          <div className="mx-auto mt-14 grid max-w-2xl gap-5 sm:grid-cols-2">
            <div className="rounded-2xl border border-gray-100 bg-white p-7 text-center shadow-xl transition duration-200 hover:-translate-y-1">
              <p className="text-sm font-medium text-slate-500">Average ROI</p>
              <div className="mt-2 text-5xl font-black tracking-tight text-amber-600">
                2,150%
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-7 text-center shadow-xl transition duration-200 hover:-translate-y-1">
              <p className="text-sm font-medium text-slate-500">Average monthly cost</p>
              <div className="mt-2 text-5xl font-black tracking-tight text-slate-900">
                $40
              </div>
              <p className="mt-1 text-sm text-slate-500">
                vs <s className="text-slate-400">$3,200</s> for a receptionist
              </p>
            </div>
          </div>
        </section>

        <section className="px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                How pricing works
              </h2>
              <p className="mt-3 text-lg text-slate-600">
                Three simple steps. Zero monthly commitment.
              </p>
            </div>

            <div className="mt-14 grid gap-6 md:grid-cols-3">
              {pricingSteps.map((step) => (
                <div
                  key={step.title}
                  className="group rounded-2xl border border-gray-100 bg-white p-8 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                    <StepIcon name={step.icon} />
                  </div>

                  <h3 className="mt-6 text-xl font-semibold text-slate-900">
                    {step.title}
                  </h3>

                  <p className="mt-2 leading-relaxed text-slate-600">
                    {step.description}
                  </p>

                  {step.badge ? (
                    <span
                      className={`mt-5 inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${
                        step.badge === "Active"
                          ? "gap-2 border border-gray-200 bg-white text-slate-700"
                          : "border border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      {step.badge === "Active" ? (
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                        </span>
                      ) : null}
                      {step.badge}
                    </span>
                  ) : (
                    <div className="mt-5">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>0 runs</span>
                        <span>pay as you go</span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                        <div className="h-2 w-2/5 rounded-full bg-amber-500" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-gray-50 px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                Transparent execution pricing
              </h2>
              <p className="mt-3 text-lg text-slate-600">
                Every action has a clear, fixed cost. No surprises.
              </p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {executionFees.map((item) => (
                <div
                  key={item.title}
                  className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-center gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                      <FeeIcon name={item.icon} />
                    </span>

                    <span className="font-semibold text-slate-900">
                      {item.title}
                      {"subtitle" in item && item.subtitle ? (
                        <span className="font-normal text-slate-500">
                          {" "}
                          ({item.subtitle})
                        </span>
                      ) : null}
                    </span>
                  </div>

                  <span className="text-2xl font-extrabold tracking-tight text-amber-600">
                    {item.price}
                  </span>
                </div>
              ))}
            </div>

            <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-500">
              Fees cover AI processing, API calls, and infrastructure. Volume discounts at
              1,000+ executions/month.
            </p>
          </div>
        </section>

        <section id="calculator" className="scroll-mt-24 px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                Estimate your monthly cost
              </h2>
              <p className="mt-3 text-lg text-slate-600">
                See exactly what you&apos;d pay based on your usage.
              </p>
            </div>

            <div className="mt-12 grid gap-8 lg:grid-cols-2 lg:items-stretch">
              <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
                <div>
                  <span className="text-sm font-medium text-slate-700">
                    Agent one-time price
                  </span>

                  <div className="mt-3 flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1">
                    {priceOptions.map((price) => (
                      <button
                        key={price}
                        type="button"
                        onClick={() => setAgentPrice(price)}
                        className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                          agentPrice === price
                            ? "bg-amber-500 text-slate-950 shadow-sm"
                            : "text-slate-600 hover:bg-white"
                        }`}
                      >
                        ${price}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-9">
                  <label className="text-sm font-medium text-slate-700" htmlFor="exec-slider">
                    Estimated executions per month
                  </label>

                  <div className="relative pt-9">
                    <div
                      className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-bold text-slate-950 shadow-sm"
                      style={{ left: `${execPercent}%` }}
                    >
                      {executions.toLocaleString("en-US")}
                    </div>

                    <input
                      id="exec-slider"
                      type="range"
                      min={50}
                      max={1000}
                      step={10}
                      value={executions}
                      onChange={(event) => setExecutions(Number(event.target.value))}
                      className={rangeInputClass}
                      style={rangeStyle(execPercent)}
                      aria-label="Estimated executions per month"
                    />

                    <div className="mt-2 flex justify-between text-xs text-slate-400">
                      <span>50</span>
                      <span>1,000</span>
                    </div>
                  </div>
                </div>

                <div className="mt-7">
                  <label className="text-sm font-medium text-slate-700" htmlFor="fee-slider">
                    Average fee per execution
                  </label>

                  <div className="relative pt-9">
                    <div
                      className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-bold text-slate-950 shadow-sm"
                      style={{ left: `${feePercent}%` }}
                    >
                      ${(feeCents / 100).toFixed(2)}
                    </div>

                    <input
                      id="fee-slider"
                      type="range"
                      min={10}
                      max={50}
                      step={1}
                      value={feeCents}
                      onChange={(event) => setFeeCents(Number(event.target.value))}
                      className={rangeInputClass}
                      style={rangeStyle(feePercent)}
                      aria-label="Average fee per execution in cents"
                    />

                    <div className="mt-2 flex justify-between text-xs text-slate-400">
                      <span>$0.10</span>
                      <span>$0.50</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col rounded-2xl border border-amber-200 bg-amber-50 p-8 shadow-[0_0_48px_-8px_rgba(245,158,11,0.25)]">
                <p className="text-sm text-slate-500">
                  One-time agent cost:{" "}
                  <span className="font-semibold text-slate-700">
                    ${agentPrice.toLocaleString("en-US")}
                  </span>{" "}
                  <span className="text-slate-400">· billed once</span>
                </p>

                <div className="mt-5">
                  <p className="text-sm font-medium text-slate-500">
                    Monthly execution cost
                  </p>
                  <p className="mt-1 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
                    {money(monthlyCost)}
                  </p>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                    <ArrowUpIcon />
                  </span>

                  <div>
                    <p className="text-sm font-medium text-slate-500">
                      Est. revenue recovered
                    </p>
                    <p className="text-2xl font-bold text-emerald-600">
                      {money(revenueRecovered)}
                      <span className="text-base font-medium">/mo</span>
                    </p>
                  </div>
                </div>

                <div className="mt-6 rounded-xl border border-amber-200 bg-white p-5 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Your ROI
                  </p>
                  <p className="mt-1 text-5xl font-black tracking-tight text-amber-600">
                    {Math.round(roi).toLocaleString("en-US")}%
                  </p>
                </div>

                <Link
                  href="#free-trial"
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-base font-semibold text-slate-950 shadow-[0_0_48px_-8px_rgba(245,158,11,0.25)] transition duration-200 hover:scale-[1.02] hover:bg-amber-400"
                >
                  Start free — first 50 executions on us
                  <ArrowIcon />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-gray-50 px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                Why CORE wins
              </h2>
              <p className="mt-3 text-lg text-slate-600">
                Same job. A fraction of the cost — and it never clocks out.
              </p>
            </div>

            <div className="mt-12 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-6 py-4">Solution</th>
                      <th className="px-6 py-4">Monthly cost</th>
                      <th className="px-6 py-4">Availability</th>
                      <th className="px-6 py-4">Personalization</th>
                      <th className="px-6 py-4">Setup time</th>
                    </tr>
                  </thead>

                  <tbody className="text-sm">
                    <CompareRow
                      solution="Hire a Receptionist"
                      cost="$3,200/mo"
                      availability="Business hours only"
                      personalization="Generic"
                      setup="2–4 weeks"
                    />
                    <CompareRow
                      solution="Answering Service"
                      cost="$800/mo"
                      availability="Limited hours"
                      personalization="Script-based"
                      setup="1 week"
                    />
                    <CompareRow
                      solution="Other AI Platforms"
                      cost="$200–500/mo subscription"
                      availability="24/7"
                      personalization="Limited"
                      setup="Days"
                    />

                    <tr className="border-l-4 border-amber-500 bg-amber-50">
                      <td className="px-6 py-5 font-extrabold text-slate-900">CORE</td>
                      <td className="px-6 py-5 font-extrabold text-amber-700">
                        $40–80/mo{" "}
                        <span className="font-medium text-slate-500">average</span>
                      </td>
                      <td className="px-6 py-5 font-semibold text-slate-900">24/7</td>
                      <td className="px-6 py-5 font-semibold text-slate-900">
                        Fully personalized AI
                      </td>
                      <td className="px-6 py-5 font-semibold text-slate-900">2 minutes</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                Volume discounts
              </h2>
              <p className="mt-3 text-lg text-slate-600">
                The more your agents work, the less each execution costs.
              </p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <DiscountCard title="Standard" range="1–500 / mo" value="Base rates" />
              <DiscountCard title="Growth" range="500–1K / mo" value="10% off" popular />
              <DiscountCard title="Scale" range="1K–5K / mo" value="20% off" />
              <DiscountCard title="Enterprise" range="5K+ / mo" value="Custom" enterprise />
            </div>
          </div>
        </section>

        <section id="free-trial" className="scroll-mt-24 px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-2xl rounded-3xl bg-gradient-to-br from-amber-300 to-amber-100 p-[2px] shadow-[0_0_48px_-8px_rgba(245,158,11,0.25)]">
            <div className="rounded-[calc(1.5rem-2px)] bg-white px-6 py-12 text-center sm:px-12">
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                Try before you pay
              </h2>

              <ul className="mx-auto mt-8 max-w-sm space-y-4 text-left">
                {[
                  "First 50 executions completely free",
                  "No credit card required",
                  "Full functionality — zero feature limits"
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <CheckCircle />
                    <span className="text-slate-700">{item}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={BUSINESS_LOGIN_PATH}
                className="mt-9 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-9 py-4 text-lg font-semibold text-slate-950 shadow-[0_0_90px_-10px_rgba(245,158,11,0.3)] transition duration-200 hover:scale-[1.03] hover:bg-amber-400"
              >
                Start Free Trial
                <ArrowIcon className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </section>

        <section className="bg-gray-50 px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-3xl">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                Frequently asked questions
              </h2>
            </div>

            <div className="mt-10 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="divide-y divide-gray-100 px-6">
                {faqItems.map((item) => {
                  const open = openFaq === item.question;

                  return (
                    <div key={item.question}>
                      <button
                        type="button"
                        onClick={() => setOpenFaq(open ? null : item.question)}
                        className="flex w-full items-center justify-between gap-4 py-5 text-left"
                        aria-expanded={open}
                      >
                        <span className="text-base font-semibold text-slate-900 sm:text-lg">
                          {item.question}
                        </span>

                        <ChevronIcon open={open} />
                      </button>

                      <div
                        className={`overflow-hidden transition-all duration-300 ${
                          open ? "max-h-80" : "max-h-0"
                        }`}
                      >
                        <p className="pb-5 pr-6 leading-relaxed text-slate-600">
                          {item.answer}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-slate-900 px-6 py-24">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-64 -translate-y-1/2 bg-[radial-gradient(50%_70%_at_50%_50%,rgba(245,158,11,0.22),transparent_70%)]" />

          <div className="relative mx-auto max-w-3xl text-center">
            <h2 className="text-balance text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
              Ready to Stop Overpaying for Automation?
            </h2>

            <p className="mx-auto mt-4 max-w-xl text-lg text-slate-300">
              Browse 50+ agents. Buy once. Pay only when they deliver.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={BUSINESS_MARKETPLACE_PATH}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-slate-950 shadow-[0_0_90px_-10px_rgba(245,158,11,0.3)] transition duration-200 hover:scale-[1.03] hover:bg-amber-400 sm:w-auto"
              >
                Explore Marketplace
                <ArrowIcon className="h-5 w-5" />
              </Link>

              <Link
                href={ASSIGNMENT_PATH}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/30 px-8 py-4 text-base font-semibold text-white transition duration-200 hover:scale-[1.03] hover:bg-white/10 sm:w-auto"
              >
                Take Free Assessment
              </Link>
            </div>
          </div>
        </section>
      </main>

      <CoreFooter />
    </div>
  );
}

const rangeInputClass =
  "h-2 w-full cursor-pointer appearance-none rounded-full bg-transparent accent-amber-500 focus:outline-none [&::-webkit-slider-thumb]:h-[26px] [&::-webkit-slider-thumb]:w-[26px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-amber-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_8px_rgba(0,0,0,0.18)] [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110";

function getRangePercent(value: number, min: number, max: number) {
  return ((value - min) / (max - min)) * 100;
}

function rangeStyle(percent: number) {
  return {
    background: `linear-gradient(to right, #f59e0b 0%, #f59e0b ${percent}%, #e5e7eb ${percent}%, #e5e7eb 100%)`
  } as CSSProperties;
}

function money(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function CompareRow({
  solution,
  cost,
  availability,
  personalization,
  setup
}: {
  solution: string;
  cost: string;
  availability: string;
  personalization: string;
  setup: string;
}) {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-6 py-5 font-semibold text-slate-900">{solution}</td>
      <td className="px-6 py-5">
        <s className="text-slate-400">{cost}</s>
      </td>
      <td className="px-6 py-5 text-slate-600">{availability}</td>
      <td className="px-6 py-5 text-slate-600">{personalization}</td>
      <td className="px-6 py-5 text-slate-600">{setup}</td>
    </tr>
  );
}

function DiscountCard({
  title,
  range,
  value,
  popular,
  enterprise
}: {
  title: string;
  range: string;
  value: string;
  popular?: boolean;
  enterprise?: boolean;
}) {
  return (
    <div
      className={`relative rounded-2xl bg-white p-6 transition duration-200 hover:-translate-y-1 ${
        popular
          ? "border-2 border-amber-400 shadow-[0_0_48px_-8px_rgba(245,158,11,0.25)]"
          : "border border-gray-100 shadow-sm hover:shadow-md"
      }`}
    >
      {popular ? (
        <span className="absolute -top-3 left-6 rounded-full bg-amber-500 px-3 py-0.5 text-xs font-bold text-slate-950">
          Popular
        </span>
      ) : null}

      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{range}</p>
      <p
        className={`mt-4 text-2xl font-extrabold tracking-tight ${
          value.includes("off") ? "text-amber-600" : "text-slate-900"
        }`}
      >
        {value}
      </p>

      {enterprise ? (
        <Link
          href="/#footer"
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-600 transition hover:gap-2.5 hover:text-amber-700"
        >
          Contact Sales
          <ArrowIcon />
        </Link>
      ) : null}
    </div>
  );
}

function CheckCircle() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </span>
  );
}

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

function ArrowUpIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5m0 0l-6 6m6-6l6 6" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-5 w-5 shrink-0 text-amber-500 transition-transform duration-300 ${
        open ? "rotate-180" : ""
      }`}
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
  );
}

function StepIcon({ name }: { name: "grid" | "bolt" | "gauge" }) {
  if (name === "bolt") {
    return (
      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3.75 13.5 14.25 2.25 12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
      </svg>
    );
  }

  if (name === "gauge") {
    return (
      <svg
        className="h-7 w-7"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 17a7 7 0 1 1 14 0" />
        <path d="M12 17l3.5-3" />
        <circle cx="12" cy="17" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  return (
    <svg
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
    </svg>
  );
}

function FeeIcon({
  name
}: {
  name: "message" | "phone" | "mail" | "calendar" | "database" | "chat";
}) {
  const common = {
    className: "h-5 w-5",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  if (name === "phone") {
    return (
      <svg {...common}>
        <path d="M3 5a2 2 0 0 1 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a2 2 0 0 1-2 2A16 16 0 0 1 3 5z" />
      </svg>
    );
  }

  if (name === "mail") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg {...common}>
        <path d="M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
      </svg>
    );
  }

  if (name === "database") {
    return (
      <svg {...common}>
        <path d="M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z" />
        <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
        <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </svg>
    );
  }

  if (name === "chat") {
    return (
      <svg {...common}>
        <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
        <circle cx="8.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="10.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="15.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    </svg>
  );
}