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
import { checkEnvKey, errorResponse } from "./base-adapter";
import { recordQuotaExceeded, getModelStatus } from "../model-quota-manager";

function sanitizeGeminiErrorMessage(rawText: string, modelName: string): string {
  if (!rawText) return "Gemini image generation service is unavailable. Please try again later.";

  const text = rawText.toLowerCase();

  if (
    text.includes("429") ||
    text.includes("quota") ||
    text.includes("resource_exhausted") ||
    text.includes("rate limit") ||
    text.includes("free_tier")
  ) {
    /* A TWENTY-SECOND LIMIT SWITCHED IMAGES OFF FOR THREE HOURS.
       Google says how long to wait, and this read that number, printed it to
       the user — and then ignored it, disabling image generation for three
       hours for EVERY business on the platform. A momentary burst limit was
       being treated like an exhausted monthly quota. Google's own answer is
       used when it gives one; three hours only when it does not. */
    const delayMatch = rawText.match(/retry in ([\d\.]+)\s*(s|seconds?)/i);
    const retrySeconds = delayMatch ? Number(delayMatch[1]) : null;
    const cooldownMs =
      retrySeconds && Number.isFinite(retrySeconds) && retrySeconds > 0
        ? Math.ceil(retrySeconds * 1000)
        : undefined;

    recordQuotaExceeded("gemini", cooldownMs);

    const retryNote = delayMatch ? ` Please retry in ${delayMatch[1]}s.` : "";
    const pausedNote = cooldownMs
      ? ` It is paused for about ${Math.ceil(cooldownMs / 1000)} seconds.`
      : " It is paused for 3 hours.";
    return `Google Gemini rate limit/quota exceeded for ${modelName}.${retryNote}${pausedNote} You can use OpenAI DALL-E 3 or Stable Diffusion 3.5 in the meantime.`;
  }

  if (text.includes("404") || text.includes("not_found") || text.includes("not found")) {
    return `The selected Gemini model (${modelName}) is currently not supported for image generation on your API key. Try selecting OpenAI DALL-E 3 or Stable Diffusion 3.5.`;
  }

  if (text.includes("safety") || text.includes("content_filter") || text.includes("blocked")) {
    return "The image prompt was flagged by the safety filter. Please revise your prompt and try again.";
  }

  if (text.includes("api_key") || text.includes("unauthorized") || text.includes("401") || text.includes("403")) {
    return "Invalid or unauthorized GEMINI_API_KEY. Please verify your Gemini API key configuration.";
  }

  try {
    const parsed = JSON.parse(rawText);
    if (parsed.error?.message && typeof parsed.error.message === "string") {
      const cleanMsg = parsed.error.message.split("\n")[0]?.trim();
      if (cleanMsg) return `Gemini image generation error: ${cleanMsg}`;
    }
  } catch {
    // Ignore JSON parse error
  }

  return "Gemini image generation failed. Please check your prompt or select another image model.";
}

class GeminiImagenAdapter implements AIProviderAdapter {
  readonly providerId = "gemini-imagen";
  readonly displayName = "Google Gemini Image Generation";
  readonly capabilities: ProviderCapability[] = ["image-gen"];
  readonly scores = {};
  readonly models = [
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-lite-image",
    "gemini-3-pro-image",
    "gemini-2.5-flash-image",
    "imagen-3.0-generate-002"
  ];

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("GEMINI_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const rawModel = (request.model ?? "gemini-3.1-flash-image").trim().toLowerCase();

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
      "gemini-3.1-flash-image": "gemini-3.1-flash-image",
      "gemini-3.1-flash-lite-image": "gemini-3.1-flash-lite-image",
      "gemini-3-pro-image": "gemini-3-pro-image",
      "gemini-2.5-flash-image": "gemini-2.5-flash-image",
      "nano-banana-2": "gemini-3.1-flash-image",
      "nano-banana-2-lite": "gemini-3.1-flash-lite-image",
      "nano-banana-pro": "gemini-3-pro-image",
      "nano-banana": "gemini-2.5-flash-image",
      "gemini-banana-2": "gemini-3.1-flash-image",
      "gemini-nano": "gemini-2.5-flash-image",
      "gemini-lite": "gemini-3.1-flash-lite-image",
      "gemini-pro": "gemini-3-pro-image"
    };

    const targetModel = modelMap[rawModel] ?? (rawModel.includes("imagen") ? rawModel : "gemini-3.1-flash-image");

    try {
      const prompt = request.imagePrompt ?? "";
      const apiKey = env.GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not configured.");
      }

      // Convert referenceImage to base64 if provided
      let referenceBase64: string | null = null;
      if (request.referenceImage) {
        if (Buffer.isBuffer(request.referenceImage)) {
          referenceBase64 = request.referenceImage.toString("base64");
        } else if (typeof request.referenceImage === "string") {
          referenceBase64 = request.referenceImage.replace(/^data:image\/\w+;base64,/, "");
        } else if (
          typeof request.referenceImage === "object" &&
          request.referenceImage !== null &&
          (request.referenceImage as any).type === "Buffer" &&
          Array.isArray((request.referenceImage as any).data)
        ) {
          referenceBase64 = Buffer.from((request.referenceImage as any).data).toString("base64");
        }
      }

      let base64Bytes: string | null = null;
      let rawErrorText = "";

      // Strategy 1: Multimodal generateContent endpoint
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
        const parts: Array<Record<string, unknown>> = [];
        if (referenceBase64) {
          parts.push({ inlineData: { mimeType: "image/png", data: referenceBase64 } });
        }
        parts.push({ text: prompt || "Generate a high quality image" });

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts }] })
        });

        if (res.ok) {
          const data = await res.json();
          const candidateParts = data.candidates?.[0]?.content?.parts ?? [];
          for (const part of candidateParts) {
            const inline = part.inlineData ?? part.inline_data;
            if (inline?.data) {
              base64Bytes = inline.data;
              break;
            }
          }
        } else {
          rawErrorText = await res.text();
        }
      } catch (err) {
        rawErrorText = err instanceof Error ? err.message : String(err);
      }

      // Strategy 2: AI Studio Imagen 3 generateImages endpoint
      if (!base64Bytes) {
        try {
          const imagenModel = targetModel.includes("imagen") ? targetModel : "imagen-3.0-generate-002";
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${imagenModel}:generateImages?key=${apiKey}`;
          const bodyPayload: Record<string, unknown> = {
            prompt: prompt || "Generate a high quality image",
            numberOfImages: 1,
            outputMimeType: "image/png"
          };
          if (referenceBase64) {
            bodyPayload.referenceImages = [{ imageBytes: referenceBase64 }];
          }

          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyPayload)
          });

          if (res.ok) {
            const data = await res.json();
            base64Bytes =
              data.generatedImages?.[0]?.image?.imageBytes ??
              data.generatedImages?.[0]?.imageBytes ??
              data.images?.[0]?.imageBytes ??
              null;
          } else {
            const errText = await res.text();
            if (!rawErrorText) rawErrorText = errText;
          }
        } catch (err) {
          if (!rawErrorText) rawErrorText = err instanceof Error ? err.message : String(err);
        }
      }

      if (!base64Bytes) {
        const friendlyMessage = sanitizeGeminiErrorMessage(rawErrorText, rawModel);
        throw new Error(friendlyMessage);
      }

      const imageBuffer = Buffer.from(base64Bytes, "base64");
      const mimeType = "image/png";
      const dataUri = `data:${mimeType};base64,${base64Bytes}`;

      return {
        status: "success",
        capability: "image-gen",
        text: null,
        structuredOutput: null,
        imageUrl: dataUri,
        imageBuffer,
        imageMimeType: mimeType,
        revisedPrompt: prompt,
        attachments: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        cost: {
          inputCostUsd: targetModel.includes("lite") ? 0.005 : 0.02,
          outputCostUsd: 0,
          totalCostUsd: targetModel.includes("lite") ? 0.005 : 0.02,
          model: targetModel
        },
        conversationId: null,
        providerMetadata: { model: targetModel, rawModel, provider: "gemini-imagen" },
        providerId: this.providerId,
        modelName: targetModel,
        durationMs: Date.now() - startMs,
        error: null
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
    const model = request.model ?? "gemini-3.1-flash-image";
    const cost = model.includes("lite") ? 0.005 : 0.02;
    return { inputCostUsd: cost, outputCostUsd: 0, totalCostUsd: cost, model };
  }
}

export default new GeminiImagenAdapter();
