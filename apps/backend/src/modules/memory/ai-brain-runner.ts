/**
 * Runs one AI Brain node: build memory context → call provider → save NodeRun.
 * Called from architect/workflow-runner.ts when nodeKind === "ai" and provider is set.
 */
import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import { memoryBroker } from "./memory-broker";
import {
  contextBundleToExecuteRequest,
  normalizeProviderId,
  providerResponseToNodeMemory,
  type AiBrainNodeConfig,
} from "./memory-to-provider";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export type RunAiBrainNodeInput = {
  workflowRunId: string;
  threadId?: string;
  executionOrder: number;
  node: AiBrainNodeConfig;
};

export type RunAiBrainNodeResult = {
  text: string | null;
  providerId: string;
  modelName: string;
  status: "success" | "error" | "partial";
  error: string | null;
  nodeRunId: string;
};

/** Returns true when node should use Provider Engine instead of legacy SMS reply logic. */
export function isAiBrainProviderNode(node: AiBrainNodeConfig): boolean {
  const type = asString(node.data?.type);
  const hasProvider = Boolean(asString(node.data?.provider));
  return hasProvider || type === "ai.brain" || type === "ai.context_reply";
}

export async function runAiBrainNode(input: RunAiBrainNodeInput): Promise<RunAiBrainNodeResult> {
  const { workflowRunId, threadId, executionOrder, node } = input;
  const bundle = await memoryBroker.buildContextBundle({
    workflowRunId,
    nodeId: node.id,
    threadId,
    executionOrder,
    originalPrompt: asString(node.data?.instructions ?? node.data?.prompt),
    backlinkNodeIds: Array.isArray(node.data?.backlinkNodeIds)
      ? node.data.backlinkNodeIds.map(String)
      : undefined,
  });

  const request = contextBundleToExecuteRequest(bundle, node);
  const startedAt = new Date().toISOString();
  const response = await getProviderEngine().executeWithProvider(
    normalizeProviderId(node.data?.provider),
    request
  );
  const finishedAt = new Date().toISOString();

  const { nodeRunId } = await memoryBroker.saveNodeMemory(
    providerResponseToNodeMemory({
      bundle,
      node,
      response,
      executionOrder,
      startedAt,
      finishedAt,
    })
  );

  return {
    text: response.text,
    providerId: response.providerId,
    modelName: response.modelName,
    status: response.status,
    error: response.error,
    nodeRunId,
  };
}