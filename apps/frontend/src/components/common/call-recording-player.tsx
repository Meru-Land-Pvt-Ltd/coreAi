"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";

/** Only one recording plays at a time across every player on the page. */
let activeAudio: HTMLAudioElement | null = null;

function claimPlayback(audio: HTMLAudioElement) {
    if (activeAudio && activeAudio !== audio) {
        activeAudio.pause();
    }
    activeAudio = audio;
}

function formatClock(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function PlayIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-3.5 w-3.5" aria-hidden="true">
            <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.54-6.86a1.05 1.05 0 0 0 0-1.76L9.56 4.26A1.04 1.04 0 0 0 8 5.14Z" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
    );
}

export function CallRecordingPlayer({
    src,
    refreshPath,
    testIdPrefix = "call-recording-player"
}: {
    src: string;
    refreshPath?: string | null;
    testIdPrefix?: string;
}) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const refreshedRef = useRef(false);
    const [playing, setPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [failed, setFailed] = useState(false);

    async function refreshSource(): Promise<boolean> {
        if (!refreshPath || refreshedRef.current) return false;
        refreshedRef.current = true;

        const res = await apiGet<{ url: string | null }>(refreshPath).catch(() => null);
        const freshUrl = res?.success ? res.data?.url ?? null : null;
        const audio = audioRef.current;

        if (!freshUrl || !audio) return false;
        audio.src = freshUrl;
        audio.load();
        return true;
    }

    useEffect(() => {
        return () => {
            audioRef.current?.pause();
        };
    }, []);

    function togglePlayback() {
        const audio = audioRef.current;

        if (!audio || failed) return;

        if (playing) {
            audio.pause();
            return;
        }

        void (async () => {
            // Expiring URLs: always play from a freshly minted URL when we can.
            if (refreshPath && !refreshedRef.current) await refreshSource();
            try {
                await audio.play();
            } catch {
                // One retry with a fresh URL before declaring the recording dead.
                if (await refreshSource()) {
                    await audio.play().catch(() => setFailed(true));
                } else {
                    setFailed(true);
                }
            }
        })();
    }

    function seek(value: number) {
        const audio = audioRef.current;

        if (!audio || failed || !Number.isFinite(value)) return;

        audio.currentTime = value;
        setCurrentTime(value);
    }

    if (failed) {
        return (
            <div
                className="inline-flex items-center gap-2 rounded-xl border border-gray-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-400"
                data-testid={`${testIdPrefix}-unavailable`}
            >
                Recording unavailable
            </div>
        );
    }

    return (
        <div
            className="flex items-center gap-2 rounded-xl border border-gray-100 bg-slate-50 px-3 py-2"
            data-testid={testIdPrefix}
        >
            <button
                type="button"
                onClick={togglePlayback}
                aria-label={playing ? "Pause recording" : "Play recording"}
                data-testid={`${testIdPrefix}-toggle`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-500 text-white shadow-sm transition hover:bg-amber-600"
            >
                {playing ? <PauseIcon /> : <PlayIcon />}
            </button>

            <input
                type="range"
                min={0}
                max={Number.isFinite(duration) && duration > 0 ? duration : 0}
                step={0.1}
                value={Math.min(currentTime, duration || currentTime)}
                onChange={(event) => seek(Number(event.target.value))}
                aria-label="Seek recording"
                data-testid={`${testIdPrefix}-seek`}
                className="h-1 min-w-0 flex-1 cursor-pointer accent-amber-500"
            />

            <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-slate-500">
                {formatClock(currentTime)} / {formatClock(duration)}
            </span>

            <audio
                ref={audioRef}
                src={src}
                preload={refreshPath ? "none" : "metadata"}
                className="hidden"
                onPlay={(event) => {
                    claimPlayback(event.currentTarget);
                    setPlaying(true);
                }}
                onPause={() => setPlaying(false)}
                onEnded={() => {
                    setPlaying(false);
                    setCurrentTime(0);
                }}
                onLoadedMetadata={(event) => {
                    const value = event.currentTarget.duration;
                    if (Number.isFinite(value)) setDuration(value);
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onError={() => {
                    if (!refreshPath || refreshedRef.current) {
                        setFailed(true);
                    }
                    setPlaying(false);
                }}
            />
        </div>
    );
}
