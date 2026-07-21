"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { PauseCircle } from "lucide-react";

type AgentPauseConfirmationModalProps = {
  agentName: string;
  isSubmitting: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AgentPauseConfirmationModal({
  agentName,
  isSubmitting,
  error,
  onCancel,
  onConfirm
}: AgentPauseConfirmationModalProps) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) onCancel();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [isSubmitting, onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-agent-title"
      aria-describedby="pause-agent-description"
      data-testid="agent-pause-confirmation-modal"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && !isSubmitting) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl sm:p-7">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600">
            <PauseCircle className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="pause-agent-title" className="text-lg font-bold text-slate-900">
              Pause {agentName}?
            </h2>
            <p id="pause-agent-description" className="mt-2 text-sm leading-6 text-slate-600">
              All activity for this agent will pause, including calls, texts, and workflow actions. Do you want to continue?
            </p>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" data-testid="agent-pause-confirmation-error">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onConfirm}
            data-testid="agent-pause-confirmation-confirm"
            className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Pausing…" : "Pause Agent"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
