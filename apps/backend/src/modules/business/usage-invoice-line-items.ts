import type { UsageLineItem } from "../../lib/usage-pricing";

export const PLATFORM_USAGE_SERVICE_CODES = new Set([
  "database_storage",
  "google_calendar"
]);

export type UsageInvoiceLabelMap = ReadonlyMap<string, string | null>;

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
    delete existing.actualRateMicroUsd;
    delete existing.billingRateMicroUsd;
  }

  return [...grouped.values()];
}

export function rollupCustomerUsageLineItems(
  itemGroups: UsageLineItem[][],
  invoiceLabels: UsageInvoiceLabelMap
) {
  return customerFacingUsageLineItems(itemGroups.flat(), invoiceLabels);
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
    delete existing.actualRateMicroUsd;
    delete existing.billingRateMicroUsd;
  }

  return [...grouped.values()];
}
