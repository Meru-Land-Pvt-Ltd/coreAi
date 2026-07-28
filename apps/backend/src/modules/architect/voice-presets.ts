import { VOICE_PRESETS, type AgentVoicePreset } from "@coreai/shared";
import { env } from "../../config/env";
import { elevenLabsTtsQuery } from "../compliance/elevenlabs-params";

export const PLATFORM_DEFAULT_VOICE_ID = "triven-default";
export const FALLBACK_ELEVENLABS_VOICE_ID = "FD17pMswbbEnsVYS0L7P";

const TRIVEN_DEFAULT_VOICE_PRESET = {
  id: PLATFORM_DEFAULT_VOICE_ID,
  name: "Triven Voice",
  voiceId: "",
  style: "Default",
  bestFor: "All business agents",
  description: "Production default voice from ELEVENLABS_DEFAULT_VOICE_ID.",
  previewText: "Hello, this is Triven Voice. How can I help you today?"
} as AgentVoicePreset;

function clean(value?: string | null): string {
  return (value ?? "").trim();
}

function isDefaultVoicePreset(preset: AgentVoicePreset): boolean {
  const id = clean(preset.id).toLowerCase();
  const name = clean(preset.name).toLowerCase();

  return (
    id === PLATFORM_DEFAULT_VOICE_ID ||
    id === "default" ||
    name.includes("triven voice") ||
    name.includes("triven default")
  );
}

function allVoicePresets(): AgentVoicePreset[] {
  const rest = VOICE_PRESETS.filter((preset) => !isDefaultVoicePreset(preset));
  return [TRIVEN_DEFAULT_VOICE_PRESET, ...rest];
}

const ENV_VOICE_OVERRIDES: Record<string, string | undefined> = {
  [PLATFORM_DEFAULT_VOICE_ID]: env.ELEVENLABS_DEFAULT_VOICE_ID || env.VAPI_DEFAULT_VOICE_ID,
  default: env.ELEVENLABS_DEFAULT_VOICE_ID || env.VAPI_DEFAULT_VOICE_ID,
  skylar: env.CARTESIA_VOICE_SKYLAR_ID,
  ella: env.CARTESIA_VOICE_ELLA_ID,
  ronald: env.CARTESIA_VOICE_RONALD_ID
};

/** Which TTS provider a preset id belongs to. */
export function voiceProviderForPreset(presetId?: string | null): "11labs" | "cartesia" {
  const id = clean(presetId).toLowerCase();
  const preset = VOICE_PRESETS.find((entry) => entry.id === id);
  return preset?.provider === "cartesia" ? "cartesia" : "11labs";
}

/** Cartesia voice ids are UUIDs; ElevenLabs ids are opaque 20-char strings. */
function looksLikeCartesiaVoiceId(value?: string | null): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean(value));
}

type ErrorStatus = 400 | 401 | 402 | 403 | 404 | 409 | 422 | 500 | 503;

export class VoicePreviewError extends Error {
  status: ErrorStatus;

  constructor(message: string, status: ErrorStatus = 503) {
    super(message);
    this.name = "VoicePreviewError";
    this.status = status;
  }
}

function last4(value?: string | null): string {
  const v = clean(value);
  return v.length >= 4 ? v.slice(-4) : v || "—";
}

function isPlaceholder(value?: string | null): boolean {
  const v = clean(value).toLowerCase();
  return !v || v.includes("your_") || v.includes("xxx") || v.includes("placeholder");
}

function looksLikeElevenLabsVoiceId(value?: string | null): boolean {
  const v = clean(value);
  return v.length >= 18 && !/\s/.test(v);
}

function toApiStatus(status: number): ErrorStatus {
  return status === 400 ||
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 404 ||
    status === 409 ||
    status === 422 ||
    status === 500
    ? status
    : 503;
}

function parseElevenLabsMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };

    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;

    const detail = parsed.detail;

    if (typeof detail === "string") return detail;

    if (
      detail &&
      typeof detail === "object" &&
      typeof (detail as { message?: unknown }).message === "string"
    ) {
      return (detail as { message: string }).message;
    }
  } catch {
    // Non-JSON ElevenLabs response.
  }

  return bodyText.slice(0, 200) || "Unknown ElevenLabs error.";
}

export function isVoicePreviewConfigured(): boolean {
  return !isPlaceholder(env.ELEVENLABS_API_KEY);
}

export function defaultElevenLabsVoiceId(): string {
  return (
    clean(env.ELEVENLABS_DEFAULT_VOICE_ID) ||
    clean(env.VAPI_DEFAULT_VOICE_ID) ||
    FALLBACK_ELEVENLABS_VOICE_ID
  );
}

export function isKnownVoicePresetId(presetId?: string | null): boolean {
  const id = clean(presetId).toLowerCase();

  if (!id || id === "custom" || looksLikeElevenLabsVoiceId(id)) return false;
  if (id === PLATFORM_DEFAULT_VOICE_ID || id === "default") return true;
  if (id in ENV_VOICE_OVERRIDES) return true;

  return allVoicePresets().some((preset) => clean(preset.id).toLowerCase() === id);
}

const FALLBACK_PUBLIC_VOICE_IDS: Record<string, string> = {};

export function resolvePresetVoiceId(presetId?: string | null): string {
  const id = clean(presetId).toLowerCase();

  if (looksLikeCartesiaVoiceId(id) || looksLikeElevenLabsVoiceId(id)) {
    return id;
  }

  if (!id || id === "default" || id === PLATFORM_DEFAULT_VOICE_ID) {
    return defaultElevenLabsVoiceId();
  }

  const envOverride = clean(ENV_VOICE_OVERRIDES[id]);
  if (envOverride && (looksLikeCartesiaVoiceId(envOverride) || looksLikeElevenLabsVoiceId(envOverride))) {
    return envOverride;
  }

  const fallbackPublicId = FALLBACK_PUBLIC_VOICE_IDS[id];
  if (fallbackPublicId) {
    return fallbackPublicId;
  }

  const preset = allVoicePresets().find((item) => clean(item.id).toLowerCase() === id);
  const presetVoiceId = clean(preset?.voiceId);

  if (presetVoiceId) {
    return presetVoiceId;
  }

  return defaultElevenLabsVoiceId();
}

export type VoicePresetView = AgentVoicePreset & {
  resolvedVoiceId: string;
  resolvedLast4: string | null;
  hasOwnVoiceId: boolean;
  previewAvailable: boolean;
};

export function listVoicePresets(): {
  voices: VoicePresetView[];
  previewConfigured: boolean;
} {
  const previewConfigured = isVoicePreviewConfigured();

  const voices = allVoicePresets().map((preset) => {
    const presetId = clean(preset.id).toLowerCase();
    const envOverride = clean(ENV_VOICE_OVERRIDES[presetId]);
    const presetVoiceId = clean(preset.voiceId);
    const resolvedVoiceId = resolvePresetVoiceId(preset.id);
    const isDefault = isDefaultVoicePreset(preset);

    return {
      ...preset,
      name: isDefault ? "Triven Voice" : preset.name,
      resolvedVoiceId,
      resolvedLast4: resolvedVoiceId ? last4(resolvedVoiceId) : null,
      hasOwnVoiceId: Boolean(isDefault || envOverride || presetVoiceId),
      previewAvailable: previewConfigured && Boolean(resolvedVoiceId)
    };
  });

  return {
    voices,
    previewConfigured
  };
}

export function voicePreviewDiagnostics() {
  const previewConfigured = isVoicePreviewConfigured();

  const defaultVoiceConfigured = Boolean(
    clean(env.ELEVENLABS_DEFAULT_VOICE_ID) || clean(env.VAPI_DEFAULT_VOICE_ID)
  );

  const presets = allVoicePresets().map((preset) => {
    const presetId = clean(preset.id).toLowerCase();
    const envOverride = clean(ENV_VOICE_OVERRIDES[presetId]);
    const presetVoiceId = clean(preset.voiceId);
    const resolved = resolvePresetVoiceId(preset.id);
    const isDefault = isDefaultVoicePreset(preset);

    return {
      id: preset.id,
      name: isDefault ? "Triven Voice" : preset.name,
      isDefault,
      hasVoiceId: Boolean(resolved),
      hasOwnVoiceId: Boolean(isDefault || envOverride || presetVoiceId),
      hasEnvOverride: Boolean(envOverride),
      resolvedLast4: resolved ? last4(resolved) : null,
      previewAvailable: previewConfigured && Boolean(resolved)
    };
  });

  return {
    previewConfigured,
    defaultVoiceConfigured,
    defaultVoiceLast4: last4(defaultElevenLabsVoiceId()),
    presets
  };
}

const PREVIEW_TEXT_MAX = 300;

async function generateCartesiaPreview(
  voiceId: string,
  text: string
): Promise<{ audioBase64: string; mimeType: string }> {
  let response: Response;

  try {
    response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": env.CARTESIA_API_KEY as string,
        "Cartesia-Version": env.CARTESIA_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model_id: env.CARTESIA_TTS_MODEL,
        transcript: text,
        voice: { mode: "id", id: voiceId },
        output_format: { container: "mp3", encoding: "mp3", sample_rate: 44100 },
        language: "en"
      })
    });
  } catch {
    throw new VoicePreviewError("Could not reach Cartesia for the voice preview.", 503);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new VoicePreviewError(
      `Cartesia refused the preview (${response.status}). ${detail.slice(0, 160)}`.trim(),
      toApiStatus(response.status)
    );
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return { audioBase64: audio.toString("base64"), mimeType: "audio/mpeg" };
}

export async function generateVoicePreview(input: {
  presetId?: string | null;
  voiceId?: string | null;
  text?: string | null;
}): Promise<{ audioBase64: string; mimeType: string }> {
  const configured = isVoicePreviewConfigured();

  const explicitVoiceId = clean(input.voiceId);
  const requestType = explicitVoiceId ? "custom" : "preset";
  const requested = explicitVoiceId || clean(input.presetId);
  const voiceId = explicitVoiceId || resolvePresetVoiceId(input.presetId);

  console.log(
    `[voice-preview] configured=${configured} type=${requestType} requested=…${last4(
      requested
    )} resolved=…${last4(voiceId)}`
  );

  if (!voiceId) {
    throw new VoicePreviewError(
      "No voice id resolved. Pick a preset or enter a custom voice ID.",
      422
    );
  }

  const text = (clean(input.text) || "Hello, this is Triven Voice. How can I help you today?").slice(
    0,
    PREVIEW_TEXT_MAX
  );

  const usesCartesia =
    voiceProviderForPreset(input.presetId) === "cartesia" || looksLikeCartesiaVoiceId(voiceId);

  if (usesCartesia) {
    if (!clean(env.CARTESIA_API_KEY)) {
      throw new VoicePreviewError("Voice preview is not configured. Add CARTESIA_API_KEY.", 503);
    }
    return generateCartesiaPreview(voiceId, text);
  }

  if (!configured) {
    throw new VoicePreviewError("Voice preview is not configured. Add ELEVENLABS_API_KEY.", 503);
  }

  let response: Response;

  try {
    response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
        voiceId
      )}?${elevenLabsTtsQuery({ output_format: "mp3_44100_128" })}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY as string,
          "Content-Type": "application/json",
          Accept: "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.65,
            similarity_boost: 0.75,
            use_speaker_boost: false
          }
        })
      }
    );
  } catch (error) {
    console.error(
      `[voice-preview] network error: ${error instanceof Error ? error.message : "unknown"}`
    );

    throw new VoicePreviewError("Voice preview could not reach ElevenLabs.", 503);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");

    console.error(
      `[voice-preview] elevenlabs status=${response.status} body=${body.slice(0, 300)}`
    );

    const message = parseElevenLabsMessage(body);

    throw new VoicePreviewError(
      `ElevenLabs ${response.status}: ${message}`,
      toApiStatus(response.status)
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBase64 = Buffer.from(arrayBuffer).toString("base64");

  console.log(`[voice-preview] elevenlabs status=${response.status} bytes=${arrayBuffer.byteLength}`);

  if (audioBase64.length <= 100) {
    throw new VoicePreviewError("ElevenLabs returned no audio for this voice.", 503);
  }

  return {
    audioBase64,
    mimeType: "audio/mpeg"
  };
}