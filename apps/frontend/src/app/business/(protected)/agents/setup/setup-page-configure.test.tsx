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
  getBusinessHours,
  getBusinessSetup,
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
      phoneNumber: null,
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
      ...overrides
    }
  };
}

async function openConfigure(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId("business-setup-wizard");
  await user.click(screen.getByTestId("business-setup-dot-2"));
  await screen.findByTestId("business-setup-configure");
}

async function expandSection(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByTestId(`business-configure-section-${id}-toggle`));
}

beforeEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.mocked(getBusinessSetup).mockReset().mockResolvedValue(setupData() as never);
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

    const summary = await screen.findByTestId("business-setup-ai-coverage-bh-summary");
    expect(summary.textContent).toContain("Monday: 9 AM–5 PM");
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

  it("appointment hours inherit Business Hours by default with a compact summary only", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    const inheritRadio = await screen.findByTestId("business-setup-appt-use-business-hours");
    await waitFor(() => expect(inheritRadio.getAttribute("aria-checked")).toBe("true"));

    const summary = screen.getByTestId("business-setup-appt-inherited-summary");
    expect(summary.textContent).toContain("Monday: 9 AM–5 PM");
    expect(screen.queryByTestId("business-setup-appt-editor")).toBeNull();
    expect(screen.getByTestId("business-setup-appt-source").textContent).toBe("Using Business Hours");
  });

  it("choosing custom appointment hours reveals exactly one appointment editor", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    await user.click(await screen.findByTestId("business-setup-appt-use-custom"));

    expect(await screen.findAllByTestId("business-setup-appt-editor")).toHaveLength(1);
    expect(screen.getByTestId("business-setup-appt-source").textContent).toBe("Custom Appointment Hours");
  });

  it("saving custom appointment hours never touches Business Hours", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    await user.click(await screen.findByTestId("business-setup-appt-use-custom"));
    await user.click(screen.getByTestId("business-setup-save"));

    await waitFor(() => expect(saveBusinessSetup).toHaveBeenCalled());
    const payload = vi.mocked(saveBusinessSetup).mock.calls[0][0] as Record<string, any>;
    expect(payload.appointmentSchedule.useBusinessHours).toBe(false);
    // Business Hours were untouched → their endpoint is never called, and the
    // setup payload sends no hours rows at all.
    expect(putBusinessHours).not.toHaveBeenCalled();
    expect(payload.hours).toEqual([]);
  });

  it("the setup save carries coverage + preserved answering mode, and no timezone once a profile exists", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await user.click(screen.getByTestId("business-setup-save"));

    await waitFor(() => expect(saveBusinessSetup).toHaveBeenCalled());
    const payload = vi.mocked(saveBusinessSetup).mock.calls[0][0] as Record<string, any>;
    expect(payload.aiCallCoverage).toEqual({ kind: "always" });
    expect(payload.answeringMode).toBe("NO_ANSWER");
    // The Business Hours editor owns the timezone — setup saves never send it.
    expect(payload.timeZone).toBeUndefined();
  });

  it("Save draft saves a dirty Business Hours section through its own endpoint", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);
    await expandSection(user, "hours-availability");

    // Make the Business Hours section dirty (open Saturday).
    await user.click(await screen.findByTestId("business-hours-open-toggle-saturday"));
    expect(await screen.findByTestId("business-setup-unsaved")).toBeTruthy();

    await user.click(screen.getByTestId("business-setup-save"));

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
    await user.click(screen.getByTestId("business-setup-save"));

    const error = await screen.findByTestId("business-setup-error");
    expect(error.textContent).toContain("Business Hours");
    expect(error.textContent).toContain("Broken day rows");
    // The rest of the Configure page still saved.
    expect(saveBusinessSetup).toHaveBeenCalled();
  });

  it("editing a Configure field shows the unsaved-changes indicator until saved", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await openConfigure(user);

    expect(screen.queryByTestId("business-setup-unsaved")).toBeNull();
    await user.type(screen.getByTestId("business-setup-input-name"), "!");
    expect(await screen.findByTestId("business-setup-unsaved")).toBeTruthy();

    await user.click(screen.getByTestId("business-setup-save"));
    await waitFor(() => expect(screen.queryByTestId("business-setup-unsaved")).toBeNull());
  });

  it("the Test step shows read-only schedule summaries, never an editable hours grid", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await screen.findByTestId("business-setup-wizard");
    await user.click(screen.getByTestId("business-setup-dot-3"));

    expect(await screen.findByTestId("business-test-details-appt-source")).toBeTruthy();
    expect(screen.getByTestId("business-test-details-appt-source").textContent).toContain("Follow Business Hours");
    expect(screen.getByTestId("business-test-details-ai-coverage").textContent).toContain("24/7");
    expect(screen.queryByTestId("business-hours-open-toggle-monday")).toBeNull();
    expect(screen.queryByTestId("business-hours-save")).toBeNull();
  });

  it("the Go-live step shows the same read-only review with an Edit link back to Configure", async () => {
    render(<BusinessAgentSetupPage />);
    const user = userEvent.setup();
    await screen.findByTestId("business-setup-wizard");
    await user.click(screen.getByTestId("business-setup-dot-4"));

    const review = await screen.findByTestId("business-setup-golive-review");
    expect(within(review).getByTestId("business-setup-golive-appt-source").textContent).toContain(
      "Follow Business Hours"
    );
    expect(within(review).getByTestId("business-setup-golive-ai-coverage").textContent).toContain("24/7");
    expect(within(review).queryByTestId("business-hours-open-toggle-monday")).toBeNull();

    // Edit returns to the Configure step with the hours section open.
    await user.click(within(review).getByTestId("business-setup-golive-edit"));
    await screen.findByTestId("business-setup-configure");
    expect(screen.getByTestId("business-hours-section")).toBeTruthy();
  });
});
