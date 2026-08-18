"use client";

/**
 * Styles Gallery block — a horizontal scroll of style cards (emoji + title).
 * Single-select with an amber ring highlight; tapping the selected card again
 * clears the choice. The selected style's hidden instructions are appended to
 * the prompt by the renderer at run time — the customer never sees them.
 */

export type FacePreset = {
  id: string;
  title: string;
  emoji: string;
  promptFragment: string;
};

export function PresetGalleryBlock({
  presets,
  selectedId,
  onSelect,
  emptyHint = null
}: {
  presets: FacePreset[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * Shown instead of nothing when there are no styles yet. The renderer only
   * passes this in the builder's Test preview — a customer page with an empty
   * gallery stays invisible, but an architect must never see their freshly
   * dropped section render as nothing.
   */
  emptyHint?: string | null;
}) {
  if (presets.length === 0) {
    if (!emptyHint) return null;
    return (
      <div className="mt-6" data-testid="agent-block-preset-gallery">
        <div
          className="rounded-2xl border border-dashed border-gray-200 bg-slate-50/50 p-6 text-center"
          data-testid="agent-block-preset-gallery-empty-hint"
        >
          <p className="text-sm text-slate-400">{emptyHint}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6" data-testid="agent-block-preset-gallery">
      <div className="flex gap-3 overflow-x-auto pb-2">
        {presets.map((preset) => {
          const selected = preset.id === selectedId;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={selected}
              data-testid="agent-block-preset"
              data-selected={selected ? "true" : "false"}
              onClick={() => onSelect(selected ? null : preset.id)}
              className={`flex w-24 flex-none flex-col items-center gap-2 rounded-2xl border bg-white px-3 py-4 shadow-sm transition motion-reduce:transition-none ${
                selected
                  ? "border-amber-400 ring-2 ring-amber-400"
                  : "border-gray-200 hover:border-gray-300 hover:bg-slate-50"
              }`}
            >
              <span className="text-2xl" aria-hidden="true">
                {preset.emoji || "✨"}
              </span>
              <span className="w-full truncate text-center text-xs font-medium text-slate-700">
                {preset.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
