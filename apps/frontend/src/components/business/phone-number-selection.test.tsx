import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneNumberSelectionSection } from "./phone-number-selection";

/**
 * The Triven AI number selection card: Country → State → City → search →
 * select → confirm. Search never purchases; purchase happens exactly once,
 * only on explicit confirmation, with a clientRequestId.
 */

vi.mock("@/components/business/features/api", () => ({
  getPhoneCountries: vi.fn(),
  getPhoneStates: vi.fn(),
  getPhoneCities: vi.fn(),
  searchBusinessPhoneNumbers: vi.fn(),
  purchaseBusinessPhoneNumber: vi.fn()
}));

import {
  getPhoneCities,
  getPhoneCountries,
  getPhoneStates,
  purchaseBusinessPhoneNumber,
  searchBusinessPhoneNumbers
} from "@/components/business/features/api";

const COUNTRIES = {
  success: true as const,
  data: {
    countries: [
      { code: "US", name: "United States" },
      { code: "IN", name: "India" }
    ],
    note: "Number availability depends on Twilio inventory and local regulatory requirements."
  }
};

const US_STATES = {
  success: true as const,
  data: { states: [{ code: "CA", name: "California" }], supportsCityFilter: true }
};

const CA_CITIES = {
  success: true as const,
  data: { cities: ["Los Angeles", "San Diego"] }
};

const SEARCH_RESULT = {
  success: true as const,
  data: {
    numbers: [
      {
        phoneNumber: "+12135550123",
        friendlyName: "(213) 555-0123",
        country: "US",
        region: "CA",
        locality: "Los Angeles",
        capabilities: { voice: true, sms: true, mms: false },
        numberType: "LOCAL" as const,
        feeCents: 500,
        feeLabel: "AI Receptionist No.",
        regulatoryNote: null,
        checkedAt: "2026-07-18T00:00:00.000Z"
      }
    ],
    exactMatchAvailable: true,
    matchLevel: "EXACT_CITY" as const,
    fallbackOptions: [],
    smsRequired: false
  }
};

async function selectLocationAndSearch() {
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByTestId("business-setup-phone-country"), "US");
  await user.selectOptions(screen.getByTestId("business-setup-phone-state"), "CA");
  await user.selectOptions(screen.getByTestId("business-setup-phone-city"), "Los Angeles");
  await user.click(screen.getByTestId("business-setup-phone-search"));
  return user;
}

beforeEach(() => {
  cleanup();
  vi.mocked(getPhoneCountries).mockReset().mockResolvedValue(COUNTRIES as never);
  vi.mocked(getPhoneStates).mockReset().mockResolvedValue(US_STATES as never);
  vi.mocked(getPhoneCities).mockReset().mockResolvedValue(CA_CITIES as never);
  vi.mocked(searchBusinessPhoneNumbers).mockReset().mockResolvedValue(SEARCH_RESULT as never);
  vi.mocked(purchaseBusinessPhoneNumber).mockReset().mockResolvedValue({
    success: true,
    data: { status: "ACTIVE", requestId: "req_1", phoneNumber: "+12135550123", alreadyCompleted: false, errorCode: null, errorMessage: null }
  } as never);
});

describe("PhoneNumberSelectionSection", () => {
  it("renders Country, State, and City immediately — no phone or verification prerequisite", async () => {
    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={vi.fn()} />);

    expect(await screen.findByTestId("business-setup-phone-country")).toBeTruthy();
    expect(screen.getByTestId("business-setup-phone-state")).toBeTruthy();
    expect(screen.getByTestId("business-setup-phone-city")).toBeTruthy();
    expect(screen.getByTestId("business-setup-phone-search")).toBeTruthy();
  });

  it("loads states and cities lazily for ANY selected country (worldwide catalogue)", async () => {
    vi.mocked(getPhoneStates).mockResolvedValue({
      success: true,
      data: { states: [{ code: "UP", name: "Uttar Pradesh" }], supportsCityFilter: false }
    } as never);
    vi.mocked(getPhoneCities).mockResolvedValue({ success: true, data: { cities: ["Noida", "Lucknow"] } } as never);

    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={vi.fn()} />);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByTestId("business-setup-phone-country"), "IN");
    await waitFor(() => expect(getPhoneStates).toHaveBeenCalledWith("IN"));

    await user.selectOptions(screen.getByTestId("business-setup-phone-state"), "UP");
    await waitFor(() => expect(getPhoneCities).toHaveBeenCalledWith("IN", "UP"));

    await user.selectOptions(screen.getByTestId("business-setup-phone-city"), "Noida");
    // Drilling down never searches or purchases anything.
    expect(searchBusinessPhoneNumbers).not.toHaveBeenCalled();
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
  });

  it("shows the safe catalogue error with retry instead of hiding the section", async () => {
    vi.mocked(getPhoneCountries).mockResolvedValue({ success: false, error: "Locations service unavailable" } as never);

    render(<PhoneNumberSelectionSection installedAgentId={null} onProvisioned={vi.fn()} />);

    const errorBox = await screen.findByTestId("business-setup-phone-locations-error");
    expect(errorBox.textContent).toContain("Locations service unavailable");
    expect(screen.getByTestId("business-setup-phone-locations-retry")).toBeTruthy();
  });

  it("search sends the location payload with listingId and NEVER purchases", async () => {
    render(<PhoneNumberSelectionSection installedAgentId="agent-1" listingId="listing-1" onProvisioned={vi.fn()} />);
    await selectLocationAndSearch();

    await waitFor(() => expect(searchBusinessPhoneNumbers).toHaveBeenCalledTimes(1));
    expect(vi.mocked(searchBusinessPhoneNumbers).mock.calls[0]?.[0]).toEqual({
      installedAgentId: "agent-1",
      listingId: "listing-1",
      country: "US",
      state: "CA",
      city: "Los Angeles"
    });
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
  });

  it("selecting a result does not purchase until explicit confirmation", async () => {
    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={vi.fn()} />);
    const user = await selectLocationAndSearch();

    await user.click(await screen.findByTestId("business-setup-phone-result"));
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();

    // The review + confirm affordance is now visible.
    expect(screen.getByTestId("business-setup-phone-confirm")).toBeTruthy();
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
  });

  it("confirm triggers exactly one purchase request with a clientRequestId", async () => {
    const onProvisioned = vi.fn();
    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={onProvisioned} />);
    const user = await selectLocationAndSearch();

    await user.click(await screen.findByTestId("business-setup-phone-result"));
    await user.click(screen.getByTestId("business-setup-phone-confirm"));

    await waitFor(() => expect(purchaseBusinessPhoneNumber).toHaveBeenCalledTimes(1));
    const body = vi.mocked(purchaseBusinessPhoneNumber).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.phoneNumber).toBe("+12135550123");
    expect(body.listingId).toBe("listing-1");
    expect(String(body.clientRequestId).length).toBeGreaterThanOrEqual(8);
    expect(onProvisioned).toHaveBeenCalledWith("+12135550123");
  });

  it("repeat confirmations reuse the same clientRequestId (idempotent, never a second number)", async () => {
    // First attempt fails transiently so the confirm button stays available.
    vi.mocked(purchaseBusinessPhoneNumber).mockResolvedValueOnce({
      success: true,
      data: { status: "FAILED", requestId: "req_1", phoneNumber: null, alreadyCompleted: false, errorCode: "ASSIGNMENT_FAILED", errorMessage: "Retry shortly." }
    } as never);

    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={vi.fn()} />);
    const user = await selectLocationAndSearch();

    await user.click(await screen.findByTestId("business-setup-phone-result"));
    await user.click(screen.getByTestId("business-setup-phone-confirm"));
    await waitFor(() => expect(purchaseBusinessPhoneNumber).toHaveBeenCalledTimes(1));

    await user.click(screen.getByTestId("business-setup-phone-confirm"));
    await waitFor(() => expect(purchaseBusinessPhoneNumber).toHaveBeenCalledTimes(2));

    const ids = vi.mocked(purchaseBusinessPhoneNumber).mock.calls.map(
      (call) => (call[0] as Record<string, unknown>).clientRequestId
    );
    // ASSIGNMENT_FAILED keeps the same request key so the server resumes the
    // SAME provisioning request instead of purchasing a second number.
    expect(new Set(ids).size).toBe(1);
  });
});
