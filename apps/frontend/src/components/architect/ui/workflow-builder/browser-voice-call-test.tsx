"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BROWSER_CALL_START_MESSAGE } from "@coreai/shared";
import { getArchitectVapiBrowserTestCallEndReason } from "@/components/architect/features/api";
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

type VapiEventName =
    | "call-start"
    | "call-end"
    | "speech-start"
    | "speech-end"
    | "message"
    | "error"
    | "volume-level";

type VapiWebClient = {
    start: (assistantId: string, overrides?: Record<string, unknown>) => Promise<unknown>;
    stop: () => void;
    on: (event: VapiEventName, listener: (payload?: unknown) => void) => unknown;
    off?: (event: VapiEventName, listener: (payload?: unknown) => void) => unknown;
    removeAllListeners?: (event?: VapiEventName) => unknown;
};

/**
 * One Vapi client per page, reused across calls and React Strict Mode
 * remounts. Creating a client per start() leaks listeners and mic handles.
 */
let sharedVapiClient: VapiWebClient | null = null;
let sharedVapiClientKey = "";

async function getSharedVapiClient(publicKey: string): Promise<VapiWebClient> {
    if (sharedVapiClient && sharedVapiClientKey === publicKey) {
        return sharedVapiClient;
    }

    if (sharedVapiClient) {
        try {
            sharedVapiClient.stop();
        } catch {
            // already stopped
        }
        try {
            sharedVapiClient.removeAllListeners?.();
        } catch {
            // no listeners
        }
    }

    const mod = await import("@vapi-ai/web");
    const VapiCtor = mod.default as unknown as new (key: string) => VapiWebClient;

    sharedVapiClient = new VapiCtor(publicKey);
    sharedVapiClientKey = publicKey;

    return sharedVapiClient;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Structured, secret-free diagnostics for the browser voice test. */
function logVapiEvent(event: string, details: Record<string, unknown> = {}) {
    console.info("[browser-call]", JSON.stringify({ event, at: new Date().toISOString(), ...details }));
}

function readVapiError(payload: unknown): string {
    const record = asRecord(payload);
    const nestedError = asRecord(record.error);
    const message =
        (typeof record.errorMsg === "string" && record.errorMsg) ||
        (typeof record.message === "string" && record.message) ||
        (typeof record.error === "string" && record.error) ||
        (typeof nestedError.message === "string" && nestedError.message);

    return message || "The Vapi browser call hit an error.";
}

function isMicPermissionError(name: string, message: string): boolean {
    return /notallowed|notfound|permission|denied|mic/i.test(`${name} ${message}`);
}

function friendlyVapiError(message: string): string {
    const m = message.toLowerCase();

    if (m.includes("ejection") || m.includes("ejected") || m.includes("meeting has ended")) {
        return "Voice test ended because the browser participant was removed from the Vapi meeting. Fetching the exact cause…";
    }

    if (isMicPermissionError("", m)) {
        return "Microphone access was blocked. Allow the microphone for this site in your browser settings, then start the call again.";
    }

    return message;
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
    onResetConversationTest,
    onCallEnded
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
    /** Fired when the Vapi voice call ends — lets the panel fetch the booked test event. */
    onCallEnded?: () => void;
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
    const detachVapiListenersRef = useRef<(() => void) | null>(null);
    const vapiCallIdRef = useRef("");
    const vapiSessionRef = useRef<ArchitectVapiBrowserTestSession | null>(null);
    const endReasonRequestedRef = useRef(false);
    const callActiveRef = useRef(false);
    const speechSupported = useMemo(() => canUseSpeechRecognition(), []);

    useEffect(() => {
        // Cleanup must not depend on per-render state: refs only, run once.
        return () => {
            callActiveRef.current = false;
            recognitionRef.current?.abort();
            detachVapiListenersRef.current?.();

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

    /**
     * After a call ends (normally or via ejection), ask the backend for the
     * real Vapi endedReason so failures show the actual cause instead of the
     * generic "Meeting ended due to ejection".
     */
    async function showRealEndReason(): Promise<void> {
        const callId = vapiCallIdRef.current;

        if (!callId || endReasonRequestedRef.current) return;

        endReasonRequestedRef.current = true;

        // endedReason lags call teardown by a moment — retry briefly.
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1200 : 2500));

            const res = await getArchitectVapiBrowserTestCallEndReason(callId);
            const endReason = res.success ? res.data?.endReason : null;

            if (!endReason?.endedReason) continue;

            logVapiEvent("ended-reason", {
                callId,
                assistantId: vapiSessionRef.current?.assistantId,
                endedReason: endReason.endedReason
            });

            const isFailure = /error|fail|eject/i.test(endReason.endedReason);

            if (isFailure) {
                setError(
                    endReason.message ||
                        `Voice test ended because the call failed: ${endReason.endedReason}`
                );
            }

            return;
        }
    }

    function detachVapiListeners() {
        detachVapiListenersRef.current?.();
    }

    async function startVapiMode(session: ArchitectVapiBrowserTestSession): Promise<void> {
        const client = await getSharedVapiClient(session.publicKey);

        // Exactly one active call: drop stale listeners from a previous call
        // and stop anything still running before starting the new one.
        detachVapiListeners();

        try {
            client.stop();
        } catch {
            // no active call
        }

        vapiClientRef.current = client;
        vapiSessionRef.current = session;
        vapiCallIdRef.current = "";
        endReasonRequestedRef.current = false;

        const safeIds = { assistantId: session.assistantId, businessId: session.businessId };

        const onCallStart = () => {
            logVapiEvent("call-start", { ...safeIds, callId: vapiCallIdRef.current });
            if (callActiveRef.current) setCallState("listening");
        };

        // State update only — never stop() here: the caller speaking is the
        // normal path and must keep the call alive.
        const onSpeechStart = () => {
            logVapiEvent("speech-start", { callId: vapiCallIdRef.current });
            if (callActiveRef.current) setCallState("speaking");
        };

        const onSpeechEnd = () => {
            logVapiEvent("speech-end", { callId: vapiCallIdRef.current });
            if (callActiveRef.current) setCallState("listening");
        };

        const onCallEnd = () => {
            logVapiEvent("call-end", { ...safeIds, callId: vapiCallIdRef.current });
            callActiveRef.current = false;
            setCallState("ended");
            void showRealEndReason();
            onCallEnded?.();
        };

        const onError = (payload?: unknown) => {
            const record = asRecord(payload);
            const message = readVapiError(payload);

            logVapiEvent("error", {
                ...safeIds,
                callId: vapiCallIdRef.current,
                errorName: typeof record.type === "string" ? record.type : undefined,
                errorMessage: message
            });

            setError(friendlyVapiError(message));
            callActiveRef.current = false;

            try {
                vapiClientRef.current?.stop();
            } catch {
                // already stopped
            }

            setCallState("ended");
            void showRealEndReason();
        };

        let lastVolumeLogAt = 0;
        const onVolumeLevel = () => {
            const now = Date.now();
            if (now - lastVolumeLogAt < 10000) return;
            lastVolumeLogAt = now;
            logVapiEvent("volume-level", { callId: vapiCallIdRef.current });
        };

        const onMessage = (payload?: unknown) => handleVapiMessage(payload);

        client.on("call-start", onCallStart);
        client.on("speech-start", onSpeechStart);
        client.on("speech-end", onSpeechEnd);
        client.on("call-end", onCallEnd);
        client.on("error", onError);
        client.on("volume-level", onVolumeLevel);
        client.on("message", onMessage);

        detachVapiListenersRef.current = () => {
            detachVapiListenersRef.current = null;

            try {
                if (client.off) {
                    client.off("call-start", onCallStart);
                    client.off("speech-start", onSpeechStart);
                    client.off("speech-end", onSpeechEnd);
                    client.off("call-end", onCallEnd);
                    client.off("error", onError);
                    client.off("volume-level", onVolumeLevel);
                    client.off("message", onMessage);
                } else {
                    client.removeAllListeners?.();
                }
            } catch {
                // listeners already gone
            }
        };

        const started = await client.start(session.assistantId, {
            metadata: { businessId: session.businessId, purpose: "ARCHITECT_TEST" }
        });

        vapiCallIdRef.current = typeof asRecord(started).id === "string" ? (asRecord(started).id as string) : "";
        logVapiEvent("start-resolved", { ...safeIds, callId: vapiCallIdRef.current });

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
                const errorName = startError instanceof Error ? startError.name : "";
                const errorMessage = startError instanceof Error ? startError.message : String(startError);

                logVapiEvent("start-failed", { assistantId: result.assistantId, errorName, errorMessage });
                detachVapiListeners();

                if (isMicPermissionError(errorName, errorMessage)) {
                    callActiveRef.current = false;
                    setCallState("idle");
                    setError(
                        "Microphone access was blocked. Allow the microphone for this site in your browser settings, then start the call again."
                    );
                    return;
                }

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

        logVapiEvent("manual-end", { callId: vapiCallIdRef.current });

        try {
            vapiClientRef.current?.stop();
        } catch {
            // already stopped
        }

        // The client itself is a page-level singleton and stays reusable —
        // only this call's listeners are detached (once).
        detachVapiListeners();

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

                        {vapiSession?.modelNotice ? (
                            <p
                                className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
                                data-testid="builder-browser-call-model-notice"
                            >
                                {vapiSession.modelNotice}
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
