import { describe, expect, it, vi } from "vitest";
import { addPhoneNumberFeeToPendingInvoiceTx } from "./phone-number-invoice";

const INPUT = {
  platformPhoneNumberId: "number-1",
  businessId: "business-1",
  installedAgentId: "agent-1",
  chargedAt: new Date("2026-07-28T10:30:00.000Z")
};

const FEE = {
  amountCents: 200,
  label: "Dedicated phone number",
  serviceCode: "phone_number",
  pricingVersion: "phone-service@2026-07-01T00:00:00.000Z"
};

function invoiceTx(options?: {
  feeBilledAt?: Date | null;
  pendingInvoiceId?: string | null;
  existingPhoneLineId?: string | null;
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
        status: "ASSIGNED",
        feeBilledAt: options?.feeBilledAt ?? null
      }),
      update: vi.fn().mockResolvedValue({ id: INPUT.platformPhoneNumberId })
    },
    installedAgent: {
      findFirst: vi.fn().mockResolvedValue({ id: INPUT.installedAgentId })
    },
    businessUsageInvoice: {
      findFirst: businessUsageInvoiceFindFirst,
      create: vi.fn().mockResolvedValue({ id: "invoice-new" }),
      update: vi.fn().mockResolvedValue({ id: pendingInvoiceId ?? "invoice-new" })
    },
    businessUsageInvoiceLineItem: {
      findUnique: vi.fn().mockResolvedValue(
        options?.existingPhoneLineId
          ? { id: options.existingPhoneLineId }
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
        periodStart: INPUT.chargedAt,
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
    expect(tx.platformPhoneNumber.update).toHaveBeenCalledWith({
      where: { id: INPUT.platformPhoneNumberId },
      data: { feeBilledAt: INPUT.chargedAt }
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

  it("does not add or increment the fee again after it has been billed", async () => {
    const tx = invoiceTx({
      feeBilledAt: new Date("2026-07-28T10:31:00.000Z")
    });

    const result = await addPhoneNumberFeeToPendingInvoiceTx(
      tx as never,
      INPUT,
      FEE
    );

    expect(result).toEqual({
      added: false,
      invoiceId: null,
      amountMicroUsd: 0
    });
    expect(tx.businessUsageInvoice.findFirst).not.toHaveBeenCalled();
    expect(tx.businessUsageInvoiceLineItem.create).not.toHaveBeenCalled();
    expect(tx.businessUsageInvoice.update).not.toHaveBeenCalled();
    expect(tx.platformPhoneNumber.update).not.toHaveBeenCalled();
  });

  it("recovers an existing phone line without incrementing the invoice twice", async () => {
    const tx = invoiceTx({
      pendingInvoiceId: "invoice-current",
      existingPhoneLineId: "line-existing"
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
    expect(tx.platformPhoneNumber.update).toHaveBeenCalledOnce();
  });
});
