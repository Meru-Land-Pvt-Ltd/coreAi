import type { UsageServiceUnit } from "@prisma/client";

export const MICRO_USD = 1_000_000;

export type PricingServiceRow = {
  code: string;
  name: string;
  unit: UsageServiceUnit;
  actualCostMicroUsd: number;
  updatedCostMicroUsd: number;
};

export type UsageLineItem = {
  serviceCode: string;
  serviceName: string;
  unit: UsageServiceUnit;
  quantity: number;
  actualCostMicroUsd: number;
  billedCostMicroUsd: number;
};

export function microUsdToUsd(microUsd: number): number {
  return microUsd / MICRO_USD;
}

export function usdToMicroUsd(usd: number): number {
  return Math.round(usd * MICRO_USD);
}

export function calculateUsageLineItems(
  services: PricingServiceRow[],
  quantities: {
    durationMinutes: number;
    smsCount?: number;
    callCount?: number;
  }
): UsageLineItem[] {
  const durationMinutes = Math.max(0, quantities.durationMinutes);
  const smsCount = Math.max(0, quantities.smsCount ?? 0);
  const callCount = Math.max(0, quantities.callCount ?? 0);

  return services.map((service) => {
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

    const actualCostMicroUsd = Math.round(service.actualCostMicroUsd * quantity);
    const billedCostMicroUsd = Math.round(service.updatedCostMicroUsd * quantity);

    return {
      serviceCode: service.code,
      serviceName: service.name,
      unit: service.unit,
      quantity,
      actualCostMicroUsd,
      billedCostMicroUsd
    };
  });
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
