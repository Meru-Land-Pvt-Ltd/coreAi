import { describe, expect, it } from "vitest";
import {
  architectShareOfRefund,
  ARCHITECT_SHARE_BPS,
  calculateMarketplaceSettlement,
  CALCULATION_VERSION
} from "./settlement-calculator";

describe("calculateMarketplaceSettlement", () => {
  it("splits with integer arithmetic and reconciles exactly to gross", () => {
    const result = calculateMarketplaceSettlement({ grossAmountMinor: 14_900, currency: "usd" });
    expect(result.architectGrossMinor).toBe(10_430); // floor(14900 * 0.70)
    expect(result.platformCommissionMinor).toBe(4_470);
    expect(result.architectGrossMinor + result.platformCommissionMinor).toBe(14_900);
    expect(result.calculationVersion).toBe(CALCULATION_VERSION);
  });

  it("floors odd amounts instead of using float rounding", () => {
    // 155 * 0.7 = 108.5 — float Math.round gives 108 or 109 depending on
    // representation; integer floor is deterministic.
    const result = calculateMarketplaceSettlement({ grossAmountMinor: 155, currency: "usd" });
    expect(result.architectGrossMinor).toBe(Math.floor((155 * ARCHITECT_SHARE_BPS) / 10_000));
    expect(result.architectGrossMinor).toBe(108);
    expect(result.platformCommissionMinor).toBe(47);
  });

  it("handles zero gross", () => {
    const result = calculateMarketplaceSettlement({ grossAmountMinor: 0, currency: "usd" });
    expect(result.architectGrossMinor).toBe(0);
    expect(result.platformCommissionMinor).toBe(0);
  });

  it("commission never exceeds gross and net is never negative across a value sweep", () => {
    for (const gross of [1, 2, 3, 49, 50, 99, 100, 101, 999, 12_345, 1_000_000, 2 ** 31]) {
      const result = calculateMarketplaceSettlement({ grossAmountMinor: gross, currency: "usd" });
      expect(result.platformCommissionMinor).toBeGreaterThanOrEqual(0);
      expect(result.platformCommissionMinor).toBeLessThanOrEqual(gross);
      expect(result.architectNetMinor).toBeGreaterThanOrEqual(0);
      expect(result.architectGrossMinor + result.platformCommissionMinor).toBe(gross);
    }
  });

  it("rejects non-integer and negative gross", () => {
    expect(() => calculateMarketplaceSettlement({ grossAmountMinor: 10.5, currency: "usd" })).toThrow();
    expect(() => calculateMarketplaceSettlement({ grossAmountMinor: -1, currency: "usd" })).toThrow();
  });
});

describe("architectShareOfRefund", () => {
  it("takes the architect share of the refunded amount", () => {
    expect(
      architectShareOfRefund({ refundAmountMinor: 1000, alreadyAdjustedMinor: 0, architectGrossMinor: 7000 })
    ).toBe(700);
  });

  it("is bounded by the remaining architect gross", () => {
    expect(
      architectShareOfRefund({ refundAmountMinor: 20_000, alreadyAdjustedMinor: 6_500, architectGrossMinor: 7_000 })
    ).toBe(500);
  });

  it("returns zero when the earning is already fully adjusted", () => {
    expect(
      architectShareOfRefund({ refundAmountMinor: 1_000, alreadyAdjustedMinor: 7_000, architectGrossMinor: 7_000 })
    ).toBe(0);
  });

  it("rejects negative refund amounts", () => {
    expect(() =>
      architectShareOfRefund({ refundAmountMinor: -5, alreadyAdjustedMinor: 0, architectGrossMinor: 100 })
    ).toThrow();
  });
});
