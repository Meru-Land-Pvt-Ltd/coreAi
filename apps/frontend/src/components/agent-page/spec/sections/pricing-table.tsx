import type { ButtonNode } from "@coreai/shared";
import {
  CheckBullet,
  InteractiveSlot,
  Prose,
  SectionIntroBlock,
  SectionShell
} from "./primitives";
import { sectionTokens, surfaceFor, withAlpha } from "./tokens";
import type { SectionSurface } from "./tokens";
import type { PricingPlan, SectionContext, SectionProps } from "./types";

/**
 * Pricing table — 2 to 4 plans, one of them recommended.
 *
 * The recommended plan is decided by the recognizer (an explicit badge first,
 * then a lone primary button, then the middle of three). Here it gets the ring,
 * the deeper shadow and the solid CTA; every other plan gets the quiet
 * treatment. That single visual hierarchy is what makes a pricing table read as
 * a real product rather than three boxes.
 *
 * Columns stack on a phone, so the recommended plan is never hidden below the
 * fold in the middle of a horizontal scroll.
 */

const COLUMN_CLASS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4"
};

function PlanCard({
  plan,
  surface,
  ctx
}: {
  plan: PricingPlan;
  surface: SectionSurface;
  ctx?: SectionContext;
}) {
  const cta: ButtonNode | undefined = plan.cta
    ? { ...plan.cta, variant: plan.highlighted ? "primary" : plan.cta.variant ?? "secondary" }
    : undefined;

  return (
    <div
      data-testid="spec-plan"
      data-spec-node-id={plan.id}
      data-highlighted={plan.highlighted ? "true" : "false"}
      className="relative flex h-full flex-col gap-5 rounded-2xl p-6 sm:p-7"
      style={{
        backgroundColor: surface.card,
        border: plan.highlighted ? `1px solid ${surface.accentSoftBorder}` : `1px solid ${surface.cardBorder}`,
        boxShadow: plan.highlighted
          ? `0 0 0 2px ${withAlpha(surface.accent, 0.55)}, ${surface.cardShadowLg}`
          : surface.cardShadow
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight" style={{ color: surface.ink }} data-testid="spec-plan-name">
          {plan.name}
        </h3>
        {plan.highlighted ? (
          <span
            data-testid="spec-plan-badge"
            className="shrink-0 rounded-full px-3 py-1 text-[0.6875rem] font-bold tracking-wide uppercase"
            style={{ backgroundColor: surface.accent, color: surface.onAccent }}
          >
            {plan.badge?.text ?? "Recommended"}
          </span>
        ) : null}
      </div>

      {plan.price ? (
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            data-testid="spec-plan-price"
            className="text-4xl font-semibold tracking-tight"
            style={{ color: surface.ink }}
          >
            {plan.price}
          </span>
          {plan.period ? (
            <span data-testid="spec-plan-period" className="text-sm font-medium" style={{ color: surface.inkSubtle }}>
              {plan.period}
            </span>
          ) : null}
        </div>
      ) : null}

      {plan.description ? (
        <p data-testid="spec-plan-description" className="text-sm leading-relaxed" style={{ color: surface.inkMuted }}>
          {plan.description}
        </p>
      ) : null}

      {plan.features.length > 0 ? (
        <ul data-testid="spec-plan-features" className="flex flex-1 flex-col gap-2.5">
          {plan.features.map((feature, index) => (
            <li
              key={`${plan.id}-feature-${index}`}
              className="flex items-start gap-3 text-[0.9375rem] leading-relaxed"
              style={{ color: surface.inkMuted }}
            >
              <CheckBullet color={surface.accent} />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex-1" />
      )}

      {cta ? (
        <div className="mt-auto pt-1" data-testid="spec-plan-cta">
          <InteractiveSlot node={cta} ctx={ctx} surface={surface} />
        </div>
      ) : null}
    </div>
  );
}

export function PricingTableSection({ section, ctx }: SectionProps<"pricingTable">) {
  const { node, parts } = section;
  const tokens = sectionTokens(ctx?.mode, ctx?.accent, ctx?.font);
  const surface = surfaceFor(tokens, node.background ?? "plain", node.style?.bgTone);
  const columns = COLUMN_CLASS[Math.min(Math.max(parts.plans.length, 2), 4)] ?? COLUMN_CLASS[3];

  return (
    <SectionShell node={node} kind="pricingTable" surface={surface} tokens={tokens} padding="lg">
      <SectionIntroBlock intro={parts} surface={surface} align={node.style?.align ?? "center"} />
      <div
        data-testid="spec-pricing-grid"
        data-plan-count={parts.plans.length}
        className={`grid items-stretch gap-5 sm:gap-6 ${columns} ${
          parts.eyebrow || parts.heading || parts.subtext ? "mt-10 sm:mt-14" : ""
        }`}
      >
        {parts.plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} surface={surface} ctx={ctx} />
        ))}
      </div>
      {parts.note ? (
        <Prose
          node={parts.note}
          surface={surface}
          size="sm"
          testId="spec-pricing-note"
          className="mt-8 text-center"
        />
      ) : null}
    </SectionShell>
  );
}
