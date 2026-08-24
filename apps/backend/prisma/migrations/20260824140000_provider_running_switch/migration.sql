-- The second switch on a provider, matching the node and the model: Available
-- decides new builds, Running decides everything including agents already sold.
ALTER TABLE "AdminLlmProvider" ADD COLUMN "runningEnabled" BOOLEAN NOT NULL DEFAULT true;
