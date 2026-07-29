import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  billingMonthFor,
  MICRO_USD_PER_CENT,
  usageInvoiceNumber
} from "./execution-billing";
import { resolveAgentBillingPeriod } from "./agent-payment-scope";
import {
  getPhoneNumberFeeForPlatformNumber,
  PHONE_NUMBER_SERVICE_CODE,
  type PhoneNumberFee
} from "./phone-provisioning";

type PhoneInvoiceTx = Prisma.TransactionClient;

export type PhoneNumberInvoiceResult = {
  added: boolean;
  invoiceId: string | null;
  amountMicroUsd: number;
};

export async function addPhoneNumberFeeToPendingInvoiceTx(
  tx: PhoneInvoiceTx,
  input: {
    platformPhoneNumberId: string;
    businessId: string;
    installedAgentId: string;
    chargedAt: Date;
  },
  fee: PhoneNumberFee
): Promise<PhoneNumberInvoiceResult> {
  const amountMicroUsd =
    Math.max(0, Math.round(fee.amountCents)) * MICRO_USD_PER_CENT;
  if (amountMicroUsd <= 0) {
    return { added: false, invoiceId: null, amountMicroUsd: 0 };
  }

  // Execution metering uses this same agent lock. Taking it here prevents a
  // first call and a number assignment from racing to create the same monthly
  // invoice sequence.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-execution:${input.installedAgentId}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`phone-number-invoice:${input.platformPhoneNumberId}`}))`;

  const [number, agent] = await Promise.all([
    tx.platformPhoneNumber.findUnique({
      where: { id: input.platformPhoneNumberId },
      select: {
        businessId: true,
        installedAgentId: true,
        status: true
      }
    }),
    tx.installedAgent.findFirst({
      where: {
        id: input.installedAgentId,
        businessId: input.businessId
      },
      select: {
        id: true,
        businessId: true,
        listingId: true,
        createdAt: true,
        business: { select: { ownerId: true } }
      }
    })
  ]);

  if (!agent) {
    throw new Error("PHONE_INVOICE_AGENT_MISMATCH");
  }
  if (
    !number ||
    number.status !== "ASSIGNED" ||
    number.businessId !== input.businessId ||
    number.installedAgentId !== input.installedAgentId
  ) {
    throw new Error("PHONE_INVOICE_ASSIGNMENT_MISMATCH");
  }
  const billingPeriod = await resolveAgentBillingPeriod(
    tx,
    {
      id: agent.id,
      businessId: agent.businessId,
      listingId: agent.listingId,
      createdAt: agent.createdAt,
      ownerUserId: agent.business.ownerId
    },
    input.chargedAt
  );
  const billingMonth = billingPeriod.key;
  // A number is billed once per agent/month, even if that month's first
  // invoice has already been paid and a later execution creates a new invoice.
  const existingMonthlyLine = await tx.businessUsageInvoiceLineItem.findFirst({
    where: {
      serviceCode: PHONE_NUMBER_SERVICE_CODE,
      invoice: {
        businessId: input.businessId,
        installedAgentId: input.installedAgentId,
        billingMonth,
        status: { not: "VOID" }
      }
    },
    select: { id: true, invoiceId: true }
  });
  if (existingMonthlyLine) {
    return {
      added: false,
      invoiceId: existingMonthlyLine.invoiceId,
      amountMicroUsd: 0
    };
  }

  let invoice = await tx.businessUsageInvoice.findFirst({
    where: {
      businessId: input.businessId,
      installedAgentId: input.installedAgentId,
      billingMonth,
      status: { in: ["PENDING", "OPEN"] },
      paidAt: null,
      closedAt: null,
      paymentPendingAt: null,
      stripePaymentIntentId: null
    },
    orderBy: { sequence: "desc" },
    select: { id: true }
  });

  if (!invoice) {
    const latest = await tx.businessUsageInvoice.findFirst({
      where: {
        installedAgentId: input.installedAgentId,
        billingMonth
      },
      orderBy: { sequence: "desc" },
      select: { sequence: true }
    });
    const sequence = (latest?.sequence ?? 0) + 1;
    invoice = await tx.businessUsageInvoice.create({
      data: {
        businessId: input.businessId,
        installedAgentId: input.installedAgentId,
        billingMonth,
        sequence,
        invoiceNumber: usageInvoiceNumber({
          businessId: input.businessId,
          installedAgentId: input.installedAgentId,
          billingMonth,
          sequence
        }),
        status: "PENDING",
        periodStart: billingPeriod.start,
        periodEnd: billingPeriod.end,
        issuedAt: input.chargedAt,
        dueAt: billingPeriod.dueAt,
        graceEndsAt: billingPeriod.graceEndsAt,
        subtotalMicroUsd: 0,
        totalMicroUsd: 0
      },
      select: { id: true }
    });
  }

  const existingLine = await tx.businessUsageInvoiceLineItem.findUnique({
    where: {
      invoiceId_serviceCode: {
        invoiceId: invoice.id,
        serviceCode: PHONE_NUMBER_SERVICE_CODE
      }
    },
    select: { id: true }
  });

  if (!existingLine) {
    await tx.businessUsageInvoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        serviceCode: PHONE_NUMBER_SERVICE_CODE,
        serviceName: fee.label,
        unit: "PER_UNIT",
        quantity: 1,
        unitPriceMicroUsd: amountMicroUsd,
        amountMicroUsd
      }
    });
    await tx.businessUsageInvoice.update({
      where: { id: invoice.id },
      data: {
        subtotalMicroUsd: { increment: amountMicroUsd },
        totalMicroUsd: { increment: amountMicroUsd }
      }
    });
  }

  return {
    added: !existingLine,
    invoiceId: invoice.id,
    amountMicroUsd: existingLine ? 0 : amountMicroUsd
  };
}

export async function addPhoneNumberFeeToPendingInvoice(input: {
  platformPhoneNumberId: string;
  businessId: string;
  installedAgentId: string;
  chargedAt?: Date;
}): Promise<PhoneNumberInvoiceResult> {
  const fee = await getPhoneNumberFeeForPlatformNumber(
    input.platformPhoneNumberId
  );
  return prisma.$transaction((tx) =>
    addPhoneNumberFeeToPendingInvoiceTx(
      tx,
      {
        platformPhoneNumberId: input.platformPhoneNumberId,
        businessId: input.businessId,
        installedAgentId: input.installedAgentId,
        chargedAt: input.chargedAt ?? new Date()
      },
      fee
    )
  );
}

/**
 * Ensure every active agent-number assignment has one fixed phone-number line
 * on that agent's current monthly usage invoice. Each assignment is isolated
 * by installedAgentId and the line is idempotent for that agent/month.
 */
export async function ensureMonthlyAssignedNumberFees(now = new Date()): Promise<{
  considered: number;
  added: number;
  skipped: number;
  failed: number;
}> {
  const numbers = await prisma.platformPhoneNumber.findMany({
    where: {
      status: "ASSIGNED",
      isPlatformSmsSender: false,
      businessId: { not: null },
      installedAgentId: { not: null }
    },
    select: {
      id: true,
      businessId: true,
      installedAgentId: true
    }
  });

  let added = 0;
  let skipped = 0;
  let failed = 0;
  for (const number of numbers) {
    if (!number.businessId || !number.installedAgentId) continue;
    try {
      const result = await addPhoneNumberFeeToPendingInvoice({
        platformPhoneNumberId: number.id,
        businessId: number.businessId,
        installedAgentId: number.installedAgentId,
        chargedAt: now
      });
      if (result.added) added += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.error("[phone-number-billing] monthly fee reconciliation failed", {
        platformPhoneNumberId: number.id,
        installedAgentId: number.installedAgentId,
        billingMonth: billingMonthFor(now),
        error
      });
    }
  }

  return { considered: numbers.length, added, skipped, failed };
}
