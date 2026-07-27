import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import {
  appendLedgerAdjustment,
  applyRefundToSettlement,
  createSettlementForPayment,
  releaseEligibleEarnings,
  transitionEarning
} from "./settlements";
import { stripeLivemode } from "./config";

/**
 * DB-backed settlement ledger tests. Runs against the local dev database with
 * unique fixtures (removed afterwards) and skips when it is unreachable —
 * same convention as the deployment-access suite. No Stripe calls: every
 * function under test here is database-only.
 */

const RUN = `payouttest-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let architectId = "";
let buyerId = "";
let listingId = "";
const paymentIds: string[] = [];

async function createPayment(key: string, amountCents: number, options?: { approved?: boolean }) {
  const payment = await prisma.payment.create({
    data: {
      userId: buyerId,
      listingId,
      amountCents,
      currency: "usd",
      status: "SUCCEEDED",
      stripeSessionId: `pi_${RUN}_${key}`,
      description: `test purchase ${key}`,
      ...(options?.approved
        ? { architectEarningStatus: "APPROVED", architectEarningReviewedAt: new Date() }
        : {})
    }
  });
  paymentIds.push(payment.id);
  return payment;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
    return;
  }

  const architect = await prisma.user.create({
    data: { email: `${RUN}-architect@test.triven.ai`, role: "ARCHITECT", fullName: "Payout Test Architect" }
  });
  architectId = architect.id;
  const buyer = await prisma.user.create({
    data: { email: `${RUN}-buyer@test.triven.ai`, role: "BUSINESS", fullName: "Payout Test Buyer" }
  });
  buyerId = buyer.id;
  const listing = await prisma.agentListing.create({
    data: {
      name: `${RUN} listing`,
      shortDescription: "payout test listing",
      priceCents: 14_900,
      status: "APPROVED",
      pricingModel: "ONE_TIME",
      architectUserId: architectId
    }
  });
  listingId = listing.id;
});

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.architectLedgerEntry.deleteMany({ where: { architectUserId: architectId } });
  await prisma.architectEarning.deleteMany({ where: { architectUserId: architectId } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.agentListing.deleteMany({ where: { id: listingId } });
  await prisma.user.deleteMany({ where: { id: { in: [architectId, buyerId] } } });
});

describe("settlement creation", () => {
  it("creates exactly one settlement per payment, idempotently", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const payment = await createPayment("single", 14_900);

    await createSettlementForPayment(payment.id);
    await createSettlementForPayment(payment.id); // duplicate webhook delivery

    const earnings = await prisma.architectEarning.findMany({ where: { paymentId: payment.id } });
    expect(earnings).toHaveLength(1);
    const earning = earnings[0]!;
    expect(earning.grossAmountCents).toBe(14_900);
    expect(earning.architectGrossCents).toBe(10_430);
    expect(earning.platformCommissionCents).toBe(4_470);
    expect(earning.architectNetCents).toBe(10_430);
    expect(earning.status).toBe("HELD");
    expect(earning.calculationVersion).toBe(1);
    expect(earning.livemode).toBe(stripeLivemode());
  });

  it("does not settle free installs", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const payment = await prisma.payment.create({
      data: {
        userId: buyerId,
        listingId,
        amountCents: 0,
        lineItemsJson: [{ label: "free", amountCents: 0 }] as never,
        currency: "usd",
        status: "SUCCEEDED",
        description: "free install"
      }
    });
    paymentIds.push(payment.id);

    await createSettlementForPayment(payment.id);
    expect(await prisma.architectEarning.count({ where: { paymentId: payment.id } })).toBe(0);
  });
});

describe("hold and release", () => {
  it("does not release held earnings without admin approval", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const payment = await createPayment("held", 10_000); // not approved
    await createSettlementForPayment(payment.id);

    await releaseEligibleEarnings(architectId);
    const earning = await prisma.architectEarning.findUnique({ where: { paymentId: payment.id } });
    expect(earning?.status).toBe("HELD");
  });

  it("releases approved earnings even when their provisional hold date is still in the future", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const payment = await createPayment("released", 10_000, { approved: true });
    await createSettlementForPayment(payment.id);

    const released = await releaseEligibleEarnings(architectId);
    expect(released).toBeGreaterThanOrEqual(1);
    const earning = await prisma.architectEarning.findUnique({ where: { paymentId: payment.id } });
    expect(earning?.status).toBe("AVAILABLE_FOR_TRANSFER");
    expect(earning?.availableAt).not.toBeNull();
  });
});

describe("transitions", () => {
  it("rejects illegal regressions and keeps the stored state", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const payment = await createPayment("transition", 5_000, { approved: true });
    await createSettlementForPayment(payment.id);
    const earning = await prisma.architectEarning.findUnique({ where: { paymentId: payment.id } });

    const after = await transitionEarning({
      earningId: earning!.id,
      to: "TRANSFERRED", // HELD → TRANSFERRED is illegal (must go through release+transfer)
      source: "system",
      reason: "test illegal"
    });
    expect(after.status).toBe("HELD");
  });
});

describe("refund adjustments", () => {
  it("applies a partial refund with the architect share and stays idempotent on duplicate webhooks", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const payment = await createPayment("refund-partial", 10_000, { approved: true });
    await createSettlementForPayment(payment.id);

    const params = {
      paymentIntentId: `pi_${RUN}_refund-partial`,
      refundId: `re_${RUN}_1`,
      cumulativeRefundedCents: 4_000,
      fullyRefunded: false
    };
    await applyRefundToSettlement(params);
    await applyRefundToSettlement(params); // duplicate delivery

    const earning = await prisma.architectEarning.findUnique({ where: { paymentId: payment.id } });
    expect(earning?.refundCents).toBe(2_800); // 70% of 4000
    expect(earning?.architectNetCents).toBe(7_000 - 2_800);
    expect(earning?.status).toBe("PARTIALLY_REFUNDED");

    const entries = await prisma.architectLedgerEntry.findMany({
      where: { earningId: earning!.id, entryType: "REFUND_ADJUSTMENT" }
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amountCents).toBe(-2_800);
  });

  it("marks a full refund REFUNDED before transfer and never over-adjusts", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const payment = await createPayment("refund-full", 10_000, { approved: true });
    await createSettlementForPayment(payment.id);

    await applyRefundToSettlement({
      paymentIntentId: `pi_${RUN}_refund-full`,
      refundId: `re_${RUN}_2`,
      cumulativeRefundedCents: 10_000,
      fullyRefunded: true
    });

    const earning = await prisma.architectEarning.findUnique({ where: { paymentId: payment.id } });
    expect(earning?.status).toBe("REFUNDED");
    expect(earning?.refundCents).toBe(7_000);
    expect(earning?.architectNetCents).toBe(0);

    const refreshedPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(refreshedPayment?.status).toBe("REFUNDED");

    // A late, higher duplicate can never push the adjustment past the gross.
    await applyRefundToSettlement({
      paymentIntentId: `pi_${RUN}_refund-full`,
      refundId: `re_${RUN}_3`,
      cumulativeRefundedCents: 10_000,
      fullyRefunded: true
    });
    const after = await prisma.architectEarning.findUnique({ where: { paymentId: payment.id } });
    expect(after?.refundCents).toBe(7_000);
  });
});

describe("ledger idempotency", () => {
  it("dedupes identical (entryType, sourceId, earningId) entries", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const payment = await createPayment("ledger", 2_000, { approved: true });
    await createSettlementForPayment(payment.id);
    const earning = await prisma.architectEarning.findUnique({ where: { paymentId: payment.id } });

    const first = await appendLedgerAdjustment({
      earningId: earning!.id,
      entryType: "MANUAL_ADJUSTMENT",
      amountCents: -100,
      reason: "test",
      source: "admin",
      sourceId: `admin_${RUN}`,
      column: "adjustmentCents"
    });
    const second = await appendLedgerAdjustment({
      earningId: earning!.id,
      entryType: "MANUAL_ADJUSTMENT",
      amountCents: -100,
      reason: "test",
      source: "admin",
      sourceId: `admin_${RUN}`,
      column: "adjustmentCents"
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    const refreshed = await prisma.architectEarning.findUnique({ where: { paymentId: payment.id } });
    expect(refreshed?.adjustmentCents).toBe(-100);
    expect(refreshed?.architectNetCents).toBe(1_400 - 100);
  });
});

describe("payout reservation constraint", () => {
  it("blocks duplicate clientRequestId at the database level", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const clientRequestId = `req_${RUN}`;
    const first = await prisma.architectPayout.create({
      data: {
        architectUserId: architectId,
        amountCents: 1_000,
        currency: "usd",
        status: "RESERVED",
        deliveryMethod: "standard",
        livemode: stripeLivemode(),
        clientRequestId
      }
    });

    await expect(
      prisma.architectPayout.create({
        data: {
          architectUserId: architectId,
          amountCents: 2_000,
          currency: "usd",
          status: "RESERVED",
          deliveryMethod: "standard",
          livemode: stripeLivemode(),
          clientRequestId
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.architectPayout.delete({ where: { id: first.id } });
  });
});
