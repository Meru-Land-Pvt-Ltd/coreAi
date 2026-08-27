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
  it("loads every status, and shows no priority or tier at all", async () => {
    render(<AdminAgentsPage />);

    expect(await screen.findByText("Reception Agent")).toBeTruthy();
    expect(getAdminAgentsMock).toHaveBeenCalledWith({ search: "", limit: 100 });

    /* This used to assert the screen showed "N/A" and a permanently disabled
       "High Priority" button. Both came from fields the server sends as null
       for every listing and always has — so the screen carried a badge that
       never appeared, a detail that always read "N/A", and a filter whose
       buttons could never become available. Showing a blank forever is not
       neutral: it tells an admin the data exists and is missing. */
    expect(screen.queryByText("N/A")).toBeNull();
    expect(screen.queryByRole("button", { name: "High Priority" })).toBeNull();
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
    /* "Request changes" is stored as a rejected status with a review status of
       CHANGES_REQUESTED. Showing it as "Rejected" told the admin — and the
       architect reading it from the other side — that the agent was refused. */
    const card = await screen.findByTestId("admin-agent-card-listing-1");
    expect(within(card).getByText("Changes requested")).toBeTruthy();
    expect(within(card).queryByText("Rejected")).toBeNull();
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

  it("never deletes an agent on one click — the admin must type DELETE", async () => {
    /* This test used to be called "deletes an agent immediately", which was
       exactly the defect. That one button removes a live listing, releases its
       phone numbers, deactivates the business numbers behind them, and unhooks
       every payment, invoice and appointment pointing at it — for every
       business already using it. The less destructive delete on the architects
       screen has always asked for a typed confirmation. */
    render(<AdminAgentsPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Delete Reception Agent" }));

    expect(deleteAdminAgentMock).not.toHaveBeenCalled();
    const confirm = await screen.findByTestId("admin-agent-confirm-delete");
    expect(confirm.hasAttribute("disabled")).toBe(true);

    await user.type(screen.getByTestId("admin-agent-delete-confirmation"), "DELETE");
    await user.click(screen.getByTestId("admin-agent-confirm-delete"));

    await waitFor(() => expect(deleteAdminAgentMock).toHaveBeenCalledWith("listing-1"));
    await waitFor(() => expect(screen.queryByTestId("admin-agent-card-listing-1")).toBeNull());
    expect(screen.getByText("Reception Agent was deleted permanently.")).toBeTruthy();
  });

  it("tells the admin how many businesses it will cut loose", async () => {
    render(<AdminAgentsPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Delete Reception Agent" }));

    /* Not "are you sure" — what it actually does, and to how many people. */
    expect(screen.getByText(/installed it/)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
  });
});
