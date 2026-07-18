import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findInstalledAgent: vi.fn(),
  getPhoneNumberFee: vi.fn(),
  searchAvailableNumbers: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    installedAgent: { findFirst: mocks.findInstalledAgent }
  }
}));

vi.mock("./phone-provisioning", () => ({
  getPhoneNumberFee: mocks.getPhoneNumberFee
}));

vi.mock("../architect/twilio-business-routing", () => ({
  workflowSupportsSmsReplies: vi.fn(() => false)
}));

vi.mock("../admin/twilio-number-service", () => {
  class PhoneNumberServiceError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(message: string, status = 400, code = "PHONE_SERVICE_ERROR") {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  return {
    PhoneNumberServiceError,
    purchaseNumber: vi.fn(),
    searchAvailableNumbers: mocks.searchAvailableNumbers
  };
});

import { searchNumbersForBusiness } from "./phone-provisioning-flow";

const providerNumbers = [
  {
    phoneNumber: "+13105550101",
    friendlyName: "+1 310-555-0101",
    country: "US",
    region: "CA",
    locality: "Los Angeles",
    capabilities: { voice: true, sms: true, mms: true }
  },
  {
    phoneNumber: "+13105550102",
    friendlyName: "+1 310-555-0102",
    country: "US",
    region: "CA",
    locality: "Los Angeles",
    capabilities: { voice: true, sms: true, mms: true }
  }
];

describe("business phone-number search cardinality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findInstalledAgent.mockResolvedValue(null);
    mocks.getPhoneNumberFee.mockResolvedValue({ amountCents: 200, label: "AI Receptionist No." });
  });

  it("requests one exact-city candidate and returns at most one even if the provider over-returns", async () => {
    mocks.searchAvailableNumbers.mockResolvedValue(providerNumbers);

    const outcome = await searchNumbersForBusiness({
      businessId: "business_1",
      country: "US",
      state: "CA",
      city: "Los Angeles"
    });

    expect(mocks.searchAvailableNumbers).toHaveBeenCalledWith(
      expect.objectContaining({
        country: "US",
        inRegion: "CA",
        inLocality: "Los Angeles",
        voiceEnabled: true,
        limit: 1
      })
    );
    expect(outcome.numbers).toHaveLength(1);
    expect(outcome.numbers[0]?.phoneNumber).toBe(providerNumbers[0]?.phoneNumber);
    expect(outcome.exactMatchAvailable).toBe(true);
    expect(outcome.matchLevel).toBe("EXACT_CITY");
    expect(outcome.fallbackOptions).toEqual([]);
  });

  it("keeps the existing exact-city fallback response when no number is available", async () => {
    mocks.searchAvailableNumbers.mockResolvedValue([]);

    const outcome = await searchNumbersForBusiness({
      businessId: "business_1",
      country: "US",
      state: "CA",
      city: "Los Angeles"
    });

    expect(outcome.numbers).toEqual([]);
    expect(outcome.exactMatchAvailable).toBe(false);
    expect(outcome.matchLevel).toBe("EXACT_CITY");
    expect(outcome.fallbackOptions).toEqual(["NEARBY_CITY", "SAME_STATE", "NATIONAL"]);
  });
});
