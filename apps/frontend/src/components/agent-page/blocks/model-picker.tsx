"use client";

/**
 * Model Picker block — a row of pills. The selection is stored locally by the
 * renderer and travels as part of the prompt context ("[model: <label>]"
 * prefix using the human label the architect wrote, V1 — engine variables
 * come later). Nothing is preselected: an untouched picker adds nothing to
 * the prompt, and tapping the selected pill again clears the choice.
 */

export type FaceModelOption = {
  id: string;
  label: string;
};

export function ModelPickerBlock({
  options,
  selectedId,
  onSelect,
  accent,
  accentText,
  emptyHint = null
}: {
  options: FaceModelOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  accent: string;
  accentText: string;
  /**
   * Shown instead of nothing when there are no choices yet. Only passed in
   * the builder's Test preview — a freshly dropped section must never look
   * like it did nothing.
   */
  emptyHint?: string | null;
}) {
  if (options.length === 0) {
    if (!emptyHint) return null;
    return (
      <div className="mt-6" data-testid="agent-block-model-picker">
        <div
          className="rounded-2xl border border-dashed border-gray-200 bg-slate-50/50 p-6 text-center"
          data-testid="agent-block-model-picker-empty-hint"
        >
          <p className="text-sm text-slate-400">{emptyHint}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-wrap gap-2" data-testid="agent-block-model-picker">
      {options.map((option) => {
        const selected = option.id === selectedId;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            data-testid="agent-block-model-pill"
            data-selected={selected ? "true" : "false"}
            onClick={() => onSelect(selected ? null : option.id)}
            className={`rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition motion-reduce:transition-none ${
              selected
                ? "border-transparent"
                : "border-gray-200 bg-white text-slate-700 hover:border-gray-300 hover:bg-slate-50"
            }`}
            style={selected ? { backgroundColor: accent, color: accentText } : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
