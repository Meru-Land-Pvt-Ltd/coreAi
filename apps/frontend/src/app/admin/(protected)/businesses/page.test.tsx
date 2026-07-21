import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminBusinessesPage from "./page";

const { getAdminBusinessAccountsMock, getAdminSummaryMock, updateAdminUserSuspensionMock } = vi.hoisted(() => ({
  getAdminBusinessAccountsMock: vi.fn(),
  getAdminSummaryMock: vi.fn(),
  updateAdminUserSuspensionMock: vi.fn()
}));

vi.mock("@/components/admin/features/api", () => ({
  getAdminBusinessAccounts: getAdminBusinessAccountsMock,
  getAdminSummary: getAdminSummaryMock,
  updateAdminUserSuspension: updateAdminUserSuspensionMock
}));

beforeEach(() => {
  cleanup();
  getAdminSummaryMock.mockReset().mockResolvedValue({
    success: true,
    data: { pendingAgentListings: 0 }
  });
  updateAdminUserSuspensionMock.mockReset().mockResolvedValue({ success: true, data: { user: {} } });
  getAdminBusinessAccountsMock.mockReset().mockResolvedValue({
    success: true,
    data: {
      items: [
        {
          id: "business-user-1",
          email: "buyer@example.com",
          fullName: "Buyer One",
          createdAt: "2026-07-01T00:00:00.000Z",
          isSuspended: false,
          purchasedAgents: []
        }
      ],
      total: 1,
      page: 1,
      limit: 100
    }
  });
});

describe("Admin businesses account list", () => {
  it("loads registered accounts instead of business setup rows", async () => {
    render(<AdminBusinessesPage />);

    expect(await screen.findByText("buyer@example.com")).toBeTruthy();
    expect(screen.getByText("Buyer One")).toBeTruthy();
    expect(getAdminBusinessAccountsMock).toHaveBeenCalledWith({ search: "", limit: 100, all: true });
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("opens a non-expanding purchased agents dropdown for the registered account", async () => {
    getAdminBusinessAccountsMock.mockResolvedValueOnce({
      success: true,
      data: {
        items: [
          {
            id: "business-user-1",
            email: "buyer@example.com",
            fullName: "Buyer One",
            createdAt: "2026-07-01T00:00:00.000Z",
            isSuspended: false,
            purchasedAgents: [
              {
                purchaseId: "payment-1",
                purchasedAt: "2026-07-20T00:00:00.000Z",
                purchaseStatus: "SUCCEEDED",
                amountCents: 14900,
                currency: "usd",
                installedAgentId: "installed-1",
                installedAgentStatus: "ACTIVE",
                listing: {
                  id: "listing-1",
                  name: "Reception Agent",
                  shortDescription: "Answers every incoming call",
                  category: "Voice",
                  pricingModel: "SUBSCRIPTION",
                  priceCents: 14900,
                  architect: { email: "builder@example.com", fullName: "Agent Builder" }
                }
              }
            ]
          }
        ],
        total: 1,
        page: 1,
        limit: 100
      }
    });
    render(<AdminBusinessesPage />);

    const dropdown = await screen.findByTestId("admin-business-agents-business-user-1");
    expect(dropdown.getAttribute("aria-expanded")).toBe("false");

    await userEvent.setup().click(screen.getByText("1 agent"));

    expect(dropdown.getAttribute("aria-expanded")).toBe("true");
    const agentDetails = screen.getByTestId("admin-business-purchased-agent");
    expect(within(agentDetails).getByText("Reception Agent")).toBeTruthy();
    expect(within(agentDetails).getByText("Answers every incoming call")).toBeTruthy();
    expect(within(agentDetails).getAllByText("Purchased").length).toBeGreaterThan(0);
    expect(within(agentDetails).getByText("Active")).toBeTruthy();
    expect(within(agentDetails).getByText("$149.00")).toBeTruthy();
    expect(within(agentDetails).getByText("Agent Builder", { exact: false })).toBeTruthy();
  });

  it("shows an account-specific error", async () => {
    getAdminBusinessAccountsMock.mockResolvedValueOnce({ success: false, error: "Unavailable" });
    render(<AdminBusinessesPage />);

    await waitFor(() => expect(screen.getByTestId("admin-businesses-error")).toBeTruthy());
    expect(screen.getByText("Could not load registered business accounts.")).toBeTruthy();
  });

  it("suspends a registered business through the live account action", async () => {
    render(<AdminBusinessesPage />);

    const suspendButton = await screen.findByText("Suspend");
    getAdminBusinessAccountsMock.mockResolvedValueOnce({
      success: true,
      data: {
        items: [
          {
            id: "business-user-1",
            email: "buyer@example.com",
            fullName: "Buyer One",
            createdAt: "2026-07-01T00:00:00.000Z",
            isSuspended: true,
            accountStatus: "Suspended",
            purchasedAgents: []
          }
        ],
        total: 1,
        page: 1,
        limit: 100
      }
    });
    await userEvent.setup().click(suspendButton);

    await waitFor(() => expect(updateAdminUserSuspensionMock).toHaveBeenCalledWith("business-user-1", true));
    expect(screen.getByText("Unsuspend")).toBeTruthy();
    expect(screen.getByTestId("admin-businesses-action-message").textContent).toContain("buyer@example.com suspended");
  });
});
