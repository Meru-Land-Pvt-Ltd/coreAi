import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listingFindUniqueMock,
  listingUpdateMock,
  workflowUpdateMock,
  transactionMock
} = vi.hoisted(() => ({
  listingFindUniqueMock: vi.fn(),
  listingUpdateMock: vi.fn(),
  workflowUpdateMock: vi.fn(),
  transactionMock: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    agentListing: { findUnique: listingFindUniqueMock },
    $transaction: transactionMock
  }
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("authUser", {
      id: "admin-user",
      email: "admin@example.com",
      role: "ADMIN",
      roles: ["ADMIN"]
    });
    await next();
  },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => next()
}));

vi.mock("./phone-numbers", async () => {
  const { Hono } = await import("hono");
  return { adminPhoneNumberRoutes: new Hono() };
});
vi.mock("./payout-routes", async () => {
  const { Hono } = await import("hono");
  return { adminPayoutRoutes: new Hono() };
});
vi.mock("./pricing-routes", async () => {
  const { Hono } = await import("hono");
  return { adminPricingRoutes: new Hono() };
});
vi.mock("../email/ses-mail-service", () => ({ sendBusinessEmail: vi.fn() }));
vi.mock("./registered-business-accounts", () => ({ listRegisteredBusinessAccounts: vi.fn() }));
vi.mock("./admin-summary", () => ({ getAdminLiveSummaryData: vi.fn() }));

import { adminRoutes } from "./routes";

beforeEach(() => {
  vi.clearAllMocks();
  listingFindUniqueMock.mockResolvedValue({
    id: "listing-1",
    workflowId: "workflow-1",
    submittedAt: new Date("2026-07-20T00:00:00.000Z"),
    approvedAt: null,
    publishedAt: null,
    reviewStatus: "SUBMITTED",
    rejectionReason: null
  });
  workflowUpdateMock.mockResolvedValue({ id: "workflow-1" });
  listingUpdateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "listing-1",
    name: "Reception Agent",
    workflowId: "workflow-1",
    priceCents: 14900,
    submittedAt: new Date("2026-07-20T00:00:00.000Z"),
    approvedAt: data.approvedAt ?? null,
    publishedAt: data.publishedAt ?? null,
    updatedAt: new Date("2026-07-21T00:00:00.000Z"),
    architect: { id: "architect-1", email: "architect@example.com", fullName: "Builder" },
    ...data
  }));
  transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      agentListing: { update: listingUpdateMock },
      workflowDefinition: { update: workflowUpdateMock }
    })
  );
});

async function decide(status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED", reason?: string) {
  return adminRoutes.request(`/agents/listing-1/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, reason })
  });
}

describe("admin agent moderation decisions", () => {
  it("approves and publishes the listing and workflow in one transaction", async () => {
    const response = await decide("APPROVED");
    const body = await response.json() as { data: { listing: { status: string } } };

    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(listingUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "APPROVED",
        reviewStatus: "APPROVED",
        publishStatus: "PUBLISHED",
        approvedAt: expect.any(Date),
        publishedAt: expect.any(Date)
      })
    }));
    expect(workflowUpdateMock).toHaveBeenCalledWith({
      where: { id: "workflow-1" },
      data: { reviewStatus: "APPROVED", publishStatus: "PUBLISHED" }
    });
    expect(body.data.listing.status).toBe("APPROVED");
  });

  it("records Request Changes canonically and unlocks the listing for architect edits", async () => {
    const response = await decide("PENDING_REVIEW", "Please document the fallback path.");
    const body = await response.json() as {
      data: { listing: { status: string; reviewStatus: string; rejectionReason: string } };
    };

    expect(response.status).toBe(200);
    expect(listingUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "REJECTED",
        reviewStatus: "CHANGES_REQUESTED",
        publishStatus: "UNPUBLISHED",
        rejectionReason: "Please document the fallback path."
      })
    }));
    expect(workflowUpdateMock).toHaveBeenCalledWith({
      where: { id: "workflow-1" },
      data: { reviewStatus: "CHANGES_REQUESTED", publishStatus: "UNPUBLISHED" }
    });
    expect(body.data.listing).toMatchObject({
      status: "REJECTED",
      reviewStatus: "CHANGES_REQUESTED",
      rejectionReason: "Please document the fallback path."
    });
  });

  it("rejects and unpublishes both listing and workflow while retaining feedback", async () => {
    const response = await decide("REJECTED", "The listing does not pass the safety review.");
    const body = await response.json() as {
      data: { listing: { status: string; reviewStatus: string; rejectionReason: string } };
    };

    expect(response.status).toBe(200);
    expect(listingUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        status: "REJECTED",
        reviewStatus: "REJECTED",
        publishStatus: "UNPUBLISHED",
        rejectionReason: "The listing does not pass the safety review."
      }
    }));
    expect(workflowUpdateMock).toHaveBeenCalledWith({
      where: { id: "workflow-1" },
      data: { reviewStatus: "REJECTED", publishStatus: "UNPUBLISHED" }
    });
    expect(body.data.listing).toMatchObject({
      status: "REJECTED",
      reviewStatus: "REJECTED",
      rejectionReason: "The listing does not pass the safety review."
    });
  });
});
