"use client";

import { memo, type CSSProperties, type ReactNode } from "react";
import { Download, ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import type { HistoryNode, ResultNode, SpecAlign, VisualResultsPayload } from "@coreai/shared";
import { surfaceInk, type SpecSurface } from "../spec-theme";
import { cx } from "../spec-tokens";
import { nodeShell } from "../node-shell";
import { resolveResultChannel, useSpecRun, type SpecRunResult } from "../spec-run";
import { RichText } from "../../rich-text";
import { VisualResults } from "../../blocks/visual-results";
import { isDataUri, isVideoUrl, mediaDownloadName } from "../../blocks/media";

/**
 * The output half of the contract — where the agent's answer lands.
 *
 * The visual grammar is the block renderer's (Result Viewer), rebuilt on the
 * spec theme so an answer looks native inside a dark hero or a warm band
 * instead of importing a white card into it. The renderers that actually draw
 * an answer are shared, not copied: `RichText` for prose and `VisualResults`
 * for stat cards / charts / tables.
 *
 * Three states, all of them designed rather than defaulted:
 *
 *   - **working** — a shimmer under the customer's own words, so they can see
 *     what is being answered;
 *   - **failed** — one plain sentence and a Try again that actually replays
 *     the same run;
 *   - **empty** — a quiet invitation, never a blank hole in the page.
 */

export type OutputNodeProps<T> = {
  node: T;
  surface: SpecSurface;
  align: SpecAlign;
};

const SKELETON_LINE_WIDTHS = ["w-full", "w-11/12", "w-3/4"];

function panelStyle(surface: SpecSurface): CSSProperties {
  const ink = surfaceInk(surface);
  return { background: ink.card, borderColor: ink.border, boxShadow: "var(--spec-shadow)" };
}

/** The customer's own words above an answer. Never the engine prompt. */
function PromptEcho({ text, surface }: { text: string; surface: SpecSurface }) {
  const ink = surfaceInk(surface);
  if (!text) return null;
  return (
    <p className="text-sm leading-6" style={{ color: ink.subtle }} data-testid="spec-result-prompt">
      &ldquo;{text}&rdquo;
    </p>
  );
}

// ---------------------------------------------------------------------------
// Media.
// ---------------------------------------------------------------------------

function MediaGrid({
  result,
  surface,
  listingName
}: {
  result: SpecRunResult;
  surface: SpecSurface;
  listingName: string;
}) {
  const ink = surfaceInk(surface);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="spec-result-media">
      {result.mediaUrls.map((url, index) => {
        // A spec result carries no per-tile kind, so the URL is the only
        // evidence: play what is unmistakably video, show everything else.
        const asVideo = isVideoUrl(url);
        return (
          <div
            key={`${result.id}-${index}`}
            className="group relative aspect-square overflow-hidden rounded-2xl border"
            style={{ borderColor: ink.border, background: ink.borderSoft }}
            data-testid="spec-result-tile"
          >
            {asVideo ? (
              <video
                src={url}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
              />
            ) : (
              // Generated media is an arbitrary remote host or a data: URI;
              // next/image would need every one allow-listed in next.config
              // before the tile could render at all.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={result.displayPrompt}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            )}
            {isDataUri(url) ? (
              <a
                href={url}
                download={mediaDownloadName(listingName, index)}
                aria-label="Download"
                data-testid="spec-result-download"
                className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm backdrop-blur transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100 motion-reduce:transition-none"
              >
                <Download className="h-4 w-4" aria-hidden />
              </a>
            ) : (
              // `download` is ignored cross-origin — be honest and open it.
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open full size in a new tab"
                data-testid="spec-result-open"
                className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm backdrop-blur transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100 motion-reduce:transition-none"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant filtering — `variant` narrows what an answer is allowed to show.
// ---------------------------------------------------------------------------

type ResultVariant = NonNullable<ResultNode["variant"]>;

/**
 * The structured payload a variant is willing to paint. `cards` shows only the
 * stat cards, `chart` only the chart, `table` only the table — so an architect
 * who asked for a chart gets a chart, not a chart plus a surprise table.
 */
function structuredFor(
  variant: ResultVariant,
  payload: VisualResultsPayload | null
): VisualResultsPayload | null {
  if (!payload) return null;
  switch (variant) {
    case "cards":
      return payload.stats ? { stats: payload.stats } : null;
    case "chart":
      return payload.chart ? { chart: payload.chart } : null;
    case "table":
      return payload.table ? { table: payload.table } : null;
    case "text":
    case "gallery":
      return null;
    case "auto":
    default:
      return payload;
  }
}

// ---------------------------------------------------------------------------
// result.
// ---------------------------------------------------------------------------

export const ResultNodeView = memo(function ResultNodeView({
  node,
  surface,
  align
}: OutputNodeProps<ResultNode>) {
  const run = useSpecRun();
  const shell = nodeShell(node, surface, align, { skipCard: true });
  const ink = surfaceInk(shell.surface);
  const variant: ResultVariant = node.variant ?? "auto";

  const wired = node.wire?.role === "output";
  const channel = run && wired ? resolveResultChannel(node.wire, run) : null;

  const pendingPrompt = run && channel ? run.pending[channel] ?? null : null;
  const failure = run && channel ? run.failed[channel] ?? null : null;
  const result = run && channel ? run.resultFor(channel) : null;

  const frame = (children: ReactNode, extra?: string) => (
    <div
      {...shell.test}
      data-spec-wired={wired ? "output" : "none"}
      data-spec-channel={channel ?? undefined}
      className={cx("flex w-full flex-col gap-3 text-left", shell.className, extra)}
    >
      {children}
    </div>
  );

  // The daily limit — honest, and it does not pretend an answer is coming.
  if (run?.limitReached && !result && !pendingPrompt) {
    return frame(
      <div
        className="w-full rounded-2xl border p-6 text-center"
        style={panelStyle(shell.surface)}
        data-testid="spec-result-limit"
      >
        <p className="text-base font-semibold" style={{ color: ink.ink }}>
          That&apos;s all the free runs for today
        </p>
        <p className="mt-1.5 text-sm leading-relaxed" style={{ color: ink.muted }}>
          Come back tomorrow, or get this agent to keep going without a daily cap.
        </p>
      </div>
    );
  }

  // Working.
  if (pendingPrompt !== null) {
    return frame(
      <>
        <PromptEcho text={pendingPrompt} surface={shell.surface} />
        <div
          className="w-full space-y-2.5 rounded-2xl border p-5"
          style={panelStyle(shell.surface)}
          data-testid="spec-result-working"
        >
          <p className="text-sm font-medium" style={{ color: ink.muted }}>
            Working on it…
          </p>
          {SKELETON_LINE_WIDTHS.map((width) => (
            <div
              key={width}
              className={cx(
                "h-4 animate-pulse rounded-full motion-reduce:animate-none",
                width
              )}
              style={{ background: ink.borderSoft }}
            />
          ))}
        </div>
      </>
    );
  }

  const structured = structuredFor(variant, result?.structured ?? null);
  const hasStructured = Boolean(
    structured && (structured.stats || structured.chart || structured.table)
  );
  const text = variant === "gallery" ? null : result?.text ?? null;
  const hasMedia = (result?.mediaUrls.length ?? 0) > 0;
  // "text" hides media only when there IS text to show — output is never lost.
  const showMedia = Boolean(result) && hasMedia && (variant !== "text" || !text);
  const showsNothing = Boolean(result) && !text && !showMedia && !hasStructured;

  return frame(
    <>
      {failure ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border px-4 py-3 text-sm leading-relaxed"
          style={{
            background: "rgba(239, 68, 68, 0.08)",
            borderColor: "rgba(239, 68, 68, 0.28)",
            color: shell.surface === "dark" ? "#fca5a5" : "#b91c1c"
          }}
          data-testid="spec-result-error"
        >
          <span>That didn&apos;t go through. Let&apos;s try again.</span>
          <button
            type="button"
            data-testid="spec-result-retry"
            onClick={() => channel && run?.retry(channel)}
            className="inline-flex items-center gap-1 font-semibold underline transition hover:opacity-80 motion-reduce:transition-none"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Try again
          </button>
        </div>
      ) : null}

      {result ? (
        <>
          <PromptEcho text={result.displayPrompt} surface={shell.surface} />

          {showMedia ? (
            <MediaGrid
              result={result}
              surface={shell.surface}
              listingName={run?.listingName ?? "result"}
            />
          ) : null}

          {text ? (
            <div
              className="w-full rounded-2xl border p-5"
              style={panelStyle(shell.surface)}
              data-testid="spec-result-text"
            >
              {/* Keyed by run so switching results restarts the reveal cleanly. */}
              <RichText
                key={result.id}
                text={text}
                reveal={result.id === run?.freshResultId}
                className="text-[15px]"
              />
            </div>
          ) : null}

          {hasStructured && structured ? (
            <VisualResults
              payload={structured}
              accent={run?.accent ?? "#f59e0b"}
              surface={shell.surface}
            />
          ) : null}

          {showsNothing ? (
            <p className="text-sm leading-relaxed" style={{ color: ink.muted }}>
              Nothing came back for that one. Try describing it a little differently.
            </p>
          ) : null}
        </>
      ) : !failure ? (
        <div
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center"
          style={{ borderColor: ink.border, background: ink.borderSoft, color: ink.subtle }}
          data-testid="spec-result-empty"
        >
          <Sparkles className="h-6 w-6" aria-hidden />
          <span className="text-sm">Your answer shows up here.</span>
        </div>
      ) : null}
    </>
  );
});

// ---------------------------------------------------------------------------
// history.
// ---------------------------------------------------------------------------

export const HistoryNodeView = memo(function HistoryNodeView({
  node,
  surface,
  align
}: OutputNodeProps<HistoryNode>) {
  const run = useSpecRun();
  const shell = nodeShell(node, surface, align, { skipCard: true });
  const ink = surfaceInk(shell.surface);

  const wired = node.wire?.role === "output";
  const channel = run && wired ? resolveResultChannel(node.wire, run) : null;

  // A wired history shows its channel's runs; with no provider (static
  // preview) it shows nothing at all rather than a lying placeholder.
  const runs = run && channel ? run.runsFor(channel) : [];
  const active = run && channel ? run.resultFor(channel) : null;

  // Nothing to remember yet — the shelf stays out of the way entirely, exactly
  // like the block renderer's History Shelf.
  if (runs.length === 0) return null;

  const shelf = [...runs].reverse();

  return (
    <div
      {...shell.test}
      data-spec-wired={wired ? "output" : "none"}
      data-spec-channel={channel ?? undefined}
      className={cx("w-full text-left", shell.className)}
    >
      <p
        className="text-xs font-semibold uppercase tracking-[0.08em]"
        style={{ color: ink.subtle }}
      >
        Earlier this session
      </p>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
        {shelf.map((entry) => {
          const isActive = entry.id === active?.id;
          const thumbnail = entry.mediaUrls.find((url) => !isVideoUrl(url));
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={isActive}
              data-testid="spec-history-item"
              data-active={isActive ? "true" : "false"}
              onClick={() => channel && run?.restore(channel, entry.id)}
              className="flex flex-none items-center overflow-hidden rounded-xl border transition hover:opacity-90 motion-reduce:transition-none"
              style={{
                background: ink.card,
                borderColor: isActive ? "var(--spec-accent)" : ink.border,
                boxShadow: isActive ? "0 0 0 2px var(--spec-accent-soft)" : "var(--spec-shadow-sm)"
              }}
            >
              {thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- see MediaGrid.
                <img
                  src={thumbnail}
                  alt={entry.displayPrompt}
                  loading="lazy"
                  className="h-14 w-14 object-cover"
                />
              ) : (
                <span
                  className="max-w-[11rem] truncate px-3.5 py-2.5 text-xs font-medium"
                  style={{ color: ink.muted }}
                >
                  {entry.displayPrompt}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});
