import { describe, expect, it, vi } from "vitest";
import { addPhoneNumberFeeToPendingInvoiceTx } from "./phone-number-invoice";

const INPUT = {
  platformPhoneNumberId: "number-1",
  businessId: "business-1",
  installedAgentId: "agent-1",
  chargedAt: new Date("2026-07-28T10:30:00.000Z")
};
const BILLING_ANCHOR = new Date("2026-07-25T10:30:00.000Z");

const FEE = {
  amountCents: 200,
  label: "Dedicated Business Phone Number",
  serviceCode: "phone_number",
  pricingVersion: "twilio:local:1150000:2026-07-28T10:00:00.000Z"
};

function invoiceTx(options?: {
  pendingInvoiceId?: string | null;
  existingMonthlyLine?: { id: string; invoiceId: string } | null;
  existingInvoiceLineId?: string | null;
}) {
  const pendingInvoiceId = options?.pendingInvoiceId ?? null;
  const businessUsageInvoiceFindFirst = vi
    .fn()
    .mockResolvedValueOnce(
      pendingInvoiceId ? { id: pendingInvoiceId } : null
    );
  if (!pendingInvoiceId) {
    businessUsageInvoiceFindFirst.mockResolvedValueOnce(null);
  }

  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    platformPhoneNumber: {
      findUnique: vi.fn().mockResolvedValue({
        businessId: INPUT.businessId,
        installedAgentId: INPUT.installedAgentId,
        status: "ASSIGNED"
      })
    },
    installedAgent: {
      findFirst: vi.fn().mockResolvedValue({
        id: INPUT.installedAgentId,
        businessId: INPUT.businessId,
        listingId: "listing-1",
        createdAt: BILLING_ANCHOR,
        business: { ownerId: "owner-1" }
      })
    },
    // No executions yet: the billing anchor falls back to the payment chain,
    // which these fixtures pin to BILLING_ANCHOR.
    agentUsageExecution: {
      findFirst: vi.fn().mockResolvedValue(null)
    },
    payment: {
      findMany: vi.fn().mockResolvedValue([
        {
          status: "SUCCEEDED",
          invoiceKind: "PURCHASE",
          createdAt: BILLING_ANCHOR,
          paidAt: BILLING_ANCHOR,
          periodStart: BILLING_ANCHOR,
          periodEnd: new Date("2026-08-25T10:30:00.000Z"),
          dueAt: null
        }
      ])
    },
    businessUsageInvoice: {
      findFirst: businessUsageInvoiceFindFirst,
      create: vi.fn().mockResolvedValue({ id: "invoice-new" }),
      update: vi.fn().mockResolvedValue({ id: pendingInvoiceId ?? "invoice-new" })
    },
    businessUsageInvoiceLineItem: {
      findFirst: vi.fn().mockResolvedValue(options?.existingMonthlyLine ?? null),
      findUnique: vi.fn().mockResolvedValue(
        options?.existingInvoiceLineId
          ? { id: options.existingInvoiceLineId }
          : null
      ),
      create: vi.fn().mockResolvedValue({ id: "line-phone" })
    }
  };
}

describe("addPhoneNumberFeeToPendingInvoiceTx", () => {
  it("creates the agent's first pending invoice with one phone-number line", async () => {
    const tx = invoiceTx();

    const result = await addPhoneNumberFeeToPendingInvoiceTx(
      tx as never,
      INPUT,
      FEE
    );

    expect(result).toEqual({
      added: true,
      invoiceId: "invoice-new",
      amountMicroUsd: 2_000_000
    });
    expect(tx.businessUsageInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: INPUT.businessId,
        installedAgentId: INPUT.installedAgentId,
        billingMonth: "2026-07",
        sequence: 1,
        status: "PENDING",
        periodStart: new Date("2026-07-25T10:30:00.000Z"),
        periodEnd: new Date("2026-08-24T10:30:00.000Z"),
        dueAt: new Date("2026-08-24T10:30:00.000Z"),
        issuedAt: INPUT.chargedAt,
        subtotalMicroUsd: 0,
        totalMicroUsd: 0
      }),
      select: { id: true }
    });
    expect(tx.businessUsageInvoiceLineItem.create).toHaveBeenCalledWith({
      data: {
        invoiceId: "invoice-new",
        serviceCode: "phone_number",
        serviceName: FEE.label,
        unit: "PER_UNIT",
        quantity: 1,
        unitPriceMicroUsd: 2_000_000,
        amountMicroUsd: 2_000_000
      }
    });
    expect(tx.businessUsageInvoice.update).toHaveBeenCalledWith({
      where: { id: "invoice-new" },
      data: {
        subtotalMicroUsd: { increment: 2_000_000 },
        totalMicroUsd: { increment: 2_000_000 }
      }
    });
  });

  it("adds the line to an existing pending invoice for the same agent", async () => {
    const tx = invoiceTx({ pendingInvoiceId: "invoice-current" });

    const result = await addPhoneNumberFeeToPendingInvoiceTx(
      tx as never,
      INPUT,
      FEE
    );

    expect(result).toEqual({
      added: true,
      invoiceId: "invoice-current",
      amountMicroUsd: 2_000_000
    });
    expect(tx.businessUsageInvoice.create).not.toHaveBeenCalled();
    expect(tx.businessUsageInvoiceLineItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: "invoice-current",
        serviceCode: "phone_number",
        quantity: 1
      })
    });
  });

  it("keeps the monthly phone fee on the current 30-day usage invoice", async () => {
    const tx = invoiceTx();
    const augustInput = {
      ...INPUT,
      chargedAt: new Date("2026-08-25T10:31:00.000Z")
    };

    const result = await addPhoneNumberFeeToPendingInvoiceTx(
      tx as never,
      augustInput,
      FEE
    );

    expect(result.added).toBe(true);
    expect(tx.businessUsageInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        installedAgentId: INPUT.installedAgentId,
        billingMonth: "2026-08",
        periodStart: new Date("2026-08-24T10:30:00.000Z"),
        periodEnd: new Date("2026-09-23T10:30:00.000Z")
      }),
      select: { id: true }
    });
    expect(tx.businessUsageInvoiceLineItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serviceName: "Dedicated Business Phone Number",
        unit: "PER_UNIT",
        quantity: 1,
        amountMicroUsd: 2_000_000
      })
    });
  });

  it("does not add the fee again to another invoice in the same agent/month", async () => {
    const tx = invoiceTx({
      existingMonthlyLine: {
        id: "line-july",
        invoiceId: "invoice-paid-earlier"
      }
    });

    const result = await addPhoneNumberFeeToPendingInvoiceTx(
      tx as never,
      INPUT,
      FEE
    );

    expect(result).toEqual({
      added: false,
      invoiceId: "invoice-paid-earlier",
      amountMicroUsd: 0
    });
    expect(tx.businessUsageInvoice.findFirst).not.toHaveBeenCalled();
    expect(tx.businessUsageInvoiceLineItem.create).not.toHaveBeenCalled();
    expect(tx.businessUsageInvoice.update).not.toHaveBeenCalled();
  });

  it("recovers an invoice-level race without incrementing twice", async () => {
    const tx = invoiceTx({
      pendingInvoiceId: "invoice-current",
      existingInvoiceLineId: "line-existing"
    });

    const result = await addPhoneNumberFeeToPendingInvoiceTx(
      tx as never,
      INPUT,
      FEE
    );

    expect(result).toEqual({
      added: false,
      invoiceId: "invoice-current",
      amountMicroUsd: 0
    });
    expect(tx.businessUsageInvoiceLineItem.create).not.toHaveBeenCalled();
    expect(tx.businessUsageInvoice.update).not.toHaveBeenCalled();
  });

  it("rejects an invoice assignment for a different agent", async () => {
    const tx = invoiceTx();
    tx.platformPhoneNumber.findUnique.mockResolvedValue({
      businessId: INPUT.businessId,
      installedAgentId: "agent-2",
      status: "ASSIGNED"
    });

    await expect(
      addPhoneNumberFeeToPendingInvoiceTx(tx as never, INPUT, FEE)
    ).rejects.toThrow("PHONE_INVOICE_ASSIGNMENT_MISMATCH");
    expect(tx.businessUsageInvoiceLineItem.create).not.toHaveBeenCalled();
  });
});
