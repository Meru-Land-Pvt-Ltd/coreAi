import type { PlatformPhoneNumber } from "@prisma/client";
import { requiredConnectorsForWorkflow } from "@coreai/shared";
import { prisma } from "../../lib/prisma";

export const PHONE_NUMBER_SERVICE_CODE = "phone_number";

export const PHONE_NUMBER_LINE_LABEL = "AI Receptionist No.";

export const PHONE_NUMBER_FEE_ENABLED = true;

export const PHONE_NUMBER_BILLING_DISABLED_MESSAGE =
  "Phone-number billing is currently not enabled.";

export const PHONE_NUMBER_BILLING_CADENCE = "ONE_TIME_PER_ASSIGNED_NUMBER" as const;

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

export async function getPhoneNumberFee(options?: {
  /** Test seam only — production callers always use the module flag. */
  feeEnabled?: boolean;
}): Promise<PhoneNumberFee> {
  const enabled = options?.feeEnabled ?? PHONE_NUMBER_FEE_ENABLED;
  if (!enabled) {
    return { amountCents: 0, label: PHONE_NUMBER_LINE_LABEL };
  }

  const service =
    (await prisma.platformUsageService.findFirst({
      where: { code: PHONE_NUMBER_SERVICE_CODE, isActive: true },
      select: { id: true, code: true, name: true, updatedCostMicroUsd: true, updatedAt: true }
    })) ??
    (await prisma.platformUsageService.findFirst({
      where: {
        isActive: true,
        unit: "PER_UNIT",
        OR: [{ code: { contains: "phone" } }, { code: { contains: "number" } }]
      },
      orderBy: { sortOrder: "asc" },
      select: { id: true, code: true, name: true, updatedCostMicroUsd: true, updatedAt: true }
    }));

  if (!service) return { amountCents: 0, label: PHONE_NUMBER_LINE_LABEL };

  return {
    amountCents: Math.max(0, Math.round(service.updatedCostMicroUsd / 10_000)),
    label: service.name || PHONE_NUMBER_LINE_LABEL,
    serviceCode: service.code,
    pricingVersion: `${service.id}@${service.updatedAt.toISOString()}`
  };
}

export type PhoneNumberBillingState = {
  enabled: boolean;
  cadence: typeof PHONE_NUMBER_BILLING_CADENCE;
  /** Buyer-payable amount when enabled and configured; null when disabled. */
  amountCents: number | null;
  currency: "usd";
  serviceCode: string;
  /** Honest buyer-facing note when billing is disabled. */
  message: string | null;
};

/**
 * Buyer-safe phone-number billing metadata. When the platform flag is off this
 * reports enabled=false with the honest disabled message — the UI must never
 * show a payable rate that the billing engine silently never charges.
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

  const fee = await getPhoneNumberFee({ feeEnabled: true });
  return {
    enabled: true,
    cadence: PHONE_NUMBER_BILLING_CADENCE,
    amountCents: fee.amountCents,
    currency: "usd",
    serviceCode: fee.serviceCode ?? PHONE_NUMBER_SERVICE_CODE,
    message: null
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

/* ------------------------------ fee tracking ------------------------------ */

export type UnbilledPhoneFee = {
  platformPhoneNumberId: string;
  fee: PhoneNumberFee;
};

export async function resolveUnbilledPhoneFee(input: {
  buyerUserId: string;
  businessId?: string | null;
  /** Test seam only — production callers always use the module flag. */
  feeEnabled?: boolean;
}): Promise<UnbilledPhoneFee | null> {
  const number = await findBuyerPlatformNumber(input);
  if (!number || number.feeBilledAt) return null;

  const fee = await getPhoneNumberFee(
    input.feeEnabled === undefined ? undefined : { feeEnabled: input.feeEnabled }
  );
  if (fee.amountCents <= 0) return null;

  return { platformPhoneNumberId: number.id, fee };
}

/** Record that the number fee was billed (idempotent — first bill wins). */
export async function markPhoneNumberFeeBilled(platformPhoneNumberId: string): Promise<void> {
  await prisma.platformPhoneNumber.updateMany({
    where: { id: platformPhoneNumberId, feeBilledAt: null },
    data: { feeBilledAt: new Date() }
  });
}
