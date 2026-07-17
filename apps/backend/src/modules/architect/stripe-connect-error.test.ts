import { describe, expect, it } from "vitest";
import { stripeConnectConfigurationError } from "./stripe-connect-error";

describe("stripeConnectConfigurationError", () => {
  it("classifies an inactive Connect platform as a service configuration error", () => {
    const result = stripeConnectConfigurationError(
      new Error(
        "You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect."
      )
    );

    expect(result).toEqual({
      message: "Payouts are temporarily unavailable because Stripe Connect is not configured. Contact platform support.",
      status: 503,
      code: "STRIPE_CONNECT_NOT_ACTIVATED"
    });
  });

  it("leaves ordinary Stripe request errors to the calling route", () => {
    expect(stripeConnectConfigurationError(new Error("Invalid routing number"))).toBeNull();
  });
});
