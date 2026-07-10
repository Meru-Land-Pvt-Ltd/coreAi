import OpenAI from "openai";
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
  ensureDataUri,
  type PricingTable,
} from "./base-adapter";

class OpenAIAdapter implements AIProviderAdapter {
  readonly providerId = "openai";
  readonly displayName = "OpenAI";
  readonly capabilities: ProviderCapability[] = ["llm"];
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 8,
    reasoning: 8,
    code: 9,
    image: 9,
  };

  private dynamicModels: string[] | null = null;
  private dynamicPricing: PricingTable | null = null;

  get models(): string[] {
    return this.dynamicModels ?? ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"];
  }

  get pricing(): PricingTable {
    return this.dynamicPricing ?? {
      "gpt-4o":        { input: 2.50,  output: 10.00 },
      "gpt-4o-mini":   { input: 0.15,  output: 0.60  },
      "gpt-4-turbo":   { input: 10.00, output: 30.00 },
      "gpt-3.5-turbo": { input: 0.50,  output: 1.50  },
    };
  }

  updateModelsAndPricing(models: string[], pricing: PricingTable): void {
    this.dynamicModels = models;
    this.dynamicPricing = pricing;
  }

  private _client: OpenAI | null = null;
  private get client(): OpenAI {
    if (!this._client) {
      this._client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    }
    return this._client;
  }

  private get defaultModel() {
    return "gpt-4o-mini";
  }

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("OPENAI_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? this.defaultModel;

    try {
      const messages = this.buildMessages(request);

      const completion = await retryOnTransient(() =>
        this.client.chat.completions.create({
          model,
          messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens,
        })
      );

      const rawText = completion.choices[0]?.message?.content ?? "";
      const usage = {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
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
          finishReason: completion.choices[0]?.finish_reason ?? null,
          openaiId: completion.id,
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

  private buildMessages(request: AIExecuteRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (request.systemPrompt) result.push({ role: "system", content: request.systemPrompt });

    const history: AIMessage[] = [
      ...(request.conversationHistory ?? []),
      ...(request.messages ?? []),
    ];

    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      const isLast = i === history.length - 1;

      if (msg.role === "system") {
        result.push({ role: "system", content: msg.content });
      } else if (msg.role === "assistant") {
        result.push({ role: "assistant", content: msg.content });
      } else if (isLast && request.attachments?.length) {
        const parts: OpenAI.Chat.ChatCompletionContentPart[] = [{ type: "text", text: msg.content }];
        for (const att of request.attachments) {
          if (att.mimeType.startsWith("image/")) {
            parts.push({ type: "image_url", image_url: { url: ensureDataUri(att.data, att.mimeType) } });
          }
        }
        result.push({ role: "user", content: parts });
      } else {
        result.push({ role: "user", content: msg.content });
      }
    }

    return result;
  }
}

export default new OpenAIAdapter();
