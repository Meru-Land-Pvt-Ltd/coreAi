/**
 * Builds the structured context bundle sent to AI providers.
 * Combines user prompt, previous outputs, summaries, variables, files, and metadata.
 */
import type {
  BuildContextBundleInput,
  ContextBundle,
  MergedWorkflowMemory,
  NodeMemoryRecord,
} from "./types";
import { compressMergedMemory, buildCompressedPrompt, compressNodeMemories } from "./memory-compression";

export function mergeWorkflowMemory(params: {
  originalPrompt?: string;
  previousMemory: NodeMemoryRecord | null;
  backLinkedMemories: NodeMemoryRecord[];
  workflowMetadata?: Record<string, unknown>;
}): MergedWorkflowMemory {
  const all = compressNodeMemories([
    ...(params.previousMemory ? [params.previousMemory] : []),
    ...params.backLinkedMemories,
  ]);
  // Memory Node outputs hold the full raw memory string. That string is
  // delivered to AI nodes exactly once, in resolved form, by the smart-memory
  // layer — re-embedding it here would double the tokens under the threshold
  // and smuggle the entire raw corpus past vector retrieval above it.
  const forOutputs = all.filter((m) => m.nodeType !== "ai.memory");
  return {
    originalPrompt: params.originalPrompt,
    summaries: all.map((m) => m.summary).filter((s): s is string => Boolean(s)),
    variables: Object.assign({}, ...forOutputs.map((m) => m.variables ?? {})),
    outputs: forOutputs.map((m) => ({ nodeId: m.nodeId, nodeType: m.nodeType, output: m.output })),
    files: forOutputs.flatMap((m) => m.files ?? []),
    metadata: params.workflowMetadata,
    totalTokens: all.reduce((sum, m) => sum + (m.tokenInput ?? 0) + (m.tokenOutput ?? 0), 0),
    totalCostCents: all.reduce((sum, m) => sum + (m.costCents ?? 0), 0),
  };
}

export function buildContextBundle(params: {
  input: BuildContextBundleInput;
  previousMemory: NodeMemoryRecord | null;
  backLinkedMemories: NodeMemoryRecord[];
  contextLinks: ContextBundle["contextLinks"];
  nodeMemories: NodeMemoryRecord[];
}): ContextBundle {
  const merged = compressMergedMemory(
    mergeWorkflowMemory({
      originalPrompt: params.input.originalPrompt,
      previousMemory: params.previousMemory,
      backLinkedMemories: params.backLinkedMemories,
      workflowMetadata: params.input.workflowMetadata,
    })
  );
  return {
    workflowRunId: params.input.workflowRunId,
    nodeId: params.input.nodeId,
    threadId: params.input.threadId,
    nodeMemories: params.nodeMemories,
    backLinkedMemories: params.backLinkedMemories,
    previousMemory: params.previousMemory,
    contextLinks: params.contextLinks,
    merged,
    compressedPrompt: buildCompressedPrompt(merged),
  };
}
