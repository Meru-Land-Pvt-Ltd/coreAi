import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneNumberSelectionSection } from "./phone-number-selection";

/**
 * The Triven AI number selection card: Country → State → City → one offered
 * number → confirm. Search never purchases; purchase happens exactly once,
 * only on explicit confirmation, with a clientRequestId.
 */

vi.mock("@/components/business/features/api", () => ({
  getBusinessPhoneAssignment: vi.fn(),
  getPhoneCountries: vi.fn(),
  getPhoneStates: vi.fn(),
  getPhoneCities: vi.fn(),
  searchBusinessPhoneNumbers: vi.fn(),
  purchaseBusinessPhoneNumber: vi.fn()
}));

import {
  getBusinessPhoneAssignment,
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

const FIRST_NUMBER = {
  phoneNumber: "+12135550123",
  friendlyName: "(213) 555-0123",
  country: "US",
  region: "CA",
  locality: "Los Angeles",
  capabilities: { voice: true, sms: true, mms: false },
  numberType: "LOCAL" as const,
  regulatoryNote: null,
  checkedAt: "2026-07-18T00:00:00.000Z"
};

const SECOND_NUMBER = {
  ...FIRST_NUMBER,
  phoneNumber: "+12135550999",
  friendlyName: "(213) 555-0999"
};

const SAN_DIEGO_NUMBER = {
  ...FIRST_NUMBER,
  phoneNumber: "+16195550111",
  friendlyName: "(619) 555-0111",
  locality: "San Diego"
};

const SEARCH_RESULT = {
  success: true as const,
  data: {
    numbers: [
      FIRST_NUMBER,
      SECOND_NUMBER
    ],
    exactMatchAvailable: true,
    matchLevel: "EXACT_CITY" as const,
    fallbackOptions: [],
    smsRequired: false
  }
};

const SAN_DIEGO_SEARCH_RESULT = {
  ...SEARCH_RESULT,
  data: {
    ...SEARCH_RESULT.data,
    numbers: [SAN_DIEGO_NUMBER]
  }
};

async function selectLocationAndWaitForOffer() {
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByTestId("business-setup-phone-country"), "US");
  await screen.findByRole("option", { name: "California" });
  await user.selectOptions(screen.getByTestId("business-setup-phone-state"), "CA");
  await screen.findByRole("option", { name: "Los Angeles" });
  await user.selectOptions(screen.getByTestId("business-setup-phone-city"), "Los Angeles");
  await screen.findByTestId("business-setup-phone-result");
  return user;
}

beforeEach(() => {
  cleanup();
  vi.mocked(getBusinessPhoneAssignment).mockReset().mockResolvedValue({
    success: true,
    data: { assigned: false }
  } as never);
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

  it("loads states and cities lazily, then automatically searches the selected location", async () => {
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
    await waitFor(() => expect(searchBusinessPhoneNumbers).toHaveBeenCalledWith({
      installedAgentId: undefined,
      listingId: "listing-1",
      country: "IN",
      state: "UP",
      city: "Noida"
    }));
    // Finding the offer never purchases it.
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
  });

  it("shows the safe catalogue error with retry instead of hiding the section", async () => {
    vi.mocked(getPhoneCountries).mockResolvedValue({ success: false, error: "Locations service unavailable" } as never);

    render(<PhoneNumberSelectionSection installedAgentId={null} onProvisioned={vi.fn()} />);

    const errorBox = await screen.findByTestId("business-setup-phone-locations-error");
    expect(errorBox.textContent).toContain("Locations service unavailable");
    expect(screen.getByTestId("business-setup-phone-locations-retry")).toBeTruthy();
  });

  it("auto-search sends the location payload with listingId and NEVER purchases", async () => {
    render(<PhoneNumberSelectionSection installedAgentId="agent-1" listingId="listing-1" onProvisioned={vi.fn()} />);
    await selectLocationAndWaitForOffer();

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

  it("shows only the first available number and waits for explicit confirmation", async () => {
    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={vi.fn()} />);
    await selectLocationAndWaitForOffer();

    expect(screen.getByText(FIRST_NUMBER.friendlyName)).toBeTruthy();
    expect(screen.queryByText(SECOND_NUMBER.friendlyName)).toBeNull();
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();

    // The one offer is already selected, but buying still requires confirmation.
    expect(screen.getByTestId("business-setup-phone-confirm")).toBeTruthy();
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
  });

  it("confirm triggers exactly one purchase request with a clientRequestId", async () => {
    const onProvisioned = vi.fn();
    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={onProvisioned} />);
    const user = await selectLocationAndWaitForOffer();

    await user.click(screen.getByTestId("business-setup-phone-confirm"));

    await waitFor(() => expect(purchaseBusinessPhoneNumber).toHaveBeenCalledTimes(1));
    const body = vi.mocked(purchaseBusinessPhoneNumber).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.phoneNumber).toBe("+12135550123");
    expect(body.listingId).toBe("listing-1");
    expect(String(body.clientRequestId).length).toBeGreaterThanOrEqual(8);
    expect(onProvisioned).toHaveBeenCalledWith("+12135550123");
  });

  it("ignores an older search response after the buyer changes city", async () => {
    let resolveLosAngelesSearch: ((value: unknown) => void) | undefined;
    vi.mocked(searchBusinessPhoneNumbers)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveLosAngelesSearch = resolve;
      }) as never)
      .mockResolvedValueOnce(SAN_DIEGO_SEARCH_RESULT as never);

    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={vi.fn()} />);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByTestId("business-setup-phone-country"), "US");
    await screen.findByRole("option", { name: "California" });
    await user.selectOptions(screen.getByTestId("business-setup-phone-state"), "CA");
    await screen.findByRole("option", { name: "Los Angeles" });
    await user.selectOptions(screen.getByTestId("business-setup-phone-city"), "Los Angeles");
    await waitFor(() => expect(searchBusinessPhoneNumbers).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByTestId("business-setup-phone-city"), "San Diego");
    await waitFor(() => expect(searchBusinessPhoneNumbers).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(SAN_DIEGO_NUMBER.friendlyName)).toBeTruthy();

    await act(async () => {
      resolveLosAngelesSearch?.(SEARCH_RESULT);
      await Promise.resolve();
    });

    expect(screen.queryByText(FIRST_NUMBER.friendlyName)).toBeNull();
    expect(screen.getByText(SAN_DIEGO_NUMBER.friendlyName)).toBeTruthy();
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
  });

  it("starts a fresh provisioning key when a new location produces a new offer", async () => {
    vi.mocked(searchBusinessPhoneNumbers)
      .mockResolvedValueOnce(SEARCH_RESULT as never)
      .mockResolvedValueOnce(SAN_DIEGO_SEARCH_RESULT as never);
    vi.mocked(purchaseBusinessPhoneNumber)
      .mockResolvedValueOnce({
        success: true,
        data: { status: "FAILED", requestId: "req_1", phoneNumber: null, alreadyCompleted: false, errorCode: "ASSIGNMENT_FAILED", errorMessage: "Try again." }
      } as never)
      .mockResolvedValueOnce({
        success: true,
        data: { status: "ACTIVE", requestId: "req_2", phoneNumber: SAN_DIEGO_NUMBER.phoneNumber, alreadyCompleted: false, errorCode: null, errorMessage: null }
      } as never);

    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={vi.fn()} />);
    const user = await selectLocationAndWaitForOffer();

    await user.click(screen.getByTestId("business-setup-phone-confirm"));
    await waitFor(() => expect(purchaseBusinessPhoneNumber).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByTestId("business-setup-phone-city"), "San Diego");
    expect(await screen.findByText(SAN_DIEGO_NUMBER.friendlyName)).toBeTruthy();
    await user.click(screen.getByTestId("business-setup-phone-confirm"));
    await waitFor(() => expect(purchaseBusinessPhoneNumber).toHaveBeenCalledTimes(2));

    const calls = vi.mocked(purchaseBusinessPhoneNumber).mock.calls;
    expect((calls[0]?.[0] as { clientRequestId: string }).clientRequestId)
      .not.toBe((calls[1]?.[0] as { clientRequestId: string }).clientRequestId);
    expect((calls[1]?.[0] as { phoneNumber: string }).phoneNumber).toBe(SAN_DIEGO_NUMBER.phoneNumber);
  });

  it("repeat confirmations reuse the same clientRequestId (idempotent, never a second number)", async () => {
    // First attempt fails transiently so the confirm button stays available.
    vi.mocked(purchaseBusinessPhoneNumber).mockResolvedValueOnce({
      success: true,
      data: { status: "FAILED", requestId: "req_1", phoneNumber: null, alreadyCompleted: false, errorCode: "ASSIGNMENT_FAILED", errorMessage: "Retry shortly." }
    } as never);

    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={vi.fn()} />);
    const user = await selectLocationAndWaitForOffer();

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

  it("never shows a price, provider cost, or $ amount on the offered number", async () => {
    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={vi.fn()} />);
    await selectLocationAndWaitForOffer();

    const review = screen.getByTestId("business-setup-phone-review");
    expect(review.textContent).not.toContain("$");
    expect(review.textContent?.toLowerCase()).not.toContain("twilio");
    /* No amount, and no supplier named — but it must not say the number is
       free either. It is billed every month for as long as they keep it. */
    expect(review.textContent).toContain("Billed monthly while it is assigned to you");
    expect(review.textContent).not.toContain("Included");
  });

  it("shows a clean informative error banner when no countries are available", async () => {
    vi.mocked(getPhoneCountries).mockResolvedValue({
      success: true,
      data: { countries: [], note: "" }
    } as never);

    render(<PhoneNumberSelectionSection installedAgentId={null} onProvisioned={vi.fn()} />);

    const errorBox = await screen.findByTestId("business-setup-phone-locations-error");
    expect(errorBox.textContent).toContain("No countries available");
    expect(screen.getByTestId("business-setup-phone-locations-retry")).toBeTruthy();
  });

  it("normalizes missing API credentials or configuration errors into clear user-friendly messages", async () => {
    vi.mocked(getPhoneCountries).mockResolvedValue({
      success: false,
      error: "Twilio API key missing in environment configuration"
    } as never);

    render(<PhoneNumberSelectionSection installedAgentId={null} onProvisioned={vi.fn()} />);

    const errorBox = await screen.findByTestId("business-setup-phone-locations-error");
    expect(errorBox.textContent).toContain("Phone service is unconfigured or missing API credentials.");
  });
});

describe("existing assignment (one number only)", () => {
  const ASSIGNMENT = {
    success: true as const,
    data: {
      assigned: true as const,
      phoneNumber: "+12135550123",
      status: "ACTIVE" as const,
      country: "US",
      region: "CA",
      locality: "Los Angeles",
      capabilities: { voice: true, sms: true },
      assignedAt: "2026-07-18T00:00:00.000Z",
      installedAgentId: "agent-1"
    }
  };

  it("shows the assigned number with Active status and hides search and assign entirely", async () => {
    vi.mocked(getBusinessPhoneAssignment).mockResolvedValue(ASSIGNMENT as never);

    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={vi.fn()} />);

    expect(await screen.findByTestId("business-setup-phone-assignment")).toBeTruthy();
    expect(screen.getByTestId("business-setup-phone-assignment-number").textContent).toBe("+12135550123");
    expect(screen.getByTestId("business-setup-phone-assignment-status").textContent).toBe("Active");
    expect(screen.getByTestId("business-setup-phone-assignment-details").textContent).toContain("Los Angeles");

    expect(screen.queryByTestId("business-setup-phone-country")).toBeNull();
    expect(screen.queryByTestId("business-setup-phone-search")).toBeNull();
    expect(screen.queryByTestId("business-setup-phone-confirm")).toBeNull();
    expect(searchBusinessPhoneNumbers).not.toHaveBeenCalled();
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
  });

  it("switches to the assignment when a search reports the number already assigned", async () => {
    vi.mocked(searchBusinessPhoneNumbers).mockResolvedValue({
      success: true,
      data: {
        numbers: [],
        exactMatchAvailable: false,
        matchLevel: "NATIONAL",
        fallbackOptions: [],
        smsRequired: false,
        localityFilterSupported: true,
        alreadyAssigned: ASSIGNMENT.data
      }
    } as never);

    render(<PhoneNumberSelectionSection installedAgentId={null} listingId="listing-1" onProvisioned={vi.fn()} />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByTestId("business-setup-phone-country"), "US");
    await screen.findByRole("option", { name: "California" });
    await user.selectOptions(screen.getByTestId("business-setup-phone-state"), "CA");
    await screen.findByRole("option", { name: "Los Angeles" });
    await user.selectOptions(screen.getByTestId("business-setup-phone-city"), "Los Angeles");

    expect(await screen.findByTestId("business-setup-phone-assignment")).toBeTruthy();
    expect(screen.queryByTestId("business-setup-phone-confirm")).toBeNull();
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
  });
});
