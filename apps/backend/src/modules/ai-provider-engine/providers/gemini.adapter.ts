// @google/genai is ESM-only; dynamic import() is required in this CJS project
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

// Pricing per 1M tokens — https://ai.google.dev/pricing
const PRICING: PricingTable = {
  "gemini-3.5-flash":      { input: 0.075,  output: 0.30  },
  "gemini-2.0-flash":      { input: 0.075,  output: 0.30  },
  "gemini-2.0-flash-lite": { input: 0.0375, output: 0.15  },
  "gemini-1.5-pro":        { input: 1.25,   output: 5.00  },
  "gemini-1.5-flash":      { input: 0.075,  output: 0.30  },
  "gemini-1.0-pro":        { input: 0.50,   output: 1.50  },
};

/** Lazily import the ESM-only @google/genai package */
async function getClient() {
  const { GoogleGenAI } = await import("@google/genai");
  return new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY });
}

class GeminiAdapter implements AIProviderAdapter {
  readonly providerId = "gemini";
  readonly displayName = "Google Gemini";
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 8,
    reasoning: 7,
    code: 8,
  };

  private get defaultModel(): string {
    return env.GEMINI_DEFAULT_MODEL;
  }

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("GOOGLE_AI_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? this.defaultModel;

    try {
      const ai = await getClient();
      const { history, latestMessage } = this.buildPayload(request);

      const response = await retryOnTransient(async () => {
        const chat = ai.chats.create({
          model,
          history,
          config: {
            systemInstruction: request.systemPrompt,
            temperature: request.temperature ?? 0.7,
            maxOutputTokens: request.maxTokens,
          },
        });
        return chat.sendMessage({ message: latestMessage });
      });

      const rawText = response.text ?? "";
      const meta = response.usageMetadata;
      const usage = {
        promptTokens: meta?.promptTokenCount ?? 0,
        completionTokens: meta?.candidatesTokenCount ?? 0,
        totalTokens: meta?.totalTokenCount ?? 0,
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
          finishReason: response.candidates?.[0]?.finishReason ?? null,
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
    history: Array<{ role: string; parts: Array<{ text: string }> }>;
    latestMessage: any;
  } {
    const allMessages: AIMessage[] = [
      ...(request.conversationHistory ?? []),
      ...request.messages,
    ];

    const nonSystem = allMessages.filter((m) => m.role !== "system");
    const lastMsg = nonSystem[nonSystem.length - 1];
    const latestMessageText = lastMsg?.content ?? "";

    const history = nonSystem.slice(0, -1).map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    let latestMessage: any = latestMessageText;
    if (request.attachments && request.attachments.length > 0) {
      const parts: any[] = [{ text: latestMessageText }];
      for (const att of request.attachments) {
        const base64Data = getCleanBase64(att.data);
        parts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: base64Data,
          },
        });
      }
      latestMessage = parts;
    }

    return { history, latestMessage };
  }
}

export default new GeminiAdapter();
