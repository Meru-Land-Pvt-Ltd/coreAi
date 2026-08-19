import { describe, it, expect } from "vitest";
import { priceGrid, priceForMarket, INR_EMANDATE_CEILING } from "@coreai/shared";

/**
 * India is a market the founder is selling into deliberately, and it has a
 * rule that silently breaks subscriptions: above ₹15,000 a month, RBI's
 * e-mandate rules make the customer re-authorise EVERY renewal. A price over
 * that line does not fail loudly — it just stops renewing, in month two, with
 * nobody watching. These tests are the tripwire.
 */
const rupees = (cents: number) => (priceForMarket(cents, "inr")?.unitAmount ?? 0) / 100;

describe("the India price", () => {
  it("keeps the $199 plan under the automatic-payment ceiling", () => {
    expect(rupees(19_900)).toBeLessThan(INR_EMANDATE_CEILING);
  });

  it("shows a real rupee number, not a converted-looking one", () => {
    // ₹12,900 — the way an Indian price is actually written. A straight
    // conversion would read ₹16,716, which is both over the line and reads
    // like a machine did it.
    expect(priceForMarket(19_900, "inr")?.display).toBe("₹12,900");
  });

  it("never charges India MORE than the headline price", () => {
    // A cheap agent must not be pushed UP to the India anchor.
    expect(rupees(9_900)).toBeLessThan(rupees(19_900));
  });

  it("stays under the ceiling at every price an architect might set", () => {
    for (const cents of [4_900, 9_900, 19_900, 49_900, 199_900]) {
      expect(rupees(cents)).toBeLessThan(INR_EMANDATE_CEILING);
    }
  });

  it("gives an Indian buyer a price at all", () => {
    // The whole point: without an INR price there is no UPI, and without UPI
    // most Indian debit cards simply fail on international rails.
    expect(priceGrid(19_900).some((price) => price.currency === "inr")).toBe(true);
  });
});
