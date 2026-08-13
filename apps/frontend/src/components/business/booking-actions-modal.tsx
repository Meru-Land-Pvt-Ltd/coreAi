"use client";

import { useState } from "react";
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

  if (!isOpen || !booking) return null;

  const isCancel = mode === "cancel";
  const customerLabel = booking.customerName?.trim() || booking.customerPhone;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isCancel && !reason.trim()) {
      setError("Please provide a reason for cancellation.");
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-action-modal-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <h3
              id="booking-action-modal-title"
              className="text-lg font-bold text-slate-900"
              data-testid="booking-action-modal-title"
            >
              {isCancel ? "Cancel Appointment" : "Request Reschedule"}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close modal"
              data-testid="booking-action-modal-close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="mt-2 text-sm text-slate-600" data-testid="booking-action-modal-description">
            {isCancel ? (
              <>
                Cancel appointment for <span className="font-semibold text-slate-800">{customerLabel}</span>. This will remove the event from Google Calendar and send an automated cancellation SMS with rescheduling instructions.
              </>
            ) : (
              <>
                Request <span className="font-semibold text-slate-800">{customerLabel}</span> to pick a new time slot. An SMS will be sent asking them to call/text to reschedule.
              </>
            )}
          </p>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="booking-action-reason"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                {isCancel ? "Cancellation Reason *" : "Reschedule Reason / Note (Optional)"}
              </label>
              <textarea
                id="booking-action-reason"
                rows={3}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError("");
                }}
                placeholder={
                  isCancel
                    ? "e.g., Doctor unavailable, office closed due to emergency, slot conflict..."
                    : "e.g., Doctor delayed, need to move morning slot to afternoon..."
                }
                className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-800 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                data-testid="booking-action-reason-input"
              />
            </div>

            {error ? (
              <p className="text-xs font-semibold text-red-600" data-testid="booking-action-modal-error">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                data-testid="booking-action-modal-cancel-btn"
              >
                Go Back
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-50 ${
                  isCancel
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-amber-500 hover:bg-amber-600"
                }`}
                data-testid="booking-action-modal-submit-btn"
              >
                {isSubmitting
                  ? "Processing…"
                  : isCancel
                  ? "Confirm Cancellation"
                  : "Send Reschedule Request"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
