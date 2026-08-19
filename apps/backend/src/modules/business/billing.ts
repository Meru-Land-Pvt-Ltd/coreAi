import type { Context } from "hono";
import type StripeNS from "stripe";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import { getStripe, isBillingEnabled } from "../../lib/stripe";
import { getStripeClient } from "../payments/stripe";
import { recordAgentPurchaseFromIntent } from "../payments/purchase-finalize";
import { applyDisputeToSettlement, applyRefundToSettlement, syncTransferReversalFromStripe } from "../payouts/settlements";
import { claimStripeEvent, markEventFailed, markEventProcessed } from "../payouts/webhook-events";
import { canBusinessDeployAgent } from "./deployment-access";
import { resolvePrimaryBusinessId } from "./primary-business";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

async function getOwnerBusiness(ownerId: string) {
  const primaryId = await resolvePrimaryBusinessId(ownerId);
  return primaryId ? prisma.business.findUnique({ where: { id: primaryId } }) : null;
}

async function applySubscriptionState(params: {
  customerId?: string | null;
  subscriptionId?: string | null;
  ownerId?: string | null;
  businessId?: string | null;
  status?: string | null;
  priceId?: string | null;
  currentPeriodEnd?: Date | null;
}) {
  let business = null;

  if (params.businessId) {
    business = await prisma.business.findUnique({ where: { id: params.businessId } });
  }
  if (!business && params.customerId) {
    business = await prisma.business.findFirst({ where: { stripeCustomerId: params.customerId } });
  }
  if (!business && params.ownerId) {
    const primaryId = await resolvePrimaryBusinessId(params.ownerId);
    business = primaryId ? await prisma.business.findUnique({ where: { id: primaryId } }) : null;
  }
  if (!business) return;

  await prisma.business.update({
    where: { id: business.id },
    data: {
      stripeCustomerId: params.customerId ?? business.stripeCustomerId,
      stripeSubscriptionId: params.subscriptionId ?? business.stripeSubscriptionId,
      subscriptionStatus: params.status ?? business.subscriptionStatus,
      subscriptionPriceId: params.priceId ?? business.subscriptionPriceId,
      currentPeriodEnd: params.currentPeriodEnd ?? business.currentPeriodEnd
    }
  });
}

// POST /business/billing/checkout — create a Stripe Checkout Session (subscription).
/**
 * The Stripe price for ONE agent, minted on demand.
 *
 * Until now every subscription charged the same hardcoded amount from an env
 * var, so an architect setting $49 or $499 changed nothing — the buyer paid
 * whatever that one price said. On a marketplace that is not a bug, it is a
 * broken promise to every architect who ever sets a price.
 *
 * Stripe prices are immutable by design. Changing an agent's price therefore
 * mints a NEW price and repoints the listing at it: people who already
 * subscribed keep the price they agreed to, and only new buyers see the new
 * one. That is the correct behaviour, not an accident of the API.
 *
 * Nothing is created until someone actually buys — a draft agent nobody has
 * purchased leaves no trace in the Stripe account.
 */
async function resolveListingPrice(
  stripe: StripeNS,
  listingId: string
): Promise<{ priceId: string; amountCents: number } | null> {
  const listing = await prisma.agentListing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      name: true,
      priceCents: true,
      pricingModel: true,
      stripeProductId: true,
      stripePriceId: true,
      stripePriceCents: true
    }
  });
  if (!listing) return null;
  if (listing.pricingModel !== "SUBSCRIPTION" || listing.priceCents <= 0) return null;

  // Still current? Use it. This is the common path on every repeat purchase.
  if (listing.stripePriceId && listing.stripePriceCents === listing.priceCents) {
    return { priceId: listing.stripePriceId, amountCents: listing.priceCents };
  }

  const productId =
    listing.stripeProductId ??
    (
      await stripe.products.create({
        name: listing.name,
        metadata: { listingId: listing.id }
      })
    ).id;

  const price = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: listing.priceCents,
    recurring: { interval: "month" },
    metadata: { listingId: listing.id }
  });

  await prisma.agentListing.update({
    where: { id: listing.id },
    data: {
      stripeProductId: productId,
      stripePriceId: price.id,
      stripePriceCents: listing.priceCents
    }
  });

  return { priceId: price.id, amountCents: listing.priceCents };
}

export async function createCheckoutSession(c: Context) {
  try {
    const authUser = c.get("authUser");

    if (!isBillingEnabled() || !env.STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY) {
      return errorResponse(
        c,
        "Billing is not configured. Add live Stripe keys to enable checkout.",
        503,
        "BILLING_NOT_CONFIGURED"
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as { listingId?: unknown };
    const listingId = typeof body.listingId === "string" && body.listingId.trim() ? body.listingId.trim() : "";

    // Validate the listing if one was passed from the marketplace.
    if (listingId) {
      const listing = await prisma.agentListing.findUnique({ where: { id: listingId }, select: { id: true } });
      if (!listing) {
        return errorResponse(c, "Agent listing not found", 404, "LISTING_NOT_FOUND");
      }
    }

    const stripe = getStripe();

    // Subscription status lives on Business, so a Business must exist before the
    // webhook can persist it. Create a placeholder if the buyer hasn't set up yet.
    let business = await getOwnerBusiness(authUser.id);
    if (!business) {
      business = await prisma.business.create({
        data: {
          ownerId: authUser.id,
          name: authUser.fullName || "New Business",
          type: "Pending Setup"
        }
      });
    }

    let customerId = business.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: authUser.email,
        name: business.name ?? authUser.fullName ?? undefined,
        metadata: { ownerId: authUser.id, businessId: business.id }
      });
      customerId = customer.id;
      await prisma.business.update({
        where: { id: business.id },
        data: { stripeCustomerId: customerId }
      });
    }

    const listingPrice = listingId ? await resolveListingPrice(stripe, listingId) : null;

    const metadata = {
      ownerId: authUser.id,
      businessId: business.id,
      listingId,
      // The amount actually agreed, so the 70/30 split and any later dispute
      // read the same number the buyer saw.
      priceCents: String(listingPrice?.amountCents ?? "")
    };
    const listingSuffix = listingId ? `&listingId=${encodeURIComponent(listingId)}` : "";
    const cancelSuffix = listingId ? `?listingId=${encodeURIComponent(listingId)}` : "";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      // The architect's own price, not one price for the whole marketplace.
      // The env price remains only as a fallback for legacy listings that
      // predate per-agent pricing.
      line_items: [{ price: listingPrice?.priceId ?? env.STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY, quantity: 1 }],
      success_url: `${env.FRONTEND_URL}/business/billing/success?session_id={CHECKOUT_SESSION_ID}${listingSuffix}`,
      cancel_url: `${env.FRONTEND_URL}/business/billing/cancel${cancelSuffix}`,
      metadata,
      subscription_data: { metadata }
    });

    return successResponse(c, { url: session.url, sessionId: session.id }, "Checkout session created");
  } catch (error) {
    console.error("Stripe checkout error", error);
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not start checkout",
      500,
      "CHECKOUT_FAILED"
    );
  }
}

// GET /business/billing/status — current subscription state for the buyer.
export async function getBillingStatus(c: Context) {
  const authUser = c.get("authUser");
  const [business, access] = await Promise.all([
    getOwnerBusiness(authUser.id),
    canBusinessDeployAgent(authUser.id)
  ]);
  const status = business?.subscriptionStatus ?? "inactive";

  return successResponse(c, {
    billingEnabled: isBillingEnabled(),
    status,
    active: ACTIVE_STATUSES.has(status),
    priceId: business?.subscriptionPriceId ?? null,
    currentPeriodEnd: business?.currentPeriodEnd ?? null,
    stripeCustomerId: business?.stripeCustomerId ?? null,

    deploymentAccess: {
      allowed: access.allowed,
      subscriptionEnforcementEnabled: access.subscriptionEnforcementEnabled
    }
  });
}

// POST /business/billing/webhook — PUBLIC, raw body, signature-verified.
export async function handleStripeWebhook(c: Context) {
  const stripe = getStripeClient() ?? (isBillingEnabled() ? getStripe() : null);
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return errorResponse(c, "Billing webhook is not configured", 503, "BILLING_NOT_CONFIGURED");
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return errorResponse(c, "Missing Stripe signature", 400, "MISSING_SIGNATURE");
  }

  const rawBody = await c.req.text();

  let event: StripeNS.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return errorResponse(c, "Invalid Stripe signature", 400, "INVALID_SIGNATURE");
  }

  const claim = await claimStripeEvent(event);
  if (claim.duplicate) {
    return c.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as StripeNS.Checkout.Session;
        await applySubscriptionState({
          customerId: typeof session.customer === "string" ? session.customer : session.customer?.id,
          subscriptionId:
            typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
          ownerId: session.metadata?.ownerId,
          businessId: session.metadata?.businessId,
          status: "active"
        });
        break;
      }
      case "payment_intent.succeeded": {
        await recordAgentPurchaseFromIntent(event.data.object as StripeNS.PaymentIntent);
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as StripeNS.Charge;
        const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (intentId) {
          const latestRefundId = charge.refunds?.data?.[0]?.id ?? `charge-refund:${charge.id}:${charge.amount_refunded}`;
          await applyRefundToSettlement({
            paymentIntentId: intentId,
            refundId: latestRefundId,
            cumulativeRefundedCents: charge.amount_refunded,
            fullyRefunded: Boolean(charge.refunded),
            stripeChargeId: charge.id
          });
        }
        break;
      }
      case "charge.dispute.created":
      case "charge.dispute.closed": {
        const dispute = event.data.object as StripeNS.Dispute;
        const intentId =
          typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
        if (intentId) {
          const phase =
            event.type === "charge.dispute.created"
              ? ("created" as const)
              : dispute.status === "won"
                ? ("won" as const)
                : ("lost" as const);
          await applyDisputeToSettlement({
            paymentIntentId: intentId,
            disputeId: dispute.id,
            disputeAmountCents: dispute.amount,
            phase
          });
        }
        break;
      }
      case "transfer.reversed": {
        const transfer = event.data.object as StripeNS.Transfer;
        await syncTransferReversalFromStripe(transfer);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as StripeNS.Subscription;
        const periodEndSeconds = (sub as { current_period_end?: number }).current_period_end;
        await applySubscriptionState({
          customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
          subscriptionId: sub.id,
          ownerId: sub.metadata?.ownerId,
          businessId: sub.metadata?.businessId,
          status: event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
          priceId: sub.items.data[0]?.price?.id ?? null,
          currentPeriodEnd: periodEndSeconds ? new Date(periodEndSeconds * 1000) : null
        });
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error("Stripe webhook handler error", error);
    await markEventFailed(event.id, error instanceof Error ? error.message : "unknown");
    return errorResponse(c, "Webhook handling failed", 500, "WEBHOOK_HANDLER_FAILED");
  }

  await markEventProcessed(event.id);
  return c.json({ received: true });
}
