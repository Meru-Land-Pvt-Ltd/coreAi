"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BROWSER_CALL_START_MESSAGE } from "@coreai/shared";
import type {
    ArchitectConversationMessage,
    ArchitectVapiBrowserTestSession
} from "@/components/architect/features/types";
import { BuilderIcon } from "./icons";

/* ------------------------- fallback speech (browser) ---------------------- */
/* Browser SpeechRecognition + speechSynthesis are used ONLY in fallback      */
/* simulation mode. In Vapi mode the Vapi web SDK handles all audio.          */

type SpeechRecognitionResultLike = {
    isFinal: boolean;
    0: { transcript: string };
};

type SpeechRecognitionEventLike = {
    results: {
        length: number;
        [index: number]: SpeechRecognitionResultLike;
    };
};

type SpeechRecognitionErrorLike = {
    error?: string;
    message?: string;
};

type SpeechRecognitionLike = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type WindowWithSpeech = Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function canUseSpeechRecognition(): boolean {
    if (typeof window === "undefined") return false;

    const speechWindow = window as WindowWithSpeech;
    return Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition);
}

function createSpeechRecognition(): SpeechRecognitionLike | null {
    if (typeof window === "undefined") return null;

    const speechWindow = window as WindowWithSpeech;
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();

    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    return recognition;
}

function speakText(text: string): Promise<void> {
    return new Promise((resolve) => {
        if (typeof window === "undefined" || !window.speechSynthesis || !text.trim()) {
            resolve();
            return;
        }

        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();

        window.speechSynthesis.speak(utterance);
    });
}

/* ------------------------------ Vapi web SDK ------------------------------ */

type VapiEventName = "call-start" | "call-end" | "speech-start" | "speech-end" | "message" | "error";

type VapiWebClient = {
    start: (assistantId: string, overrides?: Record<string, unknown>) => Promise<unknown>;
    stop: () => void;
    on: (event: VapiEventName, listener: (payload?: unknown) => void) => unknown;
};

async function createVapiClient(publicKey: string): Promise<VapiWebClient> {
    const mod = await import("@vapi-ai/web");
    const VapiCtor = mod.default as unknown as new (key: string) => VapiWebClient;

    return new VapiCtor(publicKey);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readVapiError(payload: unknown): string {
    const record = asRecord(payload);
    const message =
        (typeof record.errorMsg === "string" && record.errorMsg) ||
        (typeof record.message === "string" && record.message) ||
        (typeof record.error === "string" && record.error);

    return message || "The Vapi browser call hit an error.";
}

/* --------------------------------- helpers -------------------------------- */

type CallState = "idle" | "starting" | "listening" | "thinking" | "speaking" | "ended";
type CallMode = "vapi" | "fallback" | null;

function shortTime(value?: string): string {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function cleanTranscript(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function callStateLabel(state: CallState): string {
    if (state === "starting") return "Starting call...";
    if (state === "listening") return "Listening...";
    if (state === "thinking") return "Agent is thinking...";
    if (state === "speaking") return "Agent is speaking...";
    if (state === "ended") return "Call ended";
    return "Ready";
}

function callStateBadgeClass(state: CallState): string {
    if (state === "listening") return "bg-green-100 text-green-700";
    if (state === "thinking") return "bg-amber-100 text-amber-700";
    if (state === "speaking") return "bg-amber-100 text-amber-700";
    if (state === "ended") return "bg-slate-100 text-slate-600";
    if (state === "starting") return "bg-blue-100 text-blue-700";
    return "bg-slate-100 text-slate-500";
}

export function BrowserVoiceCallTest({
    conversationMessages,
    chatting,
    businessName,
    businessType,
    callerName,
    appointmentService,
    onStartVapiCall,
    onSendConversationMessage,
    onResetConversationTest
}: {
    conversationMessages: ArchitectConversationMessage[];
    chatting: boolean;
    businessName: string;
    businessType: string;
    callerName: string;
    appointmentService: string;
    /** Prepares a Vapi web-call session; returns an error reason when unavailable. */
    onStartVapiCall: () => Promise<ArchitectVapiBrowserTestSession | { error: string }>;
    onSendConversationMessage: (value: string) => Promise<string | null>;
    onResetConversationTest: () => void;
}) {
    const [callState, setCallState] = useState<CallState>("idle");
    const [mode, setMode] = useState<CallMode>(null);
    const [vapiSession, setVapiSession] = useState<ArchitectVapiBrowserTestSession | null>(null);
    const [vapiTranscript, setVapiTranscript] = useState<ArchitectConversationMessage[]>([]);
    const [fallbackReason, setFallbackReason] = useState("");
    const [partialTranscript, setPartialTranscript] = useState("");
    const [typedFallback, setTypedFallback] = useState("");
    const [error, setError] = useState("");
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const vapiClientRef = useRef<VapiWebClient | null>(null);
    const callActiveRef = useRef(false);
    const speechSupported = useMemo(() => canUseSpeechRecognition(), []);

    useEffect(() => {
        return () => {
            callActiveRef.current = false;
            recognitionRef.current?.abort();

            try {
                vapiClientRef.current?.stop();
            } catch {
                // best-effort cleanup
            }

            if (typeof window !== "undefined" && window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
        };
    }, []);

    /* ------------------------------ Vapi mode ------------------------------ */

    function handleVapiMessage(payload: unknown) {
        const record = asRecord(payload);

        if (record.type !== "transcript") return;

        const role = record.role === "assistant" ? "assistant" : "user";
        const text = typeof record.transcript === "string" ? cleanTranscript(record.transcript) : "";

        if (!text) return;

        if (record.transcriptType === "partial") {
            if (role === "user") setPartialTranscript(text);
            return;
        }

        setVapiTranscript((current) => [
            ...current,
            { role, content: text, createdAt: new Date().toISOString() }
        ]);

        // A final user transcript means the assistant is now working on a reply.
        if (role === "user" && callActiveRef.current) {
            setCallState("thinking");
        }
    }

    async function startVapiMode(session: ArchitectVapiBrowserTestSession): Promise<void> {
        const client = await createVapiClient(session.publicKey);

        vapiClientRef.current = client;

        client.on("call-start", () => {
            if (callActiveRef.current) setCallState("listening");
        });
        client.on("speech-start", () => {
            if (callActiveRef.current) setCallState("speaking");
        });
        client.on("speech-end", () => {
            if (callActiveRef.current) setCallState("listening");
        });
        client.on("call-end", () => {
            callActiveRef.current = false;
            setCallState("ended");
        });
        client.on("error", (payload) => {
            const message = readVapiError(payload);

            setError(message);
            callActiveRef.current = false;

            try {
                vapiClientRef.current?.stop();
            } catch {
                // already stopped
            }

            vapiClientRef.current = null;
            setCallState("ended");
        });
        client.on("message", handleVapiMessage);

        await client.start(session.assistantId, {
            metadata: { businessId: session.businessId, purpose: "ARCHITECT_TEST" }
        });

        setMode("vapi");
        setVapiSession(session);
    }

    /* ---------------------------- fallback mode ---------------------------- */

    async function speakAndReturnToReady(reply: string | null) {
        const cleanReply = reply?.trim();

        if (!cleanReply) {
            setCallState(callActiveRef.current ? "idle" : "ended");
            return;
        }

        setCallState("speaking");
        await speakText(cleanReply);

        if (callActiveRef.current) {
            setCallState("idle");
        } else {
            setCallState("ended");
        }
    }

    async function sendUtterance(value: string) {
        const cleanValue = cleanTranscript(value);

        if (!cleanValue || chatting) return;

        setError("");
        setPartialTranscript("");
        setCallState("thinking");

        const reply = await onSendConversationMessage(cleanValue);

        await speakAndReturnToReady(reply);
    }

    async function startFallbackMode(reason: string): Promise<void> {
        setMode("fallback");
        setFallbackReason(reason);

        const greeting = await onSendConversationMessage(BROWSER_CALL_START_MESSAGE);

        if (!greeting?.trim()) {
            callActiveRef.current = false;
            setCallState("idle");
            setError("Could not start the browser call. Save the agent, then try again.");
            return;
        }

        await speakAndReturnToReady(greeting);
    }

    /* ------------------------------ call control --------------------------- */

    async function startBrowserCall() {
        // Guard against double clicks so the greeting is only spoken once.
        if (callActiveRef.current || chatting) return;

        setError("");
        setFallbackReason("");
        setPartialTranscript("");
        setVapiTranscript([]);
        setVapiSession(null);
        setMode(null);
        onResetConversationTest();

        callActiveRef.current = true;
        setCallState("starting");

        // Vapi web call is the primary path — the agent runs with its real
        // voice, model, and transcriber. Local simulation only on failure.
        const result = await onStartVapiCall();

        if ("publicKey" in result && result.publicKey && result.assistantId) {
            try {
                await startVapiMode(result);
                return;
            } catch (startError) {
                console.error("[browser-call] Vapi web call failed; using fallback simulation", startError);
                await startFallbackMode("Vapi assistant could not start");
                return;
            }
        }

        await startFallbackMode(result && "error" in result && result.error ? result.error : "Vapi public key missing");
    }

    function endBrowserCall() {
        callActiveRef.current = false;
        recognitionRef.current?.abort();
        recognitionRef.current = null;
        setPartialTranscript("");

        try {
            vapiClientRef.current?.stop();
        } catch {
            // already stopped
        }

        vapiClientRef.current = null;

        if (typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }

        setCallState("ended");
    }

    function resetCall() {
        endBrowserCall();
        setMode(null);
        setVapiSession(null);
        setVapiTranscript([]);
        setFallbackReason("");
        setError("");
        setCallState("idle");
        onResetConversationTest();
    }

    /* -------------------------- fallback mic control ----------------------- */

    function startListening() {
        if (!callActiveRef.current) {
            setError("Start the browser call first.");
            return;
        }

        if (!speechSupported) {
            setError("Your browser does not support microphone speech recognition. Use Chrome or Edge, or use the fallback input.");
            return;
        }

        if (callState === "listening" || callState === "thinking" || callState === "speaking") return;

        const recognition = createSpeechRecognition();

        if (!recognition) {
            setError("Speech recognition is not available in this browser.");
            return;
        }

        recognitionRef.current = recognition;
        setPartialTranscript("");

        recognition.onstart = () => {
            setError("");
            setCallState("listening");
        };

        recognition.onerror = (event) => {
            const message = event.message || event.error || "Microphone recognition failed.";
            setError(message);
            setPartialTranscript("");
            setCallState(callActiveRef.current ? "idle" : "ended");
        };

        recognition.onend = () => {
            setCallState((current) => {
                if (current !== "listening") return current;
                return callActiveRef.current ? "idle" : "ended";
            });
        };

        recognition.onresult = (event) => {
            let interim = "";
            let finalTranscript = "";

            for (let index = 0; index < event.results.length; index += 1) {
                const result = event.results[index];
                const transcript = result?.[0]?.transcript ?? "";

                if (result?.isFinal) {
                    finalTranscript += transcript;
                } else {
                    interim += transcript;
                }
            }

            setPartialTranscript(cleanTranscript(interim || finalTranscript));

            const cleanFinal = cleanTranscript(finalTranscript);

            if (cleanFinal) {
                recognition.stop();
                void sendUtterance(cleanFinal);
            }
        };

        try {
            recognition.start();
        } catch {
            setError("Could not start microphone. Check browser permission and try again.");
            setCallState(callActiveRef.current ? "idle" : "ended");
        }
    }

    function stopListening() {
        recognitionRef.current?.stop();
        setPartialTranscript("");
        setCallState(callActiveRef.current ? "idle" : "ended");
    }

    async function sendTypedFallback() {
        const value = typedFallback.trim();

        if (!value) return;

        setTypedFallback("");
        await sendUtterance(value);
    }

    const callActive = callActiveRef.current || callState === "starting" || callState === "listening" || callState === "thinking" || callState === "speaking";
    const canSpeak = callActive && callState !== "starting" && callState !== "thinking" && callState !== "speaking";
    const isVapiMode = mode === "vapi";
    const isFallbackMode = mode === "fallback";
    const transcriptMessages = isVapiMode ? vapiTranscript : conversationMessages;
    const hasMessages = transcriptMessages.length > 0;
    return (
        <div
            className="mt-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
            data-testid="builder-browser-voice-call-test"
        >
            <div className="border-b border-gray-100 bg-gradient-to-br from-slate-50/50 via-white to-amber-50/10 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500 text-white shadow-sm">
                                <BuilderIcon name="phone-call" className="h-5 w-5" />
                            </span>

                            <div>
                                <h3 className="text-sm font-black text-slate-900" data-testid="builder-browser-call-title">
                                    Browser call test
                                </h3>
                                <p className="mt-0.5 text-xs font-semibold text-slate-500">
                                    No Twilio phone call. Voice is powered by Vapi in the browser. Booking and SMS stay dry-run.
                                </p>
                            </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2 text-xs">
                            <span className={`rounded-full px-3 py-1 font-bold ${callStateBadgeClass(callState)}`}>
                                {callStateLabel(callState)}
                            </span>

                            {isVapiMode && vapiSession ? (
                                <>
                                    <span
                                        className="rounded-full bg-amber-500 px-3 py-1 font-bold text-white"
                                        data-testid="builder-browser-call-provider-badge"
                                    >
                                        Powered by Vapi
                                    </span>
                                    <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-slate-600 ring-1 ring-gray-200" data-testid="builder-browser-call-vapi-voice">
                                        Voice: {vapiSession.voiceName}
                                    </span>
                                    <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-slate-600 ring-1 ring-gray-200" data-testid="builder-browser-call-vapi-model">
                                        Model: {vapiSession.model}
                                    </span>
                                    <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-slate-600 ring-1 ring-gray-200" data-testid="builder-browser-call-vapi-transcriber">
                                        Transcriber: {vapiSession.transcriber}
                                    </span>
                                </>
                            ) : isFallbackMode ? (
                                <>
                                    <span
                                        className="rounded-full bg-amber-100 px-3 py-1 font-bold text-amber-700"
                                        data-testid="builder-browser-call-provider-badge"
                                    >
                                        Fallback browser simulation
                                    </span>
                                    {fallbackReason ? (
                                        <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-slate-500 ring-1 ring-gray-200" data-testid="builder-browser-call-fallback-reason">
                                            {fallbackReason}
                                        </span>
                                    ) : null}
                                </>
                            ) : (
                                <>
                                    <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-slate-600 ring-1 ring-gray-200">
                                        {businessName || "Sample Business"}
                                    </span>
                                    <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-slate-600 ring-1 ring-gray-200">
                                        {businessType || "Service Business"}
                                    </span>
                                </>
                            )}
                        </div>

                        {vapiSession?.unresolvedVariables?.length ? (
                            <p
                                className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
                                data-testid="builder-browser-call-unresolved-variables"
                            >
                                Unresolved variables removed from the prompt:{" "}
                                {vapiSession.unresolvedVariables.map((name) => `{{${name}}}`).join(", ")}. Check the
                                spelling on the AI Voice Conversation node.
                            </p>
                        ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                        {!callActive ? (
                            <button
                                type="button"
                                onClick={() => void startBrowserCall()}
                                disabled={chatting}
                                data-testid="builder-browser-call-start"
                                className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-50"
                            >
                                Start call
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={endBrowserCall}
                                data-testid="builder-browser-call-end"
                                className="rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700"
                            >
                                End call
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={resetCall}
                            disabled={chatting && !hasMessages}
                            data-testid="builder-browser-call-reset"
                            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-gray-50 disabled:opacity-50"
                        >
                            Reset
                        </button>
                    </div>
                </div>

                <div className="mt-5 flex justify-center">
                    <button
                        type="button"
                        onClick={isVapiMode ? undefined : callState === "listening" ? stopListening : startListening}
                        disabled={isVapiMode || !callActive || callState === "starting" || callState === "thinking" || callState === "speaking"}
                        data-testid="builder-browser-call-mic"
                        className={`grid h-24 w-24 place-items-center rounded-full text-white shadow-lg transition disabled:opacity-40 ${callState === "listening"
                                ? "animate-pulse bg-green-600 hover:bg-green-700 disabled:opacity-100"
                                : callState === "speaking"
                                    ? "animate-pulse bg-amber-500 disabled:opacity-100"
                                    : callState === "thinking"
                                        ? "animate-pulse bg-amber-400 disabled:opacity-100"
                                        : "bg-slate-900 hover:bg-slate-800"
                            }`}
                        aria-label={isVapiMode ? "Live call status" : callState === "listening" ? "Stop listening" : "Speak"}
                    >
                        <BuilderIcon name={callState === "listening" ? "square" : "mic"} className="h-8 w-8" />
                    </button>
                </div>

                <p className="mt-3 text-center text-xs font-semibold text-slate-500">
                    {callActive
                        ? isVapiMode
                            ? callState === "speaking"
                                ? "The agent is speaking — you can interrupt naturally."
                                : "Just speak — the agent hears you live."
                            : callState === "listening"
                                ? "Listening now..."
                                : canSpeak
                                    ? "Tap the mic and speak as the caller."
                                    : callStateLabel(callState)
                        : "Start the call to test the agent by voice."}
                </p>

                {partialTranscript ? (
                    <p
                        className="mx-auto mt-3 max-w-xl rounded-2xl bg-white px-4 py-3 text-center text-sm font-semibold text-slate-700 ring-1 ring-gray-200"
                        data-testid="builder-browser-call-partial"
                    >
                        {partialTranscript}
                    </p>
                ) : null}

                {error ? (
                    <div
                        className="mx-auto mt-3 max-w-xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800"
                        data-testid="builder-browser-call-error"
                    >
                        {error}
                    </div>
                ) : null}

                {isFallbackMode && !speechSupported ? (
                    <div className="mx-auto mt-4 max-w-xl rounded-2xl border border-gray-100 bg-white p-3">
                        <p className="text-xs font-semibold text-slate-500">
                            Mic speech recognition is not available in this browser. Use Chrome/Edge or fallback input.
                        </p>
                        <div className="mt-2 flex gap-2">
                            <input
                                value={typedFallback}
                                onChange={(event) => setTypedFallback(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        void sendTypedFallback();
                                    }
                                }}
                                placeholder="Fallback test message..."
                                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/20"
                            />
                            <button
                                type="button"
                                onClick={() => void sendTypedFallback()}
                                disabled={!typedFallback.trim() || chatting}
                                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-amber-600 transition"
                            >
                                Send
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="min-h-[360px] bg-slate-50 p-5">
                <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400">
                        Live transcript
                    </p>
                    <p className="text-xs font-semibold text-slate-400">
                        Caller: {callerName || "Test caller"} • Service: {appointmentService || "Consultation"}
                    </p>
                </div>

                {hasMessages ? (
                    <div className="space-y-3" data-testid="builder-browser-call-transcript">
                        {transcriptMessages.map((message, index) => (
                            <div
                                key={`${message.role}-${index}-${message.createdAt ?? ""}`}
                                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                                data-testid={`builder-browser-call-message-${message.role}`}
                            >
                                <div
                                    className={`max-w-[84%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${message.role === "user"
                                            ? "rounded-br-md bg-amber-500 text-white"
                                            : "rounded-bl-md bg-white text-slate-800 ring-1 ring-gray-100"
                                        }`}
                                >
                                    <div>{message.content}</div>
                                    {message.createdAt ? (
                                        <div className={`mt-1 text-[10px] ${message.role === "user" ? "text-amber-100" : "text-slate-400"}`}>
                                            {shortTime(message.createdAt)}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid h-[300px] place-items-center text-center">
                        <div>
                            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-500">
                                <BuilderIcon name="sparkles" className="h-6 w-6" />
                            </div>
                            <p className="mt-3 text-sm font-black text-slate-700">No conversation yet</p>
                            <p className="mt-1 text-xs text-slate-400">
                                Click Start call, then speak into your mic.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
