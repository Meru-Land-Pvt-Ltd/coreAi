import { describe, expect, it } from "vitest";
import { calculateUsageLineItems } from "../../lib/usage-pricing";
import {
  buildAgentPurchaseLineItems,
  getPhoneNumberBillingState,
  PHONE_NUMBER_BILLING_DISABLED_MESSAGE,
  PHONE_NUMBER_DYNAMIC_PRICING_MESSAGE,
  type PhoneNumberFee
} from "./phone-provisioning";

describe("phone-number billing state", () => {
  it("reports dynamic monthly Twilio pricing without an admin-set amount", async () => {
    const state = await getPhoneNumberBillingState();
    expect(state).toEqual({
      enabled: true,
      cadence: "MONTHLY_PER_ASSIGNED_NUMBER",
      amountCents: null,
      currency: "usd",
      serviceCode: "phone_number",
      message: PHONE_NUMBER_DYNAMIC_PRICING_MESSAGE
    });
  });

  it("reports an explicit disabled override honestly", async () => {
    const state = await getPhoneNumberBillingState({ feeEnabled: false });
    expect(state).toMatchObject({
      enabled: false,
      cadence: "MONTHLY_PER_ASSIGNED_NUMBER",
      amountCents: null,
      currency: "usd",
      message: PHONE_NUMBER_BILLING_DISABLED_MESSAGE
    });
  });
});

describe("phone-number line snapshot", () => {
  const phoneFee: PhoneNumberFee = {
    amountCents: 200,
    label: "Dedicated Business Phone Number",
    serviceCode: "phone_number",
    pricingVersion: "twilio:local:1150000:2026-07-28T10:00:00.000Z"
  };

  it("keeps the assigned-number fee as one fixed unit", () => {
    const items = buildAgentPurchaseLineItems({
      agentLabel: "Agent",
      agentPriceCents: 0,
      phoneFee
    });
    expect(items[1]).toEqual(phoneFee);
  });

  it("never turns the fixed number fee into per-execution usage", () => {
    const phoneService = {
      serviceId: "phone_number",
      name: "Dedicated Business Phone Number",
      unit: "PER_UNIT" as const,
      actualCostMicroUsd: 1_150_000,
      billingCostMicroUsd: 2_000_000
    };
    for (let execution = 0; execution < 10; execution += 1) {
      expect(
        calculateUsageLineItems([phoneService], {
          durationMinutes: 3,
          smsCount: 2,
          callCount: 1
        })
      ).toHaveLength(0);
    }
  });
});
