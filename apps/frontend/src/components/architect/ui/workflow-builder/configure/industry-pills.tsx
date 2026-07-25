export function IndustryPills({
  options,
  selected,
  onToggle,
  disabled = false,
  testIdPrefix = "configure-industry-pill"
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
  testIdPrefix?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {options.map((option) => {
        const active = selected.includes(option);
        const slug = option.toLowerCase().replace(/[^a-z0-9]+/g, "-");

        return (
          <button
            key={option}
            type="button"
            data-testid={`${testIdPrefix}-${slug}`}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onToggle(option)}
            className={
              active
                ? "pill inline-flex items-center gap-2 rounded-full border border-amber-500 bg-[#fffbeb] py-2 pl-3 pr-3.5 text-[13px] font-semibold text-[#b45309] shadow-[0_2px_8px_-2px_rgba(245,158,11,.4)] transition-all disabled:opacity-60"
                : "pill inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white py-2 pl-3 pr-3.5 text-[13px] font-semibold text-slate-600 transition-all hover:border-gray-300 disabled:opacity-60"
            }
          >
            <span
              className={
                active
                  ? "pill-dot h-1.5 w-1.5 scale-100 rounded-full bg-amber-500 transition-transform"
                  : "pill-dot h-1.5 w-1.5 scale-0 rounded-full bg-amber-500 transition-transform"
              }
            />
            {option}
          </button>
        );
      })}
    </div>
  );
}
