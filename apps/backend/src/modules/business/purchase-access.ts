import { PaymentStatus, type Payment } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { isDeployableSubscriptionStatus } from "./deployment-access";

export const OWNED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.TRIALING,
  PaymentStatus.SUCCEEDED
];

export const TRIAL_ACCESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function resolveActivePayment<
  T extends { status: PaymentStatus; createdAt: Date; periodEnd?: Date | null }
>(
  payments: T[]
): T | null {
  const trialCutoff = Date.now() - TRIAL_ACCESS_WINDOW_MS;
  const owned = payments.filter(
    (payment) =>
      OWNED_PAYMENT_STATUSES.includes(payment.status) &&
      (payment.status !== PaymentStatus.TRIALING ||
        (payment.periodEnd
          ? payment.periodEnd.getTime() > Date.now()
          : payment.createdAt.getTime() > trialCutoff))
  );

  return (
    owned.find((payment) => payment.status === PaymentStatus.SUCCEEDED) ??
    owned.find((payment) => payment.status === PaymentStatus.TRIALING) ??
    null
  );
}

/** Most recent valid acquisition of this listing by this user, or null. */
export async function findActiveListingPurchase(
  userId: string,
  listingId: string
): Promise<Payment | null> {
  const payments = await prisma.payment.findMany({
    where: { userId, listingId },
    orderBy: { createdAt: "desc" }
  });

  return resolveActivePayment(payments);
}

/**
 * True when the user has acquired at least one agent — a valid payment, an
 * installed agent, or a legacy active subscription. Setup test utilities
 * (test SMS, test email, call-routing diagnostics) are gated on this so
 * unpurchased accounts can't exercise platform senders.
 */
export async function hasAnyAgentAcquisition(userId: string): Promise<boolean> {
  const payments = await prisma.payment.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { status: true, createdAt: true }
  });

  if (resolveActivePayment(payments)) return true;

  const installed = await prisma.installedAgent.findFirst({
    where: { business: { ownerId: userId } },
    select: { id: true }
  });

  if (installed) return true;

  return hasLegacyActiveSubscription(userId);
}

/**
 * Real legacy subscribers only: Business.subscriptionStatus defaults to
 * "active" for every new row, so status alone proves nothing — an actual
 * Stripe subscription id must also be present.
 */
export async function hasLegacyActiveSubscription(userId: string): Promise<boolean> {
  const businesses = await prisma.business.findMany({
    where: { ownerId: userId, stripeSubscriptionId: { not: null } },
    select: { subscriptionStatus: true }
  });

  return businesses.some((business) => isDeployableSubscriptionStatus(business.subscriptionStatus));
}

export type ListingAccess =
  | {
      allowed: true;
      payment: Payment | null;
      grandfathered: boolean;
      selfTest?: boolean;
      freeListing?: boolean;
    }
  | { allowed: false; reason: "PURCHASE_REQUIRED" };

/** Listing statuses that are installable at all. DRAFT, REJECTED and
 *  SUSPENDED listings stay uninstallable even for their owner. */
const OPEN_LISTING_STATUSES = ["APPROVED", "PENDING_REVIEW"];

/**
 * True when the listing belongs to this user (architect self-test): the
 * architect may install their own published listing without a purchase —
 * no Stripe charge, no earnings, no payout obligations.
 */
export async function isArchitectSelfTestListing(params: {
  userId: string;
  listingId: string;
}): Promise<boolean> {
  const listing = await prisma.agentListing.findUnique({
    where: { id: params.listingId },
    select: { architectUserId: true, status: true }
  });

  return (
    !!listing &&
    listing.architectUserId === params.userId &&
    OPEN_LISTING_STATUSES.includes(listing.status)
  );
}

export async function canBusinessAccessListing(params: {
  userId: string;
  listingId: string;
}): Promise<ListingAccess> {
  const payment = await findActiveListingPurchase(params.userId, params.listingId);

  if (payment) {
    return { allowed: true, payment, grandfathered: false };
  }

  const installed = await prisma.installedAgent.findFirst({
    where: { listingId: params.listingId, business: { ownerId: params.userId } },
    select: { id: true }
  });

  if (installed) {
    return { allowed: true, payment: null, grandfathered: true };
  }

  const listing = await prisma.agentListing.findUnique({
    where: { id: params.listingId },
    select: { architectUserId: true, status: true, pricingModel: true }
  });

  if (listing && OPEN_LISTING_STATUSES.includes(listing.status)) {
    if (listing.architectUserId === params.userId) {
      return { allowed: true, payment: null, grandfathered: false, selfTest: true };
    }

    // FREE listings are intrinsically entitled — installing one never asks
    // for payment and never records a Payment row.
    if (listing.pricingModel === "FREE") {
      return { allowed: true, payment: null, grandfathered: false, freeListing: true };
    }
  }

  return { allowed: false, reason: "PURCHASE_REQUIRED" };
}

export async function canBusinessRunSetup(params: {
  userId: string;
  requestedListingId?: string | null;
  requestedWorkflowId?: string | null;
  resolvedListingId?: string | null;
  existingAgent?: { listingId: string | null; workflowId: string } | null;
}): Promise<{ allowed: boolean; reason: "PURCHASE_REQUIRED" | null }> {
  const requestedListingId = params.requestedListingId?.trim() || null;
  const requestedWorkflowId = params.requestedWorkflowId?.trim() || null;
  const existing = params.existingAgent ?? null;

  if (
    existing &&
    (!requestedListingId || requestedListingId === existing.listingId) &&
    (!requestedWorkflowId || requestedWorkflowId === existing.workflowId)
  ) {
    return { allowed: true, reason: null };
  }

  if (!requestedListingId && !requestedWorkflowId && !params.resolvedListingId) {
    if (await hasLegacyActiveSubscription(params.userId)) {
      return { allowed: true, reason: null };
    }
  }

  const targetListingId = requestedListingId ?? params.resolvedListingId ?? null;

  if (targetListingId) {
    const access = await canBusinessAccessListing({
      userId: params.userId,
      listingId: targetListingId
    });

    return access.allowed
      ? { allowed: true, reason: null }
      : { allowed: false, reason: "PURCHASE_REQUIRED" };
  }

  if (requestedWorkflowId) {
    const listings = await prisma.agentListing.findMany({
      where: { workflowId: requestedWorkflowId },
      select: { id: true }
    });

    for (const listing of listings) {
      const access = await canBusinessAccessListing({
        userId: params.userId,
        listingId: listing.id
      });
      if (access.allowed) {
        return { allowed: true, reason: null };
      }
    }
  }

  return { allowed: false, reason: "PURCHASE_REQUIRED" };
}
