/** Converts Prisma rows into the Brain Memory API types. */
import type { NodeRun, ContextLink, NodeRunStatus, ContextLinkType } from "@prisma/client";
import type { NodeMemoryRecord, NodeRunStatusValue, ContextLinkRecord } from "./types";

const STATUS_TO_DB: Record<NodeRunStatusValue, NodeRunStatus> = {
  pending: "PENDING",
  running: "RUNNING",
  success: "SUCCESS",
  waiting: "WAITING",
  error: "ERROR",
  skipped: "SKIPPED",
};

const STATUS_FROM_DB: Record<NodeRunStatus, NodeRunStatusValue> = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  WAITING: "waiting",
  ERROR: "error",
  SKIPPED: "skipped",
};

export function mapStatusToPrisma(status: NodeRunStatusValue): NodeRunStatus {
  return STATUS_TO_DB[status];
}

export function mapNodeRunToRecord(row: NodeRun): NodeMemoryRecord {
  return {
    id: row.id,
    workflowRunId: row.workflowRunId,
    nodeId: row.nodeId,
    nodeType: row.nodeType,
    nodeLabel: row.nodeLabel ?? undefined,
    status: STATUS_FROM_DB[row.status],
    executionOrder: row.executionOrder,
    threadId: row.threadId ?? undefined,
    input: row.inputJson ?? undefined,
    output: row.outputJson ?? undefined,
    summary: row.summary ?? undefined,
    variables: (row.variablesJson as Record<string, unknown> | null) ?? undefined,
    files: (row.filesJson as NodeMemoryRecord["files"]) ?? undefined,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    costCents: row.costCents ?? undefined,
    tokenInput: row.tokenInput ?? undefined,
    tokenOutput: row.tokenOutput ?? undefined,
    startedAt: row.startedAt?.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    durationMs: row.durationMs ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapContextLinkToRecord(row: ContextLink): ContextLinkRecord {
  const linkTypeMap: Record<ContextLinkType, ContextLinkRecord["linkType"]> = {
    BACKLINK: "backlink",
    REFERENCE: "reference",
    SUMMARY_SOURCE: "summary_source",
  };
  return {
    id: row.id,
    workflowRunId: row.workflowRunId,
    fromNodeRunId: row.fromNodeRunId,
    toNodeRunId: row.toNodeRunId,
    linkType: linkTypeMap[row.linkType],
    reason: row.reason ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}
