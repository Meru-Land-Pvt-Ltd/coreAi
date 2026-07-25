"use client";

import { useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/api";

type DemoSession = {
    publicKey: string;
    assistantId: string;
    listingId: string;
    listingName: string;
    assistantName: string;
    demoBusinessName: string;
    maxDurationSeconds: number;
    remainingDemosToday: number;
    demo: true;
};

type VapiEventName = "call-start" | "call-end" | "speech-start" | "speech-end" | "error";

type VapiWebClient = {
    start: (assistantId: string, overrides?: Record<string, unknown>) => Promise<unknown>;
    stop: () => void;
    on: (event: VapiEventName, listener: (payload?: unknown) => void) => unknown;
    off?: (event: VapiEventName, listener: (payload?: unknown) => void) => unknown;
    removeAllListeners?: (event?: VapiEventName) => unknown;
};

let sharedDemoClient: VapiWebClient | null = null;
let sharedDemoClientKey = "";

async function getDemoVapiClient(publicKey: string): Promise<VapiWebClient> {
    if (sharedDemoClient && sharedDemoClientKey === publicKey) return sharedDemoClient;

    if (sharedDemoClient) {
        try {
            sharedDemoClient.stop();
        } catch {
            // already stopped
        }
        try {
            sharedDemoClient.removeAllListeners?.();
        } catch {
            // no listeners
        }
    }

    const mod = await import("@vapi-ai/web");
    const VapiCtor = mod.default as unknown as new (key: string) => VapiWebClient;

    sharedDemoClient = new VapiCtor(publicKey);
    sharedDemoClientKey = publicKey;

    return sharedDemoClient;
}

type DemoState = "idle" | "starting" | "live" | "ended";

export function AgentDemoCall({
    listingId,
    listingName,
    /** Public visitors are IP-limited (2 × 2 min). Authenticated buyers use the business route. */
    mode = "public"
}: {
    listingId: string;
    listingName: string;
    mode?: "public" | "authenticated";
}) {
    const [state, setState] = useState<DemoState>("idle");
    const [message, setMessage] = useState("");
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [agentSpeaking, setAgentSpeaking] = useState(false);
    const [remainingDemos, setRemainingDemos] = useState<number | null>(null);

    const clientRef = useRef<VapiWebClient | null>(null);
    const detachRef = useRef<(() => void) | null>(null);
    const startInFlightRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        return () => {
            detachRef.current?.();
            if (timerRef.current) clearInterval(timerRef.current);
            try {
                clientRef.current?.stop();
            } catch {
                // best-effort cleanup
            }
        };
    }, []);

    function stopTimer() {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }

    function endDemo() {
        stopTimer();
        detachRef.current?.();
        try {
            clientRef.current?.stop();
        } catch {
            // already stopped
        }
        setAgentSpeaking(false);
        setState("ended");
    }

    async function startDemo() {
        if (startInFlightRef.current || state === "starting" || state === "live") return;

        startInFlightRef.current = true;
        setMessage("");
        setState("starting");

        try {
            const endpoint =
                mode === "authenticated"
                    ? `/business/marketplace/listings/${encodeURIComponent(listingId)}/demo-call`
                    : `/architect/listings/public/${encodeURIComponent(listingId)}/demo-call`;

            const res = await apiPost<{ session: DemoSession }>(endpoint, {});

            if (!res.success || !res.data?.session) {
                setState("idle");
                setMessage(res.error ?? "The live demo is unavailable right now. You can still buy and test with your own business details.");
                return;
            }

            const session = res.data.session;
            setRemainingDemos(session.remainingDemosToday);

            const client = await getDemoVapiClient(session.publicKey);

            detachRef.current?.();
            try {
                client.stop();
            } catch {
                // no active call
            }
            clientRef.current = client;

            const onCallStart = () => {
                setState("live");
                setSecondsLeft(session.maxDurationSeconds);

                stopTimer();
                timerRef.current = setInterval(() => {
                    setSecondsLeft((current) => {
                        if (current <= 1) {
                            endDemo();
                            return 0;
                        }
                        return current - 1;
                    });
                }, 1000);
            };
            const onSpeechStart = () => setAgentSpeaking(true);
            const onSpeechEnd = () => setAgentSpeaking(false);
            const onCallEnd = () => endDemo();
            const onError = () => {
                setMessage("The demo call hit a problem. Try again, or buy the agent to test it with your own setup.");
                endDemo();
            };

            client.on("call-start", onCallStart);
            client.on("speech-start", onSpeechStart);
            client.on("speech-end", onSpeechEnd);
            client.on("call-end", onCallEnd);
            client.on("error", onError);

            detachRef.current = () => {
                detachRef.current = null;
                try {
                    if (client.off) {
                        client.off("call-start", onCallStart);
                        client.off("speech-start", onSpeechStart);
                        client.off("speech-end", onSpeechEnd);
                        client.off("call-end", onCallEnd);
                        client.off("error", onError);
                    } else {
                        client.removeAllListeners?.();
                    }
                } catch {
                    // listeners already gone
                }
            };

            await client.start(session.assistantId, {
                metadata: { listingId: session.listingId, purpose: "MARKETPLACE_DEMO" }
            });
        } catch (error) {
            const text = error instanceof Error ? error.message : "";
            setMessage(
                /notallowed|permission|denied/i.test(text)
                    ? "Microphone access was blocked. Allow the microphone for this site, then try the demo again."
                    : "Could not start the demo call. Please try again."
            );
            detachRef.current?.();
            setState("idle");
        } finally {
            startInFlightRef.current = false;
        }
    }

    const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

    return (
        <div
            className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4"
            data-testid="agent-demo-call"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-bold text-slate-900" data-testid="agent-demo-call-title">
                        Try a live demo
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                        {mode === "public"
                            ? `Talk to a 2-minute sample of ${listingName} — up to 2 demos per day from your network. Demo data only; your real setup comes after purchase.`
                            : `Talk to a live sample of ${listingName} — demo data only; your real setup comes after purchase.`}
                    </p>
                </div>

                {state === "live" ? (
                    <div className="flex items-center gap-3">
                        <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${agentSpeaking ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}
                            data-testid="agent-demo-call-status"
                        >
                            {agentSpeaking ? "Agent speaking…" : "Listening — just talk"}
                        </span>
                        <span className="font-mono text-xs font-semibold tabular-nums text-slate-500">{clock}</span>
                        <button
                            type="button"
                            onClick={endDemo}
                            data-testid="agent-demo-call-end"
                            className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
                        >
                            End demo
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => void startDemo()}
                        disabled={state === "starting"}
                        data-testid="agent-demo-call-start"
                        className="rounded-xl border-2 border-amber-500 px-5 py-2.5 text-sm font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white disabled:opacity-50"
                    >
                        {state === "starting" ? "Connecting…" : state === "ended" ? "Try demo again" : "Try a live demo"}
                    </button>
                )}
            </div>

            {message ? (
                <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-200" data-testid="agent-demo-call-message">
                    {message}
                </p>
            ) : null}

            {state === "ended" && !message ? (
                <p className="mt-3 text-xs font-semibold text-slate-500" data-testid="agent-demo-call-ended-note">
                    Demo ended{typeof remainingDemos === "number" ? ` — ${remainingDemos} demo${remainingDemos === 1 ? "" : "s"} left today` : ""}. Buy the agent to configure it with your own business, number, and calendar.
                </p>
            ) : null}
        </div>
    );
}
