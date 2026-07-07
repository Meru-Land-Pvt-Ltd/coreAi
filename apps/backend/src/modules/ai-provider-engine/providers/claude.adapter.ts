import type { AIProviderAdapter, AIExecuteRequest, AIContinueRequest, AIExecuteResponse, CostEstimate, ValidationResult, AIIntent } from "../types";
import { checkEnvKey, buildCostEstimate, estimateUsage, errorResponse, type PricingTable } from "./base-adapter";

// https://www.anthropic.com/pricing
const PRICING: PricingTable = {
  "claude-opus-4-5":   { input: 0.015,   output: 0.075   },
  "claude-sonnet-4-5": { input: 0.003,   output: 0.015   },
  "claude-haiku-3-5":  { input: 0.0008,  output: 0.004   },
  "claude-3-opus":     { input: 0.015,   output: 0.075   },
  "claude-3-sonnet":   { input: 0.003,   output: 0.015   },
  "claude-3-haiku":    { input: 0.00025, output: 0.00125 },
};

const DEFAULT_MODEL = "claude-sonnet-4-5";

class ClaudeAdapter implements AIProviderAdapter {
  readonly providerId = "claude";
  readonly displayName = "Anthropic Claude";
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 9,
    reasoning: 10,
    code: 8,
  };

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("ANTHROPIC_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    try {
      // TODO: replace with real Anthropic SDK call
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

export default new ClaudeAdapter();
