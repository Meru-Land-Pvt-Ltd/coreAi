"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEEPGRAM_LIVE_STT_MODELS,
  DEEPGRAM_STT_LANGUAGES,
  describeDeepgramLiveError,
  isDeepgramLiveSttModel
} from "@coreai/shared";
import { Loader2, Mic, Square } from "lucide-react";

export type DeepgramTranscribeRequest = {
  audioBase64: string;
  mimeType?: string;
  model?: string;
  language?: string;
  smartFormat?: boolean;
  punctuate?: boolean;
  diarize?: boolean;
};

export type DeepgramTranscribeResponse = {
  status: "success" | "error";
  transcript: string;
  confidence: number | null;
  model: string;
  language: string;
  audioDurationSeconds: number | null;
  error: string | null;
  providerId: string;
};

export type DeepgramCapturedAudio = {
  name: string;
  mimeType: string;
  data: string;
};

type DeepgramSttTestCardProps = {
  testIdPrefix: string;
  title?: string;
  description?: string;
  defaultModel?: string;
  defaultLanguage?: string;
  /** Architect vs business live WS path. */
  livePath?: "/architect/ai/deepgram/live" | "/business/setup/deepgram/live";
  /** Optional - called when mic recording finishes so dry-run can reuse the clip. */
  onAudioCaptured?: (audio: DeepgramCapturedAudio) => void;
  /** Kept for callers; live mic uses WebSocket and does not call this. */
  onTranscribe?: (input: DeepgramTranscribeRequest) => Promise<{
    success: boolean;
    data?: DeepgramTranscribeResponse | null;
    error?: string | null;
  }>;
};

const TARGET_SAMPLE_RATE = 16000;
const KEEP_ALIVE_MS = 8000;

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

function downsampleBuffer(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLength = Math.max(1, Math.round(buffer.length / ratio));
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buffer.length, Math.floor((i + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      accum += buffer[j] ?? 0;
      count += 1;
    }
    result[i] = count > 0 ? accum / count : (buffer[start] ?? 0);
  }
  return result;
}

function encodeWavBase64(pcmChunks: Int16Array[], sampleRate: number): string | null {
  let totalSamples = 0;
  for (const chunk of pcmChunks) totalSamples += chunk.length;
  if (totalSamples < 1) return null;

  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = totalSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const chunk of pcmChunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      view.setInt16(offset, chunk[i] ?? 0, true);
      offset += 2;
    }
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function buildLiveWsUrl(livePath: string, model: string, language: string): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
  const wsBase = apiBase.replace(/^http/i, "ws");
  const token =
    typeof window !== "undefined" ? localStorage.getItem("coreai-token") ?? "" : "";
  const params = new URLSearchParams({
    token,
    model,
    language
  });
  return `${wsBase}${livePath}?${params.toString()}`;
}

export function DeepgramSttTestCard({
  testIdPrefix,
  title = "Try transcription",
  description = "Tap the microphone and speak. Your words appear live as you talk.",
  defaultModel = "nova-3",
  defaultLanguage = "en",
  livePath = "/architect/ai/deepgram/live",
  onAudioCaptured
}: DeepgramSttTestCardProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcmChunksRef = useRef<Int16Array[]>([]);
  const keepAliveRef = useRef<number | null>(null);
  const finalTextRef = useRef("");
  const listeningRef = useRef(false);

  const [model, setModel] = useState(
    isDeepgramLiveSttModel(defaultModel) ? defaultModel : "nova-3"
  );
  const [language, setLanguage] = useState(defaultLanguage);
  const [connecting, setConnecting] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [audioReady, setAudioReady] = useState(false);
  const micSupported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof AudioContext !== "undefined";

  useEffect(() => {
    return () => {
      stopLiveListening({ saveRecording: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearKeepAlive() {
    if (keepAliveRef.current != null) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }

  function publishCapturedAudio() {
    const wavBase64 = encodeWavBase64(pcmChunksRef.current, TARGET_SAMPLE_RATE);
    pcmChunksRef.current = [];
    if (!wavBase64 || !onAudioCaptured) {
      setAudioReady(false);
      return;
    }
    onAudioCaptured({
      name: `mic-${Date.now()}.wav`,
      mimeType: "audio/wav",
      data: wavBase64
    });
    setAudioReady(true);
  }

  function applyTranscript(piece: string, isFinal: boolean, replace: boolean) {
    const text = piece.trim();
    if (!text) return;
    if (isFinal) {
      if (replace) {
        // Flux turn transcript is cumulative for the turn - commit once on EndOfTurn.
        const next = `${finalTextRef.current}${finalTextRef.current ? " " : ""}${text}`.trim();
        finalTextRef.current = next;
        setFinalText(next);
      } else {
        const next = `${finalTextRef.current}${finalTextRef.current ? " " : ""}${text}`.trim();
        finalTextRef.current = next;
        setFinalText(next);
      }
      setInterim("");
      return;
    }
    // Streaming interim (Nova partials or Flux Update / StartOfTurn).
    setInterim(text);
  }

  function stopLiveListening(options?: { saveRecording?: boolean }) {
    const shouldSave = options?.saveRecording !== false;
    listeningRef.current = false;
    clearKeepAlive();

    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    processorRef.current = null;
    try {
      streamDestRef.current?.disconnect();
    } catch {
      // ignore
    }
    streamDestRef.current = null;
    try {
      void audioContextRef.current?.close();
    } catch {
      // ignore
    }
    audioContextRef.current = null;

    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send("close");
        wsRef.current.close();
      }
    } catch {
      // ignore
    }
    wsRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (shouldSave) {
      publishCapturedAudio();
    } else {
      pcmChunksRef.current = [];
    }

    setListening(false);
    setConnecting(false);
  }

  async function startLiveListening() {
    if (!micSupported || connecting || listening) return;
    setError("");
    setInterim("");
    setFinalText("");
    finalTextRef.current = "";
    setAudioReady(false);
    pcmChunksRef.current = [];

    if (!isDeepgramLiveSttModel(model)) {
      setError(describeDeepgramLiveError("whisper", model));
      return;
    }

    setConnecting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;

      const ws = new WebSocket(buildLiveWsUrl(livePath, model, language));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Could not start listening. Try again.")), 12000);
        let ready = false;

        ws.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error(describeDeepgramLiveError("Could not connect.", model)));
        };

        ws.onclose = () => {
          if (!ready) {
            window.clearTimeout(timer);
            reject(new Error("Live transcription connection closed before ready."));
          } else if (listeningRef.current) {
            stopLiveListening({ saveRecording: true });
          }
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(String(event.data)) as {
              type?: string;
              transcript?: string;
              isFinal?: boolean;
              replace?: boolean;
              error?: string;
            };
            if (payload.type === "ready" && !ready) {
              ready = true;
              window.clearTimeout(timer);
              resolve();
              return;
            }
            if (payload.type === "error") {
              const friendly = describeDeepgramLiveError(
                payload.error ?? "Could not start listening.",
                model
              );
              if (!ready) {
                window.clearTimeout(timer);
                reject(new Error(friendly));
              } else {
                setError(friendly);
                stopLiveListening({ saveRecording: true });
              }
              return;
            }
            if (payload.type === "transcript") {
              applyTranscript(
                payload.transcript ?? "",
                Boolean(payload.isFinal),
                Boolean(payload.replace)
              );
            }
          } catch {
            // ignore
          }
        };
      });

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error("This browser does not support microphone capture.");
      }

      // Prefer 16 kHz so we can stream PCM without resampling when the browser allows it.
      let audioContext: AudioContext;
      try {
        audioContext = new AudioCtx({ sampleRate: TARGET_SAMPLE_RATE });
      } catch {
        audioContext = new AudioCtx();
      }
      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const source = audioContext.createMediaStreamSource(stream);
      // Smaller buffer = lower latency streaming updates.
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;
      // MediaStreamDestination keeps the graph alive without speaker playback
      // (zero-gain -> destination can be optimized away in Chrome).
      const streamDest = audioContext.createMediaStreamDestination();
      streamDestRef.current = streamDest;

      processor.onaudioprocess = (event) => {
        const socket = wsRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN || !listeningRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(input, audioContext.sampleRate, TARGET_SAMPLE_RATE);
        if (downsampled.length < 1) return;
        const pcm = floatTo16BitPCM(downsampled);
        pcmChunksRef.current.push(new Int16Array(pcm.slice(0)));
        socket.send(new Uint8Array(pcm));
      };

      source.connect(processor);
      processor.connect(streamDest);

      keepAliveRef.current = window.setInterval(() => {
        const socket = wsRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        try {
          socket.send(JSON.stringify({ type: "KeepAlive" }));
        } catch {
          // ignore
        }
      }, KEEP_ALIVE_MS);

      listeningRef.current = true;
      setConnecting(false);
      setListening(true);
    } catch (err) {
      stopLiveListening({ saveRecording: false });
      setError(
        describeDeepgramLiveError(
          err instanceof Error ? err.message : "Could not start live transcription.",
          model
        )
      );
    }
  }

  const busy = connecting || listening;
  const hasTranscript = Boolean(finalText || interim);

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
      data-testid={`${testIdPrefix}-test-card`}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900" data-testid={`${testIdPrefix}-test-title`}>
            {title}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>
        </div>
        <button
          type="button"
          data-testid={`${testIdPrefix}-mic-button`}
          disabled={!micSupported || connecting}
          onClick={() => {
            if (listening) stopLiveListening({ saveRecording: true });
            else void startLiveListening();
          }}
          className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
            listening
              ? "bg-rose-600 hover:bg-rose-700"
              : "bg-slate-900 hover:bg-slate-800"
          }`}
        >
          {connecting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : listening ? (
            <Square className="h-4 w-4 fill-current" aria-hidden="true" />
          ) : (
            <Mic className="h-4 w-4" aria-hidden="true" />
          )}
          {connecting ? "Starting…" : listening ? "Stop" : "Start microphone"}
        </button>
      </div>

      {!micSupported ? (
        <p className="mt-4 text-sm text-rose-600" data-testid={`${testIdPrefix}-mic-unsupported`}>
          This browser does not support microphone capture. Try Chrome or Edge.
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600">
          Language
          <select
            data-testid={`${testIdPrefix}-language-select`}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-400"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            disabled={busy}
          >
            {DEEPGRAM_STT_LANGUAGES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Model
          <select
            data-testid={`${testIdPrefix}-model-select`}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-400"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={busy}
          >
            {DEEPGRAM_LIVE_STT_MODELS.map((modelId) => (
              <option key={modelId} value={modelId}>
                {modelId}
              </option>
            ))}
          </select>
        </label>
      </div>

      {listening ? (
        <div
          className="mt-4 flex items-center gap-2 text-sm font-medium text-rose-600"
          data-testid={`${testIdPrefix}-listening-hint`}
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
          </span>
          Listening - speak now
        </div>
      ) : null}

      {!listening && audioReady ? (
        <div
          className="mt-4 text-sm font-medium text-emerald-700"
          data-testid={`${testIdPrefix}-audio-ready`}
        >
          Audio saved - ready for dry test
        </div>
      ) : null}

      <div
        className="mt-4 min-h-[7rem] rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
        data-testid={`${testIdPrefix}-result`}
      >
        {hasTranscript ? (
          <p
            className="whitespace-pre-wrap text-sm leading-relaxed"
            data-testid={`${testIdPrefix}-transcript`}
          >
            {finalText ? <span className="text-slate-900">{finalText}</span> : null}
            {interim ? (
              <span className="text-slate-500" data-testid={`${testIdPrefix}-interim`}>
                {finalText ? ` ${interim}` : interim}
              </span>
            ) : null}
            {listening ? (
              <span
                className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-rose-500 align-middle"
                aria-hidden="true"
              />
            ) : null}
          </p>
        ) : (
          <p
            className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800"
            data-testid={`${testIdPrefix}-transcript`}
          >
            {listening || connecting ? "Say something…" : "Your transcript will appear here."}
            {listening ? (
              <span
                className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-rose-500 align-middle"
                aria-hidden="true"
              />
            ) : null}
          </p>
        )}
      </div>

      {error ? (
        <p className="mt-3 text-sm text-rose-600" data-testid={`${testIdPrefix}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
