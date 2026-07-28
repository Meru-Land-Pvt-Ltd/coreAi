export type UsageInvoiceRateInput = {
  serviceCode?: string;
  unit: string;
  quantity: number;
  billedCostUsd: number;
  unitPriceUsd?: number;
};

export function effectiveUsageInvoiceRateUsd(
  service: UsageInvoiceRateInput
): number | null {
  if (
    typeof service.unitPriceUsd === "number" &&
    Number.isFinite(service.unitPriceUsd) &&
    service.unitPriceUsd >= 0
  ) {
    return service.unitPriceUsd;
  }
  if (service.quantity > 0) {
    return service.billedCostUsd / service.quantity;
  }
  return null;
}

function usageRateUnitLabel(unit: string) {
  if (unit === "PER_MINUTE") return "min";
  if (unit === "PER_SMS") return "SMS";
  if (unit === "PER_CALL") return "call";
  return "unit";
}

function formatInvoiceRateUsd(value: number) {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3
  })}`;
}

export function formatUsageInvoiceAmountUsd(value: number) {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  })}`;
}

export function usageInvoicePayableCents(lineAmountsUsd: number[]) {
  return Math.round(
    lineAmountsUsd.reduce((sum, amount) => sum + amount, 0) * 100
  );
}

function roundTo(value: number, fractionDigits: number) {
  const factor = 10 ** fractionDigits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function usageInvoiceDisplayQuantity(service: UsageInvoiceRateInput) {
  if (service.unit === "PER_SMS" || service.unit === "PER_CALL") {
    return roundTo(service.quantity, 0);
  }
  return roundTo(service.quantity, 2);
}

export function calculateUsageInvoiceLineAmountUsd(
  service: UsageInvoiceRateInput
) {
  if (
    service.serviceCode === "phone_number" ||
    service.serviceCode === "platform_service"
  ) {
    return roundTo(service.billedCostUsd, 3);
  }
  const rate = effectiveUsageInvoiceRateUsd(service);
  if (rate === null || (rate === 0 && service.billedCostUsd > 0)) {
    return roundTo(service.billedCostUsd, 3);
  }

  const displayedRate = roundTo(rate, 3);
  const displayedQuantity = usageInvoiceDisplayQuantity(service);
  return roundTo(displayedRate * displayedQuantity, 3);
}

export function formatUsageInvoiceRate(service: UsageInvoiceRateInput) {
  const rate = effectiveUsageInvoiceRateUsd(service);
  if (rate === null) return "—";
  if (service.serviceCode === "phone_number") {
    return formatInvoiceRateUsd(rate);
  }
  return `${formatInvoiceRateUsd(rate)} / ${usageRateUnitLabel(service.unit)}`;
}

export function usageInvoiceRowOrder(serviceCode: string) {
  if (serviceCode === "phone_number") return 0;
  if (serviceCode === "phone_call_minutes") return 1;
  if (serviceCode === "platform_service") return 3;
  return 2;
}

export function phoneCallBreakdownOrder(serviceCode: string) {
  if (serviceCode === "twilio_voice") return 0;
  if (serviceCode === "deepgram_nova3") return 1;
  if (serviceCode === "openai_gpt4o_mini") return 2;
  if (serviceCode === "elevenlabs_flash_v25") return 3;
  return 4;
}
