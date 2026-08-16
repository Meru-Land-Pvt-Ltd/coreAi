"use client";

import {
  createContext,
  memo,
  useContext,
  useMemo,
  type CSSProperties,
  type ReactNode
} from "react";
import { isContainerNode, type PageSpec, type ProductTheme, type SpecAlign, type SpecNode } from "@coreai/shared";
import { buildSpecTheme, type SpecSurface, type SpecTheme } from "./spec-theme";
import { childAlign, childSurface } from "./node-shell";
import { cx } from "./spec-tokens";
import {
  GridNodeView,
  ImplicitSection,
  RowNodeView,
  SectionNodeView,
  StackNodeView
} from "./nodes/layout-nodes";
import {
  BadgeNodeView,
  DividerNodeView,
  HeadingNodeView,
  IconNodeView,
  ImageNodeView,
  ListNodeView,
  QuoteNodeView,
  SpacerNodeView,
  StatNodeView,
  TextNodeView
} from "./nodes/content-nodes";

/**
 * SpecRenderer — walks one PageSpec and paints it.
 *
 * The doctrine, in code: the AI writes the design freely (this tree), our
 * renderer paints it (this file plus the node components), and the wires live
 * in named slots (the `renderNode` extension below). Nothing in a spec ever
 * becomes code, a class name, a color or markup — a node is a token bag, and
 * this walker is the only thing that decides what a token paints.
 *
 * Three invariants the rest of the product leans on:
 *
 *   1. **Nothing thrown, nothing blank.** A node whose type this renderer does
 *      not know is skipped in silence. One hallucinated block never costs the
 *      customer the rest of the page.
 *   2. **Stable handles.** Every painted node carries `data-testid` of
 *      `spec-node-<id>` and `data-spec-type`, and the page root carries
 *      `data-testid="spec-page"`.
 *   3. **No HTML from the spec.** Text is rendered as React children. There is
 *      no `dangerouslySetInnerHTML` in this folder, by design and by test.
 *
 * Interactive (`button`/`input`/`upload`/`choice`) and output (`result`/
 * `history`) nodes are NOT painted here — they are the wired half of the
 * product and live in their own files. They arrive through `renderNode`, so
 * that fleet never has to edit this walker to add a socket.
 */

// ---------------------------------------------------------------------------
// The extension point.
// ---------------------------------------------------------------------------

export type SpecNodeRenderContext = {
  node: SpecNode;
  /** The ink surface this node sits on ("dark" inside a dark band or card). */
  surface: SpecSurface;
  /** The text alignment handed down by the container. */
  align: SpecAlign;
  /** Already-painted children — containers only, undefined for leaves. */
  children?: ReactNode;
};

/**
 * Return an element to paint the node, or `undefined` to decline and let the
 * built-in renderer handle it. Declining an unknown type skips it silently.
 */
export type SpecNodeRenderer = (ctx: SpecNodeRenderContext) => ReactNode | undefined;

type SpecRuntime = { renderNode?: SpecNodeRenderer };

const SpecRuntimeContext = createContext<SpecRuntime>({});

/** Lets a nested renderer (the builder's preview) read the active extension. */
export function useSpecRuntime(): SpecRuntime {
  return useContext(SpecRuntimeContext);
}

// ---------------------------------------------------------------------------
// The walker.
// ---------------------------------------------------------------------------

type SpecNodeViewProps = {
  node: SpecNode;
  surface: SpecSurface;
  align: SpecAlign;
};

/**
 * One node, plus its subtree. Memoized on `{node, surface, align}` — all three
 * are stable references for an unchanged spec, so re-rendering a page after a
 * run only repaints the branch whose wire actually moved.
 */
export const SpecNodeView = memo(function SpecNodeView({
  node,
  surface,
  align
}: SpecNodeViewProps): ReactNode {
  const { renderNode } = useContext(SpecRuntimeContext);

  const children = isContainerNode(node) ? (
    <SpecNodes nodes={node.children} surface={childSurface(node, surface)} align={childAlign(node, align)} />
  ) : undefined;

  // The extension gets first refusal so a wired variant of a painted node
  // (a button that runs a chain) can replace the decorative one.
  if (renderNode) {
    const custom = renderNode({ node, surface, align, children });
    if (custom !== undefined) return custom;
  }

  switch (node.type) {
    case "section":
      return (
        <SectionNodeView node={node} surface={surface} align={align}>
          {children}
        </SectionNodeView>
      );
    case "stack":
      return (
        <StackNodeView node={node} surface={surface} align={align}>
          {children}
        </StackNodeView>
      );
    case "grid":
      return (
        <GridNodeView node={node} surface={surface} align={align}>
          {children}
        </GridNodeView>
      );
    case "row":
      return (
        <RowNodeView node={node} surface={surface} align={align}>
          {children}
        </RowNodeView>
      );
    case "heading":
      return <HeadingNodeView node={node} surface={surface} align={align} />;
    case "text":
      return <TextNodeView node={node} surface={surface} align={align} />;
    case "image":
      return <ImageNodeView node={node} surface={surface} align={align} />;
    case "icon":
      return <IconNodeView node={node} surface={surface} align={align} />;
    case "badge":
      return <BadgeNodeView node={node} surface={surface} align={align} />;
    case "divider":
      return <DividerNodeView node={node} surface={surface} align={align} />;
    case "spacer":
      return <SpacerNodeView node={node} surface={surface} align={align} />;
    case "list":
      return <ListNodeView node={node} surface={surface} align={align} />;
    case "quote":
      return <QuoteNodeView node={node} surface={surface} align={align} />;
    case "stat":
      return <StatNodeView node={node} surface={surface} align={align} />;
    default:
      // Interactive/output nodes with no extension mounted, and anything a
      // future spec version invents. Skipped without a word.
      return null;
  }
});

/** The decorative types this file paints without any help. */
const PAINTED_TYPES: ReadonlySet<string> = new Set([
  "heading",
  "text",
  "image",
  "icon",
  "badge",
  "divider",
  "spacer",
  "list",
  "quote",
  "stat"
]);

/**
 * Whether a node will put anything on the screen.
 *
 * A section holding only a wired button, on a page with no wire renderer
 * mounted, would otherwise paint a tall band of nothing — which is exactly the
 * "ugly" the doctrine forbids. Containers whose whole subtree paints nothing
 * are dropped along with it.
 *
 * `extended` is true when a wire renderer is mounted. It cannot be asked in
 * advance which nodes it will take, so we assume it takes them all and prune
 * nothing — the published page, where the wires are live, never loses a node
 * to this check.
 */
export function paintsSomething(node: SpecNode, extended: boolean): boolean {
  if (isContainerNode(node)) {
    return node.children.some((child) => paintsSomething(child, extended));
  }
  return extended || PAINTED_TYPES.has(node.type);
}

export type SpecNodesProps = {
  nodes: SpecNode[];
  surface: SpecSurface;
  align: SpecAlign;
};

/** Paints a list of sibling nodes. Exported for the wired-node fleet. */
export const SpecNodes = memo(function SpecNodes({ nodes, surface, align }: SpecNodesProps) {
  const { renderNode } = useContext(SpecRuntimeContext);
  const extended = Boolean(renderNode);

  return (
    <>
      {nodes
        .filter((node) => paintsSomething(node, extended))
        .map((node) => (
          <SpecNodeView key={node.id} node={node} surface={surface} align={align} />
        ))}
    </>
  );
});

// ---------------------------------------------------------------------------
// Page assembly.
// ---------------------------------------------------------------------------

/**
 * Groups the page's top-level blocks into bands. A run of loose nodes (an
 * author who wrote a heading straight into `blocks`) is wrapped in an implicit
 * section, so no page ever paints text against the window edge.
 */
type Band = { kind: "section"; node: SpecNode } | { kind: "loose"; nodes: SpecNode[] };

export function groupPageBands(blocks: SpecNode[]): Band[] {
  const bands: Band[] = [];
  let loose: SpecNode[] | null = null;

  for (const node of blocks) {
    if (node.type === "section") {
      loose = null;
      bands.push({ kind: "section", node });
      continue;
    }
    if (!loose) {
      loose = [];
      bands.push({ kind: "loose", nodes: loose });
    }
    loose.push(node);
  }
  return bands;
}

/**
 * A restrained entrance: bands rise into place once, staggered, and only when
 * the visitor has not asked for less motion. The resting state is fully
 * visible, so with `prefers-reduced-motion: reduce` (or no CSS at all) the
 * page simply appears.
 */
const REVEAL_CSS = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes spec-reveal {
    from { opacity: 0; transform: translate3d(0, 14px, 0); }
    to { opacity: 1; transform: none; }
  }
  [data-spec-root] > [data-spec-band] {
    animation: spec-reveal 620ms cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: var(--spec-band-delay, 0ms);
  }
}
`;

export type SpecRendererProps = {
  /** The page to paint. Already sanitized — see `sanitizeProductSpec`. */
  page: PageSpec;
  /** The spec's theme. Absent falls back to the Triven amber brand, light. */
  theme?: ProductTheme | null;
  /** Paints the wired nodes. Omit and they are skipped. */
  renderNode?: SpecNodeRenderer;
  className?: string;
  style?: CSSProperties;
};

/** How many bands still stagger before the delay is capped (a long page must
 *  not make its footer wait). */
const MAX_STAGGERED_BANDS = 5;

export function SpecRenderer({ page, theme, renderNode, className, style }: SpecRendererProps) {
  const specTheme: SpecTheme = useMemo(
    () => buildSpecTheme(theme ?? undefined),
    // The theme is three scalars; rebuilding on identity alone would recompute
    // the whole palette on every parent render.
    [theme?.accent, theme?.mode, theme?.font] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const runtime = useMemo<SpecRuntime>(() => ({ renderNode }), [renderNode]);
  const extended = Boolean(renderNode);
  const bands = useMemo(
    () => groupPageBands(page.blocks.filter((node) => paintsSomething(node, extended))),
    [page.blocks, extended]
  );

  return (
    <SpecRuntimeContext.Provider value={runtime}>
      <div
        data-spec-root=""
        data-testid="spec-page"
        data-spec-page={page.id}
        className={cx("w-full overflow-x-clip antialiased", className)}
        style={{ ...specTheme.vars, ...style }}
      >
        <style>{REVEAL_CSS}</style>
        {bands.map((band, index) => {
          const delay = `${Math.min(index, MAX_STAGGERED_BANDS) * 70}ms`;
          if (band.kind === "section") {
            return (
              <div
                key={band.node.id}
                data-spec-band=""
                style={{ "--spec-band-delay": delay } as CSSProperties}
              >
                <SpecNodeView node={band.node} surface="base" align="left" />
              </div>
            );
          }
          return (
            <div
              key={`loose-${band.nodes[0]?.id ?? index}`}
              data-spec-band=""
              style={{ "--spec-band-delay": delay } as CSSProperties}
            >
              <ImplicitSection>
                <SpecNodes nodes={band.nodes} surface="base" align="left" />
              </ImplicitSection>
            </div>
          );
        })}
      </div>
    </SpecRuntimeContext.Provider>
  );
}

export default SpecRenderer;
