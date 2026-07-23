"use client";

import { useId, useState, type ReactNode } from "react";

export type ConfigureSectionStatus = "complete" | "incomplete" | "attention" | "optional";

const STATUS_META: Record<ConfigureSectionStatus, { label: string; pill: string; dot: string }> = {
  complete: { label: "Complete", pill: "bg-green-100 text-green-700", dot: "bg-green-500" },
  incomplete: { label: "Required", pill: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  attention: { label: "Needs review", pill: "bg-rose-100 text-rose-700", dot: "bg-rose-500" },
  optional: { label: "Optional", pill: "bg-slate-100 text-slate-500", dot: "bg-slate-300" }
};

export function ConfigureSectionCard({
  id,
  title,
  description,
  status,
  summary,
  icon,
  warningCount = 0,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  children
}: {
  /** Stable id — used for data-testids (`business-configure-section-${id}`). */
  id: string;
  title: string;
  description?: string;
  status: ConfigureSectionStatus;
  /** Compact one-line summary shown while collapsed. */
  summary?: ReactNode;
  /** Optional small leading icon. */
  icon?: ReactNode;
  /** Number of blocking problems inside the section (renders a count pill). */
  warningCount?: number;
  defaultOpen?: boolean;
  /** Controlled open state (optional — falls back to internal state). */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const regionId = useId();
  const isComplete = status === "complete";

  function toggle() {
    const next = !open;
    if (controlledOpen === undefined) setInternalOpen(next);
    onToggle?.(next);
  }

  return (
    <section
      className={`rounded-2xl border bg-white transition-colors ${
        warningCount > 0 ? "border-rose-200" : "border-gray-200/80"
      }`}
      data-testid={`business-configure-section-${id}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={regionId}
        data-testid={`business-configure-section-${id}-toggle`}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors hover:bg-slate-50/60 sm:px-5"
      >
        <div className="flex items-center gap-3 min-w-0">
          {icon ? (
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100/80 text-slate-600"
            >
              {icon}
            </span>
          ) : null}
          <span className="text-sm font-bold text-slate-800 truncate">{title}</span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div data-testid={`business-configure-section-${id}-status`}>
            {isComplete ? (
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
                aria-label="Completed"
                title="Completed"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ) : (
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-400"
                aria-label="Not completed"
                title="Not completed"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
                </svg>
              </span>
            )}
          </div>

          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      <div id={regionId} hidden={!open} className="border-t border-gray-100 px-4 py-5 sm:px-5">
        {children}
      </div>
    </section>
  );
}
