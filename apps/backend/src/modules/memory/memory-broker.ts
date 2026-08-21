/**
 * Brain Memory broker — save, load, and build context for workflow nodes.
 * Use memoryBroker from routes or workflow-runner instead of calling Prisma directly.
 */
import { Prisma } from "@prisma/client";
import { checkNodeOutput, getNodeDefinition } from "@coreai/shared";
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
    if (payload.workflowRunId?.startsWith("test-run-")) {
      return { nodeRunId: `test-node-run-${Date.now()}` };
    }

    /*
     * DID THIS STEP DO WHAT IT SAID IT WOULD?
     *
     * Every node execution on the platform funnels through here, which makes
     * this the one place the question can be asked about all of them. The
     * registry already says what most node types produce — the calendar step
     * that invented three appointment times declared five things and returned
     * none of them — and until now nothing compared the two.
     *
     * Recorded, not enforced. A step that fails this still finishes and the run
     * carries on exactly as before. Switching detection on and enforcement on
     * in the same change would turn every hidden fault into a live outage on
     * the same afternoon, and we do not yet know how many there are. That is
     * the next decision, and it belongs to a person who has seen the list.
     */
    const honesty = checkNodeOutput({
      declares: getNodeDefinition(payload.nodeType)?.producedVariables,
      producesNothing: getNodeDefinition(payload.nodeType)?.producesNothing,
      output: payload.output as Record<string, unknown> | undefined,
      variables:
        (payload.checkVariables as Record<string, unknown> | undefined) ??
        (payload.variables as Record<string, unknown> | undefined),
      status: payload.status
    });

    if (honesty.verdict === "unproven") {
      console.warn("[honesty] a step reported success without returning what it declares", {
        workflowRunId: payload.workflowRunId,
        nodeId: payload.nodeId,
        nodeType: payload.nodeType,
        missing: honesty.missing
      });
    }

    try {
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
          honesty: honesty.verdict,
          missingOutputs: honesty.missing,
        },
      });
      await prisma.workflowRun.update({
        where: { id: payload.workflowRunId },
        data: { currentNodeId: payload.nodeId },
      });
      this.refreshWorkflowRunTotals(payload.workflowRunId).catch(() => {});
      return { nodeRunId: nodeRun.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        return { nodeRunId: `test-node-run-${Date.now()}` };
      }
      throw error;
    }
  }

  async loadNodeMemory(nodeRunId: string): Promise<NodeMemoryRecord | null> {
    const row = await prisma.nodeRun.findUnique({ where: { id: nodeRunId } });
    return row ? mapNodeRunToRecord(row) : null;
  }

  /** Direct parent in execution order (forward chain, not a back-link). */
  async getPreviousNodeMemory(
    workflowRunId: string,
    nodeId: string,
    executionOrder?: number
  ): Promise<NodeMemoryRecord | null> {
    if (workflowRunId.startsWith("test-run-")) return null;
    let beforeOrder = executionOrder;
    if (beforeOrder === undefined) {
      const current = await prisma.nodeRun.findFirst({
        where: { workflowRunId, nodeId },
        orderBy: { executionOrder: "desc" },
      });
      if (!current) return null;
      beforeOrder = current.executionOrder;
    }
    const previous = await prisma.nodeRun.findFirst({
      where: {
        workflowRunId,
        executionOrder: { lt: beforeOrder },
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
    if (workflowRunId.startsWith("test-run-")) return [];
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
    if (input.workflowRunId.startsWith("test-run-")) {
      return buildContextBundle({
        input,
        previousMemory: null,
        backLinkedMemories: [],
        contextLinks: [],
        nodeMemories: [],
      });
    }
    const previousMemory = await this.getPreviousNodeMemory(
      input.workflowRunId,
      input.nodeId,
      input.executionOrder
    );
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
