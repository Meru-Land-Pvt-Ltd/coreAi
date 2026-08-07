"use client";

import { useState } from "react";
import { DEEPGRAM_TTS_VOICES } from "@coreai/shared";
import { Loader2, Volume2 } from "lucide-react";

export type DeepgramSpeakRequest = {
  text: string;
  model?: string;
  encoding?: string;
};

export type DeepgramSpeakResponse = {
  status: "success" | "error";
  audioBase64: string;
  audioMimeType: string;
  model: string;
  characterCount: number;
  error: string | null;
  providerId: string;
};

type DeepgramTtsTestCardProps = {
  testIdPrefix: string;
  title?: string;
  description?: string;
  defaultModel?: string;
  onSpeak: (input: DeepgramSpeakRequest) => Promise<{
    success: boolean;
    data?: DeepgramSpeakResponse | null;
    error?: string | null;
  }>;
};

export function DeepgramTtsTestCard({
  testIdPrefix,
  title = "Try voice",
  description = "Enter a short message and play how it sounds.",
  defaultModel = "aura-2-thalia-en",
  onSpeak
}: DeepgramTtsTestCardProps) {
  const [model, setModel] = useState(defaultModel);
  const [text, setText] = useState("Thanks for calling. How can I help you today?");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");

  async function handleSpeak() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Enter a message to hear.");
      return;
    }
    setBusy(true);
    setError("");
    setAudioUrl("");
    try {
      const response = await onSpeak({ text: trimmed, model, encoding: "mp3" });
      if (!response.success || !response.data?.audioBase64) {
        setError(response.error ?? "Could not generate speech. Try again.");
        return;
      }
      const mime = response.data.audioMimeType || "audio/mpeg";
      setAudioUrl(`data:${mime};base64,${response.data.audioBase64}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate speech. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
      data-testid={`${testIdPrefix}-tts-test-card`}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900" data-testid={`${testIdPrefix}-tts-test-title`}>
            {title}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>
        </div>
        <button
          type="button"
          data-testid={`${testIdPrefix}-tts-speak-button`}
          disabled={busy}
          onClick={() => void handleSpeak()}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
          {busy ? "Generating…" : "Play voice"}
        </button>
      </div>

      <label className="mt-5 block text-xs font-medium text-slate-600">
        Voice
        <select
          data-testid={`${testIdPrefix}-tts-model-select`}
          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-400"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          disabled={busy}
        >
          {DEEPGRAM_TTS_VOICES.map((modelId) => (
            <option key={modelId} value={modelId}>
              {modelId}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-4 block text-xs font-medium text-slate-600">
        Message
        <textarea
          data-testid={`${testIdPrefix}-tts-text-input`}
          className="mt-1.5 min-h-[96px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-400"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={busy}
          maxLength={2000}
          placeholder="Thanks for calling. How can I help you today?"
        />
      </label>

      {error ? (
        <p className="mt-3 text-sm text-rose-600" data-testid={`${testIdPrefix}-tts-error`}>
          {error}
        </p>
      ) : null}

      {audioUrl ? (
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3" data-testid={`${testIdPrefix}-tts-result`}>
          <audio
            className="w-full"
            controls
            autoPlay
            src={audioUrl}
            data-testid={`${testIdPrefix}-tts-audio`}
          />
        </div>
      ) : null}
    </div>
  );
}
