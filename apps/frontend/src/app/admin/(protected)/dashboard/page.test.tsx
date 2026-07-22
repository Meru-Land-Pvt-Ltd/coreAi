import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminDashboardPage from "./page";

const { getAdminSummaryMock } = vi.hoisted(() => ({
  getAdminSummaryMock: vi.fn()
}));

vi.mock("@/components/admin/features/api", () => ({
  getAdminSummary: getAdminSummaryMock
}));

beforeEach(() => {
  cleanup();
  getAdminSummaryMock.mockReset().mockResolvedValue({
    success: true,
    data: {
      totalUsers: 4,
      newUsersThisWeek: 1,
      totalBusinesses: 2,
      totalArchitects: 2,
      totalAgentListings: 3,
      pendingAgentListings: 0,
      approvedAgentListings: 3,
      rejectedAgentListings: 0,
      suspendedAgentListings: 0,
      activeInstalledAgents: 2,
      totalAppointments: 1,
      totalLeads: 2,
      platformRevenueCents: null,
      platformRevenueCurrency: null,
      performanceRevenueCurrency: null,
      revenueChangePercent: null,
      totalExecutions: 10,
      avgExecutionsPerDay30d: 5,
      performance: [
        { date: "2026-07-20", revenueCents: null, executions: 3, newUsers: 0 },
        { date: "2026-07-21", revenueCents: null, executions: 7, newUsers: 1 }
      ],
      recentActivity: [],
      platformHealth: {
        apiUptimePercent: null,
        avgResponseTimeMs: null,
        errorRatePercent: null
      }
    }
  });
});

describe("Admin dashboard performance chart", () => {
  it("shows executions by default and reveals a point value on hover", async () => {
    render(<AdminDashboardPage />);
    const user = userEvent.setup();

    const executionsButton = await screen.findByRole("button", { name: "Executions" });
    expect(executionsButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Executions performance for the last 30 days" })).toBeTruthy();

    await user.hover(screen.getByTestId("admin-performance-point-2026-07-21"));

    const tooltip = await screen.findByTestId("admin-performance-tooltip");
    expect(tooltip.textContent).toContain("Jul 21");
    expect(tooltip.textContent).toContain("Executions: 7");

    await user.unhover(screen.getByTestId("admin-performance-point-2026-07-21"));
    await waitFor(() => expect(screen.queryByTestId("admin-performance-tooltip")).toBeNull());
  });
});
