"use client";

import { useEffect, useRef, useState } from "react";
import { VOICE_PRESETS } from "@coreai/shared";
import { getVoiceSamplePreview } from "@/components/business/features/api";
import { FIELD, LABEL } from "./ui";

/**
 * Agent Identity section of the Configure step: the agent's name, voice (with
 * a real audio preview), conversation tone, and a live greeting preview that
 * updates as the buyer types.
 */

const PLATFORM_DEFAULT_VOICE_ID = "triven-default";
const DEFAULT_ASSISTANT_NAME = "AI Assistant";

const VOICE_OPTIONS = VOICE_PRESETS.map((preset) => ({
  value: preset.id,
  name: preset.name,
  style: preset.style
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
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // data: URLs of already-generated samples, keyed by voice choice.
  const voiceAudioCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setVoiceDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleVoicePlay() {
    if (voicePlaying) return;
    setVoicePreviewError("");

    if (!voiceChoice) {
      setVoicePreviewError("Please select a voice first.");
      return;
    }

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
          <label htmlFor="agent-name" className={LABEL}>Name your agent</label>
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
        <div className="mt-4">
          <label htmlFor="agent-voice-select" className={LABEL}>
            Agent voice
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1" ref={dropdownRef}>
              <button
                type="button"
                id="agent-voice-select"
                data-testid="business-setup-voice-select"
                aria-haspopup="listbox"
                aria-expanded={voiceDropdownOpen}
                onClick={() => setVoiceDropdownOpen(!voiceDropdownOpen)}
                className="w-full flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-left shadow-sm transition-all hover:border-slate-300 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 cursor-pointer"
              >
                <div className="min-w-0 pr-2">
                  <span className="block truncate text-xs font-semibold text-slate-800 leading-snug">
                    {voiceChoice === "custom"
                      ? "Custom voice"
                      : VOICE_OPTIONS.find((v) => v.value === voiceChoice)?.name || "Select voice"}
                  </span>
                  <span className="block truncate text-[11px] font-normal text-slate-500 leading-snug">
                    {voiceChoice === "custom"
                      ? "ElevenLabs voice ID"
                      : VOICE_OPTIONS.find((v) => v.value === voiceChoice)?.style || "Choose assistant voice"}
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                    voiceDropdownOpen ? "rotate-180 text-amber-600" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {voiceDropdownOpen ? (
                <div
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl transition-all"
                >
                  {VOICE_OPTIONS.map((opt) => {
                    const isSelected = voiceChoice === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-testid={`business-setup-voice-option-${opt.value}`}
                        onClick={() => {
                          onVoiceChoice(normalizeVoiceChoice(opt.value));
                          onCustomVoiceId("");
                          setVoiceDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-left transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-amber-50/80 text-amber-900 font-semibold"
                            : "hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="text-xs font-semibold text-slate-800 leading-snug">{opt.name}</div>
                          <div className="text-[11px] font-normal text-slate-500 leading-snug mt-0.5">{opt.style}</div>
                        </div>
                        {isSelected ? (
                          <svg
                            className="w-4 h-4 text-amber-600 shrink-0"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth="3"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : null}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    role="option"
                    aria-selected={voiceChoice === "custom"}
                    data-testid="business-setup-voice-option-custom"
                    onClick={() => {
                      onVoiceChoice("custom");
                      setVoiceDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-left transition-colors cursor-pointer border-t border-slate-100 mt-1 ${
                      voiceChoice === "custom"
                        ? "bg-amber-50/80 text-amber-900 font-semibold"
                        : "hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-xs font-semibold text-slate-800 leading-snug">Custom voice</div>
                      <div className="text-[11px] font-normal text-slate-500 leading-snug mt-0.5">Use your ElevenLabs voice ID</div>
                    </div>
                    {voiceChoice === "custom" ? (
                      <svg
                        className="w-4 h-4 text-amber-600 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : null}
                  </button>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              id="voice-play"
              data-testid="business-setup-voice-play"
              onClick={handleVoicePlay}
              aria-label="Listen to voice sample"
              title="Listen to voice sample"
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl border px-4 py-3 text-xs font-semibold shadow-sm transition-all ${
                voicePlaying
                  ? "border-amber-300 bg-amber-50 text-amber-700 ring-2 ring-amber-500/20"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300"
              }`}
            >
              {voicePlaying ? (
                <span className="inline-flex items-end gap-[2px] h-3" aria-hidden="true">
                  <span className="w-[2.5px] bg-amber-500 rounded-sm animate-bounce" style={{ height: "4px", animationDelay: "0s" }} />
                  <span className="w-[2.5px] bg-amber-500 rounded-sm animate-bounce" style={{ height: "12px", animationDelay: "0.15s" }} />
                  <span className="w-[2.5px] bg-amber-500 rounded-sm animate-bounce" style={{ height: "4px", animationDelay: "0.3s" }} />
                </span>
              ) : (
                <svg className="w-3.5 h-3.5 text-amber-600" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5.14v13.72a.5.5 0 0 0 .77.42l10.7-6.86a.5.5 0 0 0 0-.84L8.77 4.72a.5.5 0 0 0-.77.42z" />
                </svg>
              )}
              <span>{voicePlaying ? "Playing…" : "Preview voice"}</span>
            </button>
          </div>

          {voiceChoice === "custom" ? (
            <div className="mt-2.5">
              <label htmlFor="custom-voice-id" className={LABEL}>
                Custom voice ID
              </label>
              <input
                id="custom-voice-id"
                data-testid="business-setup-voice-custom-id"
                type="text"
                value={customVoiceId}
                onChange={(e) => onCustomVoiceId(e.target.value)}
                placeholder="ElevenLabs voice ID"
                className="field w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all"
              />
            </div>
          ) : null}

          {voicePreviewError ? (
            <p className="mt-2 text-xs font-semibold text-rose-600" data-testid="business-setup-voice-preview-error">
              {voicePreviewError}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Conversation tone — applies to calls and text-back messages alike. */}
      <div className={showVoice ? "mt-5" : ""}>
        <span className={LABEL}>Tone</span>
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
      <p className="text-xs text-slate-500 mt-4 font-normal" data-testid="business-setup-greeting-preview">
        Example: &ldquo;Hello, this is{" "}
        <span className="font-semibold text-slate-700">{assistantName.trim() || DEFAULT_ASSISTANT_NAME}</span>{" "}
        from{" "}
        <span className="font-semibold text-slate-700">{businessName.trim() || "your business"}</span>. How can I help today?&rdquo;
      </p>
    </div>
  );
}
