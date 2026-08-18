import type { FlexAlign, SpecAlign, SpecNode, SpecNodeType } from "@coreai/shared";
import type { CSSProperties } from "react";
import { surfaceInk, type SpecSurface } from "./spec-theme";
import {
  ALIGN_FROM_FLEX,
  bgToneSurface,
  CARD_SHELL,
  cx,
  MAX_WIDTH,
  MAX_WIDTH_PLACEMENT
} from "./spec-tokens";

/**
 * The wrapper contract every rendered node obeys, in one place:
 *
 *   - a stable `data-testid` of `spec-node-<id>` plus `data-spec-type`, so
 *     tests and the builder's inspector can find any node without knowing
 *     what it paints;
 *   - the universal `style` token bag (`maxWidth` + placement, `bgTone`);
 *   - the SURFACE its own ink reads from and the ALIGN its text takes, both
 *     of which a `bgTone` card or a container's alignment can change.
 *
 * Interactive and output nodes (a second builder's files) call this too — it
 * is the reason a wired button lands on the same grid as a decorative one.
 */

export type NodeShell = {
  /** Classes for the node's outermost element (max width, card geometry). */
  className: string;
  /** Inline paint for a `bgTone` card. Empty when the node is transparent. */
  style: CSSProperties;
  /** Surface the node's OWN ink reads from (a card can invert it). */
  surface: SpecSurface;
  /** Text alignment this node and its children take. */
  align: SpecAlign;
  /** True when `bgTone` turned this node into a painted card. */
  isCard: boolean;
  /** Spread onto the outermost element. */
  test: { "data-testid": string; "data-spec-type": SpecNodeType };
};

export type NodeShellOptions = {
  /**
   * Nodes that are already cards on their own (stat, quote) opt out, then
   * merge `bgTone` into their own surface instead of nesting two cards.
   */
  skipCard?: boolean;
};

export function nodeShell(
  node: SpecNode,
  surface: SpecSurface,
  inheritedAlign: SpecAlign,
  options: NodeShellOptions = {}
): NodeShell {
  const style = node.style;
  const align: SpecAlign = style?.align ?? inheritedAlign;

  const card = options.skipCard ? null : bgToneSurface(style?.bgTone, surface);

  const widthClass = style?.maxWidth
    ? cx(MAX_WIDTH[style.maxWidth], MAX_WIDTH_PLACEMENT[align])
    : "";

  return {
    className: cx(widthClass, card ? CARD_SHELL : ""),
    style: card ? card.style : {},
    surface: card ? card.surface : surface,
    align,
    isCard: Boolean(card),
    test: { "data-testid": `spec-node-${node.id}`, "data-spec-type": node.type }
  };
}

/**
 * The surface a container hands its children. Only two things flip it: a
 * `background:"dark"` section and a `bgTone` of `accent`/`dark`.
 */
export function childSurface(node: SpecNode, surface: SpecSurface): SpecSurface {
  if (node.type === "section") {
    return node.background === "dark" ? "dark" : "base";
  }
  return bgToneSurface(node.style?.bgTone, surface)?.surface ?? surface;
}

/**
 * The alignment a container hands its children: its own `style.align` wins,
 * then its box alignment (`stack`/`row`), then whatever it inherited.
 */
export function childAlign(node: SpecNode, inherited: SpecAlign): SpecAlign {
  if (node.style?.align) return node.style.align;
  if (node.type === "stack" || node.type === "row") {
    const boxAlign = (node as { align?: FlexAlign }).align;
    if (boxAlign) return ALIGN_FROM_FLEX[boxAlign] ?? inherited;
  }
  return inherited;
}

/** Convenience for node components that need the ink bag and nothing else. */
export function shellInk(shell: NodeShell) {
  return surfaceInk(shell.surface);
}

/**
 * A node's effective text alignment: its own `align` field wins, then its
 * `style.align` token, then whatever the container handed down.
 */
export function resolveNodeAlign(
  own: SpecAlign | undefined,
  style: SpecNode["style"],
  inherited: SpecAlign
): SpecAlign {
  return own ?? style?.align ?? inherited;
}
