import { SpecIcon } from "./icon";
import {
  Eyebrow,
  Headline,
  InteractiveSlot,
  Prose,
  SectionIntroBlock,
  SectionShell,
  SpecList
} from "./primitives";
import { sectionTokens, surfaceFor } from "./tokens";
import type { SectionSurface } from "./tokens";
import type { FeatureItem, SectionContext, SectionProps } from "./types";

/**
 * Feature grid — 2, 3 or 4 cards that say what the product does.
 *
 * Column counts collapse the same way at every size: one column on a phone,
 * two on a tablet, the spec's count on a laptop. Cards are equal height
 * (`h-full` inside a stretch grid) so a short card never leaves a ragged row.
 */

const COLUMN_CLASS: Record<2 | 3 | 4, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4"
};

function FeatureCard({
  item,
  surface,
  ctx
}: {
  item: FeatureItem;
  surface: SectionSurface;
  ctx?: SectionContext;
}) {
  return (
    <div
      data-testid="spec-feature-card"
      data-spec-node-id={item.id}
      className="flex h-full flex-col gap-4 rounded-2xl p-6 sm:p-7"
      style={{
        backgroundColor: surface.card,
        border: `1px solid ${surface.cardBorder}`,
        boxShadow: surface.cardShadow
      }}
    >
      {item.icon ? (
        <span
          data-testid="spec-feature-icon"
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl"
          style={{
            backgroundColor: surface.accentSoft,
            color: surface.accentInk,
            border: `1px solid ${surface.accentSoftBorder}`
          }}
        >
          <SpecIcon name={item.icon.name} className="h-5 w-5" />
        </span>
      ) : null}

      {item.badge ? <Eyebrow node={item.badge} surface={surface} testId="spec-feature-badge" className="self-start" /> : null}

      {item.title ? (
        <Headline node={item.title} surface={surface} level={3} testId="spec-feature-title" />
      ) : null}

      {item.body ? (
        <Prose node={item.body} surface={surface} size="sm" testId="spec-feature-body" className="flex-1" />
      ) : null}

      {item.bullets ? <SpecList node={item.bullets} surface={surface} testId="spec-feature-bullets" /> : null}

      {item.action ? (
        <div className="mt-auto pt-1">
          <InteractiveSlot node={{ ...item.action, variant: item.action.variant ?? "ghost" }} ctx={ctx} surface={surface} />
        </div>
      ) : null}
    </div>
  );
}

export function FeatureGridSection({ section, ctx }: SectionProps<"featureGrid">) {
  const { node, parts } = section;
  const tokens = sectionTokens(ctx?.mode, ctx?.accent, ctx?.font);
  const surface = surfaceFor(tokens, node.background ?? "plain", node.style?.bgTone);
  const columns = COLUMN_CLASS[parts.columns] ?? COLUMN_CLASS[3];
  const align = node.style?.align ?? "center";

  return (
    <SectionShell node={node} kind="featureGrid" surface={surface} tokens={tokens} padding="lg">
      <SectionIntroBlock intro={parts} surface={surface} align={align} />
      <div
        data-testid="spec-feature-grid"
        data-columns={parts.columns}
        className={`grid items-stretch gap-5 sm:gap-6 ${columns} ${
          parts.eyebrow || parts.heading || parts.subtext ? "mt-10 sm:mt-14" : ""
        }`}
      >
        {parts.items.map((item) => (
          <FeatureCard key={item.id} item={item} surface={surface} ctx={ctx} />
        ))}
      </div>
    </SectionShell>
  );
}
