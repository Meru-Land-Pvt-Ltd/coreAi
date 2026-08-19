-- What the buyer actually saw and paid, alongside what we settled in.
ALTER TABLE "Payment" ADD COLUMN "presentmentAmountCents" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "presentmentCurrency" TEXT;
