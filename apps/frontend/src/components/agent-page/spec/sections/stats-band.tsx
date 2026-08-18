import { SectionIntroBlock, SectionShell, StatDeltaPill } from "./primitives";
import { sectionTokens, surfaceFor } from "./tokens";
import type { SectionProps } from "./types";
import {
  displayValue,
  STAT_MEASURE,
  STAT_VALUE_TYPE_DISPLAY
} from "../../blocks/visual-format";

/**
 * Stats band — the proof strip. Two to four numbers, big and calm.
 *
 * The value takes the accent so the band carries the brand without a single
 * decorative shape; the label stays muted so the number is what you read.
 *
 * Numbers are set in tabular figures so a row of them stacks into a clean
 * column of digits rather than a ragged one, a missing value shows a quiet
 * dash instead of the model's "N/A", and a delta is a pill — the same pill the
 * Result Viewer's stat cards use, so a live answer and a published page agree.
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
        {parts.stats.map((stat) => {
          const value = displayValue(stat.value);
          const label = displayValue(stat.label);
          return (
            <div
              key={stat.id}
              data-testid="spec-stat"
              data-spec-node-id={stat.id}
              className={`flex min-w-0 flex-col items-center gap-1.5 text-center ${STAT_MEASURE}`}
            >
              <span
                data-testid="spec-stat-value"
                className={`max-w-full truncate font-semibold leading-none tracking-tight tabular-nums ${STAT_VALUE_TYPE_DISPLAY}`}
                style={{ color: surface.accentInk }}
                title={value}
              >
                {value}
              </span>
              <span
                data-testid="spec-stat-label"
                className="line-clamp-2 max-w-full text-sm font-medium sm:text-[0.9375rem]"
                style={{ color: surface.inkMuted }}
                title={label}
              >
                {label}
              </span>
              {stat.delta ? (
                <StatDeltaPill delta={stat.delta} surface={surface} className="mt-1" />
              ) : null}
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}
