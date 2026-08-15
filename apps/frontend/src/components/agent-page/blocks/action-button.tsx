"use client";

/**
 * Button block row — every Button on the canvas renders here as one clean row
 * (the renderer collects them and places the row at the earliest Button's
 * canvas position). Pressing one is a doorway into the graph: the renderer
 * composes the run from whatever the customer already put in (Prompt Box
 * text, picked style and choice) plus the button's hidden engine prefix.
 */

export type FaceActionButton = {
  label: string;
};

export function ActionButtonRowBlock({
  buttons,
  busy,
  accent,
  accentText,
  onPress
}: {
  buttons: FaceActionButton[];
  busy: boolean;
  accent: string;
  accentText: string;
  onPress: (label: string) => void;
}) {
  if (buttons.length === 0) return null;

  // 1 = full-width primary; 2-3 = equal columns; 4+ = wrapping grid.
  const layout =
    buttons.length === 1
      ? "grid-cols-1"
      : buttons.length === 2
        ? "grid-cols-2"
        : buttons.length === 3
          ? "grid-cols-3"
          : "grid-cols-2 sm:grid-cols-3";

  return (
    <div className={`mt-6 grid gap-3 ${layout}`} data-testid="agent-block-action-buttons">
      {buttons.map((button, index) => (
        <button
          key={`${button.label}-${index}`}
          type="button"
          disabled={busy}
          data-testid={`agent-block-button-${index}`}
          onClick={() => onPress(button.label)}
          className={`inline-flex w-full items-center justify-center rounded-xl px-4 py-3 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${
            buttons.length === 1 ? "text-base" : "text-sm"
          }`}
          style={{ backgroundColor: accent, color: accentText }}
        >
          <span className="truncate">{button.label}</span>
        </button>
      ))}
    </div>
  );
}
