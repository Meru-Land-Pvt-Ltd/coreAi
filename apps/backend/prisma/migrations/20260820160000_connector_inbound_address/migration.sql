-- A webhook address can now belong to a Connector Standard node.
ALTER TABLE "AgentWebhookEndpoint" ADD COLUMN "connectorId" TEXT;
