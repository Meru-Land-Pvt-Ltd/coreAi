import { prisma } from "../../lib/prisma";
import { getStripeClient } from "../payments/stripe";
import { stripeLivemode } from "./config";
import {
  EARNING_AVAILABLE_STATES,
  EARNING_TRANSFERRED_STATES,
  EARNING_UNRELEASED_STATES,
  PAYOUT_ACTIVE_STATES,
  PAYOUT_TERMINAL_SUCCESS
} from "./state-machine";
import { logStripeError, normalizeStripeError } from "./stripe-errors";

export type StripeBalanceByCurrency = Record<
  string,
  { availableCents: number; pendingCents: number; instantAvailableCents: number }
>;

export async function getArchitectBalances(architectUserId: string, stripeAccountId: string | null) {
  const livemode = stripeLivemode();

  const [unreleased, available, transferred, activePayouts, paidPayouts] = await Promise.all([
    prisma.architectEarning.aggregate({
      where: { architectUserId, status: { in: EARNING_UNRELEASED_STATES }, livemode },
      _sum: { architectNetCents: true }
    }),
    prisma.architectEarning.aggregate({
      where: { architectUserId, status: { in: EARNING_AVAILABLE_STATES }, livemode },
      _sum: { architectNetCents: true }
    }),
    prisma.architectEarning.aggregate({
      where: { architectUserId, status: { in: EARNING_TRANSFERRED_STATES }, livemode },
      _sum: { architectNetCents: true }
    }),
    prisma.architectPayout.aggregate({
      where: { architectUserId, status: { in: PAYOUT_ACTIVE_STATES }, livemode },
      _sum: { amountCents: true }
    }),
    prisma.architectPayout.aggregate({
      where: { architectUserId, status: { in: PAYOUT_TERMINAL_SUCCESS }, livemode },
      _sum: { amountCents: true }
    })
  ]);

  let stripeBalance: StripeBalanceByCurrency = {};
  const stripe = getStripeClient();
  if (stripe && stripeAccountId) {
    try {
      const balance = await stripe.balance.retrieve({}, { stripeAccount: stripeAccountId });
      for (const entry of balance.available) {
        const bucket = (stripeBalance[entry.currency] ??= {
          availableCents: 0,
          pendingCents: 0,
          instantAvailableCents: 0
        });
        bucket.availableCents += entry.amount;
      }
      for (const entry of balance.pending) {
        const bucket = (stripeBalance[entry.currency] ??= {
          availableCents: 0,
          pendingCents: 0,
          instantAvailableCents: 0
        });
        bucket.pendingCents += entry.amount;
      }
      for (const entry of balance.instant_available ?? []) {
        const bucket = (stripeBalance[entry.currency] ??= {
          availableCents: 0,
          pendingCents: 0,
          instantAvailableCents: 0
        });
        bucket.instantAvailableCents += entry.amount;
      }
    } catch (error) {
      const normalized = normalizeStripeError(error, "balance.retrieve");
      logStripeError(normalized, { architectUserId });
      stripeBalance = {};
    }
  }

  return {
    internal: {
      unreleasedEarningsCents: unreleased._sum.architectNetCents ?? 0,
      availableEarningsCents: available._sum.architectNetCents ?? 0,
      transferredEarningsCents: transferred._sum.architectNetCents ?? 0,
      payoutsInTransitCents: activePayouts._sum.amountCents ?? 0,
      paidOutCents: paidPayouts._sum.amountCents ?? 0
    },
    stripe: stripeBalance
  };
}
