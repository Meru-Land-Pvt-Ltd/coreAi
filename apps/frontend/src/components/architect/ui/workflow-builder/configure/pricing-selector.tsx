import { useState } from "react";
import type { AgentConfigurePricing, AgentPricingModel } from "@coreai/shared";

const PRICING_MODELS: {
  key: AgentPricingModel;
  label: string;
  description: string;
  testId: string;
  recommended?: boolean;
  icon: "free" | "one_time" | "subscription";
}[] = [
  {
    key: "free",
    label: "Free",
    description: "No charge - grow installs and reviews",
    testId: "configure-pricing-free",
    icon: "free",
  },
  {
    key: "one_time",
    label: "One-time purchase",
    description: "Single upfront payment",
    testId: "configure-pricing-onetime",
    recommended: true,
    icon: "one_time",
  },
  {
    key: "subscription",
    label: "Monthly subscription",
    description: "Recurring revenue per install",
    testId: "configure-pricing-monthly",
    icon: "subscription",
  },
];

function PricingModelIcon({ type }: { type: "free" | "one_time" | "subscription" }) {
  if (type === "free") {
    return (
      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.6 7.4 12 16 8 12" />
        <circle cx="12" cy="12" r="9.5" />
      </svg>
    );
  }
  if (type === "subscription") {
    return (
      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    );
  }
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h18l-1.4 11.1A2 2 0 0 1 17.6 20H6.4a2 2 0 0 1-2-1.9L3 7Z" />
      <path d="M8 7V5a4 4 0 0 1 8 0v2" />
    </svg>
  );
}

const TRIAL_DAY_OPTIONS = [3, 7, 14];

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function PricingSelector({
  pricing,
  onChange,
  disabled = false,
}: {
  pricing: AgentConfigurePricing;
  onChange: (next: Partial<AgentConfigurePricing>) => void;
  disabled?: boolean;
}) {
  const [installs, setInstalls] = useState(100);

  const isFree = pricing.pricingModel === "free";
  const commission = pricing.platformCommissionPercent;
  const keepPercent = 100 - commission;
  const gross = isFree ? 0 : pricing.price * installs;
  const architectEarnings = (gross * keepPercent) / 100;
  const platformCut = gross - architectEarnings;

  return (
    <div className="space-y-8">
      <fieldset>
        <legend className="mb-3 text-[13.5px] font-semibold text-slate-700">
          Pricing model
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {PRICING_MODELS.map((model) => {
            const active = pricing.pricingModel === model.key;

            return (
              <button
                key={model.key}
                type="button"
                data-testid={model.testId}
                aria-pressed={active}
                disabled={disabled}
                onClick={() => onChange({ pricingModel: model.key, ...(model.key === "free" ? { freeTrialEnabled: false } : {}) })}
                className="price-card relative rounded-2xl border-2 border-gray-100 bg-white p-4 text-left hover:border-gray-200 disabled:opacity-60"
              >
                {model.recommended ? (
                  <span className="shadow-amber-sm absolute -top-2.5 left-4 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    Recommended
                  </span>
                ) : null}
                <span className="price-check absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500">
                  <svg
                    className="h-3 w-3 text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
                  <PricingModelIcon type={model.icon} />
                </span>
                <span className="block text-[14px] font-bold text-slate-900">
                  {model.label}
                </span>
                <span className="mt-0.5 block text-[12px] text-slate-400">
                  {model.description}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {!isFree ? (
        <div className="grid gap-7 sm:grid-cols-2">
          <div>
            <label
              className="mb-2 block text-[13.5px] font-semibold text-slate-700"
              htmlFor="configure-price"
            >
              Price{" "}
              {pricing.pricingModel === "subscription"
                ? "(USD / month)"
                : "(USD)"}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[16px] font-semibold text-slate-400">
                $
              </span>
              <input
                id="configure-price"
                data-testid="configure-price-input"
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                value={
                  Number.isFinite(pricing.price) ? String(pricing.price) : ""
                }
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    price: Math.max(0, Number(event.target.value) || 0),
                  })
                }
                className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 py-3 pl-8 pr-4 text-[16px] font-bold text-slate-900 disabled:opacity-60"
              />
            </div>
            {/* "Similar agents: $75–$150" was hardcoded. This component is
                given only the pricing object — it has never seen another
                listing, let alone a similar one. */}
          </div>
        </div>
      ) : null}

      {!isFree ? (
        <div className="rounded-2xl border border-gray-100 bg-gray-50/40 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[14px] font-semibold text-slate-800">
                Offer a free trial
              </p>
              <p className="mt-0.5 text-[12.5px] text-slate-400">
                A trial lets a business try the agent before they pay for it.
              </p>
            </div>
            <button
              type="button"
              data-testid="configure-free-trial-toggle"
              role="switch"
              aria-checked={pricing.freeTrialEnabled}
              disabled={disabled}
              onClick={() =>
                onChange({ freeTrialEnabled: !pricing.freeTrialEnabled })
              }
              className={pricing.freeTrialEnabled ? "toggle on" : "toggle"}
            >
              <span className="knob" />
            </button>
          </div>
          {pricing.freeTrialEnabled ? (
            <div className="mt-4">
              <p className="mb-2 text-[12.5px] font-semibold text-slate-600">
                Trial length
              </p>
              <div
                className="inline-flex gap-2"
                role="radiogroup"
                aria-label="Trial length"
              >
                {TRIAL_DAY_OPTIONS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    data-testid={`configure-trial-days-${days}`}
                    aria-pressed={pricing.trialDays === days}
                    disabled={disabled}
                    onClick={() => onChange({ trialDays: days })}
                    className={
                      pricing.trialDays === days
                        ? "rounded-xl border border-amber-400 bg-amber-50 px-4 py-2 text-[13.5px] font-semibold text-amber-700 transition"
                        : "rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13.5px] font-semibold text-slate-600 transition hover:border-amber-300"
                    }
                  >
                    {days} days
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!isFree ? (
        <div
          className="shadow-lift relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-6 text-white sm:p-7"
          data-testid="configure-revenue-preview"
        >
          <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-amber-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="relative">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-amber-400">
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 3v18h18" />
                <path d="m7 14 3-4 3 2 4-6" />
              </svg>
              Earnings preview
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[14px] text-slate-300">
                  At{" "}
                  <span className="font-semibold text-white">
                    {installs.toLocaleString("en-US")}
                  </span>{" "}
                  installs, you&apos;d earn
                </p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span
                    className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-[44px] font-extrabold leading-none tracking-tight text-transparent sm:text-[52px]"
                    data-testid="configure-revenue-earnings"
                  >
                    {formatMoney(architectEarnings)}
                  </span>
                  {pricing.pricingModel === "subscription" ? (
                    <span className="text-[14px] font-bold uppercase tracking-wide text-slate-400">
                      / month
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="text-right">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[12px] font-semibold">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> You
                  keep {keepPercent}%
                </div>
                <p className="mt-2 text-[12px] text-slate-400">
                  Triven takes {commission}% ·{" "}
                  <span className="font-semibold text-slate-300">
                    {formatMoney(platformCut)}
                  </span>
                </p>
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-[12px] text-slate-400">
                <span>Projected installs</span>
                <span className="font-semibold text-slate-200">
                  {installs.toLocaleString("en-US")} / month
                </span>
              </div>
              <input
                data-testid="configure-installs-range"
                type="range"
                min={10}
                max={1000}
                step={10}
                value={installs}
                onChange={(event) => setInstalls(Number(event.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-amber-500"
              />
              <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
                <span>10</span>
                <span>1,000</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
