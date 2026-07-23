import type { UsageServiceUnit } from "@prisma/client";

export const MICRO_USD = 1_000_000;

export const USAGE_PRICING_LINE_CURRENCY = "USD" as const;

export type PricingServiceRecordInput = {
  serviceId: string;
  name: string;
  invoiceLabel?: string;
  unit: UsageServiceUnit;
  actualCostMicroUsd: number;
  billingCostMicroUsd: number;
  pricingRecordId?: string;
  pricingVersion?: string;
};

export type UsageLineItem = {
  serviceCode: string;
  serviceName: string;
  invoiceLabel?: string;
  unit: UsageServiceUnit;
  quantity: number;
  /** Per-unit rate snapshots (micro-USD). */
  actualRateMicroUsd?: number;
  billingRateMicroUsd?: number;
  /** Line totals (micro-USD). */
  actualCostMicroUsd: number;
  billedCostMicroUsd: number;
  pricingRecordId?: string;
  pricingVersion?: string;
  currency?: typeof USAGE_PRICING_LINE_CURRENCY;
};

export function microUsdToUsd(microUsd: number): number {
  return microUsd / MICRO_USD;
}

export function usdToMicroUsd(usd: number): number {
  return Math.round(usd * MICRO_USD);
}

export function calculateUsageLineItems(
  services: PricingServiceRecordInput[],
  quantities: {
    durationMinutes: number;
    smsCount?: number;
    callCount?: number;
  },
  /** When provided, only services whose code is in this set may bill — the
   * pipeline-aware selection. Omitted = legacy behavior (all active services). */
  applicableServiceCodes?: ReadonlySet<string>
): UsageLineItem[] {
  const durationMinutes = Math.max(0, quantities.durationMinutes);
  const smsCount = Math.max(0, quantities.smsCount ?? 0);
  const callCount = Math.max(0, quantities.callCount ?? 0);

  const lines: UsageLineItem[] = [];

  for (const service of services) {
    if (applicableServiceCodes && !applicableServiceCodes.has(service.serviceId)) continue;
    let quantity = 0;

    switch (service.unit) {
      case "PER_MINUTE":
        quantity = durationMinutes;
        break;
      case "PER_SMS":
        quantity = smsCount;
        break;
      case "PER_CALL":
        quantity = callCount > 0 ? callCount : durationMinutes > 0 ? 1 : 0;
        break;
      case "PER_UNIT":
        quantity = 0;
        break;
      default:
        quantity = 0;
    }

    if (quantity <= 0) continue;

    lines.push({
      serviceCode: service.serviceId,
      serviceName: service.name,
      ...(service.invoiceLabel ? { invoiceLabel: service.invoiceLabel } : {}),
      unit: service.unit,
      quantity,
      actualRateMicroUsd: service.actualCostMicroUsd,
      billingRateMicroUsd: service.billingCostMicroUsd,
      actualCostMicroUsd: Math.round(service.actualCostMicroUsd * quantity),
      billedCostMicroUsd: Math.round(service.billingCostMicroUsd * quantity),
      ...(service.pricingRecordId ? { pricingRecordId: service.pricingRecordId } : {}),
      ...(service.pricingVersion ? { pricingVersion: service.pricingVersion } : {}),
      currency: USAGE_PRICING_LINE_CURRENCY
    });
  }

  return lines;
}

export function sumLineItems(lineItems: UsageLineItem[]) {
  return lineItems.reduce(
    (totals, item) => ({
      actualCostMicroUsd: totals.actualCostMicroUsd + item.actualCostMicroUsd,
      billedCostMicroUsd: totals.billedCostMicroUsd + item.billedCostMicroUsd
    }),
    { actualCostMicroUsd: 0, billedCostMicroUsd: 0 }
  );
}

export const USAGE_RATE_NOT_CONFIGURED_CODE = "USAGE_RATE_NOT_CONFIGURED";

export type ExecutionPricingResult =
  | { state: "PRICED"; lineItems: UsageLineItem[]; totals: { actualCostMicroUsd: number; billedCostMicroUsd: number } }
  | {
      state: "UNPRICED";
      code: typeof USAGE_RATE_NOT_CONFIGURED_CODE;
      /** Applicable codes with no active pricing record (pipeline-aware mode). */
      missingServiceCodes?: string[];
    };

/**
 * The one pricing decision for an execution. A voice execution with real
 * minutes REQUIRES at least one active PER_MINUTE record — a missing record is
 * a configuration error (UNPRICED / USAGE_RATE_NOT_CONFIGURED), never silent
 * zero. An ACTIVE record configured at a zero RATE is valid and prices at
 * zero.
 *
 * With `applicableServiceCodes` (pipeline-aware mode) every applicable code
 * must also have an active pricing record — a pipeline component that was
 * genuinely used but has no rate makes the execution UNPRICED rather than
 * silently free.
 */
export function priceExecutionUsage(
  services: PricingServiceRecordInput[],
  quantities: { durationMinutes: number; smsCount?: number; callCount?: number },
  options?: {
    /** Only these codes may bill (pipeline-aware selection filter). */
    applicableServiceCodes?: ReadonlySet<string>;
    /** These codes MUST have an active pricing record — a component that was
     * genuinely used with no rate makes the execution UNPRICED, never free. */
    requiredServiceCodes?: ReadonlySet<string>;
  }
): ExecutionPricingResult {
  const applicableServiceCodes = options?.applicableServiceCodes;
  const inScope = applicableServiceCodes
    ? services.filter((service) => applicableServiceCodes.has(service.serviceId))
    : services;

  const hasPerMinute = inScope.some((service) => service.unit === "PER_MINUTE");
  if (Math.max(0, quantities.durationMinutes) > 0 && !hasPerMinute) {
    return { state: "UNPRICED", code: USAGE_RATE_NOT_CONFIGURED_CODE };
  }

  if (options?.requiredServiceCodes) {
    const activeCodes = new Set(services.map((service) => service.serviceId));
    const missing = [...options.requiredServiceCodes].filter((code) => !activeCodes.has(code));
    if (missing.length > 0) {
      return { state: "UNPRICED", code: USAGE_RATE_NOT_CONFIGURED_CODE, missingServiceCodes: missing };
    }
  }

  const lineItems = calculateUsageLineItems(services, quantities, applicableServiceCodes);
  return { state: "PRICED", lineItems, totals: sumLineItems(lineItems) };
}
