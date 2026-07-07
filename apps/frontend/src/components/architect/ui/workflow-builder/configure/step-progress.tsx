export function StepProgress({
  labels,
  current,
  maxVisited,
  onGoto
}: {
  labels: string[];
  current: number;
  maxVisited: number;
  onGoto: (step: number) => void;
}) {
  return (
    <div
      className="mb-8 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6"
      data-testid="configure-step-progress"
    >
      <div className="mb-4 flex items-baseline justify-between sm:hidden">
        <span className="text-[15px] font-bold text-slate-900" data-testid="configure-step-progress-mobile-label">
          {labels[current - 1]}
        </span>
        <span className="text-xs font-semibold text-slate-400" data-testid="configure-step-progress-mobile-count">
          Step {current} of {labels.length}
        </span>
      </div>
      <ol className="flex items-center">
        {labels.map((label, index) => {
          const step = index + 1;
          const isDone = step < current;
          const isCurrent = step === current;
          const reachable = step <= maxVisited;
          const isLast = step === labels.length;

          return (
            <li key={label} className={isLast ? "flex flex-none items-start" : "flex flex-1 items-start"}>
              <button
                type="button"
                data-testid={`configure-step-goto-${step}`}
                onClick={() => reachable && onGoto(step)}
                disabled={!reachable}
                className="group flex flex-none flex-col items-center gap-2 rounded-xl px-1 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 disabled:cursor-default"
              >
                <span
                  className={
                    isDone
                      ? "flex h-9 w-9 items-center justify-center rounded-full border-2 border-amber-500 bg-amber-500 text-sm font-bold text-white shadow-sm transition-all"
                      : isCurrent
                        ? "flex h-9 w-9 items-center justify-center rounded-full border-2 border-amber-500 bg-white text-sm font-bold text-amber-600 shadow-[0_0_0_4px_rgba(245,158,11,.15)] transition-all"
                        : "flex h-9 w-9 items-center justify-center rounded-full border-2 border-gray-200 bg-white text-sm font-bold text-slate-400 transition-all"
                  }
                >
                  {isDone ? (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : (
                    step
                  )}
                </span>
                <span
                  className={
                    isCurrent
                      ? "hidden whitespace-nowrap text-xs font-semibold text-slate-900 sm:block"
                      : isDone
                        ? "hidden whitespace-nowrap text-xs font-semibold text-amber-600 sm:block"
                        : "hidden whitespace-nowrap text-xs font-semibold text-slate-400 sm:block"
                  }
                >
                  {label}
                </span>
              </button>
              {!isLast ? (
                <span
                  className={
                    isDone
                      ? "mx-2 mt-[17px] h-[3px] flex-1 rounded-full bg-amber-400 transition-colors sm:mx-3"
                      : "mx-2 mt-[17px] h-[3px] flex-1 rounded-full bg-gray-100 transition-colors sm:mx-3"
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
