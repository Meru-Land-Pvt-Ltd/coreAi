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
import { recordQuotaExceeded, getModelStatus } from "../model-quota-manager";

class StabilityAdapter implements AIProviderAdapter {
  readonly providerId = "stability";
  readonly displayName = "Stability AI";
  readonly capabilities: ProviderCapability[] = ["image-gen"];
  readonly scores = {};
  readonly models = [
    "sd3.5-large",
    "sd3.5-large-turbo",
    "sd3.5-medium",
    "sd3.5-flash",
    "stable-diffusion-xl-1024-v1-0",
    "stable-diffusion-v1-6"
  ];

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("STABILITY_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const rawModel = (request.model ?? "sd3.5-large").trim().toLowerCase();

    const apiKey = env.STABILITY_API_KEY?.trim() || process.env.STABILITY_API_KEY?.trim();
    if (!apiKey) {
      return errorResponse(
        this.providerId,
        rawModel,
        "STABILITY_API_KEY is not configured in your environment. Please add STABILITY_API_KEY to your .env file or select an active model (such as Nano Banana 2 or DALL-E 3).",
        Date.now() - startMs,
        "image-gen"
      );
    }

    const modelStatus = getModelStatus(rawModel);
    if (!modelStatus.available) {
      return errorResponse(
        this.providerId,
        rawModel,
        modelStatus.disabledReason || `Model ${rawModel} is currently disabled.`,
        Date.now() - startMs,
        "image-gen"
      );
    }

    const modelMap: Record<string, string> = {
      "sd3.5-large": "sd3.5-large",
      "sd3.5-large-turbo": "sd3.5-large-turbo",
      "sd3.5-medium": "sd3.5-medium",
      "sd3.5-flash": "sd3.5-flash",
      "stable-diffusion-3.5-large": "sd3.5-large",
      "stable-diffusion-3.5-large-turbo": "sd3.5-large-turbo",
      "stable-diffusion-3.5-medium": "sd3.5-medium",
      "stable-diffusion-3.5-flash": "sd3.5-flash"
    };

    const model = modelMap[rawModel] ?? (rawModel.includes("3.5") ? "sd3.5-large" : rawModel);

    try {
      const prompt = request.imagePrompt ?? "";
      if (!prompt) {
        throw new Error("No image prompt provided for generation.");
      }

      let referenceBuffer: Buffer | null = null;
      if (request.referenceImage) {
        if (Buffer.isBuffer(request.referenceImage)) {
          referenceBuffer = request.referenceImage;
        } else if (typeof request.referenceImage === "string") {
          const cleanB64 = request.referenceImage.replace(/^data:image\/\w+;base64,/, "");
          referenceBuffer = Buffer.from(cleanB64, "base64");
        } else if (
          typeof request.referenceImage === "object" &&
          request.referenceImage !== null &&
          (request.referenceImage as any).type === "Buffer" &&
          Array.isArray((request.referenceImage as any).data)
        ) {
          referenceBuffer = Buffer.from((request.referenceImage as any).data);
        }
      }

      const randomSeed = Math.floor(Math.random() * 4294967295);
      let base64Data = "";
      let lastErrorText = "";

      // Strategy 1: Stability v2beta SD3 / SD3.5 API
      try {
        const formData = new FormData();
        formData.append("prompt", prompt);
        formData.append("model", model);
        formData.append("output_format", "png");
        formData.append("seed", String(randomSeed));

        if (referenceBuffer) {
          formData.append(
            "image",
            new Blob([new Uint8Array(referenceBuffer)], { type: "image/png" }),
            "init_image.png"
          );
          formData.append("strength", "0.80");
        }

        const res = await retryOnTransient(() =>
          fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: "application/json",
            },
            body: formData,
          })
        );

        if (res.ok) {
          const data = await res.json();
          base64Data = data.image ?? data.artifacts?.[0]?.base64 ?? "";
        } else {
          lastErrorText = await res.text();
          if (res.status === 429 || lastErrorText.toLowerCase().includes("quota") || lastErrorText.toLowerCase().includes("rate limit")) {
            recordQuotaExceeded("stability");
          }
        }
      } catch (err) {
        lastErrorText = err instanceof Error ? err.message : String(err);
      }

      // Strategy 2: Stability v1 generation API fallback
      if (!base64Data) {
        const v1Model = model.startsWith("sd3") ? "stable-diffusion-xl-1024-v1-0" : model;
        const response = await retryOnTransient(async () => {
          if (referenceBuffer) {
            try {
              const formData = new FormData();
              formData.append(
                "init_image",
                new Blob([new Uint8Array(referenceBuffer)], { type: "image/png" }),
                "init_image.png"
              );
              formData.append("text_prompts[0][text]", prompt);
              formData.append("text_prompts[0][weight]", "1");
              formData.append("init_image_mode", "IMAGE_STRENGTH");
              formData.append("image_strength", "0.80");
              formData.append("style_preset", "photographic");
              formData.append("seed", String(randomSeed));

              const res = await fetch(
                `https://api.stability.ai/v1/generation/${v1Model}/image-to-image`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${apiKey}`,
                  },
                  body: formData,
                }
              );

              if (res.ok) {
                return res.json();
              }
            } catch {
              // Fallback to text-to-image below
            }
          }

          const res = await fetch(
            `https://api.stability.ai/v1/generation/${v1Model}/text-to-image`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                text_prompts: [{ text: prompt, weight: 1 }],
                cfg_scale: 7,
                samples: 1,
                steps: 30,
                seed: randomSeed
              }),
            }
          );

          if (!res.ok) {
            const text = await res.text();
            if (res.status === 429 || text.toLowerCase().includes("quota") || text.toLowerCase().includes("rate limit")) {
              recordQuotaExceeded("stability");
            }
            throw new Error(`Stability AI API returned status ${res.status}: ${text}`);
          }

          return res.json();
        });

        base64Data = response.artifacts?.[0]?.base64 ?? "";
      }

      if (!base64Data) {
        throw new Error(lastErrorText || "Stability AI API did not return image binary data.");
      }

      const imageBuffer = Buffer.from(base64Data, "base64");
      const imageUrl = `data:image/png;base64,${base64Data}`;

      return {
        status: "success",
        capability: "image-gen",
        text: null,
        structuredOutput: null,
        imageUrl,
        imageBuffer,
        imageMimeType: "image/png",
        revisedPrompt: prompt,
        attachments: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        cost: {
          inputCostUsd: model.includes("turbo") || model.includes("flash") ? 0.01 : 0.035,
          outputCostUsd: 0,
          totalCostUsd: model.includes("turbo") || model.includes("flash") ? 0.01 : 0.035,
          model,
        },
        conversationId: null,
        providerMetadata: { model, seed: randomSeed },
        providerId: this.providerId,
        modelName: model,
        durationMs: Date.now() - startMs,
        error: null,
      };
    } catch (err) {
      return errorResponse(
        this.providerId,
        rawModel,
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
    const model = request.model ?? "sd3.5-large";
    const cost = model.includes("turbo") || model.includes("flash") ? 0.01 : 0.035;
    return {
      inputCostUsd: cost,
      outputCostUsd: 0,
      totalCostUsd: cost,
      model,
    };
  }
}

export default new StabilityAdapter();
