import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Connect step of the buyer Agent Setup page — number-first flow:
 * Country/State/City appear immediately, the existing business phone is
 * optional and only shown inside the forwarding routing option, and no page
 * action (load, save, continue) ever purchases a number.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("listingId=listing-test-1")
}));

vi.mock("@/components/business/features/api", () => ({
  checkMailAliasAvailability: vi.fn().mockResolvedValue({ success: true, data: { available: true } }),
  deleteBusinessKnowledgeFile: vi.fn().mockResolvedValue({ success: true, data: { deleted: true } }),
  deleteBusinessTestEvent: vi.fn().mockResolvedValue({ success: true, data: { outcome: "deleted" } }),
  disconnectBusinessCalendar: vi.fn().mockResolvedValue({ success: true }),
  getBusinessCalendarOAuthUrl: vi.fn().mockResolvedValue({ success: true, data: { url: "" } }),
  getBusinessKnowledgeFiles: vi.fn().mockResolvedValue({ success: true, data: { files: [] } }),
  getBusinessMailSetup: vi.fn().mockResolvedValue({ success: true, data: { alias: null } }),
  reprocessBusinessKnowledgeFile: vi.fn().mockResolvedValue({ success: true, data: { file: null } }),
  uploadBusinessKnowledgeFiles: vi.fn().mockResolvedValue({ success: true, data: { files: [] } }),
  getBusinessPhoneAssignment: vi.fn().mockResolvedValue({ success: true, data: { assigned: false } }),
  getBusinessSetup: vi.fn(),
  getMarketplaceListing: vi.fn().mockResolvedValue({ success: true, data: { listing: null } }),
  getPhoneCountries: vi.fn(),
  getPhoneStates: vi.fn(),
  getPhoneCities: vi.fn(),
  purchaseBusinessPhoneNumber: vi.fn(),
  runBusinessSetupChatTest: vi.fn().mockResolvedValue({ success: true, data: { reply: "", transcript: [], toolCalls: [], simulated: true } }),
  saveBusinessMailSetup: vi.fn().mockResolvedValue({ success: true, data: {} }),
  saveBusinessSetup: vi.fn(),
  searchBusinessPhoneNumbers: vi.fn(),
  sendBusinessTestSms: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendMailSetupTestEmail: vi.fn().mockResolvedValue({ success: true, data: {} }),
  startBusinessSetupPreviewCall: vi.fn().mockResolvedValue({ success: true, data: { session: null } }),
  testCallRouting: vi.fn().mockResolvedValue({ success: true, data: { readyForCall: false, number: null, webhookUrl: "", resolveReason: null, checks: [] } })
}));

import {
  getBusinessSetup,
  getPhoneCities,
  getPhoneCountries,
  getPhoneStates,
  purchaseBusinessPhoneNumber,
  saveBusinessSetup,
  searchBusinessPhoneNumbers
} from "@/components/business/features/api";
import BusinessAgentSetupPage from "./page";

const COUNTRIES = {
  success: true as const,
  data: {
    countries: [
      { code: "US", name: "United States" },
      { code: "IN", name: "India" }
    ],
    note: "Availability depends on Twilio inventory."
  }
};

function setupData(overrides: Record<string, unknown> = {}) {
  return {
    success: true as const,
    data: {
      business: { id: "biz-1", name: "Test Biz", type: "salon" },
      profile: null,
      phoneNumber: null,
      installedAgent: null,
      knowledge: [],
      calendar: { connected: false, email: null },
      webhooks: null,
      requiredConnectors: [
        { connector: "twilio", label: "Phone", ownedBy: "platform", note: "" },
        { connector: "vapi", label: "Voice", ownedBy: "platform", note: "" }
      ],
      triggerKind: "voice",
      installedAgentId: "agent-1",
      ...overrides
    }
  };
}

beforeEach(() => {
  cleanup();
  vi.mocked(getBusinessSetup).mockReset().mockResolvedValue(setupData() as never);
  vi.mocked(getPhoneCountries).mockReset().mockResolvedValue(COUNTRIES as never);
  vi.mocked(getPhoneStates).mockReset().mockResolvedValue({
    success: true,
    data: { states: [{ code: "CA", name: "California" }], supportsCityFilter: true }
  } as never);
  vi.mocked(getPhoneCities).mockReset().mockResolvedValue({
    success: true,
    data: { cities: ["Los Angeles"] }
  } as never);
  vi.mocked(searchBusinessPhoneNumbers).mockReset().mockResolvedValue({
    success: true,
    data: { numbers: [], exactMatchAvailable: false, matchLevel: "EXACT_CITY", fallbackOptions: [], smsRequired: false }
  } as never);
  vi.mocked(purchaseBusinessPhoneNumber).mockReset();
  vi.mocked(saveBusinessSetup).mockReset().mockResolvedValue(setupData() as never);
});

describe("Connect step — number-first flow", () => {
  it("shows Country/State/City immediately for a first-time buyer, with no existing-phone input and no OTP", async () => {
    render(<BusinessAgentSetupPage />);

    expect(await screen.findByTestId("business-setup-phone-country")).toBeTruthy();
    expect(screen.getByTestId("business-setup-phone-state")).toBeTruthy();
    expect(screen.getByTestId("business-setup-phone-city")).toBeTruthy();
    expect(screen.getByTestId("business-setup-phone-search")).toBeTruthy();

    // The old forwarding-first flow is gone: no existing-phone input, no
    // "Use this number", no verification code anywhere.
    expect(screen.queryByTestId("business-setup-existing-phone")).toBeNull();
    expect(screen.queryByText(/Use this number/i)).toBeNull();
    expect(screen.queryByText(/verification code/i)).toBeNull();

    // Nothing on page load purchased a number.
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
  });

  it("an assigned number shows the Active card and offers no way to search or assign again", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({ phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "", twilioPhoneNumberSid: null } }) as never
    );

    render(<BusinessAgentSetupPage />);

    const assigned = await screen.findByTestId("business-setup-assigned-number");
    expect(assigned.textContent).toContain("+12135550999");
    expect(screen.getByTestId("business-setup-assigned-number-status").textContent).toBe("Active");

    // Number replacement is an admin/support-only process: no Change number,
    // no location search, no assign controls.
    expect(screen.queryByTestId("business-setup-phone-change-number")).toBeNull();
    expect(screen.queryByTestId("business-setup-phone-country")).toBeNull();
    expect(screen.queryByTestId("business-setup-phone-search")).toBeNull();
    expect(screen.queryByTestId("business-setup-phone-confirm")).toBeNull();
    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
  });

  it("direct mode needs no existing phone; forwarding mode reveals the optional input", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "", twilioPhoneNumberSid: null },
        answeringMode: "AI_FIRST"
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();

    // Direct mode: routing card visible, no phone input required or shown.
    expect(await screen.findByTestId("business-setup-routing-card")).toBeTruthy();
    expect(screen.queryByTestId("business-setup-existing-phone")).toBeNull();

    // Switching to forwarding reveals the optional existing-phone input.
    await user.click(screen.getByTestId("business-setup-routing-forward"));
    expect(await screen.findByTestId("business-setup-existing-phone")).toBeTruthy();
    expect(screen.getByText(/no verification needed/i)).toBeTruthy();
    expect(screen.queryByText(/verification code/i)).toBeNull();
  });

  it("Continue and Save Progress never purchase a number and are not blocked by a missing phone", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "", twilioPhoneNumberSid: null },
        answeringMode: "AI_FIRST"
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();

    await screen.findByTestId("business-setup-routing-card");

    await user.click(screen.getByTestId("business-setup-save"));
    await waitFor(() => expect(saveBusinessSetup).toHaveBeenCalled());

    await user.click(screen.getByTestId("business-setup-next"));
    // Step 2 (Configure) becomes active — no "add your phone" error blocked us.
    await waitFor(() => expect(screen.getByTestId("business-setup-input-name")).toBeTruthy());

    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
    expect(searchBusinessPhoneNumbers).not.toHaveBeenCalled();
  });
});
