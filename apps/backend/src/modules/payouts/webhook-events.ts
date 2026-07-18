import type Stripe from "stripe";
import { prisma } from "../../lib/prisma";

export type EventClaim =
  | { duplicate: true }
  | { duplicate: false; retry: boolean };

function eventObjectId(event: Stripe.Event): string | null {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === "string" ? object.id : null;
}

export async function claimStripeEvent(event: Stripe.Event): Promise<EventClaim> {
  try {
    await prisma.stripeWebhookEvent.create({
      data: {
        stripeEventId: event.id,
        eventType: event.type,
        connectedAccountId: event.account ?? null,
        livemode: event.livemode,
        objectId: eventObjectId(event),
        eventCreatedAt: new Date(event.created * 1000),
        processingStatus: "RECEIVED"
      }
    });
    return { duplicate: false, retry: false };
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;

    const existing = await prisma.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id }
    });
    if (!existing) return { duplicate: false, retry: true };

    if (existing.processingStatus === "PROCESSED" || existing.processingStatus === "SKIPPED_DUPLICATE" || existing.processingStatus === "SKIPPED_STALE") {
      return { duplicate: true };
    }

    // FAILED or stuck RECEIVED — Stripe is retrying; allow reprocessing.
    await prisma.stripeWebhookEvent.update({
      where: { stripeEventId: event.id },
      data: { attemptCount: { increment: 1 }, processingStatus: "RECEIVED" }
    });
    return { duplicate: false, retry: true };
  }
}

export async function markEventProcessed(stripeEventId: string, status: "PROCESSED" | "SKIPPED_STALE" = "PROCESSED") {
  await prisma.stripeWebhookEvent.update({
    where: { stripeEventId },
    data: { processingStatus: status, processedAt: new Date() }
  }).catch(() => undefined);
}

export async function markEventFailed(stripeEventId: string, errorCode: string) {
  await prisma.stripeWebhookEvent.update({
    where: { stripeEventId },
    data: { processingStatus: "FAILED", lastErrorCode: errorCode.slice(0, 120) }
  }).catch(() => undefined);
}
