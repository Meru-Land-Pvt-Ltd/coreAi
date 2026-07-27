"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { submitSupportIssue } from "@/lib/support-api";

type NeedHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

type RecordState = "idle" | "recording" | "recorded";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_RECORD_SECONDS = 120; // 2 minutes
const ACCEPTED_DOCUMENT_TYPES = ".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif";

const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg"
];

function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of AUDIO_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function extensionForMime(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function NeedHelpModal({ open, onClose }: NeedHelpModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [issue, setIssue] = useState("");
  const [document, setDocument] = useState<File | null>(null);

  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [voiceDuration, setVoiceDuration] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [fieldError, setFieldError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const recordSecondsRef = useRef(0);
  const voiceUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const revokeVoiceUrl = useCallback(() => {
    if (voiceUrlRef.current) {
      URL.revokeObjectURL(voiceUrlRef.current);
      voiceUrlRef.current = null;
    }
  }, []);

  const resetAll = useCallback(() => {
    clearTimer();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* already stopped */
      }
    }
    mediaRecorderRef.current = null;
    stopStream();
    revokeVoiceUrl();
    chunksRef.current = [];
    recordSecondsRef.current = 0;

    setName("");
    setEmail("");
    setIssue("");
    setDocument(null);
    setRecordState("idle");
    setRecordSeconds(0);
    setRecordError(null);
    setVoiceBlob(null);
    setVoiceUrl(null);
    setVoiceDuration(0);
    setSubmitting(false);
    setSubmitted(false);
    setSubmitError("");
    setFieldError("");
  }, [clearTimer, revokeVoiceUrl, stopStream]);

  // Reset everything whenever the modal is closed.
  useEffect(() => {
    if (!open) resetAll();
  }, [open, resetAll]);

  // Escape-to-close + body scroll lock while open (matches other modals).
  useEffect(() => {
    if (!open) return;

    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting && recordState !== "recording") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, submitting, recordState, onClose]);

  // Safety net: tear down media resources if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      clearTimer();
      stopStream();
      revokeVoiceUrl();
    };
  }, [clearTimer, stopStream, revokeVoiceUrl]);

  function acceptDocument(file: File | undefined) {
    if (!file) return;
    setFieldError("");
    if (file.size > MAX_FILE_BYTES) {
      setSubmitError("Document is too large. Keep it under 10 MB.");
      return;
    }
    setSubmitError("");
    setDocument(file);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    acceptDocument(event.target.files?.[0]);
    // Allow re-selecting the same file after removal.
    event.target.value = "";
  }

  async function startRecording() {
    setRecordError(null);
    setFieldError("");

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setRecordError("Voice recording isn't supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = pickAudioMime();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        revokeVoiceUrl();
        const url = URL.createObjectURL(blob);
        voiceUrlRef.current = url;
        setVoiceBlob(blob);
        setVoiceUrl(url);
        setVoiceDuration(recordSecondsRef.current);
        setRecordState("recorded");
        stopStream();
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      recordSecondsRef.current = 0;
      setRecordSeconds(0);
      setRecordState("recording");

      timerRef.current = window.setInterval(() => {
        recordSecondsRef.current += 1;
        setRecordSeconds(recordSecondsRef.current);
        if (recordSecondsRef.current >= MAX_RECORD_SECONDS) stopRecording();
      }, 1000);
    } catch {
      setRecordError("Microphone access was blocked. Please allow it in your browser and try again.");
      stopStream();
    }
  }

  function stopRecording() {
    clearTimer();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function discardRecording() {
    clearTimer();
    revokeVoiceUrl();
    setVoiceBlob(null);
    setVoiceUrl(null);
    setVoiceDuration(0);
    setRecordSeconds(0);
    recordSecondsRef.current = 0;
    setRecordState("idle");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");
    setFieldError("");

    const trimmedIssue = issue.trim();
    if (!trimmedIssue && !document && !voiceBlob) {
      setFieldError("Please describe your issue, attach a document, or record a voice message.");
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError("Please enter a valid email address (or leave it blank).");
      return;
    }

    setSubmitting(true);
    const result = await submitSupportIssue({
      issue: trimmedIssue,
      name: name.trim() || undefined,
      email: email.trim() || undefined,
      document,
      voice: voiceBlob,
      voiceName: voiceBlob ? `voice-message.${extensionForMime(voiceBlob.type)}` : undefined,
      voiceDurationSec: voiceDuration
    });
    setSubmitting(false);

    if (result.success) {
      setSubmitted(true);
      return;
    }
    setSubmitError(result.error ?? "Could not send your request. Please try again.");
  }

  if (!open || typeof window === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="need-help-title"
      data-testid="need-help-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting && recordState !== "recording") onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="need-help-title" className="text-xl font-extrabold text-slate-900" data-testid="need-help-title">
              Need Help?
            </h2>
            <p className="mt-1 text-sm text-slate-500" data-testid="need-help-subtitle">
              Describe your issue — type it, attach a document, or record a voice message.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || recordState === "recording"}
            aria-label="Close"
            data-testid="need-help-close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-gray-100 hover:text-slate-700 disabled:opacity-40"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {!submitted ? (
          <form className="mt-6" noValidate onSubmit={handleSubmit} data-testid="need-help-form">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="need-help-name" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Name <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  id="need-help-name"
                  data-testid="need-help-name-input"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Jane Smith"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="need-help-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Email <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  id="need-help-email"
                  data-testid="need-help-email-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="mt-5">
              <label htmlFor="need-help-issue" className="mb-1.5 block text-sm font-medium text-slate-700">
                Issue
              </label>
              <textarea
                id="need-help-issue"
                data-testid="need-help-issue-textarea"
                rows={4}
                value={issue}
                onChange={(event) => setIssue(event.target.value)}
                placeholder="Describe the issue you're facing..."
                className={`${inputClass} resize-none`}
              />
            </div>

            {/* Document attachment */}
            <div className="mt-5">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">
                Attach a document <span className="text-slate-400">(optional)</span>
              </span>
              {document ? (
                <div
                  data-testid="need-help-document-chip"
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{document.name}</p>
                    <p className="text-xs text-slate-400">{formatBytes(document.size)}</p>
                  </div>
                  <button
                    type="button"
                    data-testid="need-help-document-remove"
                    onClick={() => setDocument(null)}
                    className="shrink-0 text-xs font-semibold text-red-500 transition hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="need-help-document-input"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    acceptDocument(event.dataTransfer?.files?.[0]);
                  }}
                  className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-200 px-4 py-5 text-center transition hover:border-amber-300 hover:bg-amber-50/40"
                >
                  <svg className="h-6 w-6 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                  </svg>
                  <span className="text-xs text-slate-600">
                    <span className="font-semibold text-amber-600">Click to upload</span> or drag and drop
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">PDF, Word, text or image · up to 10 MB</span>
                  <input
                    ref={fileInputRef}
                    id="need-help-document-input"
                    data-testid="need-help-document-input"
                    type="file"
                    accept={ACCEPTED_DOCUMENT_TYPES}
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                </label>
              )}
            </div>

            {/* Voice recorder */}
            <div className="mt-5">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">
                Record a voice message <span className="text-slate-400">(optional)</span>
              </span>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4" data-testid="need-help-voice">
                {recordState === "idle" ? (
                  <button
                    type="button"
                    data-testid="need-help-record-start"
                    onClick={startRecording}
                    className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-gray-200 transition hover:text-amber-600 hover:ring-amber-300"
                  >
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-red-500" aria-hidden="true" />
                    Start recording
                  </button>
                ) : recordState === "recording" ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-red-600" data-testid="need-help-record-timer">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
                      Recording… {formatDuration(recordSeconds)}
                    </span>
                    <button
                      type="button"
                      data-testid="need-help-record-stop"
                      onClick={stopRecording}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                    >
                      <span className="h-3 w-3 rounded-[2px] bg-white" aria-hidden="true" />
                      Stop
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <audio
                      data-testid="need-help-voice-playback"
                      controls
                      src={voiceUrl ?? undefined}
                      className="w-full"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-slate-400">
                        Voice message · {formatDuration(voiceDuration)}
                      </span>
                      <button
                        type="button"
                        data-testid="need-help-record-discard"
                        onClick={discardRecording}
                        className="text-xs font-semibold text-red-500 transition hover:text-red-600"
                      >
                        Discard &amp; re-record
                      </button>
                    </div>
                  </div>
                )}
                {recordError ? (
                  <p className="mt-3 text-xs font-semibold text-red-500" data-testid="need-help-record-error">
                    {recordError}
                  </p>
                ) : null}
              </div>
            </div>

            {fieldError ? (
              <p className="mt-4 text-sm font-semibold text-red-600" data-testid="need-help-field-error">
                {fieldError}
              </p>
            ) : null}
            {submitError ? (
              <p className="mt-4 text-sm font-semibold text-red-600" data-testid="need-help-submit-error">
                {submitError}
              </p>
            ) : null}

            <button
              type="submit"
              data-testid="need-help-submit"
              disabled={submitting || recordState === "recording"}
              className="mt-6 w-full rounded-xl bg-amber-500 py-3 font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-amber-600 hover:shadow-[0_8px_20px_-6px_rgba(245,158,11,0.5)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {submitting ? "Sending..." : "Send request"}
            </button>
          </form>
        ) : (
          <div className="py-8 text-center" data-testid="need-help-success">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <svg className="h-9 w-9 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="mt-5 text-xl font-extrabold text-slate-900" data-testid="need-help-success-heading">
              Help request sent!
            </h3>
            <p className="mt-2 text-sm text-slate-500">Thanks — our team will get back to you shortly.</p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                data-testid="need-help-submit-another"
                onClick={resetAll}
                className="rounded-xl border border-amber-500 px-5 py-2.5 text-sm font-semibold text-amber-600 transition hover:bg-amber-50"
              >
                Submit another
              </button>
              <button
                type="button"
                data-testid="need-help-done"
                onClick={onClose}
                className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    window.document.body
  );
}

const inputClass =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 transition focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-100";
