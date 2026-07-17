import type { PlatformPhoneNumber } from "@prisma/client";
import { requiredConnectorsForWorkflow } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { isProduction } from "../../config/env";
import {
  PhoneNumberServiceError,
  purchaseNumber,
  searchAvailableNumbers
} from "../admin/twilio-number-service";
import { assignPlatformNumber } from "./phone-assignment";

/**
 * Automatic per-buyer phone number provisioning.
 *
 * When a buyer purchases an agent whose workflow contains a phone-capable node
 * (missed-call / phone-call trigger or SMS action), a dedicated platform number
 * is allotted immediately: claimed from the pre-purchased AVAILABLE inventory
 * first, or purchased live from the provider when the pool is empty. Numbers
 * are never shared — claims are atomic and every number carries single
 * business/buyer assignment links.
 *
 * The number fee is billed later, when the agent itself is paid for (after the
 * 7-day trial), as an extra invoice line labeled with the admin pricing-board
 * service name — the provider is never named to buyers.
 */

/** Admin pricing-board code holding the per-number fee. */
export const PHONE_NUMBER_SERVICE_CODE = "phone_number";

/** Buyer-facing invoice label fallback when the pricing row is missing. */
export const PHONE_NUMBER_LINE_LABEL = "AI Receptionist No.";

/** Connector keys (from the shared node registry) that mean "needs a number". */
const PHONE_CONNECTOR_KEYS = new Set(["phone_provider", "twilio"]);

const AUTO_PURCHASE_COUNTRY = "US";
const INVENTORY_CLAIM_CANDIDATES = 20;
const PURCHASE_SEARCH_CANDIDATES = 5;

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

/**
 * The buyer's current platform number: one assigned to their business, or one
 * reserved against their user id at purchase time (before a Business existed).
 */
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

type AssignmentLinks = {
  buyerUserId: string;
  businessId: string | null;
  installedAgentId: string | null;
};

/**
 * Claim an AVAILABLE inventory number atomically — the status guard in the
 * UPDATE loses gracefully to a concurrent buyer, so a number can never be
 * claimed twice. Assignment links are written in the same statement so a crash
 * cannot leave an anonymous ASSIGNED row. Voice+SMS capability is required —
 * the receptionist's text-back must work on every allotted number.
 */
export async function claimAvailableInventoryNumber(
  links: AssignmentLinks
): Promise<PlatformPhoneNumber | null> {
  const candidates = await prisma.platformPhoneNumber.findMany({
    where: {
      status: "AVAILABLE",
      provider: "TWILIO",
      voiceEnabled: true,
      smsEnabled: true,
      // The reserved shared Triven SMS sender is never buyer inventory.
      isPlatformSmsSender: false
    },
    orderBy: { createdAt: "asc" },
    take: INVENTORY_CLAIM_CANDIDATES
  });

  for (const candidate of candidates) {
    const claimed = await prisma.platformPhoneNumber.updateMany({
      where: { id: candidate.id, status: "AVAILABLE", isPlatformSmsSender: false },
      data: {
        status: "ASSIGNED",
        businessId: links.businessId,
        buyerUserId: links.buyerUserId,
        installedAgentId: links.installedAgentId,
        assignedAt: new Date()
      }
    });
    if (claimed.count > 0) {
      return prisma.platformPhoneNumber.findUnique({ where: { id: candidate.id } });
    }
  }

  return null;
}

/**
 * Buy a fresh number from the provider (webhooks are configured inside the
 * purchase call, so it is immediately routable) and claim it for the buyer.
 */
async function purchaseAndClaim(links: AssignmentLinks): Promise<PlatformPhoneNumber | null> {
  const available = await searchAvailableNumbers({
    country: AUTO_PURCHASE_COUNTRY,
    voiceEnabled: true,
    smsEnabled: true,
    limit: PURCHASE_SEARCH_CANDIDATES
  });

  for (const candidate of available) {
    let purchased: PlatformPhoneNumber;
    try {
      purchased = await purchaseNumber({
        phoneNumber: candidate.phoneNumber,
        country: candidate.country
      });
    } catch (error) {
      // A purchase that succeeded on the provider but failed to save locally
      // must NOT trigger more purchases — the number exists and money was
      // spent; the recovery sync will import it.
      if (
        error instanceof PhoneNumberServiceError &&
        error.code === "PURCHASE_SAVED_ON_TWILIO_ONLY"
      ) {
        console.error("[phone-provision] purchase saved on provider only — stopping candidates");
        return null;
      }
      // Candidate may have been snapped up between search and purchase — try
      // the next one instead of failing the whole provisioning attempt.
      console.error("[phone-provision] provider purchase failed, trying next candidate", {
        error
      });
      continue;
    }

    const claimed = await prisma.platformPhoneNumber.updateMany({
      where: { id: purchased.id, status: "AVAILABLE" },
      data: {
        status: "ASSIGNED",
        businessId: links.businessId,
        buyerUserId: links.buyerUserId,
        installedAgentId: links.installedAgentId,
        assignedAt: new Date()
      }
    });
    if (claimed.count > 0) {
      return prisma.platformPhoneNumber.findUnique({ where: { id: purchased.id } });
    }
  }

  return null;
}

/**
 * Ensure the runtime routing row exists once the business is known. Reserved
 * numbers (claimed before a Business row existed) get their BusinessPhoneNumber
 * mapping here; forwardToPhone is preserved on update unless explicitly given,
 * and an existing installed-agent link is never wiped by an agent-less caller.
 * Returns false when the number's active routing row belongs to another
 * business (the number is not usable by this buyer).
 */
async function ensureRoutingRow(
  platform: PlatformPhoneNumber,
  input: {
    buyerUserId: string;
    businessId: string;
    installedAgentId?: string | null;
    forwardToPhone?: string | null;
  }
): Promise<boolean> {
  const existingRow = await prisma.businessPhoneNumber.findUnique({
    where: { phoneNumber: platform.phoneNumber },
    select: { businessId: true, isActive: true, installedAgentId: true }
  });
  if (existingRow && existingRow.isActive && existingRow.businessId !== input.businessId) {
    console.error("[phone-provision] routing row for claimed number belongs to another business", {
      platformPhoneNumberId: platform.id
    });
    return false;
  }

  const installedAgentId =
    input.installedAgentId ??
    (existingRow?.businessId === input.businessId ? existingRow.installedAgentId : null);

  await prisma.$transaction(async (tx) => {
    await assignPlatformNumber(tx, {
      platform,
      businessId: input.businessId,
      installedAgentId,
      buyerUserId: input.buyerUserId,
      ...(input.forwardToPhone !== undefined ? { forwardToPhone: input.forwardToPhone } : {})
    });
  });
  return true;
}

/**
 * Allot a dedicated platform number to a buyer. Idempotent: an existing
 * assigned/reserved number is returned (and its routing row completed) instead
 * of claiming a second one. Returns null when neither the inventory nor the
 * provider could produce a number — callers treat that as non-fatal.
 */
export async function autoProvisionPhoneNumber(input: {
  buyerUserId: string;
  businessId?: string | null;
  installedAgentId?: string | null;
  forwardToPhone?: string | null;
}): Promise<ProvisionedNumber | null> {
  const existing = await findBuyerPlatformNumber(input);
  if (existing) {
    if (input.businessId) {
      await ensureRoutingRow(existing, {
        buyerUserId: input.buyerUserId,
        businessId: input.businessId,
        installedAgentId: input.installedAgentId,
        forwardToPhone: input.forwardToPhone
      });
    }
    return {
      platformPhoneNumberId: existing.id,
      phoneNumber: existing.phoneNumber,
      source: "EXISTING"
    };
  }

  const links: AssignmentLinks = {
    buyerUserId: input.buyerUserId,
    businessId: input.businessId ?? null,
    installedAgentId: input.installedAgentId ?? null
  };

  let platform = await claimAvailableInventoryNumber(links);
  let source: ProvisionedNumber["source"] = "INVENTORY";

  if (!platform) {
    try {
      platform = await purchaseAndClaim(links);
      source = "PURCHASED";
    } catch (error) {
      if (!isProduction) {
        console.warn("[phone-provision] Twilio purchase failed in dev/test. Creating a mock number instead.", error);
        const mockPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
        platform = await prisma.platformPhoneNumber.create({
          data: {
            phoneNumber: mockPhone,
            provider: "TWILIO",
            twilioSid: `PNmock${Math.floor(100000000 + Math.random() * 900000000)}`,
            status: "ASSIGNED",
            businessId: input.businessId ?? null,
            buyerUserId: input.buyerUserId,
            installedAgentId: input.installedAgentId ?? null,
            assignedAt: new Date()
          }
        });
        source = "PURCHASED";
      } else {
        throw error;
      }
    }
  }

  if (!platform) {
    console.error("[phone-provision] no number available: inventory empty and provider purchase failed", {
      buyerUserId: input.buyerUserId
    });
    return null;
  }

  // Concurrent purchases both pass the findBuyerPlatformNumber check and each
  // claim a number. Keep the earliest claim per buyer; release this one.
  const rival = await prisma.platformPhoneNumber.findFirst({
    where: {
      status: "ASSIGNED",
      NOT: { id: platform.id },
      OR: [
        ...(input.businessId ? [{ businessId: input.businessId }] : []),
        { businessId: null, buyerUserId: input.buyerUserId }
      ]
    },
    orderBy: { assignedAt: "asc" }
  });
  if (rival) {
    await releaseClaim(platform.id);
    return {
      platformPhoneNumberId: rival.id,
      phoneNumber: rival.phoneNumber,
      source: "EXISTING"
    };
  }

  if (input.businessId) {
    const routable = await ensureRoutingRow(platform, {
      buyerUserId: input.buyerUserId,
      businessId: input.businessId,
      installedAgentId: input.installedAgentId,
      forwardToPhone: input.forwardToPhone
    });
    if (!routable) {
      // The number cannot actually serve this buyer — release the claim so it
      // is neither billed nor left stranded.
      await releaseClaim(platform.id);
      return null;
    }
  }

  console.log("[phone-provision] number allotted", {
    phoneNumber: platform.phoneNumber,
    source,
    businessId: input.businessId ?? null
  });

  return {
    platformPhoneNumberId: platform.id,
    phoneNumber: platform.phoneNumber,
    source
  };
}

/** Return a claimed number to the pool (links + fee marker cleared). */
async function releaseClaim(platformPhoneNumberId: string): Promise<void> {
  await prisma.platformPhoneNumber.updateMany({
    where: { id: platformPhoneNumberId, status: "ASSIGNED" },
    data: {
      status: "AVAILABLE",
      businessId: null,
      buyerUserId: null,
      installedAgentId: null,
      assignedAt: null,
      feeBilledAt: null
    }
  });
}

/**
 * Purchase-time entry point: provisions only when the listing's workflow
 * actually contains a phone-capable node.
 */
export async function autoProvisionPhoneNumberForPurchase(input: {
  buyerUserId: string;
  businessId?: string | null;
  installedAgentId?: string | null;
  listingId: string;
}): Promise<ProvisionedNumber | null> {
  if (!(await listingNeedsPhoneNumber(input.listingId))) return null;
  return autoProvisionPhoneNumber(input);
}

/* ------------------------------ fee tracking ------------------------------ */

export type UnbilledPhoneFee = {
  platformPhoneNumberId: string;
  fee: { amountCents: number; label: string };
};

/**
 * The buyer's allotted number whose one-time fee has NOT been billed yet.
 * Charge sites bill the fee only when this returns non-null, so the same
 * number is never charged twice across multiple agent purchases.
 */
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
