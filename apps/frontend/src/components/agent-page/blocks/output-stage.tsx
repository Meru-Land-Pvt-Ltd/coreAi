"use client";

import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { isDataUri, isImageLikeUrl, isVideoUrl, mediaDownloadName } from "./media";

/**
 * Result Viewer block — a shimmer skeleton while a run is in flight, then the
 * run's output: a responsive media grid with open/download tile actions
 * (identical patterns to the media template) and/or text in a clean prose
 * card. `kind` forces the presentation; "auto" infers it from the output.
 */

export type OutputStageKind = "auto" | "image" | "video" | "text";

/** One finished run this session — also what the History Shelf restores. */
export type FaceRunResult = {
  id: number;
  /**
   * What the customer typed (or the Continue button's label) — the ONLY
   * prompt text ever shown on the page. The engine prompt with the hidden
   * style instructions and model context never appears anywhere.
   */
  displayPrompt: string;
  /**
   * The customer's typed prompt that seeded this chain of runs. Continue
   * chains from this (or the last output text), never from the augmented
   * engine prompt — so repeated Continues never nest scaffolding.
   */
  basePrompt: string;
  text: string | null;
  mediaUrls: string[];
};

const SKELETON_TILE_COUNT = 3;
const SKELETON_LINE_WIDTHS = ["w-full", "w-11/12", "w-3/4"];

function MediaGrid({
  result,
  kind,
  listingName
}: {
  result: FaceRunResult;
  kind: OutputStageKind;
  listingName: string;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {result.mediaUrls.map((url, index) => {
        // "video" is a hint, not a hammer: an unmistakable image URL still
        // renders as an image even when the block is set to video.
        const asVideo = isVideoUrl(url) || (kind === "video" && !isImageLikeUrl(url));
        return (
          <div
            key={`${result.id}-${index}`}
            className="group relative aspect-square overflow-hidden rounded-2xl border border-gray-100 bg-slate-50 shadow-sm"
            data-testid="agent-block-output-tile"
          >
            {asVideo ? (
              <video
                src={url}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
              />
            ) : isDataUri(url) ? (
              // Browsers refuse to open data: URIs as a page — the overlay
              // button (a real download) is the tile action.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={result.displayPrompt}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open full size in a new tab"
                className="block h-full w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={result.displayPrompt}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </a>
            )}
            {isDataUri(url) ? (
              <a
                href={url}
                download={mediaDownloadName(listingName, index)}
                aria-label="Download"
                data-testid="agent-block-output-download"
                className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm backdrop-blur transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100 motion-reduce:transition-none"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : (
              // The download attribute is ignored cross-origin — be honest
              // and open the media full size instead.
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open full size in a new tab"
                data-testid="agent-block-output-open"
                className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm backdrop-blur transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100 motion-reduce:transition-none"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function OutputStageBlock({
  kind,
  runningPrompt,
  result,
  listingName,
  error
}: {
  kind: OutputStageKind;
  /** Non-null while a run is in flight — shows the shimmer skeleton. */
  runningPrompt: string | null;
  /** The result currently on stage (latest run, or one restored from history). */
  result: FaceRunResult | null;
  listingName: string;
  /** Non-null after a failed run — shows a soft error strip with a retry. */
  error: { onRetry: () => void } | null;
}) {
  if (runningPrompt !== null) {
    return (
      <section className="mt-8" data-testid="agent-block-output-stage">
        <p className="text-sm leading-relaxed text-slate-500">&ldquo;{runningPrompt}&rdquo;</p>
        {kind === "text" ? (
          <div
            className="mt-3 space-y-2.5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
            data-testid="agent-block-output-skeleton"
          >
            {SKELETON_LINE_WIDTHS.map((width) => (
              <div
                key={width}
                className={`h-4 animate-pulse rounded-full bg-slate-100 motion-reduce:animate-none ${width}`}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: SKELETON_TILE_COUNT }, (_, index) => (
              <div
                key={index}
                className="aspect-square animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none"
                data-testid="agent-block-output-skeleton"
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  const hasMedia = (result?.mediaUrls.length ?? 0) > 0;
  const text = result?.text ?? null;
  // "text" hides media only when there is text to show — output is never lost.
  const showMedia = result !== null && hasMedia && (kind !== "text" || !text);

  return (
    <section className="mt-8" data-testid="agent-block-output-stage">
      {error ? (
        <div className="mb-3" data-testid="agent-block-run-error">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm leading-relaxed text-red-700">
            <span>Something went wrong. Please try again.</span>
            <button
              type="button"
              data-testid="agent-block-retry"
              onClick={error.onRetry}
              className="inline-flex items-center gap-1 font-semibold underline transition hover:text-red-800 motion-reduce:transition-none"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <>
          <p className="text-sm leading-relaxed text-slate-500">&ldquo;{result.displayPrompt}&rdquo;</p>

          {showMedia ? <MediaGrid result={result} kind={kind} listingName={listingName} /> : null}

          {text ? (
            showMedia ? (
              <p
                className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600"
                data-testid="agent-block-output-text"
              >
                {text}
              </p>
            ) : (
              <div
                className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
                data-testid="agent-block-output-text"
              >
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">
                  {text}
                </p>
              </div>
            )
          ) : null}

          {!hasMedia && !text ? (
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Nothing came back for that one. Try describing it a little differently.
            </p>
          ) : null}
        </>
      ) : !error ? (
        <div
          className="rounded-2xl border border-dashed border-gray-200 bg-slate-50/50 p-8 text-center"
          data-testid="agent-block-output-empty"
        >
          <p className="text-sm text-slate-400">Your result will appear here.</p>
        </div>
      ) : null}
    </section>
  );
}
