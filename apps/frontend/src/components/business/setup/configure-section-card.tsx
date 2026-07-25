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
      id={id}
      className={`transition-colors border-b border-gray-100 pb-4 last:border-b-0`}
      data-testid={`business-configure-section-${id}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={regionId}
        data-testid={`business-configure-section-${id}-toggle`}
        className="group flex w-full items-center justify-between gap-3 px-0 py-4 text-left transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3.5 min-w-0">
          {icon ? (
            <span
              aria-hidden="true"
              className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-400 transition-colors duration-200 group-hover:text-slate-600"
            >
              {icon}
            </span>
          ) : null}
          <span className="text-base font-medium text-slate-700 transition-colors group-hover:text-slate-900 truncate">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div data-testid={`business-configure-section-${id}-status`}>
            {isComplete ? (
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100"
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
                  className="h-2.5 w-2.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ) : (
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-50 text-slate-400 border border-slate-200/40"
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
                  className="h-2.5 w-2.5"
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
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 group-hover:text-slate-600 ${
              open ? "rotate-180" : ""
            }`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      <div id={regionId} hidden={!open} className="px-0 py-3">
        {children}
      </div>
    </section>
  );
}
