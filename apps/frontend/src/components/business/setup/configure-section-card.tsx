"use client";

import { useId, useState, type ReactNode } from "react";

export type ConfigureSectionStatus = "complete" | "incomplete" | "attention" | "optional";

const STATUS_META: Record<ConfigureSectionStatus, { label: string; pill: string }> = {
  complete: { label: "Complete", pill: "bg-green-100 text-green-700" },
  incomplete: { label: "Incomplete", pill: "bg-amber-100 text-amber-700" },
  attention: { label: "Needs review", pill: "bg-rose-100 text-rose-700" },
  optional: { label: "Optional", pill: "bg-slate-100 text-slate-500" }
};

export function ConfigureSectionCard({
  id,
  title,
  description,
  status,
  summary,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  children
}: {
  /** Stable id — used for data-testids (`business-configure-section-${id}`). */
  id: string;
  title: string;
  description: string;
  status: ConfigureSectionStatus;
  /** Compact one-line summary shown while collapsed. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state (optional — falls back to internal state). */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const regionId = useId();
  const meta = STATUS_META[status];

  function toggle() {
    const next = !open;
    if (controlledOpen === undefined) setInternalOpen(next);
    onToggle?.(next);
  }

  return (
    <section
      className="rounded-2xl border border-gray-100 bg-white"
      data-testid={`business-configure-section-${id}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={regionId}
        data-testid={`business-configure-section-${id}-toggle`}
        className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left transition-colors hover:bg-slate-50/60"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-900">{title}</span>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${meta.pill}`}
              data-testid={`business-configure-section-${id}-status`}
            >
              {meta.label}
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
          {!open && summary ? (
            <span
              className="mt-1.5 block truncate text-xs font-medium text-slate-600"
              data-testid={`business-configure-section-${id}-summary`}
            >
              {summary}
            </span>
          ) : null}
        </span>

        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div id={regionId} className="border-t border-gray-100 px-5 py-5 sm:px-6">
          {children}
        </div>
      ) : null}
    </section>
  );
}
