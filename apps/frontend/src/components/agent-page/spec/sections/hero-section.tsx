import type { SpecAlign } from "@coreai/shared";
import {
  ActionRow,
  Eyebrow,
  Headline,
  InteractiveSlot,
  Prose,
  SpecImageBlock,
  SpecList,
  SectionShell,
  alignClass,
  alignItemsClass
} from "./primitives";
import { sectionTokens, surfaceFor, withAlpha } from "./tokens";
import type { SectionProps } from "./types";

/**
 * Hero — the first thing a customer sees, and the section that decides whether
 * the product reads as real.
 *
 * Three layouts, chosen from what the AI actually wrote:
 *   - copy + product shot  → two columns on large screens, stacked on mobile
 *   - copy + a live socket → centered copy with the working product under it
 *   - copy only            → centered, narrow, generous
 *
 * The headline is `text-balance`, so a long line breaks evenly instead of
 * leaving one orphan word — the single detail that most separates a real SaaS
 * hero from a generated one.
 */
export function HeroSection({ section, ctx }: SectionProps<"hero">) {
  const { node, parts } = section;
  const tokens = sectionTokens(ctx?.mode, ctx?.accent, ctx?.font);
  const surface = surfaceFor(tokens, node.background ?? "gradient", node.style?.bgTone);

  const hasMedia = Boolean(parts.media);
  const align: SpecAlign =
    node.style?.align ?? parts.heading.align ?? (hasMedia ? "left" : "center");

  const copy = (
    <div className={`flex flex-col gap-5 sm:gap-6 ${alignItemsClass(align)} ${alignClass(align)}`}>
      {parts.eyebrow ? <Eyebrow node={parts.eyebrow} surface={surface} testId="spec-hero-eyebrow" /> : null}
      <Headline node={parts.heading} surface={surface} level={1} testId="spec-hero-heading" />
      {parts.subtext ? (
        <Prose
          node={parts.subtext}
          surface={surface}
          size="lg"
          testId="spec-hero-subtext"
          className="max-w-xl"
        />
      ) : null}
      {parts.bullets ? (
        <SpecList node={parts.bullets} surface={surface} testId="spec-hero-bullets" className="max-w-xl" />
      ) : null}
      {parts.actions.length > 0 ? (
        <ActionRow
          nodes={parts.actions}
          ctx={ctx}
          surface={surface}
          align={align}
          testId="spec-hero-actions"
          className={`mt-1 ${align === "center" ? "max-w-xl" : "max-w-lg"}`}
        />
      ) : null}
      {parts.note ? (
        <Prose node={parts.note} surface={surface} size="sm" testId="spec-hero-note" className="opacity-90" />
      ) : null}
    </div>
  );

  return (
    <SectionShell
      node={node}
      kind="hero"
      surface={surface}
      tokens={tokens}
      padding="xl"
      decoration={
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-96"
          style={{
            background: `radial-gradient(58% 100% at 50% 0%, ${withAlpha(tokens.accent, surface.isDark ? 0.3 : 0.18)} 0%, transparent 72%)`
          }}
        />
      }
    >
      {hasMedia && parts.media ? (
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          {copy}
          <div data-testid="spec-hero-media">
            <SpecImageBlock node={parts.media} surface={surface} />
          </div>
        </div>
      ) : (
        <div className={align === "center" ? "mx-auto max-w-3xl" : "max-w-3xl"}>{copy}</div>
      )}

      {parts.live.length > 0 ? (
        <div className="mx-auto mt-12 flex w-full max-w-3xl flex-col gap-4" data-testid="spec-hero-live">
          {parts.live.map((live) => (
            <InteractiveSlot key={live.id} node={live} ctx={ctx} surface={surface} />
          ))}
        </div>
      ) : null}
    </SectionShell>
  );
}
