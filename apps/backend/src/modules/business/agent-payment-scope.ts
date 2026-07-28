import {
  PaymentInvoiceKind,
  PaymentStatus,
  type Prisma
} from "@prisma/client";
import { prisma } from "../../lib/prisma";

export type AgentPaymentIdentity = {
  userId: string;
  businessId: string | null;
  listingId: string | null;
  installedAgentId: string | null;
};

export type AgentPaymentPeriod = AgentPaymentIdentity & {
  id: string;
  status: string;
  invoiceKind: string;
  createdAt: Date;
  paidAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueAt?: Date | null;
};

export function addUtcCalendarMonth(date: Date) {
  const targetMonthStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
  );
  const lastTargetDay = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0
    )
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth(),
      Math.min(date.getUTCDate(), lastTargetDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
}

/** The Nth monthly anniversary, clamped only when that month is shorter. */
export function utcBillingAnniversary(anchorAt: Date, monthOffset: number) {
  const absoluteMonth =
    anchorAt.getUTCFullYear() * 12 +
    anchorAt.getUTCMonth() +
    Math.trunc(monthOffset);
  const year = Math.floor(absoluteMonth / 12);
  const month = ((absoluteMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(anchorAt.getUTCDate(), lastDay),
      anchorAt.getUTCHours(),
      anchorAt.getUTCMinutes(),
      anchorAt.getUTCSeconds(),
      anchorAt.getUTCMilliseconds()
    )
  );
}

export function nextUtcBillingAnniversary(anchorAt: Date, after: Date) {
  let monthOffset =
    (after.getUTCFullYear() - anchorAt.getUTCFullYear()) * 12 +
    after.getUTCMonth() -
    anchorAt.getUTCMonth() +
    1;
  let candidate = utcBillingAnniversary(anchorAt, monthOffset);
  while (candidate <= after) {
    monthOffset += 1;
    candidate = utcBillingAnniversary(anchorAt, monthOffset);
  }
  return candidate;
}

export type AgentBillingPeriod = {
  key: string;
  start: Date;
  end: Date;
  dueAt: Date;
  graceEndsAt: Date;
};

export function agentBillingPeriodFor(
  anchorAt: Date,
  occurredAt: Date
): AgentBillingPeriod {
  let monthOffset =
    (occurredAt.getUTCFullYear() - anchorAt.getUTCFullYear()) * 12 +
    occurredAt.getUTCMonth() -
    anchorAt.getUTCMonth();
  let start = utcBillingAnniversary(anchorAt, monthOffset);
  if (occurredAt < start) {
    monthOffset -= 1;
    start = utcBillingAnniversary(anchorAt, monthOffset);
  }
  const end = utcBillingAnniversary(anchorAt, monthOffset + 1);
  return {
    key: start.toISOString().slice(0, 7),
    start,
    end,
    dueAt: end,
    graceEndsAt: new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000)
  };
}

export type AgentBillingAnchorPayment = Pick<
  AgentPaymentPeriod,
  | "status"
  | "invoiceKind"
  | "createdAt"
  | "paidAt"
  | "periodStart"
  | "periodEnd"
  | "dueAt"
>;

function paymentAnchorDate(payment: AgentBillingAnchorPayment) {
  return (
    payment.periodStart ??
    payment.paidAt ??
    payment.dueAt ??
    payment.createdAt
  );
}

/**
 * Direct paid purchases establish the anniversary. Trial time is not counted:
 * when no purchase exists yet, post-trial billing starts at the trial end.
 */
export function agentBillingAnchorAt(input: {
  agentCreatedAt: Date;
  referenceAt: Date;
  payments: AgentBillingAnchorPayment[];
}) {
  const payments = [...input.payments].sort(
    (left, right) =>
      paymentAnchorDate(left).getTime() - paymentAnchorDate(right).getTime()
  );
  const paidPurchase = payments.find(
    (payment) =>
      payment.status === PaymentStatus.SUCCEEDED &&
      payment.invoiceKind === PaymentInvoiceKind.PURCHASE
  );
  if (paidPurchase) return paymentAnchorDate(paidPurchase);

  const paidEntitlement = payments.find(
    (payment) =>
      payment.status === PaymentStatus.SUCCEEDED &&
      payment.invoiceKind !== PaymentInvoiceKind.TRIAL
  );
  if (paidEntitlement) return paymentAnchorDate(paidEntitlement);

  const postTrial = payments.find(
    (payment) =>
      payment.invoiceKind === PaymentInvoiceKind.POST_TRIAL &&
      payment.status !== PaymentStatus.CANCELED
  );
  if (postTrial) return paymentAnchorDate(postTrial);

  const trial = payments.find(
    (payment) => payment.invoiceKind === PaymentInvoiceKind.TRIAL
  );
  if (trial) {
    if (trial.periodEnd && input.referenceAt >= trial.periodEnd) {
      return trial.periodEnd;
    }
    return trial.periodStart ?? trial.createdAt;
  }

  return input.agentCreatedAt;
}

export async function resolveAgentBillingPeriod(
  tx: Prisma.TransactionClient,
  agent: {
    id: string;
    businessId: string;
    listingId: string | null;
    createdAt: Date;
    ownerUserId: string;
  },
  occurredAt: Date
) {
  const payments = agent.listingId
    ? await tx.payment.findMany({
        where: {
          userId: agent.ownerUserId,
          listingId: agent.listingId,
          OR: [{ businessId: agent.businessId }, { businessId: null }],
          AND: [
            {
              OR: [
                { installedAgentId: agent.id },
                { installedAgentId: null }
              ]
            }
          ]
        },
        orderBy: [{ periodStart: "asc" }, { createdAt: "asc" }],
        select: {
          status: true,
          invoiceKind: true,
          createdAt: true,
          paidAt: true,
          periodStart: true,
          periodEnd: true,
          dueAt: true
        }
      })
    : [];
  const anchorAt = agentBillingAnchorAt({
    agentCreatedAt: agent.createdAt,
    referenceAt: occurredAt,
    payments
  });
  return {
    anchorAt,
    ...agentBillingPeriodFor(anchorAt, occurredAt)
  };
}

export function nextSubscriptionInvoicePeriod(
  paid: Pick<
    AgentPaymentPeriod,
    "createdAt" | "paidAt" | "periodStart" | "periodEnd"
  >,
  anchorAt?: Date
) {
  const paidPeriodStart = paid.periodStart ?? paid.paidAt ?? paid.createdAt;
  const start = paid.periodEnd ?? addUtcCalendarMonth(paidPeriodStart);
  return {
    start,
    end: anchorAt
      ? nextUtcBillingAnniversary(anchorAt, start)
      : addUtcCalendarMonth(start)
  };
}

export function initialAgentPurchasePeriod(
  pricingModel: string,
  purchasedAt: Date
) {
  return {
    start: purchasedAt,
    end:
      pricingModel === "SUBSCRIPTION"
        ? addUtcCalendarMonth(purchasedAt)
        : null
  };
}

export function sameInstalledAgentPaymentScope(
  left: AgentPaymentIdentity,
  right: AgentPaymentIdentity
) {
  if (left.userId !== right.userId) return false;
  if (
    left.businessId &&
    right.businessId &&
    left.businessId !== right.businessId
  ) {
    return false;
  }
  if (left.installedAgentId && right.installedAgentId) {
    return left.installedAgentId === right.installedAgentId;
  }
  return Boolean(
    left.listingId &&
      right.listingId &&
      left.listingId === right.listingId
  );
}

export function paymentsForInstalledAgent<
  T extends AgentPaymentIdentity
>(
  payments: T[],
  agent: {
    id: string;
    businessId: string;
    listingId: string | null;
  }
) {
  return payments.filter((payment) => {
    if (payment.installedAgentId) {
      return payment.installedAgentId === agent.id;
    }
    return Boolean(
      agent.listingId &&
        payment.listingId === agent.listingId &&
        (!payment.businessId || payment.businessId === agent.businessId)
    );
  });
}

export function paidPaymentCoversAgentInvoice(
  paid: AgentPaymentPeriod,
  debt: AgentPaymentPeriod,
  pricingModel: string
) {
  if (paid.status !== PaymentStatus.SUCCEEDED) return false;
  if (
    debt.status !== PaymentStatus.PENDING &&
    debt.status !== PaymentStatus.OVERDUE
  ) {
    return false;
  }
  if (!sameInstalledAgentPaymentScope(paid, debt)) return false;

  if (pricingModel === "ONE_TIME") return true;

  const paidStart = paid.periodStart ?? paid.paidAt ?? paid.createdAt;
  const paidEnd = paid.periodEnd ?? addUtcCalendarMonth(paidStart);
  const debtStart = debt.periodStart ?? debt.dueAt ?? debt.createdAt;
  const debtEnd = debt.periodEnd ?? addUtcCalendarMonth(debtStart);

  return paidStart < debtEnd && paidEnd > debtStart;
}

export async function reconcileCoveredAgentInvoices(input: {
  userId?: string;
  businessId?: string | null;
  listingId?: string | null;
  installedAgentId?: string | null;
  now?: Date;
} = {}) {
  const debts = await prisma.payment.findMany({
    where: {
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.businessId ? { businessId: input.businessId } : {}),
      ...(input.listingId ? { listingId: input.listingId } : {}),
      ...(input.installedAgentId
        ? {
            OR: [
              { installedAgentId: input.installedAgentId },
              {
                installedAgentId: null,
                ...(input.listingId ? { listingId: input.listingId } : {})
              }
            ]
          }
        : {}),
      status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] },
      invoiceKind: {
        in: [
          PaymentInvoiceKind.POST_TRIAL,
          PaymentInvoiceKind.SUBSCRIPTION_RENEWAL
        ]
      }
    },
    select: {
      id: true,
      userId: true,
      businessId: true,
      listingId: true,
      installedAgentId: true,
      status: true,
      invoiceKind: true,
      createdAt: true,
      paidAt: true,
      periodStart: true,
      periodEnd: true,
      dueAt: true,
      listing: { select: { pricingModel: true } }
    }
  });
  if (debts.length === 0) {
    return { canceledInvoiceIds: [], businessIds: [] };
  }

  const listingIds = [
    ...new Set(
      debts
        .map((debt) => debt.listingId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const installedAgentIds = [
    ...new Set(
      debts
        .map((debt) => debt.installedAgentId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const paid = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.SUCCEEDED,
      ...(input.userId ? { userId: input.userId } : {}),
      OR: [
        ...(installedAgentIds.length > 0
          ? [{ installedAgentId: { in: installedAgentIds } }]
          : []),
        ...(listingIds.length > 0
          ? [{ listingId: { in: listingIds } }]
          : [])
      ]
    },
    select: {
      id: true,
      userId: true,
      businessId: true,
      listingId: true,
      installedAgentId: true,
      status: true,
      invoiceKind: true,
      createdAt: true,
      paidAt: true,
      periodStart: true,
      periodEnd: true,
      dueAt: true
    }
  });

  const canceledInvoiceIds = debts
    .filter((debt) =>
      paid.some((payment) =>
        paidPaymentCoversAgentInvoice(
          payment,
          debt,
          debt.listing?.pricingModel ?? "ONE_TIME"
        )
      )
    )
    .map((debt) => debt.id);

  if (canceledInvoiceIds.length === 0) {
    return { canceledInvoiceIds, businessIds: [] };
  }

  const canceledAt = input.now ?? new Date();
  await prisma.payment.updateMany({
    where: { id: { in: canceledInvoiceIds } },
    data: {
      status: PaymentStatus.CANCELED,
      canceledAt,
      suspendedAt: null,
      paymentPendingAt: null
    }
  });

  return {
    canceledInvoiceIds,
    businessIds: [
      ...new Set(
        debts
          .filter((debt) => canceledInvoiceIds.includes(debt.id))
          .map((debt) => debt.businessId)
          .filter((id): id is string => Boolean(id))
      )
    ]
  };
}
