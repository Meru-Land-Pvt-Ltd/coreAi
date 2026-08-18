import type { CSSProperties, ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import type {
  BadgeNode,
  ButtonNode,
  ChoiceNode,
  HeadingNode,
  ImageNode,
  InputNode,
  ListNode,
  SectionNode,
  SpecAlign,
  SpecNode,
  SpecTextTone,
  StatNode,
  UploadNode
} from "@coreai/shared";
import { SpecIcon } from "./icon";
import type { SectionSurface, SectionTokens } from "./tokens";
import { withAlpha } from "./tokens";
import type { ChromeKind, SectionContext, SectionIntro, SectionKind } from "./types";
import {
  deltaDirection,
  displayValue,
  EMPTY_GLYPH,
  STAT_MEASURE,
  STAT_VALUE_TYPE_WIDE
} from "../../blocks/visual-format";

/**
 * Shared building blocks for the sections library.
 *
 * Every section is a pure component: it takes already-extracted spec nodes and
 * a surface, and paints. Nothing here fetches, runs or stores anything — the
 * only escape hatch is `InteractiveSlot`, which hands wired nodes back to the
 * core renderer.
 *
 * Layout is Tailwind (so breakpoints are real CSS, mobile-first). Color is
 * inline style from the token layer (so the architect's accent can be any hex
 * without a build step). That split is deliberate and consistent everywhere.
 */

export const SECTION_TEST_IDS: Record<SectionKind | ChromeKind, string> = {
  hero: "spec-section-hero",
  featureGrid: "spec-section-feature-grid",
  statsBand: "spec-section-stats-band",
  pricingTable: "spec-section-pricing-table",
  testimonialRow: "spec-section-testimonial-row",
  faqAccordion: "spec-section-faq-accordion",
  ctaBand: "spec-section-cta-band",
  siteHeader: "spec-site-header",
  siteFooter: "spec-site-footer"
};

// ---------------------------------------------------------------------------
// Token → class helpers
// ---------------------------------------------------------------------------

const PADDING_CLASS: Record<string, string> = {
  sm: "py-10 sm:py-12",
  md: "py-14 sm:py-16 lg:py-20",
  lg: "py-16 sm:py-20 lg:py-28",
  xl: "py-20 sm:py-28 lg:py-36"
};

/**
 * A section's own width token, resolved against the page's measure
 * (`--spec-measure`, from the `contentWidth` dial).
 *
 * `lg` — the default — simply IS the measure, so turning the dial moves every
 * ordinary band. A band that asked to be narrow (`sm`/`md`: a CTA, an FAQ)
 * keeps its comfortable width but can never end up wider than the page it
 * sits on, hence `min()`. `full` is the opposite: at least its own 80rem, or
 * the measure when that is wider. Every cap applies from `lg` up only —
 * phones and tablets always use the full width they have.
 */
const WIDTH_CLASS: Record<string, string> = {
  sm: "lg:max-w-[min(42rem,var(--spec-measure,72rem))]",
  md: "lg:max-w-[min(56rem,var(--spec-measure,72rem))]",
  lg: "lg:max-w-[var(--spec-measure,72rem)]",
  full: "lg:max-w-[max(80rem,var(--spec-measure,72rem))]"
};

const ALIGN_CLASS: Record<SpecAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right"
};

const ALIGN_ITEMS_CLASS: Record<SpecAlign, string> = {
  left: "items-start",
  center: "items-center",
  right: "items-end"
};

const JUSTIFY_CLASS: Record<SpecAlign, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end"
};

export function alignClass(align?: SpecAlign | null): string {
  return ALIGN_CLASS[align ?? "left"];
}

export function alignItemsClass(align?: SpecAlign | null): string {
  return ALIGN_ITEMS_CLASS[align ?? "left"];
}

export function justifyClass(align?: SpecAlign | null): string {
  return JUSTIFY_CLASS[align ?? "left"];
}

/** Resolve a text tone against the surface the text sits on. */
export function toneColor(
  surface: SectionSurface,
  tone?: SpecTextTone | null,
  fallback?: string
): string {
  switch (tone) {
    case "muted":
      return surface.inkMuted;
    case "accent":
      return surface.accentInk;
    case "inverse":
      return surface.isDark ? "#0b1220" : "#ffffff";
    case "default":
      return surface.ink;
    default:
      return fallback ?? surface.ink;
  }
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function SectionShell({
  node,
  kind,
  surface,
  tokens,
  width,
  padding: defaultPadding,
  className,
  contentClassName,
  decoration,
  children
}: {
  node: SectionNode;
  kind: SectionKind;
  surface: SectionSurface;
  tokens: SectionTokens;
  width?: "sm" | "md" | "lg" | "full";
  /** Used when the spec node did not choose its own padding. */
  padding?: "sm" | "md" | "lg" | "xl";
  className?: string;
  contentClassName?: string;
  /** Full-bleed decoration painted behind the content, inside the section box. */
  decoration?: ReactNode;
  children: ReactNode;
}) {
  const padding = PADDING_CLASS[node.padding ?? defaultPadding ?? "lg"] ?? PADDING_CLASS.lg;
  const maxWidth = WIDTH_CLASS[node.style?.maxWidth ?? width ?? "lg"] ?? WIDTH_CLASS.lg;
  return (
    <section
      id={node.id}
      data-testid={SECTION_TEST_IDS[kind]}
      data-section-kind={kind}
      data-spec-node-id={node.id}
      data-surface={surface.key}
      className={`relative isolate w-full overflow-hidden ${padding} ${className ?? ""}`}
      style={{ background: surface.background, color: surface.ink, fontFamily: tokens.fontFamily }}
    >
      {decoration}
      <div className={`relative mx-auto w-full px-5 sm:px-6 lg:px-8 ${maxWidth} ${contentClassName ?? ""}`}>
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Content primitives
// ---------------------------------------------------------------------------

type BadgeTone = NonNullable<BadgeNode["tone"]>;

function badgeColors(
  surface: SectionSurface,
  tone?: BadgeTone
): { background: string; color: string; borderColor: string } {
  switch (tone) {
    case "success":
      return { background: withAlpha("#10b981", 0.14), color: surface.isDark ? "#6ee7b7" : "#047857", borderColor: withAlpha("#10b981", 0.3) };
    case "warning":
      return { background: withAlpha("#f59e0b", 0.16), color: surface.isDark ? "#fcd34d" : "#92400e", borderColor: withAlpha("#f59e0b", 0.32) };
    case "danger":
      return { background: withAlpha("#ef4444", 0.14), color: surface.isDark ? "#fca5a5" : "#b91c1c", borderColor: withAlpha("#ef4444", 0.3) };
    case "neutral":
      return { background: withAlpha(surface.isDark ? "#ffffff" : "#0f172a", 0.07), color: surface.inkMuted, borderColor: surface.border };
    default:
      return { background: surface.accentSoft, color: surface.accentInk, borderColor: surface.accentSoftBorder };
  }
}

/** The small pill above a headline. */
export function Eyebrow({
  node,
  surface,
  className,
  testId = "spec-eyebrow"
}: {
  node: BadgeNode;
  surface: SectionSurface;
  className?: string;
  testId?: string;
}) {
  const colors = badgeColors(surface, node.tone);
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide uppercase ${className ?? ""}`}
      style={colors}
    >
      {node.text}
    </span>
  );
}

const HEADLINE_CLASS: Record<1 | 2 | 3, string> = {
  1: "text-[2rem] leading-[1.1] sm:text-5xl lg:text-6xl font-semibold tracking-tight text-balance",
  2: "text-[1.75rem] leading-[1.15] sm:text-4xl lg:text-[2.75rem] font-semibold tracking-tight text-balance",
  3: "text-lg sm:text-xl font-semibold tracking-tight text-balance"
};

export function Headline({
  node,
  surface,
  level,
  className,
  testId
}: {
  node: HeadingNode;
  surface: SectionSurface;
  /** Overrides the spec level when the section knows better (a card title is always h3). */
  level?: 1 | 2 | 3;
  className?: string;
  testId?: string;
}) {
  const resolved = level ?? node.level ?? 2;
  const Tag = (resolved === 1 ? "h1" : resolved === 3 ? "h3" : "h2") as "h1" | "h2" | "h3";
  const align = node.align ?? node.style?.align;
  return (
    <Tag
      data-testid={testId}
      className={`${HEADLINE_CLASS[resolved]} ${align ? alignClass(align) : ""} ${className ?? ""}`}
      style={{ color: toneColor(surface, node.style?.textTone, surface.ink) }}
    >
      {node.text}
    </Tag>
  );
}

const PROSE_SIZE_CLASS: Record<string, string> = {
  sm: "text-sm leading-relaxed",
  md: "text-base leading-relaxed sm:text-[1.0625rem]",
  lg: "text-lg leading-relaxed sm:text-xl"
};

export function Prose({
  node,
  surface,
  size,
  className,
  testId
}: {
  node: { text: string; size?: "sm" | "md" | "lg"; align?: SpecAlign; style?: { align?: SpecAlign; textTone?: SpecTextTone } };
  surface: SectionSurface;
  size?: "sm" | "md" | "lg";
  className?: string;
  testId?: string;
}) {
  const resolved = size ?? node.size ?? "md";
  const align = node.align ?? node.style?.align;
  return (
    <p
      data-testid={testId}
      className={`${PROSE_SIZE_CLASS[resolved]} ${align ? alignClass(align) : ""} ${className ?? ""}`}
      style={{ color: toneColor(surface, node.style?.textTone, surface.inkMuted) }}
    >
      {node.text}
    </p>
  );
}

export function CheckBullet({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: withAlpha(color, 0.16), color }}
    >
      <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 10.5 8 14l7.5-8" />
      </svg>
    </span>
  );
}

export function SpecList({
  node,
  surface,
  className,
  testId = "spec-list"
}: {
  node: ListNode;
  surface: SectionSurface;
  className?: string;
  testId?: string;
}) {
  const style = node.listStyle ?? "check";
  if (style === "number") {
    return (
      <ol data-testid={testId} className={`space-y-2.5 ${className ?? ""}`} style={{ color: surface.inkMuted }}>
        {node.items.map((item, index) => (
          <li key={`${node.id}-${index}`} className="flex items-start gap-3 text-[0.9375rem] leading-relaxed">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold"
              style={{ backgroundColor: surface.accentSoft, color: surface.accentInk }}
            >
              {index + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ul data-testid={testId} className={`space-y-2.5 ${className ?? ""}`} style={{ color: surface.inkMuted }}>
      {node.items.map((item, index) => (
        <li key={`${node.id}-${index}`} className="flex items-start gap-3 text-[0.9375rem] leading-relaxed">
          {style === "bullet" ? (
            <span
              aria-hidden="true"
              className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: surface.accentInk }}
            />
          ) : (
            <CheckBullet color={surface.accent} />
          )}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const RATIO_CLASS: Record<string, string> = {
  square: "aspect-square",
  wide: "aspect-[16/10]",
  tall: "aspect-[3/4]",
  auto: ""
};

export function SpecImageBlock({
  node,
  surface,
  className,
  testId = "spec-image"
}: {
  node: ImageNode;
  surface: SectionSurface;
  className?: string;
  testId?: string;
}) {
  const ratio = RATIO_CLASS[node.ratio ?? "wide"] ?? "";
  const rounded = node.rounded === false ? "rounded-none" : "rounded-2xl";
  return (
    <div
      data-testid={testId}
      className={`relative overflow-hidden ${rounded} ${className ?? ""}`}
      style={{ border: `1px solid ${surface.cardBorder}`, boxShadow: surface.cardShadowLg, backgroundColor: surface.card }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={node.url}
        alt={node.alt}
        loading="lazy"
        decoding="async"
        className={`w-full ${ratio} ${node.ratio === "auto" ? "h-auto" : "h-full"} object-cover`}
      />
    </div>
  );
}

/**
 * The one delta treatment for the whole sections library: a small pill, green
 * for a rise and red for a fall, never bare coloured text. Direction comes
 * from the text itself — a leading minus falls, a leading plus or digit rises,
 * and "same as last week" stays neutral rather than turning green by accident.
 */
export function StatDeltaPill({
  delta,
  surface,
  className,
  testId = "spec-stat-delta"
}: {
  delta: string;
  surface: SectionSurface;
  className?: string;
  testId?: string;
}) {
  const text = displayValue(delta);
  if (text === EMPTY_GLYPH) return null;
  const direction = deltaDirection(delta);
  const paint =
    direction === "up"
      ? surface.isDark
        ? { fg: "#6ee7b7", bg: "rgba(16, 185, 129, 0.20)", border: "rgba(110, 231, 183, 0.34)" }
        : { fg: "#047857", bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.28)" }
      : direction === "down"
        ? surface.isDark
          ? { fg: "#fca5a5", bg: "rgba(239, 68, 68, 0.20)", border: "rgba(252, 165, 165, 0.32)" }
          : { fg: "#b91c1c", bg: "rgba(239, 68, 68, 0.10)", border: "rgba(239, 68, 68, 0.26)" }
        : { fg: surface.inkMuted, bg: surface.accentSoft, border: surface.accentSoftBorder };
  const Glyph = direction === "down" ? TrendingDown : TrendingUp;

  return (
    <span
      data-testid={testId}
      data-delta-dir={direction}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-[3px] text-xs font-semibold tabular-nums ${className ?? ""}`}
      style={{ color: paint.fg, background: paint.bg, borderColor: paint.border }}
    >
      {direction === "flat" ? null : (
        <>
          <Glyph size={13} strokeWidth={2.25} aria-hidden />
          <span className="sr-only">{direction === "up" ? "Up " : "Down "}</span>
        </>
      )}
      <span className="truncate">{text}</span>
    </span>
  );
}

export function SpecStatBlock({
  node,
  surface,
  className,
  testId = "spec-stat"
}: {
  node: StatNode;
  surface: SectionSurface;
  className?: string;
  testId?: string;
}) {
  const value = displayValue(node.value);
  const label = displayValue(node.label);
  return (
    <div
      data-testid={testId}
      className={`flex min-w-0 flex-col items-start gap-1.5 ${STAT_MEASURE} ${className ?? ""}`}
    >
      <span
        className={`max-w-full truncate font-semibold leading-tight tracking-tight tabular-nums ${STAT_VALUE_TYPE_WIDE}`}
        style={{ color: surface.ink }}
        title={value}
        data-testid="spec-stat-value"
      >
        {value}
      </span>
      <span
        className="max-w-full truncate text-sm font-medium"
        style={{ color: surface.inkMuted }}
        title={label}
        data-testid="spec-stat-label"
      >
        {label}
      </span>
      {node.delta ? <StatDeltaPill delta={node.delta} surface={surface} className="mt-0.5" /> : null}
    </div>
  );
}

/** Two-letter monogram for a testimonial avatar. */
export function Initials({ name, surface }: { name: string; surface: SectionSurface }) {
  const letters = String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden="true"
      data-testid="spec-avatar-initials"
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
      style={{ backgroundColor: surface.accentSoft, color: surface.accentInk, border: `1px solid ${surface.accentSoftBorder}` }}
    >
      {letters || "•"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

const BUTTON_SIZE_CLASS: Record<string, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-5 py-3 text-sm sm:text-base",
  lg: "px-6 py-3.5 text-base"
};

export function buttonStyleFor(
  variant: "primary" | "secondary" | "ghost" | undefined,
  surface: SectionSurface
): CSSProperties {
  if (variant === "secondary") {
    return {
      backgroundColor: surface.card,
      color: surface.ink,
      border: `1px solid ${surface.borderStrong}`,
      boxShadow: surface.cardShadow
    };
  }
  if (variant === "ghost") {
    return { backgroundColor: "transparent", color: surface.accentInk, border: "1px solid transparent" };
  }
  return {
    backgroundColor: surface.key === "accent" ? surface.ink : surface.accent,
    color: surface.key === "accent" ? surface.background : surface.onAccent,
    border: "1px solid transparent",
    boxShadow: surface.cardShadow
  };
}

/**
 * A painted button. This is the fallback used when the core renderer does not
 * claim the node (no wire, or a preview with no runtime) — it still navigates
 * when the spec gave it an `href`.
 */
export function SpecButton({
  node,
  surface,
  fullWidthOnMobile,
  className,
  testId = "spec-button"
}: {
  node: ButtonNode;
  surface: SectionSurface;
  fullWidthOnMobile?: boolean;
  className?: string;
  testId?: string;
}) {
  const size = BUTTON_SIZE_CLASS[node.size ?? "md"] ?? BUTTON_SIZE_CLASS.md;
  const shared = `inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 motion-reduce:transition-none ${size} ${
    fullWidthOnMobile ? "w-full sm:w-auto" : ""
  } ${className ?? ""}`;
  const style = {
    ...buttonStyleFor(node.variant, surface),
    "--tw-ring-color": withAlpha(surface.accent, 0.35)
  } as CSSProperties;

  if (node.href) {
    return (
      <a
        href={node.href}
        data-testid={testId}
        data-spec-node-id={node.id}
        className={shared}
        style={style}
      >
        {node.label}
      </a>
    );
  }
  return (
    <button
      type="button"
      data-testid={testId}
      data-spec-node-id={node.id}
      className={shared}
      style={style}
    >
      {node.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The seam: wired nodes go back to the core renderer.
// ---------------------------------------------------------------------------

function StaticInput({ node, surface }: { node: InputNode; surface: SectionSurface }) {
  const fieldStyle: CSSProperties = {
    backgroundColor: surface.card,
    color: surface.ink,
    border: `1px solid ${surface.borderStrong}`
  };
  const shared =
    "w-full rounded-xl px-4 py-3 text-base outline-none transition focus:ring-4 motion-reduce:transition-none";
  return (
    <div className="w-full" data-testid="spec-input" data-spec-node-id={node.id}>
      {node.label ? (
        <label htmlFor={`spec-field-${node.id}`} className="mb-1.5 block text-sm font-medium" style={{ color: surface.ink }}>
          {node.label}
        </label>
      ) : null}
      {node.multiline ? (
        <textarea
          id={`spec-field-${node.id}`}
          rows={4}
          placeholder={node.placeholder}
          aria-label={node.label ?? node.placeholder ?? "Your message"}
          className={shared}
          style={fieldStyle}
        />
      ) : (
        <input
          id={`spec-field-${node.id}`}
          type="text"
          placeholder={node.placeholder}
          aria-label={node.label ?? node.placeholder ?? "Your message"}
          className={shared}
          style={fieldStyle}
        />
      )}
    </div>
  );
}

function StaticUpload({ node, surface }: { node: UploadNode; surface: SectionSurface }) {
  return (
    <label
      htmlFor={`spec-upload-${node.id}`}
      data-testid="spec-upload"
      data-spec-node-id={node.id}
      className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-5 py-8 text-center transition hover:opacity-90 motion-reduce:transition-none"
      style={{ borderColor: surface.borderStrong, backgroundColor: surface.card, color: surface.inkMuted }}
    >
      <SpecIcon name="upload" className="h-6 w-6" />
      <span className="text-sm font-semibold" style={{ color: surface.ink }}>
        {node.label ?? "Add a file"}
      </span>
      <input id={`spec-upload-${node.id}`} type="file" accept={node.accept} className="sr-only" />
    </label>
  );
}

function StaticChoice({ node, surface }: { node: ChoiceNode; surface: SectionSurface }) {
  return (
    <div className="w-full" data-testid="spec-choice" data-spec-node-id={node.id}>
      {node.label ? (
        <label htmlFor={`spec-choice-${node.id}`} className="mb-1.5 block text-sm font-medium" style={{ color: surface.ink }}>
          {node.label}
        </label>
      ) : null}
      <select
        id={`spec-choice-${node.id}`}
        aria-label={node.label ?? "Choose an option"}
        defaultValue={node.options[0]}
        className="w-full rounded-xl px-4 py-3 text-base outline-none"
        style={{ backgroundColor: surface.card, color: surface.ink, border: `1px solid ${surface.borderStrong}` }}
      >
        {node.options.map((option, index) => (
          <option key={`${node.id}-${index}`} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function StaticOutput({ node, surface }: { node: SpecNode; surface: SectionSurface }) {
  const isHistory = node.type === "history";
  return (
    <div
      data-testid={isHistory ? "spec-history-placeholder" : "spec-result-placeholder"}
      data-spec-node-id={node.id}
      className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl px-6 py-10 text-center"
      style={{ backgroundColor: surface.card, border: `1px dashed ${surface.borderStrong}`, color: surface.inkSubtle }}
    >
      <SpecIcon name={isHistory ? "clock" : "sparkles"} className="h-6 w-6" />
      <span className="text-sm">{isHistory ? "Your past answers show up here." : "Your answer shows up here."}</span>
    </div>
  );
}

/**
 * Render one interactive or output node. The core renderer gets first refusal
 * (it owns the wires); when it declines, the section paints a static version
 * so the layout still reads correctly in previews and tests.
 */
export function InteractiveSlot({
  node,
  ctx,
  surface,
  fullWidthOnMobile
}: {
  node: SpecNode;
  ctx?: SectionContext;
  surface: SectionSurface;
  fullWidthOnMobile?: boolean;
}) {
  const claimed = ctx?.renderNode?.(node);
  if (claimed !== undefined && claimed !== null && claimed !== false) {
    return <>{claimed}</>;
  }
  switch (node.type) {
    case "button":
      return <SpecButton node={node} surface={surface} fullWidthOnMobile={fullWidthOnMobile} />;
    case "input":
      return <StaticInput node={node} surface={surface} />;
    case "upload":
      return <StaticUpload node={node} surface={surface} />;
    case "choice":
      return <StaticChoice node={node} surface={surface} />;
    case "result":
    case "history":
      return <StaticOutput node={node} surface={surface} />;
    default:
      return null;
  }
}

/**
 * The CTA row. Buttons sit side by side; a field (input/upload/choice) takes
 * the full width and pushes the buttons under it, which is the layout that
 * works at 375px and still looks deliberate at 1440px.
 */
export function ActionRow({
  nodes,
  ctx,
  surface,
  align = "left",
  className,
  testId = "spec-actions"
}: {
  nodes: SpecNode[];
  ctx?: SectionContext;
  surface: SectionSurface;
  align?: SpecAlign;
  className?: string;
  testId?: string;
}) {
  if (nodes.length === 0) return null;
  const fields = nodes.filter((node) => node.type !== "button");
  const buttons = nodes.filter((node) => node.type === "button");
  return (
    <div data-testid={testId} className={`flex w-full flex-col gap-3 ${className ?? ""}`}>
      {fields.map((node) => (
        <InteractiveSlot key={node.id} node={node} ctx={ctx} surface={surface} />
      ))}
      {buttons.length > 0 ? (
        <div className={`flex flex-col gap-3 sm:flex-row sm:flex-wrap ${justifyClass(align)}`}>
          {buttons.map((node) => (
            <InteractiveSlot
              key={node.id}
              node={node}
              ctx={ctx}
              surface={surface}
              fullWidthOnMobile={buttons.length <= 2}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The shared lead-in
// ---------------------------------------------------------------------------

export function SectionIntroBlock({
  intro,
  surface,
  align = "center",
  headingLevel = 2,
  className
}: {
  intro: SectionIntro;
  surface: SectionSurface;
  align?: SpecAlign;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  if (!intro.eyebrow && !intro.heading && !intro.subtext) return null;
  const maxWidth = align === "center" ? "mx-auto max-w-2xl" : "max-w-2xl";
  return (
    <div
      data-testid="spec-section-intro"
      className={`flex flex-col gap-4 ${alignItemsClass(align)} ${alignClass(align)} ${maxWidth} ${className ?? ""}`}
    >
      {intro.eyebrow ? <Eyebrow node={intro.eyebrow} surface={surface} /> : null}
      {intro.heading ? (
        <Headline node={intro.heading} surface={surface} level={headingLevel} testId="spec-section-heading" />
      ) : null}
      {intro.subtext ? (
        <Prose node={intro.subtext} surface={surface} size="lg" testId="spec-section-subtext" className="max-w-2xl" />
      ) : null}
    </div>
  );
}
