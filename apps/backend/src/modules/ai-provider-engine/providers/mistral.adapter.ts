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
  checkEnvKey,
  buildCostEstimate,
  retryOnTransient,
  parseJsonFromText,
  errorResponse,
  enrichContinueRequest,
  type PricingTable,
} from "./base-adapter";

class MistralAdapter implements AIProviderAdapter {
  readonly providerId = "mistral";
  readonly displayName = "Mistral AI";
  readonly capabilities: ProviderCapability[] = ["llm"];
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 7,
    reasoning: 7,
    code: 7,
  };

  private dynamicModels: string[] | null = null;
  private dynamicPricing: PricingTable | null = null;

  get models(): string[] {
    return this.dynamicModels ?? ["mistral-tiny", "mistral-small-latest", "mistral-medium", "mistral-large-latest"];
  }

  get pricing(): PricingTable {
    return this.dynamicPricing ?? {
      "mistral-tiny":         { input: 0.25, output: 0.25 },
      "mistral-small-latest": { input: 1.00, output: 3.00 },
      "mistral-medium":       { input: 2.70, output: 8.10 },
      "mistral-large-latest": { input: 4.00, output: 12.00 },
    };
  }

  updateModelsAndPricing(models: string[], pricing: PricingTable): void {
    this.dynamicModels = models;
    this.dynamicPricing = pricing;
  }

  private get defaultModel() {
    return env.MISTRAL_DEFAULT_MODEL;
  }

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("MISTRAL_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? this.defaultModel;

    try {
      const messages = this.buildMessages(request);

      const response = await retryOnTransient(async () => {
        const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
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
          throw new Error(`Mistral API returned status ${res.status}: ${body}`);
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
        cost: buildCostEstimate(request, this.pricing, this.defaultModel, usage),
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
    return buildCostEstimate(request, this.pricing, this.defaultModel);
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

export default new MistralAdapter();
