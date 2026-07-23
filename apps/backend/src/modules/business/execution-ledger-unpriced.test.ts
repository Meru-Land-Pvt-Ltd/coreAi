/**
 * UNPRICED executions still COUNT as executions (real local DB; suite skips
 * when unreachable): the countable rule filters on executionMode LIVE only —
 * pricingState never gates the ledger, and SMS rows are usage components, not
 * executions.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { countDistinctExecutions } from "./execution-ledger";

const RUN = `ledger-unpriced-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let ownerId = "";
let businessId = "";

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

  await prisma.vapiCall.createMany({
    data: [
      {
        businessId,
        callId: `${RUN}-priced-${randomUUID()}`,
        customerPhone: "+15555550120",
        executionMode: "LIVE",
        pricingState: "PRICED",
        billedCostMicroUsd: 100_000,
        billingRecordedAt: new Date()
      },
      {
        businessId,
        callId: `${RUN}-unpriced-${randomUUID()}`,
        customerPhone: "+15555550121",
        executionMode: "LIVE",
        pricingState: "UNPRICED"
      }
    ]
  });
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.smsExecution.deleteMany({ where: { businessId } });
  await prisma.vapiCall.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe("execution ledger and pricing state", () => {
  it("counts UNPRICED LIVE calls as executions alongside PRICED ones", async () => {
    if (!dbAvailable) return;
    expect(await countDistinctExecutions({ businessId })).toBe(2);
  });

  it("an SmsExecution row never changes the execution count", async () => {
    if (!dbAvailable) return;
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
