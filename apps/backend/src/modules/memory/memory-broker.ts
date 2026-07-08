/**
 * Brain Memory broker — save, load, and build context for workflow nodes.
 * Use memoryBroker from routes or workflow-runner instead of calling Prisma directly.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { mapNodeRunToRecord, mapStatusToPrisma } from "./mappers";
import { resolveBackLinkedMemories } from "./backlink-resolver";
import { buildContextBundle, mergeWorkflowMemory } from "./context-builder";
import type {
  BuildContextBundleInput,
  ContextBundle,
  NodeMemoryPayload,
  NodeMemoryRecord,
  MergedWorkflowMemory,
} from "./types";

export class MemoryBroker {
  /** Save one node execution. workflowRunId must already exist in WorkflowRun. */
  async saveNodeMemory(payload: NodeMemoryPayload): Promise<{ nodeRunId: string }> {
    const nodeRun = await prisma.nodeRun.create({
      data: {
        workflowRunId: payload.workflowRunId,
        nodeId: payload.nodeId,
        nodeType: payload.nodeType,
        nodeLabel: payload.nodeLabel,
        status: mapStatusToPrisma(payload.status),
        executionOrder: payload.executionOrder ?? 0,
        threadId: payload.threadId,
        inputJson: payload.input as Prisma.InputJsonValue | undefined,
        outputJson: payload.output as Prisma.InputJsonValue | undefined,
        summary: payload.summary,
        variablesJson: payload.variables as Prisma.InputJsonValue | undefined,
        filesJson: payload.files as Prisma.InputJsonValue | undefined,
        provider: payload.provider,
        model: payload.model,
        costCents: payload.costCents,
        tokenInput: payload.tokenInput,
        tokenOutput: payload.tokenOutput,
        startedAt: payload.startedAt ? new Date(payload.startedAt) : undefined,
        finishedAt: payload.finishedAt ? new Date(payload.finishedAt) : undefined,
        durationMs: payload.durationMs,
        errorMessage: payload.errorMessage,
      },
    });
    await prisma.workflowRun.update({
      where: { id: payload.workflowRunId },
      data: { currentNodeId: payload.nodeId },
    });
    await this.refreshWorkflowRunTotals(payload.workflowRunId);
    return { nodeRunId: nodeRun.id };
  }

  async loadNodeMemory(nodeRunId: string): Promise<NodeMemoryRecord | null> {
    const row = await prisma.nodeRun.findUnique({ where: { id: nodeRunId } });
    return row ? mapNodeRunToRecord(row) : null;
  }

  /** Direct parent in execution order (forward chain, not a back-link). */
  async getPreviousNodeMemory(
    workflowRunId: string,
    nodeId: string
  ): Promise<NodeMemoryRecord | null> {
    const current = await prisma.nodeRun.findFirst({
      where: { workflowRunId, nodeId },
      orderBy: { executionOrder: "desc" },
    });
    if (!current) return null;
    const previous = await prisma.nodeRun.findFirst({
      where: {
        workflowRunId,
        executionOrder: { lt: current.executionOrder },
      },
      orderBy: { executionOrder: "desc" },
    });
    return previous ? mapNodeRunToRecord(previous) : null;
  }

  /** Reads stored back-links only — never re-runs workflow nodes. */
  async getBackLinkedMemory(
    workflowRunId: string,
    targetNodeId: string,
    selectedBacklinkNodeIds?: string[]
  ): Promise<NodeMemoryRecord[]> {
    const result = await resolveBackLinkedMemories({
      workflowRunId,
      targetNodeId,
      selectedBacklinkNodeIds,
    });
    return result.memories;
  }

  mergeWorkflowMemory(params: {
    originalPrompt?: string;
    previousMemory: NodeMemoryRecord | null;
    backLinkedMemories: NodeMemoryRecord[];
    workflowMetadata?: Record<string, unknown>;
  }): MergedWorkflowMemory {
    return mergeWorkflowMemory(params);
  }

  /** Builds the full context bundle before an AI node runs. */
  async buildContextBundle(input: BuildContextBundleInput): Promise<ContextBundle> {
    const previousMemory = await this.getPreviousNodeMemory(input.workflowRunId, input.nodeId);
    const { memories: backLinkedMemories, links } = await resolveBackLinkedMemories({
      workflowRunId: input.workflowRunId,
      targetNodeId: input.nodeId,
      selectedBacklinkNodeIds: input.backlinkNodeIds,
    });
    const allNodeRuns = await prisma.nodeRun.findMany({
      where: { workflowRunId: input.workflowRunId },
      orderBy: { executionOrder: "asc" },
    });
    return buildContextBundle({
      input,
      previousMemory,
      backLinkedMemories,
      contextLinks: links,
      nodeMemories: allNodeRuns.map(mapNodeRunToRecord),
    });
  }

  private async refreshWorkflowRunTotals(workflowRunId: string): Promise<void> {
    const rows = await prisma.nodeRun.findMany({
      where: { workflowRunId },
      select: {
        tokenInput: true,
        tokenOutput: true,
        costCents: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    const totalTokenInput = rows.reduce((sum, r) => sum + (r.tokenInput ?? 0), 0);
    const totalTokenOutput = rows.reduce((sum, r) => sum + (r.tokenOutput ?? 0), 0);
    const totalCostCents = rows.reduce((sum, r) => sum + (r.costCents ?? 0), 0);
    const startedAt = rows.map((r) => r.startedAt).filter(Boolean).sort()[0];
    const finishedAt = rows.map((r) => r.finishedAt).filter(Boolean).sort().at(-1);
    const durationMs =
      startedAt && finishedAt
        ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
        : undefined;
    await prisma.workflowRun.update({
      where: { id: workflowRunId },
      data: {
        totalTokenInput,
        totalTokenOutput,
        totalCostCents,
        durationMs,
      },
    });
  }
}

export const memoryBroker = new MemoryBroker();
