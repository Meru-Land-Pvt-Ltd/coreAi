"use client";

import { memo, useState, type CSSProperties } from "react";
import { CircleCheck, ImageOff, Quote as QuoteGlyph, TrendingDown, TrendingUp } from "lucide-react";
import type {
  BadgeNode,
  DividerNode,
  HeadingNode,
  IconNode,
  ImageNode,
  ListNode,
  QuoteNode,
  SpacerNode,
  SpecAlign,
  StatNode,
  TextNode
} from "@coreai/shared";
import { surfaceInk, textToneColor, type SpecSurface } from "../spec-theme";
import {
  cx,
  HEADING_SCALE,
  ICON_BOX,
  ICON_PIXELS,
  IMAGE_RATIO,
  PILL_SHELL,
  SPACER_HEIGHT,
  TEXT_ALIGN,
  TEXT_SCALE,
  tonePaint,
  type ToneName
} from "../spec-tokens";
import { nodeShell, resolveNodeAlign } from "../node-shell";
import { resolveIcon } from "../spec-icon";

/**
 * Content primitives — everything a page says that a customer cannot touch.
 *
 * Two rules hold across all of them:
 *
 *   1. Text is rendered as React children, never as HTML. There is no
 *      `dangerouslySetInnerHTML` anywhere in this folder, so a spec written by
 *      a language model cannot inject markup into a published page.
 *   2. Color comes from the surface, not from the node. A heading inside a
 *      dark section and the same heading on white are the same component with
 *      a different `surface` — the AI never picks a color.
 */

export type ContentNodeProps<T> = {
  node: T;
  surface: SpecSurface;
  align: SpecAlign;
};

// ---------------------------------------------------------------------------
// heading / text.
// ---------------------------------------------------------------------------

export const HeadingNodeView = memo(function HeadingNodeView({
  node,
  surface,
  align
}: ContentNodeProps<HeadingNode>) {
  const shell = nodeShell(node, surface, align);
  const level = node.level ?? 2;
  const textAlign = resolveNodeAlign(node.align, node.style, align);
  const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";

  return (
    <Tag
      {...shell.test}
      className={cx(HEADING_SCALE[level], TEXT_ALIGN[textAlign], shell.className)}
      style={{ ...shell.style, color: textToneColor(node.style?.textTone, shell.surface, "ink") }}
    >
      {node.text}
    </Tag>
  );
});

export const TextNodeView = memo(function TextNodeView({
  node,
  surface,
  align
}: ContentNodeProps<TextNode>) {
  const shell = nodeShell(node, surface, align);
  const textAlign = resolveNodeAlign(node.align, node.style, align);

  return (
    <p
      {...shell.test}
      className={cx(TEXT_SCALE[node.size ?? "md"], TEXT_ALIGN[textAlign], "text-pretty", shell.className)}
      // Body copy defaults to the muted ink: it sits under a heading far more
      // often than it stands alone, and muted still clears AA on every ramp.
      style={{ ...shell.style, color: textToneColor(node.style?.textTone, shell.surface, "muted") }}
    >
      {node.text}
    </p>
  );
});

// ---------------------------------------------------------------------------
// image.
// ---------------------------------------------------------------------------

export const ImageNodeView = memo(function ImageNodeView({
  node,
  surface,
  align
}: ContentNodeProps<ImageNode>) {
  const shell = nodeShell(node, surface, align, { skipCard: true });
  const ink = surfaceInk(surface);
  const [failed, setFailed] = useState(false);

  const ratio = node.ratio ?? "wide";
  const rounded = node.rounded !== false;
  const frameClass = cx(
    "relative w-full overflow-hidden",
    rounded ? "rounded-2xl" : "",
    IMAGE_RATIO[ratio],
    shell.className
  );
  const frameStyle = {
    background: ink.borderSoft,
    border: `1px solid ${ink.border}`,
    boxShadow: "var(--spec-shadow)"
  };

  // A dead URL is the one thing an AI-authored page gets wrong most often.
  // It degrades to a quiet placeholder that still carries the alt text.
  if (failed) {
    return (
      <div {...shell.test} className={frameClass} style={frameStyle}>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center"
          style={{ color: ink.subtle }}
        >
          <ImageOff size={22} strokeWidth={1.75} aria-hidden />
          {node.alt ? <span className="text-xs leading-5">{node.alt}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div {...shell.test} className={frameClass} style={frameStyle}>
      {/* eslint-disable-next-line @next/next/no-img-element -- spec image URLs are
          arbitrary remote hosts an architect typed; next/image would need each
          one allow-listed in next.config before the page could render at all. */}
      <img
        src={node.url}
        alt={node.alt ?? ""}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={cx(
          "block w-full",
          ratio === "auto" ? "h-auto" : "absolute inset-0 h-full object-cover"
        )}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// icon / badge / divider / spacer.
// ---------------------------------------------------------------------------

export const IconNodeView = memo(function IconNodeView({
  node,
  surface,
  align
}: ContentNodeProps<IconNode>) {
  const shell = nodeShell(node, surface, align, { skipCard: true });
  const ink = surfaceInk(surface);
  const size = node.size ?? "md";
  const Glyph = resolveIcon(node.name);

  return (
    <span
      {...shell.test}
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center border",
        ICON_BOX[size],
        shell.className
      )}
      style={{
        background: "var(--spec-accent-soft)",
        borderColor: "var(--spec-accent-line)",
        color: ink.accentInk
      }}
    >
      <Glyph size={ICON_PIXELS[size]} strokeWidth={1.75} />
    </span>
  );
});

export const BadgeNodeView = memo(function BadgeNodeView({
  node,
  surface,
  align
}: ContentNodeProps<BadgeNode>) {
  const shell = nodeShell(node, surface, align, { skipCard: true });

  return (
    <span
      {...shell.test}
      className={cx(PILL_SHELL, "w-fit", shell.className)}
      style={tonePaint((node.tone ?? "neutral") as ToneName, surface)}
    >
      {node.text}
    </span>
  );
});

export const DividerNodeView = memo(function DividerNodeView({
  node,
  surface,
  align
}: ContentNodeProps<DividerNode>) {
  const shell = nodeShell(node, surface, align, { skipCard: true });
  const ink = surfaceInk(surface);

  return (
    <hr
      {...shell.test}
      className={cx("h-px w-full border-0", shell.className)}
      style={{ background: ink.border }}
    />
  );
});

export const SpacerNodeView = memo(function SpacerNodeView({
  node,
  surface,
  align
}: ContentNodeProps<SpacerNode>) {
  const shell = nodeShell(node, surface, align, { skipCard: true });

  return (
    <div
      {...shell.test}
      aria-hidden="true"
      className={cx("w-full shrink-0", SPACER_HEIGHT[node.size ?? "md"])}
    />
  );
});

// ---------------------------------------------------------------------------
// list.
// ---------------------------------------------------------------------------

export const ListNodeView = memo(function ListNodeView({
  node,
  surface,
  align
}: ContentNodeProps<ListNode>) {
  const shell = nodeShell(node, surface, align);
  const ink = surfaceInk(shell.surface);
  const listStyle = node.listStyle ?? "check";
  const Tag = listStyle === "number" ? "ol" : "ul";

  return (
    <Tag
      {...shell.test}
      className={cx(
        "flex list-none flex-col gap-3 text-left",
        // List ITEMS always read left — a centered bullet list is unreadable.
        // In a centered column the BLOCK is centered instead, so the list sits
        // under its heading rather than stretching the full width.
        shell.align === "center" ? "mx-auto w-fit max-w-full" : "w-full",
        shell.className
      )}
      style={shell.style}
    >
      {node.items.map((item, index) => (
        <li key={`${node.id}-item-${index}`} className="flex items-start gap-3">
          {listStyle === "check" ? (
            <CircleCheck
              size={18}
              strokeWidth={2}
              aria-hidden
              className="mt-1 shrink-0"
              style={{ color: ink.accentInk }}
            />
          ) : null}
          {listStyle === "bullet" ? (
            <span
              aria-hidden="true"
              className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: ink.accentInk }}
            />
          ) : null}
          {listStyle === "number" ? (
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
              style={{ background: "var(--spec-accent-soft)", color: ink.accentInk }}
            >
              {index + 1}
            </span>
          ) : null}
          <span className="text-base leading-7" style={{ color: ink.muted }}>
            {item}
          </span>
        </li>
      ))}
    </Tag>
  );
});

// ---------------------------------------------------------------------------
// quote / stat — the two primitives that are cards on their own.
// ---------------------------------------------------------------------------

/**
 * A self-carding node's paint: its `bgTone` when the author set one, the plain
 * card surface otherwise. Never two nested cards.
 */
function selfCard(
  shellStyle: CSSProperties,
  isCard: boolean,
  surface: SpecSurface
): CSSProperties {
  if (isCard) return shellStyle;
  const ink = surfaceInk(surface);
  return { background: ink.card, borderColor: ink.border, boxShadow: "var(--spec-shadow)" };
}

export const QuoteNodeView = memo(function QuoteNodeView({
  node,
  surface,
  align
}: ContentNodeProps<QuoteNode>) {
  const shell = nodeShell(node, surface, align);
  const ink = surfaceInk(shell.surface);

  return (
    <figure
      {...shell.test}
      className={cx(
        "flex w-full flex-col gap-4 rounded-2xl border p-6 text-left sm:p-8",
        shell.className
      )}
      style={selfCard(shell.style, shell.isCard, surface)}
    >
      <QuoteGlyph size={22} strokeWidth={2} aria-hidden style={{ color: ink.accentInk }} />
      <blockquote className="text-lg leading-8 text-pretty sm:text-xl sm:leading-9" style={{ color: ink.ink }}>
        {node.text}
      </blockquote>
      {node.author ? (
        <figcaption className="flex flex-col gap-0.5 text-sm">
          <span className="font-semibold" style={{ color: ink.ink }}>
            {node.author}
          </span>
          {node.role ? <span style={{ color: ink.subtle }}>{node.role}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
});

/**
 * A delta reads as a direction, not a number: a leading "-" is a fall, a
 * leading "+" or digit is a rise, anything else stays neutral so a delta like
 * "same as last week" never turns green by accident.
 */
export function deltaTone(delta: string): { tone: ToneName; direction: "up" | "down" | "flat" } {
  const value = delta.trim();
  if (/^[-−–]/.test(value)) return { tone: "danger", direction: "down" };
  if (/^[+0-9]/.test(value)) return { tone: "success", direction: "up" };
  return { tone: "neutral", direction: "flat" };
}

export const StatNodeView = memo(function StatNodeView({
  node,
  surface,
  align
}: ContentNodeProps<StatNode>) {
  const shell = nodeShell(node, surface, align);
  const ink = surfaceInk(shell.surface);
  const delta = node.delta ? deltaTone(node.delta) : null;
  const DeltaGlyph = delta?.direction === "down" ? TrendingDown : TrendingUp;

  return (
    <div
      {...shell.test}
      className={cx(
        "flex w-full flex-col gap-2 rounded-2xl border p-5 text-left sm:p-6",
        shell.className
      )}
      style={selfCard(shell.style, shell.isCard, surface)}
    >
      <span
        className="text-xs font-medium uppercase tracking-[0.08em]"
        style={{ color: ink.subtle }}
      >
        {node.label}
      </span>
      <span
        className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl"
        style={{ color: ink.ink }}
      >
        {node.value}
      </span>
      {node.delta && delta ? (
        <span className={cx(PILL_SHELL, "w-fit tabular-nums")} style={tonePaint(delta.tone, shell.surface)}>
          {delta.direction === "flat" ? null : <DeltaGlyph size={13} strokeWidth={2.25} aria-hidden />}
          {node.delta}
        </span>
      ) : null}
    </div>
  );
});
