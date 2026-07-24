import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindManyMock, paymentFindManyMock, businessFindManyMock } = vi.hoisted(() => ({
  userFindManyMock: vi.fn(),
  paymentFindManyMock: vi.fn(),
  businessFindManyMock: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    user: { findMany: userFindManyMock },
    payment: { findMany: paymentFindManyMock },
    business: { findMany: businessFindManyMock }
  }
}));

import {
  dedupeRegisteredBusinessAccounts,
  listRegisteredBusinessAccounts
} from "./registered-business-accounts";

function candidate(overrides: Partial<Parameters<typeof dedupeRegisteredBusinessAccounts>[0][number]> = {}) {
  return {
    id: "user-1",
    email: "buyer@example.com",
    fullName: "Buyer One",
    role: "BUSINESS",
    isSuspended: false,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    phone: null,
    lastActiveAt: null,
    ...overrides
  };
}

beforeEach(() => {
  userFindManyMock.mockReset();
  paymentFindManyMock.mockReset();
  businessFindManyMock.mockReset();
});

describe("registered business account deduplication", () => {
  it("returns one account for repeated email casing and legacy role rows", () => {
    const accounts = dedupeRegisteredBusinessAccounts([
      candidate({ id: "architect-row", email: "Buyer@Example.com", role: "ARCHITECT" }),
      candidate({ id: "business-row", email: "buyer@example.com", role: "BUSINESS" })
    ]);

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: "business-row", email: "buyer@example.com" });
  });

  it("keeps the earliest registration date and a suspended status", () => {
    const accounts = dedupeRegisteredBusinessAccounts([
      candidate({ createdAt: new Date("2026-07-20T00:00:00.000Z") }),
      candidate({
        id: "legacy-row",
        role: "ARCHITECT",
        isSuspended: true,
        createdAt: new Date("2026-07-01T00:00:00.000Z")
      })
    ]);

    expect(accounts[0]?.createdAt.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(accounts[0]?.isSuspended).toBe(true);
  });

  it("groups purchased agents from legacy user ids under one registered email", async () => {
    userFindManyMock.mockResolvedValue([
      {
        ...candidate({ id: "architect-row", email: "Buyer@Example.com", role: "ARCHITECT" }),
        activeSessions: [],
        loginHistory: []
      },
      {
        ...candidate({ id: "business-row", email: "buyer@example.com", role: "BUSINESS" }),
        activeSessions: [{ lastActiveAt: new Date("2026-07-21T12:00:00.000Z") }],
        loginHistory: []
      }
    ]);
    paymentFindManyMock.mockResolvedValue([
      {
        id: "payment-1",
        userId: "architect-row",
        amountCents: 14900,
        currency: "usd",
        status: "SUCCEEDED",
        createdAt: new Date("2026-07-21T00:00:00.000Z"),
        listing: {
          id: "listing-1",
          name: "Reception Agent",
          shortDescription: "Answers every call",
          category: "Voice",
          pricingModel: "SUBSCRIPTION",
          priceCents: 14900,
          architect: { email: "architect@example.com", fullName: "Agent Builder" }
        }
      }
    ]);
    businessFindManyMock.mockResolvedValue([
      {
        ownerId: "business-row",
        name: "Buyer Dental",
        subscriptionStatus: "active",
        updatedAt: new Date("2026-07-21T00:00:00.000Z"),
        profile: { teamPhone: "+15550100" },
        phoneNumbers: [],
        _count: { vapiCalls: 14, leads: 0 },
        installedAgents: [{ id: "installed-1", listingId: "listing-1", status: "ACTIVE" }]
      }
    ]);

    const accounts = await listRegisteredBusinessAccounts("", {
      includePurchasedAgents: true,
      now: new Date("2026-07-21T00:00:00.000Z")
    });

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.purchasedAgents).toEqual([
      expect.objectContaining({
        purchaseId: "payment-1",
        installedAgentId: "installed-1",
        installedAgentStatus: "ACTIVE",
        listing: expect.objectContaining({ id: "listing-1", name: "Reception Agent" })
      })
    ]);
    expect(accounts[0]).toMatchObject({
      businessName: "Buyer Dental",
      phone: "+15550100",
      lastActiveAt: new Date("2026-07-21T12:00:00.000Z"),
      totalSpendCents: 14900,
      currency: "usd",
      totalExecutions: 14,
      subscriptionStatus: "active",
      accountStatus: "Active"
    });
    expect(paymentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: ["architect-row", "business-row"] } })
      })
    );
    expect(businessFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          _count: {
            select: {
              vapiCalls: { where: { executionMode: "LIVE" } },
              leads: { where: { source: { contains: "MISSED_CALL" } } }
            }
          }
        })
      })
    );
    expect(userFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          activeSessions: expect.objectContaining({
            where: {
              revokedAt: null,
              expiresAt: { gt: new Date("2026-07-21T00:00:00.000Z") }
            }
          }),
          loginHistory: expect.objectContaining({ where: { status: "SUCCESS" } })
        })
      })
    );
  });

  it("returns null currency when successful payments use multiple currencies", async () => {
    userFindManyMock.mockResolvedValue([
      { ...candidate(), activeSessions: [], loginHistory: [] }
    ]);
    paymentFindManyMock.mockResolvedValue([
      {
        id: "usd-payment",
        userId: "user-1",
        amountCents: 1000,
        currency: "usd",
        status: "SUCCEEDED",
        createdAt: new Date("2026-07-20T00:00:00.000Z"),
        listing: null
      },
      {
        id: "eur-payment",
        userId: "user-1",
        amountCents: 500,
        currency: "eur",
        status: "SUCCEEDED",
        createdAt: new Date("2026-07-19T00:00:00.000Z"),
        listing: null
      }
    ]);
    businessFindManyMock.mockResolvedValue([]);

    const accounts = await listRegisteredBusinessAccounts("", { includePurchasedAgents: true });

    expect(accounts[0]).toMatchObject({ totalSpendCents: null, currency: null });
  });

  it("keeps the trial currency when spend is zero", async () => {
    userFindManyMock.mockResolvedValue([
      { ...candidate(), activeSessions: [], loginHistory: [] }
    ]);
    paymentFindManyMock.mockResolvedValue([
      {
        id: "trial-payment",
        userId: "user-1",
        amountCents: 0,
        currency: "usd",
        status: "TRIALING",
        createdAt: new Date("2026-07-20T00:00:00.000Z"),
        listing: null
      }
    ]);
    businessFindManyMock.mockResolvedValue([]);

    const accounts = await listRegisteredBusinessAccounts("", {
      includePurchasedAgents: true,
      now: new Date("2026-07-21T00:00:00.000Z")
    });

    expect(accounts[0]).toMatchObject({
      totalSpendCents: 0,
      currency: "usd",
      accountStatus: "Trial"
    });
  });

  it("prefers a completed purchase over a newer historical trial", async () => {
    userFindManyMock.mockResolvedValue([
      { ...candidate(), activeSessions: [], loginHistory: [] }
    ]);
    paymentFindManyMock.mockResolvedValue([
      {
        id: "trial-payment",
        userId: "user-1",
        amountCents: 0,
        currency: "usd",
        status: "TRIALING",
        createdAt: new Date("2026-07-20T00:00:00.000Z"),
        listing: {
          id: "listing-1",
          name: "Reception Agent",
          shortDescription: "Answers calls",
          category: "Voice",
          pricingModel: "SUBSCRIPTION",
          priceCents: 14900,
          architect: null
        }
      },
      {
        id: "successful-payment",
        userId: "user-1",
        amountCents: 14900,
        currency: "usd",
        status: "SUCCEEDED",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        listing: {
          id: "listing-1",
          name: "Reception Agent",
          shortDescription: "Answers calls",
          category: "Voice",
          pricingModel: "SUBSCRIPTION",
          priceCents: 14900,
          architect: null
        }
      }
    ]);
    businessFindManyMock.mockResolvedValue([]);

    const accounts = await listRegisteredBusinessAccounts("", {
      includePurchasedAgents: true,
      now: new Date("2026-07-21T00:00:00.000Z")
    });

    expect(accounts[0]).toMatchObject({
      accountStatus: "Active",
      totalSpendCents: 14900,
      currency: "usd"
    });
    expect(accounts[0]?.purchasedAgents[0]).toMatchObject({
      purchaseId: "successful-payment",
      purchaseStatus: "SUCCEEDED",
      amountCents: 14900
    });
  });

  it("marks an expired trial inactive instead of leaving it in Trial", async () => {
    userFindManyMock.mockResolvedValue([
      { ...candidate(), activeSessions: [], loginHistory: [] }
    ]);
    paymentFindManyMock.mockResolvedValue([
      {
        id: "expired-trial",
        userId: "user-1",
        amountCents: 0,
        currency: "usd",
        status: "TRIALING",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        listing: null
      }
    ]);
    businessFindManyMock.mockResolvedValue([
      {
        ownerId: "user-1",
        name: "Expired Trial Business",
        subscriptionStatus: "trialing",
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
        profile: null,
        phoneNumbers: [],
        _count: { vapiCalls: 0, leads: 0 },
        installedAgents: []
      }
    ]);

    const accounts = await listRegisteredBusinessAccounts("", {
      includePurchasedAgents: true,
      now: new Date("2026-07-21T00:00:00.000Z")
    });

    expect(accounts[0]).toMatchObject({
      accountStatus: "Inactive",
      totalSpendCents: 0,
      currency: "usd"
    });
  });
});
