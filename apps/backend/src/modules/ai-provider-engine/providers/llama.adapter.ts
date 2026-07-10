import { env } from "../../../config/env";
import type {
  AIProviderAdapter,
  AIExecuteRequest,
  AIContinueRequest,
  AIExecuteResponse,
  CostEstimate,
  ValidationResult,
  AIIntent,
  AIMessage,
  ProviderCapability,
} from "../types";
import {
  retryOnTransient,
  parseJsonFromText,
  errorResponse,
  enrichContinueRequest,
} from "./base-adapter";

class LlamaAdapter implements AIProviderAdapter {
  readonly providerId = "llama";
  readonly displayName = "Llama (Self-Hosted)";
  readonly capabilities: ProviderCapability[] = ["llm"];
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 6,
    reasoning: 5,
    code: 5,
  };
  private dynamicModels: string[] | null = null;

  get models(): string[] {
    return this.dynamicModels ?? ["llama3", "llama3.1", "llama2", "mistral"];
  }

  updateModelsAndPricing(models: string[]): void {
    this.dynamicModels = models;
  }

  private get defaultModel() {
    return "llama3";
  }

  async validate(): Promise<ValidationResult> {
    // If base URL is configured, we assume it's valid
    if (env.LLAMA_BASE_URL) {
      return { valid: true, message: `Llama base URL is set to ${env.LLAMA_BASE_URL}` };
    }
    return { valid: false, message: "Llama base URL is not configured." };
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? this.defaultModel;

    try {
      const messages = this.buildMessages(request);
      const url = `${env.LLAMA_BASE_URL.replace(/\/$/, "")}/chat/completions`;

      const response = await retryOnTransient(async () => {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Self-hosted Llama API returned status ${res.status}: ${body}`);
        }

        return res.json();
      });

      const rawText = response.choices?.[0]?.message?.content ?? "";
      const usage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      };

      return {
        status: "success",
        capability: "llm",
        text: rawText,
        structuredOutput: request.outputFormat === "json" ? parseJsonFromText(rawText) : null,
        attachments: [],
        usage,
        cost: { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, model }, // Free self-hosted Llama
        conversationId: null,
        providerMetadata: {
          model,
          finishReason: response.choices?.[0]?.finish_reason ?? null,
        },
        providerId: this.providerId,
        modelName: model,
        durationMs: Date.now() - startMs,
        error: null,
      };
    } catch (err) {
      return errorResponse(this.providerId, model, err instanceof Error ? err.message : String(err), Date.now() - startMs);
    }
  }

  async continueConversation(request: AIContinueRequest): Promise<AIExecuteResponse> {
    return this.execute(enrichContinueRequest(request));
  }

  async estimateCost(request: AIExecuteRequest): Promise<CostEstimate> {
    const model = request.model ?? this.defaultModel;
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, model };
  }

  private buildMessages(request: AIExecuteRequest): AIMessage[] {
    const result: AIMessage[] = [];

    if (request.systemPrompt) {
      result.push({ role: "system", content: request.systemPrompt });
    }

    const history = [
      ...(request.conversationHistory ?? []),
      ...(request.messages ?? []),
    ];

    return [...result, ...history];
  }
}

export default new LlamaAdapter();
