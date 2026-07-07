import type { AIExecuteRequest, AIExecuteResponse, AITokenUsage, CostEstimate, ValidationResult } from "../types";

export type PricingTable = Record<string, { input: number; output: number }>;

export function checkEnvKey(envVar: string): ValidationResult {
  return process.env[envVar]?.trim()
    ? { valid: true, message: `${envVar} is present.` }
    : { valid: false, message: `${envVar} is not set.` };
}

// ~4 characters per token; completionTokens uses maxTokens as the upper-bound estimate
export function estimateUsage(request: AIExecuteRequest): AITokenUsage {
  const promptTokens = Math.ceil(
    ((request.systemPrompt ?? "").length +
      request.messages.reduce((sum, m) => sum + m.content.length, 0)) / 4
  );
  const completionTokens = request.maxTokens ?? 256;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

export function buildCostEstimate(request: AIExecuteRequest, pricing: PricingTable, defaultModel: string): CostEstimate {
  const model = request.model ?? defaultModel;
  const { input, output } = pricing[model] ?? pricing[defaultModel]!;
  const { promptTokens, completionTokens } = estimateUsage(request);
  return {
    inputCostUsd: (promptTokens / 1000) * input,
    outputCostUsd: (completionTokens / 1000) * output,
    totalCostUsd: ((promptTokens / 1000) * input) + ((completionTokens / 1000) * output),
    model,
  };
}

export function errorResponse(providerId: string, error: string, durationMs = 0): AIExecuteResponse {
  return {
    status: "error",
    text: null,
    structuredOutput: null,
    attachments: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    cost: null,
    conversationId: null,
    providerMetadata: {},
    providerId,
    durationMs,
    error,
  };
}
