import { ActionRow, Eyebrow, Headline, Prose, SectionShell } from "./primitives";
import { sectionTokens, surfaceFor, withAlpha } from "./tokens";
import type { SectionProps } from "./types";

/**
 * CTA band — the closing ask.
 *
 * Defaults to the dark surface so it reads as a deliberate break in the page
 * rather than one more white block, and the accent button carries all the
 * contrast. The architect can still override it (`background:"tint"`,
 * `style.bgTone:"accent"`) and the tokens keep every combination readable.
 */
export function CtaBandSection({ section, ctx }: SectionProps<"ctaBand">) {
  const { node, parts } = section;
  const tokens = sectionTokens(ctx?.mode, ctx?.accent, ctx?.font);
  const surface = surfaceFor(tokens, node.background ?? "dark", node.style?.bgTone);
  const align = node.style?.align ?? "center";

  return (
    <SectionShell
      node={node}
      kind="ctaBand"
      surface={surface}
      tokens={tokens}
      padding="lg"
      width="md"
      decoration={
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -bottom-32 -z-10 h-64"
          style={{
            background: `radial-gradient(50% 100% at 50% 100%, ${withAlpha(tokens.accent, 0.22)} 0%, transparent 72%)`
          }}
        />
      }
    >
      <div
        className={`flex flex-col gap-5 ${
          align === "center" ? "items-center text-center" : align === "right" ? "items-end text-right" : "items-start text-left"
        }`}
      >
        {parts.eyebrow ? <Eyebrow node={parts.eyebrow} surface={surface} testId="spec-cta-eyebrow" /> : null}
        {parts.heading ? (
          <Headline node={parts.heading} surface={surface} level={2} testId="spec-cta-heading" />
        ) : null}
        {parts.subtext ? (
          <Prose node={parts.subtext} surface={surface} size="lg" testId="spec-cta-subtext" className="max-w-xl" />
        ) : null}
        <ActionRow
          nodes={parts.actions}
          ctx={ctx}
          surface={surface}
          align={align}
          testId="spec-cta-actions"
          className={`mt-1 ${align === "center" ? "max-w-md" : "max-w-md"}`}
        />
        {parts.note ? (
          <Prose node={parts.note} surface={surface} size="sm" testId="spec-cta-note" className="opacity-90" />
        ) : null}
      </div>
    </SectionShell>
  );
}
