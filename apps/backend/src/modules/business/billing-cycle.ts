import type { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { isPlatformMailConfigured, sendPlatformEmail } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { parsePaymentLineItems, type PaymentLineItem } from "../../lib/billing-invoices";
import {
  billingMonthFor,
  monthLabel,
  reconcileBusinessExecutionUsage,
  usageBalanceIsCollectible
} from "./execution-billing";
import {
  buildAgentPurchaseLineItems,
  listingNeedsPhoneNumber,
  resolveUnbilledPhoneFee
} from "./phone-provisioning";

const DAY_MS = 24 * 60 * 60 * 1000;

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function utcMonthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextUtcMonthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function graceEndFor(dueAt: Date) {
  return new Date(dueAt.getTime() + 7 * DAY_MS);
}

function reminderAlreadySentToday(lastReminderAt: Date | null, now: Date) {
  return Boolean(
    lastReminderAt &&
      lastReminderAt.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)
  );
}

async function suspendPhones(
  phones: Array<{ id: string; configJson: unknown }>,
  kind: "USAGE" | "SUBSCRIPTION",
  sourceId: string
) {
  await Promise.all(
    phones.map((phone) => {
      const config = jsonRecord(phone.configJson);
      const kinds = Array.isArray(config.billingSuspensionKinds)
        ? config.billingSuspensionKinds.filter(
            (value): value is string => typeof value === "string"
          )
        : [];
      const sources = Array.isArray(config.billingSuspensionSourceIds)
        ? config.billingSuspensionSourceIds.filter(
            (value): value is string => typeof value === "string"
          )
        : [];
      return prisma.businessPhoneNumber.update({
        where: { id: phone.id },
        data: {
          isActive: false,
          configJson: {
            ...config,
            billingSuspended: true,
            billingSuspensionKinds: [...new Set([...kinds, kind])],
            billingSuspensionSourceIds: [...new Set([...sources, sourceId])]
          } as Prisma.InputJsonValue
        }
      });
    })
  );
}

async function suspendBusinessForUsageInvoice(invoiceId: string, now: Date) {
  const invoice = await prisma.businessUsageInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, businessId: true, suspendedAt: true }
  });
  if (!invoice) return false;

  const phones = await prisma.businessPhoneNumber.findMany({
    where: { businessId: invoice.businessId, isActive: true },
    select: { id: true, configJson: true }
  });

  await prisma.$transaction([
    prisma.installedAgent.updateMany({
      where: {
        businessId: invoice.businessId,
        installSource: { not: "ARCHITECT_SELF_TEST" },
        status: { in: ["ACTIVE", "PROVISIONING"] }
      },
      data: { status: "SUSPENDED_BILLING" }
    }),
    prisma.businessUsageInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "OVERDUE",
        suspendedAt: invoice.suspendedAt ?? now
      }
    })
  ]);
  await suspendPhones(phones, "USAGE", invoice.id);
  return !invoice.suspendedAt || phones.length > 0;
}

async function suspendAgentForPayment(paymentId: string, now: Date) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      businessId: true,
      listingId: true,
      suspendedAt: true,
      userId: true
    }
  });
  if (!payment || !payment.listingId) return false;

  const installedAgent = await prisma.installedAgent.findFirst({
    where: {
      listingId: payment.listingId,
      ...(payment.businessId
        ? { businessId: payment.businessId }
        : { business: { ownerId: payment.userId } })
    },
    select: { id: true, businessId: true, status: true }
  });
  if (!installedAgent) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { suspendedAt: now }
    });
    return false;
  }

  const phones = await prisma.businessPhoneNumber.findMany({
    where: { installedAgentId: installedAgent.id, isActive: true },
    select: { id: true, configJson: true }
  });
  await prisma.$transaction([
    prisma.installedAgent.updateMany({
      where: {
        id: installedAgent.id,
        status: { in: ["ACTIVE", "PROVISIONING"] }
      },
      data: { status: "SUSPENDED_BILLING" }
    }),
    prisma.payment.update({
      where: { id: payment.id },
      data: { suspendedAt: payment.suspendedAt ?? now }
    })
  ]);
  await suspendPhones(phones, "SUBSCRIPTION", payment.id);
  return !payment.suspendedAt || phones.length > 0;
}

async function hasSuspendingSubscriptionDebt(
  businessId: string,
  listingId: string | null
) {
  if (!listingId) return false;
  const blocking = await prisma.payment.aggregate({
    where: {
      businessId,
      listingId,
      status: "OVERDUE",
      invoiceKind: { in: ["POST_TRIAL", "SUBSCRIPTION_RENEWAL"] },
      graceEndsAt: { lte: new Date() }
    },
    _sum: { amountCents: true }
  });
  return (blocking._sum.amountCents ?? 0) >= 50;
}

/**
 * Restores billing-suspended services after a successful payment.
 *
 * Usage debt is business-wide: one usage invoice beyond grace pauses every
 * buyer service. Subscription/post-trial debt is scoped to its installed
 * agent. An agent is restored only after both blocking categories are clear.
 */
export async function restoreBusinessAfterBillingPayment(
  businessId: string,
  _installedAgentId?: string | null
) {
  const usageStillBlocking =
    (await prisma.businessUsageInvoice.count({
      where: {
        businessId,
        status: "OVERDUE",
        suspendedAt: { not: null }
      }
    })) > 0;
  if (usageStillBlocking) return false;

  const suspendedAgents = await prisma.installedAgent.findMany({
    where: { businessId, status: "SUSPENDED_BILLING" },
    select: { id: true, listingId: true }
  });
  const restoredAgentIds: string[] = [];
  for (const agent of suspendedAgents) {
    if (await hasSuspendingSubscriptionDebt(businessId, agent.listingId)) continue;
    await prisma.installedAgent.update({
      where: { id: agent.id },
      data: { status: "ACTIVE" }
    });
    restoredAgentIds.push(agent.id);
  }

  const phones = await prisma.businessPhoneNumber.findMany({
    where: { businessId },
    select: { id: true, installedAgentId: true, configJson: true }
  });
  for (const phone of phones) {
    const config = jsonRecord(phone.configJson);
    if (config.billingSuspended !== true) continue;
    const subscriptionStillBlocking = phone.installedAgentId
      ? !restoredAgentIds.includes(phone.installedAgentId) &&
        (await hasSuspendingSubscriptionDebt(
          businessId,
          (
            await prisma.installedAgent.findUnique({
              where: { id: phone.installedAgentId },
              select: { listingId: true }
            })
          )?.listingId ?? null
        ))
      : false;
    if (subscriptionStillBlocking) continue;

    delete config.billingSuspended;
    delete config.billingSuspensionKinds;
    delete config.billingSuspensionSourceIds;
    await prisma.businessPhoneNumber.update({
      where: { id: phone.id },
      data: { isActive: true, configJson: config as Prisma.InputJsonValue }
    });
  }

  return restoredAgentIds.length > 0 || phones.length > 0;
}

async function completedTrialLineItems(trial: {
  id: string;
  userId: string;
  businessId: string | null;
  amountCents: number;
  lineItemsJson: unknown;
  listing: { id: string; name: string; priceCents: number };
}) {
  const pinned = parsePaymentLineItems(trial.lineItemsJson);
  if (pinned) return pinned;

  const unbilledPhoneFee = (await listingNeedsPhoneNumber(trial.listing.id))
    ? await resolveUnbilledPhoneFee({
        buyerUserId: trial.userId,
        businessId: trial.businessId
      })
    : null;
  return buildAgentPurchaseLineItems({
    agentLabel: trial.listing.name,
    agentPriceCents: trial.amountCents,
    phoneFee: unbilledPhoneFee?.fee ?? null
  });
}

async function completeExpiredTrials(now: Date) {
  const trials = await prisma.payment.findMany({
    where: { status: "TRIALING", listingId: { not: null } },
    include: {
      listing: {
        select: {
          id: true,
          name: true,
          priceCents: true,
          trialDays: true
        }
      }
    }
  });

  let completed = 0;
  let overdueCreated = 0;
  for (const trial of trials) {
    if (!trial.listing) continue;
    const listing = trial.listing;
    const days = Math.max(0, listing.trialDays || 0);
    const endsAt = trial.periodEnd ?? new Date(trial.createdAt.getTime() + days * DAY_MS);
    if (now < endsAt) continue;

    const invoiceKey = `post-trial:${trial.id}`;
    const lineItems = await completedTrialLineItems({
      ...trial,
      listing
    });
    const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceKey}))`;
      const fresh = await tx.payment.findUnique({
        where: { id: trial.id },
        select: { status: true }
      });
      const existing = await tx.payment.findUnique({ where: { invoiceKey } });
      if (fresh?.status !== "TRIALING") return { changed: false, created: false };

      await tx.payment.update({
        where: { id: trial.id },
        data: {
          status: "COMPLETED",
          invoiceKind: "TRIAL",
          periodEnd: endsAt,
          paidAt: endsAt
        }
      });
      if (existing || totalCents <= 0) {
        return { changed: true, created: false };
      }

      await tx.payment.create({
        data: {
          userId: trial.userId,
          businessId: trial.businessId,
          listingId: trial.listingId,
          amountCents: totalCents,
          currency: trial.currency,
          status: "OVERDUE",
          invoiceKind: "POST_TRIAL",
          invoiceKey,
          periodStart: endsAt,
          periodEnd: nextUtcMonthStart(endsAt),
          dueAt: endsAt,
          graceEndsAt: graceEndFor(endsAt),
          stripeCustomerId: trial.stripeCustomerId,
          stripePaymentId: trial.stripePaymentId,
          billingName: trial.billingName,
          billingEmail: trial.billingEmail,
          billingAddress: trial.billingAddress,
          description: `${listing.name} plan after trial`,
          lineItemsJson: lineItems as never
        }
      });
      return { changed: true, created: true };
    });
    if (outcome.changed) completed += 1;
    if (outcome.created) overdueCreated += 1;
  }
  return { completed, overdueCreated };
}

async function createCalendarSubscriptionInvoices(now: Date) {
  const periodStart = utcMonthStart(now);
  const periodEnd = nextUtcMonthStart(now);
  const billingPeriod = billingMonthFor(periodStart);
  const agents = await prisma.installedAgent.findMany({
    where: {
      installSource: { not: "ARCHITECT_SELF_TEST" },
      status: { notIn: ["CANCELED", "INACTIVE"] },
      listingId: { not: null },
      listing: { is: { pricingModel: "SUBSCRIPTION", priceCents: { gt: 0 } } }
    },
    include: {
      business: { select: { ownerId: true } },
      listing: { select: { id: true, name: true, priceCents: true } }
    }
  });

  let created = 0;
  for (const agent of agents) {
    if (!agent.listing || !agent.listingId) continue;
    // Calendar billing starts on the first full month after this feature (or
    // acquisition for new installs), preventing retroactive renewals.
    const firstDue = nextUtcMonthStart(
      agent.createdAt > agent.executionBillingStartedAt
        ? agent.createdAt
        : agent.executionBillingStartedAt
    );
    if (periodStart < firstDue) continue;

    const invoiceKey =
      `subscription:${agent.businessId}:${agent.listingId}:${billingPeriod}`;
    const exists = await prisma.payment.findUnique({
      where: { invoiceKey },
      select: { id: true }
    });
    if (exists) continue;

    const [latestPaid, unresolvedPostTrial] = await Promise.all([
      prisma.payment.findFirst({
        where: {
          userId: agent.business.ownerId,
          OR: [{ businessId: agent.businessId }, { businessId: null }],
          listingId: agent.listingId,
          status: "SUCCEEDED"
        },
        orderBy: { createdAt: "desc" }
      }),
      prisma.payment.count({
        where: {
          userId: agent.business.ownerId,
          OR: [{ businessId: agent.businessId }, { businessId: null }],
          listingId: agent.listingId,
          invoiceKind: "POST_TRIAL",
          status: "OVERDUE"
        }
      })
    ]);
    if (!latestPaid || unresolvedPostTrial > 0) continue;
    if (latestPaid.periodEnd && latestPaid.periodEnd > periodStart) continue;
    const pinnedPlanCents =
      parsePaymentLineItems(latestPaid.lineItemsJson)?.[0]?.amountCents ??
      latestPaid.amountCents;

    try {
      await prisma.payment.create({
        data: {
          userId: agent.business.ownerId,
          businessId: agent.businessId,
          listingId: agent.listingId,
          amountCents: pinnedPlanCents,
          currency: latestPaid.currency,
          status: "OVERDUE",
          invoiceKind: "SUBSCRIPTION_RENEWAL",
          invoiceKey,
          periodStart,
          periodEnd,
          dueAt: periodStart,
          graceEndsAt: graceEndFor(periodStart),
          stripeCustomerId: latestPaid.stripeCustomerId,
          stripePaymentId: latestPaid.stripePaymentId,
          billingName: latestPaid.billingName,
          billingEmail: latestPaid.billingEmail,
          billingAddress: latestPaid.billingAddress,
          description: `${monthLabel(billingPeriod)} subscription for ${agent.listing.name}`,
          lineItemsJson: [
            {
              label: `${agent.listing.name} monthly plan`,
              amountCents: pinnedPlanCents
            }
          ] as PaymentLineItem[] as never
        }
      });
      created += 1;
    } catch (error) {
      // invoiceKey is unique: a concurrent hourly scheduler already won.
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "P2002"
        )
      ) {
        throw error;
      }
    }
  }
  return { billingPeriod, created };
}

async function sendUsageReminder(invoice: {
  invoiceNumber: string;
  billingMonth: string;
  totalMicroUsd: number;
  dueAt: Date;
  business: {
    name: string;
    billingEmail: string | null;
    owner: { email: string; fullName: string | null };
  };
}) {
  if (!isPlatformMailConfigured()) return false;
  const amount = (invoice.totalMicroUsd / 1_000_000).toFixed(2);
  const to = invoice.business.billingEmail || invoice.business.owner.email;
  const billingUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/business/billingandusage`;
  await sendPlatformEmail({
    purpose: "billing",
    to,
    subject: `Usage invoice ${invoice.invoiceNumber} is overdue`,
    text: `Your ${monthLabel(invoice.billingMonth)} execution invoice is $${amount}. Pay before the end of the 7-day grace period to avoid service suspension. ${billingUrl}`,
    html: `<p>Hi ${invoice.business.owner.fullName || invoice.business.name},</p><p>Your execution invoice <strong>${invoice.invoiceNumber}</strong> is <strong>$${amount}</strong>.</p><p>Please pay before the end of the 7-day grace period to avoid service suspension.</p><p><a href="${billingUrl}">View and pay invoice</a></p>`
  });
  return true;
}

async function processUsageInvoiceLifecycle(now: Date) {
  await prisma.businessUsageInvoice.updateMany({
    where: {
      status: { in: ["PENDING", "OPEN"] },
      paidAt: null,
      dueAt: { lte: now }
    },
    data: { status: "OVERDUE" }
  });

  const invoices = await prisma.businessUsageInvoice.findMany({
    where: { status: "OVERDUE", paidAt: null },
    include: {
      business: {
        select: {
          name: true,
          billingEmail: true,
          owner: { select: { email: true, fullName: true } }
        }
      }
    }
  });
  let remindersSent = 0;
  let suspended = 0;
  const overdueTotals = new Map<string, number>();
  for (const overdue of invoices) {
    const key = `${overdue.businessId}:${overdue.installedAgentId ?? "legacy"}`;
    overdueTotals.set(
      key,
      (overdueTotals.get(key) ?? 0) + overdue.totalMicroUsd
    );
  }
  for (const invoice of invoices) {
    const suspendAt = invoice.graceEndsAt ?? invoice.dueAt;
    if (now >= suspendAt) {
      const scopeKey = `${invoice.businessId}:${invoice.installedAgentId ?? "legacy"}`;
      if (!usageBalanceIsCollectible(overdueTotals.get(scopeKey) ?? 0)) {
        // Stripe cannot collect less than $0.50. Keep the balance overdue and
        // carry it into a later same-agent statement without suspending service.
        continue;
      }
      if (await suspendBusinessForUsageInvoice(invoice.id, now)) suspended += 1;
      continue;
    }
    if (!reminderAlreadySentToday(invoice.lastReminderAt, now)) {
      try {
        if (await sendUsageReminder(invoice)) {
          await prisma.businessUsageInvoice.update({
            where: { id: invoice.id },
            data: {
              reminderCount: { increment: 1 },
              lastReminderAt: now
            }
          });
          remindersSent += 1;
        }
      } catch (error) {
        console.error("[billing-cycle] usage reminder failed", {
          invoiceId: invoice.id,
          error
        });
      }
    }
  }
  return { considered: invoices.length, remindersSent, suspended };
}

async function processAgentDebtSuspensions(now: Date) {
  const payments = await prisma.payment.findMany({
    where: {
      status: "OVERDUE",
      invoiceKind: { in: ["POST_TRIAL", "SUBSCRIPTION_RENEWAL"] },
      amountCents: { gte: 50 },
      suspendedAt: null,
      graceEndsAt: { lte: now }
    },
    select: {
      id: true,
      businessId: true,
      userId: true,
      listingId: true,
      amountCents: true
    }
  });
  const totals = new Map<string, number>();
  for (const payment of payments) {
    const key = `${payment.businessId ?? `owner:${payment.userId}`}:${payment.listingId}`;
    totals.set(key, (totals.get(key) ?? 0) + payment.amountCents);
  }
  let suspended = 0;
  for (const payment of payments) {
    const key = `${payment.businessId ?? `owner:${payment.userId}`}:${payment.listingId}`;
    if ((totals.get(key) ?? 0) < 50) continue;
    if (await suspendAgentForPayment(payment.id, now)) suspended += 1;
  }
  return { considered: payments.length, suspended };
}

let initialExecutionReconciliationComplete = false;

async function reconcileCanonicalExecutions(now: Date) {
  const businesses = await prisma.installedAgent.findMany({
    where: { installSource: { not: "ARCHITECT_SELF_TEST" } },
    distinct: ["businessId"],
    select: { businessId: true }
  });
  let considered = 0;
  let recorded = 0;
  const month = billingMonthFor(now);
  const since = initialExecutionReconciliationComplete
    ? new Date(now.getTime() - 2 * 60 * 60 * 1000)
    : undefined;
  for (const business of businesses) {
    try {
      const result = await reconcileBusinessExecutionUsage(
        business.businessId,
        month,
        { since }
      );
      considered += result.considered;
      recorded += result.recorded;
    } catch (error) {
      // One malformed legacy row must not prevent every other workspace's
      // trial completion, invoice aging, reminders, or suspension checks.
      console.error("[billing-cycle] execution reconciliation failed", {
        businessId: business.businessId,
        error
      });
    }
  }
  initialExecutionReconciliationComplete = true;
  return { businesses: businesses.length, considered, recorded };
}

export async function runBillingCycle(now = new Date()) {
  const executionReconciliation = await reconcileCanonicalExecutions(now);
  const trialCompletions = await completeExpiredTrials(now);
  const subscriptionInvoices = await createCalendarSubscriptionInvoices(now);
  const usageInvoices = await processUsageInvoiceLifecycle(now);
  const agentSuspensions = await processAgentDebtSuspensions(now);
  return {
    billingMonth: billingMonthFor(now),
    executionReconciliation,
    trialCompletions,
    subscriptionInvoices,
    usageInvoices,
    agentSuspensions
  };
}

let billingTimer: NodeJS.Timeout | null = null;

export function startBillingScheduler() {
  if (billingTimer) return;
  const execute = () =>
    runBillingCycle().catch((error) =>
      console.error("[billing-cycle] run failed", error)
    );
  void execute();
  billingTimer = setInterval(execute, 60 * 60 * 1000);
  billingTimer.unref();
}

export function stopBillingScheduler() {
  if (billingTimer) clearInterval(billingTimer);
  billingTimer = null;
}
