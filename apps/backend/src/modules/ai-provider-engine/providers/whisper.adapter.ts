import OpenAI, { toFile } from "openai";
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

class WhisperAdapter implements AIProviderAdapter {
  readonly providerId = "whisper";
  readonly displayName = "Whisper";
  readonly capabilities: ProviderCapability[] = ["stt"];
  readonly scores = {};
  readonly models = ["whisper-1"];

  private _client: OpenAI | null = null;
  private get client(): OpenAI {
    if (!this._client) {
      this._client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    }
    return this._client;
  }

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("OPENAI_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? "whisper-1";

    try {
      if (!request.audioData) {
        throw new Error("No audio data provided for transcription.");
      }

      // Resolve audio data (Buffer or Base64 string)
      let audioBuffer: Buffer;
      if (Buffer.isBuffer(request.audioData)) {
        audioBuffer = request.audioData;
      } else {
        const base64Data = request.audioData.includes(";base64,")
          ? request.audioData.split(";base64,").pop() ?? ""
          : request.audioData;
        audioBuffer = Buffer.from(base64Data, "base64");
      }

      // Convert buffer to uploadable File object for OpenAI SDK
      const file = await toFile(audioBuffer, "audio.wav", { type: "audio/wav" });

      const transcription = await retryOnTransient(() =>
        this.client.audio.transcriptions.create({
          file,
          model,
          language: request.language,
        })
      );

      return {
        status: "success",
        capability: "stt",
        text: transcription.text,
        structuredOutput: null,
        attachments: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        cost: {
          inputCostUsd: (audioBuffer.length / (1024 * 1024)) * 0.006, // Estimate based on size/length roughly
          outputCostUsd: 0,
          totalCostUsd: (audioBuffer.length / (1024 * 1024)) * 0.006,
          model,
        },
        conversationId: null,
        providerMetadata: { model, language: request.language },
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
        "stt"
      );
    }
  }

  async continueConversation(request: AIContinueRequest): Promise<AIExecuteResponse> {
    return this.execute(request);
  }

  async estimateCost(request: AIExecuteRequest): Promise<CostEstimate> {
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, model: "whisper-1" };
  }
}

export default new WhisperAdapter();
