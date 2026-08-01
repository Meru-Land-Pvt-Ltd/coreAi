import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BusinessAgentSetupPage from "./page";
import { isDeploymentReadyForWorkflowRequirements } from "./deployment-readiness";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("listingId=test-listing-id")
}));

const mockGetMarketplaceListing = vi.fn();
const mockGetBusinessSetup = vi.fn();

vi.mock("@/components/business/features/api", () => ({
  checkMailAliasAvailability: vi.fn().mockResolvedValue({ success: true, data: { available: true } }),
  deleteBusinessKnowledgeFile: vi.fn().mockResolvedValue({ success: true }),
  deleteBusinessTestEvent: vi.fn().mockResolvedValue({ success: true }),
  disconnectBusinessCalendar: vi.fn().mockResolvedValue({ success: true }),
  getAppointmentSchedule: vi.fn().mockResolvedValue({
    success: true,
    data: { schedule: { timeZone: "America/Los_Angeles", days: {} }, confirmed: true }
  }),
  getBusinessCalendarOAuthUrl: vi.fn().mockResolvedValue({ success: true, data: { url: "" } }),
  getBusinessFacts: vi.fn().mockResolvedValue({
    success: true,
    data: { businessName: "Test Biz", address: { line1: "123 Main St", city: "NY", state: "NY", postalCode: "10001" }, addressComplete: true }
  }),
  saveBusinessAddressApi: vi.fn().mockResolvedValue({ success: true }),
  getBusinessHours: vi.fn().mockResolvedValue({
    success: true,
    data: { hours: [], timeZone: "America/Los_Angeles", configured: true, weeklySummary: [] }
  }),
  getBusinessKnowledgeFiles: vi.fn().mockResolvedValue({ success: true, data: { files: [] } }),
  getBusinessMailSetup: vi.fn().mockResolvedValue({ success: true, data: { mailAlias: null } }),
  getBusinessPhoneAssignment: vi.fn().mockResolvedValue({ success: true, data: { assigned: false } }),
  getBusinessSetup: (...args: any[]) => mockGetBusinessSetup(...args),
  getMarketplaceListing: (...args: any[]) => mockGetMarketplaceListing(...args),
  getLatestBusinessTestEvent: vi.fn().mockResolvedValue({ success: true, data: { event: null } }),
  getPhoneCountries: vi.fn().mockResolvedValue({
    success: true,
    data: { countries: [{ code: "US", name: "United States", flag: "🇺🇸", countryCode: "+1", hasStates: true }] }
  }),
  getPhoneStates: vi.fn().mockResolvedValue({
    success: true,
    data: { states: [{ code: "CA", name: "California" }] }
  }),
  getPhoneCities: vi.fn().mockResolvedValue({
    success: true,
    data: { cities: [{ name: "Los Angeles" }] }
  }),
  searchBusinessPhoneNumbers: vi.fn().mockResolvedValue({ success: true, data: { numbers: [] } }),
  searchPlatformPhoneNumbers: vi.fn().mockResolvedValue({ success: true, data: [] }),
  putBusinessHours: vi.fn().mockResolvedValue({ success: true }),
  runBusinessSetupChatTest: vi.fn().mockResolvedValue({ success: true, data: { text: "OK", toolCalls: [], outcome: "completed" } }),
  saveBusinessMailSetup: vi.fn().mockResolvedValue({ success: true }),
  saveBusinessSetup: vi.fn().mockResolvedValue({ success: true, data: { assignedPhoneNumber: "+15551234567" } }),
  sendMailSetupTestEmail: vi.fn().mockResolvedValue({ success: true }),
  sendBusinessTestSms: vi.fn().mockResolvedValue({ success: true }),
  startBusinessSetupPreviewCall: vi.fn().mockResolvedValue({ success: true, data: { callId: "c1" } }),
  testCallRouting: vi.fn().mockResolvedValue({ success: true, data: { outcome: "pass" } })
}));

describe("Dynamic Buyer Setup — node->field rule engine UI integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows deployment without a saved phone number when the workflow does not require one", () => {
    const plan = { requirePhoneSelection: false } as const;

    expect(isDeploymentReadyForWorkflowRequirements(plan, { installedAgentId: "agent-1" }, null)).toBe(true);
    expect(isDeploymentReadyForWorkflowRequirements(plan, { installedAgentId: "agent-1" }, "+15551234567")).toBe(true);
    expect(isDeploymentReadyForWorkflowRequirements(plan, { installedAgentId: "agent-1" }, "")).toBe(true);
  });

  it("Resume Analyzer graph (manual trigger + memory) hides phone and business profile", async () => {
    const listing = {
      id: "test-listing-id",
      name: "Resume Analyzer",
      requiredConnectors: [],
      workflowJson: {
        nodes: [
          { data: { type: "trigger.manual" } },
          { data: { type: "ai.memory" } }
        ]
      }
    };

    mockGetBusinessSetup.mockResolvedValue({
      success: true,
      data: {
        listing,
        business: { id: "b1", name: "My Business", type: "general" },
        phone: null,
        setup: {}
      }
    });

    mockGetMarketplaceListing.mockResolvedValue({
      success: true,
      data: { listing }
    });

    render(<BusinessAgentSetupPage />);

    await waitFor(() => {
      expect(screen.queryByTestId("business-setup-loading")).toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByTestId("business-setup-test-flow")).toBeTruthy();
    });

    expect(screen.queryByTestId("no-connect-needed")).toBeNull();
    expect(screen.queryByTestId("no-configure-needed")).toBeNull();
    expect(screen.queryByTestId("business-setup-number-card")).toBeNull();
    expect(screen.queryByTestId("business-profile")).toBeNull();
    expect(screen.queryByTestId("hours-availability")).toBeNull();
  });

  it("Dental Receptionist graph (missed_call + context_reply) renders phone and profile sections", async () => {
    const listing = {
      id: "test-listing-id",
      name: "Dental Receptionist",
      requiredConnectors: ["phone"],
      workflowJson: {
        nodes: [
          { data: { type: "trigger.twilio_missed_call" } },
          { data: { type: "ai.context_reply" } }
        ]
      }
    };

    mockGetBusinessSetup.mockResolvedValue({
      success: true,
      data: {
        listing,
        business: { id: "b1", name: "My Business", type: "general" },
        phone: null,
        setup: {}
      }
    });

    mockGetMarketplaceListing.mockResolvedValue({
      success: true,
      data: { listing }
    });

    render(<BusinessAgentSetupPage />);

    await waitFor(() => {
      expect(screen.queryByTestId("business-setup-loading")).toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByTestId("business-setup-number-card")).toBeTruthy();
      expect(screen.queryByTestId("no-connect-needed")).toBeNull();
    });
  });
});
