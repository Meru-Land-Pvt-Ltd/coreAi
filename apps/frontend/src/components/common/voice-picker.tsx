"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VOICE_PRESETS, type AgentVoicePreset } from "@coreai/shared";
import { apiPost } from "@/lib/api";

const PLATFORM_DEFAULT_VOICE_ID = "triven-default";
const PREVIEW_FAIL_MESSAGE = "Preview unavailable. Add ElevenLabs API key or check the voice ID.";
const CUSTOM_PREVIEW_TEXT = "Hello, this is a custom voice preview from Triven AI.";

const TRIVEN_VOICE_PRESET = {
  id: PLATFORM_DEFAULT_VOICE_ID,
  name: "Triven Voice",
  voiceId: "",
  style: "Default",
  bestFor: "All business agents",
  description: "Production default voice from ELEVENLABS_DEFAULT_VOICE_ID.",
  previewText: "Hello, this is Triven Voice. How can I help you today?"
} as AgentVoicePreset;

type PreviewResponse = {
  audioBase64: string;
  mimeType: string;
};

type PreviewState = {
  key: string;
  phase: "loading" | "playing";
} | null;

type VoicePickerProps = {
  selectedVoice: string;
  customVoiceId: string;
  onSelectPreset: (preset: AgentVoicePreset) => void;
  onCustomVoiceIdChange: (value: string) => void;
  subtitle: string;
  accent?: "violet" | "orange";
  testIdPrefix?: string;

  /**
   * Kept for old buyer setup usage.
   * If parent still passes onSelectDefault, this component will call it
   * when Triven Voice is selected.
   */
  onSelectDefault?: () => void;
};

const ACCENTS = {
  violet: {
    trigger: "focus-within:border-violet-300 focus-within:ring-2 focus-within:ring-violet-400/40",
    row: "bg-violet-50",
    badge: "bg-slate-100 text-slate-600",
    defaultBadge: "bg-violet-100 text-violet-700",
    check: "text-violet-600",
    play: "border-violet-200 text-violet-700 hover:bg-violet-50",
    advanced: "border-violet-200 bg-violet-50"
  },
  orange: {
    trigger: "focus-within:border-orange-300 focus-within:ring-2 focus-within:ring-orange-400/40",
    row: "bg-orange-50",
    badge: "bg-orange-100 text-orange-700",
    defaultBadge: "bg-orange-100 text-orange-700",
    check: "text-orange-600",
    play: "border-orange-200 text-orange-700 hover:bg-orange-50",
    advanced: "border-orange-200 bg-orange-50"
  }
} as const;

function clean(value?: string | null): string {
  return (value ?? "").trim();
}

function normalizedVoice(value?: string | null): string {
  const voice = clean(value).toLowerCase();

  if (!voice || voice === "default" || voice === "agent-default" || voice === "use-agent-default") {
    return PLATFORM_DEFAULT_VOICE_ID;
  }

  return voice;
}

function isTrivenVoice(preset: AgentVoicePreset): boolean {
  const id = normalizedVoice(preset.id);
  const name = clean(preset.name).toLowerCase();

  return (
    id === PLATFORM_DEFAULT_VOICE_ID ||
    name.includes("triven voice") ||
    name.includes("triven default")
  );
}

function displayPresetName(preset: AgentVoicePreset): string {
  return isTrivenVoice(preset) ? "Triven Voice" : preset.name;
}

function displayPresetStyle(preset: AgentVoicePreset): string {
  return isTrivenVoice(preset) ? "Default" : preset.style;
}

function presetPreviewAudioUrl(preset: AgentVoicePreset): string | undefined {
  return (preset as AgentVoicePreset & { previewAudioUrl?: string }).previewAudioUrl;
}

function buildVoicePresets(): AgentVoicePreset[] {
  const withoutOldDefault = VOICE_PRESETS.filter((preset) => !isTrivenVoice(preset));
  return [TRIVEN_VOICE_PRESET, ...withoutOldDefault];
}

function failureMessage(res: { error?: string; status?: number }): string {
  const base = res.error || "Voice preview failed. Check the ElevenLabs voice ID or API key.";
  return res.status ? `Preview failed: ${base} (status ${res.status})` : `Preview failed: ${base}`;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 transition-transform ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
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
  const [advancedOpen, setAdvancedOpen] = useState(normalizedVoice(selectedVoice) === "custom");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const theme = ACCENTS[accent];

  const voicePresets = useMemo(() => buildVoicePresets(), []);
  const selectedVoiceKey = normalizedVoice(selectedVoice);

  const selectedPreset = voicePresets.find((preset) => normalizedVoice(preset.id) === selectedVoiceKey);
  const selectedIsCustom = selectedVoiceKey === "custom";
  const defaultPreset = voicePresets[0];

  function stopCurrentAudio() {
    const audio = audioRef.current;

    if (audio) {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    }
  }

  useEffect(() => {
    setAdvancedOpen(normalizedVoice(selectedVoice) === "custom");
  }, [selectedVoice]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    return () => stopCurrentAudio();
  }, []);

  async function runPreview(
    body: { presetId?: string; voiceId?: string; text?: string },
    key: string,
    previewAudioUrl?: string
  ) {
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
        if (audioRef.current === audio) {
          setPreviewState({ key, phase: "playing" });
        }
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
    const presetId = isTrivenVoice(preset) ? PLATFORM_DEFAULT_VOICE_ID : preset.id;

    void runPreview(
      {
        presetId,
        text: preset.previewText || "Hello, this is Triven Voice. How can I help you today?"
      },
      presetId,
      presetPreviewAudioUrl(preset)
    );
  }

  function playCustom() {
    const id = customVoiceId.trim();
    if (!id) return;

    void runPreview(
      {
        voiceId: id,
        text: CUSTOM_PREVIEW_TEXT
      },
      "custom"
    );
  }

  function selectPreset(preset: AgentVoicePreset) {
    const isDefault = isTrivenVoice(preset);

    if (isDefault && onSelectDefault) {
      onSelectDefault();
      return;
    }

    onSelectPreset({
      ...preset,
      id: isDefault ? PLATFORM_DEFAULT_VOICE_ID : preset.id,
      name: displayPresetName(preset),
      voiceId: isDefault ? "" : preset.voiceId
    });
  }

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
    const label = !busy ? (compact ? "" : "Play") : loading ? "Loading…" : "Playing…";

    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        disabled={disabled || loading}
        data-testid={testId}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${theme.play}`}
      >
        <PlayIcon />
        {label ? <span>{label}</span> : null}
      </button>
    );
  }

  let currentLabel = "Select a voice";

  if (selectedIsCustom) {
    currentLabel = "Custom ElevenLabs Voice";
  } else if (selectedPreset) {
    currentLabel = `${displayPresetName(selectedPreset)} · ${displayPresetStyle(selectedPreset)}`;
  } else {
    currentLabel = "Triven Voice · Default";
  }

  const activePreset = selectedPreset || defaultPreset;
  const selectedBusyKey = selectedIsCustom ? "custom" : activePreset.id;
  const canPlaySelected = selectedIsCustom ? Boolean(customVoiceId.trim()) : Boolean(activePreset);
  const hasCustomId = Boolean(customVoiceId.trim());

  return (
    <div data-testid={testIdPrefix} ref={rootRef}>
      <p className="text-sm text-slate-500" data-testid={`${testIdPrefix}-subtitle`}>
        {subtitle}
      </p>

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
              onClick={() => {
                if (selectedIsCustom) {
                  playCustom();
                  return;
                }

                playPreset(activePreset);
              }}
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
            {voicePresets.map((preset) => {
              const presetKey = normalizedVoice(preset.id);
              const isSelected = selectedVoiceKey === presetKey;
              const isDefault = isTrivenVoice(preset);
              const label = displayPresetName(preset);
              const badge = displayPresetStyle(preset);

              return (
                <li key={preset.id}>
                  <div
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      selectPreset(preset);
                      setOpen(false);
                    }}
                    data-testid={`${testIdPrefix}-option-${preset.id}`}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 ${
                      isSelected ? theme.row : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{label}</span>

                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            isDefault ? theme.defaultBadge : theme.badge
                          }`}
                        >
                          {badge}
                        </span>

                        {isSelected ? <CheckIcon className={theme.check} /> : null}
                      </div>

                      <p className="mt-0.5 truncate text-[11px] text-slate-400">
                        {isDefault ? "Triven Default Voice" : preset.bestFor}
                      </p>
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
          <div
            className={`mt-2 rounded-xl border p-3 ${
              selectedIsCustom ? theme.advanced : "border-gray-200"
            }`}
          >
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
                placeholder="Paste ElevenLabs voice ID"
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