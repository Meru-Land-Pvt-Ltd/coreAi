"use client";

import { useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
import type { PageSpec, ProductTheme, SpecNode } from "@coreai/shared";
import type { AgentPageRuntime } from "../types";
import { SpecRenderer, type SpecNodeRenderer } from "./spec-renderer";
import { buildSpecTheme, type SpecSurface } from "./spec-theme";
import { SpecRunProvider } from "./spec-run";
import {
  ButtonNodeView,
  ChoiceNodeView,
  InputNodeView,
  UploadNodeView
} from "./nodes/interactive-nodes";
import { HistoryNodeView, ResultNodeView } from "./nodes/output-nodes";

/**
 * The wired half, plugged into the renderer.
 *
 * `spec-renderer.tsx` paints everything decorative and hands anything it does
 * not know to a `renderNode` extension. This file IS that extension: six node
 * types, each of which reads the run state from `SpecRunProvider` rather than
 * from a closure.
 *
 * That indirection is the whole point of the file. If the renderer closed over
 * run state, its identity would change on every keystroke, the renderer
 * context would change with it, and every node on the page — decorative ones
 * included — would repaint. Because these are components that subscribe for
 * themselves, `useWiredNodeRenderer` is stable for the life of the page and a
 * keystroke repaints only the field that received it.
 */

/**
 * The `renderNode` extension for `SpecRenderer`. Stable across renders.
 *
 * Returns `undefined` for every type it does not own, which is the walker's
 * signal to paint the node itself.
 */
export function useWiredNodeRenderer(): SpecNodeRenderer {
  return useCallback(({ node, surface, align }) => {
    switch (node.type) {
      case "button":
        return <ButtonNodeView node={node} surface={surface} align={align} />;
      case "input":
        return <InputNodeView node={node} surface={surface} align={align} />;
      case "upload":
        return <UploadNodeView node={node} surface={surface} align={align} />;
      case "choice":
        return <ChoiceNodeView node={node} surface={surface} align={align} />;
      case "result":
        return <ResultNodeView node={node} surface={surface} align={align} />;
      case "history":
        return <HistoryNodeView node={node} surface={surface} align={align} />;
      default:
        return undefined;
    }
  }, []);
}

/**
 * The same six nodes behind the sections library's seam, whose `renderNode` is
 * `(node) => ReactNode` and carries no surface. Bind it per band:
 *
 *   const ctx = { renderNode: specSectionRenderNode(isDarkBand ? "dark" : "base") };
 *
 * Returning `null` for an unowned type is that library's "paint your own
 * static version" signal, so a decorative node still lands on its own path.
 */
export function specSectionRenderNode(
  surface: SpecSurface = "base"
): (node: SpecNode) => ReactNode {
  // Named (not an arrow) so it reads as a render function rather than an
  // anonymous component in stack traces and lint.
  return function renderWiredSectionNode(node: SpecNode): ReactNode {
    switch (node.type) {
      case "button":
        return <ButtonNodeView node={node} surface={surface} align="left" />;
      case "input":
        return <InputNodeView node={node} surface={surface} align="left" />;
      case "upload":
        return <UploadNodeView node={node} surface={surface} align="left" />;
      case "choice":
        return <ChoiceNodeView node={node} surface={surface} align="left" />;
      case "result":
        return <ResultNodeView node={node} surface={surface} align="left" />;
      case "history":
        return <HistoryNodeView node={node} surface={surface} align="left" />;
      default:
        return null;
    }
  };
}

// ---------------------------------------------------------------------------
// The whole thing, in one component.
// ---------------------------------------------------------------------------

export type SpecProductProps = {
  /** The page to paint. Already sanitized — see `sanitizeProductSpec`. */
  page: PageSpec;
  /** The spec's theme. Absent falls back to the Triven amber brand, light. */
  theme?: ProductTheme | null;
  /** The engine behind the wires — live page or builder preview. */
  runtime: AgentPageRuntime;
  /** Runs left today. `<= 0` opens the page in its limit state. */
  remainingToday?: number;
  /** Listing name — used for media download filenames. */
  listingName?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * One page of a Product Spec, with its wires live: decoration painted by the
 * walker, sockets driven by the shared run state.
 *
 * This is the component a published page mounts. Rendering `SpecRenderer`
 * directly (no provider, no extension) is still valid and still beautiful —
 * that is the static preview, where every socket paints itself inert.
 */
export function SpecProduct({
  page,
  theme,
  runtime,
  remainingToday,
  listingName,
  className,
  style
}: SpecProductProps) {
  const renderNode = useWiredNodeRenderer();
  // The charts want a concrete hex, and the theme is the one place a color is
  // decided — so it is resolved once here rather than guessed per result.
  const accent = useMemo(
    () => buildSpecTheme(theme ?? undefined).accent,
    [theme?.accent, theme?.mode, theme?.font] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <SpecRunProvider
      page={page}
      runtime={runtime}
      remainingToday={remainingToday}
      accent={accent}
      listingName={listingName}
    >
      <SpecRenderer
        page={page}
        theme={theme}
        renderNode={renderNode}
        className={className}
        style={style}
      />
    </SpecRunProvider>
  );
}

export default SpecProduct;
