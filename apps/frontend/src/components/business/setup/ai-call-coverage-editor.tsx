"use client";

export type AiCoverageKind = "always" | "business_hours" | "custom";

export type AnsweringDayRow = {
  day: string;
  open: string;
  close: string;
  closed: boolean;
};

export const ANSWERING_WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
] as const;

export function defaultAnsweringDays(): AnsweringDayRow[] {
  return ANSWERING_WEEK_DAYS.map((day) => ({
    day,
    open: "09:00",
    close: "18:00",
    closed: day === "Saturday" || day === "Sunday"
  }));
}

const OPTIONS: { kind: AiCoverageKind; title: string; description: string }[] = [
  {
    kind: "always",
    title: "Answer calls 24/7",
    description: "The AI never misses a call — nights, weekends, and holidays included."
  },
  {
    kind: "business_hours",
    title: "Answer during Business Hours",
    description: "The AI answers only while your business is open, following your Business Hours."
  },
  {
    kind: "custom",
    title: "Use a custom answering schedule",
    description: "Pick exactly when the AI answers — independent of your Business Hours."
  }
];

export function AiCallCoverageEditor({
  kind,
  onKind,
  answeringDays,
  onAnsweringDay,
  businessHoursSummary,
  businessHoursConfigured
}: {
  kind: AiCoverageKind;
  onKind: (kind: AiCoverageKind) => void;
  answeringDays: AnsweringDayRow[];
  onAnsweringDay: (day: string, patch: Partial<AnsweringDayRow>) => void;
  /** Compact Business Hours lines shown for the "during Business Hours" choice. */
  businessHoursSummary: string[] | null;
  businessHoursConfigured: boolean;
}) {
  return (
    <div data-testid="business-setup-ai-coverage">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-800">AI Call Coverage</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            When the AI answers calls. This is not when your business is open or when appointments
            can be booked — those are configured above.
          </p>
        </div>
        <span
          className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600"
          data-testid="business-setup-ai-coverage-source"
        >
          {kind === "always"
            ? "24/7"
            : kind === "business_hours"
              ? "Using Business Hours"
              : "Custom AI Answering Schedule"}
        </span>
      </div>

      <div className="mt-3 space-y-2" role="radiogroup" aria-label="AI call coverage">
        {OPTIONS.map((option) => {
          const selected = kind === option.kind;
          return (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`business-setup-ai-coverage-${option.kind}`}
              onClick={() => onKind(option.kind)}
              className={`pick flex w-full items-start gap-3 rounded-xl border p-3.5 text-left ${
                selected ? "selected" : "border-gray-200 bg-white"
              }`}
            >
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                  selected ? "border-amber-500" : "border-slate-300"
                }`}
              >
                {selected ? <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{option.title}</span>
                  {option.kind === "always" ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                      Recommended
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      {kind === "always" ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600" data-testid="business-setup-ai-coverage-always-note">
          Even at 3 AM the AI answers — and it can still tell callers your business is closed and
          when you reopen, because it knows your Business Hours.
        </p>
      ) : null}

      {kind === "business_hours" ? (
        <div
          className="mt-3 rounded-xl border border-gray-100 bg-slate-50 px-4 py-3"
          data-testid="business-setup-ai-coverage-bh-summary"
        >
          {businessHoursConfigured && businessHoursSummary ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                The AI answers during these Business Hours
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {businessHoursSummary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-slate-400">
                Callers outside these hours are not answered by the AI. If hours are ever unknown,
                the AI answers rather than dropping the call.
              </p>
            </>
          ) : (
            <p className="text-xs font-semibold text-amber-700">
              Business Hours are not configured yet — until they are confirmed, the AI answers all
              calls so nothing is missed.
            </p>
          )}
        </div>
      ) : null}

      {kind === "custom" ? (
        <div
          className="mt-3 rounded-xl border border-gray-100 bg-slate-50 p-4"
          data-testid="business-setup-ai-coverage-custom-editor"
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Custom AI Answering Schedule
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            Separate from Business Hours and Appointment Hours — this only controls when the AI
            picks up.
          </p>
          <div className="mt-3 space-y-2">
            {answeringDays.map((row) => (
              <div key={row.day} className="flex flex-wrap items-center gap-3" data-testid="business-setup-ai-coverage-day-row">
                <label className="flex w-28 items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={!row.closed}
                    aria-label={`AI answers on ${row.day}`}
                    onChange={(e) => onAnsweringDay(row.day, { closed: !e.target.checked })}
                    data-testid={`business-setup-ai-coverage-day-${row.day.toLowerCase()}`}
                    className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                  />
                  {row.day}
                </label>
                {row.closed ? (
                  <span className="text-sm text-slate-400">Not answering</span>
                ) : (
                  <>
                    <input
                      type="time"
                      value={row.open}
                      aria-label={`${row.day} answering starts`}
                      onChange={(e) => onAnsweringDay(row.day, { open: e.target.value })}
                      data-testid="business-setup-ai-coverage-day-open"
                      className="field rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
                    />
                    <span className="text-slate-400" aria-hidden="true">
                      →
                    </span>
                    <input
                      type="time"
                      value={row.close}
                      aria-label={`${row.day} answering ends`}
                      onChange={(e) => onAnsweringDay(row.day, { close: e.target.value })}
                      data-testid="business-setup-ai-coverage-day-close"
                      className="field rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
