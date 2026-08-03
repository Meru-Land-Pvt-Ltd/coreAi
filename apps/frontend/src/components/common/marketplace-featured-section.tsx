"use client";

import type { ReactNode } from "react";

export type MarketplaceFeaturedAgent = {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  industry?: string;
  iconUrl?: string | null;
  pricingModel?: string | null;
  freeTrialEnabled?: boolean | null;
  trialDays?: number | null;
};

export type MarketplaceFeaturedTestIds = {
  root?: string;
  glow?: string;
  badge?: string;
  category?: string;
  title?: string;
  description?: string;
  priceWrap?: string;
  price?: string;
  priceSuffix?: string;
  avatar?: string;
  phoneName?: string;
  activeNow?: string;
};

type MarketplaceFeaturedSectionProps = {
  agent: MarketplaceFeaturedAgent;
  /** Primary CTA (link or button). Caller owns routing / ownership logic. */
  primaryAction: ReactNode;
  /** Optional secondary CTA (e.g. View details on protected marketplace). */
  secondaryAction?: ReactNode;
  testIds?: MarketplaceFeaturedTestIds;
};

type PreviewMessage = {
  mine?: boolean;
  text: string;
};

const PUBLIC_TEST_IDS: Required<MarketplaceFeaturedTestIds> = {
  root: "app-marketplace-page-div-11",
  glow: "app-marketplace-page-div-12",
  badge: "marketplace-featured-text",
  category: "app-marketplace-page-span-6",
  title: "app-marketplace-page-h2-1",
  description: "app-marketplace-page-p-2",
  priceWrap: "app-marketplace-page-div-16",
  price: "app-marketplace-page-span-7",
  priceSuffix: "app-marketplace-page-span-8",
  avatar: "marketplace-bs-text",
  phoneName: "marketplace-bright-smile-dental-text",
  activeNow: "marketplace-active-now-text"
};

function getAgentInitials(name: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "AI";
}

function formatIndustryLabel(industryId: string) {
  if (!industryId || industryId === "all") return "your business";
  return industryId.replace(/[-_]+/g, " ");
}

function getAgentPreviewConversation(agent: MarketplaceFeaturedAgent): PreviewMessage[] {
  const agentName = agent.name.trim() || "our team";
  const industry = agent.industry ?? "all";
  const greeting: PreviewMessage = {
    mine: true,
    text: `Hi! This is ${agentName}. Sorry we missed your call — how can we help?`
  };

  if (industry === "dental") {
    return [
      greeting,
      { text: "Do you have openings this week for a cleaning?" },
      {
        mine: true,
        text: "Yes — Thursday at 10:30 AM or Friday at 2:00 PM. Which works better?"
      },
      { text: "Thursday at 10:30 works." }
    ];
  }

  if (industry === "restaurant") {
    return [
      greeting,
      { text: "Can I book a table for 4 tonight around 7?" },
      {
        mine: true,
        text: "We have 6:45 PM or 7:30 PM for 4. Which time would you like?"
      },
      { text: "7:30 please — last name Patel." }
    ];
  }

  if (industry === "realestate") {
    return [
      greeting,
      { text: "Can I schedule a viewing this weekend?" },
      {
        mine: true,
        text: "Saturday at 11:00 AM or Sunday at 1:30 PM. Which do you prefer?"
      },
      { text: "Saturday 11 works." }
    ];
  }

  if (industry === "plumber" || industry === "hvac" || industry === "electrician") {
    return [
      greeting,
      { text: "My AC isn't cooling — can someone come out this week?" },
      {
        mine: true,
        text: "We have Wednesday 1–3 PM or Thursday 9–11 AM. Which window works?"
      },
      { text: "Wednesday afternoon — 412 Oak St." }
    ];
  }

  if (
    industry === "salon" ||
    industry === "barbershop" ||
    industry === "spa-wellness" ||
    industry === "med-spa"
  ) {
    return [
      greeting,
      { text: "Do you have an opening this week?" },
      {
        mine: true,
        text: "Yes — tomorrow at 4:15 PM or Friday at 11:00 AM. Which would you like?"
      },
      { text: "Tomorrow at 4:15." }
    ];
  }

  if (industry === "legal") {
    return [
      greeting,
      { text: "I'd like a consult about a contract review." },
      {
        mine: true,
        text: "We have Tuesday at 3:00 PM or Wednesday at 10:30 AM. Phone or Zoom?"
      },
      { text: "Tuesday 3, Zoom is fine." }
    ];
  }

  if (industry === "gym-fitness" || industry === "yoga-studio") {
    return [
      greeting,
      { text: "Do you offer a trial or intro class?" },
      {
        mine: true,
        text: "Yes — free intro Thu 6:00 PM or Sat 10:00 AM. Want me to reserve a spot?"
      },
      { text: "Thursday 6 please." }
    ];
  }

  if (industry === "custom") {
    return [
      greeting,
      { text: "Hi! I'm looking for some information." },
      {
        mine: true,
        text: "Of course! I'd be happy to help. What would you like to know?"
      },
      { text: "Can you tell me more about your services?" },
      {
        mine: true,
        text: "Absolutely! We offer a range of services tailored to our customers' needs. Let me know what you're looking for, and I'll guide you."
      },
      { text: "That sounds great. How do I get started?" },
      {
        mine: true,
        text: "Getting started is easy! Just share your requirements, and I'll recommend the best option for you."
      }
    ];
  }

  if (
    industry === "medical" ||
    industry === "medical-clinic" ||
    industry === "urgent-care" ||
    industry === "dermatology" ||
    industry === "physiotherapy" ||
    industry === "chiropractor" ||
    industry === "optometry" ||
    industry === "veterinary"
  ) {
    return [
      greeting,
      { text: "I need to book an appointment — earliest you have?" },
      {
        mine: true,
        text: "Tomorrow at 9:15 AM or Thursday at 3:40 PM. Which works?"
      },
      { text: "Tomorrow morning is perfect." }
    ];
  }

  const industryLabel = formatIndustryLabel(industry);
  const topic = industry === "all" ? "an appointment" : `${industryLabel} help`;

  return [
    greeting,
    { text: `Hi — I called earlier. Can you help with ${topic}?` },
    {
      mine: true,
      text: "Absolutely. Tomorrow at 2:00 PM or Friday at 11:30 AM — which works better?"
    },
    { text: "Tomorrow at 2." }
  ];
}

function Message({ children, mine }: { children: ReactNode; mine?: boolean }) {
  return (
    <div
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

function pricingModelLabel(pricingModel?: string | null) {
  if (pricingModel === "FREE") return "Free to install";
  if (pricingModel === "ONE_TIME") return "One-time purchase";
  return "Monthly subscription";
}

function pricingUsageHint(pricingModel?: string | null) {
  if (pricingModel === "FREE") return "Pay only for usage";
  if (pricingModel === "ONE_TIME") return "Usage charges apply separately";
  return "Usage charges billed separately";
}

export function MarketplaceFeaturedSection({
  agent,
  primaryAction,
  secondaryAction,
  testIds
}: MarketplaceFeaturedSectionProps) {
  const ids = { ...PUBLIC_TEST_IDS, ...testIds };
  const showTrialTrust =
    agent.pricingModel !== "FREE" &&
    Boolean(agent.freeTrialEnabled) &&
    (agent.trialDays ?? 7) > 0;

  return (
    <div data-testid={ids.root} className="relative mx-auto mt-12 max-w-5xl">
      <div data-testid={ids.glow} className="absolute inset-x-8 bottom-2 h-24 rounded-full bg-amber-400/30 blur-2xl" />

      <div className="relative grid items-center gap-8 overflow-hidden rounded-3xl border border-amber-100 bg-white p-7 shadow-[0_30px_80px_-28px_rgba(245,158,11,.55)] sm:p-9 md:grid-cols-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white"
              data-testid={ids.badge}
            >
              ⭐ Featured
            </span>
            <span
              data-testid={ids.category}
              className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
            >
              {agent.category}
            </span>
          </div>

          <h2 data-testid={ids.title} className="mt-4 text-3xl font-extrabold text-slate-900">
            {agent.name}
          </h2>

          <p data-testid={ids.description} className="mt-3 text-slate-600">
            {agent.description}
          </p>

          <div className="mt-5 flex flex-col">
            <div data-testid={ids.priceWrap} className="flex items-end gap-2">
              {agent.pricingModel === "FREE" ? (
                <span className="text-2xl font-black text-slate-900" data-testid={ids.price}>
                  Free
                </span>
              ) : (
                <>
                  <span className="text-2xl font-black text-slate-900" data-testid={ids.price}>
                    ${agent.price}
                  </span>
                  {agent.pricingModel !== "ONE_TIME" ? (
                    <span
                      className="pb-0.5 text-sm text-slate-500"
                      data-testid={ids.priceSuffix}
                    >
                      /month
                    </span>
                  ) : null}
                </>
              )}
            </div>
            <span className="mt-1 text-xs font-semibold text-slate-600">
              {pricingModelLabel(agent.pricingModel)}
            </span>
            <span className="text-[10px] italic text-slate-400">
              {pricingUsageHint(agent.pricingModel)}
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {primaryAction}
            {secondaryAction}
          </div>

          {showTrialTrust ? (
            <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm font-medium text-slate-500 sm:text-base">
              <span className="inline-flex items-center gap-2">
                <span className="text-lg font-bold leading-none text-amber-500">✓</span>
                {agent.trialDays ?? 7}-day free trial
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="text-lg font-bold leading-none text-amber-500">✓</span>
                Cancel anytime
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex justify-center md:justify-end">
          <div className="relative h-[420px] w-[240px] rotate-3 rounded-[2.4rem] border-[10px] border-slate-900 bg-slate-900 shadow-2xl">
            <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[1.7rem] bg-slate-50">
              <div className="flex shrink-0 items-center gap-2.5 bg-white px-4 pb-3 pt-6">
                {agent.iconUrl ? (
                  <span className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-amber-50 ring-1 ring-amber-100">
                    {/* eslint-disable-next-line @next/next/no-img-element -- listing icons may be data URLs */}
                    <img src={agent.iconUrl} alt="" className="h-full w-full object-cover" />
                  </span>
                ) : (
                  <span
                    className="grid h-8 w-8 place-items-center rounded-full bg-amber-500 text-[11px] font-bold text-white"
                    data-testid={ids.avatar}
                  >
                    {getAgentInitials(agent.name)}
                  </span>
                )}
                <div>
                  <p
                    className="text-[13px] font-semibold leading-snug text-slate-900 break-words"
                    data-testid={ids.phoneName}
                  >
                    {agent.name}
                  </p>
                  <p className="text-[10px] text-emerald-500" data-testid={ids.activeNow}>
                    ● Active now
                  </p>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-4 text-[12px] leading-snug [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

                {getAgentPreviewConversation(agent).map((message, index) => (
                  <Message key={`${agent.id}-preview-${index}`} mine={message.mine}>
                    {message.text}
                  </Message>
                ))}
              </div>

              <div className="flex shrink-0 items-center gap-2 border-t border-gray-100 bg-white px-3 py-2.5">
                <div className="flex-1 rounded-full bg-gray-100 px-3 py-1.5 text-[11px] text-slate-400">
                  Text message…
                </div>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-500 text-white">
                  ➤
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
