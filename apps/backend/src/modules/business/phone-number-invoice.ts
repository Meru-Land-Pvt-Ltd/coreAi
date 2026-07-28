import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  billingMonthFor,
  invoiceLifecycleDates,
  MICRO_USD_PER_CENT,
  usageInvoiceNumber
} from "./execution-billing";
import {
  getPhoneNumberFee,
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
        status: true,
        feeBilledAt: true
      }
    }),
    tx.installedAgent.findFirst({
      where: {
        id: input.installedAgentId,
        businessId: input.businessId
      },
      select: { id: true }
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
  if (number.feeBilledAt) {
    return { added: false, invoiceId: null, amountMicroUsd: 0 };
  }

  const billingMonth = billingMonthFor(input.chargedAt);
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
    const lifecycle = invoiceLifecycleDates(billingMonth);

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
        periodStart: input.chargedAt,
        periodEnd: lifecycle.end,
        issuedAt: input.chargedAt,
        dueAt: lifecycle.dueAt,
        graceEndsAt: lifecycle.graceEndsAt,
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

  await tx.platformPhoneNumber.update({
    where: { id: input.platformPhoneNumberId },
    data: { feeBilledAt: input.chargedAt }
  });

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
  const fee = await getPhoneNumberFee();
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
