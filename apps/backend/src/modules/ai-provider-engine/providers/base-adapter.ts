import type { AIExecuteRequest, AIContinueRequest, AIExecuteResponse, AITokenUsage, CostEstimate, ValidationResult, ProviderCapability } from "../types";

export type PricingTable = Record<string, { input: number; output: number }>; // rates per 1M tokens

export function checkEnvKey(envVar: string): ValidationResult {
  return process.env[envVar]?.trim()
    ? { valid: true, message: `${envVar} is present.` }
    : { valid: false, message: `${envVar} is not set.` };
}

// rough pre-flight estimate: ~4 chars per token
export function estimateUsage(request: AIExecuteRequest): AITokenUsage {
  const promptTokens = Math.ceil(
    ((request.systemPrompt ?? "").length +
      [...(request.conversationHistory ?? []), ...(request.messages ?? [])].reduce(
        (sum, m) => sum + m.content.length,
        0
      )) / 4
  );
  const completionTokens = request.maxTokens ?? 256;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

export function buildCostEstimate(
  request: AIExecuteRequest,
  pricing: PricingTable,
  defaultModel: string,
  actualUsage?: AITokenUsage
): CostEstimate {
  const model = request.model ?? defaultModel;
  const rates = pricing[model] ?? pricing[defaultModel] ?? { input: 0, output: 0 };
  const usage = actualUsage ?? estimateUsage(request);
  return {
    inputCostUsd: (usage.promptTokens / 1_000_000) * rates.input,
    outputCostUsd: (usage.completionTokens / 1_000_000) * rates.output,
    totalCostUsd:
      (usage.promptTokens / 1_000_000) * rates.input +
      (usage.completionTokens / 1_000_000) * rates.output,
    model,
  };
}

// strips markdown code fences before JSON.parse
export function parseJsonFromText(text: string): unknown | null {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

export function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("overloaded")) return true;
    if (msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("network")) return true;
  }
  const e = err as Record<string, unknown>;
  if (typeof e?.status === "number" && [429, 529, 503].includes(e.status as number)) return true;
  return false;
}

export async function retryOnTransient<T>(fn: () => Promise<T>, delayMs = 1000): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isTransientError(err)) {
      await new Promise((r) => setTimeout(r, delayMs));
      return fn();
    }
    throw err;
  }
}

export function errorResponse(
  providerId: string,
  modelName: string,
  error: string,
  durationMs = 0,
  capability: ProviderCapability = "llm"
): AIExecuteResponse {
  return {
    status: "error",
    capability,
    text: null,
    structuredOutput: null,
    attachments: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    cost: null,
    conversationId: null,
    providerMetadata: {},
    providerId,
    modelName,
    durationMs,
    error,
  };
}

export function enrichContinueRequest(request: AIContinueRequest): AIExecuteRequest {
  return {
    ...request,
    conversationHistory: [
      ...(request.conversationHistory ?? []),
      ...(request.messages ?? []).slice(0, -1),
    ],
    messages: (request.messages ?? []).slice(-1),
  };
}

export function getCleanBase64(data: string): string {
  return data.includes(";base64,") ? (data.split(";base64,").pop() ?? "") : data;
}

export function ensureDataUri(data: string, mimeType: string): string {
  return data.startsWith("data:") || data.startsWith("http")
    ? data
    : `data:${mimeType};base64,${data}`;
}
