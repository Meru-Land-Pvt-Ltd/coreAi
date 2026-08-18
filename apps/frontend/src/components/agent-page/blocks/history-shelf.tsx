"use client";

import { isVideoUrl } from "./media";
import type { FaceRunResult } from "./output-stage";

/**
 * History Shelf block — this session's results as tappable thumbnails (first
 * image of a run) or text chips (the run's prompt), newest first. Tapping one
 * restores that result onto the Result Viewer. Client state only — nothing is
 * stored.
 */

export function HistoryShelfBlock({
  results,
  activeId,
  onRestore
}: {
  results: FaceRunResult[];
  activeId: number | null;
  onRestore: (id: number) => void;
}) {
  if (results.length === 0) return null;

  // Stored oldest-first; shown newest-first like the media template's feed.
  const shelf = [...results].reverse();

  return (
    <div className="mt-6" data-testid="agent-block-history-shelf">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Earlier this session
      </p>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
        {shelf.map((result) => {
          const active = result.id === activeId;
          const thumbnail = result.mediaUrls.find((url) => !isVideoUrl(url));
          return (
            <button
              key={result.id}
              type="button"
              aria-pressed={active}
              data-testid="agent-block-history-item"
              data-active={active ? "true" : "false"}
              onClick={() => onRestore(result.id)}
              className={`flex flex-none items-center overflow-hidden rounded-xl border bg-white shadow-sm transition motion-reduce:transition-none ${
                active
                  ? "border-amber-400 ring-2 ring-amber-400"
                  : "border-gray-200 hover:border-gray-300 hover:bg-slate-50"
              }`}
            >
              {thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbnail}
                  alt={result.displayPrompt}
                  loading="lazy"
                  className="h-14 w-14 object-cover"
                />
              ) : (
                <span className="max-w-[11rem] truncate px-3.5 py-2.5 text-xs font-medium text-slate-600">
                  {result.displayPrompt}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
