/**
 * Loads back-linked node memory for a target node.
 * Only reads existing NodeRun rows — we never re-execute earlier nodes.
 */
import { prisma } from "../../lib/prisma";
import { mapContextLinkToRecord, mapNodeRunToRecord } from "./mappers";
import { assertNoCircularBacklinks, assertNoSelfLink, dedupeMemories } from "./loop-guard";
import type { ContextLinkRecord, NodeMemoryRecord } from "./types";

async function loadDirectBacklinkMemories(params: {
  workflowRunId: string;
  selectedBacklinkNodeIds: string[];
}): Promise<NodeMemoryRecord[]> {
  const directRuns = await prisma.nodeRun.findMany({
    where: {
      workflowRunId: params.workflowRunId,
      nodeId: { in: params.selectedBacklinkNodeIds },
    },
    orderBy: { executionOrder: "desc" },
  });
  const latestByNodeId = new Map<string, (typeof directRuns)[number]>();
  for (const run of directRuns) {
    if (!latestByNodeId.has(run.nodeId)) {
      latestByNodeId.set(run.nodeId, run);
    }
  }
  return [...latestByNodeId.values()].map(mapNodeRunToRecord);
}

export async function resolveBackLinkedMemories(params: {
  workflowRunId: string;
  targetNodeId: string;
  selectedBacklinkNodeIds?: string[];
}): Promise<{ memories: NodeMemoryRecord[]; links: ContextLinkRecord[] }> {
  const targetRuns = await prisma.nodeRun.findMany({
    where: { workflowRunId: params.workflowRunId, nodeId: params.targetNodeId },
    orderBy: { executionOrder: "desc" },
    take: 1,
  });
  const targetRun = targetRuns[0];
  let memories: NodeMemoryRecord[] = [];
  let linkRecords: ContextLinkRecord[] = [];

  if (targetRun) {
    const links = await prisma.contextLink.findMany({
      where: {
        workflowRunId: params.workflowRunId,
        toNodeRunId: targetRun.id,
        linkStatus: "ACTIVE",
      },
      include: { fromNodeRun: true },
    });
    for (const link of links) {
      assertNoSelfLink(link.fromNodeRunId, link.toNodeRunId);
    }
    assertNoCircularBacklinks({
      startNodeRunId: targetRun.id,
      links: links.map((l) => ({
        fromNodeRunId: l.fromNodeRunId,
        toNodeRunId: l.toNodeRunId,
      })),
    });
    memories = links.map((link) => mapNodeRunToRecord(link.fromNodeRun));
    if (params.selectedBacklinkNodeIds?.length) {
      const allowed = new Set(params.selectedBacklinkNodeIds);
      memories = memories.filter((memory) => allowed.has(memory.nodeId));
    }
    linkRecords = links.map(mapContextLinkToRecord);
  }

  if (params.selectedBacklinkNodeIds?.length) {
    const directMemories = await loadDirectBacklinkMemories({
      workflowRunId: params.workflowRunId,
      selectedBacklinkNodeIds: params.selectedBacklinkNodeIds,
    });
    memories = dedupeMemories([...memories, ...directMemories]);
  }

  return {
    memories: dedupeMemories(memories),
    links: linkRecords,
  };
}
