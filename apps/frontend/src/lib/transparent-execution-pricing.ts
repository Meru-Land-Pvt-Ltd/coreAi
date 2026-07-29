export type TransparentPricingSource = {
  voice: {
    billingRatePerMinuteUsd: number | null;
    serviceBreakdown?: Array<{
      serviceId: string;
      billingRateUsd: number;
    }>;
  };
  sms: {
    billingRatePerSmsUsd: number | null;
    billingRateUsd?: number;
  } | null;
  calendar?: {
    billingRateUsd: number;
  } | null;
};

export type TransparentPricingItem = {
  serviceId: "sms_confirmation" | "phone_call_minutes" | "google_calendar";
  label: string;
  icon: "message" | "phone" | "calendar";
  billingRateUsd: number | null;
};

function serviceCodeMatches(serviceId: string, code: string) {
  const normalized = serviceId.trim().toLowerCase();
  return normalized === code || normalized.endsWith(`_${code}`);
}

/**
 * Public pricing intentionally groups internal vendors into three buyer-facing
 * actions. The phone row uses the combined active per-minute billing rate.
 */
export function buildTransparentExecutionPricing(
  pricing: TransparentPricingSource | null | undefined
): TransparentPricingItem[] {
  const calendar = pricing?.voice.serviceBreakdown?.find((service) =>
    serviceCodeMatches(service.serviceId, "google_calendar")
  );

  return [
    {
      serviceId: "sms_confirmation",
      label: "SMS confirmation",
      icon: "message",
      billingRateUsd:
        pricing?.sms?.billingRatePerSmsUsd ??
        pricing?.sms?.billingRateUsd ??
        null
    },
    {
      serviceId: "phone_call_minutes",
      label: "Phone Call Minutes",
      icon: "phone",
      billingRateUsd: pricing?.voice.billingRatePerMinuteUsd ?? null
    },
    {
      serviceId: "google_calendar",
      label: "Appointment booking",
      icon: "calendar",
      billingRateUsd:
        pricing?.calendar?.billingRateUsd ??
        calendar?.billingRateUsd ??
        null
    }
  ];
}
