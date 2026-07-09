/**
 * Maps Memory Engine output → Provider Engine input, and provider response → NodeMemoryPayload.
 * This is the integration contract between Gaurav (memory) and Akhil (provider).
 */
import type { AIExecuteRequest, AIExecuteResponse } from "../ai-provider-engine/types";
import type { ContextBundle, NodeMemoryPayload } from "./types";

/** Minimal node shape from workflow-runner — avoids importing the whole runner module. */
export type AiBrainNodeConfig = {
  id: string;
  nodeType: string;
  nodeLabel?: string;
  data?: {
    type?: unknown;
    label?: unknown;
    title?: unknown;
    prompt?: unknown;
    instructions?: unknown;
    provider?: unknown;
    model?: unknown;
    temperature?: unknown;
    maxTokens?: unknown;
    outputFormat?: unknown;
    backlinkNodeIds?: unknown;
  };
};

const PROVIDER_ALIASES: Record<string, string> = {
  openai: "openai",
  gpt: "openai",
  chatgpt: "openai",
  claude: "claude",
  anthropic: "claude",
  gemini: "gemini",
  google: "gemini",
};

export function normalizeProviderId(raw: unknown): string {
  const key = String(raw ?? "openai").trim().toLowerCase();
  return PROVIDER_ALIASES[key] ?? key;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** ContextBundle + node config → request for getProviderEngine().executeWithProvider() */
export function contextBundleToExecuteRequest(
  bundle: ContextBundle,
  node: AiBrainNodeConfig
): AIExecuteRequest {
  const data = node.data ?? {};
  const userPrompt =
    asString(data.prompt) ||
    asString(data.instructions) ||
    asString(bundle.merged.originalPrompt) ||
    "Execute this workflow step using the provided context.";

  return {
    systemPrompt: bundle.compressedPrompt,
    messages: [{ role: "user", content: userPrompt }],
    model: asString(data.model) || undefined,
    temperature: asNumber(data.temperature),
    maxTokens: asNumber(data.maxTokens),
    outputFormat: data.outputFormat === "json" ? "json" : "text",
    workflowContext: {
      workflowRunId: bundle.workflowRunId,
      nodeId: bundle.nodeId,
      threadId: bundle.threadId,
      merged: bundle.merged,
      contextLinkCount: bundle.contextLinks.length,
    },
    previousNodeMemory: bundle.previousMemory
      ? {
          nodeId: bundle.previousMemory.nodeId,
          nodeType: bundle.previousMemory.nodeType,
          summary: bundle.previousMemory.summary,
          output: bundle.previousMemory.output,
        }
      : undefined,
    metadata: {
      workflowRunId: bundle.workflowRunId,
      nodeId: bundle.nodeId,
      threadId: bundle.threadId,
      backLinkedNodeIds: bundle.backLinkedMemories.map((m) => m.nodeId),
    },
  };
}

/** Provider response → payload for memoryBroker.saveNodeMemory() */
export function providerResponseToNodeMemory(params: {
  bundle: ContextBundle;
  node: AiBrainNodeConfig;
  response: AIExecuteResponse;
  executionOrder: number;
  startedAt: string;
  finishedAt: string;
}): NodeMemoryPayload {
  const { bundle, node, response, executionOrder, startedAt, finishedAt } = params;
  const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  const costCents = response.cost?.totalCostUsd
    ? Math.round(response.cost.totalCostUsd * 100)
    : undefined;

  return {
    workflowRunId: bundle.workflowRunId,
    nodeId: node.id,
    nodeType: node.nodeType,
    nodeLabel: node.nodeLabel,
    status: response.status === "success" ? "success" : "error",
    executionOrder,
    threadId: bundle.threadId,
    input: {
      prompt: node.data?.prompt ?? node.data?.instructions,
      provider: normalizeProviderId(node.data?.provider),
      model: node.data?.model,
      compressedPrompt: bundle.compressedPrompt,
    },
    output: {
      text: response.text,
      structuredOutput: response.structuredOutput,
      status: response.status,
      error: response.error,
    },
    summary: response.text?.slice(0, 240) ?? response.error ?? undefined,
    provider: response.providerId,
    model: response.modelName,
    tokenInput: response.usage.promptTokens,
    tokenOutput: response.usage.completionTokens,
    costCents,
    startedAt,
    finishedAt,
    durationMs,
    errorMessage: response.status === "error" ? response.error ?? "Provider execution failed" : undefined,
  };
}