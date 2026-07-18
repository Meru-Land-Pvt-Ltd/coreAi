import type { Context } from "hono";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import {
  calculateUsageLineItems,
  microUsdToUsd,
  sumLineItems,
  type UsageLineItem
} from "../../lib/usage-pricing";
import { fetchVapiCallById } from "../architect/vapi-connector";
import { getStripeClient, isStripeConfigured } from "../payments/stripe";
import { restoreBusinessAfterBillingPayment } from "./billing-cycle";

const PLATFORM_SERVICE_CODES = new Set(["database_storage", "google_calendar"]);
type ServiceRoleMap = Map<string, string | null>;

function customerServiceIdentity(serviceCode: string, serviceRoles: ServiceRoleMap) {
  if (PLATFORM_SERVICE_CODES.has(serviceCode)) {
    return { serviceCode: "platform_service", serviceName: "Platform service" };
  }

  const role = serviceRoles.get(serviceCode)?.trim() || "Usage service";
  const safeRoleKey = role.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "usage_service";
  return { serviceCode: `service_role_${safeRoleKey}`, serviceName: role };
}

function customerFacingLineItems(items: UsageLineItem[], serviceRoles: ServiceRoleMap): UsageLineItem[] {
  const grouped = new Map<string, UsageLineItem>();

  for (const item of items) {
    const identity = customerServiceIdentity(item.serviceCode, serviceRoles);
    const existing = grouped.get(identity.serviceCode);
    if (!existing) {
      grouped.set(identity.serviceCode, {
        ...item,
        ...identity,
        unit: identity.serviceCode === "platform_service" ? "PER_UNIT" : item.unit
      });
      continue;
    }

    existing.quantity += item.quantity;
    existing.actualCostMicroUsd += item.actualCostMicroUsd;
    existing.billedCostMicroUsd += item.billedCostMicroUsd;
    if (existing.unit !== item.unit) existing.unit = "PER_UNIT";
  }

  return [...grouped.values()];
}

async function loadServiceRoles(): Promise<ServiceRoleMap> {
  const services = await prisma.platformUsageService.findMany({
    select: { code: true, role: true }
  });
  return new Map(services.map((service) => [service.code, service.role]));
}

function billingMonthFromDate(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function parseDurationMinutes(payload: Record<string, unknown>): number {
  const minutes = Number(payload.durationMinutes);
  if (Number.isFinite(minutes) && minutes > 0) return minutes;

  const seconds = Number(payload.durationSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds / 60;

  const ms = Number(payload.durationMs);
  if (Number.isFinite(ms) && ms > 0) return ms / 60_000;

  return 0;
}

function countSmsFromWebhook(body: Record<string, unknown>): number {
  const messages = body.message;
  if (!Array.isArray(messages)) return 0;

  let count = 0;
  for (const entry of messages) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
    const content = `${record.message ?? ""} ${record.content ?? ""}`.toLowerCase();
    if (role === "tool" && /sms|text message|notification sent/.test(content)) {
      count += 1;
    }
  }

  return count;
}

async function loadActivePricingServices() {
  return prisma.platformUsageService.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      code: true,
      name: true,
      unit: true,
      actualCostMicroUsd: true,
      updatedCostMicroUsd: true
    }
  });
}

export function extractRecordingUrl(message: Record<string, unknown>): string | null {
  const artifact =
    typeof message.artifact === "object" && message.artifact !== null
      ? (message.artifact as Record<string, unknown>)
      : {};

  const candidates = [
    artifact.recordingUrl,
    artifact.stereoRecordingUrl,
    message.recordingUrl,
    message.stereoRecordingUrl
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^https:\/\//i.test(candidate.trim())) {
      return candidate.trim();
    }
  }

  return null;
}

export async function recordVapiCallUsage({
  businessId,
  installedAgentId,
  callId,
  customerPhone,
  webhookBody
}: {
  businessId: string;
  installedAgentId?: string | null;
  callId: string;
  customerPhone?: string;
  webhookBody: Record<string, unknown>;
}) {
  // Billing begins only after the particular agent was purchased. This also
  // prevents test calls or one business's phone/assistant mapping from being
  // charged to another business.
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { ownerId: true }
  });
  if (!business) return;

  const installedAgent = installedAgentId
    ? await prisma.installedAgent.findFirst({
        where: { id: installedAgentId, businessId },
        select: { id: true, listingId: true, configJson: true }
      })
    : null;

  // Explicit test exclusion: sandbox/test installed agents are never billable,
  // regardless of whether the owner also has a purchased agent.
  const agentConfig =
    installedAgent?.configJson && typeof installedAgent.configJson === "object" && !Array.isArray(installedAgent.configJson)
      ? (installedAgent.configJson as Record<string, unknown>)
      : {};
  if (agentConfig.testMode === true || agentConfig.executionMode === "ARCHITECT_DRY_RUN" || agentConfig.executionMode === "BUSINESS_TEST") {
    console.log("[usage-billing] skipped: test-mode installed agent", { businessId, installedAgentId });
    return;
  }
  const webhookMetadata =
    typeof webhookBody.message === "object" && webhookBody.message !== null
      ? ((webhookBody.message as Record<string, unknown>).call as Record<string, unknown> | undefined)?.metadata
      : undefined;
  const topLevelMetadata = webhookBody.metadata;
  const metadata =
    typeof webhookMetadata === "object" && webhookMetadata !== null
      ? (webhookMetadata as Record<string, unknown>)
      : typeof topLevelMetadata === "object" && topLevelMetadata !== null
        ? (topLevelMetadata as Record<string, unknown>)
        : {};
  const assignedPhoneNumber =
    typeof metadata.assignedPhoneNumber === "string" ? metadata.assignedPhoneNumber : "";

  if (assignedPhoneNumber) {
    const assignedMapping = await prisma.businessPhoneNumber.findFirst({
      where: {
        businessId,
        phoneNumber: assignedPhoneNumber,
        ...(installedAgent?.id ? { installedAgentId: installedAgent.id } : {})
      },
      select: { id: true }
    });
    if (!assignedMapping) {
      console.warn("[usage-billing] skipped: assigned Twilio number does not match business/agent", {
        businessId,
        installedAgentId,
        assignedPhoneNumber
      });
      return;
    }
  }
  const purchase = await prisma.payment.findFirst({
    where: {
      userId: business.ownerId,
      status: "SUCCEEDED",
      OR: [{ businessId }, { businessId: null }],
      ...(installedAgent?.listingId ? { listingId: installedAgent.listingId } : {})
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true }
  });
  if (!purchase) {
    console.log("[usage-billing] skipped: no completed agent purchase", { businessId, installedAgentId });
    return;
  }

  const message =
    typeof webhookBody.message === "object" && webhookBody.message !== null
      ? (webhookBody.message as Record<string, unknown>)
      : webhookBody;

  const vapiCall = await fetchVapiCallById(callId).catch((error) => {
    console.error("[usage-billing] fetchVapiCallById failed (non-fatal)", error);
    return null;
  });

  const durationMinutes = parseDurationMinutes({
    durationMinutes: message.durationMinutes ?? vapiCall?.durationMinutes,
    durationSeconds: message.durationSeconds ?? vapiCall?.durationSeconds,
    durationMs: message.durationMs ?? vapiCall?.durationMs
  });

  const smsCount = countSmsFromWebhook(message);
  const pricingServices = await loadActivePricingServices();
  const lineItems = calculateUsageLineItems(pricingServices, {
    durationMinutes,
    smsCount,
    callCount: durationMinutes > 0 ? 1 : 0
  });
  const totals = sumLineItems(lineItems);

  const vapiCostUsd = vapiCall?.costUsd ?? Number(message.cost);
  const vapiCostMicroUsd =
    Number.isFinite(vapiCostUsd) && vapiCostUsd >= 0 ? Math.round(vapiCostUsd * 1_000_000) : null;

  const endedAt = new Date();
  if (endedAt < purchase.createdAt) return;
  const billingMonth = billingMonthFromDate(endedAt);

  const recordingUrl = extractRecordingUrl(message);

  await prisma.vapiCall.upsert({
    where: { callId },
    update: {
      installedAgentId: installedAgentId ?? undefined,
      recordingUrl: recordingUrl ?? undefined,
      durationSeconds:
        Number.isFinite(Number(message.durationSeconds)) && Number(message.durationSeconds) > 0
          ? Math.round(Number(message.durationSeconds))
          : durationMinutes > 0
            ? Math.round(durationMinutes * 60)
            : undefined,
      durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
      smsCount,
      vapiCostMicroUsd: vapiCostMicroUsd ?? undefined,
      actualCostMicroUsd: totals.actualCostMicroUsd,
      billedCostMicroUsd: totals.billedCostMicroUsd,
      usageLineItemsJson: lineItems as never,
      vapiCostBreakdownJson: (vapiCall?.costBreakdown ?? message.costBreakdown ?? null) as never,
      billingMonth,
      billingRecordedAt: endedAt,
      endedAt
    },
    create: {
      businessId,
      installedAgentId: installedAgentId ?? undefined,
      callId,
      customerPhone: customerPhone || "unknown",
      status: "end-of-call-report",
      recordingUrl,
      durationSeconds:
        durationMinutes > 0 ? Math.round(durationMinutes * 60) : undefined,
      durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
      smsCount,
      vapiCostMicroUsd: vapiCostMicroUsd ?? undefined,
      actualCostMicroUsd: totals.actualCostMicroUsd,
      billedCostMicroUsd: totals.billedCostMicroUsd,
      usageLineItemsJson: lineItems as never,
      vapiCostBreakdownJson: (vapiCall?.costBreakdown ?? message.costBreakdown ?? null) as never,
      billingMonth,
      billingRecordedAt: endedAt,
      endedAt,
      metadataJson: webhookBody as never
    }
  });

  console.log("[usage-billing] recorded call usage", {
    businessId,
    callId,
    durationMinutes,
    billedUsd: microUsdToUsd(totals.billedCostMicroUsd),
    vapiCostUsd: vapiCostMicroUsd ? microUsdToUsd(vapiCostMicroUsd) : null
  });
}

function rollupLineItems(calls: Array<{ usageLineItemsJson: unknown }>, serviceRoles: ServiceRoleMap) {
  const rollup = new Map<
    string,
    {
      serviceCode: string;
      serviceName: string;
      unit: string;
      quantity: number;
      actualCostMicroUsd: number;
      billedCostMicroUsd: number;
    }
  >();

  for (const call of calls) {
    const items = Array.isArray(call.usageLineItemsJson)
      ? customerFacingLineItems(call.usageLineItemsJson as UsageLineItem[], serviceRoles)
      : [];

    for (const item of items) {
      const existing = rollup.get(item.serviceCode);
      if (!existing) {
        rollup.set(item.serviceCode, {
          serviceCode: item.serviceCode,
          serviceName: item.serviceName,
          unit: item.unit,
          quantity: item.quantity,
          actualCostMicroUsd: item.actualCostMicroUsd,
          billedCostMicroUsd: item.billedCostMicroUsd
        });
        continue;
      }

      existing.quantity += item.quantity;
      existing.actualCostMicroUsd += item.actualCostMicroUsd;
      existing.billedCostMicroUsd += item.billedCostMicroUsd;
    }
  }

  return [...rollup.values()].map((item) => ({
    ...item,
    actualCostUsd: microUsdToUsd(item.actualCostMicroUsd),
    billedCostUsd: microUsdToUsd(item.billedCostMicroUsd)
  }));
}

function rollupAgentUsage(
  calls: Array<{
    installedAgentId: string | null;
    durationMinutes: number | null;
    billedCostMicroUsd: number | null;
    usageLineItemsJson?: unknown;
  }>,
  agentNames: Map<string, string>,
  serviceRoles: ServiceRoleMap
) {
  const rollup = new Map<string, {
    agentId: string | null;
    agentName: string;
    callCount: number;
    durationMinutes: number;
    billedCostMicroUsd: number;
    services: Map<string, {
      serviceCode: string;
      serviceName: string;
      unit: string;
      quantity: number;
      billedCostMicroUsd: number;
    }>;
  }>();

  for (const call of calls) {
    const key = call.installedAgentId ?? "unassigned";
    const existing = rollup.get(key) ?? {
      agentId: call.installedAgentId,
      agentName: call.installedAgentId
        ? agentNames.get(call.installedAgentId) ?? "Agent"
        : "Unassigned agent",
      callCount: 0,
      durationMinutes: 0,
      billedCostMicroUsd: 0,
      services: new Map()
    };
    existing.callCount += 1;
    existing.durationMinutes += call.durationMinutes ?? 0;
    existing.billedCostMicroUsd += call.billedCostMicroUsd ?? 0;
    const lineItems = Array.isArray(call.usageLineItemsJson)
      ? customerFacingLineItems(call.usageLineItemsJson as UsageLineItem[], serviceRoles)
      : [];
    for (const lineItem of lineItems) {
      if (lineItem.quantity <= 0 || lineItem.billedCostMicroUsd <= 0) continue;
      const service = existing.services.get(lineItem.serviceCode) ?? {
        serviceCode: lineItem.serviceCode,
        serviceName: lineItem.serviceName,
        unit: lineItem.unit,
        quantity: 0,
        billedCostMicroUsd: 0
      };
      service.quantity += lineItem.quantity;
      service.billedCostMicroUsd += lineItem.billedCostMicroUsd;
      existing.services.set(lineItem.serviceCode, service);
    }
    rollup.set(key, existing);
  }

  return [...rollup.values()].map(({ services, ...item }) => ({
    ...item,
    billedCostUsd: microUsdToUsd(item.billedCostMicroUsd),
    amountCents: Math.round(item.billedCostMicroUsd / 10_000),
    serviceCosts: [...services.values()].map((service) => ({
      ...service,
      billedCostUsd: microUsdToUsd(service.billedCostMicroUsd),
      amountCents: Math.round(service.billedCostMicroUsd / 10_000)
    }))
  }));
}

export async function getBusinessUsageBill(c: Context) {
  const authUser = c.get("authUser");
  const month = (c.req.query("month") ?? "").trim() || billingMonthFromDate(new Date());

  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true }
  });

  if (!business) {
    return successResponse(c, {
      month,
      businessId: null,
      totalCalls: 0,
      totalDurationMinutes: 0,
      totalActualUsd: 0,
      totalBilledUsd: 0,
      totalVapiReportedUsd: 0,
      updatedAt: null,
      agentRollup: [],
      serviceRollup: [],
      calls: []
    });
  }

  const [calls, agents, serviceRoles] = await Promise.all([
    prisma.vapiCall.findMany({
    where: {
      businessId: business.id,
      billingMonth: month,
      billingRecordedAt: { not: null }
    },
    orderBy: { billingRecordedAt: "desc" },
    select: {
      callId: true,
      customerPhone: true,
      durationMinutes: true,
      durationSeconds: true,
      smsCount: true,
      actualCostMicroUsd: true,
      billedCostMicroUsd: true,
      vapiCostMicroUsd: true,
      usageLineItemsJson: true,
      billingRecordedAt: true,
      installedAgentId: true,
      recordingUrl: true
    }
    }),
    prisma.installedAgent.findMany({
      where: { businessId: business.id },
      select: { id: true, name: true }
    }),
    loadServiceRoles()
  ]);
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));

  const totalDurationMinutes = calls.reduce((sum, call) => sum + (call.durationMinutes ?? 0), 0);
  const totalActualMicroUsd = calls.reduce((sum, call) => sum + (call.actualCostMicroUsd ?? 0), 0);
  const totalBilledMicroUsd = calls.reduce((sum, call) => sum + (call.billedCostMicroUsd ?? 0), 0);
  const totalVapiMicroUsd = calls.reduce((sum, call) => sum + (call.vapiCostMicroUsd ?? 0), 0);

  return successResponse(c, {
    month,
    businessId: business.id,
    businessName: business.name,
    totalCalls: calls.length,
    totalDurationMinutes,
    totalActualUsd: microUsdToUsd(totalActualMicroUsd),
    totalBilledUsd: microUsdToUsd(totalBilledMicroUsd),
    totalVapiReportedUsd: microUsdToUsd(totalVapiMicroUsd),
    updatedAt: calls[0]?.billingRecordedAt?.toISOString() ?? null,
    agentRollup: rollupAgentUsage(calls, agentNames, serviceRoles),
    serviceRollup: rollupLineItems(calls, serviceRoles),
    calls: calls.map((call) => ({
      callId: call.callId,
      customerPhone: call.customerPhone,
      installedAgentId: call.installedAgentId,
      durationMinutes: call.durationMinutes,
      durationSeconds: call.durationSeconds,
      smsCount: call.smsCount,
      actualCostUsd: call.actualCostMicroUsd ? microUsdToUsd(call.actualCostMicroUsd) : 0,
      billedCostUsd: call.billedCostMicroUsd ? microUsdToUsd(call.billedCostMicroUsd) : 0,
      vapiReportedCostUsd: call.vapiCostMicroUsd ? microUsdToUsd(call.vapiCostMicroUsd) : null,
      lineItems: Array.isArray(call.usageLineItemsJson)
        ? customerFacingLineItems(call.usageLineItemsJson as UsageLineItem[], serviceRoles)
        : [],
      recordedAt: call.billingRecordedAt?.toISOString() ?? null,
      recordingUrl: call.recordingUrl ?? null
    }))
  });
}

function serializeUsageInvoice(invoice: {
  id: string;
  invoiceNumber: string;
  billingMonth: string;
  status: string;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  dueAt: Date;
  totalMicroUsd: number;
  paidAt: Date | null;
  reminderCount: number;
  suspendedAt: Date | null;
  lineItems: Array<{
    serviceCode: string;
    serviceName: string;
    unit: string;
    quantity: number;
    unitPriceMicroUsd: number;
    amountMicroUsd: number;
  }>;
  calls: Array<{
    installedAgentId: string | null;
    durationMinutes: number | null;
    billedCostMicroUsd: number | null;
    usageLineItemsJson: unknown;
  }>;
}, agentNames: Map<string, string>, serviceRoles: ServiceRoleMap) {
  const agentBreakdown = rollupAgentUsage(invoice.calls, agentNames, serviceRoles);
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    billingMonth: invoice.billingMonth,
    status: invoice.status,
    currency: invoice.currency,
    periodStart: invoice.periodStart.toISOString(),
    periodEnd: invoice.periodEnd.toISOString(),
    issuedAt: invoice.issuedAt.toISOString(),
    dueAt: invoice.dueAt.toISOString(),
    totalMicroUsd: invoice.totalMicroUsd,
    totalUsd: microUsdToUsd(invoice.totalMicroUsd),
    amountCents: Math.round(invoice.totalMicroUsd / 10_000),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    reminderCount: invoice.reminderCount,
    suspendedAt: invoice.suspendedAt?.toISOString() ?? null,
    callCount: invoice.calls.length,
    agentBreakdown,
    lineItems: customerFacingLineItems(
      invoice.lineItems.map((item) => ({
        serviceCode: item.serviceCode,
        serviceName: item.serviceName,
        unit: item.unit as UsageLineItem["unit"],
        quantity: item.quantity,
        actualCostMicroUsd: 0,
        billedCostMicroUsd: item.amountMicroUsd
      })),
      serviceRoles
    ).map((item) => ({
      serviceCode: item.serviceCode,
      serviceName: item.serviceName,
      unit: item.unit,
      quantity: item.quantity,
      amountMicroUsd: item.billedCostMicroUsd,
      amountUsd: microUsdToUsd(item.billedCostMicroUsd)
    }))
  };
}

export async function getBusinessUsageInvoices(c: Context) {
  const authUser = c.get("authUser");
  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (!business) return successResponse(c, { invoices: [] });

  const [invoices, agents, serviceRoles] = await Promise.all([
    prisma.businessUsageInvoice.findMany({
      where: { businessId: business.id },
      orderBy: [{ billingMonth: "desc" }, { issuedAt: "desc" }],
      include: {
        lineItems: { orderBy: { amountMicroUsd: "desc" } },
        calls: {
          select: {
            installedAgentId: true,
            durationMinutes: true,
            billedCostMicroUsd: true,
            usageLineItemsJson: true
          }
        }
      }
    }),
    prisma.installedAgent.findMany({
      where: { businessId: business.id },
      select: { id: true, name: true }
    }),
    loadServiceRoles()
  ]);
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  return successResponse(c, {
    invoices: invoices.map((invoice) => serializeUsageInvoice(invoice, agentNames, serviceRoles))
  });
}

export async function payBusinessUsageInvoice(c: Context) {
  const authUser = c.get("authUser");
  const invoiceId = c.req.param("id");
  const invoice = await prisma.businessUsageInvoice.findFirst({
    where: { id: invoiceId, business: { ownerId: authUser.id } },
    include: { business: { select: { id: true } } }
  });
  if (!invoice) return errorResponse(c, "Invoice not found", 404, "USAGE_INVOICE_NOT_FOUND");
  if (invoice.status === "PAID") return successResponse(c, { invoiceId, alreadyPaid: true });
  if (invoice.status === "VOID") return errorResponse(c, "Invoice is void", 409, "USAGE_INVOICE_VOID");

  const stripe = getStripeClient();
  if (!stripe || !isStripeConfigured()) {
    return errorResponse(c, "Stripe is not configured", 503, "STRIPE_NOT_CONFIGURED");
  }

  const savedPayment = await prisma.payment.findFirst({
    where: {
      userId: authUser.id,
      stripeCustomerId: { not: null },
      stripePaymentId: { not: null },
      status: "SUCCEEDED"
    },
    orderBy: { createdAt: "desc" },
    select: { stripeCustomerId: true, stripePaymentId: true }
  });
  if (!savedPayment?.stripeCustomerId || !savedPayment.stripePaymentId) {
    return errorResponse(c, "No saved payment method is available", 409, "PAYMENT_METHOD_REQUIRED");
  }

  const amountCents = Math.round(invoice.totalMicroUsd / 10_000);
  if (amountCents < 50) {
    return errorResponse(c, "Invoice is below Stripe's $0.50 minimum charge", 409, "INVOICE_BELOW_MINIMUM");
  }

  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: invoice.currency,
    customer: savedPayment.stripeCustomerId,
    payment_method: savedPayment.stripePaymentId,
    confirm: true,
    off_session: true,
    description: `Triven usage invoice ${invoice.invoiceNumber}`,
    metadata: {
      usageInvoiceId: invoice.id,
      businessId: invoice.business.id,
      billingMonth: invoice.billingMonth
    }
  });

  if (intent.status !== "succeeded") {
    return errorResponse(c, "Payment requires attention", 409, "USAGE_INVOICE_PAYMENT_INCOMPLETE");
  }

  await prisma.businessUsageInvoice.update({
    where: { id: invoice.id },
    data: { status: "PAID", paidAt: new Date(), stripePaymentIntentId: intent.id }
  });
  const servicesRestored = await restoreBusinessAfterBillingPayment(invoice.business.id);
  return successResponse(c, { invoiceId, status: "PAID", servicesRestored }, "Invoice paid");
}
