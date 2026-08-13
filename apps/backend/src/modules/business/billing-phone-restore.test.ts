import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression cover for the "paid the bill but the number never came back"
 * failure: restoring a billing-suspended business must revive BOTH the
 * routing row (BusinessPhoneNumber) and the inventory row
 * (PlatformPhoneNumber) — and must never take a number another buyer now
 * holds.
 */

const mocks = vi.hoisted(() => ({
  agentFindMany: vi.fn(),
  agentFindUnique: vi.fn(),
  agentUpdate: vi.fn(),
  phoneFindMany: vi.fn(),
  phoneFindFirst: vi.fn(),
  phoneUpdate: vi.fn(),
  platformFindFirst: vi.fn(),
  platformUpdate: vi.fn(),
  businessFindUnique: vi.fn(),
  usageAggregate: vi.fn(),
  paymentAggregate: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    installedAgent: {
      findMany: mocks.agentFindMany,
      findUnique: mocks.agentFindUnique,
      update: mocks.agentUpdate
    },
    businessPhoneNumber: {
      findMany: mocks.phoneFindMany,
      findFirst: mocks.phoneFindFirst,
      update: mocks.phoneUpdate
    },
    platformPhoneNumber: {
      findFirst: mocks.platformFindFirst,
      update: mocks.platformUpdate
    },
    business: { findUnique: mocks.businessFindUnique },
    businessUsageInvoice: { aggregate: mocks.usageAggregate },
    payment: { aggregate: mocks.paymentAggregate }
  }
}));

vi.mock("../../lib/mailer", () => ({
  isPlatformMailConfigured: () => false,
  sendPlatformEmail: vi.fn(),
  buildAgentInvoiceOverdueEmailHtml: vi.fn(),
  buildBillingSuspendedEmailHtml: vi.fn(),
  buildPendingInvoiceReminderEmailHtml: vi.fn(),
  buildSubscriptionRenewalReminderEmailHtml: vi.fn(),
  buildTrialEndedEmailHtml: vi.fn(),
  buildUsageOverdueEmailHtml: vi.fn()
}));

import { restoreBusinessAfterBillingPayment } from "./billing-cycle";

/**
 * Fresh object per call: the restore path deletes the suspension keys from
 * the record it is handed (each row carries its own JSON in production), so a
 * shared fixture would be stripped by the first test and silently skip the rest.
 */
const suspendedConfig = () => ({
  billingSuspended: true,
  billingSuspensionKinds: ["SUBSCRIPTION"],
  billingSuspensionSourceIds: ["pay-1"]
});

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  // No outstanding debt: both "is there still debt" aggregates return zero.
  mocks.usageAggregate.mockResolvedValue({ _sum: { totalMicroUsd: 0 } });
  mocks.paymentAggregate.mockResolvedValue({ _sum: { totalMicroUsd: 0, amountCents: 0 } });
  mocks.agentFindMany.mockResolvedValue([]);
  mocks.agentFindUnique.mockResolvedValue({ listingId: "listing-1" });
  mocks.phoneFindFirst.mockResolvedValue(null);
  mocks.businessFindUnique.mockResolvedValue({ ownerId: "owner-1" });
  mocks.phoneUpdate.mockResolvedValue({});
  mocks.platformUpdate.mockResolvedValue({});
});

describe("restoreBusinessAfterBillingPayment — phone recovery", () => {
  it("reclaims a released inventory row so the number routes again after payment", async () => {
    mocks.agentFindMany.mockReset().mockResolvedValue([]);
    mocks.phoneFindMany.mockResolvedValue([
      { id: "map-1", phoneNumber: "+17026232235", installedAgentId: "agent-1", configJson: suspendedConfig() }
    ]);
    mocks.platformFindFirst.mockResolvedValue({
      id: "plat-1",
      status: "AVAILABLE",
      businessId: null,
      isPlatformSmsSender: false
    });

    const changed = await restoreBusinessAfterBillingPayment("biz-1");

    expect(changed).toBe(true);
    expect(mocks.phoneUpdate.mock.calls[0][0].data).toMatchObject({
      isActive: true,
      installedAgentId: "agent-1"
    });
    const platformData = mocks.platformUpdate.mock.calls[0][0].data;
    expect(platformData).toMatchObject({
      status: "ASSIGNED",
      businessId: "biz-1",
      installedAgentId: "agent-1",
      buyerUserId: "owner-1"
    });
  });

  it("re-links a suspended number whose agent link was cleared (sole active agent)", async () => {
    mocks.phoneFindMany.mockResolvedValue([
      { id: "map-1", phoneNumber: "+17026232235", installedAgentId: null, configJson: suspendedConfig() }
    ]);
    // First call: suspended agents (none). Second: active agents for re-linking.
    mocks.agentFindMany
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "agent-9" }]);
    mocks.platformFindFirst.mockResolvedValue({
      id: "plat-1",
      status: "AVAILABLE",
      businessId: null,
      isPlatformSmsSender: false
    });

    await restoreBusinessAfterBillingPayment("biz-1");

    expect(mocks.phoneUpdate.mock.calls[0][0].data.installedAgentId).toBe("agent-9");
    expect(mocks.platformUpdate.mock.calls[0][0].data.installedAgentId).toBe("agent-9");
  });

  it("leaves an ambiguous business (several active agents) alone rather than guessing", async () => {
    mocks.phoneFindMany.mockResolvedValue([
      { id: "map-1", phoneNumber: "+17026232235", installedAgentId: null, configJson: suspendedConfig() }
    ]);
    mocks.agentFindMany
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "agent-1" }, { id: "agent-2" }]);

    await restoreBusinessAfterBillingPayment("biz-1");

    expect(mocks.phoneUpdate).not.toHaveBeenCalled();
    expect(mocks.platformUpdate).not.toHaveBeenCalled();
  });

  it("never reclaims a number another business now holds", async () => {
    mocks.agentFindMany.mockReset().mockResolvedValue([]);
    mocks.phoneFindMany.mockResolvedValue([
      { id: "map-1", phoneNumber: "+17026232235", installedAgentId: "agent-1", configJson: suspendedConfig() }
    ]);
    mocks.platformFindFirst.mockResolvedValue({
      id: "plat-1",
      status: "ASSIGNED",
      businessId: "OTHER-BIZ",
      isPlatformSmsSender: false
    });

    await restoreBusinessAfterBillingPayment("biz-1");

    // Routing row still revives, but the inventory row is left untouched.
    expect(mocks.phoneUpdate).toHaveBeenCalled();
    expect(mocks.platformUpdate).not.toHaveBeenCalled();
  });

  it("skips restoration when the agent already has a different active number", async () => {
    mocks.phoneFindMany.mockResolvedValue([
      { id: "map-1", phoneNumber: "+17026232235", installedAgentId: "agent-1", configJson: suspendedConfig() }
    ]);
    mocks.phoneFindFirst.mockResolvedValue({ phoneNumber: "+15550009999" });

    const changed = await restoreBusinessAfterBillingPayment("biz-1");

    expect(changed).toBe(false);
    expect(mocks.phoneUpdate).not.toHaveBeenCalled();
  });

  it("ignores phones that were never billing-suspended (e.g. a deliberate number swap)", async () => {
    mocks.phoneFindMany.mockResolvedValue([
      { id: "map-1", phoneNumber: "+17026232235", installedAgentId: null, configJson: {} }
    ]);

    const changed = await restoreBusinessAfterBillingPayment("biz-1");

    expect(changed).toBe(false);
    expect(mocks.phoneUpdate).not.toHaveBeenCalled();
    expect(mocks.platformUpdate).not.toHaveBeenCalled();
  });
});
