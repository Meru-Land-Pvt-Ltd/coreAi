import { env } from "../../../config/env";
import type {
  AIProviderAdapter,
  AIExecuteRequest,
  AIContinueRequest,
  AIExecuteResponse,
  CostEstimate,
  ValidationResult,
  ProviderCapability,
} from "../types";
import {
  checkEnvKey,
  retryOnTransient,
  errorResponse,
} from "./base-adapter";

class StabilityAdapter implements AIProviderAdapter {
  readonly providerId = "stability";
  readonly displayName = "Stability AI";
  readonly capabilities: ProviderCapability[] = ["image-gen"];
  readonly scores = {};
  readonly models = ["stable-diffusion-xl-1024-v1-0", "stable-diffusion-v1-6"];

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("STABILITY_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? "stable-diffusion-xl-1024-v1-0";

    try {
      const prompt = request.imagePrompt ?? "";
      if (!prompt) {
        throw new Error("No image prompt provided for generation.");
      }

      // Stability text-to-image v1 API accepts standard JSON
      const response = await retryOnTransient(async () => {
        const res = await fetch(
          `https://api.stability.ai/v1/generation/${model}/text-to-image`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${env.STABILITY_API_KEY}`,
            },
            body: JSON.stringify({
              text_prompts: [{ text: prompt, weight: 1 }],
              cfg_scale: 7,
              samples: 1,
              steps: 30,
            }),
          }
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Stability AI API returned status ${res.status}: ${text}`);
        }

        return res.json();
      });

      const base64Data = response.artifacts?.[0]?.base64 ?? "";
      const imageUrl = `data:image/png;base64,${base64Data}`;

      return {
        status: "success",
        capability: "image-gen",
        text: null,
        structuredOutput: null,
        imageUrl,
        attachments: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        cost: {
          inputCostUsd: 0.02, // Stability SDXL costs ~0.02 USD per generation
          outputCostUsd: 0,
          totalCostUsd: 0.02,
          model,
        },
        conversationId: null,
        providerMetadata: { model },
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
        Date.now() - startMs,
        "image-gen"
      );
    }
  }

  async continueConversation(request: AIContinueRequest): Promise<AIExecuteResponse> {
    return this.execute(request);
  }

  async estimateCost(request: AIExecuteRequest): Promise<CostEstimate> {
    const model = request.model ?? "stable-diffusion-xl-1024-v1-0";
    return {
      inputCostUsd: 0.02,
      outputCostUsd: 0,
      totalCostUsd: 0.02,
      model,
    };
  }
}

export default new StabilityAdapter();
