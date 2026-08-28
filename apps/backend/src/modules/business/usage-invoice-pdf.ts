import { buildInvoicePdfBuffer, type InvoiceData } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";

/**
 * THE HALF OF THE BILL THAT COULD NOT BE DOWNLOADED.
 *
 * "Download all invoices" walked the agent purchases and stopped. Every usage
 * invoice — the monthly bill for what the agents actually did, which is most
 * of what a business pays us — was skipped in silence: no error, no mention,
 * a toast saying the download was ready. A business assembling a year for
 * their accountant got the small half and no sign the big half existed.
 *
 * The data-export ZIP had been building these PDFs all along. That builder
 * lives here now, so the download button and the export produce the same
 * document from the same code rather than two that drift apart.
 */

/**
 * Usage is metered in micro-dollars and shown in cents. Rounding each row on
 * its own loses fractions of a cent that the total does not lose, so the rows
 * would not add up to the amount charged. Each row is allocated from the
 * running cumulative total instead, and any last remainder is stated as its
 * own line rather than hidden.
 */
export function usageLineItemsInCents(
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

export type UsageInvoiceForPdf = {
  invoiceNumber: string;
  issuedAt: Date;
  billingMonth: string;
  totalMicroUsd: number;
  currency: string;
  status: string;
  stripePaymentIntentId: string | null;
  installedAgent: { name: string | null } | null;
  lineItems: Array<{
    serviceName: string;
    amountMicroUsd: number;
    quantity: number;
    unitPriceMicroUsd: number;
  }>;
};

export type UsageInvoiceBillTo = {
  billingName: string;
  billingEmail: string;
  billingAddress: string | null;
};

/** One usage invoice, in the shape the PDF writer already understands. */
export function buildUsageInvoiceData(
  invoice: UsageInvoiceForPdf,
  billTo: UsageInvoiceBillTo
): InvoiceData {
  const amountCents = Math.round(invoice.totalMicroUsd / 10_000);
  return {
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.issuedAt,
    businessName: billTo.billingName,
    businessEmail: billTo.billingEmail,
    billingAddress: billTo.billingAddress,
    agentName: invoice.installedAgent?.name ?? "Business agents",
    description: `Agent usage for ${invoice.billingMonth}`,
    amountCents,
    currency: invoice.currency,
    /* OPEN is our word for it, not a word a customer uses. */
    status: invoice.status === "OPEN" ? "PENDING" : invoice.status,
    transactionId: invoice.stripePaymentIntentId ?? undefined,
    lineItems:
      invoice.lineItems.length > 0
        ? usageLineItemsInCents(invoice.lineItems, invoice.totalMicroUsd, invoice.currency)
        : [{ label: `Agent usage for ${invoice.billingMonth}`, amountCents }]
  };
}

/**
 * Load one usage invoice this business owns and render it. Returns null when
 * the invoice is not theirs, so the caller answers "not found" either way and
 * never confirms that somebody else's invoice number exists.
 */
export async function buildUsageInvoicePdf(
  businessId: string,
  invoiceId: string
): Promise<{ invoiceNumber: string; pdf: Buffer } | null> {
  const invoice = await prisma.businessUsageInvoice.findFirst({
    where: { id: invoiceId, businessId },
    include: {
      installedAgent: { select: { name: true } },
      lineItems: { orderBy: { amountMicroUsd: "desc" } }
    }
  });

  if (!invoice) return null;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      billingName: true,
      billingEmail: true,
      billingAddress: true,
      billingPostalCode: true,
      owner: { select: { email: true, fullName: true } }
    }
  });

  const billTo: UsageInvoiceBillTo = {
    billingName:
      business?.billingName ?? business?.name ?? business?.owner?.fullName ?? "Customer",
    billingEmail: business?.billingEmail ?? business?.owner?.email ?? "",
    billingAddress:
      [business?.billingAddress, business?.billingPostalCode].filter(Boolean).join(", ") || null
  };

  const pdf = await buildInvoicePdfBuffer(buildUsageInvoiceData(invoice, billTo));
  return { invoiceNumber: invoice.invoiceNumber, pdf };
}
