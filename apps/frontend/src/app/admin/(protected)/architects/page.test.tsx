import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminArchitectsPage from "./page";

const {
  getAdminArchitectsMock,
  getAdminSummaryMock,
  updateAdminArchitectStatusMock,
  updateAdminUserSuspensionMock
} = vi.hoisted(() => ({
  getAdminArchitectsMock: vi.fn(),
  getAdminSummaryMock: vi.fn(),
  updateAdminArchitectStatusMock: vi.fn(),
  updateAdminUserSuspensionMock: vi.fn()
}));

vi.mock("@/components/admin/features/api", () => ({
  getAdminArchitects: getAdminArchitectsMock,
  getAdminSummary: getAdminSummaryMock,
  updateAdminArchitectStatus: updateAdminArchitectStatusMock,
  updateAdminUserSuspension: updateAdminUserSuspensionMock
}));

function architect(overrides: Record<string, unknown> = {}) {
  return {
    id: "architect-1",
    email: "ada@example.com",
    fullName: "Ada Builder",
    createdAt: "2026-07-01T00:00:00.000Z",
    isSuspended: false,
    architectProfile: {
      title: "Voice automation architect",
      approvalStatus: "PENDING",
      rating: 4.8,
      completedJobs: 12
    },
    listingCount: 3,
    workflowCount: 5,
    ...overrides
  };
}

function page(items: ReturnType<typeof architect>[], total = items.length, pageNumber = 1) {
  return {
    success: true,
    data: { items, total, page: pageNumber, limit: 100 }
  };
}

beforeEach(() => {
  cleanup();
  getAdminArchitectsMock.mockReset().mockResolvedValue(page([architect()]));
  getAdminSummaryMock.mockReset().mockResolvedValue({
    success: true,
    data: { pendingAgentListings: 2 }
  });
  updateAdminArchitectStatusMock.mockReset().mockResolvedValue({
    success: true,
    data: { architectProfile: { approvalStatus: "APPROVED" } }
  });
  updateAdminUserSuspensionMock.mockReset().mockResolvedValue({
    success: true,
    data: { user: { isSuspended: true } }
  });
});

describe("Admin architect management", () => {
  it("renders the full management table and fetches every API page", async () => {
    getAdminArchitectsMock
      .mockResolvedValueOnce(page([architect()], 101))
      .mockResolvedValueOnce(page([
        architect({
          id: "architect-101",
          email: "missing@example.com",
          fullName: null,
          architectProfile: null,
          listingCount: null,
          workflowCount: null,
          createdAt: "invalid"
        })
      ], 101, 2));

    render(<AdminArchitectsPage />);

    expect(await screen.findByText("Ada Builder")).toBeTruthy();
    expect(screen.getByText("missing@example.com")).toBeTruthy();
    expect(screen.getByText("101 total")).toBeTruthy();
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
    expect(getAdminArchitectsMock).toHaveBeenNthCalledWith(1, { search: "", limit: 100 });
    expect(getAdminArchitectsMock).toHaveBeenNthCalledWith(2, { search: "", page: 2, limit: 100 });
    expect(screen.getByTestId("admin-architects-export")).toBeTruthy();
    expect(screen.getByText("Showing 1–2 of 2")).toBeTruthy();
  });

  it("debounces search and filters the loaded architects by status", async () => {
    getAdminArchitectsMock.mockResolvedValueOnce(page([
      architect(),
      architect({
        id: "architect-2",
        email: "approved@example.com",
        fullName: "Approved Builder",
        architectProfile: {
          title: null,
          approvalStatus: "APPROVED",
          rating: 0,
          completedJobs: 0
        }
      })
    ]));
    render(<AdminArchitectsPage />);
    await screen.findByText("Approved Builder");

    const filterGroup = screen.getByRole("group", { name: "Filter architects by status" });
    await userEvent.setup().click(within(filterGroup).getByRole("button", { name: "Pending" }));
    expect(screen.getByText("Ada Builder")).toBeTruthy();
    expect(screen.queryByText("Approved Builder")).toBeNull();

    await userEvent.setup().type(screen.getByTestId("admin-architects-search"), "ada");
    await waitFor(() => {
      expect(getAdminArchitectsMock).toHaveBeenCalledWith({ search: "ada", limit: 100 });
    });
  });

  it("updates an architect approval status through the live action", async () => {
    render(<AdminArchitectsPage />);
    await screen.findByText("Ada Builder");
    getAdminArchitectsMock.mockResolvedValue(page([
      architect({
        architectProfile: {
          title: "Voice automation architect",
          approvalStatus: "APPROVED",
          rating: 4.8,
          completedJobs: 12
        }
      })
    ]));

    await userEvent.setup().selectOptions(
      screen.getByRole("combobox", { name: "Update status for ada@example.com" }),
      "APPROVED"
    );

    await waitFor(() => {
      expect(updateAdminArchitectStatusMock).toHaveBeenCalledWith("architect-1", "APPROVED");
    });
    expect(await screen.findByText("ada@example.com status changed to Approved.")).toBeTruthy();
    const row = screen.getByRole("row", { name: /Ada Builder/ });
    expect(within(row).getAllByText("Approved").length).toBeGreaterThan(0);
  });

  it("shows architect details and suspends the account from the profile", async () => {
    render(<AdminArchitectsPage />);
    await screen.findByText("Ada Builder");

    await userEvent.setup().click(screen.getByRole("button", { name: "View" }));
    const dialog = screen.getByRole("dialog", { name: "Architect Profile" });
    expect(within(dialog).getByText("Voice automation architect")).toBeTruthy();
    expect(within(dialog).getByText("4.8")).toBeTruthy();
    expect(within(dialog).getByText("12")).toBeTruthy();

    getAdminArchitectsMock.mockResolvedValue(page([architect({ isSuspended: true })]));
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Suspend account" }));

    await waitFor(() => {
      expect(updateAdminUserSuspensionMock).toHaveBeenCalledWith("architect-1", true);
    });
    expect(await screen.findByText("ada@example.com suspended.")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Architect Profile" })).toBeNull();
  });

  it("shows the architect-specific error state", async () => {
    getAdminArchitectsMock.mockResolvedValueOnce({ success: false, error: "Unavailable" });
    render(<AdminArchitectsPage />);

    expect(await screen.findByTestId("admin-architects-error")).toBeTruthy();
    expect(screen.getByText("Could not load architects.")).toBeTruthy();
  });
});
