import type { AIExecuteRequest, AIContinueRequest, AIExecuteResponse, AITokenUsage, CostEstimate, ValidationResult, ProviderCapability } from "../types";
import pRetry from "p-retry";
import { errorMessage } from "../../lib/error-utils";

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
  if (!text) return null;
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Attempt relaxed extraction of JSON object if wrapped in trailing text
    const match = stripped.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("overloaded")) return true;
    if (msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("network") || msg.includes("socket hang up")) return true;
    if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504") || msg.includes("internal server error")) return true;
    if (msg.includes("service unavailable") || msg.includes("timeout")) return true;
  }
  const e = err as Record<string, unknown>;
  if (typeof e?.status === "number" && [408, 425, 429, 500, 502, 503, 504, 529].includes(e.status as number)) return true;
  return false;
}

export async function retryOnTransient<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 500;

  return await pRetry(fn, {
    onFailedAttempt: (error) => {
      if (!isTransientError(error)) {
        throw error;
      }
    },
    retries: maxRetries,
    factor: 2,
    minTimeout: baseDelayMs,
    maxTimeout: baseDelayMs * 8,
    randomize: true,
  });
}

export function normalizedProviderError(
  providerId: string,
  rawError: unknown
): { message: string; errorCode: string; retryable: boolean } {
  const errorText = errorMessage(rawError, "AI provider request failed.");
  const lower = errorText.toLowerCase();
  let message = "The AI service is temporarily unavailable. Please try again shortly.";
  let errorCode = "AI_PROVIDER_ERROR";
  let retryable = false;

  if (lower.includes("rate limit") || lower.includes("quota") || lower.includes("429") || lower.includes("over quota")) {
    message = "The AI service is currently rate limited. Please retry after a moment.";
    errorCode = "AI_RATE_LIMITED";
    retryable = true;
  } else if (lower.includes("timeout") || lower.includes("econnreset") || lower.includes("socket hang up") || lower.includes("service unavailable") || lower.includes("502") || lower.includes("503") || lower.includes("504")) {
    message = "The AI service is temporarily unavailable. Please retry in a few seconds.";
    errorCode = "AI_SERVICE_UNAVAILABLE";
    retryable = true;
  } else if (lower.includes("access denied") || lower.includes("invalid api key") || lower.includes("not authorized") || lower.includes("invalid credentials") || lower.includes("permission denied")) {
    message = "The AI service credentials are invalid or not authorized. Please check your provider configuration.";
    errorCode = "AI_CREDENTIALS_ERROR";
    retryable = false;
  } else if (lower.includes("insufficient balance") || lower.includes("insufficient funds") || lower.includes("payment required") || lower.includes("account.*(suspend|deactivat)")) {
    message = "The AI service account is out of quota or billing quota has been exceeded.";
    errorCode = "AI_BILLING_ERROR";
    retryable = false;
  } else if (lower.includes("model not found") || lower.includes("invalid model") || lower.includes("unsupported model")) {
    message = "The selected AI model is not supported. Please select a different model.";
    errorCode = "AI_MODEL_ERROR";
    retryable = false;
  } else if (lower.includes("access denied") && lower.includes("usage limit")) {
    message = "The AI service usage limit has been exceeded. Please try again later.";
    errorCode = "AI_USAGE_LIMIT_EXCEEDED";
    retryable = false;
  } else {
    message = "The AI service returned an unexpected error. Please try again or contact support.";
    errorCode = "AI_PROVIDER_ERROR";
    retryable = isTransientError(rawError);
  }

  return { message, errorCode, retryable };
}

export function errorResponse(
  providerId: string,
  modelName: string,
  error: string,
  durationMs = 0,
  capability: ProviderCapability = "llm",
  errorCode: string | null = null,
  retryable: boolean = false
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
    errorCode,
    retryable,
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
