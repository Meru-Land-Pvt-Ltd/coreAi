import type { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import {
  buildTrialEndedEmailHtml,
  isPlatformMailConfigured,
  sendPlatformEmail
} from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { parsePaymentLineItems, type PaymentLineItem } from "../../lib/billing-invoices";
import {
  billingMonthFor,
  monthLabel,
  reconcileBusinessExecutionUsage,
  usageBalanceIsCollectible
} from "./execution-billing";
import {
  buildAgentPurchaseLineItems
} from "./phone-provisioning";
import { ensureMonthlyAssignedNumberFees } from "./phone-number-invoice";
import {
  addUtcCalendarMonth,
  agentBillingAnchorAt,
  initialAgentPurchasePeriod,
  nextSubscriptionInvoicePeriod,
  paidPaymentCoversAgentInvoice,
  reconcileCoveredAgentInvoices,
  resolveAgentBillingPeriod
} from "./agent-payment-scope";

const DAY_MS = 24 * 60 * 60 * 1000;

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function escapeEmailHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

export function usageSuspensionTargets(input: {
  businessId: string;
  installedAgentId: string | null;
}) {
  if (!input.installedAgentId) return null;
  return {
    installedAgentId: input.installedAgentId,
    agentWhere: {
      id: input.installedAgentId,
      businessId: input.businessId
    },
    phoneWhere: {
      businessId: input.businessId,
      installedAgentId: input.installedAgentId
    }
  };
}

async function suspendBusinessForUsageInvoice(invoiceId: string, now: Date) {
  const invoice = await prisma.businessUsageInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      businessId: true,
      installedAgentId: true,
      suspendedAt: true
    }
  });
  if (!invoice) return false;
  const targets = usageSuspensionTargets(invoice);
  if (!targets) return false;

  const phones = await prisma.businessPhoneNumber.findMany({
    where: {
      ...targets.phoneWhere,
      isActive: true
    },
    select: { id: true, configJson: true }
  });

  await prisma.$transaction([
    prisma.installedAgent.updateMany({
      where: {
        ...targets.agentWhere,
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
      installedAgentId: true,
      suspendedAt: true,
      userId: true
    }
  });
  if (!payment || !payment.listingId) return false;

  const installedAgent = await prisma.installedAgent.findFirst({
    where: {
      ...(payment.installedAgentId
        ? { id: payment.installedAgentId }
        : { listingId: payment.listingId }),
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
  installedAgentId: string,
  listingId: string | null
) {
  const blocking = await prisma.payment.aggregate({
    where: {
      businessId,
      OR: [
        { installedAgentId },
        ...(listingId
          ? [{ installedAgentId: null, listingId }]
          : [])
      ],
      status: "OVERDUE",
      invoiceKind: { in: ["POST_TRIAL", "SUBSCRIPTION_RENEWAL"] },
      graceEndsAt: { lte: new Date() }
    },
    _sum: { amountCents: true }
  });
  return (blocking._sum.amountCents ?? 0) >= 50;
}

async function hasSuspendingUsageDebt(
  businessId: string,
  installedAgentId: string
) {
  const blocking = await prisma.businessUsageInvoice.aggregate({
    where: {
      businessId,
      installedAgentId,
      status: "OVERDUE",
      paidAt: null,
      graceEndsAt: { lte: new Date() }
    },
    _sum: { totalMicroUsd: true }
  });
  return usageBalanceIsCollectible(blocking._sum.totalMicroUsd ?? 0);
}

/**
 * Restores billing-suspended services after a successful payment.
 *
 * Usage and subscription debt are both scoped to one installed agent. Paying
 * one agent's invoice never changes another agent's suspension state.
 */
export async function restoreBusinessAfterBillingPayment(
  businessId: string,
  installedAgentId?: string | null
) {
  const suspendedAgents = await prisma.installedAgent.findMany({
    where: {
      businessId,
      status: "SUSPENDED_BILLING",
      ...(installedAgentId ? { id: installedAgentId } : {})
    },
    select: { id: true, listingId: true }
  });
  const restoredAgentIds: string[] = [];
  for (const agent of suspendedAgents) {
    if (
      (await hasSuspendingUsageDebt(businessId, agent.id)) ||
      await hasSuspendingSubscriptionDebt(
        businessId,
        agent.id,
        agent.listingId
      )
    ) {
      continue;
    }
    await prisma.installedAgent.update({
      where: { id: agent.id },
      data: { status: "ACTIVE" }
    });
    restoredAgentIds.push(agent.id);
  }

  const phones = await prisma.businessPhoneNumber.findMany({
    where: {
      businessId,
      ...(installedAgentId ? { installedAgentId } : {})
    },
    select: { id: true, installedAgentId: true, configJson: true }
  });
  let restoredPhones = 0;
  for (const phone of phones) {
    const config = jsonRecord(phone.configJson);
    if (config.billingSuspended !== true) continue;
    if (!phone.installedAgentId) continue;
    const listingId = (
      await prisma.installedAgent.findUnique({
        where: { id: phone.installedAgentId },
        select: { listingId: true }
      })
    )?.listingId ?? null;
    if (
      (await hasSuspendingUsageDebt(
        businessId,
        phone.installedAgentId
      )) ||
      (await hasSuspendingSubscriptionDebt(
        businessId,
        phone.installedAgentId,
        listingId
      ))
    ) {
      continue;
    }

    delete config.billingSuspended;
    delete config.billingSuspensionKinds;
    delete config.billingSuspensionSourceIds;
    await prisma.businessPhoneNumber.update({
      where: { id: phone.id },
      data: { isActive: true, configJson: config as Prisma.InputJsonValue }
    });
    restoredPhones += 1;
  }

  return restoredAgentIds.length > 0 || restoredPhones > 0;
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

  return buildAgentPurchaseLineItems({
    agentLabel: trial.listing.name,
    agentPriceCents: trial.listing.priceCents,
    phoneFee: null
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
          trialDays: true,
          pricingModel: true
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
    const installedAgentId =
      trial.installedAgentId ??
      (
        await prisma.installedAgent.findFirst({
          where: {
            listingId: trial.listingId,
            ...(trial.businessId
              ? { businessId: trial.businessId }
              : { business: { ownerId: trial.userId } })
          },
          orderBy: { createdAt: "desc" },
          select: { id: true }
        })
      )?.id ??
      null;

    const invoiceKey = `post-trial:${trial.id}`;
    const lineItems = await completedTrialLineItems({
      ...trial,
      listing
    });
    const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
    const invoicePeriodEnd =
      listing.pricingModel === "SUBSCRIPTION"
        ? addUtcCalendarMonth(endsAt)
        : null;

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceKey}))`;
      const fresh = await tx.payment.findUnique({
        where: { id: trial.id },
        select: { status: true }
      });
      const existing = await tx.payment.findUnique({ where: { invoiceKey } });
      if (fresh?.status !== "TRIALING") return { changed: false, created: false };
      const paidPeriods = await tx.payment.findMany({
        where: {
          userId: trial.userId,
          listingId: trial.listingId,
          status: "SUCCEEDED",
          NOT: { id: trial.id },
          ...(installedAgentId
            ? {
                OR: [
                  { installedAgentId },
                  { installedAgentId: null }
                ]
              }
            : {})
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
      const coveredByPaidPeriod = paidPeriods.some((paid) =>
        paidPaymentCoversAgentInvoice(
          paid,
          {
            id: invoiceKey,
            userId: trial.userId,
            businessId: trial.businessId,
            listingId: trial.listingId,
            installedAgentId,
            status: "OVERDUE",
            invoiceKind: "POST_TRIAL",
            createdAt: endsAt,
            paidAt: null,
            periodStart: endsAt,
            periodEnd: invoicePeriodEnd,
            dueAt: endsAt
          },
          listing.pricingModel
        )
      );

      await tx.payment.update({
        where: { id: trial.id },
        data: {
          status: "COMPLETED",
          invoiceKind: "TRIAL",
          installedAgentId,
          periodEnd: endsAt,
          paidAt: endsAt
        }
      });
      if (coveredByPaidPeriod) {
        if (
          existing &&
          ["PENDING", "OVERDUE"].includes(existing.status)
        ) {
          await tx.payment.update({
            where: { id: existing.id },
            data: {
              status: "CANCELED",
              canceledAt: now,
              suspendedAt: null,
              paymentPendingAt: null
            }
          });
        }
        return { changed: true, created: false };
      }
      if (existing || totalCents <= 0) {
        return { changed: true, created: false };
      }

      await tx.payment.create({
        data: {
          userId: trial.userId,
          businessId: trial.businessId,
          listingId: trial.listingId,
          installedAgentId,
          amountCents: totalCents,
          currency: trial.currency,
          status: "OVERDUE",
          invoiceKind: "POST_TRIAL",
          invoiceKey,
          periodStart: endsAt,
          periodEnd: invoicePeriodEnd,
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

type PendingTrialEndEmail = {
  paymentId: string;
  buyerEmail: string;
  buyerName: string | null;
  businessName: string | null;
  billingEmail: string | null;
  agentName: string;
  endedAt: Date;
  invoiceId: string | null;
  invoiceAmountCents: number | null;
};

type PendingTrialEndingOneDayEmail = {
  paymentId: string;
  buyerEmail: string;
  buyerName: string | null;
  businessName: string | null;
  billingEmail: string | null;
  agentName: string;
  endsAt: Date;
  priceCents: number;
};

/**
 * Sends once during the trial's final 24 hours. Failed or unconfigured
 * deliveries keep a null sent marker and are retried by the hourly scheduler
 * while the trial remains active.
 */
async function sendPendingTrialEndingOneDayEmails(now: Date) {
  const reminderWindowEnd = new Date(now.getTime() + DAY_MS);
  const pending = await prisma.$queryRaw<PendingTrialEndingOneDayEmail[]>`
    SELECT
      trial."id" AS "paymentId",
      buyer."email" AS "buyerEmail",
      buyer."fullName" AS "buyerName",
      business."name" AS "businessName",
      business."billingEmail" AS "billingEmail",
      listing."name" AS "agentName",
      trial."periodEnd" AS "endsAt",
      listing."priceCents" AS "priceCents"
    FROM "Payment" trial
    INNER JOIN "User" buyer ON buyer."id" = trial."userId"
    INNER JOIN "AgentListing" listing ON listing."id" = trial."listingId"
    LEFT JOIN "Business" business ON business."id" = trial."businessId"
    WHERE trial."status" = 'TRIALING'
      AND trial."invoiceKind" = 'TRIAL'
      AND trial."periodEnd" > ${now}
      AND trial."periodEnd" <= ${reminderWindowEnd}
      AND trial."trialEndingOneDayEmailSentAt" IS NULL
    ORDER BY trial."periodEnd" ASC
    LIMIT 100
  `;

  if (!isPlatformMailConfigured()) {
    if (pending.length > 0) {
      console.warn(
        `[billing-cycle] ${pending.length} one-day trial reminder(s) pending; platform SES is not configured`
      );
    }
    return { considered: pending.length, sent: 0 };
  }

  const billingUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/business/billingandusage`;
  let sent = 0;

  for (const item of pending) {
    const to = item.billingEmail?.trim() || item.buyerEmail;
    const recipientName =
      item.buyerName?.trim() || item.businessName?.trim() || "there";
    const agentPrice = `$${(item.priceCents / 100).toFixed(2)}`;
    const endsAt = item.endsAt.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC"
    });
    const actionText =
      `Your free trial for ${item.agentName} ends in less than 24 hours (${endsAt} UTC). ` +
      `After the trial, the agent fee is ${agentPrice}, plus its listed execution charges.`;

    try {
      await sendPlatformEmail({
        purpose: "billing",
        to,
        subject: `Your ${item.agentName} trial ends tomorrow`,
        text: `Hi ${recipientName}, ${actionText} Review your billing details: ${billingUrl}`,
        html: [
          `<p>Hi ${escapeEmailHtml(recipientName)},</p>`,
          `<p>Your free trial for <strong>${escapeEmailHtml(item.agentName)}</strong> ends in less than 24 hours.</p>`,
          `<p>Trial end: <strong>${escapeEmailHtml(endsAt)} UTC</strong></p>`,
          `<p>After the trial, the agent fee is <strong>${escapeEmailHtml(agentPrice)}</strong>, plus its listed execution charges.</p>`,
          `<p><a href="${escapeEmailHtml(billingUrl)}">Review billing and usage</a></p>`
        ].join("")
      });

      const marked = await prisma.$executeRaw`
        UPDATE "Payment"
        SET "trialEndingOneDayEmailSentAt" = ${now}
        WHERE "id" = ${item.paymentId}
          AND "trialEndingOneDayEmailSentAt" IS NULL
      `;
      if (marked > 0) sent += 1;
    } catch (error) {
      console.error("[billing-cycle] one-day trial reminder failed", {
        paymentId: item.paymentId,
        error
      });
    }
  }

  return { considered: pending.length, sent };
}

/**
 * Sends the buyer-facing trial-ended message after the completion transaction
 * commits. The persisted sent timestamp makes hourly scheduler reruns safe and
 * leaves failed/unconfigured deliveries available for retry.
 */
async function sendPendingTrialEndEmails(now: Date) {
  const pending = await prisma.$queryRaw<PendingTrialEndEmail[]>`
    SELECT
      trial."id" AS "paymentId",
      buyer."email" AS "buyerEmail",
      buyer."fullName" AS "buyerName",
      business."name" AS "businessName",
      business."billingEmail" AS "billingEmail",
      listing."name" AS "agentName",
      COALESCE(trial."periodEnd", trial."updatedAt") AS "endedAt",
      post_trial."id" AS "invoiceId",
      post_trial."amountCents" AS "invoiceAmountCents"
    FROM "Payment" trial
    INNER JOIN "User" buyer ON buyer."id" = trial."userId"
    INNER JOIN "AgentListing" listing ON listing."id" = trial."listingId"
    LEFT JOIN "Business" business ON business."id" = trial."businessId"
    INNER JOIN "Payment" post_trial
      ON post_trial."invoiceKey" = CONCAT('post-trial:', trial."id")
    WHERE trial."status" = 'COMPLETED'
      AND trial."invoiceKind" = 'TRIAL'
      AND trial."trialEndedEmailSentAt" IS NULL
      AND post_trial."status" IN ('PENDING', 'OVERDUE')
    ORDER BY trial."updatedAt" ASC
    LIMIT 100
  `;

  if (!isPlatformMailConfigured()) {
    if (pending.length > 0) {
      console.warn(
        `[billing-cycle] ${pending.length} trial-ended email(s) pending; platform SES is not configured`
      );
    }
    return { considered: pending.length, sent: 0 };
  }

  const myAgentsUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/business/agents`;
  let sent = 0;

  for (const item of pending) {
    const to = item.billingEmail?.trim() || item.buyerEmail;
    const recipientName =
      item.buyerName?.trim() || item.businessName?.trim() || "there";
    const trialEndDate = item.endedAt.toLocaleDateString("en-US");

    try {
      await sendPlatformEmail({
        purpose: "billing",
        to,
        subject: `Your trial for ${item.agentName} has ended`,
        text: `Hi ${recipientName}, your Triven.ai trial for ${item.agentName} ended on ${trialEndDate}. Your data is safe. Choose a plan to continue using your agent: ${myAgentsUrl}`,
        html: buildTrialEndedEmailHtml({
          agentName: item.agentName,
          trialEndDate,
          myAgentsLink: myAgentsUrl
        })
      });

      const marked = await prisma.$executeRaw`
        UPDATE "Payment"
        SET "trialEndedEmailSentAt" = ${now}
        WHERE "id" = ${item.paymentId}
          AND "trialEndedEmailSentAt" IS NULL
      `;
      if (marked > 0) sent += 1;
    } catch (error) {
      console.error("[billing-cycle] trial-ended email failed", {
        paymentId: item.paymentId,
        error
      });
    }
  }

  return { considered: pending.length, sent };
}

async function createDueSubscriptionInvoices(now: Date) {
  const billingPeriod = billingMonthFor(now);
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

    const [latestPaid, billingAnchorPayments, unresolvedAgentInvoices] =
      await Promise.all([
      prisma.payment.findFirst({
        where: {
          userId: agent.business.ownerId,
          OR: [{ businessId: agent.businessId }, { businessId: null }],
          listingId: agent.listingId,
          AND: [
            {
              OR: [
                { installedAgentId: agent.id },
                { installedAgentId: null }
              ]
            }
          ],
          status: "SUCCEEDED"
        },
        orderBy: [
          { periodEnd: "desc" },
          { paidAt: "desc" },
          { createdAt: "desc" }
        ]
      }),
      prisma.payment.findMany({
        where: {
          userId: agent.business.ownerId,
          OR: [{ businessId: agent.businessId }, { businessId: null }],
          listingId: agent.listingId,
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
      }),
      prisma.payment.count({
        where: {
          userId: agent.business.ownerId,
          OR: [{ businessId: agent.businessId }, { businessId: null }],
          listingId: agent.listingId,
          AND: [
            {
              OR: [
                { installedAgentId: agent.id },
                { installedAgentId: null }
              ]
            }
          ],
          invoiceKind: {
            in: ["POST_TRIAL", "SUBSCRIPTION_RENEWAL"]
          },
          status: { in: ["PENDING", "OVERDUE"] }
        }
      })
      ]);
    if (!latestPaid || unresolvedAgentInvoices > 0) continue;
    const billingAnchorAt = agentBillingAnchorAt({
      agentCreatedAt: agent.createdAt,
      referenceAt: now,
      payments: billingAnchorPayments
    });
    const {
      start: periodStart,
      end: periodEnd
    } = nextSubscriptionInvoicePeriod(latestPaid, billingAnchorAt);
    if (now < periodStart) continue;
    const renewalDate = periodStart.toISOString().slice(0, 10);
    const invoiceKey = `subscription:${agent.id}:${renewalDate}`;
    const legacyInvoiceKey =
      `subscription:${agent.businessId}:${agent.listingId}:${billingMonthFor(periodStart)}`;
    const exists = await prisma.payment.findFirst({
      where: { invoiceKey: { in: [invoiceKey, legacyInvoiceKey] } },
      select: { id: true }
    });
    if (exists) continue;

    const pinnedPlanCents =
      parsePaymentLineItems(latestPaid.lineItemsJson)?.[0]?.amountCents ??
      latestPaid.amountCents;

    try {
      await prisma.payment.create({
        data: {
          userId: agent.business.ownerId,
          businessId: agent.businessId,
          listingId: agent.listingId,
          installedAgentId: agent.id,
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
          description: `${monthLabel(
            billingMonthFor(periodStart)
          )} subscription for ${agent.listing.name}`,
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

async function reconcileOpenSubscriptionInvoicePeriods(now: Date) {
  return prisma.$transaction(async (tx) => {
    const invoices = await tx.payment.findMany({
      where: {
        invoiceKind: "SUBSCRIPTION_RENEWAL",
        status: { in: ["PENDING", "OVERDUE"] },
        installedAgentId: { not: null },
        paymentPendingAt: null
      },
      include: {
        installedAgent: {
          select: {
            id: true,
            businessId: true,
            listingId: true,
            createdAt: true,
            business: { select: { ownerId: true } }
          }
        }
      }
    });

    let repaired = 0;
    const reopenedScopes = new Map<
      string,
      { businessId: string; installedAgentId: string }
    >();
    for (const invoice of invoices) {
      const agent = invoice.installedAgent;
      if (!agent || !agent.listingId) continue;

      const payments = await tx.payment.findMany({
        where: {
          id: { not: invoice.id },
          userId: agent.business.ownerId,
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
      const paid = payments
        .filter((payment) => payment.status === "SUCCEEDED")
        .sort(
          (left, right) =>
            (
              right.periodStart ??
              right.paidAt ??
              right.createdAt
            ).getTime() -
            (
              left.periodStart ??
              left.paidAt ??
              left.createdAt
            ).getTime()
        )[0];
      if (!paid) continue;

      const anchorAt = agentBillingAnchorAt({
        agentCreatedAt: agent.createdAt,
        referenceAt: now,
        payments
      });
      const expected = nextSubscriptionInvoicePeriod(paid, anchorAt);
      const status = now < expected.start ? "PENDING" : "OVERDUE";
      const changed =
        invoice.periodStart?.getTime() !== expected.start.getTime() ||
        invoice.periodEnd?.getTime() !== expected.end.getTime() ||
        invoice.dueAt?.getTime() !== expected.start.getTime() ||
        invoice.graceEndsAt?.getTime() !==
          graceEndFor(expected.start).getTime() ||
        invoice.status !== status;
      if (!changed) continue;

      await tx.payment.update({
        where: { id: invoice.id },
        data: {
          periodStart: expected.start,
          periodEnd: expected.end,
          dueAt: expected.start,
          graceEndsAt: graceEndFor(expected.start),
          status,
          ...(status === "PENDING"
            ? {
                suspendedAt: null,
                paymentPendingAt: null
              }
            : {})
        }
      });
      if (
        status === "PENDING" &&
        (invoice.status === "OVERDUE" || invoice.suspendedAt)
      ) {
        reopenedScopes.set(agent.id, {
          businessId: agent.businessId,
          installedAgentId: agent.id
        });
      }
      repaired += 1;
    }

    return {
      considered: invoices.length,
      repaired,
      reopenedScopes: [...reopenedScopes.values()]
    };
  });
}

async function reconcilePaidPurchasePeriods() {
  return prisma.$transaction(async (tx) => {
    const purchases = await tx.payment.findMany({
      where: {
        status: "SUCCEEDED",
        invoiceKind: "PURCHASE",
        listing: { is: { pricingModel: "SUBSCRIPTION" } }
      },
      select: {
        id: true,
        createdAt: true,
        paidAt: true,
        periodStart: true,
        periodEnd: true
      }
    });

    let repaired = 0;
    for (const purchase of purchases) {
      const purchasedAt = purchase.paidAt ?? purchase.createdAt;
      const expected = initialAgentPurchasePeriod(
        "SUBSCRIPTION",
        purchasedAt
      );
      if (
        purchase.periodStart?.getTime() === expected.start.getTime() &&
        purchase.periodEnd?.getTime() === expected.end?.getTime()
      ) {
        continue;
      }

      await tx.payment.update({
        where: { id: purchase.id },
        data: {
          periodStart: expected.start,
          periodEnd: expected.end
        }
      });
      repaired += 1;
    }

    return { considered: purchases.length, repaired };
  });
}

async function reconcileOpenUsageInvoicePeriods(now: Date) {
  return prisma.$transaction(async (tx) => {
    const invoices = await tx.businessUsageInvoice.findMany({
      where: {
        status: { in: ["PENDING", "OPEN", "OVERDUE"] },
        installedAgentId: { not: null },
        paidAt: null,
        closedAt: null,
        paymentPendingAt: null
      },
      include: {
        installedAgent: {
          select: {
            id: true,
            businessId: true,
            listingId: true,
            createdAt: true,
            business: { select: { ownerId: true } }
          }
        }
      }
    });

    let repaired = 0;
    const reopenedScopes = new Map<
      string,
      { businessId: string; installedAgentId: string }
    >();
    for (const invoice of invoices) {
      const agent = invoice.installedAgent;
      if (!agent) continue;

      const expected = await resolveAgentBillingPeriod(
        tx,
        {
          id: agent.id,
          businessId: agent.businessId,
          listingId: agent.listingId,
          createdAt: agent.createdAt,
          ownerUserId: agent.business.ownerId
        },
        invoice.issuedAt
      );
      const status =
        invoice.status === "OVERDUE" && now < expected.dueAt
          ? "PENDING"
          : invoice.status;
      const changed =
        invoice.periodStart.getTime() !== expected.start.getTime() ||
        invoice.periodEnd.getTime() !== expected.end.getTime() ||
        invoice.dueAt.getTime() !== expected.dueAt.getTime() ||
        invoice.graceEndsAt?.getTime() !== expected.graceEndsAt.getTime() ||
        invoice.status !== status;
      if (!changed) continue;

      await tx.businessUsageInvoice.update({
        where: { id: invoice.id },
        data: {
          periodStart: expected.start,
          periodEnd: expected.end,
          dueAt: expected.dueAt,
          graceEndsAt: expected.graceEndsAt,
          status,
          ...(status === "PENDING"
            ? {
                suspendedAt: null,
                lastReminderAt: null
              }
            : {})
        }
      });
      if (
        status === "PENDING" &&
        (invoice.status === "OVERDUE" || invoice.suspendedAt)
      ) {
        reopenedScopes.set(agent.id, {
          businessId: agent.businessId,
          installedAgentId: agent.id
        });
      }
      repaired += 1;
    }

    return {
      considered: invoices.length,
      repaired,
      reopenedScopes: [...reopenedScopes.values()]
    };
  });
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
      installedAgentId: true,
      amountCents: true
    }
  });
  const totals = new Map<string, number>();
  for (const payment of payments) {
    const key = `${
      payment.businessId ?? `owner:${payment.userId}`
    }:${payment.installedAgentId ?? `legacy-listing:${payment.listingId}`}`;
    totals.set(key, (totals.get(key) ?? 0) + payment.amountCents);
  }
  let suspended = 0;
  for (const payment of payments) {
    const key = `${
      payment.businessId ?? `owner:${payment.userId}`
    }:${payment.installedAgentId ?? `legacy-listing:${payment.listingId}`}`;
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
  const purchasePeriods = await reconcilePaidPurchasePeriods();
  const usageInvoicePeriods = await reconcileOpenUsageInvoicePeriods(now);
  const assignedNumberFees = await ensureMonthlyAssignedNumberFees(now);
  const trialEndingOneDayEmails = await sendPendingTrialEndingOneDayEmails(now);
  const trialCompletions = await completeExpiredTrials(now);
  const subscriptionInvoicePeriods =
    await reconcileOpenSubscriptionInvoicePeriods(now);
  const reopenedScopes = new Map(
    [
      ...usageInvoicePeriods.reopenedScopes,
      ...subscriptionInvoicePeriods.reopenedScopes
    ].map((scope) => [
      `${scope.businessId}:${scope.installedAgentId}`,
      scope
    ])
  );
  for (const scope of reopenedScopes.values()) {
    await restoreBusinessAfterBillingPayment(
      scope.businessId,
      scope.installedAgentId
    );
  }
  const subscriptionInvoices = await createDueSubscriptionInvoices(now);
  const coveredAgentInvoices = await reconcileCoveredAgentInvoices({ now });
  for (const businessId of coveredAgentInvoices.businessIds) {
    await restoreBusinessAfterBillingPayment(businessId);
  }
  const trialEndEmails = await sendPendingTrialEndEmails(now);
  const usageInvoices = await processUsageInvoiceLifecycle(now);
  const agentSuspensions = await processAgentDebtSuspensions(now);
  return {
    billingMonth: billingMonthFor(now),
    executionReconciliation,
    purchasePeriods,
    usageInvoicePeriods,
    assignedNumberFees,
    trialEndingOneDayEmails,
    trialCompletions,
    trialEndEmails,
    subscriptionInvoicePeriods,
    subscriptionInvoices,
    coveredAgentInvoices,
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
