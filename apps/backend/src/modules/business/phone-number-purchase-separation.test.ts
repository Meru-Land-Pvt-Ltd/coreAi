import { describe, expect, it } from "vitest";
import {
  buildAgentPurchaseLineItems,
  PHONE_NUMBER_FEE_ENABLED
} from "./phone-provisioning";

describe("phone-number billing timing", () => {
  it("enables the one-time phone-number fee", () => {
    expect(PHONE_NUMBER_FEE_ENABLED).toBe(true);
  });

  it("keeps the agent purchase total separate from the later number fee", () => {
    const lineItems = buildAgentPurchaseLineItems({
      agentLabel: "Any Agent",
      agentPriceCents: 2_000,
      phoneFee: null
    });

    expect(lineItems).toEqual([
      { label: "Any Agent", amountCents: 2_000 }
    ]);
    expect(
      lineItems.reduce((sum, item) => sum + item.amountCents, 0)
    ).toBe(2_000);
  });
});
