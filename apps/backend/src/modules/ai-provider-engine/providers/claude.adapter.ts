import Anthropic from "@anthropic-ai/sdk";
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
  getCleanBase64,
  type PricingTable,
} from "./base-adapter";

class ClaudeAdapter implements AIProviderAdapter {
  readonly providerId = "claude";
  readonly displayName = "Anthropic Claude";
  readonly capabilities: ProviderCapability[] = ["llm"];
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 9,
    reasoning: 10,
    code: 8,
  };

  private dynamicModels: string[] | null = null;
  private dynamicPricing: PricingTable | null = null;

  get models(): string[] {
    return this.dynamicModels ?? [
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-opus-latest",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307",
    ];
  }

  get pricing(): PricingTable {
    return this.dynamicPricing ?? {
      "claude-3-5-sonnet-latest": { input: 3.00,  output: 15.00 },
      "claude-3-5-haiku-latest":  { input: 0.80,  output: 4.00  },
      "claude-3-opus-latest":     { input: 15.00, output: 75.00 },
      "claude-3-sonnet-20240229": { input: 3.00,  output: 15.00 },
      "claude-3-haiku-20240307":  { input: 0.25,  output: 1.25  },
    };
  }

  updateModelsAndPricing(models: string[], pricing: PricingTable): void {
    this.dynamicModels = models;
    this.dynamicPricing = pricing;
  }

  private _client: Anthropic | null = null;
  private get client(): Anthropic {
    if (!this._client) {
      this._client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    }
    return this._client;
  }

  private get defaultModel() {
    return "claude-3-5-sonnet-latest";
  }

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("ANTHROPIC_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? this.defaultModel;

    try {
      const { system, messages } = this.buildPayload(request);

      const response = await retryOnTransient(() =>
        this.client.messages.create({
          model,
          max_tokens: request.maxTokens ?? 1024,
          system,
          messages,
          temperature: request.temperature ?? 0.7 as never,
        })
      );

      const rawText = response.content.find((b) => b.type === "text")?.text ?? "";
      const usage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
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
        providerMetadata: { model, stopReason: response.stop_reason ?? null, anthropicId: response.id },
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

  private buildPayload(request: AIExecuteRequest): {
    system: string | undefined;
    messages: Anthropic.MessageParam[];
  } {
    const history: AIMessage[] = [
      ...(request.conversationHistory ?? []),
      ...(request.messages ?? []),
    ];

    const systemParts: string[] = [];
    if (request.systemPrompt) systemParts.push(request.systemPrompt);

    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      const isLast = i === history.length - 1;

      if (msg.role === "system") {
        systemParts.push(msg.content);
        continue;
      }

      const role = msg.role === "assistant" ? "assistant" : "user";

      if (role === "user" && isLast && request.attachments?.length) {
        const parts: Anthropic.ContentBlockParam[] = [{ type: "text", text: msg.content }];

        for (const att of request.attachments) {
          const data = getCleanBase64(att.data);
          if (att.mimeType.startsWith("image/")) {
            parts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: att.mimeType as Anthropic.Base64ImageSource["media_type"],
                data,
              },
            });
          } else if (att.mimeType === "application/pdf") {
            parts.push({
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data },
            });
          }
        }
        anthropicMessages.push({ role, content: parts });
      } else {
        anthropicMessages.push({ role, content: msg.content });
      }
    }

    return {
      system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
      messages: anthropicMessages,
    };
  }
}

export default new ClaudeAdapter();
