import { describe, expect, it } from "vitest";
import { subscriptionInvoiceStatusForCreation } from "./billing-cycle";

describe("subscription renewal reminder window", () => {
  const renewalAt = new Date("2026-09-06T12:00:00.000Z");

  it("does not create the renewal invoice before the final 24 hours", () => {
    expect(
      subscriptionInvoiceStatusForCreation(
        new Date("2026-09-05T11:59:59.999Z"),
        renewalAt
      )
    ).toBeNull();
  });

  it("creates a pending renewal invoice during day 29", () => {
    expect(
      subscriptionInvoiceStatusForCreation(
        new Date("2026-09-05T12:00:00.000Z"),
        renewalAt
      )
    ).toBe("PENDING");
  });

  it("marks the renewal invoice overdue when the next period starts", () => {
    expect(subscriptionInvoiceStatusForCreation(renewalAt, renewalAt)).toBe(
      "OVERDUE"
    );
  });
});
