import type { UsageServiceUnit } from "@prisma/client";
import {
  resolveDefaultLiveVoicePipeline,
  type ResolvedVoicePipeline
} from "../compliance/workspace-ai-guard";
import type { UsageServicePricingRecord } from "../admin/usage-pricing-service";
import {
  resolveApplicableUsageServiceCodes,
  USAGE_SERVICE_CODES
} from "../../lib/usage-service-resolver";
import { PHONE_NUMBER_SERVICE_CODE } from "../business/phone-provisioning";

const VOICE_CONNECTORS = new Set(["vapi", "elevenlabs"]);
const SMS_CONNECTORS = new Set(["twilio"]);
const CALENDAR_CONNECTORS = new Set(["google_calendar"]);

export type ListingUsageRate = {
  code: string;
  invoiceLabel: string;
  unit: UsageServiceUnit;
  billingRateUsd: number;
};

export type ListingUsagePricing = {
  available: boolean;
  perMinuteUsd: number | null;
  services: ListingUsageRate[];
};

type ListingUsagePricingInput = {
  records: UsageServicePricingRecord[];
  requiredConnectors: string[];
  needsPhoneNumber: boolean;
  phoneNumberBillingEnabled: boolean;
  voicePipeline?: ResolvedVoicePipeline;
};

/**
 * Build the checkout pricing rows for one listing.
 *
 * Service applicability comes from the listing; monetary values come only
 * from the active Admin Pricing records. The buyer projection intentionally
 * derives its public rate from billingCostMicroUsd and never exposes vendor
 * actual cost.
 */
export function buildListingUsagePricing({
  records,
  requiredConnectors,
  needsPhoneNumber,
  phoneNumberBillingEnabled,
  voicePipeline = resolveDefaultLiveVoicePipeline()
}: ListingUsagePricingInput): ListingUsagePricing {
  const connectors = new Set(
    requiredConnectors.map((connector) => connector.trim().toLowerCase()).filter(Boolean)
  );
  const applicableCodes = new Set<string>();
  const usesVoicePipeline = [...VOICE_CONNECTORS].some((connector) =>
    connectors.has(connector)
  );

  if (usesVoicePipeline) {
    const resolution = resolveApplicableUsageServiceCodes({
      execution: { calendarUsed: false },
      installedAgent: null,
      voicePipeline,
      providerMetadata: { telephonyProvider: "twilio" }
    });
    if (resolution.state === "UNKNOWN") {
      return { available: false, perMinuteUsd: null, services: [] };
    }

    for (const code of resolution.codes) {
      // Optional workflow services are added below only when the listing
      // declares the corresponding connector.
      if (
        code !== USAGE_SERVICE_CODES.SMS_CONFIRMATION &&
        code !== USAGE_SERVICE_CODES.GOOGLE_CALENDAR
      ) {
        applicableCodes.add(code);
      }
    }
  }

  if ([...SMS_CONNECTORS].some((connector) => connectors.has(connector))) {
    applicableCodes.add(USAGE_SERVICE_CODES.SMS_CONFIRMATION);
  }
  if ([...CALENDAR_CONNECTORS].some((connector) => connectors.has(connector))) {
    applicableCodes.add(USAGE_SERVICE_CODES.GOOGLE_CALENDAR);
  }
  if (needsPhoneNumber && phoneNumberBillingEnabled) {
    applicableCodes.add(PHONE_NUMBER_SERVICE_CODE);
  }

  if (applicableCodes.size === 0) {
    return { available: true, perMinuteUsd: 0, services: [] };
  }

  const activeByCode = new Map(
    records
      .filter((record) => record.active)
      .map((record) => [record.serviceId, record] as const)
  );
  const missingService = [...applicableCodes].some((code) => !activeByCode.has(code));
  if (missingService) {
    return { available: false, perMinuteUsd: null, services: [] };
  }

  const services = records
    .filter((record) => record.active && applicableCodes.has(record.serviceId))
    .map((record) => ({
      code: record.serviceId,
      invoiceLabel: record.invoiceLabel,
      unit: record.unit,
      billingRateUsd: record.billingCostMicroUsd / 1_000_000
    }));
  const perMinuteUsd = services
    .filter((service) => service.unit === "PER_MINUTE")
    .reduce((sum, service) => sum + service.billingRateUsd, 0);

  return {
    available: true,
    perMinuteUsd,
    services
  };
}
