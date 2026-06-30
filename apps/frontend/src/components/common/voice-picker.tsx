"use client";

import { useEffect, useRef, useState } from "react";
import { VOICE_PRESETS, type AgentVoicePreset } from "@coreai/shared";
import { apiPost } from "@/lib/api";

/**
 * Reusable, compact voice picker used by BOTH the architect builder (suggested
 * default voice for the template) and the buyer setup (final voice before deploy).
 *
 * It's a CUSTOM dropdown/listbox (not a native <select>, which can't hold Play
 * buttons). Vapi is the live voice platform; ElevenLabs is the voice provider
 * inside Vapi. Architects pick a preset (or an Advanced custom id); preview audio
 * is generated server-side — the ElevenLabs key never reaches the browser.
 */

const PREVIEW_FAIL_MESSAGE = "Preview unavailable. Add ElevenLabs API key or check the voice ID.";
const CUSTOM_PREVIEW_TEXT = "Hello, this is a custom voice preview from CoreAI.";

type PreviewResponse = { audioBase64: string; mimeType: string };

/** Build a diagnostic failure message from the backend response (real cause + status). */
function failureMessage(res: { error?: string; status?: number }): string {
  const base = res.error || "Voice preview failed. Check the ElevenLabs voice ID or API key.";
  return res.status ? `Preview failed: ${base} (status ${res.status})` : `Preview failed: ${base}`;
}

/** Which control is busy, and whether it's fetching audio or actively playing. */
type PreviewState = { key: string; phase: "loading" | "playing" } | null;

type VoicePickerProps = {
  /** Current selection: a preset id, "custom", or "default" (buyer only). */
  selectedVoice: string;
  /** Current custom ElevenLabs id (drives the Advanced input + custom preview). */
  customVoiceId: string;
  onSelectPreset: (preset: AgentVoicePreset) => void;
  onCustomVoiceIdChange: (value: string) => void;
  /** When provided, renders a "Use agent default voice" row first (buyer install). */
  onSelectDefault?: () => void;
  subtitle: string;
  accent?: "violet" | "orange";
  testIdPrefix?: string;
};

const ACCENTS = {
  violet: {
    trigger: "focus:border-violet-300 focus:ring-2 focus:ring-violet-400/40",
    row: "bg-violet-50",
    badge: "bg-slate-100 text-slate-600",
    check: "text-violet-600",
    play: "border-violet-200 text-violet-700 hover:bg-violet-50",
    advanced: "border-violet-200 bg-violet-50"
  },
  orange: {
    trigger: "focus:border-orange-300 focus:ring-2 focus:ring-orange-400/40",
    row: "bg-orange-50",
    badge: "bg-orange-100 text-orange-700",
    check: "text-orange-600",
    play: "border-orange-200 text-orange-700 hover:bg-orange-50",
    advanced: "border-orange-200 bg-orange-50"
  }
} as const;

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${className}`} fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${className}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function VoicePicker({
  selectedVoice,
  customVoiceId,
  onSelectPreset,
  onCustomVoiceIdChange,
  onSelectDefault,
  subtitle,
  accent = "violet",
  testIdPrefix = "voice-picker"
}: VoicePickerProps) {
  const [previewState, setPreviewState] = useState<PreviewState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(selectedVoice === "custom");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const theme = ACCENTS[accent];

  function stopCurrentAudio() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    }
  }

  // Close the dropdown on outside click / Escape; stop audio on unmount.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => () => stopCurrentAudio(), []);

  // Single playback path: stop previous, fetch (preset or custom), then play.
  async function runPreview(body: { presetId?: string; voiceId?: string; text?: string }, key: string, previewAudioUrl?: string) {
    stopCurrentAudio();
    setMessage(null);
    setPreviewState({ key, phase: "loading" });

    let src = previewAudioUrl ?? "";
    if (!src) {
      const res = await apiPost<PreviewResponse>("/architect/voices/preview", body);
      if (!res.success || !res.data?.audioBase64) {
        setPreviewState(null);
        setMessage(failureMessage(res));
        return;
      }
      src = `data:${res.data.mimeType || "audio/mpeg"};base64,${res.data.audioBase64}`;
    }

    try {
      const audio = new Audio(src);
      audioRef.current = audio;
      audio.onplaying = () => {
        if (audioRef.current === audio) setPreviewState({ key, phase: "playing" });
      };
      audio.onended = () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          setPreviewState(null);
        }
      };
      audio.onerror = () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          setPreviewState(null);
          setMessage(PREVIEW_FAIL_MESSAGE);
        }
      };
      await audio.play();
    } catch {
      stopCurrentAudio();
      setPreviewState(null);
      setMessage(PREVIEW_FAIL_MESSAGE);
    }
  }

  function playPreset(preset: AgentVoicePreset) {
    void runPreview({ presetId: preset.id, text: preset.previewText }, preset.id, preset.previewAudioUrl);
  }
  function playCustom() {
    const id = customVoiceId.trim();
    if (!id) return;
    void runPreview({ voiceId: id, text: CUSTOM_PREVIEW_TEXT }, "custom");
  }

  // Compact play button (used in the closed trigger, dropdown rows, and Advanced).
  function PlayButton({
    onClick,
    busyKey,
    disabled,
    compact,
    testId
  }: {
    onClick: () => void;
    busyKey: string;
    disabled?: boolean;
    compact?: boolean;
    testId: string;
  }) {
    const busy = previewState?.key === busyKey;
    const loading = busy && previewState?.phase === "loading";
    const label = !busy ? (compact ? "" : "Play") : previewState?.phase === "loading" ? "Loading…" : "Playing…";
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        disabled={disabled || loading}
        data-testid={testId}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${theme.play}`}
      >
        <PlayIcon />
        {label ? <span>{label}</span> : null}
      </button>
    );
  }

  const selectedPreset = VOICE_PRESETS.find((preset) => preset.id === selectedVoice);
  let currentLabel = "Select a voice";
  if (selectedVoice === "default") currentLabel = "Use agent default voice";
  else if (selectedVoice === "custom") currentLabel = "Custom ElevenLabs Voice";
  else if (selectedPreset) currentLabel = `${selectedPreset.name} · ${selectedPreset.style}`;

  const canPlaySelected = selectedVoice === "custom" ? Boolean(customVoiceId.trim()) : Boolean(selectedPreset);
  const selectedBusyKey = selectedVoice === "custom" ? "custom" : selectedPreset?.id ?? "";
  const hasCustomId = Boolean(customVoiceId.trim());

  return (
    <div data-testid={testIdPrefix} ref={rootRef}>
      <p className="text-sm text-slate-500" data-testid={`${testIdPrefix}-subtitle`}>
        {subtitle}
      </p>

      {/* Closed trigger: selected voice + Play + chevron */}
      <div className="relative mt-2">
        <div
          className={`flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-2 py-1.5 ${theme.trigger}`}
        >
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-haspopup="listbox"
            aria-expanded={open}
            data-testid={`${testIdPrefix}-trigger`}
            className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-slate-800"
          >
            {currentLabel}
          </button>
          {canPlaySelected ? (
            <PlayButton
              busyKey={selectedBusyKey}
              testId={`${testIdPrefix}-play-selected`}
              onClick={() => (selectedVoice === "custom" ? playCustom() : selectedPreset ? playPreset(selectedPreset) : undefined)}
            />
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label="Toggle voice list"
            data-testid={`${testIdPrefix}-chevron`}
            className="shrink-0 rounded-md p-1 text-slate-400 hover:text-slate-600"
          >
            <ChevronIcon className={open ? "rotate-180" : ""} />
          </button>
        </div>

        {open ? (
          <ul
            role="listbox"
            data-testid={`${testIdPrefix}-listbox`}
            className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
          >
            {onSelectDefault ? (
              <li>
                <div
                  role="option"
                  aria-selected={selectedVoice === "default"}
                  onClick={() => {
                    onSelectDefault();
                    setOpen(false);
                  }}
                  data-testid={`${testIdPrefix}-option-default`}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 ${
                    selectedVoice === "default" ? theme.row : "hover:bg-gray-50"
                  }`}
                >
                  <span className="text-sm font-semibold text-slate-900">Use agent default voice</span>
                  {selectedVoice === "default" ? <CheckIcon className={theme.check} /> : null}
                </div>
              </li>
            ) : null}

            {VOICE_PRESETS.map((preset) => {
              const isSelected = selectedVoice === preset.id;
              return (
                <li key={preset.id}>
                  <div
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onSelectPreset(preset);
                      setOpen(false);
                    }}
                    data-testid={`${testIdPrefix}-option-${preset.id}`}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 ${
                      isSelected ? theme.row : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{preset.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${theme.badge}`}>
                          {preset.style}
                        </span>
                        {isSelected ? <CheckIcon className={theme.check} /> : null}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-400">{preset.bestFor}</p>
                    </div>
                    <PlayButton
                      compact
                      busyKey={preset.id}
                      testId={`${testIdPrefix}-play-${preset.id}`}
                      onClick={() => playPreset(preset)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {message ? (
        <p className="mt-2 text-xs text-amber-600" data-testid={`${testIdPrefix}-preview-message`}>
          {message}
        </p>
      ) : null}

      {/* Advanced: custom ElevenLabs voice id */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setAdvancedOpen((value) => !value)}
          data-testid={`${testIdPrefix}-advanced-toggle`}
          className="text-xs font-semibold text-slate-500 underline-offset-2 hover:underline"
        >
          {advancedOpen ? "▾ " : "▸ "}Advanced: use custom ElevenLabs voice ID
        </button>
        {advancedOpen ? (
          <div className={`mt-2 rounded-xl border p-3 ${selectedVoice === "custom" ? theme.advanced : "border-gray-200"}`}>
            <label
              htmlFor={`${testIdPrefix}-custom`}
              className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500"
            >
              Custom ElevenLabs voice ID
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id={`${testIdPrefix}-custom`}
                data-testid={`${testIdPrefix}-custom-input`}
                value={customVoiceId}
                onChange={(event) => onCustomVoiceIdChange(event.target.value)}
                placeholder="RDWdsTU6N02BFftbIEAp"
                className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-slate-300"
              />
              <PlayButton
                busyKey="custom"
                testId={`${testIdPrefix}-play-custom`}
                disabled={!hasCustomId}
                onClick={playCustom}
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Use this only if you have a specific ElevenLabs voice ID. Most users should choose one of the voices above.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
