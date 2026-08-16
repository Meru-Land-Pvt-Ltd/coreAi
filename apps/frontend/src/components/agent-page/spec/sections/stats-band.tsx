import { SectionIntroBlock, SectionShell } from "./primitives";
import { sectionTokens, surfaceFor } from "./tokens";
import type { SectionProps } from "./types";

/**
 * Stats band — the proof strip. Two to four numbers, big and calm.
 *
 * The value takes the accent so the band carries the brand without a single
 * decorative shape; the label stays muted so the number is what you read.
 */

const COLUMN_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4"
};

export function StatsBandSection({ section, ctx }: SectionProps<"statsBand">) {
  const { node, parts } = section;
  const tokens = sectionTokens(ctx?.mode, ctx?.accent, ctx?.font);
  const surface = surfaceFor(tokens, node.background ?? "tint", node.style?.bgTone);
  const columns = COLUMN_CLASS[Math.min(parts.stats.length, 4)] ?? COLUMN_CLASS[4];
  const hasIntro = Boolean(parts.eyebrow || parts.heading || parts.subtext);

  return (
    <SectionShell node={node} kind="statsBand" surface={surface} tokens={tokens} padding="md">
      <SectionIntroBlock intro={parts} surface={surface} align={node.style?.align ?? "center"} />
      <div
        data-testid="spec-stats-grid"
        className={`grid gap-x-6 gap-y-10 ${columns} ${hasIntro ? "mt-10 sm:mt-14" : ""}`}
      >
        {parts.stats.map((stat) => (
          <div key={stat.id} data-testid="spec-stat" data-spec-node-id={stat.id} className="flex flex-col items-center gap-1.5 text-center">
            <span
              data-testid="spec-stat-value"
              className="text-[2.25rem] leading-none font-semibold tracking-tight sm:text-5xl"
              style={{ color: surface.accentInk }}
            >
              {stat.value}
            </span>
            <span
              data-testid="spec-stat-label"
              className="text-sm font-medium sm:text-[0.9375rem]"
              style={{ color: surface.inkMuted }}
            >
              {stat.label}
            </span>
            {stat.delta ? (
              <span data-testid="spec-stat-delta" className="text-xs font-semibold" style={{ color: surface.inkSubtle }}>
                {stat.delta}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </SectionShell>
  );
}
