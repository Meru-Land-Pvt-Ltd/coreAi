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

// cached after first call — avoids re-importing the ESM-only package on every request
let genAiClient: unknown = null;
async function getClient() {
  if (!genAiClient) {
    const { GoogleGenAI } = await import("@google/genai");
    genAiClient = new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return genAiClient as any;
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

class GeminiAdapter implements AIProviderAdapter {
  readonly providerId = "gemini";
  readonly displayName = "Google Gemini";
  readonly capabilities: ProviderCapability[] = ["llm"];
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 8,
    reasoning: 7,
    code: 8,
  };

  private dynamicModels: string[] | null = null;
  private dynamicPricing: PricingTable | null = null;

  get models(): string[] {
    return this.dynamicModels ?? [
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-1.0-pro",
    ];
  }

  get pricing(): PricingTable {
    return this.dynamicPricing ?? {
      "gemini-2.0-flash":      { input: 0.075,  output: 0.30  },
      "gemini-1.5-pro":        { input: 1.25,   output: 5.00  },
      "gemini-1.5-flash":      { input: 0.075,  output: 0.30  },
      "gemini-1.0-pro":        { input: 0.50,   output: 1.50  },
    };
  }

  updateModelsAndPricing(models: string[], pricing: PricingTable): void {
    this.dynamicModels = models;
    this.dynamicPricing = pricing;
  }

  private get defaultModel() {
    return "gemini-2.0-flash";
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

      return {
        status: "success",
        capability: "llm",
        text: rawText,
        structuredOutput: request.outputFormat === "json" ? parseJsonFromText(rawText) : null,
        attachments: [],
        usage,
        cost: buildCostEstimate(request, this.pricing, this.defaultModel, usage),
        conversationId: null,
        providerMetadata: { model, finishReason: response.candidates?.[0]?.finishReason ?? null },
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
    history: Array<{ role: string; parts: Array<{ text: string }> }>;
    latestMessage: string | GeminiPart[];
  } {
    const allMessages: AIMessage[] = [
      ...(request.conversationHistory ?? []),
      ...(request.messages ?? []),
    ];

    const nonSystem = allMessages.filter((m) => m.role !== "system");
    const lastMsg = nonSystem[nonSystem.length - 1];
    const latestText = lastMsg?.content ?? "";

    const history = nonSystem.slice(0, -1).map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    if (!request.attachments?.length) {
      return { history, latestMessage: latestText };
    }

    const parts: GeminiPart[] = [{ text: latestText }];
    for (const att of request.attachments) {
      parts.push({ inlineData: { mimeType: att.mimeType, data: getCleanBase64(att.data) } });
    }
    return { history, latestMessage: parts };
  }
}

export default new GeminiAdapter();
