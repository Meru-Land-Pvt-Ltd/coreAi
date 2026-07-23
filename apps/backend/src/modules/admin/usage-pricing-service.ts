import { prisma } from "../../lib/prisma";
import type { UsageServiceUnit } from "@prisma/client";

export const USAGE_PRICING_CURRENCY = "USD" as const;

export const USAGE_RATE_NOT_CONFIGURED = "USAGE_RATE_NOT_CONFIGURED";

export type UsageServicePricingRecord = {
  pricingRecordId: string;
  serviceId: string;
  name: string;
  invoiceLabel: string;
  description: string | null;
  unit: UsageServiceUnit;
  actualCostMicroUsd: number;
  billingCostMicroUsd: number;
  currency: typeof USAGE_PRICING_CURRENCY;
  active: boolean;
  sortOrder: number;
  pricingVersion: string;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeRecord(row: {
  id: string;
  code: string;
  name: string;
  role: string | null;
  unit: UsageServiceUnit;
  actualCostMicroUsd: number;
  updatedCostMicroUsd: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): UsageServicePricingRecord {
  return {
    pricingRecordId: row.id,
    serviceId: row.code,
    name: row.name,
    invoiceLabel: row.role?.trim() || row.name,
    description: row.role,
    unit: row.unit,
    actualCostMicroUsd: row.actualCostMicroUsd,
    billingCostMicroUsd: row.updatedCostMicroUsd,
    currency: USAGE_PRICING_CURRENCY,
    active: row.isActive,
    sortOrder: row.sortOrder,
    pricingVersion: `${row.id}@${row.updatedAt.toISOString()}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

/** All pricing records; includeInactive mirrors the admin API's flag. */
export async function listUsageServicePricing(options?: {
  includeInactive?: boolean;
}): Promise<UsageServicePricingRecord[]> {
  const rows = await prisma.platformUsageService.findMany({
    where: options?.includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });
  return rows.map(normalizeRecord);
}

export async function loadActiveUsageServicePricing(): Promise<UsageServicePricingRecord[]> {
  return listUsageServicePricing({ includeInactive: false });
}

export function sumPerMinuteBillingMicroUsd(records: UsageServicePricingRecord[]): number {
  return records
    .filter((record) => record.active && record.unit === "PER_MINUTE")
    .reduce((sum, record) => sum + record.billingCostMicroUsd, 0);
}

export function sumPerMinuteActualMicroUsd(records: UsageServicePricingRecord[]): number {
  return records
    .filter((record) => record.active && record.unit === "PER_MINUTE")
    .reduce((sum, record) => sum + record.actualCostMicroUsd, 0);
}

/* ------------------------- buyer-safe projection --------------------------- */

/** One buyer-visible rate line — billing cost only, never vendor cost. */
export type BuyerServiceRate = {
  serviceId: string;
  invoiceLabel: string;
  unit: UsageServiceUnit;
  billingRateUsd: number;
};

export type BuyerExecutionPricing = {
  currency: typeof USAGE_PRICING_CURRENCY;
  voice: {
    unit: "PER_MINUTE";
    /** Combined active per-minute billing rate; null when none configured. */
    billingRatePerMinuteUsd: number | null;
    serviceBreakdown: BuyerServiceRate[];
  };
  sms: BuyerServiceRate | null;
  phoneNumber: BuyerServiceRate | null;
};

function toBuyerRate(record: UsageServicePricingRecord): BuyerServiceRate {
  return {
    serviceId: record.serviceId,
    invoiceLabel: record.invoiceLabel,
    unit: record.unit,
    billingRateUsd: record.billingCostMicroUsd / 1_000_000
  };
}

/**
 * Customer-facing pricing view. Exposes billing rates ONLY — vendor actual
 * costs, margins, and inactive/admin-only records never leave this function.
 */
export function buyerExecutionPricingView(records: UsageServicePricingRecord[]): BuyerExecutionPricing {
  const active = records.filter((record) => record.active);
  const perMinute = active.filter((record) => record.unit === "PER_MINUTE");
  const combined = sumPerMinuteBillingMicroUsd(active);
  const sms = active.find((record) => record.unit === "PER_SMS") ?? null;
  const phone =
    active.find(
      (record) => record.unit === "PER_UNIT" && /phone|number/i.test(`${record.serviceId} ${record.name}`)
    ) ?? null;

  return {
    currency: USAGE_PRICING_CURRENCY,
    voice: {
      unit: "PER_MINUTE",
      billingRatePerMinuteUsd: perMinute.length > 0 ? combined / 1_000_000 : null,
      serviceBreakdown: perMinute.map(toBuyerRate)
    },
    sms: sms ? toBuyerRate(sms) : null,
    phoneNumber: phone ? toBuyerRate(phone) : null
  };
}
