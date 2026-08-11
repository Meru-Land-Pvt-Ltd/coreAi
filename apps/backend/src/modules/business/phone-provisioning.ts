import type { PlatformPhoneNumber } from "@prisma/client";
import { requiredConnectorsForWorkflow } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import {
  fetchTwilioMonthlyNumberPrice,
  PhoneNumberServiceError,
  resolveTwilioNumberCountry
} from "../admin/twilio-number-service";

export const PHONE_NUMBER_SERVICE_CODE = "phone_number";

export const PHONE_NUMBER_LINE_LABEL = "Dedicated Business Phone Number";

export const PHONE_NUMBER_FEE_ENABLED = true;

export const PHONE_NUMBER_BILLING_DISABLED_MESSAGE =
  "Phone-number billing is currently not enabled.";

export const PHONE_NUMBER_BILLING_CADENCE = "MONTHLY_PER_ASSIGNED_NUMBER" as const;

export const PHONE_NUMBER_DYNAMIC_PRICING_MESSAGE =
  "Monthly price is calculated from the assigned number's Twilio cost.";

const PHONE_CONNECTOR_KEYS = new Set(["phone_provider", "twilio"]);


export type PaymentLineItem = {
  label: string;
  amountCents: number;
  /** Immutable pricing snapshot (set on phone-number lines when enabled). */
  serviceCode?: string;
  pricingVersion?: string;
};

export type ProvisionedNumber = {
  platformPhoneNumberId: string;
  phoneNumber: string;
  source: "EXISTING" | "INVENTORY" | "PURCHASED";
};

/* ------------------------------- detection -------------------------------- */

export function workflowNeedsPhoneNumber(workflowJson: unknown): boolean {
  if (!workflowJson) return false;
  return requiredConnectorsForWorkflow(workflowJson).some((req) =>
    PHONE_CONNECTOR_KEYS.has(req.connector)
  );
}

export async function listingNeedsPhoneNumber(listingId: string): Promise<boolean> {
  const listing = await prisma.agentListing.findUnique({
    where: { id: listingId },
    select: {
      requiredConnectors: true,
      workflow: { select: { workflowJson: true } }
    }
  });
  if (!listing) return false;

  if (listing.workflow?.workflowJson) {
    return workflowNeedsPhoneNumber(listing.workflow.workflowJson);
  }

  return listing.requiredConnectors.some((key) =>
    PHONE_CONNECTOR_KEYS.has(key.trim().toLowerCase())
  );
}

/* --------------------------------- pricing -------------------------------- */


export type PhoneNumberFee = {
  amountCents: number;
  label: string;
  /** Immutable pricing snapshot fields, pinned onto invoice lines at bill time. */
  serviceCode?: string;
  pricingVersion?: string;
};

type PhonePricingSnapshot = {
  provider: PlatformPhoneNumber["provider"];
  country: string | null;
  providerMonthlyPriceMicroUsd: number | null;
  billingMonthlyPriceMicroUsd: number | null;
  pricingCurrency: string | null;
  pricingNumberType: string | null;
  pricingFetchedAt: Date | null;
};

function feeFromSnapshot(snapshot: PhonePricingSnapshot): PhoneNumberFee | null {
  if (
    snapshot.billingMonthlyPriceMicroUsd === null ||
    snapshot.billingMonthlyPriceMicroUsd <= 0 ||
    snapshot.pricingCurrency?.toLowerCase() !== "usd"
  ) {
    return null;
  }

  return {
    amountCents: Math.round(snapshot.billingMonthlyPriceMicroUsd / 10_000),
    label: PHONE_NUMBER_LINE_LABEL,
    serviceCode: PHONE_NUMBER_SERVICE_CODE,
    pricingVersion: [
      snapshot.provider.toLowerCase(),
      snapshot.pricingNumberType ?? "local",
      snapshot.providerMonthlyPriceMicroUsd ?? "unknown",
      snapshot.pricingFetchedAt?.toISOString() ?? "unknown"
    ].join(":")
  };
}

/**
 * Resolve the fixed monthly fee for one concrete number. Pricing comes from
 * Twilio, never PlatformUsageService/admin execution pricing.
 */
export async function getPhoneNumberFeeForPlatformNumber(
  platformPhoneNumberId: string,
  options?: { refreshFromTwilio?: boolean }
): Promise<PhoneNumberFee> {
  const number = await prisma.platformPhoneNumber.findUnique({
    where: { id: platformPhoneNumberId },
    select: {
      phoneNumber: true,
      e164: true,
      provider: true,
      country: true,
      providerMonthlyPriceMicroUsd: true,
      billingMonthlyPriceMicroUsd: true,
      pricingCurrency: true,
      pricingNumberType: true,
      pricingFetchedAt: true
    }
  });
  if (!number) {
    throw new PhoneNumberServiceError(
      "Phone number not found while resolving monthly billing.",
      404,
      "NUMBER_NOT_FOUND"
    );
  }

  const existingFee = feeFromSnapshot(number);
  if (existingFee && !options?.refreshFromTwilio) return existingFee;
  if (number.provider !== "TWILIO") {
    throw new PhoneNumberServiceError(
      "Monthly pricing is only available for Twilio phone numbers.",
      422,
      "PHONE_NUMBER_PRICING_PROVIDER_UNSUPPORTED"
    );
  }
  // Numbers imported by the Twilio sync have no country (Twilio's owned-number
  // API does not report one), which used to dead-end buyer setup. Resolve and
  // persist it once instead of failing.
  let country = number.country;
  if (!country) {
    country = await resolveTwilioNumberCountry(number.e164 ?? number.phoneNumber);
    if (country) {
      await prisma.platformPhoneNumber.update({
        where: { id: platformPhoneNumberId },
        data: { country }
      });
    }
  }

  if (!country) {
    throw new PhoneNumberServiceError(
      "The phone number has no country, so its monthly Twilio price cannot be resolved.",
      422,
      "PHONE_NUMBER_PRICING_COUNTRY_MISSING"
    );
  }

  const pricing = await fetchTwilioMonthlyNumberPrice({
    country,
    numberType: "local"
  });
  const updated = await prisma.platformPhoneNumber.update({
    where: { id: platformPhoneNumberId },
    data: {
      providerMonthlyPriceMicroUsd: pricing.providerMonthlyPriceMicroUsd,
      billingMonthlyPriceMicroUsd: pricing.billingMonthlyPriceMicroUsd,
      pricingCurrency: pricing.currency.toLowerCase(),
      pricingNumberType: pricing.numberType,
      pricingFetchedAt: pricing.fetchedAt
    },
    select: {
      provider: true,
      country: true,
      providerMonthlyPriceMicroUsd: true,
      billingMonthlyPriceMicroUsd: true,
      pricingCurrency: true,
      pricingNumberType: true,
      pricingFetchedAt: true
    }
  });
  const fee = feeFromSnapshot(updated);
  if (!fee) {
    throw new PhoneNumberServiceError(
      "The assigned number's Twilio price could not be converted into a monthly fee.",
      502,
      "PHONE_NUMBER_PRICE_INVALID"
    );
  }
  return fee;
}

/**
 * Buyer-facing paths want fresh Twilio pricing but must not lose a working
 * setup when the refresh fails (Twilio down, pricing unavailable, country still
 * unresolvable). Fall back to the stored snapshot and only surface the error
 * when there is no usable price at all.
 */
export async function getPhoneNumberFeeWithSnapshotFallback(
  platformPhoneNumberId: string
): Promise<PhoneNumberFee> {
  try {
    return await getPhoneNumberFeeForPlatformNumber(platformPhoneNumberId, {
      refreshFromTwilio: true
    });
  } catch (error) {
    const snapshotFee = await getPhoneNumberFeeForPlatformNumber(platformPhoneNumberId).catch(
      () => null
    );
    if (!snapshotFee) throw error;

    console.warn("[phone-provisioning] pricing refresh failed — using the stored snapshot", {
      platformPhoneNumberId,
      error: error instanceof Error ? error.message : error
    });
    return snapshotFee;
  }
}

export type PhoneNumberBillingState = {
  enabled: boolean;
  cadence: typeof PHONE_NUMBER_BILLING_CADENCE;
  /** Varies by assigned number, so it is null until a number is selected. */
  amountCents: number | null;
  currency: "usd";
  serviceCode: string;
  /** Honest buyer-facing note when billing is disabled. */
  message: string | null;
};

/**
 * Buyer-safe phone-number billing metadata. The actual amount is determined
 * from Twilio for the selected number, so no admin execution rate is exposed.
 */
export async function getPhoneNumberBillingState(options?: {
  feeEnabled?: boolean;
}): Promise<PhoneNumberBillingState> {
  const enabled = options?.feeEnabled ?? PHONE_NUMBER_FEE_ENABLED;
  if (!enabled) {
    return {
      enabled: false,
      cadence: PHONE_NUMBER_BILLING_CADENCE,
      amountCents: null,
      currency: "usd",
      serviceCode: PHONE_NUMBER_SERVICE_CODE,
      message: PHONE_NUMBER_BILLING_DISABLED_MESSAGE
    };
  }

  return {
    enabled: true,
    cadence: PHONE_NUMBER_BILLING_CADENCE,
    amountCents: null,
    currency: "usd",
    serviceCode: PHONE_NUMBER_SERVICE_CODE,
    message: PHONE_NUMBER_DYNAMIC_PRICING_MESSAGE
  };
}

export function buildAgentPurchaseLineItems(input: {
  agentLabel: string;
  agentPriceCents: number;
  phoneFee: PhoneNumberFee | null;
}): PaymentLineItem[] {
  const items: PaymentLineItem[] = [
    { label: input.agentLabel, amountCents: input.agentPriceCents }
  ];
  if (input.phoneFee && input.phoneFee.amountCents > 0) {
    items.push({
      label: input.phoneFee.label,
      amountCents: input.phoneFee.amountCents,
      ...(input.phoneFee.serviceCode ? { serviceCode: input.phoneFee.serviceCode } : {}),
      ...(input.phoneFee.pricingVersion ? { pricingVersion: input.phoneFee.pricingVersion } : {})
    });
  }
  return items;
}

/* ------------------------------ provisioning ------------------------------ */

export async function findBuyerPlatformNumber(input: {
  buyerUserId: string;
  businessId?: string | null;
}): Promise<PlatformPhoneNumber | null> {
  return prisma.platformPhoneNumber.findFirst({
    where: {
      status: "ASSIGNED",
      // The shared Triven SMS sender can never be a buyer's number.
      isPlatformSmsSender: false,
      OR: [
        ...(input.businessId ? [{ businessId: input.businessId }] : []),
        { businessId: null, buyerUserId: input.buyerUserId }
      ]
    },
    orderBy: { assignedAt: "desc" }
  });
}
