-- Agent usage belongs to an installed agent and must not prevent that agent,
-- its workflow, or its architect account from being permanently deleted.
ALTER TABLE "AgentUsageExecution"
    DROP CONSTRAINT "AgentUsageExecution_installedAgentId_fkey";

ALTER TABLE "AgentUsageExecution"
    ADD CONSTRAINT "AgentUsageExecution_installedAgentId_fkey"
    FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
