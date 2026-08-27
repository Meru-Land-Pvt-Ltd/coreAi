import JSZip from "jszip";
import { addressFromProfile, formatAddressOneLine } from "./business-facts";
import {
  buildBillingInvoices,
  buildDashboardActivities,
  sumInvoiceTotalCents
} from "../../lib/billing-invoices";
import { buildInvoicePdfBuffer, type InvoiceData } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { buildInstalledAgentRunStats } from "./installed-agent-run-stats";
import { resolveActivePayment } from "./purchase-access";
import {
  buildBusinessExportReadme,
  decodeEmbeddedExportImage,
  formatExportDate,
  formatExportMoneyFromCents,
  formatExportMoneyFromMicroUsd,
  formatExportStatus,
  formatExportTrend,
  renderBusinessExportHome,
  renderBusinessExportPage,
  type ExportCard,
  type ExportCell,
  type ExportField
} from "./business-data-export-html";

type ExportInvoice = {
  invoiceNumber: string;
  date: Date;
  description: string;
  amountCents: number;
  listPriceCents?: number;
  currency: string;
  status: string;
  billingName: string;
  billingEmail: string;
  billingAddress: string | null;
  agentName: string;
  transactionId: string | null;
  lineItems: NonNullable<InvoiceData["lineItems"]>;
};

type ArchiveInvoice = ExportInvoice & {
  archivePath: string;
  pageHref: string;
};

function currentMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function previousMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
}

function chartStart(now: Date, days = 30): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
}

function archiveSafeName(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "invoice";
}

function paymentInvoiceNumber(paymentId: string): string {
  return `INV-${paymentId.slice(-8).toUpperCase()}`;
}

function safeExternalHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function displayOptional(value: string | null | undefined): string {
  return value?.trim() || "Not provided";
}

function buildChartRows(options: {
  now: Date;
  appointments: Array<{ createdAt: Date }>;
  missedCalls: Array<{ createdAt: Date }>;
  calls: Array<{ createdAt: Date; billedCostMicroUsd: number | null }>;
}): ExportCell[][] {
  const buckets = new Map<
    string,
    { date: string; executions: number; bookings: number; costMicroUsd: number }
  >();

  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(
      Date.UTC(
        options.now.getUTCFullYear(),
        options.now.getUTCMonth(),
        options.now.getUTCDate() - offset
      )
    );
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, { date: key, executions: 0, bookings: 0, costMicroUsd: 0 });
  }

  for (const appointment of options.appointments) {
    const bucket = buckets.get(appointment.createdAt.toISOString().slice(0, 10));
    if (bucket) bucket.bookings += 1;
  }
  for (const missedCall of options.missedCalls) {
    const bucket = buckets.get(missedCall.createdAt.toISOString().slice(0, 10));
    if (bucket) bucket.executions += 1;
  }
  for (const call of options.calls) {
    const bucket = buckets.get(call.createdAt.toISOString().slice(0, 10));
    if (bucket) {
      bucket.executions += 1;
      bucket.costMicroUsd += call.billedCostMicroUsd ?? 0;
    }
  }

  return Array.from(buckets.values()).map((bucket) => [
    bucket.date,
    String(bucket.executions),
    String(bucket.bookings),
    formatExportMoneyFromMicroUsd(bucket.costMicroUsd)
  ]);
}

function toInvoiceData(invoice: ExportInvoice): InvoiceData {
  return {
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.date,
    businessName: invoice.billingName,
    businessEmail: invoice.billingEmail,
    agentName: invoice.agentName,
    description: invoice.description,
    amountCents: invoice.amountCents,
    listPriceCents: invoice.listPriceCents,
    currency: invoice.currency,
    status: invoice.status,
    billingAddress: invoice.billingAddress,
    transactionId: invoice.transactionId ?? undefined,
    lineItems: invoice.lineItems
  };
}

function usageLineItemsInCents(
  items: Array<{
    serviceName: string;
    amountMicroUsd: number;
    quantity: number;
    unitPriceMicroUsd: number;
  }>,
  totalMicroUsd: number,
  currency: string
): NonNullable<InvoiceData["lineItems"]> {
  let cumulativeMicroUsd = 0;
  let allocatedCents = 0;
  const lineItems: NonNullable<InvoiceData["lineItems"]> = items.map((item) => {
    cumulativeMicroUsd += item.amountMicroUsd;
    const nextAllocatedCents = Math.round(cumulativeMicroUsd / 10_000);
    const amountCents = nextAllocatedCents - allocatedCents;
    allocatedCents = nextAllocatedCents;
    let unitPriceDisplay: string;
    try {
      unitPriceDisplay = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency.toUpperCase(),
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
      }).format(item.unitPriceMicroUsd / 1_000_000);
    } catch {
      unitPriceDisplay = `$${(item.unitPriceMicroUsd / 1_000_000).toFixed(6)}`;
    }
    return {
      label: item.serviceName,
      amountCents,
      quantity: item.quantity,
      unitPriceDisplay
    };
  });

  const invoiceTotalCents = Math.round(totalMicroUsd / 10_000);
  const adjustmentCents = invoiceTotalCents - allocatedCents;
  if (adjustmentCents !== 0) {
    lineItems.push({ label: "Invoice total adjustment", amountCents: adjustmentCents });
  }

  return lineItems;
}

async function addInvoicePdfs(zip: JSZip, invoices: ArchiveInvoice[]): Promise<void> {
  // Sequential generation keeps peak memory bounded for accounts with a long
  // invoice history. PDFKit itself is synchronous once each document starts.
  for (const invoice of invoices) {
    const pdf = await buildInvoicePdfBuffer(toInvoiceData(invoice));
    zip.file(invoice.archivePath, pdf);
  }
}

/**
 * Builds an Instagram-style, offline business export. The archive deliberately
 * contains only Profile, Dashboard, My Agents, and Billing & Usage data.
 */
export async function buildBusinessDataExportZip(
  ownerUserId: string,
  requestedBusinessId?: string
): Promise<{ filename: string; zip: ArrayBuffer }> {
  const generatedAt = new Date();
  const [user, business, ownedBusinessCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: ownerUserId },
      select: {
        email: true,
        fullName: true,
        phone: true,
        location: true,
        timezone: true,
        profilePhotoUrl: true,
        createdAt: true
      }
    }),
    prisma.business.findFirst({
      where: {
        ownerId: ownerUserId,
        ...(requestedBusinessId ? { id: requestedBusinessId } : {})
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        subscriptionStatus: true,
        billingName: true,
        billingEmail: true,
        billingAddress: true,
        billingPostalCode: true,
        createdAt: true,
        profile: {
          select: {
            businessSize: true,
            teamPhone: true,
            bookingUrl: true,
            timeZone: true,
            /* The address the AGENT reads out to callers — the one the
               settings screen calls "Business address". The export was
               printing the INVOICE address under that label and omitting this
               one entirely, so a business checking what their agent tells
               people was shown the wrong thing. */
            addressLine1: true,
            addressLine2: true,
            addressCity: true,
            addressState: true,
            addressPostalCode: true,
            addressCountry: true,
            addressLandmark: true,
            addressDirections: true,
            addressMapsLink: true,
            addressSource: true,
            addressConfirmedAt: true
          }
        },
        installedAgents: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            listingId: true,
            name: true,
            status: true,
            pausedAt: true,
            executionFeeCents: true,
            trialExecutionLimit: true,
            trialExecutionsUsed: true,
            createdAt: true,
            updatedAt: true,
            listing: {
              select: {
                id: true,
                name: true,
                shortDescription: true,
                description: true,
                priceCents: true,
                pricingModel: true,
                executionFeeCents: true,
                category: true,
                tags: true,
                industryTags: true,
                iconUrl: true,
                freeTrialEnabled: true,
                trialDays: true
              }
            }
          }
        }
      }
    }),
    prisma.business.count({ where: { ownerId: ownerUserId } })
  ]);

  if (!user || !business) {
    throw new Error("Business not found");
  }

  const monthStart = currentMonthStart(generatedAt);
  const priorMonthStart = previousMonthStart(generatedAt);
  const activityStart = chartStart(generatedAt);
  const installedAgentRefs = business.installedAgents.map((agent) => ({
    id: agent.id,
    listingId: agent.listingId
  }));

  const [
    payments,
    usageInvoices,
    usageByMonth,
    callsThisMonth,
    callsPriorMonth,
    missedCallsThisMonth,
    missedCallsPriorMonth,
    bookingsThisMonth,
    bookingsPriorMonth,
    currentMonthBookings,
    chartAppointments,
    chartMissedCalls,
    chartCalls,
    currentAgentStats,
    allTimeAgentStats,
    agentConversationCalls,
    appointmentConversationRows
  ] = await Promise.all([
    prisma.payment.findMany({
      where:
        ownedBusinessCount === 1
          ? {
              userId: ownerUserId,
              OR: [{ businessId: business.id }, { businessId: null }]
            }
          : { userId: ownerUserId, businessId: business.id },
      orderBy: { createdAt: "desc" },
      include: {
        listing: {
          select: {
            id: true,
            name: true,
            shortDescription: true,
            description: true,
            priceCents: true,
            pricingModel: true,
            category: true,
            tags: true,
            industryTags: true,
            iconUrl: true,
            freeTrialEnabled: true,
            trialDays: true,
            executionFeeCents: true
          }
        }
      }
    }),
    prisma.businessUsageInvoice.findMany({
      where: { businessId: business.id },
      orderBy: [{ billingMonth: "desc" }, { issuedAt: "desc" }],
      include: {
        installedAgent: { select: { id: true, name: true } },
        lineItems: { orderBy: { amountMicroUsd: "desc" } }
      }
    }),
    prisma.agentUsageExecution.groupBy({
      by: ["billingMonth", "installedAgentId"],
      where: { businessId: business.id },
      _count: { _all: true },
      _sum: { amountMicroUsd: true, legacyBilledCostMicroUsd: true },
      orderBy: [{ billingMonth: "desc" }, { installedAgentId: "asc" }]
    }),
    prisma.vapiCall.count({
      where: { businessId: business.id, executionMode: "LIVE", createdAt: { gte: monthStart } }
    }),
    prisma.vapiCall.count({
      where: {
        businessId: business.id,
        executionMode: "LIVE",
        createdAt: { gte: priorMonthStart, lt: monthStart }
      }
    }),
    prisma.lead.count({
      where: {
        businessId: business.id,
        source: { contains: "MISSED_CALL" },
        createdAt: { gte: monthStart }
      }
    }),
    prisma.lead.count({
      where: {
        businessId: business.id,
        source: { contains: "MISSED_CALL" },
        createdAt: { gte: priorMonthStart, lt: monthStart }
      }
    }),
    prisma.appointment.count({
      where: { businessId: business.id, executionMode: "LIVE", createdAt: { gte: monthStart } }
    }),
    prisma.appointment.count({
      where: {
        businessId: business.id,
        executionMode: "LIVE",
        createdAt: { gte: priorMonthStart, lt: monthStart }
      }
    }),
    prisma.appointment.findMany({
      where: { businessId: business.id, executionMode: "LIVE", createdAt: { gte: monthStart } },
      orderBy: { startAt: "desc" },
      take: 50,
      select: {
        id: true,
        customerName: true,
        customerPhone: true,
        service: true,
        startAt: true,
        endAt: true,
        timeZone: true,
        status: true,
        calendarEventLink: true,
        createdAt: true
      }
    }),
    prisma.appointment.findMany({
      where: { businessId: business.id, executionMode: "LIVE", createdAt: { gte: activityStart } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        customerName: true,
        customerPhone: true,
        service: true,
        startAt: true,
        createdAt: true
      }
    }),
    prisma.lead.findMany({
      where: {
        businessId: business.id,
        source: { contains: "MISSED_CALL" },
        createdAt: { gte: activityStart }
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, phoneNumber: true, name: true, createdAt: true }
    }),
    prisma.vapiCall.findMany({
      where: { businessId: business.id, executionMode: "LIVE", createdAt: { gte: activityStart } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        installedAgentId: true,
        customerPhone: true,
        status: true,
        billedCostMicroUsd: true,
        recordingUrl: true,
        createdAt: true
      }
    }),
    buildInstalledAgentRunStats(business.id, installedAgentRefs, { start: monthStart }),
    buildInstalledAgentRunStats(business.id, installedAgentRefs),
    prisma.vapiCall.findMany({
      where: {
        businessId: business.id,
        executionMode: "LIVE",
        conversationId: { not: null }
      },
      select: { installedAgentId: true, conversationId: true }
    }),
    prisma.appointment.findMany({
      where: {
        businessId: business.id,
        executionMode: "LIVE",
        conversationId: { not: null }
      },
      select: { conversationId: true }
    })
  ]);

  const confirmationSmsRows =
    currentMonthBookings.length > 0
      ? await prisma.smsExecution.findMany({
          where: {
            dedupeKey: {
              in: currentMonthBookings.map(
                (appointment) => `appointment-confirmation:${appointment.id}`
              )
            }
          },
          select: { dedupeKey: true, status: true, errorCode: true }
        })
      : [];

  const zip = new JSZip();
  const skippedImages: string[] = [];

  const profileImage = decodeEmbeddedExportImage(user.profilePhotoUrl);
  let profileImageSrc: string | undefined;
  if (profileImage) {
    const filename = `profile-photo.${profileImage.extension}`;
    zip.file(`01-profile/${filename}`, profileImage.bytes);
    profileImageSrc = `./${filename}`;
  } else if (user.profilePhotoUrl) {
    skippedImages.push("The profile photo was not copied because it was not a supported embedded raster image.");
  }

  const paymentsByListing = new Map<string, typeof payments>();
  for (const payment of payments) {
    if (!payment.listingId || !payment.listing) continue;
    const listingPayments = paymentsByListing.get(payment.listingId) ?? [];
    listingPayments.push(payment);
    paymentsByListing.set(payment.listingId, listingPayments);
  }

  const conversationAgent = new Map<string, string>();
  for (const call of agentConversationCalls) {
    if (call.conversationId && call.installedAgentId) {
      conversationAgent.set(call.conversationId, call.installedAgentId);
    }
  }
  const bookingsByAgent = new Map<string, number>();
  for (const appointment of appointmentConversationRows) {
    if (!appointment.conversationId) continue;
    const installedAgentId = conversationAgent.get(appointment.conversationId);
    if (!installedAgentId) continue;
    bookingsByAgent.set(installedAgentId, (bookingsByAgent.get(installedAgentId) ?? 0) + 1);
  }

  const agentNames = new Map(business.installedAgents.map((agent) => [agent.id, agent.name]));
  type InstalledAgent = (typeof business.installedAgents)[number];
  type Payment = (typeof payments)[number];
  type ExportListing = NonNullable<Payment["listing"]>;
  type ExportAgentRow = {
    agent: InstalledAgent | null;
    listing: ExportListing | null;
    payment: Payment | undefined;
  };

  const installedByListingId = new Map(
    business.installedAgents
      .filter((agent) => agent.listingId)
      .map((agent) => [agent.listingId!, agent])
  );
  const exportAgentRows: ExportAgentRow[] = business.installedAgents.map((agent) => {
    const listingPayments = agent.listingId
      ? paymentsByListing.get(agent.listingId) ?? []
      : [];
    return {
      agent,
      listing: agent.listing,
      payment: resolveActivePayment(listingPayments) ?? listingPayments[0]
    };
  });

  for (const [listingId, listingPayments] of paymentsByListing) {
    if (installedByListingId.has(listingId)) continue;
    const activePayment = resolveActivePayment(listingPayments);
    if (!activePayment?.listing) continue;
    exportAgentRows.push({
      agent: null,
      listing: activePayment.listing,
      payment: activePayment
    });
  }

  const agentCards: ExportCard[] = exportAgentRows.map(({ agent, listing, payment }, index) => {
    const monthly = agent
      ? currentAgentStats.get(agent.id) ?? { runs: 0, costMicroUsd: 0 }
      : { runs: 0, costMicroUsd: 0 };
    const lifetime = agent
      ? allTimeAgentStats.get(agent.id) ?? { runs: 0, costMicroUsd: 0 }
      : { runs: 0, costMicroUsd: 0 };
    const icon = decodeEmbeddedExportImage(listing?.iconUrl);
    let imageSrc: string | undefined;

    if (icon) {
      const filename = `agent-${String(index + 1).padStart(2, "0")}-icon.${icon.extension}`;
      zip.file(`03-my-agents/images/${filename}`, icon.bytes);
      imageSrc = `./images/${filename}`;
    } else if (listing?.iconUrl) {
      skippedImages.push(
        `The image for ${listing.name} was not copied because it was not a supported embedded raster image.`
      );
    }

    const normalizedStatus = agent?.status.toUpperCase();
    const state = !agent
      ? payment?.status === "TRIALING"
        ? "Trial · Setup required"
        : "Setup required"
      : normalizedStatus === "PAUSED"
        ? "Paused"
        : normalizedStatus === "SUSPENDED_BILLING"
          ? "Payment required"
          : normalizedStatus === "ACTIVE"
            ? "Live"
            : normalizedStatus === "INACTIVE" || normalizedStatus === "CANCELED"
              ? "Inactive"
              : "Setup required";
    const trialRemaining = agent
      ? Math.max(0, agent.trialExecutionLimit - agent.trialExecutionsUsed)
      : null;
    const usageFeeCents = agent?.executionFeeCents ?? listing?.executionFeeCents ?? 0;

    return {
      title: listing?.name ?? agent?.name ?? "Agent",
      badge: state,
      description: listing?.shortDescription ?? listing?.description ?? undefined,
      imageSrc,
      imageAlt: listing ? `${listing.name} icon` : "Agent icon",
      fields: [
        { label: "Added", value: formatExportDate(payment?.createdAt ?? agent?.createdAt) },
        {
          label: "Purchase status",
          value: formatExportStatus(
            payment?.status ?? (listing?.pricingModel === "FREE" ? "FREE" : agent?.status)
          )
        },
        {
          label: "Price",
          value:
            listing?.pricingModel === "FREE"
              ? "Free"
              : formatExportMoneyFromCents(listing?.priceCents ?? 0)
        },
        { label: "Pricing model", value: formatExportStatus(listing?.pricingModel) },
        { label: "Category", value: displayOptional(listing?.category) },
        { label: "Executions this month", value: monthly.runs.toLocaleString("en-US") },
        { label: "Usage cost this month", value: formatExportMoneyFromMicroUsd(monthly.costMicroUsd) },
        { label: "Lifetime executions", value: lifetime.runs.toLocaleString("en-US") },
        {
          label: "Lifetime bookings",
          value: (agent ? bookingsByAgent.get(agent.id) ?? 0 : 0).toLocaleString("en-US")
        },
        {
          label: "Usage charge",
          value:
            usageFeeCents > 0
              ? `${formatExportMoneyFromCents(usageFeeCents)} per execution`
              : "Usage-based charges are shown in Billing & Usage"
        },
        ...(payment?.status === "TRIALING" && trialRemaining !== null
          ? [{ label: "Trial executions remaining", value: trialRemaining.toLocaleString("en-US") }]
          : [])
      ],
      tags: Array.from(new Set([...(listing?.industryTags ?? []), ...(listing?.tags ?? [])]))
    };
  });

  const invoiceBillingName = business.billingName ?? business.name ?? user.fullName ?? "Customer";
  const invoiceBillingEmail = business.billingEmail ?? user.email;
  const invoiceBillingAddress = [business.billingAddress, business.billingPostalCode]
    .filter(Boolean)
    .join(", ") || null;
  const billingInvoices = buildBillingInvoices(payments);
  const paymentExportInvoices: ExportInvoice[] = billingInvoices.map((invoice) => ({
    invoiceNumber: paymentInvoiceNumber(invoice.id),
    date: new Date(invoice.createdAt),
    description: invoice.description,
    amountCents: invoice.displayAmountCents,
    listPriceCents: invoice.amountCents,
    currency: invoice.currency,
    status: invoice.status,
    billingName: invoice.billingName ?? invoiceBillingName,
    billingEmail: invoice.billingEmail ?? invoiceBillingEmail,
    billingAddress: invoice.billingAddress ?? invoiceBillingAddress,
    agentName: invoice.listingName ?? "Agent purchase",
    transactionId: invoice.id,
    lineItems:
      invoice.lineItems?.length
        ? invoice.lineItems
        : [{ label: invoice.description, amountCents: invoice.displayAmountCents }]
  }));

  const invoicedListingIds = new Set(billingInvoices.map((invoice) => invoice.listingId).filter(Boolean));
  for (const [index, agent] of business.installedAgents.entries()) {
    if (agent.listing?.pricingModel !== "FREE" || !agent.listingId || invoicedListingIds.has(agent.listingId)) {
      continue;
    }
    const syntheticId = `free-install-${agent.id}`;
    paymentExportInvoices.push({
      invoiceNumber: paymentInvoiceNumber(syntheticId),
      date: agent.createdAt,
      description: `Free install of ${agent.listing.name}`,
      amountCents: 0,
      listPriceCents: 0,
      currency: "usd",
      status: "PAID",
      billingName: invoiceBillingName,
      billingEmail: invoiceBillingEmail,
      billingAddress: invoiceBillingAddress,
      agentName: agent.listing.name,
      transactionId: syntheticId,
      lineItems: [{ label: `Free installation - agent ${index + 1}`, amountCents: 0 }]
    });
  }

  const usageExportInvoices: ExportInvoice[] = usageInvoices.map((invoice) => {
    const amountCents = Math.round(invoice.totalMicroUsd / 10_000);
    return {
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.issuedAt,
      description: `Agent usage for ${invoice.billingMonth}`,
      amountCents,
      currency: invoice.currency,
      status: invoice.status === "OPEN" ? "PENDING" : invoice.status,
      billingName: invoiceBillingName,
      billingEmail: invoiceBillingEmail,
      billingAddress: invoiceBillingAddress,
      agentName: invoice.installedAgent?.name ?? "Business agents",
      transactionId: invoice.stripePaymentIntentId,
      lineItems:
        invoice.lineItems.length > 0
          ? usageLineItemsInCents(
              invoice.lineItems,
              invoice.totalMicroUsd,
              invoice.currency
            )
          : [{ label: `Agent usage for ${invoice.billingMonth}`, amountCents }]
    };
  });

  const archivedPaymentInvoices: ArchiveInvoice[] = paymentExportInvoices.map((invoice, index) => {
    const filename = `${String(index + 1).padStart(3, "0")}-${archiveSafeName(invoice.invoiceNumber)}.pdf`;
    return {
      ...invoice,
      archivePath: `04-billing-and-usage/invoices/agent-invoices/${filename}`,
      pageHref: `./invoices/agent-invoices/${filename}`
    };
  });
  const archivedUsageInvoices: ArchiveInvoice[] = usageExportInvoices.map((invoice, index) => {
    const filename = `${String(index + 1).padStart(3, "0")}-${archiveSafeName(invoice.invoiceNumber)}.pdf`;
    return {
      ...invoice,
      archivePath: `04-billing-and-usage/invoices/usage-invoices/${filename}`,
      pageHref: `./invoices/usage-invoices/${filename}`
    };
  });

  await addInvoicePdfs(zip, [...archivedPaymentInvoices, ...archivedUsageInvoices]);

  const confirmationByAppointmentId = new Map(
    confirmationSmsRows.map((row) => [
      (row.dedupeKey ?? "").replace("appointment-confirmation:", ""),
      { status: row.status, errorCode: row.errorCode }
    ])
  );
  /* THE EXPORT DISAGREED WITH THE DASHBOARD IT SAYS IT COPIES.
     This page tells the business it is "a readable copy of the performance
     information shown on your business dashboard" — and then counted
     something else: voice calls plus missed-call leads, while the dashboard
     counts entries in the usage ledger, which is a different population
     entirely. A business comparing the two found two different answers to one
     question, on the document they would take to their accountant. */
  const callsHandledThisMonth = await prisma.agentUsageExecution.count({
    where: { businessId: business.id, billingMonth: monthStart.toISOString().slice(0, 7) }
  });
  const callsHandledPriorMonth = await prisma.agentUsageExecution.count({
    where: { businessId: business.id, billingMonth: priorMonthStart.toISOString().slice(0, 7) }
  });
  const totalSpendCents = sumInvoiceTotalCents(payments);
  const agentNameById = new Map(business.installedAgents.map((agent) => [agent.id, agent.name]));
  const lifecycleActivities = buildDashboardActivities(
    payments,
    business.installedAgents
  ).map((activity) => ({
    createdAt: new Date(activity.createdAt),
    type: activity.badge,
    description: activity.text
  }));
  const activityRows = [
    ...lifecycleActivities,
    ...chartAppointments.map((appointment) => ({
      createdAt: appointment.createdAt,
      type: "Booking",
      description: `Booked ${appointment.service?.trim() || "an appointment"} for ${
        appointment.customerName?.trim() || appointment.customerPhone
      }`
    })),
    ...chartMissedCalls.map((lead) => ({
      createdAt: lead.createdAt,
      type: "Missed call",
      description: `Captured a missed call from ${lead.name?.trim() || lead.phoneNumber}`
    })),
    ...chartCalls.map((call) => ({
      createdAt: call.createdAt,
      type: "AI call",
      description: `${agentNameById.get(call.installedAgentId ?? "") ?? "An agent"} handled a call with ${
        call.customerPhone
      }${call.recordingUrl ? " (recording available in Triven)" : ""}`
    }))
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 30)
    .map((activity) => [
      formatExportDate(activity.createdAt),
      activity.type,
      activity.description
    ]);

  const profileFields: ExportField[] = [
    { label: "Full name", value: displayOptional(user.fullName) },
    { label: "Email", value: user.email },
    { label: "Phone", value: displayOptional(user.phone) },
    { label: "Location", value: displayOptional(user.location) },
    { label: "Account timezone", value: displayOptional(user.timezone) },
    { label: "Account created", value: formatExportDate(user.createdAt) }
  ];
  const businessProfileFields: ExportField[] = [
    { label: "Business name", value: business.name },
    { label: "Business type", value: business.type },
    { label: "Business size", value: displayOptional(business.profile?.businessSize) },
    { label: "Team phone", value: displayOptional(business.profile?.teamPhone) },
    { label: "Booking URL", value: displayOptional(business.profile?.bookingUrl) },
    { label: "Business timezone", value: displayOptional(business.profile?.timeZone) },
    {
      label: "Business address",
      value: displayOptional(formatAddressOneLine(addressFromProfile(business.profile)))
    },
    { label: "Invoice address", value: displayOptional(business.billingAddress) },
    { label: "Business created", value: formatExportDate(business.createdAt) }
  ];

  zip.file(
    "01-profile/profile.html",
    renderBusinessExportPage({
      eyebrow: "01 · Profile",
      title: "Profile",
      intro: "The personal and business profile information saved in your Triven settings.",
      generatedAt,
      homeHref: "../start-here.html",
      stats: [
        { label: "Business", value: business.name },
        { label: "Account since", value: formatExportDate(user.createdAt).split(" at ")[0] ?? "" }
      ],
      sections: [
        {
          title: "Profile photo",
          description: profileImageSrc
            ? "Your saved photo is included below as a normal image file."
            : "No supported embedded profile photo was available.",
          cards: [
            {
              title: user.fullName ?? business.name,
              badge: "Account owner",
              imageSrc: profileImageSrc,
              imageAlt: "Profile photo",
              fields: profileFields
            }
          ]
        },
        { title: "Business profile", fields: businessProfileFields }
      ]
    })
  );

  zip.file(
    "02-dashboard/dashboard.html",
    renderBusinessExportPage({
      eyebrow: "02 · Dashboard",
      title: "Dashboard",
      intro: "A readable copy of the performance information shown on your business dashboard.",
      generatedAt,
      homeHref: "../start-here.html",
      stats: [
        {
          label: "Calls handled",
          value: callsHandledThisMonth.toLocaleString("en-US"),
          note: `${formatExportTrend(callsHandledThisMonth, callsHandledPriorMonth)} vs previous month`
        },
        {
          label: "Appointments booked",
          value: bookingsThisMonth.toLocaleString("en-US"),
          note: `${formatExportTrend(bookingsThisMonth, bookingsPriorMonth)} vs previous month`
        },
        { label: "Total spend", value: formatExportMoneyFromCents(totalSpendCents), note: "All time" }
      ],
      sections: [
        {
          title: "Current-month bookings",
          description:
            currentMonthBookings.length < bookingsThisMonth
              ? `Showing the latest ${currentMonthBookings.length} of ${bookingsThisMonth} bookings.`
              : `${bookingsThisMonth} bookings were created this month.`,
          tables: [
            {
              title: "Bookings",
              columns: [
                "Customer",
                "Phone",
                "Service",
                "Starts",
                "Ends",
                "Timezone",
                "Status",
                "Calendar",
                "Confirmation text"
              ],
              rows: currentMonthBookings.map((booking) => {
                const confirmation = confirmationByAppointmentId.get(booking.id);
                const calendarHref = safeExternalHref(booking.calendarEventLink);
                return [
                  displayOptional(booking.customerName),
                  booking.customerPhone,
                  displayOptional(booking.service),
                  formatExportDate(booking.startAt),
                  formatExportDate(booking.endAt),
                  displayOptional(booking.timeZone),
                  { text: formatExportStatus(booking.status), badge: true },
                  calendarHref
                    ? { text: "Open event", href: calendarHref }
                    : "Not linked",
                  confirmation
                    ? `${formatExportStatus(confirmation.status)}${
                        confirmation.errorCode ? ` (${confirmation.errorCode})` : ""
                      }`
                    : "No status recorded"
                ];
              }),
              emptyMessage: "No bookings were created this month."
            }
          ]
        },
        {
          title: "Agent activity - last 30 days",
          description: "Daily executions, bookings, and billed usage cost from the dashboard chart.",
          tables: [
            {
              title: "Daily activity",
              columns: ["Date", "Executions", "Bookings", "Usage cost"],
              rows: buildChartRows({
                now: generatedAt,
                appointments: chartAppointments,
                missedCalls: chartMissedCalls,
                calls: chartCalls
              }),
              emptyMessage: "No activity was recorded in the last 30 days."
            },
            {
              title: "Latest activity",
              description: "The latest 30 items shown in the dashboard activity feed.",
              columns: ["Time", "Type", "Activity"],
              rows: activityRows,
              emptyMessage: "No recent dashboard activity was found."
            }
          ]
        }
      ]
    })
  );

  zip.file(
    "03-my-agents/my-agents.html",
    renderBusinessExportPage({
      eyebrow: "03 · My Agents",
      title: "My Agents",
      intro: "The agents currently associated with your business, shown in the same simple terms as My Agents.",
      generatedAt,
      homeHref: "../start-here.html",
      stats: [
        { label: "Agents", value: exportAgentRows.length.toLocaleString("en-US") },
        {
          label: "Live",
          value: business.installedAgents
            .filter((agent) => agent.status.toUpperCase() === "ACTIVE")
            .length.toLocaleString("en-US")
        },
        {
          label: "Runs this month",
          value: Array.from(currentAgentStats.values())
            .reduce((sum, stats) => sum + stats.runs, 0)
            .toLocaleString("en-US")
        }
      ],
      sections: [
        {
          title: "Agent list",
          description:
            "Agent source code, workflow definitions, connector secrets, and internal configuration are not included.",
          cards: agentCards
        }
      ]
    })
  );

  const usageTotalByMonth = new Map<string, number>();
  for (const row of usageByMonth) {
    const total = (row._sum.amountMicroUsd ?? 0) + (row._sum.legacyBilledCostMicroUsd ?? 0);
    usageTotalByMonth.set(row.billingMonth, (usageTotalByMonth.get(row.billingMonth) ?? 0) + total);
  }
  const currentBillingMonth = generatedAt.toISOString().slice(0, 7);
  const outstandingPaymentCents = billingInvoices
    .filter((invoice) => invoice.tabStatus === "PENDING" || invoice.tabStatus === "OVERDUE")
    .reduce((sum, invoice) => sum + invoice.displayAmountCents, 0);
  const outstandingUsageCents = usageInvoices
    .filter((invoice) => ["OPEN", "PENDING", "OVERDUE"].includes(invoice.status))
    .reduce((sum, invoice) => sum + Math.round(invoice.totalMicroUsd / 10_000), 0);

  zip.file(
    "04-billing-and-usage/billing-and-usage.html",
    renderBusinessExportPage({
      eyebrow: "04 · Billing & Usage",
      title: "Billing & Usage",
      intro: "Your billing summary, monthly usage history, invoice index, and individually downloadable invoice PDFs.",
      generatedAt,
      homeHref: "../start-here.html",
      stats: [
        { label: "Total paid", value: formatExportMoneyFromCents(totalSpendCents), note: "Agent invoices" },
        {
          label: "Current usage",
          value: formatExportMoneyFromMicroUsd(usageTotalByMonth.get(currentBillingMonth) ?? 0),
          note: currentBillingMonth
        },
        {
          label: "Outstanding",
          value: formatExportMoneyFromCents(outstandingPaymentCents + outstandingUsageCents),
          note: "Agent and usage invoices"
        },
        {
          label: "Invoice PDFs",
          value: String(archivedPaymentInvoices.length + archivedUsageInvoices.length),
          note: "Included in this ZIP"
        }
      ],
      sections: [
        {
          title: "Billing profile",
          fields: [
            { label: "Billed to", value: invoiceBillingName },
            { label: "Billing email", value: invoiceBillingEmail },
            { label: "Billing address", value: displayOptional(invoiceBillingAddress) },
            { label: "Plan status", value: formatExportStatus(business.subscriptionStatus) }
          ]
        },
        {
          title: "Usage history",
          description: "Monthly usage grouped by agent.",
          tables: [
            {
              title: "Usage by month and agent",
              columns: ["Month", "Agent", "Executions", "Billed usage"],
              rows: usageByMonth.map((row) => [
                row.billingMonth,
                agentNames.get(row.installedAgentId) ?? "Unassigned",
                row._count._all.toLocaleString("en-US"),
                formatExportMoneyFromMicroUsd(
                  (row._sum.amountMicroUsd ?? 0) + (row._sum.legacyBilledCostMicroUsd ?? 0)
                )
              ]),
              emptyMessage: "No usage has been recorded."
            }
          ]
        },
        {
          title: "Invoices",
          description: "Select “Download PDF” to open any invoice included in the archive.",
          tables: [
            {
              title: "Agent invoices",
              columns: ["Invoice", "Date", "Description", "Status", "Amount", "File"],
              rows: archivedPaymentInvoices.map((invoice) => [
                invoice.invoiceNumber,
                formatExportDate(invoice.date),
                invoice.description,
                { text: formatExportStatus(invoice.status), badge: true },
                formatExportMoneyFromCents(invoice.amountCents, invoice.currency),
                { text: "Download PDF", href: invoice.pageHref }
              ]),
              emptyMessage: "No agent invoices were found."
            },
            {
              title: "Usage invoices",
              columns: ["Invoice", "Date", "Description", "Status", "Amount", "File"],
              rows: archivedUsageInvoices.map((invoice) => [
                invoice.invoiceNumber,
                formatExportDate(invoice.date),
                invoice.description,
                { text: formatExportStatus(invoice.status), badge: true },
                formatExportMoneyFromCents(invoice.amountCents, invoice.currency),
                { text: "Download PDF", href: invoice.pageHref }
              ]),
              emptyMessage: "No usage invoices were found."
            }
          ]
        }
      ]
    })
  );

  const categories = [
    {
      href: "01-profile/profile.html",
      number: "01",
      title: "Profile",
      description: "Your account and business profile details.",
      detail: profileImageSrc ? "Profile details + photo" : "Profile details"
    },
    {
      href: "02-dashboard/dashboard.html",
      number: "02",
      title: "Dashboard",
      description: "Performance metrics, bookings, and recent activity.",
      detail: `${callsHandledThisMonth} calls · ${bookingsThisMonth} bookings this month`
    },
    {
      href: "03-my-agents/my-agents.html",
      number: "03",
      title: "My Agents",
      description: "Agent status, pricing, usage, and performance.",
      detail: `${exportAgentRows.length} agents`
    },
    {
      href: "04-billing-and-usage/billing-and-usage.html",
      number: "04",
      title: "Billing & Usage",
      description: "Billing summaries, usage history, and invoice PDFs.",
      detail: `${archivedPaymentInvoices.length + archivedUsageInvoices.length} invoice PDFs`
    }
  ];

  zip.file(
    "start-here.html",
    renderBusinessExportHome({
      businessName: business.name,
      generatedAt,
      categories,
      skippedImages
    })
  );
  zip.file(
    "README.txt",
    buildBusinessExportReadme({
      businessName: business.name,
      generatedAt,
      skippedImages
    })
  );

  const dateStamp = generatedAt.toISOString().slice(0, 10);
  const content = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });

  return {
    filename: `triven-${archiveSafeName(business.name).toLowerCase()}-data-${dateStamp}.zip`,
    zip: content
  };
}
