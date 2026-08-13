"use client";

import type { ReactNode } from "react";

/* ------------------------------------------------------------------------ */
/* Pills                                                                     */
/* ------------------------------------------------------------------------ */

export type PillTone = "green" | "amber" | "blue" | "red" | "slate";

const PILL_TONES: Record<PillTone, string> = {
  green: "bg-green-50 text-green-700",
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  red: "bg-red-50 text-red-600",
  slate: "bg-slate-100 text-slate-600"
};

export function Pill({
  tone,
  children,
  testId,
  title
}: {
  tone: PillTone;
  children: ReactNode;
  testId?: string;
  title?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${PILL_TONES[tone]}`}
      data-testid={testId}
      title={title}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Cards / layout                                                            */
/* ------------------------------------------------------------------------ */

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  testId,
  className = ""
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ${className}`}
      data-testid={testId}
    >
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 sm:text-lg">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function LoadingRows({ rows = 3, testId }: { rows?: number; testId?: string }) {
  return (
    <div className="divide-y divide-gray-50" data-testid={testId}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex animate-pulse items-center gap-4 px-6 py-4">
          <div className="h-10 w-10 rounded-xl bg-gray-100" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-44 rounded bg-gray-100" />
            <div className="h-3 w-32 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  testId
}: {
  message: string;
  onRetry?: () => void;
  testId?: string;
}) {
  return (
    <div className="px-6 py-10 text-center" data-testid={testId}>
      <p className="text-sm font-semibold text-slate-700">Something went wrong</p>
      <p className="mt-1 text-sm text-slate-500">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-amber-300 hover:text-amber-700"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  testId
}: {
  title: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="px-6 py-10 text-center" data-testid={testId}>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Buttons                                                                   */
/* ------------------------------------------------------------------------ */

export const PRIMARY_BUTTON_CLASS =
  "inline-flex items-center justify-center rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50";

export const SECONDARY_BUTTON_CLASS =
  "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-50";

export const DANGER_BUTTON_CLASS =
  "inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export const INPUT_CLASS =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100";

/* ------------------------------------------------------------------------ */
/* Modal + confirm dialog                                                    */
/* ------------------------------------------------------------------------ */

export function ModalShell({
  title,
  onClose,
  children,
  testId
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div
        className="relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        data-testid={testId}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
  testId
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  return (
    <ModalShell title={title} onClose={onCancel} testId={testId}>
      <div className="text-sm text-slate-600">{message}</div>
      {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_CLASS} data-testid={testId ? `${testId}-cancel` : undefined}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={
            danger
              ? "inline-flex items-center justify-center rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              : PRIMARY_BUTTON_CLASS
          }
          data-testid={testId ? `${testId}-confirm` : undefined}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------------ */
/* Formatting helpers                                                        */
/* ------------------------------------------------------------------------ */

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "—";

  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(iso);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** Sentence-case a SCREAMING_SNAKE backend value for display. */
export function humanizeToken(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
