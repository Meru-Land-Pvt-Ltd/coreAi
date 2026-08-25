-- The declared purpose: what the architect TOLD the AI Builder they are
-- building. Deliberately its own column, not the description — description is
-- a marketing tagline many old agents already carry, and treating one as a
-- declared goal made the Check test a yes/no agent against subscriber charts.
ALTER TABLE "WorkflowDefinition" ADD COLUMN "purpose" TEXT;
