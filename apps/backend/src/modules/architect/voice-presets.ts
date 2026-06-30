import { VOICE_PRESETS, type AgentVoicePreset } from "@coreai/shared";
import { env } from "../../config/env";

/**
 * Backend voice resolution + preview. Vapi is the live voice platform; ElevenLabs
 * is the voice provider inside Vapi. The platform owns this integration — buyers
 * never connect ElevenLabs. Architects pick a friendly preset (no raw ids); this
 * module resolves the actual ElevenLabs voice id (with optional env overrides).
 */

/** Per-preset env override of the ElevenLabs voice id (e.g. ELEVENLABS_VOICE_SARAH_ID). */
const ENV_VOICE_OVERRIDES: Record<string, string | undefined> = {
  sarah: env.ELEVENLABS_VOICE_SARAH_ID,
  aria: env.ELEVENLABS_VOICE_ARIA_ID,
  rachel: env.ELEVENLABS_VOICE_RACHEL_ID,
  adam: env.ELEVENLABS_VOICE_ADAM_ID,
  priya: env.ELEVENLABS_VOICE_PRIYA_ID
};

type ErrorStatus = 400 | 401 | 402 | 403 | 404 | 409 | 422 | 500 | 503;

/** Error that carries an HTTP status so the route + frontend can show the real cause. */
export class VoicePreviewError extends Error {
  status: ErrorStatus;
  constructor(message: string, status: ErrorStatus = 503) {
    super(message);
    this.name = "VoicePreviewError";
    this.status = status;
  }
}

/** Last 4 chars of an id for safe logging — never log the full id or the API key. */
function last4(value: string): string {
  const v = (value ?? "").trim();
  return v.length >= 4 ? v.slice(-4) : v || "—";
}

/** Map an ElevenLabs HTTP status onto an allowed API error status. */
function toApiStatus(status: number): ErrorStatus {
  return status === 401 || status === 402 || status === 403 || status === 404 || status === 422
    ? status
    : 503;
}

/** Pull a human message out of an ElevenLabs error body (detail.message | detail | raw). */
function parseElevenLabsMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { detail?: unknown };
    const detail = parsed.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
      return (detail as { message: string }).message;
    }
  } catch {
    /* not JSON — fall through */
  }
  return bodyText.slice(0, 200) || "Unknown ElevenLabs error.";
}

/** True only when a real (non-placeholder) ElevenLabs API key is configured. */
export function isVoicePreviewConfigured(): boolean {
  const key = env.ELEVENLABS_API_KEY;
  return Boolean(key && !key.includes("your_") && !key.includes("xxx"));
}

/**
 * Resolve a preset id to an ElevenLabs voice id:
 *   env override → shared preset default → VAPI_DEFAULT_VOICE_ID → "".
 */
export function resolvePresetVoiceId(presetId?: string | null): string {
  const id = (presetId ?? "").trim().toLowerCase();
  const override = (ENV_VOICE_OVERRIDES[id] ?? "").trim();
  if (override) return override;
  const preset = VOICE_PRESETS.find((item) => item.id === id);
  if (preset?.voiceId) return preset.voiceId;
  return (env.VAPI_DEFAULT_VOICE_ID ?? "").trim();
}

export type VoicePresetView = AgentVoicePreset & {
  /** Env-merged voice id actually used for deploy/preview. */
  resolvedVoiceId: string;
  /** Whether this voice can be previewed right now (key + a resolvable id). */
  previewAvailable: boolean;
};

/** The preset catalog with env-merged ids — served to the architect + buyer UIs. */
export function listVoicePresets(): { voices: VoicePresetView[]; previewConfigured: boolean } {
  const previewConfigured = isVoicePreviewConfigured();
  const voices = VOICE_PRESETS.map((preset) => {
    const resolvedVoiceId = resolvePresetVoiceId(preset.id);
    return {
      ...preset,
      resolvedVoiceId,
      previewAvailable: previewConfigured && Boolean(resolvedVoiceId)
    };
  });
  return { voices, previewConfigured };
}

/** Safe, secret-free diagnostics for GET /architect/voices/debug. No full ids, no key. */
export function voicePreviewDiagnostics() {
  const previewConfigured = isVoicePreviewConfigured();
  const defaultVoiceConfigured = Boolean((env.VAPI_DEFAULT_VOICE_ID ?? "").trim());
  const presets = VOICE_PRESETS.map((preset) => {
    const override = (ENV_VOICE_OVERRIDES[preset.id] ?? "").trim();
    const resolved = resolvePresetVoiceId(preset.id);
    return {
      id: preset.id,
      name: preset.name,
      hasVoiceId: Boolean(preset.voiceId) || Boolean(override),
      resolvedLast4: resolved ? last4(resolved) : null,
      previewAvailable: previewConfigured && Boolean(resolved)
    };
  });
  return { previewConfigured, defaultVoiceConfigured, presets };
}

const PREVIEW_TEXT_MAX = 300;

/**
 * Generate a short TTS preview via ElevenLabs. Resolves the voice id from an
 * explicit custom id or a preset id, then returns base64 audio (never the key).
 * On any failure it throws a VoicePreviewError that carries the real status +
 * ElevenLabs message so the UI can show the actual cause (e.g. 402 paid plan).
 */
export async function generateVoicePreview(input: {
  presetId?: string | null;
  voiceId?: string | null;
  text?: string | null;
}): Promise<{ audioBase64: string; mimeType: string }> {
  const configured = isVoicePreviewConfigured();
  const explicit = (input.voiceId ?? "").trim();
  const requestType = explicit ? "custom" : "preset";
  const requested = explicit || (input.presetId ?? "");
  const voiceId = explicit || resolvePresetVoiceId(input.presetId);

  // Safe diagnostics — never the full id or the API key.
  console.log(
    `[voice-preview] configured=${configured} type=${requestType} requested=…${last4(requested)} resolved=…${last4(voiceId)}`
  );

  if (!configured) {
    throw new VoicePreviewError("Voice preview is not configured. Add ELEVENLABS_API_KEY.", 503);
  }
  if (!voiceId) {
    throw new VoicePreviewError("No voice id resolved. Pick a preset or enter a custom ElevenLabs voice ID.", 422);
  }

  const text = ((input.text ?? "").trim() || "Hello, this is a voice preview from CoreAI.").slice(0, PREVIEW_TEXT_MAX);

  let response: Response;
  try {
    response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
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
          voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true }
        })
      }
    );
  } catch (error) {
    console.error(`[voice-preview] network error: ${error instanceof Error ? error.message : "unknown"}`);
    throw new VoicePreviewError("Voice preview could not reach ElevenLabs.", 503);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[voice-preview] elevenlabs status=${response.status} body=${body.slice(0, 300)}`);
    const message = parseElevenLabsMessage(body);
    throw new VoicePreviewError(`ElevenLabs ${response.status}: ${message}`, toApiStatus(response.status));
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBase64 = Buffer.from(arrayBuffer).toString("base64");
  console.log(`[voice-preview] elevenlabs status=${response.status} bytes=${arrayBuffer.byteLength}`);

  if (audioBase64.length <= 100) {
    throw new VoicePreviewError("ElevenLabs returned no audio for this voice.", 503);
  }

  return { audioBase64, mimeType: "audio/mpeg" };
}
