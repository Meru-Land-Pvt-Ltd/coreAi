import { describe, expect, it } from "vitest";
import { validateHighRiskPromises } from "./output-guard";

describe("validateHighRiskPromises", () => {
  it("flags a specific price when prices are not verified", () => {
    const result = validateHighRiskPromises("A crown costs $450 at our clinic.", {
      canBook: false,
      verifiedPrices: false
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ type: "UNVERIFIED_PRICE", detail: expect.stringContaining("$450") })
    );
  });

  it("passes the same price when verifiedPrices is true", () => {
    const result = validateHighRiskPromises("A crown costs $450 at our clinic.", {
      canBook: false,
      verifiedPrices: true
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a confirmed booking time that is not in the verified slots", () => {
    const result = validateHighRiskPromises("Great, you're booked for 3:00 PM tomorrow.", {
      canBook: true,
      verifiedSlots: ["10:00 AM", "11:30 AM"]
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ type: "UNVERIFIED_BOOKING_TIME", detail: expect.stringContaining("3:00pm") })
    );
  });

  it("passes a confirmed booking time present in the verified slots (format-insensitive)", () => {
    const result = validateHighRiskPromises("Great, you're booked for 3 PM tomorrow. See you then!", {
      canBook: true,
      verifiedSlots: ["3:00 PM"]
    });
    expect(result.ok).toBe(true);
  });

  it("does not run the booking check when the deployment cannot book", () => {
    const result = validateHighRiskPromises("You're booked for 3:00 PM tomorrow.", { canBook: false });
    expect(result.violations.filter((v) => v.type === "UNVERIFIED_BOOKING_TIME")).toEqual([]);
  });

  it("flags guaranteed/no-risk/100% promises", () => {
    const result = validateHighRiskPromises("Results are guaranteed — 100% effective, no risk at all.", {
      canBook: false,
      verifiedPrices: true
    });
    expect(result.ok).toBe(false);
    const types = result.violations.map((v) => v.type);
    expect(types.filter((t) => t === "GUARANTEED_OUTCOME").length).toBeGreaterThanOrEqual(3);
  });

  it("passes an ordinary helpful reply", () => {
    const result = validateHighRiskPromises(
      "We offer cleanings and checkups. Would you like me to check availability for you?",
      { canBook: true, verifiedSlots: [] }
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
