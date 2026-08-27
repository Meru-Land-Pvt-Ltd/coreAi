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
  jsonResponseFormat,
  errorResponse,
  enrichContinueRequest,
  ensureDataUri,
  type PricingTable,
} from "./base-adapter";
import { getModelsForProvider, getPricingForProvider } from "../model-catalog";

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

  get models(): string[] {
    return getModelsForProvider("openai");
  }

  get pricing(): PricingTable {
    return getPricingForProvider("openai");
  }

  private _client: OpenAI | null = null;
  private _clientKey: string | null = null;
  /* The client is cached, so the key it was built with is remembered next to
     it. Without this, an admin who rotates a key in the dashboard keeps
     talking to the old one until someone restarts the server — which is
     exactly what the rotation feature exists to avoid. */
  private get client(): OpenAI {
    const apiKey = env.OPENAI_API_KEY ?? "";
    if (!this._client || this._clientKey !== apiKey) {
      this._client = new OpenAI({ apiKey });
      this._clientKey = apiKey;
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
          max_completion_tokens: request.maxTokens,
          /* "EXACT — SAME ANSWER EVERY TIME" DID NOTHING ON OPENAI. The dial
             is offered on every non-thinking OpenAI model, an architect sets
             it to Exact, and this never sent it — so the model kept its own
             default and the answers kept varying. Every other adapter forwards
             it. The thinking models refuse the setting outright, so it is only
             sent when the request carries one. */
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...jsonResponseFormat(request),
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
