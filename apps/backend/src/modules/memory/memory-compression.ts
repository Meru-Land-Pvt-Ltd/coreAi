/**
 * Strips duplicate and empty data before we send context to an AI provider.
 * Keeps token usage lower and prompts easier for the model to follow.
 */
import type { MergedWorkflowMemory, NodeMemoryRecord } from "./types";

const MAX_CONTEXT_ITEMS = 20;

function isEmptyOutput(output: unknown): boolean {
  if (output === null || output === undefined) return true;
  if (typeof output === "string") return output.trim().length === 0;
  if (Array.isArray(output)) return output.length === 0;
  if (typeof output === "object") return Object.keys(output as object).length === 0;
  return false;
}

export function compressNodeMemories(memories: NodeMemoryRecord[]): NodeMemoryRecord[] {
  return memories
    .filter((memory) => !isEmptyOutput(memory.output) || Boolean(memory.summary))
    .map((memory) => ({
      ...memory,
      summary: memory.summary?.trim() || undefined,
    }));
}

export function compressMergedMemory(merged: MergedWorkflowMemory): MergedWorkflowMemory {
  const uniqueSummaries = [...new Set(merged.summaries.map((s) => s.trim()).filter(Boolean))];
  const uniqueOutputs = merged.outputs.filter(
    (item, index, arr) =>
      !isEmptyOutput(item.output) &&
      arr.findIndex(
        (x) => x.nodeId === item.nodeId && JSON.stringify(x.output) === JSON.stringify(item.output)
      ) === index
  );
  const uniqueFiles = [
    ...new Map(merged.files.map((file) => [`${file.url}:${file.name}`, file])).values(),
  ];
  return {
    ...merged,
    summaries: uniqueSummaries.slice(0, MAX_CONTEXT_ITEMS),
    outputs: uniqueOutputs.slice(0, MAX_CONTEXT_ITEMS),
    files: uniqueFiles.slice(0, MAX_CONTEXT_ITEMS),
  };
}

/** Final prompt text the AI Brain node sends to OpenAI, Claude, Manus, etc. */
export function buildCompressedPrompt(merged: MergedWorkflowMemory): string {
  const sections: string[] = [];
  if (merged.originalPrompt) {
    sections.push(`# User Prompt\n${merged.originalPrompt}`);
  }
  if (merged.summaries.length > 0) {
    sections.push(`# Summaries\n${merged.summaries.join("\n")}`);
  }
  if (merged.outputs.length > 0) {
    sections.push(
      `# Previous Outputs\n${merged.outputs
        .map((item) => `## ${item.nodeId} (${item.nodeType})\n${JSON.stringify(item.output)}`)
        .join("\n\n")}`
    );
  }
  if (Object.keys(merged.variables).length > 0) {
    sections.push(`# Variables\n${JSON.stringify(merged.variables, null, 2)}`);
  }
  if (merged.files.length > 0) {
    sections.push(`# Artifacts\n${merged.files.map((f) => `- ${f.name}: ${f.url}`).join("\n")}`);
  }
  if (merged.metadata && Object.keys(merged.metadata).length > 0) {
    sections.push(`# Workflow Metadata\n${JSON.stringify(merged.metadata, null, 2)}`);
  }
  return sections.join("\n\n");
}
