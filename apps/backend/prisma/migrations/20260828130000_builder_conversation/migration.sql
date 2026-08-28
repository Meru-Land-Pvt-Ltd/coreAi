-- THE BUILDER REMEMBERS THE CONVERSATION.
-- Additive only: one new table, no column dropped, no row touched.
CREATE TABLE "BuilderMessage" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "architectUserId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hand" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuilderMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BuilderMessage_workflowId_architectUserId_at_idx"
    ON "BuilderMessage"("workflowId", "architectUserId", "at");

ALTER TABLE "BuilderMessage" ADD CONSTRAINT "BuilderMessage_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BuilderMessage" ADD CONSTRAINT "BuilderMessage_architectUserId_fkey"
    FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
