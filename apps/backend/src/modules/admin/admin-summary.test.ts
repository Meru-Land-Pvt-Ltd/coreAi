import { describe, expect, it } from "vitest";
import {
  averageExecutionsPerDay30d,
  buildAdminPerformance30d,
  calculateRevenueChangePercent,
  dedupeMarketplaceUserRegistrations,
  sumAdminExecutionCounts,
  summarizeAdminRevenue
} from "./admin-summary";

describe("admin live summary calculations", () => {
  it("builds a complete UTC 30-day series with zero-filled days", () => {
    const result = buildAdminPerformance30d(
      new Date("2026-07-21T18:00:00.000Z"),
      [
        { createdAt: new Date("2026-06-22T10:00:00.000Z"), amountCents: 1000 },
        { createdAt: new Date("2026-07-21T08:00:00.000Z"), amountCents: 14900 }
      ],
      [
        { createdAt: new Date("2026-07-21T09:00:00.000Z") },
        { createdAt: new Date("2026-07-21T09:01:00.000Z") }
      ],
      [{ createdAt: new Date("2026-07-20T09:00:00.000Z") }]
    );

    expect(result).toHaveLength(30);
    expect(result[0]).toEqual({
      date: "2026-06-22",
      revenueCents: 1000,
      executions: 0,
      newUsers: 0
    });
    expect(result.at(-2)).toEqual({
      date: "2026-07-20",
      revenueCents: 0,
      executions: 0,
      newUsers: 1
    });
    expect(result.at(-1)).toEqual({
      date: "2026-07-21",
      revenueCents: 14900,
      executions: 2,
      newUsers: 0
    });
  });

  it("returns null without a previous-period revenue baseline", () => {
    expect(calculateRevenueChangePercent(1000, 0)).toBeNull();
    expect(calculateRevenueChangePercent(1200, 1000)).toBe(20);
    expect(calculateRevenueChangePercent(750, 1000)).toBe(-25);
  });

  it("preserves a one-decimal daily execution average", () => {
    expect(averageExecutionsPerDay30d(4)).toBe(0.1);
    expect(averageExecutionsPerDay30d(31)).toBe(1);
    expect(averageExecutionsPerDay30d(44)).toBe(1.5);
  });

  it("combines live business execution event counts", () => {
    expect(sumAdminExecutionCounts([4, 2, 7])).toBe(13);
    expect(sumAdminExecutionCounts([0, 0, 0])).toBe(0);
  });

  it("returns a monetary total only when every amount uses one currency", () => {
    expect(summarizeAdminRevenue([
      { amountCents: 1000, currency: "USD" },
      { amountCents: 4900, currency: "usd" }
    ])).toEqual({ amountCents: 5900, currency: "usd", mixedCurrencies: false });

    expect(summarizeAdminRevenue([
      { amountCents: 1000, currency: "usd" },
      { amountCents: 500, currency: "eur" }
    ])).toEqual({ amountCents: null, currency: null, mixedCurrencies: true });
  });

  it("counts marketplace identities once and excludes admin-only users", () => {
    const identities = dedupeMarketplaceUserRegistrations([
      {
        id: "business-row",
        email: "Buyer@Example.com",
        fullName: "Buyer",
        role: "BUSINESS",
        createdAt: new Date("2026-07-20T00:00:00.000Z"),
        roleMemberships: []
      },
      {
        id: "architect-row",
        email: "buyer@example.com",
        fullName: null,
        role: "ARCHITECT",
        createdAt: new Date("2026-07-21T00:00:00.000Z"),
        roleMemberships: []
      },
      {
        id: "admin-with-membership",
        email: "builder@example.com",
        fullName: "Builder",
        role: "ADMIN",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        roleMemberships: [
          { role: "ARCHITECT", createdAt: new Date("2026-07-19T00:00:00.000Z") }
        ]
      },
      {
        id: "admin-only",
        email: "admin@example.com",
        fullName: "Admin",
        role: "ADMIN",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        roleMemberships: []
      }
    ]);

    expect(identities).toHaveLength(2);
    expect(identities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        email: "Buyer@Example.com",
        roles: ["ARCHITECT", "BUSINESS"],
        createdAt: new Date("2026-07-20T00:00:00.000Z")
      }),
      expect.objectContaining({
        email: "builder@example.com",
        roles: ["ARCHITECT"],
        createdAt: new Date("2026-07-19T00:00:00.000Z")
      })
    ]));
  });
});
