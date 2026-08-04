import { describe, expect, it } from "vitest";
import { joinPhoneNumber, splitPhoneNumber } from "./phone-country-codes";

describe("profile phone number helpers", () => {
  it("splits calling codes outside the legacy fallback list", () => {
    expect(splitPhoneNumber("+358 401234567")).toEqual({
      countryCode: "+358",
      phone: "401234567"
    });
  });

  it("round-trips a country calling code and national number", () => {
    const stored = joinPhoneNumber("+91", "9876543210");
    expect(splitPhoneNumber(stored)).toEqual({
      countryCode: "+91",
      phone: "9876543210"
    });
  });
});
