/**
 * Admin reprice tool for UNPRICED LIVE executions (real local DB; suite skips
 * when the DB is unreachable).
 *
 * Rows are created WITHOUT installedAgentId so the pipeline falls back to the
 * env-default (standard mappable) pipeline, and the seeded dev-DB pricing rows
 * (twilio_voice, deepgram_nova3, openai_gpt4o_mini, elevenlabs_flash_v25,
 * sms_confirmation, database_storage) price them. Covers: dry-run leaves rows
 * untouched, apply flips UNPRICED→PRICED with a frozen snapshot, idempotency,
 * PRICED rows never selected, unknown pipeline stays UNPRICED, and concurrent
 * applies never double-bill.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import type { UsageLineItem } from "../../lib/usage-pricing";
import { UNKNOWN_USAGE_SERVICE_MAPPING } from "../../lib/usage-service-resolver";
import { repriceUnpricedExecutions } from "./reprice-unpriced";

const RUN = `reprice-${process.pid}-${Date.now().toString(36)}`;

const STANDARD_SEEDED_CODES = [
  "twilio_voice",
  "deepgram_nova3",
  "openai_gpt4o_mini",
  "elevenlabs_flash_v25",
  "sms_confirmation",
  "database_storage"
];

let dbAvailable = false;
let pricingSeeded = false;
let ownerId = "";
let businessId = "";

/** The shared row driven through dry-run → apply → idempotent re-apply. */
let mainCallId = "";

function newCallId(tag: string): string {
  return `${RUN}-${tag}-${randomUUID()}`;
}

async function createUnpricedCall(tag: string, overrides: Record<string, unknown> = {}) {
  const callId = newCallId(tag);
  const row = await prisma.vapiCall.create({
    data: {
      businessId,
      callId,
      customerPhone: "+15555550100",
      executionMode: "LIVE",
      status: "end-of-call-report",
      pricingState: "UNPRICED",
      durationMinutes: 2,
      durationSeconds: 120,
      smsCount: 1,
      endedAt: new Date("2026-06-15T12:00:00.000Z"),
      ...overrides
    }
  });
  return { id: row.id, callId };
}

function lineItemsSum(usageLineItemsJson: unknown): number {
  const items = Array.isArray(usageLineItemsJson) ? (usageLineItemsJson as UsageLineItem[]) : [];
  return items.reduce((sum, item) => sum + (item.billedCostMicroUsd ?? 0), 0);
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[reprice-unpriced.test] database unreachable — suite skipped");
    return;
  }

  const activeSeeded = await prisma.platformUsageService.count({
    where: { code: { in: STANDARD_SEEDED_CODES }, isActive: true }
  });
  pricingSeeded = activeSeeded === STANDARD_SEEDED_CODES.length;
  if (!pricingSeeded) {
    console.warn("[reprice-unpriced.test] standard pricing rows not seeded/active — apply tests skipped");
  }

  ownerId = (
    await prisma.user.create({ data: { email: `${RUN}-owner@test.local`, role: "BUSINESS" } })
  ).id;
  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Biz`, type: "dental" } })
  ).id;

  mainCallId = (await createUnpricedCall("main")).callId;
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.vapiCall.deleteMany({ where: { businessId } });
  await prisma.agentUsageExecution.deleteMany({ where: { businessId } });
  await prisma.businessUsageInvoice.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe("repriceUnpricedExecutions", () => {
  it("dry-run reports the row as priceable but leaves it UNPRICED with no billing marks", async () => {
    if (!dbAvailable || !pricingSeeded) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const result = await repriceUnpricedExecutions({
      dryRun: true,
      limit: 10,
      executionIds: [mainCallId]
    });

    expect(result.dryRun).toBe(true);
    expect(result.scanned).toBe(1);
    expect(result.priced).toBeGreaterThanOrEqual(1);
    expect(result.items[0]).toMatchObject({ callId: mainCallId, outcome: "priced" });
    expect(result.items[0]?.billedCostMicroUsd ?? 0).toBeGreaterThan(0);
    // Dry-run must not touch the DB row.
    expect(result.stillUnpriced).toBe(1);

    const row = await prisma.vapiCall.findUnique({ where: { callId: mainCallId } });
    expect(row?.pricingState).toBe("UNPRICED");
    expect(row?.billingRecordedAt).toBeNull();
    expect(row?.billedCostMicroUsd).toBeNull();
  });

  it("apply flips UNPRICED→PRICED with line items, billingMonth from endedAt, and a clean snapshot", async () => {
    if (!dbAvailable || !pricingSeeded) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const result = await repriceUnpricedExecutions({
      dryRun: false,
      limit: 10,
      executionIds: [mainCallId]
    });

    expect(result.priced).toBe(1);
    expect(result.stillUnpriced).toBe(0);

    const row = await prisma.vapiCall.findUnique({ where: { callId: mainCallId } });
    expect(row?.pricingState).toBe("PRICED");
    expect(Array.isArray(row?.usageLineItemsJson)).toBe(true);
    expect((row?.usageLineItemsJson as unknown[]).length).toBeGreaterThan(0);
    expect(row?.billingMonth).toBe("2026-06"); // from endedAt, not "now"
    expect(row?.billingRecordedAt).not.toBeNull();
    expect(row?.billedCostMicroUsd ?? 0).toBeGreaterThan(0);
    expect(row?.billedCostMicroUsd).toBe(lineItemsSum(row?.usageLineItemsJson));

    const snapshot = row?.pricingSnapshotJson as Record<string, unknown> | null;
    expect(snapshot?.unpricedReason).toBeNull();
  });

  it("a second apply on the same id is a no-op — the row is no longer UNPRICED", async () => {
    if (!dbAvailable || !pricingSeeded) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const before = await prisma.vapiCall.findUnique({ where: { callId: mainCallId } });
    const result = await repriceUnpricedExecutions({
      dryRun: false,
      limit: 10,
      executionIds: [mainCallId]
    });

    expect(result.scanned).toBe(0);
    expect(result.priced).toBe(0);
    expect(result.stillUnpriced).toBe(0);

    const after = await prisma.vapiCall.findUnique({ where: { callId: mainCallId } });
    expect(after?.billedCostMicroUsd).toBe(before?.billedCostMicroUsd);
    expect(after?.billingRecordedAt?.toISOString()).toBe(before?.billingRecordedAt?.toISOString());
  });

  it("PRICED rows are never selected or modified", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const pricedCallId = newCallId("already-priced");
    await prisma.vapiCall.create({
      data: {
        businessId,
        callId: pricedCallId,
        customerPhone: "+15555550101",
        executionMode: "LIVE",
        status: "end-of-call-report",
        pricingState: "PRICED",
        durationMinutes: 3,
        smsCount: 0,
        billedCostMicroUsd: 12_345,
        billingMonth: "2026-06",
        billingRecordedAt: new Date("2026-06-15T12:30:00.000Z"),
        endedAt: new Date("2026-06-15T12:00:00.000Z")
      }
    });
    const before = await prisma.vapiCall.findUnique({ where: { callId: pricedCallId } });

    const result = await repriceUnpricedExecutions({
      dryRun: false,
      limit: 10,
      executionIds: [pricedCallId]
    });

    expect(result.scanned).toBe(0);
    expect(result.priced).toBe(0);

    const after = await prisma.vapiCall.findUnique({ where: { callId: pricedCallId } });
    expect(after?.billedCostMicroUsd).toBe(12_345);
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
  });

  it("unknown pipeline mapping → skipped with UNKNOWN_USAGE_SERVICE_MAPPING, row stays UNPRICED", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const { callId } = await createUnpricedCall("unknown-pipeline", {
      pricingSnapshotJson: {
        pipeline: {
          llmProvider: "anthropic",
          llmModel: "claude-3",
          transcriberProvider: "deepgram",
          transcriberModel: "nova-3",
          voiceProvider: "elevenlabs",
          voiceModel: "eleven_flash_v2_5"
        }
      }
    });

    const result = await repriceUnpricedExecutions({
      dryRun: false,
      limit: 10,
      executionIds: [callId]
    });

    expect(result.scanned).toBe(1);
    expect(result.priced).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.items[0]).toMatchObject({
      callId,
      outcome: "skipped",
      reason: UNKNOWN_USAGE_SERVICE_MAPPING
    });
    expect(result.stillUnpriced).toBe(1);

    const row = await prisma.vapiCall.findUnique({ where: { callId } });
    expect(row?.pricingState).toBe("UNPRICED");
    expect(row?.billingRecordedAt).toBeNull();
  });

  it("two concurrent applies on one row settle it exactly once — cost never doubles", async () => {
    if (!dbAvailable || !pricingSeeded) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const { callId } = await createUnpricedCall("concurrent");

    const [a, b] = await Promise.all([
      repriceUnpricedExecutions({ dryRun: false, limit: 10, executionIds: [callId] }),
      repriceUnpricedExecutions({ dryRun: false, limit: 10, executionIds: [callId] })
    ]);

    expect(a.priced + b.priced).toBe(1);
    const loser = a.priced === 1 ? b : a;
    // The loser either never saw the row (scanned 0) or lost the CAS (skipped).
    expect(loser.scanned === 0 || loser.skipped >= 1).toBe(true);

    const rows = await prisma.vapiCall.findMany({ where: { callId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pricingState).toBe("PRICED");
    // Single-run expectation: the stored total equals the sum of the row's own
    // frozen line items — a doubled write would break this invariant.
    expect(rows[0]?.billedCostMicroUsd).toBe(lineItemsSum(rows[0]?.usageLineItemsJson));
    const winner = a.priced === 1 ? a : b;
    expect(rows[0]?.billedCostMicroUsd).toBe(winner.items.find((item) => item.outcome === "priced")?.billedCostMicroUsd);
  });
});
