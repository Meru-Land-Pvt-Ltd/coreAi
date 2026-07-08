import type { AIExecuteRequest, AIContinueRequest, AIExecuteResponse, AITokenUsage, CostEstimate, ValidationResult } from "../types";

export type PricingTable = Record<string, { input: number; output: number }>; // rates per 1M tokens

export function checkEnvKey(envVar: string): ValidationResult {
  return process.env[envVar]?.trim()
    ? { valid: true, message: `${envVar} is present.` }
    : { valid: false, message: `${envVar} is not set.` };
}

/** Rough pre-flight estimate: ~4 chars per token; completionTokens capped by maxTokens */
export function estimateUsage(request: AIExecuteRequest): AITokenUsage {
  const promptTokens = Math.ceil(
    ((request.systemPrompt ?? "").length +
      [...(request.conversationHistory ?? []), ...request.messages].reduce(
        (sum, m) => sum + m.content.length,
        0
      )) / 4
  );
  const completionTokens = request.maxTokens ?? 256;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

/** Compute cost from a per-1M token pricing table */
export function buildCostEstimate(
  request: AIExecuteRequest,
  pricing: PricingTable,
  defaultModel: string,
  actualUsage?: AITokenUsage
): CostEstimate {
  const model = request.model ?? defaultModel;
  const rates = pricing[model] ?? pricing[defaultModel] ?? { input: 0, output: 0 };
  const { input, output } = rates;
  const usage = actualUsage ?? estimateUsage(request);
  return {
    inputCostUsd: (usage.promptTokens / 1_000_000) * input,
    outputCostUsd: (usage.completionTokens / 1_000_000) * output,
    totalCostUsd:
      (usage.promptTokens / 1_000_000) * input +
      (usage.completionTokens / 1_000_000) * output,
    model,
  };
}

/** Attempt to parse raw LLM text as JSON; returns null when text is not valid JSON */
export function parseJsonFromText(text: string): unknown | null {
  // Strip markdown code fences if the LLM wrapped the JSON
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

/** Returns true for errors that are worth retrying once (rate limits, transient network issues) */
export function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("overloaded")) return true;
    if (msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("network")) return true;
  }
  // Check HTTP status codes surfaced as { status } properties
  const e = err as Record<string, unknown>;
  if (typeof e?.status === "number" && [429, 529, 503].includes(e.status as number)) return true;
  return false;
}

/** Wraps an async function with a single automatic retry on transient failures */
export async function retryOnTransient<T>(
  fn: () => Promise<T>,
  delayMs = 1000
): Promise<T> {
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
  durationMs = 0
): AIExecuteResponse {
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
    modelName,
    durationMs,
    error,
  };
}

/** Standard conversation history enriching helper for multi-turn conversations */
export function enrichContinueRequest(request: AIContinueRequest): AIExecuteRequest {
  return {
    ...request,
    conversationHistory: [
      ...(request.conversationHistory ?? []),
      ...request.messages.slice(0, -1),
    ],
    messages: request.messages.slice(-1),
  };
}

/** Extracts clean base64 data from a potentially prefixed data URI string */
export function getCleanBase64(data: string): string {
  if (data.includes(";base64,")) {
    return data.split(";base64,").pop() ?? "";
  }
  return data;
}

/** Formats a base64 string or URL as a valid data URI prefix if it is not already */
export function ensureDataUri(data: string, mimeType: string): string {
  if (data.startsWith("data:") || data.startsWith("http")) {
    return data;
  }
  return `data:${mimeType};base64,${data}`;
}
