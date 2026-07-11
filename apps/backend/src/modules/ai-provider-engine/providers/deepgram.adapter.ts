/**
 * Deepgram Speech-to-Text Adapter
 *
 * Capability : "stt"
 * Models     : nova-3 (default), nova-2, nova-2-general, nova-2-meeting,
 *              nova-2-phonecall, nova-2-medical, enhanced, base
 * API        : https://api.deepgram.com/v1/listen  (pre-recorded, multipart/octet-stream)
 * Auth       : Authorization: Token <DEEPGRAM_API_KEY>
 *
 * Pricing (as of 2025-07) – charged per second of audio, not per token.
 *   nova-3          : $0.0059 / min
 *   nova-2-general  : $0.0043 / min
 *   base            : $0.0025 / min
 *
 * How to enable:
 *   Add DEEPGRAM_API_KEY=<your-key> to your .env file.
 *   The ProviderRegistry auto-discovers this file via the *.adapter.ts glob —
 *   no other code changes are needed.
 *
 * Supported AIExecuteRequest fields (capability = "stt"):
 *   audioData  – Buffer or base64 string (with or without data URI prefix)
 *   model      – Deepgram model ID (default: nova-3)
 *   language   – BCP-47 language tag, e.g. "en", "es", "fr" (optional)
 *   metadata   – { smart_format?: boolean; diarize?: boolean; punctuate?: boolean;
 *                  utterances?: boolean; paragraphs?: boolean; filler_words?: boolean;
 *                  mimeType?: string; }
 */

import type {
  AIProviderAdapter,
  AIExecuteRequest,
  AIContinueRequest,
  AIExecuteResponse,
  CostEstimate,
  ValidationResult,
  ProviderCapability,
  ModelInfo,
} from "../types";
import { checkEnvKey, retryOnTransient, errorResponse } from "./base-adapter";

const PRICE_PER_MIN_USD: Record<string, number> = {
  "nova-3": 0.0059,
  "nova-3-general": 0.0059,
  "nova-3-medical": 0.0059,
  "nova-3-phonecall": 0.0059,
  "nova-2": 0.0043,
  "nova-2-general": 0.0043,
  "nova-2-meeting": 0.0043,
  "nova-2-phonecall": 0.0043,
  "nova-2-medical": 0.0043,
  "nova-2-finance": 0.0043,
  "nova-2-conversationalai": 0.0043,
  enhanced: 0.0043,
  base: 0.0025,
};

const DEFAULT_MODEL = "nova-3";
const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";
const BYTES_PER_SECOND = 32_000;

/** Resolve audioData to a Buffer regardless of input type. */
function toAudioBuffer(audioData: Buffer | string): Buffer {
  if (Buffer.isBuffer(audioData)) return audioData;

  const base64 = audioData.includes(";base64,")
    ? (audioData.split(";base64,").pop() ?? "")
    : audioData;

  return Buffer.from(base64, "base64");
}

/** Estimate audio duration in seconds from buffer size. */
function estimateAudioSeconds(audioBuffer: Buffer): number {
  return audioBuffer.length / BYTES_PER_SECOND;
}

/** Build the query-string for the Deepgram Listen endpoint. */
function buildQueryString(
  model: string,
  language: string | undefined,
  meta: Record<string, unknown>
): string {
  const params: Record<string, string> = {
    model,
    smart_format: "true",
  };

  if (language) {
    params["language"] = language;
  }

  const boolFlags = [
    "smart_format",
    "diarize",
    "punctuate",
    "utterances",
    "paragraphs",
    "filler_words",
  ] as const;

  for (const flag of boolFlags) {
    if (flag in meta) {
      params[flag] = String(Boolean(meta[flag]));
    }
  }

  return new URLSearchParams(params).toString();
}

interface DeepgramListenResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        words?: Array<{
          word: string;
          start: number;
          end: number;
          confidence: number;
        }>;
      }>;
    }>;
  };
  metadata?: {
    model_uuid?: string;
    model_info?: { name?: string; version?: string };
    duration?: number; // seconds
  };
  error?: string;
  message?: string;
}

class DeepgramAdapter implements AIProviderAdapter {
  readonly providerId = "deepgram";
  readonly displayName = "Deepgram STT";
  readonly capabilities: ProviderCapability[] = ["stt"];
  readonly scores = {};

  readonly models: string[] = [
    "nova-3",
    "nova-3-general",
    "nova-3-medical",
    "nova-3-phonecall",
    "nova-2",
    "nova-2-general",
    "nova-2-meeting",
    "nova-2-phonecall",
    "nova-2-medical",
    "enhanced",
    "base",
  ];

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("DEEPGRAM_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? DEFAULT_MODEL;
    const meta = (request.metadata ?? {}) as Record<string, unknown>;

    try {
      if (!request.audioData) {
        throw new Error("No audioData provided. Pass Buffer or base64 audio for STT.");
      }

      const apiKey = process.env["DEEPGRAM_API_KEY"]?.trim();
      if (!apiKey) {
        throw new Error("DEEPGRAM_API_KEY is not set.");
      }

      const audioBuffer = toAudioBuffer(request.audioData);
      const mimeType =
        typeof meta["mimeType"] === "string" ? meta["mimeType"] : "audio/wav";

      const qs = buildQueryString(model, request.language, meta);
      const url = `${DEEPGRAM_LISTEN_URL}?${qs}`;

      const rawResponse = await retryOnTransient(async () => {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": mimeType,
          },
          body: new Uint8Array(audioBuffer),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`Deepgram API error ${res.status}: ${errText}`);
        }

        return res.json() as Promise<DeepgramListenResponse>;
      });

      const alternative = rawResponse.results?.channels?.[0]?.alternatives?.[0];
      const transcript = alternative?.transcript ?? "";
      const confidence = alternative?.confidence ?? null;
      const words = alternative?.words ?? [];

      const audioDurationSeconds =
        typeof rawResponse.metadata?.duration === "number"
          ? rawResponse.metadata.duration
          : estimateAudioSeconds(audioBuffer);

      const audioMinutes = audioDurationSeconds / 60;
      const pricePerMin = PRICE_PER_MIN_USD[model] ?? PRICE_PER_MIN_USD[DEFAULT_MODEL]!;
      const totalCostUsd = audioMinutes * pricePerMin;

      return {
        status: "success",
        capability: "stt",
        text: transcript,
        structuredOutput: null,
        attachments: [],
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        cost: {
          inputCostUsd: totalCostUsd,
          outputCostUsd: 0,
          totalCostUsd,
          model,
        },
        conversationId: null,
        providerMetadata: {
          model,
          language: request.language ?? "auto",
          confidence,
          wordCount: words.length,
          audioDurationSeconds,
          deepgramModelUuid: rawResponse.metadata?.model_uuid,
          deepgramModelVersion: rawResponse.metadata?.model_info?.version,
        },
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

  // STT is stateless; just re-transcribe
  async continueConversation(request: AIContinueRequest): Promise<AIExecuteResponse> {
    return this.execute(request);
  }

  async estimateCost(request: AIExecuteRequest): Promise<CostEstimate> {
    const model = request.model ?? DEFAULT_MODEL;
    const pricePerMin = PRICE_PER_MIN_USD[model] ?? PRICE_PER_MIN_USD[DEFAULT_MODEL]!;

    let audioMinutes = 1;
    if (request.audioData) {
      try {
        const buf = toAudioBuffer(request.audioData);
        audioMinutes = estimateAudioSeconds(buf) / 60;
      } catch {
        // Keep default fallback
      }
    }

    const totalCostUsd = audioMinutes * pricePerMin;
    return { inputCostUsd: totalCostUsd, outputCostUsd: 0, totalCostUsd, model };
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models.map((modelId) => ({
      modelId,
      displayName: `Deepgram ${modelId}`,
      providerId: this.providerId,
      inputPricePerMToken: 0,
      outputPricePerMToken: 0,
      isDeprecated: false,
      source: "static" as const,
    }));
  }
}

export default new DeepgramAdapter();
