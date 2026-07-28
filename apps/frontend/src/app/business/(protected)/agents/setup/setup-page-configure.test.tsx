import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Configure step redesign: ONE Business Hours editor, Appointment Hours that
 * inherit Business Hours by default (compact summary, no second grid), a
 * clearly separated AI Call Coverage section, and a page-level save that
 * saves every changed section and names the section when one fails.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("listingId=listing-test-1")
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
  getBusinessMailSetup: vi.fn().mockResolvedValue({ success: true, data: { alias: null } }),
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
  getMarketplaceListing: vi.fn().mockResolvedValue({ success: true, data: { listing: null } }),
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
      calendar: { connected: false, email: null },
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

async function openConfigure(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId("business-setup-wizard");
  await screen.findByTestId("business-setup-agent-name");
  await user.click(screen.getByTestId("business-setup-dot-2"));
  await screen.findByTestId("business-setup-configure");
}

async function expandSection(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByTestId(`business-configure-section-${id}-toggle`));
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
  vi.mocked(getBusinessSetup).mockReset().mockResolvedValue(setupData() as never);
  vi.mocked(getMarketplaceListing)
    .mockReset()
    .mockResolvedValue({ success: true, data: { listing: null } } as never);
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
    expect(within(coverage).getByTestId("business-setup-ai-coverage-always-note")).toBeTruthy();
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
      expect(screen.getByTestId("business-setup-agent-name").textContent).toBe("Test Biz");
    });
    await user.click(screen.getByTestId("business-setup-dot-3"));

    expect(await screen.findByTestId("business-setup-preview-call")).toBeTruthy();
    expect(screen.getByTestId("business-setup-preview-start")).toBeTruthy();
    expect(screen.getByTestId("business-setup-test-flow")).toBeTruthy();
    expect(screen.getAllByTestId("business-setup-test-flow-step")).toHaveLength(4);
    expect(screen.getByTestId("business-setup-call-number")).toBeTruthy();

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

  it("editing a Configure field shows unsaved-changes tag", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);

    expect(screen.queryByTestId("business-setup-unsaved")).toBeNull();
    await user.type(screen.getByTestId("business-setup-input-name"), "!");
    expect(await screen.findByTestId("business-setup-unsaved")).toBeTruthy();
  });

  it("a purchased but never-deployed agent shows Go live, not Redeploy", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        // Straight from checkout: row exists, PROVISIONING, no assistant.
        installedAgent: { id: "agent-1", status: "PROVISIONING" },
        installedAgentId: "agent-1"
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await screen.findByTestId("business-setup-wizard");
    await user.click(screen.getByTestId("business-setup-dot-4"));

    const wizard = await screen.findByTestId("business-setup-wizard");
    expect(wizard.textContent).not.toContain("Redeploy");
    expect(wizard.textContent).toContain("Go live");
  });

  /**
   * BusinessProfile.vapiAssistantId is business-wide. One deployed agent used
   * to make every OTHER agent of that business look deployed.
   */
  it("does not treat a sibling agent's deployment as this agent's", async () => {
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
    await screen.findByTestId("business-setup-wizard");
    await user.click(screen.getByTestId("business-setup-dot-4"));

    const wizard = await screen.findByTestId("business-setup-wizard");
    expect(wizard.textContent).not.toContain("Redeploy");
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

  it("the Go-live step shows the final success screen with capabilities and Edit setup button", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        installedAgent: { id: "agent-1", status: "ACTIVE" }
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await screen.findByTestId("business-setup-wizard");
    await waitFor(() => {
      expect(screen.getByTestId("business-setup-agent-name").textContent).toBe("Test Biz");
    });
    await user.click(screen.getByTestId("business-setup-dot-4"));

    expect(await screen.findByTestId("business-setup-success")).toBeTruthy();
    expect(screen.getByTestId("business-setup-success-title").textContent).toBeTruthy();
    expect(screen.getByTestId("business-setup-success-capabilities")).toBeTruthy();

    // Click "Edit setup" button on the success screen
    const editBtn = screen.getByRole("button", { name: /edit setup/i });
    await user.click(editBtn);

    // Verify it returns to the Test step (step 3)
    expect(await screen.findByTestId("business-setup-preview-call")).toBeTruthy();
  });

  it("Configure shows a read-only timezone note pointing at Connect — never a second selector", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");
    await screen.findByTestId("business-hours-section");

    const note = screen.getByTestId("business-hours-timezone-note");
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
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "1234567", twilioPhoneNumberSid: null }
      }) as never
    );

    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await screen.findByTestId("business-setup-wizard");
    await waitFor(() => {
      expect(screen.getByTestId("business-setup-agent-name").textContent).toBe("Test Biz");
    });
    await user.click(screen.getByTestId("business-setup-dot-3"));

    const dial = await screen.findByTestId("business-setup-call-number-dial");
    expect(dial.getAttribute("href")).toBe("tel:+12135550999");
    expect(dial.textContent).toContain("Call now");

    // The browser test-call card discloses the calendar side effect.
    expect(screen.getByTestId("business-setup-test-flow").textContent).toMatch(/speak to the assistant/i);
  });

  it("SMS workflows get an SMS test panel", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "", twilioPhoneNumberSid: null },
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
    await user.click(screen.getByTestId("business-setup-dot-3"));

    expect(screen.getByTestId("workflow-sms-phone")).toBeTruthy();
    expect(screen.getByTestId("workflow-sms-send")).toBeTruthy();
    expect(screen.queryByTestId("business-setup-call-number-dial")).toBeNull();
  });

  it("email workflows get no phone CTA at all", async () => {
    vi.mocked(getBusinessSetup).mockResolvedValue(
      setupData({
        phoneNumber: { phoneNumber: "+12135550999", forwardToPhone: "", twilioPhoneNumberSid: null },
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
    await user.click(screen.getByTestId("business-setup-dot-3"));

    expect(screen.queryByTestId("business-setup-call-number-dial")).toBeNull();
    expect(screen.queryByTestId("business-setup-call-number")).toBeNull();
  });
});
