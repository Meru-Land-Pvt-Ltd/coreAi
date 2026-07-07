import type { AIProviderAdapter, AIExecuteRequest, AIContinueRequest, AIExecuteResponse, CostEstimate, ValidationResult, AIIntent } from "../types";
import { checkEnvKey, buildCostEstimate, estimateUsage, errorResponse, type PricingTable } from "./base-adapter";

// https://ai.google.dev/pricing
const PRICING: PricingTable = {
  "gemini-2.0-flash":      { input: 0.000075, output: 0.0003  },
  "gemini-2.0-flash-lite": { input: 0.000038, output: 0.00015 },
  "gemini-1.5-pro":        { input: 0.00125,  output: 0.005   },
  "gemini-1.5-flash":      { input: 0.000075, output: 0.0003  },
  "gemini-1.0-pro":        { input: 0.0005,   output: 0.0015  },
};

const DEFAULT_MODEL = "gemini-2.0-flash";

class GeminiAdapter implements AIProviderAdapter {
  readonly providerId = "gemini";
  readonly displayName = "Google Gemini";
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 8,
    reasoning: 7,
    code: 8,
  };

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("GOOGLE_AI_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    try {
      // TODO: replace with real Google Generative AI SDK call
      const text = `[${this.displayName} mock] ${request.messages.at(-1)?.content ?? ""}`;

      return {
        status: "success",
        text,
        structuredOutput: request.outputFormat === "json" ? { mock: true } : null,
        attachments: [],
        usage: estimateUsage(request),
        cost: await this.estimateCost(request),
        conversationId: null,
        providerMetadata: { model: request.model ?? DEFAULT_MODEL },
        providerId: this.providerId,
        durationMs: Date.now() - startMs,
        error: null,
      };
    } catch (err) {
      return errorResponse(this.providerId, err instanceof Error ? err.message : String(err), Date.now() - startMs);
    }
  }

  async continueConversation(request: AIContinueRequest): Promise<AIExecuteResponse> {
    return this.execute(request);
  }

  async estimateCost(request: AIExecuteRequest): Promise<CostEstimate> {
    return buildCostEstimate(request, PRICING, DEFAULT_MODEL);
  }
}

export default new GeminiAdapter();
