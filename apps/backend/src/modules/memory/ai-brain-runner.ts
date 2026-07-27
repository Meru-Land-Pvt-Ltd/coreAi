import { resolveLlmSelection } from "@coreai/shared";
import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import {
  MISSING_LLM_CREDENTIALS_MESSAGE,
  resolveConfiguredLlmProvider,
} from "../ai-provider-engine/llm-credentials";
import {
  recordLlmProviderFailure,
  recordLlmProviderSuccess
} from "../ai-provider-engine/llm-health";
import { errorResponse } from "../ai-provider-engine/providers/base-adapter";
import { memoryBroker } from "./memory-broker";
import {
  contextBundleToExecuteRequest,
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
  missingCredentials?: boolean;
  fallbackFromProviderId?: string;
};

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

  // The node picks a provider first, then one of that provider's models. A
  // model left over from a different provider is dropped here so it is never
  // sent to an API that would reject it.
  const selection = resolveLlmSelection(node.data?.provider, node.data?.model);
  const requestedProvider = selection.providerId;
  request.model = selection.modelId ?? undefined;

  const resolved = resolveConfiguredLlmProvider(requestedProvider);
  const startedAt = new Date().toISOString();

  if (!resolved) {
    const response = errorResponse(
      requestedProvider,
      asString(node.data?.model, "unknown"),
      MISSING_LLM_CREDENTIALS_MESSAGE
    );

    const { nodeRunId } = await memoryBroker.saveNodeMemory(
      providerResponseToNodeMemory({
        bundle,
        node,
        response,
        executionOrder,
        startedAt,
        finishedAt: new Date().toISOString(),
      })
    );

    return {
      text: null,
      providerId: requestedProvider,
      modelName: response.modelName,
      status: "error",
      error: MISSING_LLM_CREDENTIALS_MESSAGE,
      nodeRunId,
      missingCredentials: true,
    };
  }

  if (resolved.fallbackFrom) {
    request.model = undefined;
  }

  const response = await getProviderEngine().executeWithProvider(resolved.providerId, request);
  const finishedAt = new Date().toISOString();

  if (response.status === "error") {
    recordLlmProviderFailure(resolved.providerId, response.error);
  } else {
    recordLlmProviderSuccess(resolved.providerId);
  }

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
    ...(resolved.fallbackFrom ? { fallbackFromProviderId: resolved.fallbackFrom } : {}),
  };
}