import { describe, expect, it } from "vitest";
import {
  calculatePhoneNumberBillingPriceMicroUsd,
  resolveTwilioMonthlyNumberPrice
} from "./twilio-number-service";

describe("calculatePhoneNumberBillingPriceMicroUsd", () => {
  it.each([
    [1.15, 2_000_000],
    [1.49, 2_000_000],
    [1.5, 3_000_000],
    [1.75, 3_000_000],
    [2.25, 3_000_000]
  ])("rounds $%s and adds exactly $1", (providerUsd, expectedMicroUsd) => {
    expect(calculatePhoneNumberBillingPriceMicroUsd(providerUsd)).toBe(
      expectedMicroUsd
    );
  });

  it("rejects invalid provider prices", () => {
    expect(() => calculatePhoneNumberBillingPriceMicroUsd(Number.NaN)).toThrow(
      "invalid monthly phone-number price"
    );
    expect(() => calculatePhoneNumberBillingPriceMicroUsd(-1)).toThrow(
      "invalid monthly phone-number price"
    );
  });
});

describe("resolveTwilioMonthlyNumberPrice", () => {
  it("uses Twilio current_price for the selected number type, not base_price", () => {
    const fetchedAt = new Date("2026-07-28T12:00:00.000Z");
    expect(
      resolveTwilioMonthlyNumberPrice({
        country: "US",
        numberType: "local",
        fetchedAt,
        data: {
          price_unit: "USD",
          phone_number_prices: [
            {
              number_type: "toll free",
              base_price: "5.00",
              current_price: "2.25"
            },
            {
              number_type: "local",
              base_price: "4.00",
              current_price: "1.15"
            }
          ]
        }
      })
    ).toEqual({
      country: "US",
      numberType: "local",
      currency: "USD",
      providerMonthlyPriceMicroUsd: 1_150_000,
      billingMonthlyPriceMicroUsd: 2_000_000,
      fetchedAt
    });
  });
});
