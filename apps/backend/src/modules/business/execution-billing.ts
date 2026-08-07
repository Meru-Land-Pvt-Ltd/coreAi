import type { AgentUsageSource, Prisma } from "@prisma/client";
import { env } from "../../config/env";
import {
  buildSpendingAlertEmailHtml,
  isPlatformMailConfigured,
  sendPlatformEmail
} from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import {
  sumLineItems,
  type UsageLineItem
} from "../../lib/usage-pricing";
import { resolveAgentBillingPeriod } from "./agent-payment-scope";

export const DEFAULT_TRIAL_EXECUTION_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MICRO_USD_PER_CENT = 10_000;
export const STRIPE_MINIMUM_CHARGE_MICRO_USD = 50 * MICRO_USD_PER_CENT;

export function usageBalanceIsCollectible(totalMicroUsd: number) {
  return totalMicroUsd >= STRIPE_MINIMUM_CHARGE_MICRO_USD;
}

export function invoiceAttachedExecutions<
  T extends { usageInvoiceId: string | null }
>(executions: T[]) {
  return executions.filter((execution) => execution.usageInvoiceId !== null);
}

export function billingMonthFor(date: Date) {
  return date.toISOString().slice(0, 7);
}

export function monthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  return { start, end };
}

export function monthLabel(month: string) {
  const bounds = monthBounds(month);
  if (!bounds) return month;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(bounds.start);
}

export function canonicalExecutionKey(input: {
  source: AgentUsageSource;
  sourceId: string;
  callProvider?: string | null;
  externalCallId?: string | null;
}) {
  if (input.externalCallId) {
    return `${(input.callProvider || input.source).trim().toUpperCase()}:${input.externalCallId.trim()}`;
  }
  return `${input.source}:${input.sourceId.trim()}`;
}

export function trialEndsAt(trialStartedAt: Date, trialDays: number) {
  return new Date(trialStartedAt.getTime() + Math.max(0, trialDays) * DAY_MS);
}

export function isExecutionInsideTrial(input: {
  occurredAt: Date;
  trialStartedAt: Date | null;
  trialDays: number;
}) {
  if (!input.trialStartedAt || input.trialDays <= 0) return false;
  return (
    input.occurredAt >= input.trialStartedAt &&
    input.occurredAt < trialEndsAt(input.trialStartedAt, input.trialDays)
  );
}

export function trialExecutionDecision(input: {
  insideTrial: boolean;
  executionsUsed: number;
  executionLimit: number;
}) {
  const free =
    input.insideTrial &&
    input.executionLimit > 0 &&
    input.executionsUsed < input.executionLimit;
  return {
    free,
    nextExecutionsUsed: free ? input.executionsUsed + 1 : input.executionsUsed,
    freeReason: free ? "TRIAL_ALLOWANCE" : null
  };
}

export function usageInvoiceNumber(params: {
  businessId: string;
  installedAgentId: string;
  billingMonth: string;
  sequence: number;
}) {
  return [
    "USG",
    params.billingMonth.replace("-", ""),
    params.businessId.slice(-6).toUpperCase(),
    params.installedAgentId.slice(-6).toUpperCase(),
    String(params.sequence).padStart(2, "0")
  ].join("-");
}

type RecordAgentExecutionInput = {
  installedAgentId: string;
  source: AgentUsageSource;
  sourceId: string;
  workflowRunId?: string | null;
  callProvider?: string | null;
  externalCallId?: string | null;
  occurredAt?: Date;
  actualCostMicroUsd?: number | null;
  legacyBilledCostMicroUsd?: number | null;
  usageLineItems?: UsageLineItem[];
  historicalReconciliation?: boolean;
};

export async function sendSpendingAlertIfNeeded(businessId: string, billingMonth: string) {
  if (billingMonth !== billingMonthFor(new Date()) || !isPlatformMailConfigured()) return;

  const [business, usage] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        billingEmail: true,
        spendingAlertEnabled: true,
        spendingAlertThresholdCents: true,
        spendingAlertLastNotifiedMonth: true,
        owner: { select: { email: true, fullName: true } }
      }
    }),
    prisma.agentUsageExecution.aggregate({
      where: { businessId, billingMonth },
      _sum: { amountMicroUsd: true, legacyBilledCostMicroUsd: true }
    })
  ]);

  if (
    !business?.spendingAlertEnabled ||
    business.spendingAlertThresholdCents <= 0 ||
    business.spendingAlertLastNotifiedMonth === billingMonth
  ) {
    return;
  }

  const totalMicroUsd =
    (usage._sum.amountMicroUsd ?? 0) +
    (usage._sum.legacyBilledCostMicroUsd ?? 0);
  const thresholdMicroUsd = business.spendingAlertThresholdCents * MICRO_USD_PER_CENT;
  if (totalMicroUsd < thresholdMicroUsd) return;

  const notifiedAt = new Date();
  const claimed = await prisma.business.updateMany({
    where: {
      id: business.id,
      spendingAlertEnabled: true,
      spendingAlertThresholdCents: business.spendingAlertThresholdCents,
      OR: [
        { spendingAlertLastNotifiedMonth: null },
        { spendingAlertLastNotifiedMonth: { not: billingMonth } }
      ]
    },
    data: {
      spendingAlertLastNotifiedMonth: billingMonth,
      spendingAlertLastNotifiedAt: notifiedAt
    }
  });
  if (claimed.count !== 1) return;

  const totalUsd = (totalMicroUsd / 1_000_000).toFixed(2);
  const thresholdUsd = (business.spendingAlertThresholdCents / 100).toFixed(2);
  const billingUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/business/billingandusage`;
  const recipient = business.billingEmail || business.owner.email;
  const displayName = business.owner.fullName || business.name;

  try {
    await sendPlatformEmail({
      purpose: "billing",
      to: recipient,
      subject: `Monthly execution spending alert: $${totalUsd}`,
      text: `Hi ${displayName}, your ${monthLabel(billingMonth)} agent execution costs are $${totalUsd}, which reached your $${thresholdUsd} alert threshold. Review usage: ${billingUrl}`,
      html: buildSpendingAlertEmailHtml({
        name: displayName,
        billingPeriod: monthLabel(billingMonth),
        totalUsd,
        thresholdUsd,
        billingUrl
      })
    });
  } catch (error) {
    // Release this month's claim when delivery failed so the next qualifying
    // execution can retry instead of silently losing the alert.
    await prisma.business.updateMany({
      where: {
        id: business.id,
        spendingAlertLastNotifiedMonth: billingMonth,
        spendingAlertLastNotifiedAt: notifiedAt
      },
      data: {
        spendingAlertLastNotifiedMonth: null,
        spendingAlertLastNotifiedAt: null
      }
    });
    console.error("[execution-billing] spending alert delivery failed", {
      businessId,
      billingMonth,
      error
    });
  }
}

export async function recordAgentExecutionUsage(input: RecordAgentExecutionInput) {
  const occurredAt = input.occurredAt ?? new Date();
  const billingMonth = billingMonthFor(occurredAt);
  const dedupeKey = canonicalExecutionKey(input);
  const actualCostMicroUsd = Math.max(0, Math.round(input.actualCostMicroUsd ?? 0));
  const pricedUsageLineItems = input.usageLineItems?.filter(
    (item) =>
      item.serviceCode.trim().length > 0 &&
      Number.isFinite(item.quantity) &&
      item.quantity > 0 &&
      Number.isFinite(item.billedCostMicroUsd) &&
      item.billedCostMicroUsd >= 0
  );
  const pricedUsageMicroUsd =
    pricedUsageLineItems === undefined
      ? null
      : sumLineItems(pricedUsageLineItems).billedCostMicroUsd;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-execution:${input.installedAgentId}`}))`;

    const existing = await tx.agentUsageExecution.findUnique({ where: { dedupeKey } });
    if (existing) {
      if (existing.installedAgentId !== input.installedAgentId) {
        throw new Error(
          `Execution key ${dedupeKey} is already owned by installed agent ${existing.installedAgentId}`
        );
      }
      const shouldAttachRun = Boolean(input.workflowRunId && !existing.workflowRunId);
      const shouldUpdateActual = actualCostMicroUsd > existing.actualCostMicroUsd;
      if (!shouldAttachRun && !shouldUpdateActual) return { execution: existing, created: false };

      const updated = await tx.agentUsageExecution.update({
        where: { id: existing.id },
        data: {
          workflowRunId: shouldAttachRun ? input.workflowRunId : undefined,
          actualCostMicroUsd: shouldUpdateActual ? actualCostMicroUsd : undefined
        }
      });
      return { execution: updated, created: false };
    }

    const agent = await tx.installedAgent.findUnique({
      where: { id: input.installedAgentId },
      select: {
        id: true,
        businessId: true,
        listingId: true,
        name: true,
        status: true,
        installSource: true,
        executionFeeCents: true,
        executionBillingStartedAt: true,
        createdAt: true,
        trialExecutionLimit: true,
        trialExecutionsUsed: true,
        business: { select: { ownerId: true } },
        listing: { select: { trialDays: true } }
      }
    });
    if (!agent || agent.installSource === "ARCHITECT_SELF_TEST") return null;

    const trialPayment = agent.listingId
      ? await tx.payment.findFirst({
          where: {
            userId: agent.business.ownerId,
            listingId: agent.listingId,
            AND: [
              {
                OR: [
                  { businessId: agent.businessId },
                  { businessId: null }
                ]
              },
              {
                OR: [
                  { invoiceKind: "TRIAL" },
                  { status: "TRIALING" },
                  { description: { contains: "trial", mode: "insensitive" } }
                ]
              }
            ]
          },
          orderBy: { createdAt: "asc" },
          select: {
            createdAt: true,
            updatedAt: true,
            status: true,
            periodStart: true,
            periodEnd: true
          }
        })
      : null;

    const trialStartedAt =
      trialPayment?.periodStart ?? trialPayment?.createdAt ?? null;
    const immutableTrialEnd =
      trialPayment?.periodEnd ??
      (trialStartedAt
        ? trialEndsAt(trialStartedAt, agent.listing?.trialDays ?? 0)
        : null);
    const insideNaturalTrial = Boolean(
      trialStartedAt &&
        immutableTrialEnd &&
        occurredAt >= trialStartedAt &&
        occurredAt < immutableTrialEnd
    );
    const trialClosedAt =
      trialPayment && trialPayment.status !== "TRIALING"
        ? trialPayment.periodEnd ?? trialPayment.updatedAt
        : null;
    const insideTrial =
      insideNaturalTrial &&
      (!trialClosedAt || occurredAt < trialClosedAt);

    const beforeBillingCutover = occurredAt < agent.executionBillingStartedAt;
    const activityBlocked = ["PAUSED", "SUSPENDED_BILLING"].includes(agent.status.toUpperCase());
    let freeTrialExecution = false;
    if (
      insideTrial &&
      !beforeBillingCutover &&
      !activityBlocked &&
      agent.trialExecutionLimit > 0
    ) {
      const claimed = await tx.installedAgent.updateMany({
        where: {
          id: agent.id,
          trialExecutionsUsed: { lt: agent.trialExecutionLimit }
        },
        data: { trialExecutionsUsed: { increment: 1 } }
      });
      freeTrialExecution = claimed.count === 1;
    }

    const latestExecution = await tx.agentUsageExecution.findFirst({
      where: { installedAgentId: agent.id },
      orderBy: { executionNumber: "desc" },
      select: { executionNumber: true }
    });
    const executionNumber = (latestExecution?.executionNumber ?? 0) + 1;
    // Metered calls are billed from their immutable Admin Pricing snapshots.
    // Non-metered workflow executions retain the listing's per-run fee.
    const unitPriceMicroUsd =
      pricedUsageMicroUsd ??
      Math.max(0, agent.executionFeeCents) * MICRO_USD_PER_CENT;
    const billable =
      !beforeBillingCutover &&
      !activityBlocked &&
      !freeTrialExecution &&
      unitPriceMicroUsd > 0;
    const amountMicroUsd = billable ? unitPriceMicroUsd : 0;
    const legacyBilledCostMicroUsd = beforeBillingCutover
      ? Math.max(0, Math.round(input.legacyBilledCostMicroUsd ?? 0))
      : 0;

    let usageInvoiceId: string | null = null;
    if (billable) {
      const usagePeriod = await resolveAgentBillingPeriod(
        tx,
        {
          id: agent.id,
          businessId: agent.businessId,
          listingId: agent.listingId,
          createdAt: agent.createdAt,
          ownerUserId: agent.business.ownerId
        },
        occurredAt
      );
      const usageBillingMonth = usagePeriod.key;
      let invoice = await tx.businessUsageInvoice.findFirst({
        where: {
          businessId: agent.businessId,
          installedAgentId: agent.id,
          billingMonth: usageBillingMonth,
          periodStart: usagePeriod.start,
          periodEnd: usagePeriod.end,
          status: { in: ["PENDING", "OPEN", "OVERDUE"] },
          paidAt: null,
          closedAt: null
        },
        orderBy: { sequence: "desc" }
      });

      if (!invoice) {
        const latestSegment = await tx.businessUsageInvoice.findFirst({
          where: {
            installedAgentId: agent.id,
            billingMonth: usageBillingMonth
          },
          orderBy: { sequence: "desc" },
          select: { sequence: true }
        });
        const sequence = (latestSegment?.sequence ?? 0) + 1;
        const initialStatus =
          new Date() >= usagePeriod.dueAt ? "OVERDUE" : "PENDING";

        invoice = await tx.businessUsageInvoice.create({
          data: {
            businessId: agent.businessId,
            installedAgentId: agent.id,
            billingMonth: usageBillingMonth,
            sequence,
            invoiceNumber: usageInvoiceNumber({
              businessId: agent.businessId,
              installedAgentId: agent.id,
              billingMonth: usageBillingMonth,
              sequence
            }),
            status: initialStatus,
            periodStart: usagePeriod.start,
            periodEnd: usagePeriod.end,
            issuedAt: occurredAt,
            dueAt: usagePeriod.dueAt,
            graceEndsAt: usagePeriod.graceEndsAt,
            subtotalMicroUsd: 0,
            totalMicroUsd: 0
          }
        });
      }
      usageInvoiceId = invoice.id;

      await tx.businessUsageInvoice.update({
        where: { id: invoice.id },
        data: {
          subtotalMicroUsd: { increment: amountMicroUsd },
          totalMicroUsd: { increment: amountMicroUsd }
        }
      });
      if (pricedUsageLineItems !== undefined) {
        for (const item of pricedUsageLineItems) {
          const amount = Math.max(0, Math.round(item.billedCostMicroUsd));
          await tx.businessUsageInvoiceLineItem.upsert({
            where: {
              invoiceId_serviceCode: {
                invoiceId: invoice.id,
                serviceCode: item.serviceCode
              }
            },
            update: {
              quantity: { increment: item.quantity },
              amountMicroUsd: { increment: amount }
            },
            create: {
              invoiceId: invoice.id,
              serviceCode: item.serviceCode,
              // Persist the customer-facing Admin Invoice label, never the
              // internal provider/service name.
              serviceName:
                item.invoiceLabel?.trim() || "Usage service",
              unit: item.unit,
              quantity: item.quantity,
              unitPriceMicroUsd: Math.max(
                0,
                Math.round(item.billingRateMicroUsd ?? 0)
              ),
              amountMicroUsd: amount
            }
          });
        }
      } else {
        await tx.businessUsageInvoiceLineItem.upsert({
          where: {
            invoiceId_serviceCode: {
              invoiceId: invoice.id,
              serviceCode: "agent_execution"
            }
          },
          update: {
            quantity: { increment: 1 },
            amountMicroUsd: { increment: amountMicroUsd }
          },
          create: {
            invoiceId: invoice.id,
            serviceCode: "agent_execution",
            serviceName: "Usage service",
            unit: "PER_UNIT",
            quantity: 1,
            unitPriceMicroUsd,
            amountMicroUsd
          }
        });
      }
    }

    const execution = await tx.agentUsageExecution.create({
      data: {
        businessId: agent.businessId,
        installedAgentId: agent.id,
        workflowRunId: input.workflowRunId ?? null,
        usageInvoiceId,
        dedupeKey,
        source: input.source,
        sourceId: input.sourceId,
        billingMonth,
        occurredAt,
        executionNumber,
        trialExecution: insideTrial,
        billable,
        freeReason: freeTrialExecution
          ? "TRIAL_ALLOWANCE"
          : activityBlocked
            ? "SUSPENDED_ACTIVITY"
          : beforeBillingCutover
            ? "LEGACY_HISTORY"
          : unitPriceMicroUsd === 0
            ? "NO_EXECUTION_FEE"
            : null,
        unitPriceMicroUsd,
        amountMicroUsd,
        actualCostMicroUsd,
        legacyBilledCostMicroUsd
      }
    });
    return { execution, created: true };
  });

  if (result?.created && result.execution.amountMicroUsd > 0) {
    void sendSpendingAlertIfNeeded(result.execution.businessId, result.execution.billingMonth);
  }
  return result?.execution ?? null;
}

export async function recordWorkflowRunUsage(workflowRunId: string) {
  const run = await prisma.workflowRun.findUnique({
    where: { id: workflowRunId },
    select: {
      id: true,
      installedAgentId: true,
      mode: true,
      status: true,
      createdAt: true,
      finishedAt: true,
      totalCostCents: true,
      callProvider: true,
      externalCallId: true
    }
  });
  if (
    !run?.installedAgentId ||
    run.mode !== "LIVE" ||
    run.status !== "COMPLETED"
  ) {
    return null;
  }

  const source: AgentUsageSource =
    run.callProvider?.toUpperCase() === "VAPI" ? "VAPI" : "WORKFLOW";
  // A Vapi run is not billable until its end-of-call pricing snapshot has
  // settled. Recording it here would create the old generic per-run charge
  // before duration/SMS/service usage is known.
  if (source === "VAPI") return null;

  return recordAgentExecutionUsage({
    installedAgentId: run.installedAgentId,
    source,
    sourceId: run.externalCallId || run.id,
    workflowRunId: run.id,
    callProvider: run.callProvider,
    externalCallId: run.externalCallId,
    occurredAt: run.finishedAt ?? run.createdAt,
    actualCostMicroUsd: Math.max(0, run.totalCostCents ?? 0) * MICRO_USD_PER_CENT
  });
}

export async function recordVapiExecutionUsage(input: {
  installedAgentId: string;
  callId: string;
  occurredAt: Date;
  actualCostMicroUsd?: number | null;
  usageLineItems?: UsageLineItem[];
}) {
  return recordAgentExecutionUsage({
    installedAgentId: input.installedAgentId,
    source: "VAPI",
    sourceId: input.callId,
    callProvider: "VAPI",
    externalCallId: input.callId,
    occurredAt: input.occurredAt,
    actualCostMicroUsd: input.actualCostMicroUsd,
    usageLineItems: input.usageLineItems
  });
}

/**
 * Backfills canonical rows for historical LIVE completed runs/calls. Hooks
 * record new events immediately; reconciliation makes old real data visible
 * and is idempotent through canonical dedupe keys.
 */
export async function reconcileBusinessExecutionUsage(
  businessId: string,
  billingMonth: string,
  options: { since?: Date } = {}
) {
  const bounds = monthBounds(billingMonth);
  if (!bounds) return { considered: 0, recorded: 0 };

  const [runs, calls] = await Promise.all([
    prisma.workflowRun.findMany({
      where: {
        businessId,
        mode: "LIVE",
        status: "COMPLETED",
        installedAgentId: { not: null },
        finishedAt: {
          not: null,
          lt: bounds.end,
          ...(options.since ? { gte: options.since } : {})
        }
      },
      select: {
        id: true,
        installedAgentId: true,
        callProvider: true,
        externalCallId: true,
        createdAt: true,
        finishedAt: true,
        totalCostCents: true
      }
    }),
    prisma.vapiCall.findMany({
      where: {
        businessId,
        executionMode: "LIVE",
        installedAgentId: { not: null },
        OR: [
          {
            billingRecordedAt: {
              not: null,
              lt: bounds.end,
              ...(options.since ? { gte: options.since } : {})
            }
          },
          {
            endedAt: {
              not: null,
              lt: bounds.end,
              ...(options.since ? { gte: options.since } : {})
            }
          }
        ]
      },
      select: {
        callId: true,
        installedAgentId: true,
        createdAt: true,
        endedAt: true,
        billingRecordedAt: true,
        actualCostMicroUsd: true,
        billedCostMicroUsd: true,
        usageLineItemsJson: true
      }
    })
  ]);

  type Candidate = RecordAgentExecutionInput & { occurredAt: Date };
  const candidates = new Map<string, Candidate>();
  for (const call of calls) {
    if (!call.installedAgentId) continue;
    const occurredAt = call.endedAt ?? call.billingRecordedAt;
    if (!occurredAt || occurredAt >= bounds.end) continue;
    const candidate: Candidate = {
      installedAgentId: call.installedAgentId,
      source: "VAPI",
      sourceId: call.callId,
      callProvider: "VAPI",
      externalCallId: call.callId,
      occurredAt,
      actualCostMicroUsd: call.actualCostMicroUsd,
      legacyBilledCostMicroUsd: call.billedCostMicroUsd,
      usageLineItems: Array.isArray(call.usageLineItemsJson)
        ? (call.usageLineItemsJson as unknown as UsageLineItem[])
        : undefined,
      historicalReconciliation: true
    };
    candidates.set(canonicalExecutionKey(candidate), candidate);
  }
  for (const run of runs) {
    if (!run.installedAgentId) continue;
    const source: AgentUsageSource =
      run.callProvider?.toUpperCase() === "VAPI" ? "VAPI" : "WORKFLOW";
    const candidate: Candidate = {
      installedAgentId: run.installedAgentId,
      source,
      sourceId: run.externalCallId || run.id,
      workflowRunId: run.id,
      callProvider: run.callProvider,
      externalCallId: run.externalCallId,
      occurredAt: run.finishedAt ?? run.createdAt,
      actualCostMicroUsd:
        Math.max(0, run.totalCostCents ?? 0) * MICRO_USD_PER_CENT,
      legacyBilledCostMicroUsd:
        Math.max(0, run.totalCostCents ?? 0) * MICRO_USD_PER_CENT,
      historicalReconciliation: true
    };
    const key = canonicalExecutionKey(candidate);
    const existing = candidates.get(key);
    candidates.set(key, {
      ...existing,
      ...candidate,
      actualCostMicroUsd: Math.max(
        existing?.actualCostMicroUsd ?? 0,
        candidate.actualCostMicroUsd ?? 0
      ),
      legacyBilledCostMicroUsd: Math.max(
        existing?.legacyBilledCostMicroUsd ?? 0,
        candidate.legacyBilledCostMicroUsd ?? 0
      )
    });
  }

  let recorded = 0;
  const ordered = [...candidates.values()].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime()
  );
  for (const candidate of ordered) {
    const before = await prisma.agentUsageExecution.findUnique({
      where: { dedupeKey: canonicalExecutionKey(candidate) },
      select: { id: true }
    });
    const result = await recordAgentExecutionUsage(candidate);
    if (!before && result) recorded += 1;
  }

  return { considered: ordered.length, recorded };
}

export function normalizeUsageInvoiceStatus(status: string) {
  return status.toUpperCase() === "OPEN" ? "PENDING" : status.toUpperCase();
}

export type ExecutionRollupRow = {
  installedAgentId: string;
  executionCount: number;
  billableExecutions: number;
  freeTrialExecutions: number;
  totalMicroUsd: number;
  actualCostMicroUsd: number;
  legacyBilledCostMicroUsd: number;
  displayCostMicroUsd: number;
};

export function rollupExecutions(
  executions: Array<{
    installedAgentId: string;
    billable: boolean;
    freeReason: string | null;
    amountMicroUsd: number;
    actualCostMicroUsd: number;
    legacyBilledCostMicroUsd: number;
  }>
) {
  const rows = new Map<string, ExecutionRollupRow>();
  for (const execution of executions) {
    const row = rows.get(execution.installedAgentId) ?? {
      installedAgentId: execution.installedAgentId,
      executionCount: 0,
      billableExecutions: 0,
      freeTrialExecutions: 0,
      totalMicroUsd: 0,
      actualCostMicroUsd: 0,
      legacyBilledCostMicroUsd: 0,
      displayCostMicroUsd: 0
    };
    row.executionCount += 1;
    if (execution.billable) row.billableExecutions += 1;
    if (execution.freeReason === "TRIAL_ALLOWANCE") row.freeTrialExecutions += 1;
    row.totalMicroUsd += execution.amountMicroUsd;
    row.actualCostMicroUsd += execution.actualCostMicroUsd;
    row.legacyBilledCostMicroUsd += execution.legacyBilledCostMicroUsd;
    row.displayCostMicroUsd +=
      execution.amountMicroUsd + execution.legacyBilledCostMicroUsd;
    rows.set(execution.installedAgentId, row);
  }
  return rows;
}

export type UsageInvoiceStatusInput = Prisma.BusinessUsageInvoiceGetPayload<{
  select: { status: true };
}>["status"];
