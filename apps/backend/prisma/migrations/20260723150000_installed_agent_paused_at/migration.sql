-- Buyer pause timestamp: executions started before this instant may settle
-- their actual provider usage; new executions are blocked while set.
ALTER TABLE "InstalledAgent" ADD COLUMN     "pausedAt" TIMESTAMP(3);
