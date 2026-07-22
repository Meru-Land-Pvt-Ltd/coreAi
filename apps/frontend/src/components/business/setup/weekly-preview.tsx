"use client";

export function CompactWeeklyPreview({
  summary,
  heading,
  subheading,
  "data-testid": testId
}: {
  summary: string[];
  heading?: string;
  subheading?: string;
  "data-testid"?: string;
}) {
  if (!summary || summary.length === 0) return null;

  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs backdrop-blur-xs"
    >
      {heading ? (
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
          {heading}
        </p>
      ) : null}
      {subheading ? (
        <p className="mt-0.5 text-xs text-slate-400 mb-2.5">{subheading}</p>
      ) : heading ? (
        <div className="mb-2.5" />
      ) : null}

      {/* Accessibility & test content fallback */}
      <ul className="sr-only">
        {summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {/* Aesthetic 7-Day Micro Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-1.5" aria-hidden="true">
        {summary.map((item) => {
          const parts = item.split(":");
          const dayName = parts[0]?.trim() || item;
          const timeText = parts.slice(1).join(":").trim() || "";
          const isClosed = timeText.toLowerCase().includes("closed");

          return (
            <div
              key={dayName}
              className={`flex flex-col justify-between rounded-lg p-2 text-left border transition-all ${
                isClosed
                  ? "border-slate-100 bg-white/50 text-slate-400"
                  : "border-amber-200/80 bg-white text-slate-800 shadow-2xs hover:border-amber-300"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-bold text-slate-700">{dayName}</span>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isClosed ? "bg-slate-300" : "bg-emerald-500"
                  }`}
                />
              </div>
              <span className="mt-1 block text-[10px] font-semibold tabular-nums leading-tight">
                {timeText}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
