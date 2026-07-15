import { useState } from "react";
import type { AgentConfigurePricing, AgentPricingModel } from "@coreai/shared";

const PRICING_MODELS: {
  key: AgentPricingModel;
  label: string;
  description: string;
  testId: string;
}[] = [
  {
    key: "free",
    label: "Free",
    description: "No charge — grow installs and reviews",
    testId: "configure-pricing-free",
  },
  {
    key: "one_time",
    label: "One-time purchase",
    description: "Single upfront payment",
    testId: "configure-pricing-onetime",
  },
  {
    key: "subscription",
    label: "Monthly subscription",
    description: "Recurring revenue per install",
    testId: "configure-pricing-monthly",
  },
];

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
                className={
                  active
                    ? "relative rounded-2xl border-2 border-amber-400 bg-amber-50/50 px-4 py-4 text-left shadow-[0_12px_30px_-10px_rgba(245,158,11,.45)] transition-all disabled:opacity-60"
                    : "relative rounded-2xl border-2 border-gray-100 bg-white px-4 py-4 text-left transition-all hover:border-amber-200 disabled:opacity-60"
                }
              >
                <span
                  className={
                    active
                      ? "absolute right-3 top-3 flex h-5 w-5 scale-100 items-center justify-center rounded-full bg-amber-500 text-white opacity-100 transition-all"
                      : "absolute right-3 top-3 flex h-5 w-5 scale-75 items-center justify-center rounded-full bg-amber-500 text-white opacity-0 transition-all"
                  }
                >
                  <svg
                    className="h-3 w-3"
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
                <span className="block text-sm font-semibold text-slate-900">
                  {model.label}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
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
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-slate-400">
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
                className="w-full rounded-xl border border-gray-100 bg-gray-50/40 py-3 pl-8 pr-4 text-base font-bold text-slate-900 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:opacity-60"
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Similar agents:{" "}
              <span className="font-semibold text-slate-500">$75–$150</span>
            </p>
          </div>
        </div>
      ) : null}

      {!isFree ? (
      <div className="rounded-2xl border border-gray-100 bg-gray-50/40 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              Offer a free trial
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Trials lift conversion by roughly 40% on paid agents.
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
            <p className="mb-2 text-xs font-semibold text-slate-600">
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
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-6 text-white shadow-xl sm:p-7"
        data-testid="configure-revenue-preview"
      >
        <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
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
              <p className="text-sm text-slate-300">
                At{" "}
                <span className="font-semibold text-white">
                  {installs.toLocaleString("en-US")}
                </span>{" "}
                installs, you&apos;d earn
              </p>
              <p className="mt-1 flex items-baseline gap-2">
                <span
                  className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent text-[44px] font-extrabold leading-none tracking-tight sm:text-[52px]"
                  data-testid="configure-revenue-earnings"
                >
                  {formatMoney(architectEarnings)}
                </span>
                {pricing.pricingModel === "subscription" ? (
                  <span className="text-sm font-bold text-slate-400 uppercase tracking-wide">
                    / month
                  </span>
                ) : null}
              </p>
            </div>
            <div className="text-right">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> You
                keep {keepPercent}%
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Triven takes {commission}% ·{" "}
                <span className="font-semibold text-slate-300">
                  {formatMoney(platformCut)}
                </span>
              </p>
            </div>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
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
