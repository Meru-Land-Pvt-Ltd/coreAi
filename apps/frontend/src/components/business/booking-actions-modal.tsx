"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cancelAppointment, requestRescheduleAppointment } from "./features/api";

type BookingActionsModalProps = {
  isOpen: boolean;
  mode: "cancel" | "reschedule";
  booking: {
    id: string;
    customerName: string | null;
    customerPhone: string;
    service: string | null;
    startAt: string;
  } | null;
  onClose: () => void;
  onSuccess: () => void;
};

export function BookingActionsModal({
  isOpen,
  mode,
  booking,
  onClose,
  onSuccess
}: BookingActionsModalProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const reasonInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setReason("");
      setError("");
      setTimeout(() => reasonInputRef.current?.focus(), 50);

      const previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      function handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape" && !isSubmitting) onClose();
      }

      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = previousBodyOverflow;
      };
    }
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !booking || !mounted) return null;

  const isCancel = mode === "cancel";
  const customerLabel = booking.customerName?.trim() || booking.customerPhone;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isCancel && !reason.trim()) {
      setError("Please provide a cancellation reason for the patient.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    const response = isCancel
      ? await cancelAppointment(booking.id, reason.trim())
      : await requestRescheduleAppointment(booking.id, reason.trim() || undefined);

    setIsSubmitting(false);

    if (!response.success) {
      setError(response.error ?? "Failed to update appointment. Please try again.");
      return;
    }

    onSuccess();
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-action-modal-title"
      data-testid="booking-action-modal"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl sm:p-7">
        <div className="flex items-start gap-4">
          <span
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${
              isCancel ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
            }`}
          >
            {isCancel ? (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </span>

          <div className="min-w-0 flex-1">
            <h2 id="booking-action-modal-title" className="text-lg font-bold text-slate-900" data-testid="booking-action-modal-title">
              {isCancel ? "Cancel Appointment" : "Reschedule Appointment"}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600" data-testid="booking-action-modal-description">
              {isCancel ? (
                <>
                  Cancel booking for <span className="font-semibold text-slate-900">{customerLabel}</span>. This removes the Google Calendar event and texts cancellation details to the patient.
                </>
              ) : (
                <>
                  Ask <span className="font-semibold text-slate-900">{customerLabel}</span> to choose a new slot. An SMS will be sent with instructions to contact your team.
                </>
              )}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="booking-action-reason"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              {isCancel ? "Cancellation Reason *" : "Reschedule Note (Optional)"}
            </label>
            <textarea
              ref={reasonInputRef}
              id="booking-action-reason"
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError("");
              }}
              placeholder={
                isCancel
                  ? "e.g., Doctor unavailable, emergency closure, equipment maintenance..."
                  : "e.g., Doctor delayed, moving morning slot to afternoon..."
              }
              className="mt-1.5 w-full rounded-xl border border-gray-200 bg-slate-50/50 p-3 text-sm font-medium text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
              data-testid="booking-action-reason-input"
            />
          </div>

          {error ? (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" data-testid="booking-action-modal-error">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="booking-action-modal-cancel-btn"
            >
              Go Back
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="booking-action-modal-submit-btn"
              className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                isCancel ? "bg-red-600 hover:bg-red-700" : "bg-amber-500 hover:bg-amber-600"
              }`}
            >
              {isSubmitting
                ? "Processing…"
                : isCancel
                ? "Confirm Cancellation"
                : "Reschedule"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
