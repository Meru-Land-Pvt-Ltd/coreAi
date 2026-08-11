import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminArchitectsPage from "./page";

const {
  getAdminArchitectsMock,
  getAdminSummaryMock,
  deleteAdminArchitectMock
} = vi.hoisted(() => ({
  getAdminArchitectsMock: vi.fn(),
  getAdminSummaryMock: vi.fn(),
  deleteAdminArchitectMock: vi.fn()
}));

vi.mock("@/components/admin/features/api", () => ({
  getAdminArchitects: getAdminArchitectsMock,
  getAdminSummary: getAdminSummaryMock,
  deleteAdminArchitect: deleteAdminArchitectMock
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
  deleteAdminArchitectMock.mockReset().mockResolvedValue({
    success: true,
    data: { deleted: true, userId: "architect-1", accountRemoved: true, remainingRoles: [] }
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

  it("debounces search and refreshes the complete architect result set", async () => {
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

    await userEvent.setup().type(screen.getByTestId("admin-architects-search"), "ada");
    await waitFor(() => {
      expect(getAdminArchitectsMock).toHaveBeenCalledWith({ search: "ada", limit: 100 });
    });
  });

  it("sorts the loaded architect table by name", async () => {
    getAdminArchitectsMock.mockResolvedValue(page([
      architect({ id: "architect-z", email: "zoe@example.com", fullName: "Zoe Builder" }),
      architect()
    ]));
    render(<AdminArchitectsPage />);
    await screen.findByText("Ada Builder");

    await userEvent.setup().click(screen.getByRole("button", { name: "Architect" }));
    const rows = screen.getAllByRole("row");
    expect(rows[1].textContent).toContain("Ada Builder");
    expect(rows[2].textContent).toContain("Zoe Builder");
  });

  it("shows the architect-specific error state", async () => {
    getAdminArchitectsMock.mockResolvedValueOnce({ success: false, error: "Unavailable" });
    render(<AdminArchitectsPage />);

    expect(await screen.findByTestId("admin-architects-error")).toBeTruthy();
    expect(screen.getByText("Could not load architects.")).toBeTruthy();
  });

  it("requires confirmation and removes the architect after permanent deletion", async () => {
    render(<AdminArchitectsPage />);
    await screen.findByText("Ada Builder");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete ada@example.com" }));

    const dialog = screen.getByRole("dialog", { name: "Permanently delete architect?" });
    const confirmButton = within(dialog).getByRole("button", { name: "Permanently delete" });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    await user.type(within(dialog).getByTestId("admin-architect-delete-confirmation"), "DELETE");
    await user.click(confirmButton);

    await waitFor(() => {
      expect(deleteAdminArchitectMock).toHaveBeenCalledWith("architect-1", "DELETE");
    });
    expect(await screen.findByText("ada@example.com and all associated account data were permanently deleted.")).toBeTruthy();
    expect(screen.getByText("0 total")).toBeTruthy();
    expect(screen.queryByTestId("admin-architects-table")).toBeNull();
  });
});
