"use client";

import { useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/api";
import { getAgentDemoProfile } from "@/components/common/agent-demo-profile";

type DemoSession = {
    publicKey: string;
    assistantId: string;
    assistantOverrides?: Record<string, unknown>;
    listingId: string;
    listingName: string;
    assistantName: string;
    demoBusinessName: string;
    maxDurationSeconds: number;
    remainingDemosToday: number;
    demo: true;
};

type VapiEventName = "call-start" | "call-end" | "speech-start" | "speech-end" | "message" | "error";

type VapiWebClient = {
    start: (assistantId: string, overrides?: Record<string, unknown>) => Promise<unknown>;
    stop: () => void | Promise<void>;
    on: (event: VapiEventName, listener: (payload?: unknown) => void) => unknown;
    off?: (event: VapiEventName, listener: (payload?: unknown) => void) => unknown;
    removeAllListeners?: (event?: VapiEventName) => unknown;
};

let sharedDemoClient: VapiWebClient | null = null;
let sharedDemoClientKey = "";

async function stopDemoVapiClient(client: VapiWebClient | null): Promise<void> {
    if (!client) return;
    try {
        await client.stop();
    } catch {
        // already stopped
    }
}

async function getDemoVapiClient(publicKey: string): Promise<VapiWebClient> {
    if (sharedDemoClient && sharedDemoClientKey === publicKey) return sharedDemoClient;

    if (sharedDemoClient) {
        await stopDemoVapiClient(sharedDemoClient);
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

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function readVapiError(payload: unknown): string {
    const record = asRecord(payload);
    const error = asRecord(record.error);
    const nestedError = asRecord(error.error);
    const errorMessage = error.message;

    return (
        (typeof record.errorMsg === "string" && record.errorMsg) ||
        (typeof record.message === "string" && record.message) ||
        (typeof record.error === "string" && record.error) ||
        (typeof error.errorMsg === "string" && error.errorMsg) ||
        (typeof errorMessage === "string" && errorMessage) ||
        (typeof asRecord(errorMessage).msg === "string" && (asRecord(errorMessage).msg as string)) ||
        (typeof nestedError.message === "string" && nestedError.message) ||
        "The Vapi browser call hit an error."
    );
}

function demoEndReasonMessage(reason: string): string | null {
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

    if (normalized.includes("requested-payment") || normalized.includes("insufficient") || normalized.includes("billing")) {
        return "The demo voice service is temporarily unavailable. Please try again shortly.";
    }

    if (normalized.includes("did-not-receive-customer-audio") || normalized.includes("microphone")) {
        return "The demo could not hear your microphone. Check the browser microphone permission and input device, then try again.";
    }

    if (normalized.includes("assistant-not-found") || normalized.includes("invalid-assistant")) {
        return "The demo session expired. Please try the demo again.";
    }

    if (normalized.includes("pipeline-error") || normalized.includes("providerfault") || normalized.includes("provider-fault")) {
        return "The demo voice service had a temporary provider problem. Please try again shortly.";
    }

    return "The demo call ended unexpectedly. Please try again.";
}

type DemoState = "idle" | "starting" | "live" | "ended";

export type DemoCallCustomInputs = {
    businessName?: string;
    contactName?: string;
    address?: string;
    services?: string;
};

export function AgentDemoCall({
    listingId,
    listingName,
    industry,
    subindustry,
    /** Public visitors are IP-limited (2 × 2 min). Authenticated buyers use the business route. */
    mode = "public"
}: {
    listingId: string;
    listingName: string;
    industry?: string;
    subindustry?: string;
    mode?: "public" | "authenticated";
}) {
    const [state, setState] = useState<DemoState>("idle");
    const [message, setMessage] = useState("");
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [agentSpeaking, setAgentSpeaking] = useState(false);
    const [remainingDemos, setRemainingDemos] = useState<number | null>(null);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [businessName, setBusinessName] = useState("");
    const [contactName, setContactName] = useState("");
    const [address, setAddress] = useState("");
    const [services, setServices] = useState("");

    const demoProfile = getAgentDemoProfile({ listingName, industry, subindustry });

    const clientRef = useRef<VapiWebClient | null>(null);
    const detachRef = useRef<(() => void) | null>(null);
    const startInFlightRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        return () => {
            detachRef.current?.();
            if (timerRef.current) clearInterval(timerRef.current);
            try {
                void stopDemoVapiClient(clientRef.current);
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
        void stopDemoVapiClient(clientRef.current);
        setAgentSpeaking(false);
        setState("ended");
    }

    async function startDemo(customInputs?: DemoCallCustomInputs) {
        if (startInFlightRef.current || state === "starting" || state === "live") return;

        startInFlightRef.current = true;
        setIsModalOpen(false);
        setMessage("");
        setState("starting");

        try {
            const endpoint =
                mode === "authenticated"
                    ? `/business/marketplace/listings/${encodeURIComponent(listingId)}/demo-call`
                    : `/architect/listings/public/${encodeURIComponent(listingId)}/demo-call`;

            const payload: DemoCallCustomInputs = customInputs ?? {
                businessName: businessName.trim() || undefined,
                contactName: contactName.trim() || undefined,
                address: address.trim() || undefined,
                services: services.trim() || undefined
            };

            const res = await apiPost<{ session: DemoSession }>(endpoint, payload);

            if (!res.success || !res.data?.session) {
                setState("idle");
                setMessage(res.error ?? "The live demo is unavailable right now. You can still buy and test with your own business details.");
                return;
            }

            const session = res.data.session;
            setRemainingDemos(session.remainingDemosToday);

            const client = await getDemoVapiClient(session.publicKey);

            detachRef.current?.();
            await stopDemoVapiClient(client);
            clientRef.current = client;

            let failureHandled = false;

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
            const onMessage = (payload?: unknown) => {
                const event = asRecord(payload);
                if (event.type !== "status-update" || event.status !== "ended") return;

                const endedReason = typeof event.endedReason === "string" ? event.endedReason : "";
                const friendlyMessage = demoEndReasonMessage(endedReason);
                if (friendlyMessage) {
                    failureHandled = true;
                    console.warn("[marketplace-demo] Vapi call ended", { endedReason });
                    setMessage(friendlyMessage);
                }
                endDemo();
            };
            const onError = (payload?: unknown) => {
                if (failureHandled) return;

                const errorText = readVapiError(payload);
                const errorType = asRecord(payload).type;
                failureHandled = true;
                console.warn("[marketplace-demo] Vapi browser error", {
                    errorType: typeof errorType === "string" ? errorType : "unknown",
                    errorMessage: errorText
                });
                setMessage(
                    /notallowed|notfound|permission|denied|microphone|\bmic\b/i.test(errorText)
                        ? "Microphone access was blocked. Allow the microphone for this site, then try the demo again."
                        : /eject|meeting has ended/i.test(errorText)
                            ? "The demo voice service ended the call unexpectedly. Please try again shortly."
                            : "The demo call hit a problem. Please try again."
                );
                endDemo();
            };

            client.on("call-start", onCallStart);
            client.on("speech-start", onSpeechStart);
            client.on("speech-end", onSpeechEnd);
            client.on("call-end", onCallEnd);
            client.on("message", onMessage);
            client.on("error", onError);

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
                    } else {
                        client.removeAllListeners?.();
                    }
                } catch {
                    // listeners already gone
                }
            };

            const startOverrides = {
                ...(session.assistantOverrides ?? {}),
                metadata: { listingId: session.listingId, purpose: "MARKETPLACE_DEMO" }
            };

            const started = await client.start(session.assistantId, startOverrides);
            if (!started && !failureHandled) {
                failureHandled = true;
                setMessage("Could not start the demo call. Please try again.");
                endDemo();
            }
        } catch (error) {
            const text = error instanceof Error ? error.message : "";
            setMessage(
                /notallowed|permission|denied/i.test(text)
                    ? "Microphone access was blocked. Allow the microphone for this site, then try the demo again."
                    : "Could not start the demo call. Please try again."
            );
            detachRef.current?.();
            await stopDemoVapiClient(clientRef.current);
            setState("idle");
        } finally {
            startInFlightRef.current = false;
        }
    }

    const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

    return (
        <>
            <div
                className="mt-4 rounded-2xl border border-amber-200/90 bg-amber-50/70 p-4 sm:p-4.5 transform-gpu [backface-visibility:hidden]"
                data-testid="agent-demo-call"
            >
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse transform-gpu" />
                            <p className="text-sm font-bold text-slate-900" data-testid="agent-demo-call-title">
                                Try a live demo call
                            </p>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-700">
                            {mode === "public"
                                ? `Speak with a live sample of ${listingName} right in your browser (2-minute demo call).`
                                : `Speak with a live sample of ${listingName} right in your browser.`}
                        </p>
                    </div>

                    {state === "live" ? (
                        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:gap-3">
                            <span
                                className={`rounded-full px-3 py-1 text-xs font-bold ${agentSpeaking ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}
                                data-testid="agent-demo-call-status"
                            >
                                {agentSpeaking ? "Agent speaking…" : "Listening — just talk"}
                            </span>
                            <span className="font-mono text-xs font-semibold tabular-nums text-slate-600">{clock}</span>
                            <button
                                type="button"
                                onClick={endDemo}
                                data-testid="agent-demo-call-end"
                                className="ml-auto rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 sm:ml-0 transform-gpu [backface-visibility:hidden]"
                            >
                                End demo
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setIsModalOpen(true)}
                            disabled={state === "starting"}
                            data-testid="agent-demo-call-start"
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 sm:w-auto transition hover:bg-amber-400 active:bg-amber-600 disabled:opacity-50 transform-gpu [backface-visibility:hidden]"
                        >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                            </svg>
                            {state === "starting" ? "Connecting…" : state === "ended" ? "Try demo again" : "Try a live demo"}
                        </button>
                    )}
                </div>

                {message ? (
                    <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-amber-900 border border-amber-200" data-testid="agent-demo-call-message">
                        {message}
                    </p>
                ) : null}

                {state === "ended" && !message ? (
                    <p className="mt-3 text-xs font-semibold text-slate-500" data-testid="agent-demo-call-ended-note">
                        Demo ended{typeof remainingDemos === "number" ? ` — ${remainingDemos} demo${remainingDemos === 1 ? "" : "s"} left today` : ""}. Buy the agent to configure it with your own business, number, and calendar.
                    </p>
                ) : null}
            </div>

            {/* Modal Dialog for Personalizing Voice AI Demo */}
            {isModalOpen ? (
                <div
                    className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:items-center"
                    data-testid="demo-setup-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="demo-setup-modal-title"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setIsModalOpen(false);
                    }}
                >
                    <div className="relative my-auto w-full max-w-xl rounded-2xl border border-slate-100 bg-white p-5 shadow-2xl transition-all sm:p-7">
                        {/* Close button */}
                        <button
                            type="button"
                            onClick={() => setIsModalOpen(false)}
                            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                            aria-label="Close modal"
                        >
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>

                        <div className="flex items-center gap-4 pr-8">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-600">
                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                    <line x1="12" y1="19" x2="12" y2="22" />
                                </svg>
                            </div>
                            <div>
                                <h3 id="demo-setup-modal-title" className="text-base sm:text-lg font-bold text-slate-900" data-testid="demo-setup-modal-title">
                                    Personalise {listingName} Demo
                                </h3>
                                <p className="text-xs text-slate-500 leading-normal mt-0.5">
                                    Add sample {demoProfile.subindustry} details so the demo speaks in the right business context.
                                </p>
                            </div>
                        </div>

                        {/* Clean Form */}
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                void startDemo();
                            }}
                            className="mt-10 space-y-6"
                        >
                            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                                <div className="flex flex-wrap gap-2">
                                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                        Industry: {demoProfile.industry}
                                    </span>
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                                        Subindustry: {demoProfile.subindustry}
                                    </span>
                                </div>
                                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                                    This demo stays locked to the selected agent type so its terminology, safety rules, and example workflow match the listing you are evaluating.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="demo-setup-biz-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
                                        {demoProfile.businessNameLabel} <span className="text-amber-500">*</span>
                                    </label>
                                    <input
                                        id="demo-setup-biz-name"
                                        type="text"
                                        value={businessName}
                                        onChange={(e) => setBusinessName(e.target.value)}
                                        placeholder={demoProfile.businessNamePlaceholder}
                                        data-testid="demo-setup-input-biz-name"
                                        maxLength={120}
                                        required
                                        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition"
                                    />
                                </div>

                                <div>
                                    <label htmlFor="demo-setup-contact-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
                                        {demoProfile.contactNameLabel} <span className="text-slate-400 font-normal">(Optional)</span>
                                    </label>
                                    <input
                                        id="demo-setup-contact-name"
                                        type="text"
                                        value={contactName}
                                        onChange={(e) => setContactName(e.target.value)}
                                        placeholder={demoProfile.contactNamePlaceholder}
                                        data-testid="demo-setup-input-contact-name"
                                        maxLength={120}
                                        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="demo-setup-address" className="block text-xs font-semibold text-slate-700 mb-1.5">
                                        {demoProfile.addressLabel} <span className="text-slate-400 font-normal">(Optional)</span>
                                    </label>
                                    <input
                                        id="demo-setup-address"
                                        type="text"
                                        value={address}
                                        onChange={(e) => setAddress(e.target.value)}
                                        placeholder={demoProfile.addressPlaceholder}
                                        data-testid="demo-setup-input-address"
                                        maxLength={180}
                                        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition"
                                    />
                                </div>

                                <div>
                                    <label htmlFor="demo-setup-services" className="block text-xs font-semibold text-slate-700 mb-1.5">
                                        {demoProfile.servicesLabel} <span className="text-slate-400 font-normal">(Optional)</span>
                                    </label>
                                    <input
                                        id="demo-setup-services"
                                        type="text"
                                        value={services}
                                        onChange={(e) => setServices(e.target.value)}
                                        placeholder={demoProfile.servicesPlaceholder}
                                        data-testid="demo-setup-input-services"
                                        maxLength={600}
                                        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition"
                                    />
                                </div>
                            </div>

                            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-3 text-[11px] leading-relaxed text-emerald-900">
                                Demo mode uses browser voice only. It can demonstrate the conversation and safely simulate booking or follow-up steps, but it does not create real appointments, send real messages, assign a buyer phone number, or create phone-number billing.
                            </div>

                            {/* Actions Footer */}
                            <div className="mt-6 flex flex-col-reverse items-stretch gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                                <button
                                    type="button"
                                    onClick={() => void startDemo({})}
                                    data-testid="demo-setup-skip-btn"
                                    className="rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 text-center"
                                >
                                    Skip
                                </button>
                                <button
                                    type="submit"
                                    data-testid="demo-setup-submit-btn"
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-2.5 text-xs font-bold text-slate-950 shadow-md shadow-amber-500/20 transition hover:from-amber-400 hover:to-amber-500"
                                >
                                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                    </svg>
                                    Start Demo
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            ) : null}
        </>
    );
}
