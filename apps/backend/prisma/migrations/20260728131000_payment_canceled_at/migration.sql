-- A succeeded subscription remains a paid invoice when the buyer cancels it.
-- This timestamp ends future access/renewals without rewriting payment history.
ALTER TABLE "Payment"
ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
