import { describe, expect, it } from "vitest";
import {
  canonicalExecutionKey,
  invoiceAttachedExecutions,
  normalizeUsageInvoiceStatus,
  rollupExecutions,
  trialExecutionDecision,
  usageBalanceIsCollectible
} from "./execution-billing";

describe("canonical execution billing", () => {
  it("deduplicates a workflow run and provider event using the external call id", () => {
    expect(
      canonicalExecutionKey({
        source: "WORKFLOW",
        sourceId: "run-1",
        callProvider: "vapi",
        externalCallId: "call-1"
      })
    ).toBe(
      canonicalExecutionKey({
        source: "VAPI",
        sourceId: "call-1",
        callProvider: "VAPI",
        externalCallId: "call-1"
      })
    );
  });

  it("makes exactly executions 1 through 50 free during trial", () => {
    const execution50 = trialExecutionDecision({
      insideTrial: true,
      executionsUsed: 49,
      executionLimit: 50
    });
    const execution51 = trialExecutionDecision({
      insideTrial: true,
      executionsUsed: execution50.nextExecutionsUsed,
      executionLimit: 50
    });

    expect(execution50).toMatchObject({
      free: true,
      nextExecutionsUsed: 50,
      freeReason: "TRIAL_ALLOWANCE"
    });
    expect(execution51).toMatchObject({
      free: false,
      nextExecutionsUsed: 50,
      freeReason: null
    });
  });

  it("normalizes legacy OPEN invoices and rolls canonical execution totals", () => {
    expect(normalizeUsageInvoiceStatus("open")).toBe("PENDING");
    const rollup = rollupExecutions([
      {
        installedAgentId: "agent-1",
        billable: false,
        freeReason: "TRIAL_ALLOWANCE",
        amountMicroUsd: 0,
        actualCostMicroUsd: 50_000,
        legacyBilledCostMicroUsd: 0
      },
      {
        installedAgentId: "agent-1",
        billable: true,
        freeReason: null,
        amountMicroUsd: 250_000,
        actualCostMicroUsd: 75_000,
        legacyBilledCostMicroUsd: 0
      }
    ]).get("agent-1");

    expect(rollup).toMatchObject({
      executionCount: 2,
      billableExecutions: 1,
      freeTrialExecutions: 1,
      totalMicroUsd: 250_000,
      actualCostMicroUsd: 125_000,
      displayCostMicroUsd: 250_000
    });
  });

  it("carries balances below Stripe's minimum until their aggregate is collectible", () => {
    expect(usageBalanceIsCollectible(499_999)).toBe(false);
    expect(usageBalanceIsCollectible(500_000)).toBe(true);
  });

  it("uses only invoice-attached executions on billing-facing screens", () => {
    const executions = Array.from({ length: 22 }, (_, index) => ({
      id: `execution-${index + 1}`,
      usageInvoiceId: index < 17 ? "invoice-1" : null
    }));

    expect(invoiceAttachedExecutions(executions)).toHaveLength(17);
  });
});
