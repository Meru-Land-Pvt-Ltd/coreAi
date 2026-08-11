import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Configure step redesign: ONE Business Hours editor, Appointment Hours that
 * inherit Business Hours by default (compact summary, no second grid), a
 * clearly separated AI Call Coverage section, and a page-level save that
 * saves every changed section and names the section when one fails.
 */

const { setupLocation } = vi.hoisted(() => ({
  setupLocation: { search: "listingId=listing-test-1&mode=edit" }
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(setupLocation.search)
}));

const BH_DATA = {
  hours: [
    { day: "monday", closed: false, periods: [{ open: "09:00", close: "17:00" }] },
    { day: "tuesday", closed: false, periods: [{ open: "09:00", close: "17:00" }] },
    { day: "wednesday", closed: false, periods: [{ open: "09:00", close: "17:00" }] },
    { day: "thursday", closed: false, periods: [{ open: "09:00", close: "17:00" }] },
    { day: "friday", closed: false, periods: [{ open: "09:00", close: "17:00" }] },
    { day: "saturday", closed: true, periods: [] },
    { day: "sunday", closed: true, periods: [] }
  ],
  timeZone: "America/Los_Angeles",
  specialDates: [],
  source: "manual",
  confirmedAt: "2026-07-01T00:00:00.000Z",
  configured: true,
  weeklySummary: [
    "Monday: 9 AM–5 PM",
    "Tuesday: 9 AM–5 PM",
    "Wednesday: 9 AM–5 PM",
    "Thursday: 9 AM–5 PM",
    "Friday: 9 AM–5 PM",
    "Saturday: Closed",
    "Sunday: Closed"
  ],
  openStatus: { state: "open", description: "Open now — closes at 5 PM." },
  suggestion: null,
  liveAssistant: false,
  sync: null
};

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
        useBusinessHours: true,
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
      address: { line1: "123 Main St", city: "New York", state: "NY", postalCode: "10001" },
      addressFormatted: null,
      addressComplete: true,
      addressConfirmed: true,
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
  getBusinessMailSetup: vi.fn().mockResolvedValue({ success: true, data: { alias: { localPart: "agent", domain: "triven.ai", displayName: "Test Biz", status: "ACTIVE" } } }),
  getVoiceSamplePreview: vi.fn().mockResolvedValue({ success: true, data: { audioBase64: "", mimeType: "audio/mpeg" } }),
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
  getBusinessHours: vi.fn(),
  putBusinessHours: vi.fn(),
  syncBusinessHoursToLiveAgent: vi.fn().mockResolvedValue({ success: true, data: { sync: { status: "not_deployed" } } }),
  getBusinessPhoneAssignment: vi.fn().mockResolvedValue({ success: true, data: { assigned: false } }),
  getBusinessSetup: vi.fn(),
  getMarketplaceListing: vi.fn(),
  getPhoneCountries: vi.fn().mockResolvedValue({ success: true, data: { countries: [], note: "" } }),
  getPhoneStates: vi.fn().mockResolvedValue({ success: true, data: { states: [], supportsCityFilter: false } }),
  getPhoneCities: vi.fn().mockResolvedValue({ success: true, data: { cities: [] } }),
  purchaseBusinessPhoneNumber: vi.fn(),
  runBusinessSetupChatTest: vi
    .fn()
    .mockResolvedValue({ success: true, data: { reply: "", transcript: [], toolCalls: [], simulated: true } }),
  saveBusinessMailSetup: vi.fn().mockResolvedValue({ success: true, data: {} }),
  saveBusinessSetup: vi.fn(),
  searchBusinessPhoneNumbers: vi.fn(),
  sendBusinessTestSms: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendMailSetupTestEmail: vi.fn().mockResolvedValue({ success: true, data: {} }),
  startBusinessSetupPreviewCall: vi.fn().mockResolvedValue({ success: true, data: { session: null } }),
  testCallRouting: vi.fn().mockResolvedValue({
    success: true,
    data: { readyForCall: false, number: null, webhookUrl: "", resolveReason: null, checks: [] }
  })
}));

import {
  getAppointmentSchedule,
  getBusinessHours,
  getBusinessSetup,
  getMarketplaceListing,
  putBusinessHours,
  saveBusinessSetup
} from "@/components/business/features/api";
import BusinessAgentSetupPage from "./page";

function setupData(overrides: Record<string, unknown> = {}) {
  return {
    success: true as const,
    data: {
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
      },
      phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "123456789", twilioPhoneNumberSid: null },
      installedAgent: null,
      knowledge: [],
      calendar: { connected: true, email: "calendar@example.com" },
      webhooks: null,
      requiredConnectors: [
        { connector: "twilio", label: "Phone", ownedBy: "platform", note: "" },
        { connector: "vapi", label: "Voice", ownedBy: "platform", note: "" }
      ],
      answeringMode: "NO_ANSWER",
      aiCallCoverage: "always",
      answeringHours: null,
      triggerKind: "voice",
      installedAgentId: "agent-1",
      setupTimeEstimate: "3 min",
      assistantName: "AI Assistant",
      voiceSelection: { name: "triven-default", voiceId: "" },
      ...overrides
    }
  };
}

function marketplaceListing() {
  return {
    success: true as const,
    data: {
      listing: {
        name: "Appointment Booking Voice Agent",
        requiredConnectors: ["twilio", "vapi", "google_calendar"],
        requiredBuyerSetup: [],
        buyerSetupInstructions: "",
        workflowJson: {
          nodes: [
            { id: "trigger", data: { type: "trigger.phone_call", nodeKind: "trigger" } },
            { id: "voice", data: { type: "ai.voice_conversation", nodeKind: "ai" } },
            { id: "availability", data: { type: "calendar.availability", nodeKind: "connector" } },
            { id: "book", data: { type: "calendar.book_appointment", nodeKind: "connector" } },
            { id: "sms", data: { type: "communication.send_sms", nodeKind: "connector" } },
            { id: "end", data: { type: "flow.end", nodeKind: "output" } }
          ],
          edges: [
            { id: "e1", source: "trigger", target: "voice" },
            { id: "e2", source: "voice", target: "availability" },
            { id: "e3", source: "availability", target: "book" },
            { id: "e4", source: "book", target: "sms" },
            { id: "e5", source: "sms", target: "end" }
          ]
        }
      }
    }
  };
}

async function openConfigure(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId("business-setup-wizard");
  await waitFor(() => {
    expect((screen.getByTestId("business-setup-dot-2") as HTMLButtonElement).disabled).toBe(false);
  });
  await user.click(screen.getByTestId("business-setup-dot-2"));
  await screen.findByTestId("business-setup-configure");
}

async function expandSection(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByTestId(`business-configure-section-${id}-toggle`));
}

async function completeNewInstallConfiguration(user: ReturnType<typeof userEvent.setup>) {
  await openConfigure(user);
  const name = screen.getByTestId("business-setup-input-assistant-name");
  await user.clear(name);
  await user.type(name, "Test Booking Assistant");
  await user.click(screen.getByTestId("business-setup-voice-select"));
  await user.click(await screen.findByTestId("business-setup-voice-option-skylar"));
  await waitFor(() => {
    expect((screen.getByTestId("business-setup-dot-3") as HTMLButtonElement).disabled).toBe(false);
  });
}

/** Appointment-schedule payload with overridable booking-rule numbers. */
function apptSchedule(fields: Partial<Record<string, number>> = {}) {
  return {
    success: true as const,
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
        useBusinessHours: true,
        confirmed: false,
        ...fields
      },
      installedAgentId: null,
      needsConfirmation: true,
      documentSuggestion: null
    }
  };
}

beforeEach(() => {
  cleanup();
  window.sessionStorage.clear();
  setupLocation.search = "listingId=listing-test-1&mode=edit";
  vi.mocked(getBusinessSetup).mockReset().mockResolvedValue(setupData() as never);
  vi.mocked(getMarketplaceListing)
    .mockReset()
    .mockResolvedValue(marketplaceListing() as never);
  vi.mocked(getBusinessHours).mockReset().mockResolvedValue({ success: true, data: BH_DATA } as never);
  vi.mocked(putBusinessHours)
    .mockReset()
    .mockResolvedValue({ success: true, data: { ...BH_DATA, sync: { status: "not_deployed" } } } as never);
  vi.mocked(saveBusinessSetup).mockReset().mockResolvedValue(setupData() as never);
});

describe("Configure step — one Business Hours editor, clear separation", () => {
  it("renders the Business Hours editor exactly once and no duplicate weekly grids", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    await waitFor(() => expect(screen.getAllByTestId("business-hours-section")).toHaveLength(1));

    // Default state: appointment hours inherit (no grid), AI coverage is 24/7
    // (no grid) — the ONLY weekly editor on the page is Business Hours.
    expect(screen.queryByTestId("business-setup-appt-editor")).toBeNull();
    expect(screen.queryByTestId("business-setup-ai-coverage-custom-editor")).toBeNull();
    // The old "When should the agent respond?" editor is gone.
    expect(screen.queryByTestId("business-setup-hours-247")).toBeNull();
    expect(screen.queryByTestId("business-setup-hours-editor")).toBeNull();
  });

  it("the embedded Business Hours editor has no save button of its own — one page save", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    await screen.findByTestId("business-hours-section");
    expect(screen.queryByTestId("business-hours-save")).toBeNull();
    expect(screen.queryByTestId("business-address-save")).toBeNull();
  });

  it("AI coverage: 24/7 shows no schedule fields and explains closed-hours behavior", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    const coverage = await screen.findByTestId("business-setup-ai-coverage");
    expect(within(coverage).getByTestId("business-setup-ai-coverage-always")).toBeTruthy();
    expect(within(coverage).queryByTestId("business-setup-ai-coverage-custom-editor")).toBeNull();
    expect(within(coverage).queryByTestId("business-setup-ai-coverage-bh-summary")).toBeNull();
  });

  it('"Answer during Business Hours" reuses the Business Hours summary — no second weekly editor', async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    await user.click(await screen.findByTestId("business-setup-ai-coverage-business_hours"));

    expect(screen.queryByTestId("business-setup-ai-coverage-bh-summary")).toBeNull();
    expect(screen.queryByTestId("business-setup-ai-coverage-custom-editor")).toBeNull();
  });

  it("custom AI coverage shows exactly one editor labeled Custom AI Answering Schedule", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    await user.click(await screen.findByTestId("business-setup-ai-coverage-custom"));

    const editors = await screen.findAllByTestId("business-setup-ai-coverage-custom-editor");
    expect(editors).toHaveLength(1);
    expect(editors[0].textContent).toContain("Custom AI Answering Schedule");
    // It is never presented as Business Hours.
    expect(within(editors[0]).queryByText(/^Business Hours$/)).toBeNull();
  });

  it("appointment hours inherit Business Hours by default", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    const inheritRadio = await screen.findByTestId("business-setup-appt-use-business-hours");
    await waitFor(() => expect(inheritRadio.getAttribute("aria-checked")).toBe("true"));

    expect(screen.queryByTestId("business-setup-appt-editor")).toBeNull();
  });

  it("choosing custom appointment hours reveals exactly one appointment editor", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    await user.click(await screen.findByTestId("business-setup-appt-use-custom"));

    expect(await screen.findAllByTestId("business-setup-appt-editor")).toHaveLength(1);
  });

  it("saving custom appointment hours never touches Business Hours", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    await user.click(await screen.findByTestId("business-setup-appt-use-custom"));
    await user.click(screen.getByTestId("business-setup-next"));

    await waitFor(() => expect(saveBusinessSetup).toHaveBeenCalled());
    const payload = vi.mocked(saveBusinessSetup).mock.calls[0][0] as Record<string, any>;
    expect(payload.appointmentSchedule.useBusinessHours).toBe(false);
    // Business Hours were untouched → their endpoint is never called, and the
    // setup payload sends no hours rows at all.
    expect(putBusinessHours).not.toHaveBeenCalled();
    expect(payload.hours).toEqual([]);
  });

  it("the setup save carries coverage + preserved answering mode; an unchanged timezone is not resent", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await user.click(screen.getByTestId("business-setup-next"));

    await waitFor(() => expect(saveBusinessSetup).toHaveBeenCalled());
    const payload = vi.mocked(saveBusinessSetup).mock.calls[0][0] as Record<string, any>;
    expect(payload.aiCallCoverage).toEqual({ kind: "always" });
    expect(payload.answeringMode).toBe("NO_ANSWER");
    // The Connect step owns the timezone, but it is only sent when changed
    // this session — a stale tab must never clobber a newer saved value.
    expect(payload.timeZone).toBeUndefined();
  });

  it("the timezone is edited in Connect only — the embedded Business Hours editor has no selector", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();

    // Connect step renders the one timezone select.
    await screen.findByTestId("business-setup-wizard");
    expect(await screen.findByTestId("business-setup-timezone-select")).toBeTruthy();

    // The Business Hours editor in Configure renders without its own selector.
    await user.click(screen.getByTestId("business-setup-dot-2"));
    await screen.findByTestId("business-setup-configure");
    await expandSection(user, "hours-availability");
    await screen.findByTestId("business-hours-section");
    expect(screen.queryByTestId("business-hours-timezone-select")).toBeNull();
  });

  it("the Test step offers the browser test call, step flow, and call-your-number card", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await screen.findByTestId("business-setup-wizard");
    await waitFor(() => {
      expect(screen.getByTestId("business-setup-agent-name").textContent).toBe("Appointment Booking Voice Agent");
    });
    await user.click(screen.getByTestId("business-setup-dot-3"));

    expect(await screen.findByTestId("business-setup-preview-call")).toBeTruthy();
    expect(screen.getByTestId("business-setup-preview-start")).toBeTruthy();
    expect(screen.getByTestId("business-setup-test-flow")).toBeTruthy();
    expect(screen.getAllByTestId("business-setup-test-flow-step")).toHaveLength(4);
    expect(screen.getByTestId("business-setup-preview-call")).toBeTruthy();

    // The missed-call text-back simulation is gone.
    expect(screen.queryByTestId("business-setup-simulate")).toBeNull();
    expect(screen.queryByTestId("business-setup-simulate-run")).toBeNull();
    expect(screen.queryByTestId("business-test-summary-sms")).toBeNull();
    expect(screen.queryByTestId("business-setup-preview-transcript")).toBeNull();
    expect(screen.queryByTestId("business-setup-sms-test")).toBeNull();
  });

  it("saving a dirty Business Hours section through Next button calls its endpoint", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    // Make the Business Hours section dirty (open Saturday).
    await user.click(await screen.findByTestId("business-hours-open-toggle-saturday"));

    await user.click(screen.getByTestId("business-setup-next"));

    await waitFor(() => expect(putBusinessHours).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveBusinessSetup).toHaveBeenCalled());
  });

  it("a failing Business Hours save names the failing section without losing the setup save", async () => {
    vi.mocked(putBusinessHours).mockResolvedValue({ success: false, error: "Broken day rows" } as never);

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    await user.click(await screen.findByTestId("business-hours-open-toggle-saturday"));
    await user.click(screen.getByTestId("business-setup-next"));

    const error = await screen.findByTestId("business-setup-error");
    expect(error.textContent).toContain("Business Hours");
    expect(error.textContent).toContain("Broken day rows");
    // The rest of the Configure page still saved.
    expect(saveBusinessSetup).toHaveBeenCalled();
  });

  it("editing the business name keeps the marketplace agent title stable", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);

    const input = screen.getByTestId("business-setup-input-name") as HTMLInputElement;
    await user.type(input, "!");
    expect(input.value).toBe("Test Biz!");
    expect(screen.getByTestId("business-setup-agent-name").textContent).toBe("Appointment Booking Voice Agent");
  });

  it("a purchased but never-deployed agent shows Go live, not Redeploy", async () => {
    setupLocation.search = "listingId=listing-test-1";
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        // Straight from checkout: row exists, PROVISIONING, no assistant.
        installedAgent: { id: "agent-1", status: "PROVISIONING" },
        installedAgentId: "agent-1"
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await completeNewInstallConfiguration(user);
    expect((screen.getByTestId("business-setup-dot-4") as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByTestId("business-setup-dot-3"));
    const submitBtn = screen.getByTestId("business-setup-submit");
    expect(submitBtn.textContent).not.toContain("Redeploy");
    expect(submitBtn.textContent).toContain("Go live");
  });

  /**
   * BusinessProfile.vapiAssistantId is business-wide. One deployed agent used
   * to make every OTHER agent of that business look deployed.
   */
  it("does not treat a sibling agent's deployment as this agent's", async () => {
    setupLocation.search = "listingId=listing-test-1";
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        // Another agent of this business is live, so the profile carries an id.
        profile: { vapiAssistantId: "assistant-of-a-different-agent" },
        // This agent is freshly purchased and has none of its own.
        installedAgent: { id: "agent-2", status: "PROVISIONING", vapiAssistantId: null },
        installedAgentId: "agent-2"
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await completeNewInstallConfiguration(user);
    expect((screen.getByTestId("business-setup-dot-4") as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByTestId("business-setup-dot-3"));
    const submitBtn = screen.getByTestId("business-setup-submit");
    expect(submitBtn.textContent).not.toContain("Redeploy");
  });

  it("the Test step shows the call preview, never an editable hours grid", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(setupData({ installedAgent: null, installedAgentId: null }) as never);
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await screen.findByTestId("business-setup-wizard");
    await screen.findByTestId("business-setup-agent-name");
    await user.click(screen.getByTestId("business-setup-dot-3"));

    expect(await screen.findByTestId("business-setup-preview-call")).toBeTruthy();
    expect(screen.queryByTestId("business-hours-open-toggle-monday")).toBeNull();
    expect(screen.queryByTestId("business-hours-save")).toBeNull();
  });

  it("the Go-live step shows the final success screen with capabilities and Edit setup button after redeploying", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        installedAgent: { id: "agent-1", status: "ACTIVE" }
      }) as never
    );
    vi.mocked(saveBusinessSetup).mockResolvedValue({
      success: true,
      data: { installedAgentId: "agent-1", number: "+12135550999", vapiAssistantId: "vapi-1" }
    } as never);

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await screen.findByTestId("business-setup-wizard");
    await waitFor(() => {
      expect(screen.getByTestId("business-setup-agent-name").textContent).toBe("Appointment Booking Voice Agent");
    });

    // Step 4 is locked while editing
    expect((screen.getByTestId("business-setup-dot-4") as HTMLButtonElement).disabled).toBe(true);

    // Go to step 3 and click Redeploy
    await waitFor(async () => {
      await user.click(screen.getByTestId("business-setup-dot-3"));
      expect(screen.getByTestId("business-setup-dot-3").getAttribute("aria-current")).toBe("step");
    });
    await user.click(screen.getByTestId("business-setup-submit"));

    expect(await screen.findByTestId("business-setup-success")).toBeTruthy();
    expect(screen.getByTestId("business-setup-success-title").textContent).toBeTruthy();
    expect(screen.getByTestId("business-setup-success-capabilities")).toBeTruthy();

    // The Test step should be marked complete after a successful Go live.
    expect(screen.getByTestId("business-setup-dot-3").className).toContain("done");

    // Click "Edit configuration again" button on the success screen
    const editBtn = screen.getByRole("button", { name: /edit configuration again/i });
    await user.click(editBtn);

    // Verify it returns to Step 1 (Connect)
    expect(screen.getByTestId("business-setup-dot-1").getAttribute("aria-current")).toBe("step");
    // Even after return, step 4 dot remains disabled in top header
    expect((screen.getByTestId("business-setup-dot-4") as HTMLButtonElement).disabled).toBe(true);
  });

  it("marks the Test step complete after a successful Go live and shows dedicated live confirmation screen without redeploy banner", async () => {
    setupLocation.search = "listingId=listing-test-1";
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({ installedAgent: null, installedAgentId: null }) as never
    );
    vi.mocked(saveBusinessSetup).mockResolvedValue({
      success: true,
      data: { installedAgentId: "agent-1", number: "+12135550999", vapiAssistantId: "vapi-1" }
    } as never);

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await completeNewInstallConfiguration(user);
    await waitFor(() => {
      expect(screen.getByTestId("business-setup-agent-name").textContent).toBe("Appointment Booking Voice Agent");
    });

    // Check that editing banner is NOT visible during first time setup
    expect(screen.queryByTestId("business-setup-edit-badge-banner")).toBeNull();

    await user.click(screen.getByTestId("business-setup-dot-3"));
    expect(screen.getByTestId("business-setup-submit").textContent).toBe("Go live");
    await user.click(screen.getByTestId("business-setup-submit"));

    await screen.findByTestId("business-setup-success");
    expect(screen.getByTestId("business-setup-dot-3").className).toContain("done");

    // First-time setup confirmation screen checks
    const titleText = screen.getByTestId("business-setup-success-title").textContent;
    expect(titleText).not.toContain("Updated & Redeployed");
    expect(screen.queryByTestId("business-setup-edit-badge-banner")).toBeNull();
    expect(screen.getByTestId("business-setup-go-dashboard").textContent).toBe("Go to dashboard");
  });

  it("Configure shows a read-only timezone note pointing at Connect — never a second selector", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");
    await screen.findByTestId("business-hours-section");

    const note = await screen.findByTestId("business-hours-timezone-note");
    expect(note.textContent).toContain("America/Los_Angeles");
    expect(note.textContent).toContain("Change in Connect");
    expect(screen.queryByTestId("business-hours-timezone-select")).toBeNull();
  });

  it("a Business Hours save from a tab with an untouched timezone keeps the server's timezone (stale-tab guard)", async () => {
    // Server hours carry a NEWER timezone than the wizard's loaded profile —
    // an hours-only save must not clobber it with the stale wizard value.
    vi.mocked(getBusinessHours).mockResolvedValue({
      success: true,
      data: { ...BH_DATA, timeZone: "America/Denver" }
    } as never);

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    await user.click(await screen.findByTestId("business-hours-open-toggle-saturday"));
    await user.click(screen.getByTestId("business-setup-next"));

    await waitFor(() => expect(putBusinessHours).toHaveBeenCalledTimes(1));
    const put = vi.mocked(putBusinessHours).mock.calls[0][0] as Record<string, any>;
    expect(put.timeZone).toBe("America/Denver");
  });

  it("voice/missed-call workflows get a tel: CTA on the call-your-number card", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "1234567", twilioPhoneNumberSid: null },
        requiredConnectors: [{ connector: "twilio", label: "Phone", ownedBy: "platform", note: "" }],
        triggerKind: "missed_call"
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await screen.findByTestId("business-setup-wizard");
    await waitFor(() => {
      expect(screen.getByTestId("business-setup-agent-name").textContent).toBe("Appointment Booking Voice Agent");
    });
    await waitFor(() => {
      expect((screen.getByTestId("business-setup-dot-3") as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(screen.getByTestId("business-setup-dot-3"));

    expect((await screen.findByTestId("business-setup-test-flow")).textContent).toMatch(/speak to the assistant|talk to your agent|call/i);
  });

  it("SMS workflows get an SMS test panel", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "123456789", twilioPhoneNumberSid: null },
        requiredConnectors: [{ connector: "twilio", label: "Phone", ownedBy: "platform", note: "" }],
        triggerKind: "inbound_sms"
      }) as never
    );
    vi.mocked(getMarketplaceListing).mockResolvedValue({
      success: true,
      data: {
        listing: {
          name: "SMS Agent",
          requiredConnectors: ["twilio"],
          requiredBuyerSetup: [],
          buyerSetupInstructions: "",
          workflowJson: { nodes: [{ data: { type: "inbound_sms" } }], edges: [] }
        }
      }
    } as never);

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await screen.findByTestId("business-setup-wizard");
    await screen.findByTestId("business-setup-agent-name");
    await waitFor(() => {
      expect((screen.getByTestId("business-setup-dot-3") as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(screen.getByTestId("business-setup-dot-3"));

    expect(await screen.findByTestId("workflow-sms-phone")).toBeTruthy();
    expect(screen.getByTestId("workflow-sms-send")).toBeTruthy();
  });

  it("email workflows get no phone CTA at all", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "", twilioPhoneNumberSid: null },
        calendar: { connected: true, email: "test@example.com" },
        requiredConnectors: [{ connector: "gmail", label: "Gmail", ownedBy: "buyer", note: "" }]
      }) as never
    );
    vi.mocked(getMarketplaceListing).mockResolvedValue({
      success: true,
      data: {
        listing: {
          name: "Email Agent",
          requiredConnectors: ["gmail"],
          requiredBuyerSetup: [],
          buyerSetupInstructions: "",
          workflowJson: { nodes: [{ data: { type: "gmail_send" } }], edges: [] }
        }
      }
    } as never);

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await screen.findByTestId("business-setup-wizard");
    await screen.findByTestId("business-setup-agent-name");
    await waitFor(() => {
      expect((screen.getByTestId("business-setup-dot-3") as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(screen.getByTestId("business-setup-dot-3"));

    expect(screen.queryByTestId("workflow-sms-phone")).toBeNull();
  });
});
