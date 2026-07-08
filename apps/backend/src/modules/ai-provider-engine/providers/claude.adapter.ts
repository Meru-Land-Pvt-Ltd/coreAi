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

// Pricing per 1M tokens — https://www.anthropic.com/pricing
const PRICING: PricingTable = {
  "claude-opus-4-5":   { input: 15.00,  output: 75.00  },
  "claude-sonnet-4-5": { input: 3.00,   output: 15.00  },
  "claude-haiku-3-5":  { input: 0.80,   output: 4.00   },
  "claude-3-opus":     { input: 15.00,  output: 75.00  },
  "claude-3-sonnet":   { input: 3.00,   output: 15.00  },
  "claude-3-haiku":    { input: 0.25,   output: 1.25   },
};

class ClaudeAdapter implements AIProviderAdapter {
  readonly providerId = "claude";
  readonly displayName = "Anthropic Claude";
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 9,
    reasoning: 10,
    code: 8,
  };

  private get client(): Anthropic {
    return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  private get defaultModel(): string {
    return env.ANTHROPIC_DEFAULT_MODEL;
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

      // Extract text from the first content block
      const rawText =
        response.content.find((b) => b.type === "text")?.text ?? "";

      const usage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      };

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
          stopReason: response.stop_reason ?? null,
          anthropicId: response.id,
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

  private buildPayload(request: AIExecuteRequest): {
    system: string | undefined;
    messages: Anthropic.MessageParam[];
  } {
    const history: AIMessage[] = [
      ...(request.conversationHistory ?? []),
      ...request.messages,
    ];

    // Collect system messages (including any from history) and the explicit systemPrompt
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

      if (role === "user" && isLast && request.attachments && request.attachments.length > 0) {
        const contentParts: any[] = [
          { type: "text", text: msg.content }
        ];

        for (const att of request.attachments) {
          const base64Data = getCleanBase64(att.data);

          if (att.mimeType.startsWith("image/")) {
            contentParts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: att.mimeType,
                data: base64Data,
              }
            });
          } else if (att.mimeType === "application/pdf") {
            contentParts.push({
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64Data,
              }
            });
          }
        }
        anthropicMessages.push({ role, content: contentParts as any });
      } else {
        anthropicMessages.push({ role, content: msg.content });
      }
    }

    // Anthropic requires alternating user/assistant turns; ensure the last message is from user
    return {
      system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
      messages: anthropicMessages,
    };
  }
}

export default new ClaudeAdapter();
