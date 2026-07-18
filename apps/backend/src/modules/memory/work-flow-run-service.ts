/**
 * WorkflowRun lifecycle helpers — used by workflow-runner when a test/live run starts.
 * Keeps Prisma create/update for runs in one place instead of scattering it in the runner.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export type CreateWorkflowRunInput = {
  workflowId: string;
  triggeredByUserId?: string;
  businessId?: string;
  installedAgentId?: string;
  mode: "test" | "live";
  /** Explicit execution mode; when set it wins over the legacy `mode` mapping. */
  executionMode?: "ARCHITECT_DRY_RUN" | "BUSINESS_TEST" | "LIVE";
  threadId?: string;
  inputJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
};

export type WorkflowRunHandle = {
  workflowRunId: string;
  threadId?: string;
};

export async function createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRunHandle> {
  const threadId = input.threadId ?? `run-${Date.now()}`;
  const run = await prisma.workflowRun.create({
    data: {
      workflowId: input.workflowId,
      triggeredByUserId: input.triggeredByUserId,
      businessId: input.businessId,
      installedAgentId: input.installedAgentId,
      mode: input.executionMode ?? (input.mode === "live" ? "LIVE" : "ARCHITECT_DRY_RUN"),
      status: "RUNNING",
      threadId,
      inputJson: input.inputJson as Prisma.InputJsonValue | undefined,
      metadataJson: input.metadataJson as Prisma.InputJsonValue | undefined,
    },
  });
  return { workflowRunId: run.id, threadId: run.threadId ?? undefined };
}

export async function completeWorkflowRun(workflowRunId: string): Promise<void> {
  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: { status: "COMPLETED", finishedAt: new Date() },
  });
}

export async function failWorkflowRun(workflowRunId: string, errorMessage: string): Promise<void> {
  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: { status: "FAILED", finishedAt: new Date(), errorMessage },
  });
}