"use client";

import { useState } from "react";
import { formatUsdRate } from "./execution-pricing-summary";

export type CheckoutUsageRate = {
  code: string;
  invoiceLabel: string;
  unit: "PER_MINUTE" | "PER_SMS" | "PER_CALL" | "PER_UNIT";
  billingRateUsd: number;
  showInPhoneCallBreakdown: boolean;
};

export function CheckoutUsageCharges({
  services
}: {
  services: CheckoutUsageRate[];
}) {
  const [open, setOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const phoneCallServices = services.filter(
    (service) =>
      service.showInPhoneCallBreakdown && service.unit === "PER_MINUTE"
  );
  const phoneCallTotal = phoneCallServices.reduce(
    (total, service) => total + service.billingRateUsd,
    0
  );

  if (!phoneCallServices.length) return null;

  return (
    <div
      className="border-b border-gray-50 px-6 py-4"
      data-testid="checkout-usage-charges"
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
        aria-controls="checkout-usage-charge-list"
        data-testid="checkout-usage-charges-toggle"
      >
        <span>
          <span className="block text-sm font-semibold text-slate-700">Usage charges</span>
          <span className="mt-0.5 block text-xs text-slate-400">
            Billed separately based on actual usage
          </span>
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        >
          <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          id="checkout-usage-charge-list"
          className="mt-4 overflow-hidden rounded-xl border border-gray-100 bg-slate-50/70"
        >
          <div className="px-3.5 py-3">
            <div className="flex items-center justify-between gap-4">
              <span className="min-w-0 text-sm font-medium text-slate-700">
                Phone Call Minutes
              </span>
              <span
                className="tnum shrink-0 text-sm font-semibold text-slate-800"
                data-testid="checkout-phone-call-total"
              >
                {formatUsdRate(phoneCallTotal)} / min
              </span>
            </div>

            <button
              type="button"
              onClick={() => setBreakdownOpen((current) => !current)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700"
              aria-expanded={breakdownOpen}
              aria-controls="checkout-phone-call-breakdown"
              data-testid="checkout-phone-call-breakdown-toggle"
            >
              {breakdownOpen ? "Hide breakdown" : "View breakdown"}
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className={`h-3.5 w-3.5 transition-transform ${
                  breakdownOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              >
                <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {breakdownOpen ? (
            <div
              id="checkout-phone-call-breakdown"
              className="border-t border-gray-100 bg-white"
            >
              {phoneCallServices.map((service) => (
                <div
                  key={service.code}
                  className="flex items-center justify-between gap-4 border-b border-gray-100 px-3.5 py-3 last:border-b-0"
                  data-testid={`checkout-usage-service-${service.code}`}
                >
                  <span className="min-w-0 text-sm text-slate-600">
                    {service.invoiceLabel}
                  </span>
                  <span className="tnum shrink-0 text-sm font-semibold text-slate-800">
                    {formatUsdRate(service.billingRateUsd)} / min
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
