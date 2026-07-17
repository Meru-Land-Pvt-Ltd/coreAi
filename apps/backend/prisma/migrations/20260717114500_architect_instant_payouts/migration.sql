ALTER TABLE "ArchitectPayout"
ADD COLUMN IF NOT EXISTS "deliveryMethod" TEXT NOT NULL DEFAULT 'standard';
