-- CreateIndex
CREATE INDEX "AgentListing_status_createdAt_idx" ON "AgentListing"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SmsExecution_vapiCallId_idx" ON "SmsExecution"("vapiCallId");
