/**
 * UNPRICED executions still COUNT as executions (real local DB; suite skips
 * when unreachable): an UNPRICED call gets a provisional AgentUsageExecution
 * row at webhook time (flat fee only), so it counts exactly like a PRICED one
 * — pricingState never gates the canonical ledger, and SMS rows are usage
 * components, not executions.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { countDistinctExecutions } from "./execution-ledger";

const RUN = `ledger-unpriced-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let ownerId = "";
let businessId = "";
let agentId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[execution-ledger-unpriced.test] database unreachable — suite skipped");
    return;
  }

  ownerId = (
    await prisma.user.create({ data: { email: `${RUN}-owner@test.local`, role: "BUSINESS" } })
  ).id;
  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Biz`, type: "salon" } })
  ).id;

  const workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, architectUserId: ownerId, workflowJson: { nodes: [], edges: [] } }
    })
  ).id;
  agentId = (
    await prisma.installedAgent.create({
      data: { businessId, workflowId, name: `${RUN} agent` }
    })
  ).id;

  const pricedCallId = `${RUN}-priced-${randomUUID()}`;
  const unpricedCallId = `${RUN}-unpriced-${randomUUID()}`;
  await prisma.vapiCall.createMany({
    data: [
      {
        businessId,
        installedAgentId: agentId,
        callId: pricedCallId,
        customerPhone: "+15555550120",
        executionMode: "LIVE",
        pricingState: "PRICED",
        billedCostMicroUsd: 100_000,
        billingRecordedAt: new Date()
      },
      {
        businessId,
        installedAgentId: agentId,
        callId: unpricedCallId,
        customerPhone: "+15555550121",
        executionMode: "LIVE",
        pricingState: "UNPRICED"
      }
    ]
  });
  // Both calls have canonical ledger rows: PRICED with its usage amount,
  // UNPRICED with the provisional flat-fee-only row the webhook records.
  const now = new Date();
  await prisma.agentUsageExecution.createMany({
    data: [
      {
        businessId,
        installedAgentId: agentId,
        dedupeKey: `VAPI:${pricedCallId}`,
        source: "VAPI",
        sourceId: pricedCallId,
        billingMonth: now.toISOString().slice(0, 7),
        occurredAt: now,
        executionNumber: 1,
        billable: true,
        unitPriceMicroUsd: 100_000,
        amountMicroUsd: 100_000
      },
      {
        businessId,
        installedAgentId: agentId,
        dedupeKey: `VAPI:${unpricedCallId}`,
        source: "VAPI",
        sourceId: unpricedCallId,
        billingMonth: now.toISOString().slice(0, 7),
        occurredAt: now,
        executionNumber: 2,
        billable: false,
        freeReason: "NO_EXECUTION_FEE",
        unitPriceMicroUsd: 0,
        amountMicroUsd: 0
      }
    ]
  });
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.smsExecution.deleteMany({ where: { businessId } });
  await prisma.vapiCall.deleteMany({ where: { businessId } });
  await prisma.agentUsageExecution.deleteMany({ where: { businessId } });
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { name: `${RUN} wf` } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe("execution ledger and pricing state", () => {
  it("counts UNPRICED LIVE calls as executions alongside PRICED ones", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    expect(await countDistinctExecutions({ businessId })).toBe(2);
  });

  it("an SmsExecution row never changes the execution count", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    await prisma.smsExecution.create({
      data: {
        businessId,
        toPhone: "+15555550122",
        body: `${RUN} sms`,
        status: "SENT",
        messageSid: `${RUN}-sid-1`,
        dedupeKey: `${RUN}-dedupe-1`,
        messageType: "WORKFLOW_SMS"
      }
    });
    expect(await countDistinctExecutions({ businessId })).toBe(2);
  });
});
