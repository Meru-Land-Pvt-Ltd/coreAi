import { memo, type CSSProperties, type ReactNode } from "react";
import type { GridNode, RowNode, SectionNode, SpecAlign, StackNode } from "@coreai/shared";
import { surfaceInk, type SpecSurface } from "../spec-theme";
import {
  CONTAINER,
  cx,
  GRID_COLUMNS,
  GRID_GAP,
  ROW_GAP,
  ROW_JUSTIFY,
  SECTION_PADDING,
  STACK_ALIGN,
  STACK_GAP,
  TEXT_ALIGN
} from "../spec-tokens";
import { childAlign, nodeShell } from "../node-shell";

/**
 * Layout primitives. They never decide what goes inside them — the walker
 * renders children and hands them down — so a layout node is pure geometry
 * plus, for `section`, the one band of color a page is allowed to paint.
 *
 * Every one of them is mobile-first: a grid is one column until `sm:`, a row
 * wraps instead of overflowing, and section padding steps up with the screen
 * rather than down.
 */

export type LayoutNodeProps<T> = {
  node: T;
  surface: SpecSurface;
  align: SpecAlign;
  children: ReactNode;
};

// ---------------------------------------------------------------------------
// section — a full-bleed band with a shared content column inside it.
// ---------------------------------------------------------------------------

/**
 * The four backgrounds a section may paint. `gradient` and `dark` both carry a
 * soft off-center accent bloom (see `buildSpecTheme`) — that bloom is what
 * makes a hero look designed rather than filled.
 */
function sectionPaint(background: SectionNode["background"]): CSSProperties {
  switch (background) {
    case "tint":
      return {
        background: "var(--spec-tint)",
        borderTop: "1px solid var(--spec-border-soft)",
        borderBottom: "1px solid var(--spec-border-soft)",
        color: "var(--spec-ink)"
      };
    case "gradient":
      return { backgroundImage: "var(--spec-gradient)", color: "var(--spec-ink)" };
    case "dark":
      return {
        backgroundImage: "var(--spec-inverse-gradient)",
        backgroundColor: "var(--spec-inverse-ground)",
        color: "var(--spec-inverse-ink)"
      };
    case "plain":
    default:
      return { background: "var(--spec-ground)", color: "var(--spec-ink)" };
  }
}

export const SectionNodeView = memo(function SectionNodeView({
  node,
  surface,
  align,
  children
}: LayoutNodeProps<SectionNode>) {
  // A section paints its own band, so it never also paints a bgTone card.
  const shell = nodeShell(node, surface, align, { skipCard: true });
  const paint = sectionPaint(node.background);

  return (
    <section
      {...shell.test}
      className={cx("relative isolate w-full overflow-hidden", SECTION_PADDING[node.padding ?? "lg"])}
      style={paint}
    >
      <div className={cx(CONTAINER, TEXT_ALIGN[childAlign(node, align)])}>
        <div className={cx("flex w-full flex-col gap-6 sm:gap-8", shell.className)}>{children}</div>
      </div>
    </section>
  );
});

// ---------------------------------------------------------------------------
// stack / grid / row.
// ---------------------------------------------------------------------------

export const StackNodeView = memo(function StackNodeView({
  node,
  surface,
  align,
  children
}: LayoutNodeProps<StackNode>) {
  const shell = nodeShell(node, surface, align);

  return (
    <div
      {...shell.test}
      className={cx(
        "flex w-full flex-col",
        STACK_GAP[node.gap ?? "md"],
        STACK_ALIGN[node.align ?? "start"],
        TEXT_ALIGN[childAlign(node, align)],
        shell.className
      )}
      style={shell.style}
    >
      {children}
    </div>
  );
});

export const GridNodeView = memo(function GridNodeView({
  node,
  surface,
  align,
  children
}: LayoutNodeProps<GridNode>) {
  const shell = nodeShell(node, surface, align);

  return (
    <div
      {...shell.test}
      className={cx(
        "grid w-full items-stretch",
        GRID_COLUMNS[node.columns ?? 3],
        GRID_GAP[node.gap ?? "md"],
        TEXT_ALIGN[childAlign(node, align)],
        shell.className
      )}
      style={shell.style}
    >
      {children}
    </div>
  );
});

export const RowNodeView = memo(function RowNodeView({
  node,
  surface,
  align,
  children
}: LayoutNodeProps<RowNode>) {
  const shell = nodeShell(node, surface, align);

  return (
    <div
      {...shell.test}
      className={cx(
        // Wraps rather than collapsing: children keep their natural size on a
        // phone, and nothing can push the page into a horizontal scroll.
        "flex w-full flex-wrap items-center",
        ROW_GAP[node.gap ?? "md"],
        ROW_JUSTIFY[node.align ?? "start"],
        TEXT_ALIGN[childAlign(node, align)],
        shell.className
      )}
      style={shell.style}
    >
      {children}
    </div>
  );
});

/**
 * The implicit band the walker wraps loose top-level nodes in, so a page whose
 * author forgot to open a `section` still gets the shared content column and
 * never runs edge-to-edge.
 */
export function ImplicitSection({ children }: { children: ReactNode }) {
  const ink = surfaceInk("base");
  return (
    <section
      data-testid="spec-implicit-section"
      className={cx("relative w-full", SECTION_PADDING.md)}
      style={{ background: "var(--spec-ground)", color: ink.ink }}
    >
      <div className={CONTAINER}>
        <div className="flex w-full flex-col gap-6 sm:gap-8">{children}</div>
      </div>
    </section>
  );
}
