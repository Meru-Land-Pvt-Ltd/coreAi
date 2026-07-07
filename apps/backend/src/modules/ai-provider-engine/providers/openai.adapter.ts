import type { AIProviderAdapter, AIExecuteRequest, AIContinueRequest, AIExecuteResponse, CostEstimate, ValidationResult, AIIntent } from "../types";
import { checkEnvKey, buildCostEstimate, estimateUsage, errorResponse, type PricingTable } from "./base-adapter";

// https://openai.com/api/pricing
const PRICING: PricingTable = {
  "gpt-4o":        { input: 0.0025,  output: 0.01   },
  "gpt-4o-mini":   { input: 0.00015, output: 0.0006 },
  "gpt-4-turbo":   { input: 0.01,    output: 0.03   },
  "gpt-3.5-turbo": { input: 0.0005,  output: 0.0015 },
};

const DEFAULT_MODEL = "gpt-4o-mini";

class OpenAIAdapter implements AIProviderAdapter {
  readonly providerId = "openai";
  readonly displayName = "OpenAI";
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 8,
    reasoning: 8,
    code: 9,
    image: 9,
  };

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("OPENAI_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    try {
      // TODO: replace with real OpenAI SDK call
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

export default new OpenAIAdapter();
