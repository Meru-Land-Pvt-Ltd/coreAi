"use client";

import { useRef, useState } from "react";
import { VOICE_PRESETS } from "@coreai/shared";
import { getVoiceSamplePreview } from "@/components/business/features/api";
import { FIELD } from "./ui";

/**
 * Agent Identity section of the Configure step: the agent's name, voice (with
 * a real audio preview), conversation tone, and a live greeting preview that
 * updates as the buyer types.
 */

const PLATFORM_DEFAULT_VOICE_ID = "triven-default";
const DEFAULT_ASSISTANT_NAME = "AI Assistant";

const VOICE_OPTIONS = VOICE_PRESETS.map((preset) => ({
  value: preset.id,
  label: `${preset.name} — ${preset.style}`
}));

const TONES: { value: string; label: string; emoji: string }[] = [
  { value: "friendly", label: "Friendly", emoji: "😊" },
  { value: "professional", label: "Professional", emoji: "👔" },
  { value: "casual", label: "Casual", emoji: "🤙" }
];

function normalizeVoiceChoice(value?: string | null): string {
  const voice = (value ?? "").trim().toLowerCase();
  if (!voice || voice === "default" || voice === "agent-default" || voice === "use-agent-default") {
    return PLATFORM_DEFAULT_VOICE_ID;
  }
  return voice;
}

export function AgentIdentitySection({
  showVoice,
  assistantName,
  businessName,
  voiceChoice,
  customVoiceId,
  tone,
  onAssistantName,
  onVoiceChoice,
  onCustomVoiceId,
  onTone
}: {
  showVoice: boolean;
  assistantName: string;
  businessName: string;
  voiceChoice: string;
  customVoiceId: string;
  tone: string;
  onAssistantName: (v: string) => void;
  onVoiceChoice: (v: string) => void;
  onCustomVoiceId: (v: string) => void;
  onTone: (v: string) => void;
}) {
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [voicePreviewError, setVoicePreviewError] = useState("");
  // data: URLs of already-generated samples, keyed by voice choice.
  const voiceAudioCacheRef = useRef<Map<string, string>>(new Map());

  async function handleVoicePlay() {
    if (voicePlaying) return;
    setVoicePreviewError("");

    const isCustom = voiceChoice === "custom";
    if (isCustom && !customVoiceId.trim()) {
      setVoicePreviewError("Enter your custom voice ID first.");
      return;
    }
    const cacheKey = isCustom ? `custom:${customVoiceId.trim()}` : voiceChoice;
    setVoicePlaying(true);

    try {
      let src = voiceAudioCacheRef.current.get(cacheKey);
      if (!src) {
        const preset = VOICE_PRESETS.find((entry) => entry.id === voiceChoice);
        const res = await getVoiceSamplePreview({
          presetId: isCustom ? undefined : voiceChoice,
          voiceId: isCustom ? customVoiceId.trim() : undefined,
          text: preset?.previewText
        });
        if (!res.success || !res.data?.audioBase64) {
          // Provider errors can name internal vendors — buyers get neutral copy.
          throw new Error("Voice preview is unavailable right now. Please try again shortly.");
        }
        src = `data:${res.data.mimeType || "audio/mpeg"};base64,${res.data.audioBase64}`;
        voiceAudioCacheRef.current.set(cacheKey, src);
      }

      const audio = new Audio(src);
      audio.onended = () => setVoicePlaying(false);
      audio.onerror = () => setVoicePlaying(false);
      await audio.play();
    } catch (error) {
      setVoicePlaying(false);
      setVoicePreviewError(
        error instanceof Error ? error.message : "Voice preview is unavailable right now."
      );
    }
  }

  return (
    <div>
      {showVoice ? (
        <div>
          <label htmlFor="agent-name" className="block text-sm font-medium text-slate-700 mb-2">Name your agent</label>
          <input
            id="agent-name"
            data-testid="business-setup-input-assistant-name"
            type="text"
            value={assistantName}
            onChange={(e) => onAssistantName(e.target.value)}
            placeholder={DEFAULT_ASSISTANT_NAME}
            className={FIELD}
          />
        </div>
      ) : null}

      {showVoice ? (
        <div className="mt-6">
          <span className="block text-sm font-medium text-slate-700 mb-2">Agent voice</span>
          <p className="text-xs text-slate-400 mb-3 font-semibold">Pick the voice your customers will hear on every call.</p>
          <div className="flex gap-2">
            <select
              id="voice-select"
              data-testid="business-setup-voice-select"
              value={voiceChoice}
              onChange={(e) => {
                onVoiceChoice(normalizeVoiceChoice(e.target.value));
                onCustomVoiceId("");
              }}
              className="field flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-slate-900 focus:outline-none"
            >
              {VOICE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
              {voiceChoice === "custom" ? (
                <option value="custom">Custom voice (saved with this agent)</option>
              ) : null}
            </select>
            <button
              type="button"
              id="voice-play"
              data-testid="business-setup-voice-play"
              onClick={handleVoicePlay}
              aria-label="Listen to voice sample"
              className={`shrink-0 w-12 rounded-xl border border-gray-200 text-slate-600 grid place-items-center hover:bg-slate-50 transition-colors ${voicePlaying ? "bg-amber-50 border-amber-300" : ""}`}
            >
              {voicePlaying ? (
                <span className="inline-flex items-end gap-[2px] h-3">
                  <span className="w-[2.5px] bg-amber-500 rounded-sm animate-bounce" style={{ height: "4px", animationDelay: "0s" }} />
                  <span className="w-[2.5px] bg-amber-500 rounded-sm animate-bounce" style={{ height: "12px", animationDelay: "0.15s" }} />
                  <span className="w-[2.5px] bg-amber-500 rounded-sm animate-bounce" style={{ height: "4px", animationDelay: "0.3s" }} />
                </span>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.14v13.72a.5.5 0 0 0 .77.42l10.7-6.86a.5.5 0 0 0 0-.84L8.77 4.72a.5.5 0 0 0-.77.42z" />
                </svg>
              )}
            </button>
          </div>
          {voicePreviewError ? (
            <p className="mt-2 text-xs font-semibold text-rose-600" data-testid="business-setup-voice-preview-error">
              {voicePreviewError}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Conversation tone — applies to calls and text-back messages alike. */}
      <div className={showVoice ? "mt-6" : ""}>
        <span className="block text-sm font-medium text-slate-700 mb-2">Tone</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Conversation tone" data-testid="business-setup-tone">
          {TONES.map((option) => {
            const selected = tone === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`business-setup-tone-${option.value}`}
                onClick={() => onTone(option.value)}
                className={`pick flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                  selected ? "selected text-slate-900" : "border-gray-200 bg-white text-slate-600"
                }`}
              >
                <span aria-hidden="true">{option.emoji}</span>
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Greeting preview — updates immediately with the names above. */}
      <p className="text-xs text-slate-400 mt-4 font-semibold" data-testid="business-setup-greeting-preview">
        Example: &ldquo;Hello, this is{" "}
        <span className="font-semibold text-slate-600">{assistantName.trim() || DEFAULT_ASSISTANT_NAME}</span>{" "}
        from{" "}
        <span className="font-semibold text-slate-600">{businessName.trim() || "your business"}</span>. How can I help today?&rdquo;
      </p>
    </div>
  );
}
