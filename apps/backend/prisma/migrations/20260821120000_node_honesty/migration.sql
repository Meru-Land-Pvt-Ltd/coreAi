-- Did each step return what its node type declares it produces?
ALTER TABLE "NodeRun" ADD COLUMN "honesty" TEXT;
ALTER TABLE "NodeRun" ADD COLUMN "missingOutputs" TEXT[];
CREATE INDEX "NodeRun_honesty_createdAt_idx" ON "NodeRun"("honesty", "createdAt");
