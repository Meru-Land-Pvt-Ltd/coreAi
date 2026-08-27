import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  businessFindUnique: vi.fn(),
  vapiCallAggregate: vi.fn(),
  smsCount: vi.fn(),
  currentSpend: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    business: { findUnique: mocks.businessFindUnique },
    vapiCall: { aggregate: mocks.vapiCallAggregate },
    smsExecution: { count: mocks.smsCount }
  }
}));

vi.mock("./spending-alert", () => ({
  currentSpendMicroUsd: mocks.currentSpend
}));

import { getLiveUsageCapStatus, resolveUsageCapCents } from "./usage-cap";
import { env } from "../../config/env";

describe("cap exposure boundaries", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.businessFindUnique.mockResolvedValue({ usageHardCapCents: 1000, usageCapNotifiedMonth: null });
    mocks.vapiCallAggregate.mockResolvedValue({ _sum: { durationSeconds: 0 }, _count: { _all: 0 } });
    mocks.smsCount.mockResolvedValue(0);
    mocks.currentSpend.mockResolvedValue(0);
  });

  it("stays open under the cap on priced spend alone", async () => {
    mocks.currentSpend.mockResolvedValue(9_990_000); // $9.99 vs $10 cap
    const status = await getLiveUsageCapStatus("biz-1");
    expect(status.exceeded).toBe(false);
    expect(status.exposureMicroUsd).toBe(9_990_000);
  });

  it("trips on priced spend at the boundary", async () => {
    mocks.currentSpend.mockResolvedValue(10_000_000); // exactly $10
    const status = await getLiveUsageCapStatus("biz-1");
    expect(status.exceeded).toBe(true);
  });

  it("exposure equals priced spend while provisional exposure is disabled", async () => {
    mocks.currentSpend.mockResolvedValue(5_000_000);
    mocks.vapiCallAggregate.mockResolvedValue({ _sum: { durationSeconds: 1200 }, _count: { _all: 4 } });
    mocks.smsCount.mockResolvedValue(50);
    const status = await getLiveUsageCapStatus("biz-1");
    expect(status.exposureMicroUsd).toBe(5_000_000);
  });

  it("fails OPEN when the lookup errors — a cap outage never blocks calls", async () => {
    mocks.businessFindUnique.mockRejectedValue(new Error("db down"));
    const status = await getLiveUsageCapStatus("biz-1");
    expect(status.exceeded).toBe(false);
  });

  it("cap 0 means unlimited regardless of exposure", async () => {
    mocks.businessFindUnique.mockResolvedValue({ usageHardCapCents: 0, usageCapNotifiedMonth: null });
    mocks.currentSpend.mockResolvedValue(999_000_000);
    const status = await getLiveUsageCapStatus("biz-1");
    expect(status.exceeded).toBe(false);
  });
});

describe("usage cap resolution", () => {
  it("business override wins; null inherits the platform default; 0 = unlimited", () => {
    expect(resolveUsageCapCents(12000)).toBe(12000);
    expect(resolveUsageCapCents(0)).toBe(0);
    expect(resolveUsageCapCents(null)).toBe(env.LIVE_USAGE_HARD_CAP_CENTS);
    expect(resolveUsageCapCents(undefined)).toBe(env.LIVE_USAGE_HARD_CAP_CENTS);
    // Negative values clamp to 0 (unlimited) rather than going nonsensical.
    expect(resolveUsageCapCents(-5)).toBe(0);
  });
});
