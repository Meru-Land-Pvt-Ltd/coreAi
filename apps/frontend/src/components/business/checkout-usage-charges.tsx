"use client";

import { useState } from "react";
import { formatUsdRate } from "./execution-pricing-summary";

export type CheckoutUsageRate = {
  code: string;
  invoiceLabel: string;
  unit: "PER_MINUTE" | "PER_SMS" | "PER_CALL" | "PER_UNIT";
  billingRateUsd: number;
};

function usageUnitLabel(unit: CheckoutUsageRate["unit"]) {
  if (unit === "PER_MINUTE") return "/ min";
  if (unit === "PER_SMS") return "per SMS";
  if (unit === "PER_CALL") return "per call";
  return "/ unit";
}

export function CheckoutUsageCharges({
  services
}: {
  services: CheckoutUsageRate[];
}) {
  const [open, setOpen] = useState(false);

  if (!services.length) return null;

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
          {services.map((service) => (
            <div
              key={service.code}
              className="flex items-center justify-between gap-4 border-b border-gray-100 px-3.5 py-3 last:border-b-0"
              data-testid={`checkout-usage-service-${service.code}`}
            >
              <span className="min-w-0 text-sm text-slate-600">
                {service.invoiceLabel}
              </span>
              <span className="tnum shrink-0 text-sm font-semibold text-slate-800">
                {formatUsdRate(service.billingRateUsd)} {usageUnitLabel(service.unit)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
