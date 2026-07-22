"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GOOGLE_CALENDAR_DISCLOSURE } from "@coreai/shared";

type GoogleDisclosureModalProps = {
  open: boolean;

  onAgree: () => Promise<void>;
  /** Called for Cancel, Escape, the close button, and backdrop clicks — never records anything. */
  onCancel: () => void;
};

export function GoogleDisclosureModal({ open, onAgree, onCancel }: GoogleDisclosureModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Fresh state each time the disclosure is opened.
    if (open) {
      setError(null);
      setSubmitting(false);
      cancelButtonRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, submitting, onCancel]);

  if (!open || typeof document === "undefined") return null;

  const handleAgree = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onAgree();
    } catch (agreeError) {
      setError(
        agreeError instanceof Error && agreeError.message
          ? agreeError.message
          : "Could not record your agreement. Please try again."
      );
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="google-disclosure-title"
      data-testid="google-disclosure-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="google-disclosure-title" className="text-lg font-bold text-slate-900" data-testid="google-disclosure-title">
          {GOOGLE_CALENDAR_DISCLOSURE.title}
        </h2>
        <p className="mt-2 text-sm text-slate-600" data-testid="google-disclosure-intro">
          {GOOGLE_CALENDAR_DISCLOSURE.intro}
        </p>
        <ul className="mt-3 list-outside list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600">
          {GOOGLE_CALENDAR_DISCLOSURE.bullets.map((bullet) => (
            <li key={bullet} data-testid="google-disclosure-bullet">
              {bullet}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500" data-testid="google-disclosure-policy-note">
          {GOOGLE_CALENDAR_DISCLOSURE.policyNote}
        </p>

        {error ? (
          <p className="mt-3 text-sm text-red-600" role="alert" data-testid="google-disclosure-error">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            ref={cancelButtonRef}
            disabled={submitting}
            onClick={onCancel}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            data-testid="google-disclosure-cancel"
          >
            {GOOGLE_CALENDAR_DISCLOSURE.cancelLabel}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleAgree}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
            data-testid="google-disclosure-agree"
          >
            {submitting ? "Opening Google…" : GOOGLE_CALENDAR_DISCLOSURE.agreeLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
