import type { Context } from "hono";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { getStripeClient, isStripeConfigured } from "../payments/stripe";
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
      agentRollup: [],
      serviceRollup: [],
      executions: [],
      calls: []
    });
  }

  const [executions, calls, executionMonths, invoiceMonths] = await Promise.all([
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
    })
  ]);

  const agentsById = new Map(business.installedAgents.map((agent) => [agent.id, agent]));
  const agentsForMonth = business.installedAgents.filter(
    (agent) => agent.createdAt < selectedBounds.end
  );
  const statsByAgent = rollupExecutions(executions);
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
    const billedCostUsd = microUsdToUsd(stats.displayCostMicroUsd);
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
      billedCostMicroUsd: stats.displayCostMicroUsd,
      billedCostUsd,
      amountCents: Math.round(stats.displayCostMicroUsd / MICRO_USD_PER_CENT),
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
      serviceCosts: [
        {
          serviceCode: "agent_execution",
          serviceName: "Agent executions",
          unit: "PER_UNIT",
          quantity: stats.billableExecutions,
          unitPriceUsd: agent.executionFeeCents / 100,
          billedCostUsd,
          amountCents: Math.round(stats.displayCostMicroUsd / MICRO_USD_PER_CENT)
        }
      ]
    };
  });

  const totalMicroUsd = executions.reduce(
    (sum, row) => sum + row.amountMicroUsd + row.legacyBilledCostMicroUsd,
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
    agentRollup,
    serviceRollup: [
      {
        serviceCode: "agent_execution",
        serviceName: "Agent executions",
        unit: "PER_UNIT",
        quantity: executions.filter((execution) => execution.billable).length,
        billedCostMicroUsd: totalMicroUsd,
        billedCostUsd: totalCostUsd,
        amountCents: Math.round(totalMicroUsd / MICRO_USD_PER_CENT)
      }
    ],
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
      return {
        callId: call.callId,
        customerPhone: call.customerPhone,
        installedAgentId: call.installedAgentId,
        durationMinutes: call.durationMinutes,
        durationSeconds: call.durationSeconds,
        billedCostUsd: execution ? microUsdToUsd(execution.amountMicroUsd) : 0,
        amountCents: execution
          ? Math.round(execution.amountMicroUsd / MICRO_USD_PER_CENT)
          : 0,
        recordedAt: call.billingRecordedAt?.toISOString() ?? null,
        recordingUrl: call.recordingUrl ?? null
      };
    })
  });
}

function legacyAgentBreakdown(
  calls: Array<{
    installedAgentId: string | null;
    durationMinutes: number | null;
    billedCostMicroUsd: number | null;
  }>,
  agentNames: Map<string, string>
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
  return [...rows.values()].map((row) => ({
    ...row,
    callCount: row.executionCount,
    billableExecutions: row.executionCount,
    freeTrialExecutions: 0,
    billedCostUsd: microUsdToUsd(row.totalMicroUsd),
    amountCents: Math.round(row.totalMicroUsd / MICRO_USD_PER_CENT),
    serviceCosts: []
  }));
}

export async function getBusinessExecutionInvoices(c: Context) {
  const authUser = c.get("authUser");
  const business = await loadOwnedBusiness(authUser.id);
  if (!business) return successResponse(c, { invoices: [] });

  const invoices = await prisma.businessUsageInvoice.findMany({
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
          billable: true,
          freeReason: true,
          amountMicroUsd: true,
          actualCostMicroUsd: true,
          legacyBilledCostMicroUsd: true
        }
      },
      calls: {
        select: {
          installedAgentId: true,
          durationMinutes: true,
          billedCostMicroUsd: true
        }
      }
    }
  });
  const agentNames = new Map(
    business.installedAgents.map((agent) => [agent.id, agent.name])
  );

  return successResponse(c, {
    invoices: invoices.map((invoice) => {
      const status = normalizeUsageInvoiceStatus(invoice.status);
      const canonicalStats = rollupExecutions(invoice.executions);
      const canonicalBreakdown = [...canonicalStats.values()].map((stats) => {
        const agent = business.installedAgents.find(
          (item) => item.id === stats.installedAgentId
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
          durationMinutes: 0,
          billedCostUsd: microUsdToUsd(stats.totalMicroUsd),
          amountCents: Math.round(stats.totalMicroUsd / MICRO_USD_PER_CENT),
          serviceCosts: []
        };
      });
      const agentBreakdown =
        canonicalBreakdown.length > 0
          ? canonicalBreakdown
          : legacyAgentBreakdown(invoice.calls, agentNames);
      const executionCount =
        invoice.executions.length > 0
          ? invoice.executions.length
          : invoice.calls.length;

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
        totalMicroUsd: invoice.totalMicroUsd,
        totalUsd: microUsdToUsd(invoice.totalMicroUsd),
        amountCents: Math.round(invoice.totalMicroUsd / MICRO_USD_PER_CENT),
        paidAt: invoice.paidAt?.toISOString() ?? null,
        reminderCount: invoice.reminderCount,
        suspendedAt: invoice.suspendedAt?.toISOString() ?? null,
        executionCount,
        callCount: executionCount,
        isAccruing:
          status === "PENDING" && !invoice.paidAt && !invoice.closedAt,
        agentBreakdown,
        lineItems: invoice.lineItems.map((item) => ({
          serviceCode: item.serviceCode,
          serviceName: item.serviceName,
          unit: item.unit,
          quantity: item.quantity,
          unitPriceMicroUsd: item.unitPriceMicroUsd,
          unitPriceUsd: microUsdToUsd(item.unitPriceMicroUsd),
          amountMicroUsd: item.amountMicroUsd,
          amountUsd: microUsdToUsd(item.amountMicroUsd),
          amountCents: Math.round(item.amountMicroUsd / MICRO_USD_PER_CENT)
        }))
      };
    })
  });
}

export async function payBusinessExecutionInvoice(c: Context) {
  const authUser = c.get("authUser");
  const invoiceId = c.req.param("id");
  const invoice = await prisma.businessUsageInvoice.findFirst({
    where: { id: invoiceId, business: { ownerId: authUser.id } },
    include: {
      business: { select: { id: true, stripeCustomerId: true } }
    }
  });
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

  let paymentMethodId = savedPayment?.stripePaymentId ?? null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (typeof customer !== "string" && !customer.deleted) {
      const defaultMethod = customer.invoice_settings.default_payment_method;
      paymentMethodId =
        (typeof defaultMethod === "string" ? defaultMethod : defaultMethod?.id) ||
        paymentMethodId;
    }
  } catch {
    // The saved purchase method remains a safe fallback.
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

    const rows = await tx.businessUsageInvoice.findMany({
      where: {
        businessId: fresh.businessId,
        installedAgentId: fresh.installedAgentId,
        currency: fresh.currency,
        stripePaymentIntentId: null,
        paidAt: null,
        status: { in: ["PENDING", "OPEN", "OVERDUE"] }
      },
      orderBy: [{ billingMonth: "asc" }, { sequence: "asc" }]
    });
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
