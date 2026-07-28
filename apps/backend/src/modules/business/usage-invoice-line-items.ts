import type { UsageLineItem } from "../../lib/usage-pricing";

export const PLATFORM_USAGE_SERVICE_CODES = new Set([
  "database_storage",
  "google_calendar"
]);

// One-time charges are fixed when the customer selects the resource. Unlike
// metered usage, an already-issued phone-number line must not move when an
// admin later changes the current rate.
const SNAPSHOT_PRICED_SERVICE_CODES = new Set(["phone_number"]);

export function usageInvoiceServiceUsesSnapshotPrice(serviceCode: string) {
  return SNAPSHOT_PRICED_SERVICE_CODES.has(serviceCode);
}

export type UsageInvoiceLabelMap = ReadonlyMap<string, string | null>;
export type UsageInvoiceBillingCostMap = ReadonlyMap<
  string,
  {
    unit: UsageLineItem["unit"];
    billingCostMicroUsd: number;
  }
>;

/**
 * Reprices buyer-facing invoice rows from the current active Admin Billing
 * Cost. Recorded vendor/actual cost is never used by this projection.
 */
export function repriceUsageInvoiceLineItems(
  items: UsageLineItem[],
  billingCosts: UsageInvoiceBillingCostMap
): UsageLineItem[] {
  return items.map((item) => {
    if (usageInvoiceServiceUsesSnapshotPrice(item.serviceCode)) {
      return { ...item };
    }
    const pricing = billingCosts.get(item.serviceCode);
    if (!pricing) return { ...item };

    return {
      ...item,
      unit: pricing.unit,
      billingRateMicroUsd: pricing.billingCostMicroUsd,
      billedCostMicroUsd: Math.round(
        pricing.billingCostMicroUsd * Math.max(0, item.quantity)
      )
    };
  });
}

/**
 * Customer billing rate for an invoice row, in micro-USD per unit.
 *
 * Prefer the Admin Billing Cost supplied on the invoice line. Current invoice
 * projections supply the live active Admin rate; legacy projections can still
 * supply their recorded snapshot. Aggregated rows without one common rate fall
 * back to the effective rate so the visible rate reconciles with the amount.
 */
export function usageInvoiceBillingRateMicroUsd(
  item: Pick<UsageLineItem, "quantity" | "billingRateMicroUsd" | "billedCostMicroUsd">
): number | null {
  if (
    typeof item.billingRateMicroUsd === "number" &&
    Number.isFinite(item.billingRateMicroUsd) &&
    item.billingRateMicroUsd >= 0
  ) {
    return item.billingRateMicroUsd;
  }
  if (item.quantity > 0) {
    return item.billedCostMicroUsd / item.quantity;
  }
  return null;
}

function mergeRateSnapshot(
  existing: UsageLineItem,
  item: UsageLineItem,
  field: "actualRateMicroUsd" | "billingRateMicroUsd"
) {
  if (
    typeof existing[field] !== "number" ||
    typeof item[field] !== "number" ||
    existing[field] !== item[field]
  ) {
    delete existing[field];
  }
}

function customerServiceIdentity(
  item: UsageLineItem,
  invoiceLabels: UsageInvoiceLabelMap
) {
  if (
    item.serviceCode === "platform_service" ||
    PLATFORM_USAGE_SERVICE_CODES.has(item.serviceCode)
  ) {
    return {
      serviceCode: "platform_service",
      serviceName: "Platform service",
      invoiceLabel: "Platform service"
    };
  }

  const invoiceLabel =
    item.invoiceLabel?.trim() ||
    invoiceLabels.get(item.serviceCode)?.trim() ||
    (item.serviceCode === "phone_number"
      ? item.serviceName.trim()
      : "") ||
    (item.serviceCode.startsWith("invoice_label_")
      ? item.serviceName.trim()
      : "") ||
    "Usage service";

  return {
    // Keep every non-platform service as its own invoice row even when two
    // Admin Invoice labels happen to match.
    serviceCode: item.serviceCode,
    serviceName: invoiceLabel,
    invoiceLabel
  };
}

function normalizePlatformUnitsForExecution(items: UsageLineItem[]) {
  const normalized = items.map((item) => {
    if (
      !(
        item.serviceCode === "platform_service" ||
        PLATFORM_USAGE_SERVICE_CODES.has(item.serviceCode)
      ) ||
      item.unit !== "PER_UNIT" ||
      (item.quantity <= 0 && item.billedCostMicroUsd <= 0)
    ) {
      return item;
    }

    const billingRateMicroUsd = usageInvoiceBillingRateMicroUsd(item);
    const actualRateMicroUsd =
      typeof item.actualRateMicroUsd === "number" &&
      Number.isFinite(item.actualRateMicroUsd) &&
      item.actualRateMicroUsd >= 0
        ? item.actualRateMicroUsd
        : item.quantity > 0
          ? item.actualCostMicroUsd / item.quantity
          : null;

    return {
      ...item,
      quantity: 1,
      ...(actualRateMicroUsd === null
        ? {}
        : {
            actualRateMicroUsd,
            actualCostMicroUsd: Math.round(actualRateMicroUsd)
          }),
      ...(billingRateMicroUsd === null
        ? {}
        : {
            billingRateMicroUsd,
            billedCostMicroUsd: Math.round(billingRateMicroUsd)
          })
    };
  });

  return normalized;
}

/**
 * Converts internal/vendor usage rows into buyer-safe invoice rows.
 * Admin Pricing's Invoice label is the only non-platform display name, while
 * shared infrastructure and integrations collapse into one Platform service.
 */
export function customerFacingUsageLineItems(
  items: UsageLineItem[],
  invoiceLabels: UsageInvoiceLabelMap
): UsageLineItem[] {
  const grouped = new Map<string, UsageLineItem>();

  for (const item of items) {
    if (item.quantity <= 0 && item.billedCostMicroUsd <= 0) continue;
    const identity = customerServiceIdentity(item, invoiceLabels);
    const existing = grouped.get(identity.serviceCode);
    if (!existing) {
      grouped.set(identity.serviceCode, {
        ...item,
        ...identity
      });
      continue;
    }

    existing.quantity += item.quantity;
    existing.actualCostMicroUsd += item.actualCostMicroUsd;
    existing.billedCostMicroUsd += item.billedCostMicroUsd;
    if (existing.unit !== item.unit) existing.unit = "PER_UNIT";
    mergeRateSnapshot(existing, item, "actualRateMicroUsd");
    mergeRateSnapshot(existing, item, "billingRateMicroUsd");
  }

  return [...grouped.values()];
}

export function rollupCustomerUsageLineItems(
  itemGroups: UsageLineItem[][],
  invoiceLabels: UsageInvoiceLabelMap
) {
  const perExecutionRows = itemGroups.flatMap((items) => {
    const rows = customerFacingUsageLineItems(
      normalizePlatformUnitsForExecution(items),
      invoiceLabels
    );
    const platform = rows.find(
      (item) =>
        item.serviceCode === "platform_service" && item.unit === "PER_UNIT"
    );

    if (platform) {
      platform.quantity = 1;
      platform.billingRateMicroUsd = platform.billedCostMicroUsd;
      platform.actualRateMicroUsd = platform.actualCostMicroUsd;
    }

    return rows;
  });

  return customerFacingUsageLineItems(perExecutionRows, invoiceLabels);
}

/**
 * Usage screens are operational detail, not invoices: retain the recorded
 * service name and service code, and aggregate only repeated occurrences of
 * that exact service.
 */
export function rollupRecordedUsageLineItems(itemGroups: UsageLineItem[][]) {
  const grouped = new Map<string, UsageLineItem>();

  for (const item of itemGroups.flat()) {
    if (item.quantity <= 0 && item.billedCostMicroUsd <= 0) continue;
    const existing = grouped.get(item.serviceCode);
    if (!existing) {
      grouped.set(item.serviceCode, { ...item });
      continue;
    }

    existing.quantity += item.quantity;
    existing.actualCostMicroUsd += item.actualCostMicroUsd;
    existing.billedCostMicroUsd += item.billedCostMicroUsd;
    if (existing.unit !== item.unit) existing.unit = "PER_UNIT";
    mergeRateSnapshot(existing, item, "actualRateMicroUsd");
    mergeRateSnapshot(existing, item, "billingRateMicroUsd");
  }

  return [...grouped.values()];
}
