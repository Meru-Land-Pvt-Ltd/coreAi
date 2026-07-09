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

// Pricing per 1M tokens — https://openai.com/api/pricing
const PRICING: PricingTable = {
  "gpt-4o":        { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":   { input: 0.15,  output: 0.60  },
  "gpt-4-turbo":   { input: 10.00, output: 30.00 },
  "gpt-3.5-turbo": { input: 0.50,  output: 1.50  },
};

class OpenAIAdapter implements AIProviderAdapter {
  readonly providerId = "openai";
  readonly displayName = "OpenAI";
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 8,
    reasoning: 8,
    code: 9,
    image: 9,
  };

  private get client(): OpenAI {
    return new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  private get defaultModel(): string {
    return env.OPENAI_DEFAULT_MODEL;
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

      // LLM always returns text; convert to JSON only when caller requested it
      const structuredOutput =
        request.outputFormat === "json" ? parseJsonFromText(rawText) : null;

      return {
        status: "success",
        text: rawText,
        structuredOutput,
        attachments: [],
        usage,
        cost: buildCostEstimate(request, PRICING, this.defaultModel, usage),
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
      return errorResponse(
        this.providerId,
        model,
        err instanceof Error ? err.message : String(err),
        Date.now() - startMs
      );
    }
  }

  async continueConversation(request: AIContinueRequest): Promise<AIExecuteResponse> {
    return this.execute(enrichContinueRequest(request));
  }

  async estimateCost(request: AIExecuteRequest): Promise<CostEstimate> {
    return buildCostEstimate(request, PRICING, this.defaultModel);
  }

  private buildMessages(request: AIExecuteRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (request.systemPrompt) {
      result.push({ role: "system", content: request.systemPrompt });
    }

    const history: AIMessage[] = [
      ...(request.conversationHistory ?? []),
      ...request.messages,
    ];

    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      const isLast = i === history.length - 1;

      if (msg.role === "system") {
        // System messages mid-history are folded into content (OpenAI accepts system role)
        result.push({ role: "system", content: msg.content });
      } else if (msg.role === "assistant") {
        result.push({ role: "assistant", content: msg.content });
      } else {
        if (isLast && request.attachments && request.attachments.length > 0) {
          const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [
            { type: "text", text: msg.content },
          ];

          for (const att of request.attachments) {
            if (att.mimeType.startsWith("image/")) {
              const url = ensureDataUri(att.data, att.mimeType);
              contentParts.push({
                type: "image_url",
                image_url: { url },
              });
            }
          }
          result.push({ role: "user", content: contentParts });
        } else {
          result.push({ role: "user", content: msg.content });
        }
      }
    }

    return result;
  }
}

export default new OpenAIAdapter();
