CREATE TYPE "UsageInvoiceStatus" AS ENUM ('OPEN', 'OVERDUE', 'PAID', 'VOID');

CREATE TABLE "BusinessUsageInvoice" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "billingMonth" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "UsageInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "subtotalMicroUsd" INTEGER NOT NULL,
    "totalMicroUsd" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "stripePaymentIntentId" TEXT,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessUsageInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessUsageInvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "unit" "UsageServiceUnit" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPriceMicroUsd" INTEGER NOT NULL,
    "amountMicroUsd" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessUsageInvoiceLineItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "VapiCall" ADD COLUMN "usageInvoiceId" TEXT;

CREATE UNIQUE INDEX "BusinessUsageInvoice_invoiceNumber_key" ON "BusinessUsageInvoice"("invoiceNumber");
CREATE UNIQUE INDEX "BusinessUsageInvoice_businessId_billingMonth_key" ON "BusinessUsageInvoice"("businessId", "billingMonth");
CREATE INDEX "BusinessUsageInvoice_businessId_status_idx" ON "BusinessUsageInvoice"("businessId", "status");
CREATE INDEX "BusinessUsageInvoice_status_dueAt_idx" ON "BusinessUsageInvoice"("status", "dueAt");
CREATE UNIQUE INDEX "BusinessUsageInvoiceLineItem_invoiceId_serviceCode_key" ON "BusinessUsageInvoiceLineItem"("invoiceId", "serviceCode");
CREATE INDEX "BusinessUsageInvoiceLineItem_invoiceId_idx" ON "BusinessUsageInvoiceLineItem"("invoiceId");
CREATE INDEX "VapiCall_usageInvoiceId_idx" ON "VapiCall"("usageInvoiceId");

ALTER TABLE "BusinessUsageInvoice" ADD CONSTRAINT "BusinessUsageInvoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessUsageInvoiceLineItem" ADD CONSTRAINT "BusinessUsageInvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "BusinessUsageInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VapiCall" ADD CONSTRAINT "VapiCall_usageInvoiceId_fkey" FOREIGN KEY ("usageInvoiceId") REFERENCES "BusinessUsageInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
