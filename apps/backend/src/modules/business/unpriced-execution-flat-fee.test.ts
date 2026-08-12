import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { recordVapiExecutionUsage } from "./execution-billing";

/**
 * Production failure (2026-08-06 → 08-08): the platform default voice switched
 * to Cartesia before the Cartesia rate mapping/seed existed, so every LIVE call
 * resolved UNPRICED. The UNPRICED branch of recordVapiCallUsage returned before
 * recordVapiExecutionUsage and stamped no billingMonth — so the business saw
 * NO execution, NO charge, and NO invoice line, while Vapi's own dashboard
 * showed the call's cost.
 *
 * The fix records the buyer-facing flat execution fee even when per-hop
 * pipeline pricing fails, and stamps billingMonth so the call is
 * month-addressable. These tests pin the two invariants the fix relies on.
 */

const RUN = `unpriced-fee-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let ownerId = "";
let businessId = "";
let workflowId = "";
let agentId = "";
let freeInstallAgentId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[unpriced-execution-flat-fee.test] database unreachable — suite skipped");
    return;
  }

  ownerId = (
    await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } })
  ).id;
  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Biz`, type: "dental" } })
  ).id;
  workflowId = (
    await prisma.workflowDefinition.create({
      data: { architectUserId: ownerId, name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] } as never }
    })
  ).id;
  agentId = (
    await prisma.installedAgent.create({
      data: {
        businessId,
        workflowId,
        name: `${RUN} agent`,
        status: "ACTIVE",
        executionFeeCents: 500,
        // Past cutover so the execution is billable at the flat fee.
        executionBillingStartedAt: new Date("2026-01-01T00:00:00.000Z")
      }
    })
  ).id;
  freeInstallAgentId = (
    await prisma.installedAgent.create({
      data: {
        businessId,
        workflowId,
        name: `${RUN} free install agent`,
        status: "ACTIVE",
        installSource: "FREE_INSTALL",
        executionFeeCents: 0,
        executionBillingStartedAt: new Date("2026-01-01T00:00:00.000Z")
      }
    })
  ).id;
});

afterAll(async () => {
  if (dbAvailable) {
    await prisma.agentUsageExecution.deleteMany({ where: { installedAgentId: agentId } });
    await prisma.businessUsageInvoice.deleteMany({ where: { businessId } });
    await prisma.vapiCall.deleteMany({ where: { businessId } });
    await prisma.installedAgent.deleteMany({ where: { businessId } });
    await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  }
  await prisma.$disconnect();
});

describe("flat execution fee for calls whose pipeline could not be priced", () => {
  it("records the execution with the flat fee and attaches it to a usage invoice", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");

    const callId = `${RUN}-call-${randomUUID()}`;
    // What the fixed UNPRICED branch does: no usageLineItems — pipeline pricing
    // failed — only the Vapi platform-cost reference.
    const execution = await recordVapiExecutionUsage({
      installedAgentId: agentId,
      callId,
      occurredAt: new Date(),
      actualCostMicroUsd: 123_000
    });

    expect(execution).toBeTruthy();
    // Flat fee: 500 cents = 5_000_000 µUSD — buyers are charged the advertised
    // per-execution price, never a guessed per-service rate.
    expect(execution!.amountMicroUsd).toBe(5_000_000);
    // Invoice attachment is what makes it appear on Billing & Usage + invoices.
    expect(execution!.usageInvoiceId).toBeTruthy();
  });

  it("a later reprice call with line items never double-charges the execution", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");

    const callId = `${RUN}-reprice-${randomUUID()}`;
    const first = await recordVapiExecutionUsage({
      installedAgentId: agentId,
      callId,
      occurredAt: new Date(),
      actualCostMicroUsd: 100_000
    });

    // Admin reprice later resolves the pipeline and calls again WITH line items.
    const second = await recordVapiExecutionUsage({
      installedAgentId: agentId,
      callId,
      occurredAt: new Date(),
      actualCostMicroUsd: 140_000,
      usageLineItems: [
        {
          serviceCode: "cartesia_sonic_2",
          serviceName: "Cartesia Sonic 2",
          unit: "PER_MINUTE",
          quantity: 2,
          unitPriceMicroUsd: 45_000,
          actualCostMicroUsd: 90_000,
          billedCostMicroUsd: 90_000
        } as never
      ]
    });

    // Same canonical row — the dedupe key held.
    expect(second!.id).toBe(first!.id);
    // The already-invoiced flat fee is immutable; only the platform-cost
    // reference may rise. One execution, one charge.
    expect(second!.amountMicroUsd).toBe(first!.amountMicroUsd);
    const rows = await prisma.agentUsageExecution.count({
      where: { installedAgentId: agentId, sourceId: callId }
    });
    expect(rows).toBe(1);
  });

  it("promotes a zero-fee provisional row exactly once when Vapi pricing arrives", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");

    const callId = `${RUN}-free-reprice-${randomUUID()}`;
    const provisional = await recordVapiExecutionUsage({
      installedAgentId: freeInstallAgentId,
      callId,
      occurredAt: new Date(),
      actualCostMicroUsd: 100_000
    });
    expect(provisional).toMatchObject({
      amountMicroUsd: 0,
      billable: false,
      freeReason: "NO_EXECUTION_FEE",
      usageInvoiceId: null
    });

    const pricedLine = {
      serviceCode: "cartesia_sonic_2",
      serviceName: "Cartesia Sonic 2",
      invoiceLabel: "Voice service",
      unit: "PER_MINUTE" as const,
      quantity: 1,
      unitPriceMicroUsd: 340_000,
      billingRateMicroUsd: 340_000,
      actualCostMicroUsd: 100_000,
      billedCostMicroUsd: 340_000
    };
    const promoted = await recordVapiExecutionUsage({
      installedAgentId: freeInstallAgentId,
      callId,
      occurredAt: new Date(),
      actualCostMicroUsd: 100_000,
      usageLineItems: [pricedLine]
    });
    expect(promoted).toMatchObject({
      id: provisional!.id,
      amountMicroUsd: 340_000,
      billable: true,
      freeReason: null
    });
    expect(promoted!.usageInvoiceId).toBeTruthy();

    await recordVapiExecutionUsage({
      installedAgentId: freeInstallAgentId,
      callId,
      occurredAt: new Date(),
      actualCostMicroUsd: 100_000,
      usageLineItems: [pricedLine]
    });
    const invoice = await prisma.businessUsageInvoice.findUnique({
      where: { id: promoted!.usageInvoiceId! },
      include: { lineItems: true, executions: true }
    });
    expect(invoice?.totalMicroUsd).toBe(340_000);
    expect(invoice?.executions).toHaveLength(1);
    expect(invoice?.lineItems.find((item) => item.serviceCode === pricedLine.serviceCode)).toMatchObject({
      quantity: 1,
      amountMicroUsd: 340_000
    });
  });
});

describe("UNPRICED branch source contract", () => {
  /* recordVapiCallUsage takes a full Vapi webhook envelope — pinning the branch
     by source keeps the guarantee without replaying a webhook. If this fails,
     the UNPRICED path regressed to invisible executions. */
  it("stamps billingMonth and records the flat-fee execution before returning", () => {
    const source = readFileSync(
      join(__dirname, "usage-billing.ts"),
      "utf8"
    );
    const unpricedBranch = source.slice(
      source.indexOf('pricingResult.state === "UNPRICED"'),
      source.indexOf('pricingState: "PRICED"')
    );
    expect(unpricedBranch).toContain("billingMonth");
    expect(unpricedBranch).toContain("recordVapiExecutionUsage");
  });
});

describe("model-less Cartesia pipeline completion (production log 2026-08-08)", () => {
  it('completes { hop: "voice", provider: "cartesia", model: null } from platform deploy config', async () => {
    const { completeVoicePipelineModels } = await import("./usage-billing");
    const { resolveApplicableUsageServiceCodes } = await import("../../lib/usage-service-resolver");

    // Exactly what the webhook received in production.
    const reported = {
      orchestrator: "vapi" as const,
      llmProvider: "openai",
      llmModel: "gpt-4o-mini",
      transcriberProvider: "deepgram",
      transcriberModel: "nova-3",
      voiceProvider: "cartesia"
      // voiceModel absent — Vapi does not echo the TTS model back.
    };

    const completed = completeVoicePipelineModels(reported);
    expect(completed.voiceModel).toBe("sonic-2");

    const resolution = resolveApplicableUsageServiceCodes({
      execution: { calendarUsed: false },
      installedAgent: null,
      voicePipeline: completed,
      providerMetadata: { telephonyProvider: "twilio" }
    });
    expect(resolution.state).toBe("RESOLVED");
    if (resolution.state === "RESOLVED") {
      expect(resolution.codes).toContain("cartesia_sonic_2");
    }
  });

  it("providers we do not deploy stay incomplete and therefore UNPRICED — never guessed", async () => {
    const { completeVoicePipelineModels } = await import("./usage-billing");
    const completed = completeVoicePipelineModels({
      orchestrator: "vapi" as const,
      llmProvider: "openai",
      llmModel: "gpt-4o-mini",
      transcriberProvider: "deepgram",
      transcriberModel: "nova-3",
      voiceProvider: "playht"
    });
    expect(completed.voiceModel).toBeUndefined();
  });
});
