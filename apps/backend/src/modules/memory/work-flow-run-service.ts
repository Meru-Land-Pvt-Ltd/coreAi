import { Prisma } from "@prisma/client";
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
  /** External call linkage (e.g. TWILIO + CallSid): one call → one run. */
  callProvider?: string;
  externalCallId?: string;
};

export type WorkflowRunHandle = {
  workflowRunId: string;
  threadId?: string;
};


export class DuplicateWorkflowRunError extends Error {
  constructor(
    public readonly callProvider: string,
    public readonly externalCallId: string
  ) {
    super(`A workflow run already exists for ${callProvider} call ${externalCallId}.`);
    this.name = "DuplicateWorkflowRunError";
  }
}

export async function createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRunHandle> {
  const threadId = input.threadId ?? `run-${Date.now()}`;
  try {
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
        callProvider: input.callProvider,
        externalCallId: input.externalCallId,
      },
    });
    return { workflowRunId: run.id, threadId: run.threadId ?? undefined };
  } catch (error) {
    if (
      input.callProvider &&
      input.externalCallId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DuplicateWorkflowRunError(input.callProvider, input.externalCallId);
    }
    throw error;
  }
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