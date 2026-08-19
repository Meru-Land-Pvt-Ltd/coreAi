import OpenAI from "openai";
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

class DalleAdapter implements AIProviderAdapter {
  readonly providerId = "dalle";
  readonly displayName = "DALL-E";
  readonly capabilities: ProviderCapability[] = ["image-gen"];
  readonly scores = {};
  readonly models = ["dall-e-3", "dall-e-2"];

  private _client: OpenAI | null = null;
  private _clientKey: string | null = null;
  /* The client is cached, so the key it was built with is remembered next to
     it. Without this, an admin who rotates a key in the dashboard keeps
     talking to the old one until someone restarts the server — which is
     exactly what the rotation feature exists to avoid. */
  private get client(): OpenAI {
    const apiKey = env.OPENAI_API_KEY ?? "";
    if (!this._client || this._clientKey !== apiKey) {
      this._client = new OpenAI({ apiKey });
      this._clientKey = apiKey;
    }
    return this._client;
  }

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("OPENAI_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? "dall-e-3";

    try {
      const prompt = request.imagePrompt ?? "";
      if (!prompt) {
        throw new Error("No image prompt provided for generation.");
      }

      const size = (request.imageSize ?? "1024x1024") as any;

      const response = await retryOnTransient(() =>
        this.client.images.generate({
          model,
          prompt,
          n: 1,
          size,
        })
      );

      const imageUrl = response.data?.[0]?.url ?? "";
      const revisedPrompt = response.data?.[0]?.revised_prompt ?? prompt;

      let imageBuffer: Buffer | undefined;
      let imageMimeType: string | undefined;

      if (response.data?.[0]?.b64_json) {
        imageBuffer = Buffer.from(response.data[0].b64_json, "base64");
        imageMimeType = "image/png";
      } else if (imageUrl) {
        try {
          const imgRes = await retryOnTransient(() => fetch(imageUrl));
          if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuffer);
            imageMimeType = imgRes.headers.get("content-type") ?? "image/png";
          }
        } catch {
          // If fetch fails, keep imageUrl
        }
      }

      return {
        status: "success",
        capability: "image-gen",
        text: null,
        structuredOutput: null,
        imageUrl,
        imageBuffer,
        imageMimeType,
        revisedPrompt,
        attachments: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        cost: {
          inputCostUsd: model === "dall-e-3" ? 0.04 : 0.02, // DALL-E pricing per image
          outputCostUsd: 0,
          totalCostUsd: model === "dall-e-3" ? 0.04 : 0.02,
          model,
        },
        conversationId: null,
        providerMetadata: { model, size, revisedPrompt },
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
    const model = request.model ?? "dall-e-3";
    return {
      inputCostUsd: model === "dall-e-3" ? 0.04 : 0.02,
      outputCostUsd: 0,
      totalCostUsd: model === "dall-e-3" ? 0.04 : 0.02,
      model,
    };
  }
}

export default new DalleAdapter();
