ALTER TABLE "Payment" ADD COLUMN "businessId" TEXT;
CREATE INDEX "Payment_businessId_idx" ON "Payment"("businessId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
