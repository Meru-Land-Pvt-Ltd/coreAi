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
  type PricingTable,
} from "./base-adapter";
import { getModelsForProvider, getPricingForProvider } from "../model-catalog";

class GroqAdapter implements AIProviderAdapter {
  readonly providerId = "groq";
  readonly displayName = "Groq";
  readonly capabilities: ProviderCapability[] = ["llm"];
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 9,
    reasoning: 9,
    code: 8,
  };

  get models(): string[] {
    return getModelsForProvider("groq");
  }

  get pricing(): PricingTable {
    return getPricingForProvider("groq");
  }

  private _client: OpenAI | null = null;
  private get client(): OpenAI {
    if (!this._client) {
      /* NEVER ANOTHER COMPANY'S KEY. This fell back to OPENAI_API_KEY, so
         our OpenAI key was sent, in an Authorization header, to a different
         company's servers — on an ordinary customer action. It cannot work
         (they would reject it) and it hands our secret to a third party, which
         is the part that does not undo. Each provider uses its own key or is
         not available. */
      const apiKey = env.GROQ_API_KEY ?? "";
      this._client = new OpenAI({
        apiKey,
        baseURL: "https://api.groq.com/openai/v1",
      });
    }
    return this._client;
  }

  private get defaultModel() {
    return "llama-3.3-70b-versatile";
  }

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("GROQ_API_KEY");
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
          groqId: completion.id,
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

    for (const msg of history) {
      if (msg.role === "system") {
        result.push({ role: "system", content: msg.content });
      } else if (msg.role === "assistant") {
        result.push({ role: "assistant", content: msg.content });
      } else {
        result.push({ role: "user", content: msg.content });
      }
    }

    return result;
  }
}

export default new GroqAdapter();
