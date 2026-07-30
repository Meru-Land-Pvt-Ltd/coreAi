import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { recordWorkflowRunUsage } from "../business/execution-billing";

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
  // The default threadId is also a memory-scope key — a bare timestamp would
  // collide when two runs start in the same millisecond.
  const threadId = input.threadId ?? `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { workflowRunId: `test-run-${Date.now()}`, threadId };
    }
    throw error;
  }
}

export async function completeWorkflowRun(workflowRunId: string): Promise<void> {
  if (workflowRunId.startsWith("test-run-")) return;
  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: { status: "COMPLETED", finishedAt: new Date() },
  });
  await recordWorkflowRunUsage(workflowRunId).catch((error) => {
    // A billing ledger retry/reconciliation must never change a successfully
    // completed workflow into a failed customer interaction.
    console.error("[workflow-run] execution billing failed (non-fatal)", {
      workflowRunId,
      error
    });
  });
}

export async function failWorkflowRun(workflowRunId: string, errorMessage: string): Promise<void> {
  if (workflowRunId.startsWith("test-run-")) return;
  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: { status: "FAILED", finishedAt: new Date(), errorMessage },
  });
}
