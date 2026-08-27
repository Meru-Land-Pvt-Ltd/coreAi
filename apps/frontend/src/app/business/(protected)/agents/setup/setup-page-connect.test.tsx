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
  deleteBusinessKnowledgeFile: vi.fn().mockResolvedValue({
    success: true,
    data: { deleted: true, liveSync: { attempted: false, ok: false, assistantId: null, error: null } }
  }),
  deleteBusinessTestEvent: vi.fn().mockResolvedValue({ success: true, data: { outcome: "deleted" } }),
  disconnectBusinessCalendar: vi.fn().mockResolvedValue({ success: true }),
  getAppointmentSchedule: vi.fn().mockResolvedValue({
    success: true,
    data: {
      schedule: {
        timeZone: "America/Los_Angeles",
        days: {
          sunday: { open: "09:00", close: "17:00", closed: true },
          monday: { open: "09:00", close: "17:00", closed: false },
          tuesday: { open: "09:00", close: "17:00", closed: false },
          wednesday: { open: "09:00", close: "17:00", closed: false },
          thursday: { open: "09:00", close: "17:00", closed: false },
          friday: { open: "09:00", close: "17:00", closed: false },
          saturday: { open: "09:00", close: "17:00", closed: true }
        },
        defaultDurationMinutes: 30,
        serviceDurations: {},
        bufferMinutes: 10,
        slotIntervalMinutes: 40,
        minNoticeMinutes: 60,
        maxAdvanceDays: 60,
        maxSpokenSuggestions: 5,
        calendarId: "primary",
        source: "business_hours",
        confirmed: false
      },
      installedAgentId: null,
      needsConfirmation: true,
      documentSuggestion: null
    }
  }),
  getBusinessCalendarOAuthUrl: vi.fn().mockResolvedValue({ success: true, data: { url: "" } }),
  getBusinessFacts: vi.fn().mockResolvedValue({
    success: true,
    data: {
      businessName: null,
      address: null,
      addressFormatted: null,
      addressComplete: false,
      addressConfirmed: false,
      phone: null,
      documentSuggestion: null,
      conflict: false
    }
  }),
  saveBusinessAddressApi: vi.fn().mockResolvedValue({
    success: true,
    data: {
      addressFormatted: null,
      addressConfirmed: true,
      liveSync: { attempted: false, ok: false, assistantId: null, error: null }
    }
  }),
  getBusinessKnowledgeFiles: vi.fn().mockResolvedValue({ success: true, data: { files: [] } }),
  getBusinessMailSetup: vi.fn().mockResolvedValue({ success: true, data: { alias: null } }),
  reprocessBusinessKnowledgeFile: vi.fn().mockResolvedValue({
    success: true,
    data: { file: null, liveSync: { attempted: false, ok: false, assistantId: null, error: null } }
  }),
  syncBusinessKnowledge: vi.fn().mockResolvedValue({
    success: true,
    data: { liveSync: { attempted: false, ok: false, assistantId: null, error: null } }
  }),
  uploadBusinessKnowledgeFiles: vi.fn().mockResolvedValue({
    success: true,
    data: { files: [], liveSync: { attempted: false, ok: false, assistantId: null, error: null } }
  }),
  getBusinessHours: vi.fn().mockResolvedValue({
    success: true,
    data: { weekly: null, special: [], timeZone: "America/Los_Angeles", source: null, confirmedAt: null, configured: false, liveSyncStatus: null }
  }),
  putBusinessHours: vi.fn().mockResolvedValue({ success: true, data: {} }),
  syncBusinessHoursToLiveAgent: vi.fn().mockResolvedValue({ success: true, data: {} }),
  /* The setup page asks for these on mount. Without it in the mock every
     test in this file dies before it renders a single field. */
  getInboundAddresses: vi.fn().mockResolvedValue({ success: true, data: { addresses: [] } }),
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
  getBusinessFacts,
  getBusinessHours,
  getBusinessSetup,
  getPhoneCities,
  getPhoneCountries,
  getPhoneStates,
  purchaseBusinessPhoneNumber,
  putBusinessHours,
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
      setupTimeEstimate: "3 min",
      assistantName: "AI Assistant",
      voiceSelection: { name: "triven-default", voiceId: "" },
      ...overrides
    }
  };
}

beforeEach(() => {
  cleanup();
  vi.mocked(getBusinessFacts).mockReset().mockResolvedValue({
    success: true,
    data: {
      businessName: null,
      address: null,
      addressFormatted: null,
      addressComplete: false,
      addressConfirmed: false,
      phone: null,
      documentSuggestion: null,
      conflict: false
    }
  } as never);
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

  it("keeps the Configure step locked when Connect step is incomplete", async () => {
    vi.mocked(getBusinessFacts).mockResolvedValue({
      success: true,
      data: {
        businessName: "Test Biz",
        address: null,
        addressFormatted: null,
        addressComplete: true,
        addressConfirmed: true,
        phone: null,
        documentSuggestion: null,
        conflict: false
      }
    } as never);

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();

    await screen.findByTestId("business-setup-wizard");

    const configureStep = screen.getByTestId("business-setup-dot-2");
    expect(configureStep.getAttribute("aria-disabled")).toBe("true");
    expect(configureStep.className).not.toContain("done");

    await user.click(configureStep);

    expect(screen.getByTestId("business-setup-dot-1").getAttribute("aria-current")).toBe("step");

    const nextBtn = screen.getByTestId("business-setup-next");
    expect(nextBtn.hasAttribute("disabled")).toBe(true);
  });

  it("unlocks the Configure step when Connect step is complete", async () => {
    vi.mocked(getBusinessFacts).mockResolvedValue({
      success: true,
      data: {
        businessName: "Test Biz",
        address: null,
        addressFormatted: null,
        addressComplete: true,
        addressConfirmed: true,
        phone: null,
        documentSuggestion: null,
        conflict: false
      }
    } as never);
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "", twilioPhoneNumberSid: null },
        answeringMode: "AI_FIRST"
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();

    await screen.findByTestId("business-setup-wizard");
    await user.click(screen.getByTestId("business-setup-routing-direct"));

    const configureStep = screen.getByTestId("business-setup-dot-2");
    expect(configureStep.getAttribute("aria-disabled")).toBeNull();

    await user.click(configureStep);
    await screen.findByTestId("business-setup-configure");
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

    // New installations start in forwarding mode and do not inherit another
    // agent's direct-routing preference.
    expect(await screen.findByTestId("business-setup-routing-card")).toBeTruthy();
    expect(screen.getByTestId("business-setup-existing-phone")).toBeTruthy();

    // Direct mode needs no existing phone.
    await user.click(screen.getByTestId("business-setup-routing-direct"));
    expect(screen.queryByTestId("business-setup-existing-phone")).toBeNull();

    // Switching to forwarding reveals the optional existing-phone input.
    await user.click(screen.getByTestId("business-setup-routing-forward"));
    expect(await screen.findByTestId("business-setup-existing-phone")).toBeTruthy();
    expect(screen.getByText(/no verification needed/i)).toBeTruthy();
    expect(screen.queryByText(/verification code/i)).toBeNull();
  });

  it("shows the View Steps button in forwarding mode and opens a modal with instructions when clicked", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "", twilioPhoneNumberSid: null },
        answeringMode: "AI_FIRST"
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();

    // Wait for loading to finish and routing card to appear
    await screen.findByTestId("business-setup-routing-card");

    // Switch to forwarding mode
    await user.click(screen.getByTestId("business-setup-routing-forward"));

    // Find the View Steps button
    const viewStepsBtn = await screen.findByTestId("business-setup-view-steps");
    expect(viewStepsBtn).toBeTruthy();

    // Verify modal is not in the DOM initially
    expect(screen.queryByTestId("business-setup-forwarding-steps-modal")).toBeNull();

    // Click the button to open the modal
    await user.click(viewStepsBtn);

    // Verify modal and forwarding steps are visible
    const modal = await screen.findByTestId("business-setup-forwarding-steps-modal");
    expect(modal).toBeTruthy();
    expect(screen.getByText(/conditional-forwarding code for your carrier/i)).toBeTruthy();

    // Click Close to close the modal
    const closeBtn = screen.getAllByRole("button", { name: /close/i })[0];
    await user.click(closeBtn);

    // Verify modal is closed
    expect(screen.queryByTestId("business-setup-forwarding-steps-modal")).toBeNull();
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

    await user.click(screen.getByTestId("business-setup-routing-direct"));
    await user.click(screen.getByTestId("business-setup-next"));
    // Step 2 (Configure) becomes active — no "add your phone" error blocked us.
    await waitFor(() => expect(screen.getByTestId("business-setup-input-name")).toBeTruthy());

    expect(purchaseBusinessPhoneNumber).not.toHaveBeenCalled();
    expect(searchBusinessPhoneNumbers).not.toHaveBeenCalled();
  });

  it("the Connect step owns the business timezone — editable select, saved with the setup", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "+12135559999", twilioPhoneNumberSid: null },
        business: { id: "biz-1", name: "Test Biz", type: "salon" },
        profile: {
          bookingUrl: null,
          teamPhone: null,
          calendarId: "primary",
          timeZone: "America/Los_Angeles",
          tone: "friendly",
          escalationRules: null,
          services: [],
          faqs: [],
          hours: [],
          vapiAssistantId: null,
          vapiPhoneNumberId: null
        }
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();

    const select = await screen.findByTestId("business-setup-timezone-select");
    expect((select as HTMLSelectElement).value).toBe("America/Los_Angeles");

    await user.selectOptions(select, "America/Chicago");
    await user.click(screen.getByTestId("business-setup-next"));

    await waitFor(() => expect(saveBusinessSetup).toHaveBeenCalled());
    const payload = vi.mocked(saveBusinessSetup).mock.calls[0][0] as Record<string, any>;
    expect(payload.timeZone).toBe("America/Chicago");
  });

  it("a live agent's timezone change persists through hours and setup without a false toast", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        vapiAssistantId: "vapi-live-1",
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "+12135559999", twilioPhoneNumberSid: null },
        profile: {
          bookingUrl: null,
          teamPhone: null,
          calendarId: "primary",
          timeZone: "America/Los_Angeles",
          tone: "friendly",
          escalationRules: null,
          services: [],
          faqs: [],
          hours: [],
          vapiAssistantId: "vapi-live-1",
          vapiPhoneNumberId: null
        }
      }) as never
    );
    vi.mocked(getBusinessHours).mockResolvedValue({
      success: true,
      data: {
        hours: [{ day: "monday", closed: false, periods: [{ open: "09:00", close: "17:00" }] }],
        timeZone: "America/Los_Angeles",
        specialDates: [],
        source: "manual",
        confirmedAt: null,
        configured: true,
        weeklySummary: ["Monday: 9 AM–5 PM"],
        openStatus: null,
        suggestion: null,
        liveAssistant: true
      }
    } as never);

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();

    const select = await screen.findByTestId("business-setup-timezone-select");
    await user.selectOptions(select, "America/Denver");
    await user.click(screen.getByTestId("business-setup-next"));

    // The timezone rides the live-safe hours endpoint, then the main setup
    // payload saves the remaining configuration without resending timezone.
    await waitFor(() => expect(putBusinessHours).toHaveBeenCalled());
    const put = vi.mocked(putBusinessHours).mock.calls[0][0] as Record<string, any>;
    expect(put.timeZone).toBe("America/Denver");
    expect(put.hours.length).toBeGreaterThan(0);
    expect(saveBusinessSetup).toHaveBeenCalledTimes(1);
    expect((vi.mocked(saveBusinessSetup).mock.calls[0][0] as Record<string, any>).timeZone).toBeUndefined();
    expect(screen.getByText("Progress saved")).toBeTruthy();
  });

  it("an off-list stored IANA timezone stays displayed and selectable", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        profile: {
          bookingUrl: null,
          teamPhone: null,
          calendarId: "primary",
          timeZone: "Pacific/Chatham",
          tone: "friendly",
          escalationRules: null,
          services: [],
          faqs: [],
          hours: [],
          vapiAssistantId: null,
          vapiPhoneNumberId: null
        }
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();

    const select = (await screen.findByTestId("business-setup-timezone-select")) as HTMLSelectElement;
    expect(select.value).toBe("Pacific/Chatham");

    // Switching away must not drop the off-list zone from the options.
    await user.selectOptions(select, "America/Chicago");
    expect(select.value).toBe("America/Chicago");
    await user.selectOptions(select, "Pacific/Chatham");
    expect(select.value).toBe("Pacific/Chatham");
  });
});
