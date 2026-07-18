import type { PlatformPhoneNumber } from "@prisma/client";
import { requiredConnectorsForWorkflow } from "@coreai/shared";
import { prisma } from "../../lib/prisma";


/** Admin pricing-board code holding the per-number fee. */
export const PHONE_NUMBER_SERVICE_CODE = "phone_number";

/** Buyer-facing invoice label fallback when the pricing row is missing. */
export const PHONE_NUMBER_LINE_LABEL = "AI Receptionist No.";

/** Connector keys (from the shared node registry) that mean "needs a number". */
const PHONE_CONNECTOR_KEYS = new Set(["phone_provider", "twilio"]);


export type PaymentLineItem = { label: string; amountCents: number };

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

/**
 * Whether the listing's agent needs a phone number. The workflow graph is the
 * source of truth; publish-time `requiredConnectors` keys are the fallback for
 * legacy listings whose graph is unreadable.
 */
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

/**
 * The admin-edited per-number fee and buyer-facing label from the pricing
 * board. Falls back to any active PER_UNIT phone/number service so a row
 * created manually through the admin UI (different code) still applies.
 * Returns a zero fee when nothing is configured — the number is still
 * allotted, just not billed.
 */
export async function getPhoneNumberFee(): Promise<{ amountCents: number; label: string }> {
  const service =
    (await prisma.platformUsageService.findFirst({
      where: { code: PHONE_NUMBER_SERVICE_CODE, isActive: true },
      select: { name: true, updatedCostMicroUsd: true }
    })) ??
    (await prisma.platformUsageService.findFirst({
      where: {
        isActive: true,
        unit: "PER_UNIT",
        OR: [{ code: { contains: "phone" } }, { code: { contains: "number" } }]
      },
      orderBy: { sortOrder: "asc" },
      select: { name: true, updatedCostMicroUsd: true }
    }));

  if (!service) return { amountCents: 0, label: PHONE_NUMBER_LINE_LABEL };

  return {
    amountCents: Math.max(0, Math.round(service.updatedCostMicroUsd / 10_000)),
    label: service.name || PHONE_NUMBER_LINE_LABEL
  };
}

/**
 * Fee breakdown for an agent purchase charge. The number fee row appears only
 * when a number was actually provisioned for this buyer.
 */
export function buildAgentPurchaseLineItems(input: {
  agentLabel: string;
  agentPriceCents: number;
  phoneFee: { amountCents: number; label: string } | null;
}): PaymentLineItem[] {
  const items: PaymentLineItem[] = [
    { label: input.agentLabel, amountCents: input.agentPriceCents }
  ];
  if (input.phoneFee && input.phoneFee.amountCents > 0) {
    items.push({ label: input.phoneFee.label, amountCents: input.phoneFee.amountCents });
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
  fee: { amountCents: number; label: string };
};

export async function resolveUnbilledPhoneFee(input: {
  buyerUserId: string;
  businessId?: string | null;
}): Promise<UnbilledPhoneFee | null> {
  const number = await findBuyerPlatformNumber(input);
  if (!number || number.feeBilledAt) return null;

  const fee = await getPhoneNumberFee();
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
