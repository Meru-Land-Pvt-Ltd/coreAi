import { resolveDeepgramListenLanguage } from "@coreai/shared";
import { getProviderEngine } from "./provider-engine";
import type { AIExecuteResponse } from "./types";

export type DeepgramTranscribeInput = {
  audioBase64: string;
  mimeType?: string;
  model?: string;
  language?: string;
  smartFormat?: boolean;
  punctuate?: boolean;
  diarize?: boolean;
};

export type DeepgramTranscribeResult = {
  status: "success" | "error";
  transcript: string;
  confidence: number | null;
  model: string;
  language: string;
  audioDurationSeconds: number | null;
  error: string | null;
  providerId: string;
};

export type DeepgramSpeakInput = {
  text: string;
  model?: string;
  encoding?: string;
};

export type DeepgramSpeakResult = {
  status: "success" | "error";
  audioBase64: string;
  audioMimeType: string;
  model: string;
  characterCount: number;
  error: string | null;
  providerId: string;
};

function stripDataUri(audioBase64: string): { data: string; mimeType?: string } {
  const trimmed = audioBase64.trim();
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(trimmed);
  if (match) {
    return { data: match[2] ?? "", mimeType: match[1] };
  }
  return { data: trimmed };
}

export async function transcribeWithDeepgram(
  input: DeepgramTranscribeInput
): Promise<DeepgramTranscribeResult> {
  const stripped = stripDataUri(input.audioBase64);
  if (!stripped.data) {
    return {
      status: "error",
      transcript: "",
      confidence: null,
      model: input.model ?? "nova-3",
      language: input.language ?? "en",
      audioDurationSeconds: null,
      error: "No audio data provided.",
      providerId: "deepgram"
    };
  }

  const model = input.model?.trim() || "nova-3";
  const language = resolveDeepgramListenLanguage(model, input.language?.trim() || "en");
  const mimeType = input.mimeType?.trim() || stripped.mimeType || "audio/wav";

  const engine = getProviderEngine();
  const response: AIExecuteResponse = await engine.executeWithProvider("deepgram", {
    capability: "stt",
    model,
    language,
    audioData: stripped.data,
    metadata: {
      mimeType,
      smart_format: input.smartFormat ?? true,
      punctuate: input.punctuate ?? true,
      diarize: input.diarize ?? false
    }
  });

  const meta = (response.providerMetadata ?? {}) as Record<string, unknown>;
  const confidence =
    typeof meta.confidence === "number" ? meta.confidence : null;
  const audioDurationSeconds =
    typeof meta.audioDurationSeconds === "number" ? meta.audioDurationSeconds : null;

  return {
    status: response.status === "success" ? "success" : "error",
    transcript: response.text ?? "",
    confidence,
    model: response.modelName || model,
    language,
    audioDurationSeconds,
    error: response.error,
    providerId: response.providerId || "deepgram"
  };
}

export async function speakWithDeepgram(input: DeepgramSpeakInput): Promise<DeepgramSpeakResult> {
  const text = input.text.trim();
  const model = input.model?.trim() || "aura-2-thalia-en";
  if (!text) {
    return {
      status: "error",
      audioBase64: "",
      audioMimeType: "audio/mpeg",
      model,
      characterCount: 0,
      error: "No text provided for speech synthesis.",
      providerId: "deepgram"
    };
  }

  const engine = getProviderEngine();
  const response: AIExecuteResponse = await engine.executeWithProvider("deepgram", {
    capability: "tts",
    model,
    inputText: text,
    metadata: {
      encoding: input.encoding?.trim() || "mp3"
    }
  });

  let audioBase64 = "";
  const audioMimeType = response.audioMimeType || "audio/mpeg";
  const rawAudio = response.audioData as Buffer | string | null | undefined;
  if (Buffer.isBuffer(rawAudio)) {
    audioBase64 = rawAudio.toString("base64");
  } else if (typeof rawAudio === "string") {
    audioBase64 = rawAudio.includes(";base64,")
      ? (rawAudio.split(";base64,").pop() ?? "")
      : rawAudio;
  }

  return {
    status: response.status === "success" ? "success" : "error",
    audioBase64,
    audioMimeType,
    model: response.modelName || model,
    characterCount: text.length,
    error: response.error,
    providerId: response.providerId || "deepgram"
  };
}
