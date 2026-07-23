import { PaymentStatus } from "@prisma/client";

export type PaymentLineItem = { label: string; amountCents: number };

export type PaymentWithListing = {
  id: string;
  listingId: string | null;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  invoiceKind?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  dueAt?: Date | null;
  graceEndsAt?: Date | null;
  paidAt?: Date | null;
  suspendedAt?: Date | null;
  billingName?: string | null;
  billingEmail?: string | null;
  billingAddress?: string | null;
  lineItemsJson?: unknown;
  listing?: {
    id: string;
    name: string;
    priceCents?: number;
    trialDays?: number | null;
    pricingModel?: string | null;
  } | null;
};

/**
 * The agent-price portion of a payment — the first breakdown row. Platform
 * fees (e.g. the number fee) ride on later rows and must not feed architect
 * earnings/payouts. Payments without a breakdown are all agent price.
 */
export function paymentAgentGrossCents(payment: {
  amountCents: number;
  lineItemsJson?: unknown;
}): number {
  const items = parsePaymentLineItems(payment.lineItemsJson);
  return items ? items[0]?.amountCents ?? payment.amountCents : payment.amountCents;
}

/** Validated fee breakdown from Payment.lineItemsJson (null when absent/invalid). */
export function parsePaymentLineItems(value: unknown): PaymentLineItem[] | null {
  if (!Array.isArray(value)) return null;

  const items = value.filter(
    (item): item is PaymentLineItem =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { label?: unknown }).label === "string" &&
      typeof (item as { amountCents?: unknown }).amountCents === "number"
  );

  return items.length > 0 ? items : null;
}

const INVOICE_HISTORY_STATUSES: PaymentStatus[] = [
  PaymentStatus.TRIALING,
  PaymentStatus.SUCCEEDED,
  PaymentStatus.PENDING,
  PaymentStatus.COMPLETED,
  PaymentStatus.OVERDUE,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELED,
  PaymentStatus.REFUNDED
];

export function invoiceDisplayAmountCents(payment: {
  status: string;
  amountCents: number;
  invoiceKind?: string | null;
  lineItemsJson?: unknown;
  listing?: { priceCents?: number } | null;
}) {
  const status = payment.status.toUpperCase();
  const isTrial =
    payment.invoiceKind === "TRIAL" ||
    (!payment.invoiceKind && (status === "TRIALING" || status === "COMPLETED"));

  if (isTrial && status === "TRIALING") {
    return 0;
  }
  if (isTrial && status === "COMPLETED") {
    const recordedAmount =
      parsePaymentLineItems(payment.lineItemsJson)?.[0]?.amountCents ??
      payment.amountCents;
    return recordedAmount > 0
      ? recordedAmount
      : payment.listing?.priceCents ?? 0;
  }
  if (
    status === "SUCCEEDED" ||
    status === "PAID" ||
    status === "PENDING" ||
    status === "OVERDUE"
  ) {
    return payment.amountCents;
  }
  return 0;
}

export function invoiceDateForPayment(
  payment: Pick<PaymentWithListing, "status" | "createdAt" | "updatedAt" | "paidAt">
) {
  if (payment.status === PaymentStatus.SUCCEEDED) {
    return payment.paidAt ?? payment.updatedAt;
  }

  return payment.createdAt;
}

export function buildBillingInvoices(payments: PaymentWithListing[]) {
  const invoices: Array<{
    id: string;
    createdAt: string;
    description: string;
    amountCents: number;
    displayAmountCents: number;
    currency: string;
    status: string;
    lifecycleStatus: string;
    tabStatus: "PAID" | "PENDING" | "OVERDUE";
    invoiceKind: string;
    listingId: string | null;
    listingName: string | null;
    billingName: string | null;
    billingEmail: string | null;
    billingAddress: string | null;
    lineItems: PaymentLineItem[] | null;
    periodStart: string | null;
    periodEnd: string | null;
    dueAt: string | null;
    graceEndsAt: string | null;
    paidAt: string | null;
    suspendedAt: string | null;
  }> = [];

  for (const payment of payments) {
    if (!payment.listingId) continue;
    if (!INVOICE_HISTORY_STATUSES.includes(payment.status)) continue;

    const isTrial =
      payment.invoiceKind === "TRIAL" ||
      (!payment.invoiceKind &&
        (payment.status === PaymentStatus.TRIALING ||
          (payment.description ?? "").toLowerCase().includes("trial")));
    if (payment.status === PaymentStatus.CANCELED && !isTrial) continue;

    const lifecycleStatus = isTrial
      ? payment.status === PaymentStatus.TRIALING
        ? "TRIALING"
        : "COMPLETED"
      : payment.status;
    const status =
      isTrial
        ? lifecycleStatus
        : payment.status === PaymentStatus.SUCCEEDED
          ? "PAID"
          : payment.status === PaymentStatus.OVERDUE
            ? "OVERDUE"
            : payment.status === PaymentStatus.PENDING
              ? "PENDING"
              : payment.status;
    const tabStatus: "PAID" | "PENDING" | "OVERDUE" =
      status === "OVERDUE"
        ? "OVERDUE"
        : status === "PENDING"
          ? "PENDING"
          : "PAID";

    invoices.push({
      id: payment.id,
      createdAt: invoiceDateForPayment(payment).toISOString(),
      description: payment.description ?? (payment.listing ? payment.listing.name : "Payment"),
      amountCents: payment.amountCents,
      displayAmountCents: invoiceDisplayAmountCents(payment),
      currency: payment.currency,
      status,
      lifecycleStatus,
      tabStatus,
      invoiceKind: isTrial ? "TRIAL" : payment.invoiceKind ?? "PURCHASE",
      listingId: payment.listingId,
      listingName: payment.listing?.name ?? null,
      billingName: payment.billingName ?? null,
      billingEmail: payment.billingEmail ?? null,
      billingAddress: payment.billingAddress ?? null,
      lineItems: parsePaymentLineItems(payment.lineItemsJson),
      periodStart: payment.periodStart?.toISOString() ?? null,
      periodEnd: payment.periodEnd?.toISOString() ?? null,
      dueAt: payment.dueAt?.toISOString() ?? null,
      graceEndsAt: payment.graceEndsAt?.toISOString() ?? null,
      paidAt: payment.paidAt?.toISOString() ?? null,
      suspendedAt: payment.suspendedAt?.toISOString() ?? null
    });
  }

  return invoices.sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

export function sumInvoiceTotalCents(payments: PaymentWithListing[]) {
  return buildBillingInvoices(payments).reduce(
    (sum, invoice) =>
      sum +
      (invoice.tabStatus === "PAID" && invoice.invoiceKind !== "TRIAL"
        ? invoice.displayAmountCents
        : 0),
    0
  );
}

export type DashboardActivity = {
  id: string;
  type: string;
  text: string;
  badge: string;
  tone: "green" | "amber" | "slate";
  check?: boolean;
  createdAt: string;
};

export function buildDashboardActivities(
  payments: PaymentWithListing[],
  installedAgents: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }>
): DashboardActivity[] {
  const activities: DashboardActivity[] = [];

  for (const payment of payments) {
    const agentName = payment.listing?.name ?? "Agent";

    if (payment.status === PaymentStatus.TRIALING) {
      const trialDays = payment.listing?.trialDays ?? 7;
      activities.push({
        id: `trial-${payment.id}`,
        type: "trial_started",
        text: `Started ${trialDays}-day free trial for ${agentName}`,
        badge: "Trial started",
        tone: "amber",
        createdAt: payment.createdAt.toISOString()
      });
    }

    if (payment.status === PaymentStatus.SUCCEEDED) {
      activities.push({
        id: `purchase-${payment.id}`,
        type: "purchase_completed",
        text: `Purchased ${agentName} — paid plan activated`,
        badge: "Paid",
        tone: "green",
        check: true,
        createdAt: invoiceDateForPayment(payment).toISOString()
      });
    }

    if (payment.status === PaymentStatus.PENDING) {
      activities.push({
        id: `pending-${payment.id}`,
        type: "payment_pending",
        text: `Payment pending for ${agentName}`,
        badge: "Pending",
        tone: "slate",
        createdAt: payment.createdAt.toISOString()
      });
    }

    if (payment.status === PaymentStatus.FAILED) {
      activities.push({
        id: `failed-${payment.id}`,
        type: "payment_failed",
        text: `Payment failed for ${agentName}`,
        badge: "Failed",
        tone: "slate",
        createdAt: payment.updatedAt.toISOString()
      });
    }
  }

  for (const agent of installedAgents) {
    const isLive = agent.status.toUpperCase() === "ACTIVE";

    activities.push({
      id: `setup-${agent.id}`,
      type: "agent_setup",
      text: isLive
        ? `Set up ${agent.name} — agent is live`
        : `Configured ${agent.name}`,
      badge: isLive ? "Live" : "Configured",
      tone: isLive ? "green" : "amber",
      check: isLive,
      createdAt: agent.updatedAt.toISOString()
    });
  }

  return activities
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 30);
}
