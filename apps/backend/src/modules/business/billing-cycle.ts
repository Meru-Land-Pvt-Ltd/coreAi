import type { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { isPlatformMailConfigured, sendPlatformEmail } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { resolvePrimaryBusinessId } from "./primary-business";
import type { UsageLineItem } from "../../lib/usage-pricing";
import { getStripeClient, isStripeConfigured } from "../payments/stripe";
import { parsePaymentLineItems, type PaymentLineItem } from "../../lib/billing-invoices";
import {
  buildAgentPurchaseLineItems,
  findBuyerPlatformNumber,
  listingNeedsPhoneNumber,
  markPhoneNumberFeeBilled,
  resolveUnbilledPhoneFee
} from "./phone-provisioning";

const DAY_MS = 24 * 60 * 60 * 1000;

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  return { start, end };
}

function previousMonth(now: Date) {
  return monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

function invoiceNumber(businessId: string, month: string) {
  return `USG-${month.replace("-", "")}-${businessId.slice(-8).toUpperCase()}`;
}

function reminderAlreadySentToday(lastReminderAt: Date | null, now: Date) {
  return Boolean(lastReminderAt && lastReminderAt.toISOString().slice(0, 10) === now.toISOString().slice(0, 10));
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function suspendBusinessForInvoice(businessId: string, invoiceId: string, now: Date) {
  const activePhones = await prisma.businessPhoneNumber.findMany({
    where: { businessId, isActive: true },
    select: { id: true, configJson: true }
  });

  await prisma.$transaction([
    prisma.installedAgent.updateMany({
      where: { businessId, status: "ACTIVE" },
      data: { status: "SUSPENDED_BILLING" }
    }),
    ...activePhones.map((phone) =>
      prisma.businessPhoneNumber.update({
        where: { id: phone.id },
        data: {
          isActive: false,
          configJson: {
            ...jsonRecord(phone.configJson),
            billingSuspended: true,
            billingInvoiceId: invoiceId
          } as Prisma.InputJsonValue
        }
      })
    ),
    prisma.businessUsageInvoice.update({
      where: { id: invoiceId },
      data: { status: "OVERDUE", suspendedAt: now }
    })
  ]);
}

export async function restoreBusinessAfterBillingPayment(businessId: string) {
  const otherOverdue = await prisma.businessUsageInvoice.count({
    where: { businessId, status: { in: ["OPEN", "OVERDUE"] }, dueAt: { lte: new Date() } }
  });
  if (otherOverdue > 0) return false;

  const phones = await prisma.businessPhoneNumber.findMany({
    where: { businessId },
    select: { id: true, configJson: true }
  });
  const billingPhones = phones.filter((phone) => jsonRecord(phone.configJson).billingSuspended === true);

  await prisma.$transaction([
    prisma.installedAgent.updateMany({
      where: { businessId, status: "SUSPENDED_BILLING" },
      data: { status: "ACTIVE" }
    }),
    ...billingPhones.map((phone) => {
      const config = { ...jsonRecord(phone.configJson) };
      delete config.billingSuspended;
      delete config.billingInvoiceId;
      return prisma.businessPhoneNumber.update({
        where: { id: phone.id },
        data: { isActive: true, configJson: config as Prisma.InputJsonValue }
      });
    })
  ]);

  return true;
}

async function createInvoiceForBusiness(businessId: string, billingMonth: string, now: Date) {
  const calls = await prisma.vapiCall.findMany({
    where: {
      businessId,
      billingMonth,
      billingRecordedAt: { not: null },
      usageInvoiceId: null,
      billedCostMicroUsd: { gt: 0 }
    },
    select: { id: true, billedCostMicroUsd: true, usageLineItemsJson: true }
  });
  if (calls.length === 0) return null;

  const rollup = new Map<string, {
    serviceCode: string;
    serviceName: string;
    unit: UsageLineItem["unit"];
    quantity: number;
    unitPriceMicroUsd: number;
    amountMicroUsd: number;
  }>();

  for (const call of calls) {
    const items = Array.isArray(call.usageLineItemsJson)
      ? (call.usageLineItemsJson as unknown as UsageLineItem[])
      : [];
    for (const item of items) {
      if (item.billedCostMicroUsd <= 0 || item.quantity <= 0) continue;
      const current = rollup.get(item.serviceCode);
      if (current) {
        current.quantity += item.quantity;
        current.amountMicroUsd += item.billedCostMicroUsd;
      } else {
        rollup.set(item.serviceCode, {
          serviceCode: item.serviceCode,
          serviceName: item.serviceName,
          unit: item.unit,
          quantity: item.quantity,
          unitPriceMicroUsd: Math.round(item.billedCostMicroUsd / item.quantity),
          amountMicroUsd: item.billedCostMicroUsd
        });
      }
    }
  }

  const totalMicroUsd = calls.reduce((sum, call) => sum + (call.billedCostMicroUsd ?? 0), 0);
  const { start, end } = monthBounds(billingMonth);
  const issuedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Payment is accepted through the end of the 7th; suspension starts at 00:00 on the 8th UTC.
  const dueAt = new Date(Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth(), 8));

  return prisma.$transaction(async (tx) => {
    const existing = await tx.businessUsageInvoice.findUnique({
      where: { businessId_billingMonth: { businessId, billingMonth } }
    });
    if (existing) return existing;

    const invoice = await tx.businessUsageInvoice.create({
      data: {
        businessId,
        billingMonth,
        invoiceNumber: invoiceNumber(businessId, billingMonth),
        periodStart: start,
        periodEnd: end,
        issuedAt,
        dueAt,
        subtotalMicroUsd: totalMicroUsd,
        totalMicroUsd,
        lineItems: { create: [...rollup.values()] }
      }
    });

    await tx.vapiCall.updateMany({
      where: { id: { in: calls.map((call) => call.id) }, usageInvoiceId: null },
      data: { usageInvoiceId: invoice.id }
    });
    return invoice;
  });
}

async function sendInvoiceReminder(invoice: {
  id: string;
  invoiceNumber: string;
  billingMonth: string;
  totalMicroUsd: number;
  dueAt: Date;
  business: { name: string; billingEmail: string | null; owner: { email: string; fullName: string | null } };
}) {
  const to = invoice.business.billingEmail || invoice.business.owner.email;
  const amount = (invoice.totalMicroUsd / 1_000_000).toFixed(2);
  const billingUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/business/billingandusage`;

  if (!isPlatformMailConfigured()) {
    console.warn(`[billing-cycle] reminder skipped: email not configured (${invoice.invoiceNumber}, ${to})`);
    return false;
  }

  await sendPlatformEmail({
    purpose: "billing",
    to,
    subject: `Usage invoice ${invoice.invoiceNumber} — $${amount} due by the 7th`,
    text: `Your ${invoice.billingMonth} Triven.ai usage invoice is $${amount}. Please pay by the end of the 7th to avoid service suspension. ${billingUrl}`,
    html: `<p>Hi ${invoice.business.owner.fullName || invoice.business.name},</p><p>Your Triven.ai usage invoice <strong>${invoice.invoiceNumber}</strong> is <strong>$${amount}</strong>.</p><p>Please pay by the end of the 7th to avoid agent service suspension.</p><p><a href="${billingUrl}">View and pay invoice</a></p>`
  });
  return true;
}

async function convertExpiredTrials(now: Date) {
  const stripe = getStripeClient();
  if (!stripe || !isStripeConfigured()) return { converted: 0, failed: 0 };

  const cutoff = new Date(now.getTime() - 7 * DAY_MS);
  const trials = await prisma.payment.findMany({
    where: {
      status: "TRIALING",
      createdAt: { lte: cutoff },
      stripeCustomerId: { not: null },
      stripePaymentId: { not: null },
      listingId: { not: null }
    },
    include: { listing: { select: { id: true, name: true, priceCents: true } } }
  });

  let converted = 0;
  let failed = 0;
  for (const trial of trials) {
    if (!trial.listing || !trial.stripeCustomerId || !trial.stripePaymentId) continue;

    // Pin the charge breakdown on the trial row BEFORE touching Stripe: the
    // fixed idempotency key requires byte-identical params on retry, so the
    // amount must not drift between runs (fee appearing/disappearing, admin
    // price edits). A transient failure here skips the trial until the next
    // hourly run — it must never mark a never-charged trial FAILED.
    let businessId: string | null = null;
    let lineItems: PaymentLineItem[];
    try {
      businessId =
        trial.businessId ??
        (
          await prisma.business.findFirst({
            where: { id: (await resolvePrimaryBusinessId(trial.userId)) ?? "" },
            select: { id: true }
          })
        )?.id ??
        null;

      const pinned = parsePaymentLineItems(trial.lineItemsJson);
      if (pinned) {
        lineItems = pinned;
      } else {
        // The number was allotted (free) at trial start — now that the agent
        // is being paid for, bill its fee as a second invoice line, once per
        // number.
        const unbilledFee =
          (await listingNeedsPhoneNumber(trial.listing.id))
            ? await resolveUnbilledPhoneFee({ buyerUserId: trial.userId, businessId })
            : null;
        lineItems = buildAgentPurchaseLineItems({
          agentLabel: trial.listing.name,
          agentPriceCents: trial.listing.priceCents,
          phoneFee: unbilledFee?.fee ?? null
        });
        await prisma.payment.update({
          where: { id: trial.id },
          data: { lineItemsJson: lineItems as never }
        });
      }
    } catch (error) {
      console.error("[billing-cycle] conversion pre-charge step failed — retrying next run", {
        trialId: trial.id,
        error
      });
      continue;
    }

    const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
    const phoneFeeCents = lineItems.length > 1 ? lineItems[1]!.amountCents : 0;

    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: totalCents,
          currency: "usd",
          customer: trial.stripeCustomerId,
          payment_method: trial.stripePaymentId,
          confirm: true,
          off_session: true,
          description: `One-time purchase of ${trial.listing.name} after trial`,
          metadata: {
            userId: trial.userId,
            listingId: trial.listing.id,
            trialPaymentId: trial.id,
            ...(phoneFeeCents > 0 ? { phoneFeeCents: String(phoneFeeCents) } : {})
          }
        },
        { idempotencyKey: `trial-conversion-${trial.id}` }
      );
      if (intent.status !== "succeeded") throw new Error(`PaymentIntent status ${intent.status}`);

      await prisma.$transaction([
        prisma.payment.update({ where: { id: trial.id }, data: { status: "CANCELED" } }),
        prisma.payment.create({
          data: {
            userId: trial.userId,
            businessId,
            listingId: trial.listing.id,
            amountCents: totalCents,
            currency: "usd",
            status: "SUCCEEDED",
            stripeCustomerId: trial.stripeCustomerId,
            stripePaymentId: trial.stripePaymentId,
            billingName: trial.billingName,
            billingEmail: trial.billingEmail,
            billingAddress: trial.billingAddress,
            description: `Purchase of ${trial.listing.name}`,
            lineItemsJson: lineItems as never
          }
        })
      ]);

      // The fee line was charged — stamp the buyer's number so no later
      // purchase re-bills it. Best-effort: markPhoneNumberFeeBilled is
      // idempotent and a miss here only risks a duplicate fee, never a crash.
      if (phoneFeeCents > 0) {
        const number = await findBuyerPlatformNumber({ buyerUserId: trial.userId, businessId });
        if (number) await markPhoneNumberFeeBilled(number.id);
      }

      converted += 1;
    } catch (error) {
      console.error("[billing-cycle] trial conversion failed", { trialId: trial.id, error });
      await prisma.payment.update({ where: { id: trial.id }, data: { status: "FAILED" } });
      failed += 1;
    }
  }
  return { converted, failed };
}

async function processSubscriptionRenewals(now: Date) {
  const stripe = getStripeClient();
  if (!stripe || !isStripeConfigured()) return { renewed: 0, failed: 0 };

  // 30 days ago
  const cutoff = new Date(now.getTime() - 30 * DAY_MS);

  // Find all succeeded payments for subscription agents.
  const candidates = await prisma.payment.findMany({
    where: {
      status: "SUCCEEDED",
      listing: {
        is: { pricingModel: "SUBSCRIPTION" }
      },
      stripeCustomerId: { not: null },
      stripePaymentId: { not: null }
    },
    include: {
      listing: {
        select: {
          id: true,
          name: true,
          priceCents: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  // Group by userId + listingId to find the latest payment for each pair.
  const latestPayments = new Map<string, typeof candidates[number]>();
  for (const payment of candidates) {
    const key = `${payment.userId}::${payment.listingId}`;
    if (!latestPayments.has(key)) {
      latestPayments.set(key, payment);
    }
  }

  let renewed = 0;
  let failed = 0;

  for (const payment of latestPayments.values()) {
    if (!payment.listing || !payment.stripeCustomerId || !payment.stripePaymentId || !payment.listingId) continue;

    // Check if the latest succeeded payment is due for renewal
    if (payment.createdAt > cutoff) continue;

    // It's due! Charge it.
    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: payment.listing.priceCents,
          currency: "usd",
          customer: payment.stripeCustomerId,
          payment_method: payment.stripePaymentId,
          confirm: true,
          off_session: true,
          description: `Monthly renewal for ${payment.listing.name}`,
          metadata: {
            userId: payment.userId,
            listingId: payment.listingId,
            chargeType: "subscription_renewal",
            originalPaymentId: payment.id
          }
        },
        { idempotencyKey: `sub-renewal-${payment.id}-${now.toISOString().slice(0, 10)}` }
      );

      if (intent.status !== "succeeded") throw new Error(`PaymentIntent status ${intent.status}`);

      // Create new succeeded payment
      await prisma.payment.create({
        data: {
          userId: payment.userId,
          businessId: payment.businessId,
          listingId: payment.listingId,
          amountCents: payment.listing.priceCents,
          currency: "usd",
          status: "SUCCEEDED",
          stripeCustomerId: payment.stripeCustomerId,
          stripePaymentId: payment.stripePaymentId,
          billingName: payment.billingName,
          billingEmail: payment.billingEmail,
          billingAddress: payment.billingAddress,
          description: `Monthly renewal for ${payment.listing.name}`
        }
      });

      renewed += 1;
    } catch (error) {
      console.error("[billing-cycle] subscription renewal failed", { paymentId: payment.id, error });

      // Update the previous succeeded payment to CANCELED so access is revoked,
      // and create a FAILED payment to record the failed charge.
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: { status: "CANCELED" }
        }),
        prisma.payment.create({
          data: {
            userId: payment.userId,
            businessId: payment.businessId,
            listingId: payment.listingId,
            amountCents: payment.listing.priceCents,
            currency: "usd",
            status: "FAILED",
            stripeCustomerId: payment.stripeCustomerId,
            stripePaymentId: payment.stripePaymentId,
            billingName: payment.billingName,
            billingEmail: payment.billingEmail,
            billingAddress: payment.billingAddress,
            description: `Monthly renewal failed for ${payment.listing.name}`
          }
        }),
        prisma.installedAgent.updateMany({
          where: {
            business: { ownerId: payment.userId },
            listingId: payment.listingId
          },
          data: {
            status: "SUSPENDED_BILLING"
          }
        })
      ]);

      failed += 1;
    }
  }

  return { renewed, failed };
}

export async function runBillingCycle(now = new Date()) {
  const trialConversions = await convertExpiredTrials(now);
  const subscriptionRenewals = await processSubscriptionRenewals(now);
  const billingMonth = previousMonth(now);
  const businessIds = await prisma.vapiCall.findMany({
    where: { billingMonth, billingRecordedAt: { not: null }, billedCostMicroUsd: { gt: 0 } },
    distinct: ["businessId"],
    select: { businessId: true }
  });

  for (const { businessId } of businessIds) {
    await createInvoiceForBusiness(businessId, billingMonth, now);
  }

  const openInvoices = await prisma.businessUsageInvoice.findMany({
    where: { status: { in: ["OPEN", "OVERDUE"] } },
    include: { business: { select: { name: true, billingEmail: true, owner: { select: { email: true, fullName: true } } } } }
  });

  let remindersSent = 0;
  let suspended = 0;
  for (const invoice of openInvoices) {
    if (now >= invoice.dueAt) {
      if (!invoice.suspendedAt) {
        await suspendBusinessForInvoice(invoice.businessId, invoice.id, now);
        suspended += 1;
      }
      continue;
    }

    const daysUntilDue = Math.ceil((invoice.dueAt.getTime() - now.getTime()) / DAY_MS);
    if (daysUntilDue <= 7 && !reminderAlreadySentToday(invoice.lastReminderAt, now)) {
      try {
        const sent = await sendInvoiceReminder(invoice);
        if (sent) {
          await prisma.businessUsageInvoice.update({
            where: { id: invoice.id },
            data: { reminderCount: { increment: 1 }, lastReminderAt: now }
          });
          remindersSent += 1;
        }
      } catch (error) {
        console.error("[billing-cycle] reminder failed", { invoiceId: invoice.id, error });
      }
    }
  }

  return { billingMonth, invoicesConsidered: businessIds.length, remindersSent, suspended, trialConversions, subscriptionRenewals };
}

let billingTimer: NodeJS.Timeout | null = null;

export function startBillingScheduler() {
  if (billingTimer) return;
  const execute = () => runBillingCycle().catch((error) => console.error("[billing-cycle] run failed", error));
  void execute();
  billingTimer = setInterval(execute, 60 * 60 * 1000);
  billingTimer.unref();
}

export function stopBillingScheduler() {
  if (billingTimer) clearInterval(billingTimer);
  billingTimer = null;
}
