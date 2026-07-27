"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

/**
 * Reusable buyer-safe execution pricing display.
 *
 * One component renders the dynamic usage rates (voice per minute, SMS per
 * message, phone-number state) on every buyer surface so price formatting is
 * never duplicated. Honest states only:
 *   - loading  → "Loading usage pricing…" (never $0 while loading)
 *   - missing  → "Usage pricing unavailable" (never free / never $0)
 *   - pending  → "Usage pricing pending" (UNPRICED usage awaiting admin action)
 * Vendor actual costs are never part of the payload and never rendered.
 */

export type BuyerExecutionPricing = {
  billingType: "USAGE_BASED";
  unit: "PER_MINUTE";
  ratePerMinuteUsd: number | null;
  currency: string;
  voice: {
    billingRatePerMinuteUsd: number | null;
    serviceBreakdown?: Array<{
      serviceId: string;
      invoiceLabel: string;
      unit: "PER_MINUTE" | "PER_SMS" | "PER_CALL" | "PER_UNIT";
      billingRateUsd: number;
    }>;
  };
  sms: { billingRatePerSmsUsd: number | null } | null;
  phoneNumber: { billingRateUsd: number | null } | null;
  phoneNumberBilling?: PhoneNumberBillingState | null;
};

export type PhoneNumberBillingState = {
  enabled: boolean;
  cadence: string;
  amountCents: number | null;
  currency: string;
  message: string | null;
};

export type BuyerExecutionPricingPayload = {
  executionPricing: BuyerExecutionPricing;
  phoneNumberBilling: PhoneNumberBillingState;
};

/** Fetch the shared buyer pricing once per mounting surface. */
export function useBuyerExecutionPricing(): {
  pricing: BuyerExecutionPricingPayload | null;
  loading: boolean;
  error: boolean;
} {
  const [pricing, setPricing] = useState<BuyerExecutionPricingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiGet<BuyerExecutionPricingPayload>("/payments/execution-pricing");
        if (cancelled) return;
        if (response.success && response.data) {
          setPricing(response.data);
        } else {
          setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { pricing, loading, error };
}

/** "$0.0664" style — up to 4 decimals, trailing zeros trimmed, min 2 decimals. */
export function formatUsdRate(value: number): string {
  const fixed = value.toFixed(4);
  const trimmed = fixed.replace(/(\.\d\d[1-9]?)0+$/, "$1").replace(/(\.\d\d)00$/, "$1");
  return `$${trimmed}`;
}

export function formatAgentPrice(priceCents: number | null | undefined, pricingModel?: string | null): string {
  if (!priceCents || priceCents <= 0) return "Free";
  const amount = `$${(priceCents / 100).toFixed(2)}`;
  if (pricingModel === "SUBSCRIPTION") return `${amount}/month`;
  return `${amount} one-time`;
}

export type ExecutionPricingSummaryProps = {
  /** Payload from useBuyerExecutionPricing (or a page-level fetch). */
  pricing: BuyerExecutionPricingPayload | null;
  loading: boolean;
  /** Fetch failed or rates unconfigured → "Usage pricing unavailable". */
  unavailable?: boolean;
  /** This surface is showing UNPRICED usage → "Usage pricing pending". */
  pending?: boolean;
  /** Optional agent-price row (marketplace/detail/checkout surfaces). */
  agentPriceCents?: number | null;
  agentPricingModel?: string | null;
  /** Compact = one-line rate summary for cards; full = labeled rows. */
  variant?: "full" | "compact";
  className?: string;
};

export function ExecutionPricingSummary({
  pricing,
  loading,
  unavailable,
  pending,
  agentPriceCents,
  agentPricingModel,
  variant = "full",
  className
}: ExecutionPricingSummaryProps) {
  const containerClass = className ?? "text-xs text-gray-500";

  if (pending) {
    return (
      <div className={containerClass} data-testid="execution-pricing-pending">
        Usage pricing pending
      </div>
    );
  }

  if (loading) {
    return (
      <div className={containerClass} data-testid="execution-pricing-loading">
        Loading usage pricing…
      </div>
    );
  }

  const voiceRate = pricing?.executionPricing?.voice?.billingRatePerMinuteUsd ?? null;
  const smsRate = pricing?.executionPricing?.sms?.billingRatePerSmsUsd ?? null;
  const phoneState = pricing?.phoneNumberBilling ?? pricing?.executionPricing?.phoneNumberBilling ?? null;

  if (unavailable || !pricing || voiceRate === null) {
    return (
      <div className={containerClass} data-testid="execution-pricing-unavailable">
        Usage pricing unavailable
      </div>
    );
  }

  const showAgentPrice = agentPriceCents !== undefined;

  if (variant === "compact") {
    return (
      <div className={containerClass} data-testid="execution-pricing-summary">
        {showAgentPrice ? (
          <span data-testid="execution-pricing-agent-price">
            {formatAgentPrice(agentPriceCents, agentPricingModel)}
          </span>
        ) : null}
        {showAgentPrice ? " · " : ""}
        <span data-testid="execution-pricing-voice-rate">{formatUsdRate(voiceRate)}/min</span>
        {smsRate !== null ? (
          <>
            {" "}
            + <span data-testid="execution-pricing-sms-rate">{formatUsdRate(smsRate)}/SMS</span>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className={containerClass} data-testid="execution-pricing-summary">
      {showAgentPrice ? (
        <div className="flex items-center justify-between gap-2">
          <span>Agent price</span>
          <span data-testid="execution-pricing-agent-price">
            {formatAgentPrice(agentPriceCents, agentPricingModel)}
          </span>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span>Execution charges</span>
        <span data-testid="execution-pricing-billing-type">Usage based</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span>Voice execution</span>
        <span data-testid="execution-pricing-voice-rate">{formatUsdRate(voiceRate)} per minute</span>
      </div>
      {smsRate !== null ? (
        <div className="flex items-center justify-between gap-2">
          <span>SMS confirmation</span>
          <span data-testid="execution-pricing-sms-rate">{formatUsdRate(smsRate)} per SMS</span>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span>Dedicated phone number</span>
        <span data-testid="execution-pricing-phone">
          {phoneState && phoneState.enabled && phoneState.amountCents
            ? `$${(phoneState.amountCents / 100).toFixed(2)} per number`
            : "Phone-number billing is currently not enabled."}
        </span>
      </div>
    </div>
  );
}
