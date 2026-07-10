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

class ElevenLabsAdapter implements AIProviderAdapter {
  readonly providerId = "elevenlabs";
  readonly displayName = "ElevenLabs TTS";
  readonly capabilities: ProviderCapability[] = ["tts"];
  readonly scores = {};
  private dynamicModels: string[] | null = null;

  get models(): string[] {
    return this.dynamicModels ?? ["eleven_monolingual_v1", "eleven_multilingual_v2", "eleven_flash_v2_5"];
  }

  updateModelsAndPricing(models: string[]): void {
    this.dynamicModels = models;
  }

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("ELEVENLABS_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? "eleven_flash_v2_5";
    const voiceId = request.voice ?? env.ELEVENLABS_VOICE_SARAH_ID ?? "21m00Tcm4TlvDq8ikWAM";

    try {
      const response = await retryOnTransient(async () => {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": env.ELEVENLABS_API_KEY ?? "",
          },
          body: JSON.stringify({
            text: request.inputText ?? "",
            model_id: model,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`ElevenLabs API returned status ${res.status}: ${text}`);
        }

        return res.arrayBuffer();
      });

      const audioBuffer = Buffer.from(response);

      return {
        status: "success",
        capability: "tts",
        text: null,
        structuredOutput: null,
        audioData: audioBuffer,
        audioMimeType: "audio/mpeg",
        attachments: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        cost: null, // ElevenLabs cost estimation can be added if desired
        conversationId: null,
        providerMetadata: { voiceId, model },
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
        "tts"
      );
    }
  }

  async continueConversation(request: AIContinueRequest): Promise<AIExecuteResponse> {
    return this.execute(request);
  }

  async estimateCost(request: AIExecuteRequest): Promise<CostEstimate> {
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, model: request.model ?? "eleven_flash_v2_5" };
  }
}

export default new ElevenLabsAdapter();
