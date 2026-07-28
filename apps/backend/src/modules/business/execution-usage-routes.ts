import type { Context } from "hono";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import {
  attachOrReusePaymentMethod,
  getStripeClient,
  isStripeConfigured
} from "../payments/stripe";
import {
  billingMonthFor,
  MICRO_USD_PER_CENT,
  monthBounds,
  monthLabel,
  normalizeUsageInvoiceStatus,
  rollupExecutions,
  usageBalanceIsCollectible
} from "./execution-billing";
import { restoreBusinessAfterBillingPayment } from "./billing-cycle";
import { resolvePrimaryBusinessId } from "./primary-business";
import { countStandaloneBillableSms } from "./usage-billing";
import type { UsageLineItem } from "../../lib/usage-pricing";
import {
  customerFacingUsageLineItems,
  repriceUsageInvoiceLineItems,
  rollupCustomerUsageLineItems,
  rollupRecordedUsageLineItems,
  usageInvoiceBillingRateMicroUsd,
  usageInvoiceServiceUsesSnapshotPrice,
  type UsageInvoiceBillingCostMap,
  type UsageInvoiceLabelMap
} from "./usage-invoice-line-items";

function microUsdToUsd(value: number) {
  return value / 1_000_000;
}

function serializeAvailableMonths(months: Iterable<string>) {
  return [...new Set(months)]
    .filter((month) => monthBounds(month))
    .sort((left, right) => right.localeCompare(left))
    .map((value) => {
      const [year, month] = value.split("-").map(Number);
      return { value, label: monthLabel(value), year, month };
    });
}

async function loadOwnedBusiness(ownerId: string) {
  const id = await resolvePrimaryBusinessId(ownerId);
  if (!id) return null;
  return prisma.business.findFirst({
    where: { id, ownerId },
    select: {
      id: true,
      name: true,
      stripeCustomerId: true,
      installedAgents: {
        where: { installSource: { not: "ARCHITECT_SELF_TEST" } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          listingId: true,
          name: true,
          status: true,
          executionFeeCents: true,
          trialExecutionLimit: true,
          trialExecutionsUsed: true,
          createdAt: true,
          listing: {
            select: {
              iconUrl: true,
              pricingModel: true,
              trialDays: true
            }
          }
        }
      }
    }
  });
}

export async function getBusinessExecutionUsage(c: Context) {
  const authUser = c.get("authUser");
  const requestedMonth = (c.req.query("month") ?? "").trim();
  const month = requestedMonth || billingMonthFor(new Date());
  const selectedBounds = monthBounds(month);
  if (!selectedBounds) {
    return errorResponse(c, "Month must use YYYY-MM format", 422, "INVALID_BILLING_MONTH");
  }

  const business = await loadOwnedBusiness(authUser.id);
  if (!business) {
    const availableMonths = serializeAvailableMonths([billingMonthFor(new Date())]);
    return successResponse(c, {
      month,
      monthLabel: monthLabel(month),
      availableMonths,
      businessId: null,
      totalExecutions: 0,
      totalCalls: 0,
      totalDurationMinutes: 0,
      totalActualUsd: 0,
      totalBilledUsd: 0,
      totalCostUsd: 0,
      totalCostCents: 0,
      averageCostPerExecutionUsd: 0,
      averageCostPerCustomerInteractionUsd: 0,
      updatedAt: null,
      standaloneSms: { count: 0 },
      agentRollup: [],
      serviceRollup: [],
      executions: [],
      calls: []
    });
  }

  const [
    executions,
    calls,
    executionMonths,
    invoiceMonths,
    standaloneSmsCount,
    usageServices
  ] = await Promise.all([
    prisma.agentUsageExecution.findMany({
      where: { businessId: business.id, billingMonth: month },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        installedAgentId: true,
        workflowRunId: true,
        source: true,
        sourceId: true,
        dedupeKey: true,
        occurredAt: true,
        executionNumber: true,
        trialExecution: true,
        billable: true,
        freeReason: true,
        unitPriceMicroUsd: true,
        amountMicroUsd: true,
        actualCostMicroUsd: true,
        legacyBilledCostMicroUsd: true,
        usageInvoiceId: true
      }
    }),
    prisma.vapiCall.findMany({
      where: {
        businessId: business.id,
        executionMode: "LIVE",
        billingMonth: month,
        billingRecordedAt: { not: null }
      },
      orderBy: { billingRecordedAt: "desc" },
      select: {
        callId: true,
        customerPhone: true,
        installedAgentId: true,
        durationMinutes: true,
        durationSeconds: true,
        usageLineItemsJson: true,
        billingRecordedAt: true,
        recordingUrl: true
      }
    }),
    prisma.agentUsageExecution.findMany({
      where: { businessId: business.id },
      distinct: ["billingMonth"],
      select: { billingMonth: true }
    }),
    prisma.businessUsageInvoice.findMany({
      where: { businessId: business.id },
      distinct: ["billingMonth"],
      select: { billingMonth: true }
    }),
    // Provider-accepted customer SMS with NO provable voice-execution link —
    // business-period SMS usage, reported separately so it is neither
    // discarded nor falsely attached to a call execution.
    countStandaloneBillableSms(business.id, selectedBounds),
    prisma.platformUsageService.findMany({
      select: {
        code: true,
        role: true,
        unit: true,
        updatedCostMicroUsd: true,
        isActive: true
      }
    })
  ]);
  const invoiceLabels: UsageInvoiceLabelMap = new Map(
    usageServices.map((service) => [service.code, service.role])
  );
  const invoiceBillingCosts: UsageInvoiceBillingCostMap = new Map(
    usageServices
      .filter((service) => service.isActive)
      .map((service) => [
        service.code,
        {
          unit: service.unit,
          billingCostMicroUsd: service.updatedCostMicroUsd
        }
      ])
  );

  const agentsById = new Map(business.installedAgents.map((agent) => [agent.id, agent]));
  const agentsForMonth = business.installedAgents.filter(
    (agent) => agent.createdAt < selectedBounds.end
  );
  const statsByAgent = rollupExecutions(executions);
  const chargedCallIds = new Set(
    executions
      .filter(
        (execution) =>
          execution.source === "VAPI" &&
          execution.amountMicroUsd + execution.legacyBilledCostMicroUsd > 0
      )
      .map((execution) => execution.sourceId)
  );
  const callDurationByAgent = new Map<string, number>();
  for (const call of calls) {
    if (!call.installedAgentId) continue;
    callDurationByAgent.set(
      call.installedAgentId,
      (callDurationByAgent.get(call.installedAgentId) ?? 0) + (call.durationMinutes ?? 0)
    );
  }

  // Start from installed agents, not execution rows, so a just-purchased agent
  // appears immediately with zero executions.
  const agentRollup = agentsForMonth.map((agent) => {
    const stats = statsByAgent.get(agent.id) ?? {
      installedAgentId: agent.id,
      executionCount: 0,
      billableExecutions: 0,
      freeTrialExecutions: 0,
      totalMicroUsd: 0,
      actualCostMicroUsd: 0,
      legacyBilledCostMicroUsd: 0,
      displayCostMicroUsd: 0
    };
    const recordedLineItemGroups = calls
      .filter(
        (call) =>
          call.installedAgentId === agent.id &&
          chargedCallIds.has(call.callId) &&
          Array.isArray(call.usageLineItemsJson)
      )
      .map(
        (call) => call.usageLineItemsJson as unknown as UsageLineItem[]
      );
    const detailedServiceCosts = rollupRecordedUsageLineItems(
      recordedLineItemGroups
    ).map((service) => ({
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      unit: service.unit,
      quantity: service.quantity,
      unitPriceUsd:
        (usageInvoiceBillingRateMicroUsd(service) ?? 0) / 1_000_000,
      billedCostUsd: microUsdToUsd(service.billedCostMicroUsd),
      amountCents: Math.round(
        service.billedCostMicroUsd / MICRO_USD_PER_CENT
      )
    }));
    const repricedInvoiceServices = rollupCustomerUsageLineItems(
      recordedLineItemGroups.map((items) =>
        repriceUsageInvoiceLineItems(items, invoiceBillingCosts)
      ),
      invoiceLabels
    );
    const invoiceBilledCostMicroUsd =
      repricedInvoiceServices.length > 0
        ? repricedInvoiceServices.reduce(
            (sum, service) => sum + service.billedCostMicroUsd,
            0
          )
        : stats.displayCostMicroUsd;
    const billedCostUsd = microUsdToUsd(invoiceBilledCostMicroUsd);
    const invoiceServiceCosts = repricedInvoiceServices.map((service) => ({
      serviceCode: service.serviceCode,
      serviceName: service.invoiceLabel ?? service.serviceName,
      invoiceLabel: service.invoiceLabel ?? service.serviceName,
      unit: service.unit,
      quantity: service.quantity,
      unitPriceUsd:
        (usageInvoiceBillingRateMicroUsd(service) ?? 0) / 1_000_000,
      billedCostUsd: microUsdToUsd(service.billedCostMicroUsd),
      amountCents: Math.round(
        service.billedCostMicroUsd / MICRO_USD_PER_CENT
      )
    }));
    return {
      agentId: agent.id,
      installedAgentId: agent.id,
      listingId: agent.listingId,
      agentName: agent.name,
      name: agent.name,
      iconUrl: agent.listing?.iconUrl ?? null,
      status: agent.status,
      acquiredAt: agent.createdAt.toISOString(),
      purchasedAt: agent.createdAt.toISOString(),
      executionFeeCents: agent.executionFeeCents,
      executionFeeUsd: agent.executionFeeCents / 100,
      executionCount: stats.executionCount,
      callCount: stats.executionCount,
      billableExecutions: stats.billableExecutions,
      freeTrialExecutions: stats.freeTrialExecutions,
      durationMinutes: callDurationByAgent.get(agent.id) ?? 0,
      billedCostMicroUsd: invoiceBilledCostMicroUsd,
      billedCostUsd,
      amountCents: Math.round(
        invoiceBilledCostMicroUsd / MICRO_USD_PER_CENT
      ),
      actualCostMicroUsd: stats.actualCostMicroUsd,
      actualCostUsd: microUsdToUsd(stats.actualCostMicroUsd),
      averageCostPerExecutionUsd:
        stats.executionCount > 0 ? billedCostUsd / stats.executionCount : 0,
      trialExecutionLimit: agent.trialExecutionLimit,
      trialExecutionsUsed: agent.trialExecutionsUsed,
      trialExecutionsRemaining: Math.max(
        0,
        agent.trialExecutionLimit - agent.trialExecutionsUsed
      ),
      recordedServiceCosts: detailedServiceCosts,
      serviceCosts: invoiceServiceCosts,
      invoiceServiceCosts
    };
  });

  const totalMicroUsd = agentRollup.reduce(
    (sum, agent) => sum + agent.billedCostMicroUsd,
    0
  );
  const totalActualMicroUsd = executions.reduce(
    (sum, row) => sum + row.actualCostMicroUsd,
    0
  );
  const totalDurationMinutes = calls.reduce(
    (sum, call) => sum + (call.durationMinutes ?? 0),
    0
  );
  const totalExecutions = executions.length;
  const totalCostUsd = microUsdToUsd(totalMicroUsd);
  const executionByCallId = new Map(
    executions
      .filter((execution) => execution.source === "VAPI")
      .map((execution) => [execution.sourceId, execution])
  );
  const availableMonths = serializeAvailableMonths([
    billingMonthFor(new Date()),
    month,
    ...executionMonths.map((item) => item.billingMonth),
    ...invoiceMonths.map((item) => item.billingMonth)
  ]);

  return successResponse(c, {
    month,
    monthLabel: monthLabel(month),
    availableMonths,
    businessId: business.id,
    businessName: business.name,
    totalExecutions,
    totalCalls: totalExecutions,
    totalDurationMinutes,
    totalActualUsd: microUsdToUsd(totalActualMicroUsd),
    totalBilledUsd: totalCostUsd,
    totalCostUsd,
    totalCostCents: Math.round(totalMicroUsd / MICRO_USD_PER_CENT),
    averageCostPerExecutionUsd:
      totalExecutions > 0 ? totalCostUsd / totalExecutions : 0,
    averageCostPerCustomerInteractionUsd:
      totalExecutions > 0 ? totalCostUsd / totalExecutions : 0,
    updatedAt: executions[0]?.occurredAt.toISOString() ?? null,
    standaloneSms: { count: standaloneSmsCount },
    agentRollup,
    serviceRollup: rollupRecordedUsageLineItems(
      calls
        .filter(
          (call) =>
            chargedCallIds.has(call.callId) &&
            Array.isArray(call.usageLineItemsJson)
        )
        .map((call) =>
          repriceUsageInvoiceLineItems(
            call.usageLineItemsJson as unknown as UsageLineItem[],
            invoiceBillingCosts
          )
        )
    ).map((service) => ({
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      unit: service.unit,
      quantity: service.quantity,
      billedCostMicroUsd: service.billedCostMicroUsd,
      billedCostUsd: microUsdToUsd(service.billedCostMicroUsd),
      amountCents: Math.round(
        service.billedCostMicroUsd / MICRO_USD_PER_CENT
      )
    })),
    executions: executions.map((execution) => ({
      id: execution.id,
      installedAgentId: execution.installedAgentId,
      agentName: agentsById.get(execution.installedAgentId)?.name ?? "Agent",
      workflowRunId: execution.workflowRunId,
      source: execution.source,
      sourceId: execution.sourceId,
      occurredAt: execution.occurredAt.toISOString(),
      executionNumber: execution.executionNumber,
      trialExecution: execution.trialExecution,
      billable: execution.billable,
      freeReason: execution.freeReason,
      executionFeeCents: Math.round(execution.unitPriceMicroUsd / MICRO_USD_PER_CENT),
      amountCents: Math.round(execution.amountMicroUsd / MICRO_USD_PER_CENT),
      amountUsd: microUsdToUsd(
        execution.amountMicroUsd + execution.legacyBilledCostMicroUsd
      ),
      legacyBilledCostUsd: microUsdToUsd(execution.legacyBilledCostMicroUsd),
      usageInvoiceId: execution.usageInvoiceId
    })),
    calls: calls.map((call) => {
      const execution = executionByCallId.get(call.callId);
      const repricedCallMicroUsd =
        execution &&
        chargedCallIds.has(call.callId) &&
        Array.isArray(call.usageLineItemsJson)
          ? repriceUsageInvoiceLineItems(
              call.usageLineItemsJson as unknown as UsageLineItem[],
              invoiceBillingCosts
            ).reduce(
              (sum, item) => sum + item.billedCostMicroUsd,
              0
            )
          : execution?.amountMicroUsd ?? 0;
      return {
        callId: call.callId,
        customerPhone: call.customerPhone,
        installedAgentId: call.installedAgentId,
        durationMinutes: call.durationMinutes,
        durationSeconds: call.durationSeconds,
        billedCostUsd: microUsdToUsd(repricedCallMicroUsd),
        amountCents: Math.round(
          repricedCallMicroUsd / MICRO_USD_PER_CENT
        ),
        recordedAt: call.billingRecordedAt?.toISOString() ?? null,
        recordingUrl: call.recordingUrl ?? null
      };
    })
  });
}

function legacyAgentBreakdown(
  calls: Array<{
    callId?: string;
    installedAgentId: string | null;
    durationMinutes: number | null;
    billedCostMicroUsd: number | null;
    usageLineItemsJson?: unknown;
  }>,
  agentNames: Map<string, string>,
  invoiceLabels: UsageInvoiceLabelMap,
  invoiceBillingCosts: UsageInvoiceBillingCostMap
) {
  const rows = new Map<
    string,
    {
      agentId: string | null;
      installedAgentId: string | null;
      agentName: string;
      executionCount: number;
      durationMinutes: number;
      totalMicroUsd: number;
    }
  >();
  for (const call of calls) {
    const key = call.installedAgentId ?? "legacy-unassigned";
    const row = rows.get(key) ?? {
      agentId: call.installedAgentId,
      installedAgentId: call.installedAgentId,
      agentName: call.installedAgentId
        ? agentNames.get(call.installedAgentId) ?? "Agent"
        : "Unassigned agent",
      executionCount: 0,
      durationMinutes: 0,
      totalMicroUsd: 0
    };
    row.executionCount += 1;
    row.durationMinutes += call.durationMinutes ?? 0;
    row.totalMicroUsd += call.billedCostMicroUsd ?? 0;
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => {
    const serviceCosts = detailedInvoiceServiceCosts(
      calls.map((call, index) => ({
        callId: call.callId ?? `legacy-${index}`,
        installedAgentId: call.installedAgentId,
        durationMinutes: call.durationMinutes,
        billedCostMicroUsd: call.billedCostMicroUsd,
        usageLineItemsJson: call.usageLineItemsJson
      })).filter((call) => call.installedAgentId === row.installedAgentId),
      invoiceLabels,
      invoiceBillingCosts
    );
    const billedCostMicroUsd = serviceCosts.reduce(
      (sum, service) => sum + service.amountMicroUsd,
      0
    );

    return {
      ...row,
      totalMicroUsd: billedCostMicroUsd,
      callCount: row.executionCount,
      billableExecutions: row.executionCount,
      freeTrialExecutions: 0,
      billedCostUsd: microUsdToUsd(billedCostMicroUsd),
      amountCents: Math.round(
        billedCostMicroUsd / MICRO_USD_PER_CENT
      ),
      serviceCosts
    };
  });
}

type InvoiceUsageCall = {
  callId: string;
  installedAgentId: string | null;
  durationMinutes: number | null;
  billedCostMicroUsd: number | null;
  usageLineItemsJson: unknown;
};

function detailedInvoiceServiceCosts(
  calls: InvoiceUsageCall[],
  invoiceLabels: UsageInvoiceLabelMap,
  invoiceBillingCosts: UsageInvoiceBillingCostMap
) {
  return rollupCustomerUsageLineItems(
    calls
      .filter((call) => Array.isArray(call.usageLineItemsJson))
      .map((call) =>
        repriceUsageInvoiceLineItems(
          call.usageLineItemsJson as unknown as UsageLineItem[],
          invoiceBillingCosts
        )
      ),
    invoiceLabels
  ).map((service) => ({
    serviceCode: service.serviceCode,
    serviceName: service.invoiceLabel ?? service.serviceName,
    invoiceLabel: service.invoiceLabel ?? service.serviceName,
    unit: service.unit,
    quantity: service.quantity,
    unitPriceUsd:
      (usageInvoiceBillingRateMicroUsd(service) ?? 0) / 1_000_000,
    amountMicroUsd: service.billedCostMicroUsd,
    billedCostUsd: microUsdToUsd(service.billedCostMicroUsd),
    amountCents: Math.round(
      service.billedCostMicroUsd / MICRO_USD_PER_CENT
    )
  }));
}

export async function getBusinessExecutionInvoices(c: Context) {
  const authUser = c.get("authUser");
  const business = await loadOwnedBusiness(authUser.id);
  if (!business) return successResponse(c, { invoices: [] });

  const [invoices, usageServices] = await Promise.all([
    prisma.businessUsageInvoice.findMany({
      where: { businessId: business.id },
      orderBy: [
        { billingMonth: "desc" },
        { sequence: "desc" },
        { issuedAt: "desc" }
      ],
      include: {
        installedAgent: {
          select: {
            id: true,
            name: true,
            executionFeeCents: true,
            listing: { select: { iconUrl: true } }
          }
        },
        lineItems: { orderBy: { amountMicroUsd: "desc" } },
        executions: {
          orderBy: { occurredAt: "asc" },
          select: {
            installedAgentId: true,
            source: true,
            sourceId: true,
            billable: true,
            freeReason: true,
            amountMicroUsd: true,
            actualCostMicroUsd: true,
            legacyBilledCostMicroUsd: true
          }
        },
        calls: {
          select: {
            callId: true,
            installedAgentId: true,
            durationMinutes: true,
            billedCostMicroUsd: true,
            usageLineItemsJson: true
          }
        }
      }
    }),
    prisma.platformUsageService.findMany({
      select: {
        code: true,
        role: true,
        unit: true,
        updatedCostMicroUsd: true,
        isActive: true
      }
    })
  ]);
  const invoiceLabels: UsageInvoiceLabelMap = new Map(
    usageServices.map((service) => [service.code, service.role])
  );
  const invoiceBillingCosts: UsageInvoiceBillingCostMap = new Map(
    usageServices
      .filter((service) => service.isActive)
      .map((service) => [
        service.code,
        {
          unit: service.unit,
          billingCostMicroUsd: service.updatedCostMicroUsd
        }
      ])
  );
  const invoiceCallIds = [
    ...new Set(
      invoices.flatMap((invoice) =>
        invoice.executions
          .filter((execution) => execution.source === "VAPI")
          .map((execution) => execution.sourceId)
      )
    )
  ];
  // Historical canonical invoices did not always attach VapiCall through the
  // relation. Resolve those calls by the immutable execution source ID too.
  const executionCalls =
    invoiceCallIds.length > 0
      ? await prisma.vapiCall.findMany({
          where: {
            businessId: business.id,
            callId: { in: invoiceCallIds }
          },
          select: {
            callId: true,
            installedAgentId: true,
            durationMinutes: true,
            billedCostMicroUsd: true,
            usageLineItemsJson: true
          }
        })
      : [];
  const callsById = new Map(
    executionCalls.map((call) => [call.callId, call])
  );
  const agentNames = new Map(
    business.installedAgents.map((agent) => [agent.id, agent.name])
  );

  return successResponse(c, {
    invoices: invoices.map((invoice) => {
      const invoiceCallsById = new Map<string, InvoiceUsageCall>(
        invoice.calls.map((call) => [call.callId, call])
      );
      for (const execution of invoice.executions) {
        if (execution.source !== "VAPI") continue;
        const call = callsById.get(execution.sourceId);
        if (call) invoiceCallsById.set(call.callId, call);
      }
      const invoiceCalls = [...invoiceCallsById.values()];
      const status = normalizeUsageInvoiceStatus(invoice.status);
      const canonicalStats = rollupExecutions(invoice.executions);
      const canonicalBreakdown = [...canonicalStats.values()].map((stats) => {
        const agent = business.installedAgents.find(
          (item) => item.id === stats.installedAgentId
        );
        const serviceCosts = detailedInvoiceServiceCosts(
          invoiceCalls.filter(
            (call) => call.installedAgentId === stats.installedAgentId
          ),
          invoiceLabels,
          invoiceBillingCosts
        );
        const billedCostMicroUsd = serviceCosts.reduce(
          (sum, service) => sum + service.amountMicroUsd,
          0
        );
        return {
          agentId: stats.installedAgentId,
          installedAgentId: stats.installedAgentId,
          agentName: agent?.name ?? invoice.installedAgent?.name ?? "Agent",
          iconUrl: agent?.listing?.iconUrl ?? invoice.installedAgent?.listing?.iconUrl ?? null,
          executionCount: stats.executionCount,
          callCount: stats.executionCount,
          billableExecutions: stats.billableExecutions,
          freeTrialExecutions: stats.freeTrialExecutions,
          durationMinutes: invoiceCalls
            .filter(
              (call) => call.installedAgentId === stats.installedAgentId
            )
            .reduce(
              (sum, call) => sum + (call.durationMinutes ?? 0),
              0
            ),
          billedCostUsd: microUsdToUsd(billedCostMicroUsd),
          amountCents: Math.round(
            billedCostMicroUsd / MICRO_USD_PER_CENT
          ),
          serviceCosts
        };
      });
      const usageAgentBreakdown =
        canonicalBreakdown.length > 0
          ? canonicalBreakdown
          : legacyAgentBreakdown(
              invoiceCalls,
              agentNames,
              invoiceLabels,
              invoiceBillingCosts
            );
      const executionCount =
        invoice.executions.length > 0
          ? invoice.executions.length
          : invoiceCalls.length;
      const detailedLineItems = detailedInvoiceServiceCosts(
        invoiceCalls,
        invoiceLabels,
        invoiceBillingCosts
      );
      const storedLineItems = customerFacingUsageLineItems(
        repriceUsageInvoiceLineItems(
          invoice.lineItems.map((item) => ({
            serviceCode: item.serviceCode,
            serviceName: item.serviceName,
            unit: item.unit,
            quantity: item.quantity,
            billingRateMicroUsd: item.unitPriceMicroUsd,
            actualCostMicroUsd: 0,
            billedCostMicroUsd: item.amountMicroUsd
          })),
          invoiceBillingCosts
        ),
        invoiceLabels
      ).map((item) => ({
        serviceCode: item.serviceCode,
        serviceName: item.invoiceLabel ?? item.serviceName,
        invoiceLabel: item.invoiceLabel ?? item.serviceName,
        unit: item.unit,
        quantity: item.quantity,
        unitPriceUsd:
          (usageInvoiceBillingRateMicroUsd(item) ?? 0) / 1_000_000,
        amountMicroUsd: item.billedCostMicroUsd,
        amountUsd: microUsdToUsd(item.billedCostMicroUsd),
        amountCents: Math.round(
          item.billedCostMicroUsd / MICRO_USD_PER_CENT
        )
      }));
      // Persisted invoice rows are authoritative and can include one-time
      // non-call charges such as the dedicated phone number. Historical
      // invoices without stored rows still fall back to call-derived detail.
      const lineItems =
        storedLineItems.length > 0 ? storedLineItems : detailedLineItems;
      const totalMicroUsd = lineItems.reduce(
        (sum, item) => sum + item.amountMicroUsd,
        0
      );
      const totalAmountCents = Math.round(
        totalMicroUsd / MICRO_USD_PER_CENT
      );
      const agentBreakdown = invoice.installedAgentId
        ? [
            {
              agentId: invoice.installedAgentId,
              installedAgentId: invoice.installedAgentId,
              agentName:
                invoice.installedAgent?.name ??
                usageAgentBreakdown[0]?.agentName ??
                "Agent",
              iconUrl:
                invoice.installedAgent?.listing?.iconUrl ?? null,
              executionCount,
              callCount: executionCount,
              durationMinutes: invoiceCalls
                .filter(
                  (call) =>
                    call.installedAgentId === invoice.installedAgentId
                )
                .reduce(
                  (sum, call) => sum + (call.durationMinutes ?? 0),
                  0
                ),
              billedCostUsd: microUsdToUsd(totalMicroUsd),
              amountCents: totalAmountCents,
              serviceCosts: lineItems.map((item) => ({
                serviceCode: item.serviceCode,
                serviceName: item.serviceName,
                invoiceLabel: item.invoiceLabel,
                unit: item.unit,
                quantity: item.quantity,
                unitPriceUsd: item.unitPriceUsd,
                billedCostUsd: microUsdToUsd(item.amountMicroUsd),
                amountCents: Math.round(
                  item.amountMicroUsd / MICRO_USD_PER_CENT
                )
              }))
            }
          ]
        : usageAgentBreakdown;

      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceKind: "USAGE",
        billingMonth: invoice.billingMonth,
        monthLabel: monthLabel(invoice.billingMonth),
        sequence: invoice.sequence,
        installedAgentId: invoice.installedAgentId,
        agentName: invoice.installedAgent?.name ?? agentBreakdown[0]?.agentName ?? null,
        iconUrl: invoice.installedAgent?.listing?.iconUrl ?? null,
        status,
        tabStatus: status === "PAID" ? "PAID" : status,
        currency: invoice.currency,
        periodStart: invoice.periodStart.toISOString(),
        periodEnd: invoice.periodEnd.toISOString(),
        issuedAt: invoice.issuedAt.toISOString(),
        dueAt: invoice.dueAt.toISOString(),
        graceEndsAt: invoice.graceEndsAt?.toISOString() ?? null,
        totalMicroUsd,
        totalUsd: microUsdToUsd(totalMicroUsd),
        amountCents: totalAmountCents,
        paidAt: invoice.paidAt?.toISOString() ?? null,
        reminderCount: invoice.reminderCount,
        suspendedAt: invoice.suspendedAt?.toISOString() ?? null,
        executionCount,
        callCount: executionCount,
        isAccruing:
          status === "PENDING" && !invoice.paidAt && !invoice.closedAt,
        agentBreakdown,
        lineItems: lineItems.map((item) => ({
          ...item,
          amountUsd:
            "billedCostUsd" in item
              ? item.billedCostUsd
              : item.amountUsd
        }))
      };
    })
  });
}

export async function payBusinessExecutionInvoice(c: Context) {
  const authUser = c.get("authUser");
  const invoiceId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const requestedPaymentMethodId =
    body &&
    typeof body === "object" &&
    "paymentMethodId" in body &&
    typeof body.paymentMethodId === "string"
      ? body.paymentMethodId.trim()
      : "";
  const [invoice, paymentPricingServices] = await Promise.all([
    prisma.businessUsageInvoice.findFirst({
      where: { id: invoiceId, business: { ownerId: authUser.id } },
      include: {
        business: { select: { id: true, stripeCustomerId: true } }
      }
    }),
    prisma.platformUsageService.findMany({
      where: { isActive: true },
      select: {
        code: true,
        unit: true,
        updatedCostMicroUsd: true
      }
    })
  ]);
  if (!invoice) {
    return errorResponse(c, "Invoice not found", 404, "USAGE_INVOICE_NOT_FOUND");
  }
  if (invoice.status === "PAID") {
    const servicesRestored = await restoreBusinessAfterBillingPayment(
      invoice.business.id,
      invoice.installedAgentId
    );
    return successResponse(c, {
      invoiceId,
      alreadyPaid: true,
      status: "PAID",
      servicesRestored
    });
  }
  if (invoice.status === "VOID") {
    return errorResponse(c, "Invoice is void", 409, "USAGE_INVOICE_VOID");
  }
  const paymentBillingCosts: UsageInvoiceBillingCostMap = new Map(
    paymentPricingServices.map((service) => [
      service.code,
      {
        unit: service.unit,
        billingCostMicroUsd: service.updatedCostMicroUsd
      }
    ])
  );

  const stripe = getStripeClient();
  if (!stripe || !isStripeConfigured()) {
    return errorResponse(c, "Stripe is not configured", 503, "STRIPE_NOT_CONFIGURED");
  }

  const savedPayment = await prisma.payment.findFirst({
    where: {
      userId: authUser.id,
      stripePaymentId: { not: null },
      status: { in: ["SUCCEEDED", "TRIALING", "COMPLETED", "OVERDUE"] }
    },
    orderBy: { createdAt: "desc" },
    select: { stripeCustomerId: true, stripePaymentId: true }
  });
  const customerId =
    invoice.business.stripeCustomerId ?? savedPayment?.stripeCustomerId ?? null;
  if (!customerId) {
    return errorResponse(
      c,
      "No saved payment method is available",
      409,
      "PAYMENT_METHOD_REQUIRED"
    );
  }

  let paymentMethodId = requestedPaymentMethodId || savedPayment?.stripePaymentId || null;
  try {
    if (requestedPaymentMethodId) {
      const method = await attachOrReusePaymentMethod(
        stripe,
        requestedPaymentMethodId,
        customerId
      );
      paymentMethodId = method.id;
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: method.id }
      });
    } else {
      const customer = await stripe.customers.retrieve(customerId);
      if (typeof customer !== "string" && !customer.deleted) {
        const defaultMethod = customer.invoice_settings.default_payment_method;
        paymentMethodId =
          (typeof defaultMethod === "string" ? defaultMethod : defaultMethod?.id) ||
          paymentMethodId;
      }
    }
  } catch {
    return errorResponse(
      c,
      "The selected payment method could not be used",
      422,
      "PAYMENT_METHOD_INVALID"
    );
  }
  if (!paymentMethodId) {
    return errorResponse(
      c,
      "No saved payment method is available",
      409,
      "PAYMENT_METHOD_REQUIRED"
    );
  }

  /*
   * Freeze a same-agent statement before crossing the Stripe boundary. The
   * recorder takes the same installed-agent advisory lock, so an execution
   * can never land in a statement after its charge amount has been decided.
   * Small segments are carried and combined until Stripe's minimum is met.
   */
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`usage-pay:${invoice.business.id}`}))`;
    const fresh = await tx.businessUsageInvoice.findUnique({
      where: { id: invoiceId }
    });
    if (!fresh || fresh.businessId !== invoice.business.id) {
      return { kind: "missing" as const };
    }
    if (fresh.status === "PAID") return { kind: "paid" as const };
    if (fresh.status === "VOID") return { kind: "void" as const };

    const agentLockKey = fresh.installedAgentId
      ? `agent-execution:${fresh.installedAgentId}`
      : `legacy-usage:${fresh.businessId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agentLockKey}))`;

    if (fresh.stripePaymentIntentId) {
      const rows = await tx.businessUsageInvoice.findMany({
        where: {
          businessId: fresh.businessId,
          stripePaymentIntentId: fresh.stripePaymentIntentId,
          paidAt: null,
          status: { in: ["PENDING", "OPEN", "OVERDUE"] }
        },
        orderBy: [{ billingMonth: "asc" }, { sequence: "asc" }]
      });
      return {
        kind: "ready" as const,
        rows,
        totalMicroUsd: rows.reduce((sum, row) => sum + row.totalMicroUsd, 0),
        attempt: Math.max(1, ...rows.map((row) => row.paymentAttemptCount)),
        intentId: fresh.stripePaymentIntentId
      };
    }

    // A crash after reserving an attempt but before persisting its PaymentIntent
    // reuses the exact frozen rows and attempt number/idempotency key.
    if (fresh.paymentPendingAt) {
      const rows = await tx.businessUsageInvoice.findMany({
        where: {
          businessId: fresh.businessId,
          installedAgentId: fresh.installedAgentId,
          paymentPendingAt: fresh.paymentPendingAt,
          stripePaymentIntentId: null,
          paidAt: null,
          status: { in: ["PENDING", "OPEN", "OVERDUE"] }
        },
        orderBy: [{ billingMonth: "asc" }, { sequence: "asc" }]
      });
      if (rows.length > 0) {
        return {
          kind: "ready" as const,
          rows,
          totalMicroUsd: rows.reduce((sum, row) => sum + row.totalMicroUsd, 0),
          attempt: Math.max(1, ...rows.map((row) => row.paymentAttemptCount)),
          intentId: null
        };
      }
    }

    const storedRows = await tx.businessUsageInvoice.findMany({
      where: {
        businessId: fresh.businessId,
        installedAgentId: fresh.installedAgentId,
        currency: fresh.currency,
        stripePaymentIntentId: null,
        paidAt: null,
        status: { in: ["PENDING", "OPEN", "OVERDUE"] }
      },
      orderBy: [{ billingMonth: "asc" }, { sequence: "asc" }],
      include: {
        lineItems: true
      }
    });
    const rows = [];
    for (const row of storedRows) {
      if (row.lineItems.length === 0) {
        rows.push(row);
        continue;
      }

      let repricedTotalMicroUsd = 0;
      for (const lineItem of row.lineItems) {
        // The one-time phone-number fee is frozen at selection time. Metered
        // usage continues to use the current active Admin billing rate.
        const pricing =
          usageInvoiceServiceUsesSnapshotPrice(lineItem.serviceCode)
            ? undefined
            : paymentBillingCosts.get(lineItem.serviceCode);
        const unitPriceMicroUsd =
          pricing?.billingCostMicroUsd ?? lineItem.unitPriceMicroUsd;
        const amountMicroUsd = pricing
          ? Math.round(unitPriceMicroUsd * Math.max(0, lineItem.quantity))
          : lineItem.amountMicroUsd;
        repricedTotalMicroUsd += amountMicroUsd;

        if (
          unitPriceMicroUsd !== lineItem.unitPriceMicroUsd ||
          amountMicroUsd !== lineItem.amountMicroUsd ||
          (pricing && pricing.unit !== lineItem.unit)
        ) {
          await tx.businessUsageInvoiceLineItem.update({
            where: { id: lineItem.id },
            data: {
              unit: pricing?.unit ?? lineItem.unit,
              unitPriceMicroUsd,
              amountMicroUsd
            }
          });
        }
      }

      if (
        repricedTotalMicroUsd !== row.subtotalMicroUsd ||
        repricedTotalMicroUsd !== row.totalMicroUsd
      ) {
        await tx.businessUsageInvoice.update({
          where: { id: row.id },
          data: {
            subtotalMicroUsd: repricedTotalMicroUsd,
            totalMicroUsd: repricedTotalMicroUsd
          }
        });
      }
      rows.push({
        ...row,
        subtotalMicroUsd: repricedTotalMicroUsd,
        totalMicroUsd: repricedTotalMicroUsd
      });
    }
    const totalMicroUsd = rows.reduce((sum, row) => sum + row.totalMicroUsd, 0);
    if (!usageBalanceIsCollectible(totalMicroUsd)) {
      return {
        kind: "carried" as const,
        totalMicroUsd,
        invoiceIds: rows.map((row) => row.id)
      };
    }

    const reservedAt = new Date();
    const attempt =
      Math.max(0, ...rows.map((row) => row.paymentAttemptCount)) + 1;
    for (const row of rows) {
      await tx.businessUsageInvoice.update({
        where: { id: row.id },
        data: {
          closedAt: row.closedAt ?? reservedAt,
          periodEnd:
            reservedAt < row.periodEnd ? reservedAt : row.periodEnd,
          paymentAttemptCount: attempt,
          paymentPendingAt: reservedAt
        }
      });
    }
    return {
      kind: "ready" as const,
      rows,
      totalMicroUsd,
      attempt,
      intentId: null
    };
  });

  if (prepared.kind === "missing") {
    return errorResponse(c, "Invoice not found", 404, "USAGE_INVOICE_NOT_FOUND");
  }
  if (prepared.kind === "paid") {
    const servicesRestored = await restoreBusinessAfterBillingPayment(
      invoice.business.id,
      invoice.installedAgentId
    );
    return successResponse(c, {
      invoiceId,
      alreadyPaid: true,
      status: "PAID",
      servicesRestored
    });
  }
  if (prepared.kind === "void") {
    return errorResponse(c, "Invoice is void", 409, "USAGE_INVOICE_VOID");
  }
  if (prepared.kind === "carried") {
    return successResponse(c, {
      invoiceId,
      status: normalizeUsageInvoiceStatus(invoice.status),
      carriedForward: true,
      balanceMicroUsd: prepared.totalMicroUsd,
      balanceUsd: microUsdToUsd(prepared.totalMicroUsd),
      minimumChargeUsd: 0.5,
      invoiceIds: prepared.invoiceIds
    }, "Balance carried forward until it reaches the $0.50 card minimum");
  }

  const settledInvoiceIds = prepared.rows.map((row) => row.id);
  const paymentBundleId = prepared.rows[0]?.id ?? invoice.id;
  const amountCents = Math.round(prepared.totalMicroUsd / MICRO_USD_PER_CENT);
  let intent;
  try {
    intent = prepared.intentId
      ? await stripe.paymentIntents.retrieve(prepared.intentId)
      : await stripe.paymentIntents.create(
          {
            amount: amountCents,
            currency: invoice.currency,
            customer: customerId,
            payment_method: paymentMethodId,
            payment_method_types: ["card"],
            description: `Triven execution usage (${prepared.rows.length} statement${prepared.rows.length === 1 ? "" : "s"})`,
            metadata: {
              usageInvoiceId: invoice.id,
              businessId: invoice.business.id,
              installedAgentId: invoice.installedAgentId ?? "",
              usageInvoiceCount: String(prepared.rows.length)
            }
          },
          {
            idempotencyKey: `usage-invoice:${paymentBundleId}:${prepared.attempt}`
          }
        );

    if (!prepared.intentId) {
      await prisma.businessUsageInvoice.updateMany({
        where: {
          id: { in: settledInvoiceIds },
          paidAt: null,
          stripePaymentIntentId: null
        },
        data: { stripePaymentIntentId: intent.id }
      });
    }

    if (
      intent.status === "requires_confirmation" ||
      intent.status === "requires_payment_method"
    ) {
      intent = await stripe.paymentIntents.confirm(intent.id, {
        payment_method: paymentMethodId,
        off_session: false,
        use_stripe_sdk: true
      });
    }

    if (intent.status === "requires_action" && intent.client_secret) {
      return successResponse(c, {
        invoiceId,
        invoiceIds: settledInvoiceIds,
        requiresAction: true,
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret
      }, "Card authentication required");
    }
    if (intent.status !== "succeeded") {
      await prisma.businessUsageInvoice.updateMany({
        where: { id: { in: settledInvoiceIds }, paidAt: null },
        data: { paymentPendingAt: null }
      });
      return errorResponse(
        c,
        "Payment requires attention",
        409,
        "USAGE_INVOICE_PAYMENT_INCOMPLETE"
      );
    }

    const paidAt = new Date();
    await prisma.businessUsageInvoice.updateMany({
      where: {
        id: { in: settledInvoiceIds },
        paidAt: null,
        stripePaymentIntentId: intent.id
      },
      data: {
        status: "PAID",
        paidAt,
        closedAt: paidAt,
        suspendedAt: null,
        paymentPendingAt: null
      }
    });
    const servicesRestored = await restoreBusinessAfterBillingPayment(
      invoice.business.id,
      invoice.installedAgentId
    );
    return successResponse(
      c,
      {
        invoiceId,
        invoiceIds: settledInvoiceIds,
        status: "PAID",
        paidAt: paidAt.toISOString(),
        amountCents,
        servicesRestored
      },
      "Invoice paid"
    );
  } catch (error) {
    // Keep the reserved attempt. A network timeout can happen after Stripe
    // accepted the create request; reusing the same DB attempt reuses the same
    // idempotency key and cannot double-charge on retry.
    console.error("[billing] usage invoice payment failed", {
      invoiceId,
      invoiceIds: settledInvoiceIds,
      error
    });
    return errorResponse(
      c,
      "The invoice payment could not be completed.",
      500,
      "USAGE_INVOICE_PAYMENT_FAILED"
    );
  }
}
