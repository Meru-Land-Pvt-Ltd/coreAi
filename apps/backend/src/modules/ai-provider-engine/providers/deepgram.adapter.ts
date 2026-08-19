/**
 * Deepgram Speech Adapter (STT + TTS)
 *
 * Capabilities : "stt" | "tts"
 * STT API      : https://api.deepgram.com/v1/listen
 * TTS API      : https://api.deepgram.com/v1/speak  (Aura / Aura-2)
 * Auth         : Authorization: Token <DEEPGRAM_API_KEY>
 */

import { env } from "../../../config/env";
import {
  DEEPGRAM_STT_MODELS,
  DEEPGRAM_TTS_VOICES,
  resolveDeepgramListenLanguage
} from "@coreai/shared";
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
  "flux-general-en": 0.0077,
  "flux-general-multi": 0.0077,
  "nova-3": 0.0059,
  "nova-3-general": 0.0059,
  "nova-3-medical": 0.0059,
  "nova-2": 0.0043,
  "nova-2-general": 0.0043,
  "nova-2-meeting": 0.0043,
  "nova-2-phonecall": 0.0043,
  "nova-2-medical": 0.0043,
  "nova-2-finance": 0.0043,
  "nova-2-conversationalai": 0.0043,
  "nova-2-voicemail": 0.0043,
  "nova-2-video": 0.0043,
  "nova-2-drivethru": 0.0043,
  "nova-2-automotive": 0.0043,
  "nova-2-atc": 0.0043,
  nova: 0.0043,
  "nova-general": 0.0043,
  "nova-phonecall": 0.0043,
  "nova-medical": 0.0043,
  enhanced: 0.0043,
  "enhanced-general": 0.0043,
  "enhanced-meeting": 0.0043,
  "enhanced-phonecall": 0.0043,
  "enhanced-finance": 0.0043,
  base: 0.0025,
  "base-general": 0.0025,
  "base-meeting": 0.0025,
  "base-phonecall": 0.0025,
  "base-finance": 0.0025,
  "base-conversationalai": 0.0025,
  "base-voicemail": 0.0025,
  "base-video": 0.0025,
  whisper: 0.0048,
  "whisper-tiny": 0.0048,
  "whisper-base": 0.0048,
  "whisper-small": 0.0048,
  "whisper-medium": 0.0048,
  "whisper-large": 0.0048
};

const DEFAULT_MODEL = "nova-3";
const DEFAULT_TTS_MODEL = "aura-2-thalia-en";
const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_SPEAK_URL = "https://api.deepgram.com/v1/speak";
const BYTES_PER_SECOND = 32_000;
const TTS_PRICE_PER_1K_CHARS_USD = 0.015;

function toAudioBuffer(audioData: Buffer | string): Buffer {
  if (Buffer.isBuffer(audioData)) return audioData;

  const base64 = audioData.includes(";base64,")
    ? (audioData.split(";base64,").pop() ?? "")
    : audioData;

  return Buffer.from(base64, "base64");
}

function estimateAudioSeconds(audioBuffer: Buffer): number {
  return audioBuffer.length / BYTES_PER_SECOND;
}

export function buildQueryString(
  model: string,
  language: string | undefined,
  meta: Record<string, unknown>
): string {
  const params: Record<string, string> = {
    model,
    smart_format: "true",
    mip_opt_out: "true",
  };

  const resolvedLanguage = resolveDeepgramListenLanguage(model, language);
  if (resolvedLanguage) {
    params["language"] = resolvedLanguage;
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
  readonly displayName = "Deepgram Speech";
  readonly capabilities: ProviderCapability[] = ["stt", "tts"];
  readonly scores = {};

  readonly models: string[] = [
    ...DEEPGRAM_STT_MODELS,
    ...DEEPGRAM_TTS_VOICES
  ];

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("DEEPGRAM_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    if (request.capability === "tts") {
      return this.executeTts(request);
    }
    return this.executeStt(request);
  }

  private async executeStt(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? DEFAULT_MODEL;
    const meta = (request.metadata ?? {}) as Record<string, unknown>;

    try {
      if (!request.audioData) {
        throw new Error("No audioData provided. Pass Buffer or base64 audio for STT.");
      }

      const apiKey = env.DEEPGRAM_API_KEY?.trim();
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

  private async executeTts(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    const model = request.model ?? request.voice ?? DEFAULT_TTS_MODEL;
    const text = (request.inputText ?? "").trim();

    try {
      if (!text) {
        throw new Error("No inputText provided for Deepgram TTS.");
      }

      const apiKey = env.DEEPGRAM_API_KEY?.trim();
      if (!apiKey) {
        throw new Error("DEEPGRAM_API_KEY is not set.");
      }

      const meta = (request.metadata ?? {}) as Record<string, unknown>;
      const encoding =
        typeof meta["encoding"] === "string" ? meta["encoding"] : "mp3";
      const params = new URLSearchParams({
        model,
        encoding,
        mip_opt_out: "true",
      });
      const url = `${DEEPGRAM_SPEAK_URL}?${params.toString()}`;

      const audioBuffer = await retryOnTransient(async () => {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`Deepgram TTS API error ${res.status}: ${errText}`);
        }

        return Buffer.from(await res.arrayBuffer());
      });

      const mimeType =
        encoding === "linear16" || encoding === "wav"
          ? "audio/wav"
          : encoding === "opus"
            ? "audio/ogg"
            : "audio/mpeg";
      const totalCostUsd = (text.length / 1000) * TTS_PRICE_PER_1K_CHARS_USD;

      return {
        status: "success",
        capability: "tts",
        text: null,
        structuredOutput: null,
        audioData: audioBuffer,
        audioMimeType: mimeType,
        attachments: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        cost: {
          inputCostUsd: totalCostUsd,
          outputCostUsd: 0,
          totalCostUsd,
          model,
        },
        conversationId: null,
        providerMetadata: {
          model,
          characterCount: text.length,
          encoding,
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
        "tts"
      );
    }
  }

  // STT/TTS are stateless; re-run execute
  async continueConversation(request: AIContinueRequest): Promise<AIExecuteResponse> {
    return this.execute(request);
  }

  async estimateCost(request: AIExecuteRequest): Promise<CostEstimate> {
    if (request.capability === "tts") {
      const model = request.model ?? request.voice ?? DEFAULT_TTS_MODEL;
      const chars = (request.inputText ?? "").length || 100;
      const totalCostUsd = (chars / 1000) * TTS_PRICE_PER_1K_CHARS_USD;
      return { inputCostUsd: totalCostUsd, outputCostUsd: 0, totalCostUsd, model };
    }

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
