/**
 * Unified LangChain execution path for provider + model selection.
 * Returns the same AIExecuteResponse shape as existing adapters.
 * Opt-in only — wire from routes or adapters when ready.
 */
import {
  AIMessage as LcAiMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { AIExecuteRequest, AIExecuteResponse } from "../types";
import {
  buildCostEstimate,
  parseJsonFromText,
  type PricingTable,
} from "../providers/base-adapter";
import { LangChainModelFactory } from "./langchain-model-factory";
import { getProviderCatalog } from "./provider-model-catalog";

const PRICING_BY_PROVIDER: Record<string, PricingTable> = {
  openai: {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4-turbo": { input: 10, output: 30 },
    "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  },
  claude: {
    "claude-opus-4-5": { input: 15, output: 75 },
    "claude-sonnet-4-5": { input: 3, output: 15 },
    "claude-haiku-3-5": { input: 0.8, output: 4 },
    "claude-3-opus": { input: 15, output: 75 },
    "claude-3-sonnet": { input: 3, output: 15 },
    "claude-3-haiku": { input: 0.25, output: 1.25 },
  },
  gemini: {
    "gemini-3.1-flash-lite": { input: 0.0375, output: 0.15 },
    "gemini-3.5-flash": { input: 0.075, output: 0.3 },
    "gemini-2.0-flash": { input: 0.075, output: 0.3 },
    "gemini-2.0-flash-lite": { input: 0.0375, output: 0.15 },
    "gemini-1.5-pro": { input: 1.25, output: 5 },
    "gemini-1.5-flash": { input: 0.075, output: 0.3 },
    "gemini-1.0-pro": { input: 0.5, output: 1.5 },
  },
};

function toLangChainMessages(request: AIExecuteRequest) {
  const messages = [];
  if (request.systemPrompt?.trim()) {
    messages.push(new SystemMessage(request.systemPrompt.trim()));
  }
  for (const message of request.conversationHistory ?? []) {
    if (message.role === "system") {
      messages.push(new SystemMessage(message.content));
    } else if (message.role === "assistant") {
      messages.push(new LcAiMessage(message.content));
    } else {
      messages.push(new HumanMessage(message.content));
    }
  }
  for (const message of request.messages ?? []) {
    if (message.role === "system") {
      messages.push(new SystemMessage(message.content));
    } else if (message.role === "assistant") {
      messages.push(new LcAiMessage(message.content));
    } else {
      messages.push(new HumanMessage(message.content));
    }
  }
  return messages;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return content == null ? "" : JSON.stringify(content);
}

export async function executeWithLangChain(
  providerId: string,
  request: AIExecuteRequest
): Promise<AIExecuteResponse> {
  const startMs = Date.now();
  const normalizedProviderId = providerId.trim().toLowerCase();
  const catalog = getProviderCatalog(normalizedProviderId);
  const modelName = request.model?.trim() || catalog?.models[0] || "unknown";

  try {
    const { chatModel, model } = LangChainModelFactory.create({
      providerId: normalizedProviderId,
      model: modelName,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });

    const response = await chatModel.invoke(toLangChainMessages(request));
    const rawText = extractTextContent(response.content);
    const usageMeta = response.usage_metadata as
      | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
      | undefined;

    const usage = {
      promptTokens: usageMeta?.input_tokens ?? 0,
      completionTokens: usageMeta?.output_tokens ?? 0,
      totalTokens: usageMeta?.total_tokens ?? 0,
    };

    const structuredOutput =
      request.outputFormat === "json" ? parseJsonFromText(rawText) : null;

    const pricing = PRICING_BY_PROVIDER[normalizedProviderId] ?? {};
    const defaultModel = catalog?.models[0] ?? model;

    return {
      status: "success",
      capability: "llm",
      text: rawText,
      structuredOutput,
      attachments: [],
      usage,
      cost: buildCostEstimate(request, pricing, defaultModel, usage),
      conversationId: null,
      providerMetadata: { via: "langchain" },
      providerId: normalizedProviderId,
      modelName: model,
      durationMs: Date.now() - startMs,
      error: null,
    };
  } catch (err) {
    return {
      status: "error",
      capability: "llm",
      text: null,
      structuredOutput: null,
      attachments: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: null,
      conversationId: null,
      providerMetadata: { via: "langchain" },
      providerId: normalizedProviderId,
      modelName,
      durationMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
