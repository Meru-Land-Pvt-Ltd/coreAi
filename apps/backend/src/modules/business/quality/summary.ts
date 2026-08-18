import { RUBRIC_DIMENSION_KEYS } from "./rubric";

/**
 * Pure JS aggregation for the quality summary — deliberately not prisma
 * groupBy so the math is unit-testable by feeding plain rows. Rules the
 * whole feature depends on:
 * - Effective score is COALESCE(adjustedScore, overallScore).
 * - EXCLUDED rows never enter any average or count.
 */

export type SummaryEvaluationRow = {
  id: string;
  vapiCallId: string | null;
  handledBy: string;
  status: string;
  overallScore: number;
  adjustedScore: number | null;
  confidence: number;
  dimensionsJson: unknown;
  missedOpportunitiesJson: unknown;
  createdAt: Date;
};

export type QualityWeekBucket = {
  /** ISO date (YYYY-MM-DD) of the Monday starting the week. */
  weekStart: string;
  count: number;
  averageScore: number | null;
};

export type QualitySummary = {
  totalEvaluations: number;
  excludedCount: number;
  averageScore: number | null;
  averageConfidence: number | null;
  dimensionAverages: Record<string, number | null>;
  trend: QualityWeekBucket[];
  best: Array<{ id: string; vapiCallId: string | null; score: number; handledBy: string; createdAt: Date }>;
  worst: Array<{ id: string; vapiCallId: string | null; score: number; handledBy: string; createdAt: Date }>;
  missedOpportunityCount: number;
};

export function effectiveScore(row: Pick<SummaryEvaluationRow, "overallScore" | "adjustedScore">): number {
  return row.adjustedScore ?? row.overallScore;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** Monday 00:00 UTC of the week containing `date`. */
function weekStartUtc(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function computeQualitySummary(
  rows: SummaryEvaluationRow[],
  options?: { now?: Date; trendWeeks?: number; topCount?: number }
): QualitySummary {
  const now = options?.now ?? new Date();
  const trendWeeks = options?.trendWeeks ?? 8;
  const topCount = options?.topCount ?? 5;

  const excluded = rows.filter((row) => row.status === "EXCLUDED");
  const included = rows.filter((row) => row.status !== "EXCLUDED");

  const scores = included.map((row) => effectiveScore(row));
  const confidences = included.map((row) => row.confidence).filter((c) => Number.isFinite(c));

  // Dimension averages over rows whose dimensionsJson carries numbers.
  const dimensionAverages: Record<string, number | null> = {};
  for (const key of RUBRIC_DIMENSION_KEYS) {
    const values: number[] = [];
    for (const row of included) {
      const dims = row.dimensionsJson;
      if (dims && typeof dims === "object" && !Array.isArray(dims)) {
        const value = (dims as Record<string, unknown>)[key];
        if (typeof value === "number" && Number.isFinite(value)) values.push(value);
      }
    }
    dimensionAverages[key] = average(values);
  }

  // Weekly trend, oldest → newest, always exactly trendWeeks buckets.
  const thisWeek = weekStartUtc(now);
  const trend: QualityWeekBucket[] = [];
  for (let i = trendWeeks - 1; i >= 0; i--) {
    const start = new Date(thisWeek);
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const bucketRows = included.filter((row) => row.createdAt >= start && row.createdAt < end);
    trend.push({
      weekStart: isoDate(start),
      count: bucketRows.length,
      averageScore: average(bucketRows.map((row) => effectiveScore(row))),
    });
  }

  const ranked = [...included].sort((a, b) => effectiveScore(b) - effectiveScore(a));
  const brief = (row: SummaryEvaluationRow) => ({
    id: row.id,
    vapiCallId: row.vapiCallId,
    score: round2(effectiveScore(row)),
    handledBy: row.handledBy,
    createdAt: row.createdAt,
  });

  const missedOpportunityCount = included.reduce((sum, row) => {
    const value = row.missedOpportunitiesJson;
    return sum + (Array.isArray(value) ? value.length : 0);
  }, 0);

  return {
    totalEvaluations: included.length,
    excludedCount: excluded.length,
    averageScore: average(scores),
    averageConfidence: average(confidences),
    dimensionAverages,
    trend,
    best: ranked.slice(0, topCount).map(brief),
    worst: ranked.slice(-topCount).reverse().map(brief),
    missedOpportunityCount,
  };
}
