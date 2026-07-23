-- PostgreSQL requires newly-added enum values to be committed before a later
-- migration can safely use them in defaults and data updates.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'OVERDUE';
ALTER TYPE "UsageInvoiceStatus" ADD VALUE IF NOT EXISTS 'PENDING';
