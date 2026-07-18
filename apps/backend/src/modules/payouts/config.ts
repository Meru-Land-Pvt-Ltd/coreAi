import { env } from "../../config/env";

export const payoutConfig = {
  earningHoldDays: env.ARCHITECT_EARNING_HOLD_DAYS,
  minimumTransferAmountMinor: env.ARCHITECT_MINIMUM_TRANSFER_AMOUNT_MINOR,
  minimumPayoutAmountMinor: env.ARCHITECT_MINIMUM_PAYOUT_AMOUNT_MINOR,
  defaultPayoutCurrency: env.ARCHITECT_DEFAULT_PAYOUT_CURRENCY.toLowerCase(),
  maxActivePayoutRequests: env.ARCHITECT_PAYOUT_MAX_ACTIVE_REQUESTS,
  reservationTimeoutMinutes: env.ARCHITECT_PAYOUT_RESERVATION_TIMEOUT_MINUTES,
  autoTransferEnabled: env.ARCHITECT_AUTO_TRANSFER_ENABLED
} as const;

export function stripeLivemode(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY?.startsWith("sk_live_"));
}
