"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Phone, PhoneOff } from "lucide-react";
import { publicAgentPath } from "@/lib/routes";
import { agentPageAccent, agentPageAccentForeground, type AgentPageTemplateProps } from "./types";

/**
 * Voice template — a hero page with one oversized round call button.
 * Reuses the proven public demo-call session flow (agent-demo-call.tsx):
 * runtime.startVoiceSession(), then the shared @vapi-ai/web client.
 */

type VapiEventName =
  | "call-start"
  | "call-end"
  | "speech-start"
  | "speech-end"
  | "message"
  | "error"
  | "call-start-failed";

type VapiWebClient = {
  start: (assistantId: string, overrides?: Record<string, unknown>) => Promise<unknown>;
  stop: () => void | Promise<void>;
  on: (event: VapiEventName, listener: (payload?: unknown) => void) => unknown;
  off?: (event: VapiEventName, listener: (payload?: unknown) => void) => unknown;
  removeAllListeners?: (event?: VapiEventName) => unknown;
};

// One browser tab must never hold two live voice connections — keep a single
// client across mounts (same idiom as agent-demo-call.tsx).
let sharedVoiceClient: VapiWebClient | null = null;

async function stopVoiceClient(client: VapiWebClient | null): Promise<void> {
  if (!client) return;
  try {
    await client.stop();
  } catch {
    // already stopped
  }
}

async function getVoiceClient(publicKey: string): Promise<VapiWebClient> {
  if (sharedVoiceClient) {
    await stopVoiceClient(sharedVoiceClient);
    try {
      sharedVoiceClient.removeAllListeners?.();
    } catch {
      // no listeners to remove
    }
  }

  const mod = await import("@vapi-ai/web");
  const VapiCtor = mod.default as unknown as new (key: string) => VapiWebClient;

  sharedVoiceClient = new VapiCtor(publicKey);
  return sharedVoiceClient;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readVoiceError(payload: unknown): string {
  const record = asRecord(payload);
  const error = asRecord(record.error);

  return (
    (typeof record.errorMsg === "string" && record.errorMsg) ||
    (typeof record.message === "string" && record.message) ||
    (typeof record.error === "string" && record.error) ||
    (typeof error.errorMsg === "string" && error.errorMsg) ||
    (typeof error.message === "string" && error.message) ||
    "The call hit a problem."
  );
}

const MIC_HELP =
  "We couldn't use your microphone. Allow microphone access for this site in your browser, then try again.";

function isMicProblem(text: string): boolean {
  return /notallowed|notfound|permission|denied|microphone|\bmic\b/i.test(text);
}

/** Friendly copy for end reasons that were not a normal hang-up; null when the ending was expected. */
function unexpectedEndMessage(reason: string): string | null {
  const normalized = reason.trim().toLowerCase();
  if (!normalized) return null;

  if (
    normalized.includes("customer-ended-call") ||
    normalized.includes("assistant-ended-call") ||
    normalized.includes("max-duration") ||
    normalized.includes("silence-timed-out")
  ) {
    return null;
  }

  if (normalized.includes("did-not-receive-customer-audio") || normalized.includes("microphone")) {
    return MIC_HELP;
  }

  return "The call ended unexpectedly. Please try again.";
}

type CallState = "idle" | "connecting" | "live" | "ended";
type Caption = { id: number; role: "user" | "assistant"; text: string };

const MAX_VISIBLE_CAPTIONS = 3;
/** How long the preview CTA's "goes live when you publish" note stays up —
 *  mirrors AgentPageShell's timed dismiss. */
const PREVIEW_CTA_NOTE_MS = 2600;

const voiceKeyframes = `
@keyframes agent-page-voice-pulse {
  0% { transform: scale(1); opacity: 0.3; }
  70%, 100% { transform: scale(1.5); opacity: 0; }
}
.agent-page-voice-pulse { animation: agent-page-voice-pulse 2.4s ease-out infinite; }
@keyframes agent-page-voice-bar {
  0%, 100% { transform: scaleY(0.35); }
  50% { transform: scaleY(1); }
}
.agent-page-voice-bar { transform-origin: center; animation: agent-page-voice-bar 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .agent-page-voice-pulse { animation: none; opacity: 0; }
  .agent-page-voice-bar { animation: none; }
}
`;

export function VoiceTemplate({ data, runtime }: AgentPageTemplateProps) {
  const accent = agentPageAccent(data);
  // Light accents flip button text/icons to dark slate so they stay legible.
  const accentText = agentPageAccentForeground(accent);
  const { listing, page } = data;
  const headline = page.headline ?? listing.name;
  const subline = page.welcomeMessage ?? listing.tagline;

  // Architect previews are never rate-limited, and their "Get this agent"
  // button must not leave the builder — it only explains itself.
  const isPreview = runtime.mode === "preview";

  const [state, setState] = useState<CallState>("idle");
  const [notice, setNotice] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const [previewCtaNote, setPreviewCtaNote] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  // Whether this session has a countdown at all — live sessions always do
  // (the timer stays visible for them, exactly as before the runtime
  // refactor, including the final "0:00" frame); preview sessions omit it.
  const [countdownActive, setCountdownActive] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [partialCaption, setPartialCaption] = useState<Caption | null>(null);

  const clientRef = useRef<VapiWebClient | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewCtaNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startInFlightRef = useRef(false);
  const captionIdRef = useRef(0);
  // Countdown source of truth — the interval must never end the call from
  // inside a state updater (updaters must stay pure).
  const secondsLeftRef = useRef(0);
  // startCall awaits across renders; if the page unmounts mid-connect the
  // in-flight client must be stopped or the mic stays live with no UI.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // Cleanup must not depend on per-render state: refs only, run once.
    return () => {
      mountedRef.current = false;
      detachRef.current?.();
      if (timerRef.current) clearInterval(timerRef.current);
      if (previewCtaNoteTimerRef.current) clearTimeout(previewCtaNoteTimerRef.current);
      void stopVoiceClient(clientRef.current);
    };
  }, []);

  /** Preview-only: show the "goes live when you publish" note, then let it
   *  fade — same timed dismiss as the shell's header CTA. */
  function showPreviewCtaNote() {
    setPreviewCtaNote(true);
    if (previewCtaNoteTimerRef.current) clearTimeout(previewCtaNoteTimerRef.current);
    previewCtaNoteTimerRef.current = setTimeout(() => {
      previewCtaNoteTimerRef.current = null;
      setPreviewCtaNote(false);
    }, PREVIEW_CTA_NOTE_MS);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function teardownCall() {
    stopTimer();
    detachRef.current?.();
    void stopVoiceClient(clientRef.current);
    setAgentSpeaking(false);
    setPartialCaption(null);
  }

  function endCall() {
    teardownCall();
    setState("ended");
  }

  function handleTranscript(event: Record<string, unknown>) {
    const role = event.role === "assistant" ? ("assistant" as const) : ("user" as const);
    const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
    if (!text) return;

    if (event.transcriptType === "partial") {
      setPartialCaption({ id: -1, role, text });
      return;
    }

    captionIdRef.current += 1;
    const caption = { id: captionIdRef.current, role, text };
    setCaptions((current) => [...current, caption].slice(-MAX_VISIBLE_CAPTIONS));
    setPartialCaption((current) => (current && current.role === role ? null : current));
  }

  async function startCall() {
    if (startInFlightRef.current || state === "connecting" || state === "live") return;

    startInFlightRef.current = true;
    setNotice("");
    setCaptions([]);
    setPartialCaption(null);
    // A fresh call clears the ended-card's publish note immediately.
    setPreviewCtaNote(false);
    if (previewCtaNoteTimerRef.current) {
      clearTimeout(previewCtaNoteTimerRef.current);
      previewCtaNoteTimerRef.current = null;
    }
    setState("connecting");

    try {
      const result = await runtime.startVoiceSession();
      if (!mountedRef.current) return;

      if ("error" in result) {
        setState("idle");
        if (
          !isPreview &&
          (result.code === "DEMO_LIMIT_REACHED" || result.code === "PAGE_LIMIT_REACHED")
        ) {
          setLimitReached(true);
        } else {
          setNotice("We couldn't start the call right now. Please try again in a moment.");
        }
        return;
      }

      const { session } = result;
      // Preview sessions omit the countdown; live sessions always send one
      // (any number — 0 keeps the pre-refactor behavior: "0:00" shows and the
      // call auto-ends about a second in).
      const maxDurationSeconds =
        typeof session.maxDurationSeconds === "number" ? session.maxDurationSeconds : null;
      setCountdownActive(maxDurationSeconds !== null);

      const client = await getVoiceClient(session.publicKey);
      if (!mountedRef.current) {
        // Unmounted while loading the client — never leave a mic running.
        void stopVoiceClient(client);
        return;
      }
      detachRef.current?.();
      clientRef.current = client;

      let problemHandled = false;

      const onCallStart = () => {
        setState("live");
        if (maxDurationSeconds === null) return;
        secondsLeftRef.current = maxDurationSeconds;
        setSecondsLeft(maxDurationSeconds);
        stopTimer();
        timerRef.current = setInterval(() => {
          // Count down via the ref and end the call OUTSIDE any state
          // updater — updaters must stay pure (StrictMode double-invokes them).
          secondsLeftRef.current = Math.max(0, secondsLeftRef.current - 1);
          setSecondsLeft(secondsLeftRef.current);
          if (secondsLeftRef.current <= 0) endCall();
        }, 1000);
      };
      const onSpeechStart = () => setAgentSpeaking(true);
      const onSpeechEnd = () => setAgentSpeaking(false);
      const onCallEnd = () => endCall();
      const onMessage = (payload?: unknown) => {
        const event = asRecord(payload);

        if (event.type === "transcript") {
          handleTranscript(event);
          return;
        }

        if (event.type === "status-update" && event.status === "ended") {
          const endedReason = typeof event.endedReason === "string" ? event.endedReason : "";
          const friendly = unexpectedEndMessage(endedReason);
          if (friendly) {
            problemHandled = true;
            setNotice(friendly);
          }
          endCall();
        }
      };
      const onError = (payload?: unknown) => {
        if (problemHandled) return;
        problemHandled = true;
        const text = readVoiceError(payload);
        setNotice(isMicProblem(text) ? MIC_HELP : "The call hit a problem. Please try again.");
        endCall();
      };
      const onCallStartFailed = (payload?: unknown) => {
        problemHandled = true;
        const text = readVoiceError(payload);
        setNotice(
          isMicProblem(text) ? MIC_HELP : "We couldn't connect the call. Please try again."
        );
        teardownCall();
        setState("idle");
      };

      client.on("call-start", onCallStart);
      client.on("speech-start", onSpeechStart);
      client.on("speech-end", onSpeechEnd);
      client.on("call-end", onCallEnd);
      client.on("message", onMessage);
      client.on("error", onError);
      client.on("call-start-failed", onCallStartFailed);

      detachRef.current = () => {
        detachRef.current = null;
        try {
          if (client.off) {
            client.off("call-start", onCallStart);
            client.off("speech-start", onSpeechStart);
            client.off("speech-end", onSpeechEnd);
            client.off("call-end", onCallEnd);
            client.off("message", onMessage);
            client.off("error", onError);
            client.off("call-start-failed", onCallStartFailed);
          } else {
            client.removeAllListeners?.();
          }
        } catch {
          // listeners already gone
        }
      };

      // The live runtime already merged the marketplace demo metadata into the
      // overrides — this payload is identical to the pre-runtime behavior.
      const started = await client.start(session.assistantId, asRecord(session.assistantOverrides));

      if (!mountedRef.current) {
        // Unmounted while the call was connecting — hang up immediately.
        stopTimer();
        detachRef.current?.();
        void stopVoiceClient(client);
        return;
      }

      if (!started && !problemHandled) {
        setNotice("We couldn't connect the call. Please try again.");
        teardownCall();
        setState("idle");
      }
    } catch (error) {
      teardownCall();
      if (!mountedRef.current) return;
      const text = error instanceof Error ? error.message : String(error ?? "");
      setNotice((current) => {
        if (current) return current;
        return isMicProblem(text) ? MIC_HELP : "We couldn't connect the call. Please try again.";
      });
      setState("idle");
    } finally {
      startInFlightRef.current = false;
    }
  }

  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="agent-page-voice">
      <style>{voiceKeyframes}</style>

      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-6 py-10 text-center">
        {listing.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.iconUrl}
            alt=""
            className="h-20 w-20 rounded-3xl border border-gray-100 object-cover shadow-sm"
            data-testid="agent-page-voice-avatar"
          />
        ) : (
          <span
            className="flex h-20 w-20 items-center justify-center rounded-3xl text-white shadow-sm"
            style={{ backgroundColor: accent, color: accentText }}
            data-testid="agent-page-voice-avatar"
          >
            <Bot className="h-10 w-10" aria-hidden="true" />
          </span>
        )}

        <h1
          className="mt-6 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
          data-testid="agent-page-headline"
        >
          {headline}
        </h1>

        {subline ? (
          <p
            className="mt-2 max-w-md text-base leading-relaxed text-slate-600"
            data-testid="agent-page-welcome"
          >
            {subline}
          </p>
        ) : null}

        {limitReached ? (
          <div
            className="mt-8 w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm"
            data-testid="agent-page-limit-card"
          >
            <p className="text-base font-semibold text-slate-900">
              This agent&apos;s free preview is done for today
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              Get {listing.name} to keep talking — no daily limits.
            </p>
            <Link
              href={publicAgentPath(listing.id)}
              data-testid="agent-page-limit-cta"
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl px-6 py-3 text-base font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: accent, color: accentText }}
            >
              Get this agent
            </Link>
          </div>
        ) : state === "ended" ? (
          <div
            className="mt-8 w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm"
            data-testid="agent-page-voice-ended"
          >
            <p className="text-base font-semibold text-slate-900">
              Thanks for trying {listing.name}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              That was a quick preview. Get the full agent and put it to work for you.
            </p>
            {isPreview ? (
              <button
                type="button"
                onClick={showPreviewCtaNote}
                data-testid="agent-page-voice-cta"
                className="mt-4 inline-flex w-full items-center justify-center rounded-xl px-6 py-3 text-base font-semibold text-white transition hover:opacity-90"
                style={{ backgroundColor: accent, color: accentText }}
              >
                Get this agent
              </button>
            ) : (
              <Link
                href={publicAgentPath(listing.id)}
                data-testid="agent-page-voice-cta"
                className="mt-4 inline-flex w-full items-center justify-center rounded-xl px-6 py-3 text-base font-semibold text-white transition hover:opacity-90"
                style={{ backgroundColor: accent, color: accentText }}
              >
                Get this agent
              </Link>
            )}
            {isPreview && previewCtaNote ? (
              <p
                className="mt-2 text-xs leading-relaxed text-slate-500"
                role="status"
                data-testid="agent-page-preview-cta-note"
              >
                This button goes live when you publish.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void startCall()}
              data-testid="agent-page-voice-again"
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call again
            </button>
          </div>
        ) : (
          <>
            {state === "live" ? (
              <div className="mt-8 w-full" data-testid="agent-page-voice-live">
                <div className="flex items-center justify-center gap-4">
                  <div
                    className="flex h-8 items-center gap-1"
                    aria-hidden="true"
                    data-testid="agent-page-voice-waveform"
                  >
                    {[0, 1, 2, 3, 4].map((bar) => (
                      <span
                        key={bar}
                        className="agent-page-voice-bar h-full w-1.5 rounded-full"
                        style={{
                          backgroundColor: accent,
                          opacity: agentSpeaking ? 1 : 0.4,
                          animationDelay: `${bar * 120}ms`,
                          animationDuration: agentSpeaking ? "0.9s" : "1.6s"
                        }}
                      />
                    ))}
                  </div>
                  {countdownActive ? (
                    <span
                      className="font-mono text-sm font-semibold tabular-nums text-slate-600"
                      data-testid="agent-page-voice-timer"
                    >
                      {clock}
                    </span>
                  ) : null}
                </div>

                <p
                  className="mt-3 text-sm font-medium text-slate-600"
                  data-testid="agent-page-voice-live-status"
                >
                  {agentSpeaking ? `${listing.name} is speaking…` : "Listening — just talk"}
                </p>

                <div
                  className="mx-auto mt-4 min-h-[72px] w-full max-w-md space-y-1.5"
                  aria-live="polite"
                  data-testid="agent-page-voice-captions"
                >
                  {captions.map((caption) => (
                    <p
                      key={caption.id}
                      className={
                        caption.role === "assistant"
                          ? "text-sm leading-relaxed text-slate-700"
                          : "text-sm leading-relaxed text-slate-400"
                      }
                    >
                      {caption.text}
                    </p>
                  ))}
                  {partialCaption ? (
                    <p className="text-sm italic leading-relaxed text-slate-400">
                      {partialCaption.text}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="relative mt-10 flex items-center justify-center">
              {state === "idle" ? (
                <span
                  aria-hidden="true"
                  className="agent-page-voice-pulse absolute h-24 w-24 rounded-full"
                  style={{ backgroundColor: accent }}
                />
              ) : null}
              <button
                type="button"
                onClick={state === "live" ? endCall : () => void startCall()}
                disabled={state === "connecting"}
                aria-label={state === "live" ? "Hang up" : `Call ${listing.name}`}
                aria-busy={state === "connecting"}
                data-testid="agent-page-voice-call"
                className="relative flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg transition hover:scale-105 active:scale-95 disabled:cursor-wait disabled:opacity-70 disabled:hover:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100"
                style={{
                  backgroundColor: state === "live" ? "#e11d48" : accent,
                  color: state === "live" ? "#ffffff" : accentText
                }}
              >
                {state === "live" ? (
                  <PhoneOff className="h-9 w-9" aria-hidden="true" />
                ) : (
                  <Phone className="h-9 w-9" aria-hidden="true" />
                )}
              </button>
            </div>

            <p className="mt-4 text-sm text-slate-500" data-testid="agent-page-voice-status">
              {state === "connecting"
                ? "Connecting…"
                : state === "live"
                  ? "Tap to hang up"
                  : `Tap to talk with ${listing.name}`}
            </p>
          </>
        )}

        {notice ? (
          <p
            className="mt-5 w-full max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm leading-relaxed text-amber-900"
            data-testid="agent-page-voice-notice"
          >
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}
