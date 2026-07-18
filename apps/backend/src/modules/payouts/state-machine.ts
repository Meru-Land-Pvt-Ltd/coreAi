import type { ArchitectEarningState, ArchitectPayoutStatus } from "@prisma/client";
import type Stripe from "stripe";

const EARNING_TRANSITIONS: Record<ArchitectEarningState, ArchitectEarningState[]> = {
  PAYMENT_PENDING: ["PAYMENT_SUCCEEDED", "FAILED"],
  PAYMENT_SUCCEEDED: ["HELD", "REFUNDED", "DISPUTED", "FAILED"],
  HELD: ["AVAILABLE_FOR_TRANSFER", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED", "FAILED"],
  AVAILABLE_FOR_TRANSFER: ["TRANSFER_PROCESSING", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED", "HELD"],
  TRANSFER_PROCESSING: ["TRANSFERRED", "AVAILABLE_FOR_TRANSFER", "FAILED"],
  TRANSFERRED: ["PARTIALLY_REFUNDED", "REVERSAL_PENDING", "REVERSED", "DISPUTED", "NEGATIVE_ADJUSTMENT"],
  PARTIALLY_REFUNDED: ["AVAILABLE_FOR_TRANSFER", "TRANSFER_PROCESSING", "TRANSFERRED", "REFUNDED", "DISPUTED", "REVERSAL_PENDING", "HELD"],
  REFUNDED: ["REVERSAL_PENDING", "REVERSED", "NEGATIVE_ADJUSTMENT"],
  DISPUTED: ["HELD", "AVAILABLE_FOR_TRANSFER", "TRANSFERRED", "REVERSAL_PENDING", "REVERSED", "NEGATIVE_ADJUSTMENT", "REFUNDED"],
  REVERSAL_PENDING: ["REVERSED", "NEGATIVE_ADJUSTMENT"],
  REVERSED: [],
  NEGATIVE_ADJUSTMENT: [],
  FAILED: []
};

export function isLegalEarningTransition(
  from: ArchitectEarningState,
  to: ArchitectEarningState
): boolean {
  if (from === to) return true; // idempotent re-application
  return EARNING_TRANSITIONS[from]?.includes(to) ?? false;
}

export const EARNING_UNRELEASED_STATES: ArchitectEarningState[] = ["PAYMENT_SUCCEEDED", "HELD"];
export const EARNING_AVAILABLE_STATES: ArchitectEarningState[] = ["AVAILABLE_FOR_TRANSFER"];
export const EARNING_TRANSFERRED_STATES: ArchitectEarningState[] = ["TRANSFERRED", "PARTIALLY_REFUNDED"];

const PAYOUT_TRANSITIONS: Record<ArchitectPayoutStatus, ArchitectPayoutStatus[]> = {
  PENDING: ["RESERVED", "PROCESSING", "IN_TRANSIT", "COMPLETED", "PAID", "FAILED", "CANCELED"],
  RESERVED: ["PROCESSING", "IN_TRANSIT", "PAID", "FAILED", "CANCELED"],
  PROCESSING: ["IN_TRANSIT", "PAID", "COMPLETED", "FAILED", "CANCELED"],
  IN_TRANSIT: ["PAID", "FAILED", "CANCELED"],
  COMPLETED: ["REVERSED"], // legacy terminal-success
  PAID: ["REVERSED"],
  FAILED: [],
  CANCELED: [],
  REVERSED: []
};

export const PAYOUT_TERMINAL_SUCCESS: ArchitectPayoutStatus[] = ["PAID", "COMPLETED"];
export const PAYOUT_TERMINAL: ArchitectPayoutStatus[] = ["PAID", "COMPLETED", "FAILED", "CANCELED", "REVERSED"];
export const PAYOUT_ACTIVE_STATES: ArchitectPayoutStatus[] = ["PENDING", "RESERVED", "PROCESSING", "IN_TRANSIT"];

export function isLegalPayoutTransition(
  from: ArchitectPayoutStatus,
  to: ArchitectPayoutStatus
): boolean {
  if (from === to) return true;
  return PAYOUT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function payoutStatusFromStripe(status: Stripe.Payout["status"]): ArchitectPayoutStatus {
  switch (status) {
    case "paid":
      return "PAID";
    case "in_transit":
      return "IN_TRANSIT";
    case "pending":
      return "PROCESSING";
    case "canceled":
      return "CANCELED";
    case "failed":
      return "FAILED";
    default:
      return "PROCESSING";
  }
}
