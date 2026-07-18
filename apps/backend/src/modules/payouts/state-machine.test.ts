import { describe, expect, it } from "vitest";
import {
  isLegalEarningTransition,
  isLegalPayoutTransition,
  PAYOUT_TERMINAL_SUCCESS,
  payoutStatusFromStripe
} from "./state-machine";

describe("earning state machine", () => {
  it("allows the happy path", () => {
    expect(isLegalEarningTransition("PAYMENT_SUCCEEDED", "HELD")).toBe(true);
    expect(isLegalEarningTransition("HELD", "AVAILABLE_FOR_TRANSFER")).toBe(true);
    expect(isLegalEarningTransition("AVAILABLE_FOR_TRANSFER", "TRANSFER_PROCESSING")).toBe(true);
    expect(isLegalEarningTransition("TRANSFER_PROCESSING", "TRANSFERRED")).toBe(true);
  });

  it("is idempotent on same-state transitions", () => {
    expect(isLegalEarningTransition("TRANSFERRED", "TRANSFERRED")).toBe(true);
  });

  it("rejects impossible regressions", () => {
    expect(isLegalEarningTransition("TRANSFERRED", "HELD")).toBe(false);
    expect(isLegalEarningTransition("REVERSED", "AVAILABLE_FOR_TRANSFER")).toBe(false);
    expect(isLegalEarningTransition("FAILED", "TRANSFERRED")).toBe(false);
    expect(isLegalEarningTransition("REFUNDED", "AVAILABLE_FOR_TRANSFER")).toBe(false);
  });

  it("supports refund and dispute branches", () => {
    expect(isLegalEarningTransition("HELD", "DISPUTED")).toBe(true);
    expect(isLegalEarningTransition("DISPUTED", "HELD")).toBe(true);
    expect(isLegalEarningTransition("TRANSFERRED", "REVERSAL_PENDING")).toBe(true);
    expect(isLegalEarningTransition("REVERSAL_PENDING", "REVERSED")).toBe(true);
  });
});

describe("payout state machine", () => {
  it("allows the manual request path", () => {
    expect(isLegalPayoutTransition("RESERVED", "PROCESSING")).toBe(true);
    expect(isLegalPayoutTransition("PROCESSING", "IN_TRANSIT")).toBe(true);
    expect(isLegalPayoutTransition("IN_TRANSIT", "PAID")).toBe(true);
    expect(isLegalPayoutTransition("RESERVED", "FAILED")).toBe(true);
  });

  it("never regresses a terminal success (stale payout.updated after payout.paid)", () => {
    for (const terminal of PAYOUT_TERMINAL_SUCCESS) {
      expect(isLegalPayoutTransition(terminal, "PROCESSING")).toBe(false);
      expect(isLegalPayoutTransition(terminal, "IN_TRANSIT")).toBe(false);
      expect(isLegalPayoutTransition(terminal, "FAILED")).toBe(false);
    }
  });

  it("keeps failure terminal", () => {
    expect(isLegalPayoutTransition("FAILED", "PAID")).toBe(false);
    expect(isLegalPayoutTransition("CANCELED", "PROCESSING")).toBe(false);
  });

  it("maps Stripe payout statuses to internal statuses", () => {
    expect(payoutStatusFromStripe("paid")).toBe("PAID");
    expect(payoutStatusFromStripe("in_transit")).toBe("IN_TRANSIT");
    expect(payoutStatusFromStripe("pending")).toBe("PROCESSING");
    expect(payoutStatusFromStripe("failed")).toBe("FAILED");
    expect(payoutStatusFromStripe("canceled")).toBe("CANCELED");
  });
});
