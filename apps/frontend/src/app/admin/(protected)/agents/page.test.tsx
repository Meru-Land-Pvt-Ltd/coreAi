import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminAgentsPage from "./page";

const { deleteAdminAgentMock, getAdminAgentsMock, updateAdminAgentStatusMock } = vi.hoisted(() => ({
  deleteAdminAgentMock: vi.fn(),
  getAdminAgentsMock: vi.fn(),
  updateAdminAgentStatusMock: vi.fn()
}));

vi.mock("@/components/admin/features/api", () => ({
  deleteAdminAgent: deleteAdminAgentMock,
  getAdminAgents: getAdminAgentsMock,
  updateAdminAgentStatus: updateAdminAgentStatusMock
}));

beforeEach(() => {
  cleanup();
  deleteAdminAgentMock.mockReset().mockResolvedValue({
    success: true,
    data: {
      deleted: true,
      listingId: "listing-1",
      workflowId: "workflow-1",
      workflowDeleted: true,
      installedAgentsDeleted: 0,
      phoneNumbersReleased: 0
    }
  });
  updateAdminAgentStatusMock.mockReset().mockResolvedValue({
    success: true,
    data: { listing: { id: "listing-1", status: "REJECTED" } }
  });
  getAdminAgentsMock.mockReset().mockResolvedValue({
    success: true,
    data: {
      items: [
        {
          id: "listing-1",
          name: "Reception Agent",
          shortDescription: "Answers every call",
          description: "Answers customer calls and books appointments.",
          category: "Voice",
          priceCents: 14900,
          status: "PENDING_REVIEW",
          tags: [],
          createdAt: "2026-07-20T00:00:00.000Z",
          submittedAt: "2026-07-20T00:00:00.000Z",
          workflowId: "workflow-1",
          workflowName: "Reception Agent",
          architect: { id: "architect-1", email: "builder@example.com", fullName: "Agent Builder" },
          installedAgentsCount: 0,
          architectTotalInstalls: 12,
          architectTier: null,
          priority: null
        }
      ],
      total: 1,
      page: 1,
      limit: 100
    }
  });
});

describe("Admin moderation queue", () => {
  it("loads every status and shows unavailable moderation metadata as N/A", async () => {
    render(<AdminAgentsPage />);

    expect(await screen.findByText("Reception Agent")).toBeTruthy();
    expect(getAdminAgentsMock).toHaveBeenCalledWith({ search: "", limit: 100 });
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "High Priority" }).hasAttribute("disabled")).toBe(true);
  });

  it("submits review notes and updates a changes-requested listing in place", async () => {
    render(<AdminAgentsPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Review" }));
    await user.type(screen.getByLabelText("Notes to architect"), "Please clarify the data policy.");
    await user.click(screen.getByRole("button", { name: "Request Changes" }));

    await waitFor(() => expect(updateAdminAgentStatusMock).toHaveBeenCalledWith(
      "listing-1",
      "PENDING_REVIEW",
      "Please clarify the data policy."
    ));
    const card = await screen.findByTestId("admin-agent-card-listing-1");
    expect(within(card).getByText("Rejected")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Review" })).toBeNull();
  });

  it("shows only the approved state instead of moderation buttons for approved agents", async () => {
    getAdminAgentsMock.mockResolvedValueOnce({
      success: true,
      data: {
        items: [
          {
            id: "listing-approved",
            name: "Approved Agent",
            shortDescription: "Already published",
            description: "An approved marketplace agent.",
            category: "Voice",
            priceCents: 14900,
            status: "APPROVED",
            tags: [],
            createdAt: "2026-07-19T00:00:00.000Z",
            submittedAt: "2026-07-19T00:00:00.000Z",
            workflowId: "workflow-approved",
            workflowName: "Approved Agent",
            architect: { id: "architect-1", email: "builder@example.com", fullName: "Agent Builder" },
            installedAgentsCount: 2,
            architectTotalInstalls: 12,
            architectTier: null,
            priority: null
          }
        ],
        total: 1,
        page: 1,
        limit: 100
      }
    });

    render(<AdminAgentsPage />);

    const card = await screen.findByTestId("admin-agent-card-listing-approved");
    expect(within(card).getByText("Approved")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Review" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Quick Approve" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("deletes an agent immediately and removes it from the admin list", async () => {
    render(<AdminAgentsPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Delete Reception Agent" }));

    await waitFor(() => expect(deleteAdminAgentMock).toHaveBeenCalledWith("listing-1"));
    await waitFor(() => expect(screen.queryByTestId("admin-agent-card-listing-1")).toBeNull());
    expect(screen.getByText("Reception Agent was deleted permanently.")).toBeTruthy();
  });
});
