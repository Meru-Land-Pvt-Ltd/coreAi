import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listingFindUniqueMock,
  listingFindFirstMock,
  listingDeleteMock,
  listingUpdateMock,
  workflowUpdateMock,
  workflowDeleteManyMock,
  installedAgentFindManyMock,
  installedAgentDeleteManyMock,
  agentUsageExecutionDeleteManyMock,
  platformPhoneUpdateManyMock,
  cleanupUpdateManyMock,
  businessProfileUpdateManyMock,
  architectEarningUpdateManyMock,
  transactionMock,
  userFindUniqueMock,
  pseudonymizeDisclosureConsentsMock,
  logAdminActionMock,
  deleteUserWorkspaceMock
} = vi.hoisted(() => ({
  listingFindUniqueMock: vi.fn(),
  listingFindFirstMock: vi.fn(),
  listingDeleteMock: vi.fn(),
  listingUpdateMock: vi.fn(),
  workflowUpdateMock: vi.fn(),
  workflowDeleteManyMock: vi.fn(),
  installedAgentFindManyMock: vi.fn(),
  installedAgentDeleteManyMock: vi.fn(),
  agentUsageExecutionDeleteManyMock: vi.fn(),
  platformPhoneUpdateManyMock: vi.fn(),
  cleanupUpdateManyMock: vi.fn(),
  businessProfileUpdateManyMock: vi.fn(),
  architectEarningUpdateManyMock: vi.fn(),
  transactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  pseudonymizeDisclosureConsentsMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  deleteUserWorkspaceMock: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    agentListing: { findUnique: listingFindUniqueMock },
    user: { findUnique: userFindUniqueMock },
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
vi.mock("../compliance/disclosure-consent", () => ({
  pseudonymizeDisclosureConsentsForUser: pseudonymizeDisclosureConsentsMock
}));
vi.mock("../auth/workspace-deletion", () => ({ deleteUserWorkspace: deleteUserWorkspaceMock }));
vi.mock("./audit", () => ({ logAdminAction: logAdminActionMock }));

import { adminRoutes } from "./routes";

beforeEach(() => {
  vi.clearAllMocks();
  listingFindUniqueMock.mockResolvedValue({
    id: "listing-1",
    name: "Reception Agent",
    workflowId: "workflow-1",
    architectUserId: "architect-1",
    submittedAt: new Date("2026-07-20T00:00:00.000Z"),
    approvedAt: null,
    publishedAt: null,
    reviewStatus: "SUBMITTED",
    rejectionReason: null
  });
  workflowUpdateMock.mockResolvedValue({ id: "workflow-1" });
  listingFindFirstMock.mockResolvedValue(null);
  listingDeleteMock.mockResolvedValue({ id: "listing-1" });
  workflowDeleteManyMock.mockResolvedValue({ count: 1 });
  installedAgentFindManyMock.mockResolvedValue([]);
  installedAgentDeleteManyMock.mockResolvedValue({ count: 0 });
  agentUsageExecutionDeleteManyMock.mockResolvedValue({ count: 0 });
  platformPhoneUpdateManyMock.mockResolvedValue({ count: 0 });
  cleanupUpdateManyMock.mockResolvedValue({ count: 0 });
  businessProfileUpdateManyMock.mockResolvedValue({ count: 0 });
  architectEarningUpdateManyMock.mockResolvedValue({ count: 0 });
  userFindUniqueMock.mockResolvedValue({
    id: "architect-1",
    email: "architect@example.com",
    role: "ARCHITECT",
    roleMemberships: [{ role: "ARCHITECT" }],
    _count: { businesses: 0 }
  });
  pseudonymizeDisclosureConsentsMock.mockResolvedValue(1);
  deleteUserWorkspaceMock.mockResolvedValue({ accountRemoved: true, remainingRoles: [] });
  logAdminActionMock.mockResolvedValue(undefined);
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
      agentListing: {
        update: listingUpdateMock,
        findFirst: listingFindFirstMock,
        delete: listingDeleteMock
      },
      workflowDefinition: {
        update: workflowUpdateMock,
        deleteMany: workflowDeleteManyMock
      },
      installedAgent: {
        findMany: installedAgentFindManyMock,
        deleteMany: installedAgentDeleteManyMock
      },
      platformPhoneNumber: { updateMany: platformPhoneUpdateManyMock },
      businessPhoneNumber: { updateMany: cleanupUpdateManyMock },
      payment: { updateMany: cleanupUpdateManyMock },
      businessUsageInvoice: { updateMany: cleanupUpdateManyMock },
      appointment: { updateMany: cleanupUpdateManyMock },
      businessKnowledgeFile: { updateMany: cleanupUpdateManyMock },
      businessKnowledgeBase: { updateMany: cleanupUpdateManyMock },
      vapiCall: { updateMany: cleanupUpdateManyMock },
      testCalendarEvent: { updateMany: cleanupUpdateManyMock },
      emailMessage: { updateMany: cleanupUpdateManyMock },
      businessEmailAlias: { updateMany: cleanupUpdateManyMock },
      smsExecution: { updateMany: cleanupUpdateManyMock },
      smsConsent: { updateMany: cleanupUpdateManyMock },
      phoneProvisioningRequest: { updateMany: cleanupUpdateManyMock },
      agentUsageExecution: { deleteMany: agentUsageExecutionDeleteManyMock },
      businessProfile: { updateMany: businessProfileUpdateManyMock },
      architectEarning: { updateMany: architectEarningUpdateManyMock }
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

describe("admin agent deletion", () => {
  it("permanently deletes any listing and its live installations without confirmation or status gates", async () => {
    installedAgentFindManyMock
      .mockResolvedValueOnce([
        {
          id: "installed-1",
          businessId: "business-1",
          configJson: { vapiAssistantId: "assistant-1" }
        }
      ])
      .mockResolvedValueOnce([]);
    installedAgentDeleteManyMock.mockResolvedValueOnce({ count: 1 });
    agentUsageExecutionDeleteManyMock.mockResolvedValueOnce({ count: 4 });
    platformPhoneUpdateManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await adminRoutes.request("/agents/listing-1", { method: "DELETE" });
    const body = await response.json() as {
      data: {
        deleted: boolean;
        listingId: string;
        workflowDeleted: boolean;
        installedAgentsDeleted: number;
        phoneNumbersReleased: number;
      };
    };

    expect(response.status).toBe(200);
    expect(agentUsageExecutionDeleteManyMock).toHaveBeenCalledWith({
      where: { installedAgentId: { in: ["installed-1"] } }
    });
    expect(platformPhoneUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ installedAgentId: { in: ["installed-1"] } })
    }));
    expect(installedAgentDeleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["installed-1"] } }
    });
    expect(listingDeleteMock).toHaveBeenCalledWith({ where: { id: "listing-1" } });
    expect(workflowDeleteManyMock).toHaveBeenCalledWith({ where: { id: "workflow-1" } });
    expect(logAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "AGENT_DELETED",
      targetId: "listing-1"
    }));
    expect(body.data).toMatchObject({
      deleted: true,
      listingId: "listing-1",
      workflowDeleted: true,
      installedAgentsDeleted: 1,
      phoneNumbersReleased: 1
    });
  });

  it("returns not found without starting deletion when the listing does not exist", async () => {
    listingFindUniqueMock.mockResolvedValueOnce(null);

    const response = await adminRoutes.request("/agents/missing", { method: "DELETE" });

    expect(response.status).toBe(404);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(listingDeleteMock).not.toHaveBeenCalled();
  });
});

describe("admin architect deletion", () => {
  it("permanently deletes the architect workspace after verifying the target", async () => {
    const response = await adminRoutes.request("/architects/architect-1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE" })
    });
    const body = await response.json() as {
      data: { deleted: boolean; userId: string; accountRemoved: boolean; remainingRoles: string[] };
    };

    expect(response.status).toBe(200);
    expect(pseudonymizeDisclosureConsentsMock).toHaveBeenCalledWith("architect-1");
    expect(deleteUserWorkspaceMock).toHaveBeenCalledWith("architect-1", "ARCHITECT");
    expect(logAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: "admin-user",
      action: "ARCHITECT_ACCOUNT_DELETED",
      targetId: "architect-1"
    }));
    expect(body.data).toEqual({
      deleted: true,
      userId: "architect-1",
      accountRemoved: true,
      remainingRoles: []
    });
  });

  it("requires the destructive confirmation before looking up or deleting an architect", async () => {
    const response = await adminRoutes.request("/architects/architect-1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "delete" })
    });

    expect(response.status).toBe(422);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(deleteUserWorkspaceMock).not.toHaveBeenCalled();
  });

  it("keeps a separate business workspace and its identifiable business consent", async () => {
    userFindUniqueMock.mockResolvedValue({
      id: "architect-1",
      role: "ARCHITECT",
      roleMemberships: [{ role: "ARCHITECT" }, { role: "BUSINESS" }],
      _count: { businesses: 1 }
    });
    deleteUserWorkspaceMock.mockResolvedValue({ accountRemoved: false, remainingRoles: ["BUSINESS"] });

    const response = await adminRoutes.request("/architects/architect-1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE" })
    });
    const body = await response.json() as {
      data: { accountRemoved: boolean; remainingRoles: string[] };
    };

    expect(response.status).toBe(200);
    expect(pseudonymizeDisclosureConsentsMock).not.toHaveBeenCalled();
    expect(deleteUserWorkspaceMock).toHaveBeenCalledWith("architect-1", "ARCHITECT");
    expect(logAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "ARCHITECT_WORKSPACE_DELETED"
    }));
    expect(body.data).toMatchObject({ accountRemoved: false, remainingRoles: ["BUSINESS"] });
  });
});
