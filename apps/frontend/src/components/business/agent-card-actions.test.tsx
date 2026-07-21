import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BusinessMyAgentsPage from "@/app/business/(protected)/agents/page";
import BusinessDashboardPage from "@/app/business/(protected)/dashboard/page";

const { apiGetMock, pauseMock, resumeMock, pushMock, replaceMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  pauseMock: vi.fn(),
  resumeMock: vi.fn(),
  pushMock: vi.fn(),
  replaceMock: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock })
}));

vi.mock("@/lib/api", () => ({ apiGet: apiGetMock }));

vi.mock("@/lib/auth", () => ({
  getAuthToken: () => "test-token",
  getAuthUser: () => ({ id: "buyer-1", role: "BUSINESS" }),
  hasAuthRole: () => true
}));

vi.mock("@/components/business/features/api", () => ({
  pauseInstalledAgent: pauseMock,
  resumeInstalledAgent: resumeMock
}));

function purchasedAgent(overrides: Record<string, unknown> = {}) {
  return {
    purchaseId: "purchase-1",
    purchasedAt: new Date().toISOString(),
    purchaseStatus: "SUCCEEDED",
    installedAgentId: "installed-1",
    installedAgentStatus: "ACTIVE",
    isTrial: false,
    stats: { runsThisMonth: 0, costThisMonthMicroUsd: 0 },
    totalExecutions: 0,
    totalBookings: 0,
    listing: {
      id: "listing-1",
      name: "Reception Agent",
      shortDescription: "Handles calls",
      priceCents: 1000,
      tags: [],
      category: "Voice",
      industryTags: [],
      pricingModel: "SUBSCRIPTION",
      freeTrialEnabled: true,
      trialDays: 7
    },
    ...overrides
  };
}

function mockApiAgents(agents: unknown[]) {
  apiGetMock.mockImplementation(async (path: string) => {
    if (path === "/payments/my-agents") return { success: true, data: { agents } };
    if (path === "/architect/listings/public") return { success: true, data: { listings: [] } };
    if (path === "/business/dashboard") {
      return {
        success: true,
        data: {
          installedAgent: null,
          phoneNumber: null,
          subscription: { status: "active", active: true },
          counts: { leads: 0, conversations: 0, appointments: 0 },
          recentMissedCalls: [],
          calendarConnected: false,
          activities: []
        }
      };
    }
    return { success: false, error: "Unexpected API path" };
  });
}

beforeEach(() => {
  cleanup();
  apiGetMock.mockReset();
  pauseMock.mockReset().mockResolvedValue({ success: true, data: { installedAgentId: "installed-1", status: "PAUSED" } });
  resumeMock.mockReset().mockResolvedValue({ success: true, data: { installedAgentId: "installed-1", status: "ACTIVE" } });
  pushMock.mockReset();
  replaceMock.mockReset();
  localStorage.setItem("coreai-user", JSON.stringify({ id: "buyer-1", fullName: "Test Buyer", role: "BUSINESS" }));
});

describe("business agent action menus", () => {
  it("shows only View details before setup on My Agents", async () => {
    mockApiAgents([purchasedAgent({ installedAgentId: null, installedAgentStatus: null })]);
    render(<BusinessMyAgentsPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("business-my-agent-menu-listing-1"));

    expect(screen.queryByText("Edit Configuration")).toBeNull();
    expect(screen.queryByText("Pause Agent")).toBeNull();
    expect(screen.getByText("View details")).toBeTruthy();
  });

  it("hides Edit Configuration and Pause Agent after a trial ends on both pages", async () => {
    const expiredTrial = purchasedAgent({
      purchasedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      purchaseStatus: "TRIALING",
      isTrial: true
    });
    mockApiAgents([expiredTrial]);

    const user = userEvent.setup();
    const myAgents = render(<BusinessMyAgentsPage />);
    await user.click(await screen.findByTestId("business-my-agent-menu-listing-1"));
    expect(screen.queryByText("Edit Configuration")).toBeNull();
    expect(screen.queryByText("Pause Agent")).toBeNull();
    expect(screen.getByText("View details")).toBeTruthy();

    myAgents.unmount();
    render(<BusinessDashboardPage />);
    await user.click(await screen.findByTestId("dashboard-agent-menu-purchase-1"));
    expect(screen.queryByText("Edit Configuration")).toBeNull();
    expect(screen.queryByText("Pause Agent")).toBeNull();
    expect(screen.getByText("View details")).toBeTruthy();
  });

  it("confirms a pause before calling the backend from My Agents", async () => {
    mockApiAgents([purchasedAgent()]);
    render(<BusinessMyAgentsPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("business-my-agent-menu-listing-1"));
    await user.click(screen.getByText("Pause Agent"));

    expect(pauseMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("All activity for this agent will pause");
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByTestId("business-my-agent-card-listing-1").contains(dialog)).toBe(false);
    await user.click(screen.getByTestId("agent-pause-confirmation-confirm"));

    await waitFor(() => expect(pauseMock).toHaveBeenCalledWith("installed-1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("uses the same confirmation flow on the dashboard and resumes without a pause warning", async () => {
    mockApiAgents([purchasedAgent()]);
    render(<BusinessDashboardPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("dashboard-agent-menu-purchase-1"));
    await user.click(screen.getByText("Pause Agent"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(screen.getByTestId("agent-pause-confirmation-confirm"));
    await waitFor(() => expect(pauseMock).toHaveBeenCalledWith("installed-1"));

    await user.click(screen.getByTestId("dashboard-agent-menu-purchase-1"));
    await user.click(screen.getByText("Resume Agent"));
    await waitFor(() => expect(resumeMock).toHaveBeenCalledWith("installed-1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
