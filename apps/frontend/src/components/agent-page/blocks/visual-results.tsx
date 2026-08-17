"use client";

import type { CSSProperties } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import type {
  VisualChart,
  VisualChartPoint,
  VisualResultsPayload,
  VisualStat,
  VisualTable
} from "@coreai/shared";
import {
  compactNumber,
  deltaDirection,
  displayValue,
  isNumericColumn,
  STAT_MEASURE,
  STAT_VALUE_TYPE,
  type DeltaDirection
} from "./visual-format";
import { visualPalette, type VisualPalette, type VisualSurface } from "./visual-palette";

/**
 * Visual Results renderer — the Result Viewer's rich mode, and the same
 * component the generated product pages use for a structured answer.
 *
 * When an AI Brain replies with the visual JSON contract (see
 * packages/shared/visual-results.ts) the run's `structured` payload lands here
 * and renders as stat cards, a chart, and/or a table.
 *
 * Three rules hold across all of it:
 *
 *   1. **No chart library.** The plots are HTML boxes over an inline SVG grid.
 *      That split is deliberate: a single SVG scaled by a viewBox scales its
 *      TEXT too, so labels end up 6px on a phone and 28px on a desktop. Here
 *      the geometry (gridlines, the line, its area) lives in an SVG that is
 *      allowed to stretch, and every label is real HTML text that stays the
 *      size it was designed at, at 375px and at 1440px alike.
 *   2. **One colour input.** Everything is derived from the page accent by
 *      `visualPalette` — bars, the pie ramp, the card wash. Neutrals resolve
 *      through the Product Spec variables when they exist, so an answer inside
 *      a dark or warm generated page is native to it rather than a white slab
 *      dropped on top.
 *   3. **Nothing pretends.** A value the model left empty renders as a quiet
 *      dash, never "N/A" and never "(missing)".
 *
 * The payload is already validated and hygiened on the backend; this component
 * only lays it out.
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Plot height. Tall enough to read a trend, short enough to sit in a card.
 * The `xl` step exists because a wide page gives the plot ~980px of width, and
 * 980×232 is a letterbox — the taller step keeps it near 3.5:1.
 */
const PLOT_HEIGHT = "h-[172px] sm:h-[208px] lg:h-[232px] xl:h-[268px]";
/** Left gutter that holds the value axis, matched by the x-label row. */
const AXIS_WIDTH = "w-9 shrink-0 sm:w-11";
/** How many horizontal gridlines (including the zero rule). */
const GRID_LINES = 5;

// ---------------------------------------------------------------------------
// Shared card chrome
// ---------------------------------------------------------------------------

/**
 * The one card recipe: a hairline, a soft lift, and a barely-there accent wash
 * across the top-left. The wash is what stops a stat reading as a flat white
 * slab — it is under 8% alpha, so you feel it rather than see it.
 */
function cardStyle(palette: VisualPalette): CSSProperties {
  return {
    backgroundColor: palette.card,
    backgroundImage: palette.cardWash,
    borderColor: palette.border,
    boxShadow: palette.shadow
  };
}

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------

/**
 * Column count follows the number of stats so the last row is never a lonely
 * orphan: three stats become three columns, not four with a hole.
 */
function statColumns(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-2 lg:grid-cols-3";
  return "grid-cols-2 lg:grid-cols-4";
}

function DeltaPill({
  delta,
  direction,
  palette
}: {
  delta: string;
  direction: DeltaDirection;
  palette: VisualPalette;
}) {
  const paint = direction === "up" ? palette.up : direction === "down" ? palette.down : palette.flat;
  const Glyph = direction === "down" ? TrendingDown : TrendingUp;
  return (
    <span
      data-testid="agent-visual-stat-delta"
      data-delta-dir={direction}
      // `self-start` is load-bearing: the card is a flex COLUMN, so without it
      // the pill stretches to the full card width and a "+318" floats inside a
      // 218px capsule. A delta pill hugs its own text or it looks like a bug.
      className="mt-2.5 inline-flex max-w-full self-start items-center gap-1 rounded-full border px-2 py-[3px] text-xs font-semibold tabular-nums"
      style={{ color: paint.fg, background: paint.bg, borderColor: paint.border }}
    >
      {direction === "flat" ? null : (
        <>
          <Glyph className="h-3 w-3 flex-none" aria-hidden="true" />
          <span className="sr-only">{direction === "up" ? "Up " : "Down "}</span>
        </>
      )}
      <span className="truncate">{delta}</span>
    </span>
  );
}

function StatCards({ stats, palette }: { stats: VisualStat[]; palette: VisualPalette }) {
  return (
    <div
      className={cx("grid gap-3 sm:gap-4", statColumns(stats.length))}
      data-testid="agent-visual-stats"
    >
      {stats.map((stat, index) => {
        const value = displayValue(stat.value);
        const label = displayValue(stat.label);
        const delta = displayValue(stat.delta);
        const hasDelta = Boolean(stat.delta) && delta !== "—";
        return (
          <div
            key={index}
            className={cx(
              "agent-visual-enter flex min-w-0 flex-col rounded-2xl border p-4 text-left sm:p-5",
              // The card measures itself so the number below can size to the
              // room it actually has, at every screen width and every dial.
              STAT_MEASURE
            )}
            style={{ ...cardStyle(palette), animationDelay: `${index * 45}ms` }}
            data-testid="agent-visual-stat"
          >
            <span
              className="truncate text-[0.6875rem] font-semibold uppercase leading-4 tracking-[0.09em]"
              style={{ color: palette.subtle }}
              title={label}
            >
              {label}
            </span>
            <span
              className={cx(
                "mt-1.5 truncate font-semibold leading-tight tracking-tight tabular-nums",
                STAT_VALUE_TYPE
              )}
              style={{ color: palette.ink }}
              title={value}
              data-testid="agent-visual-stat-value"
            >
              {value}
            </span>
            {hasDelta ? (
              <DeltaPill
                delta={delta}
                direction={deltaDirection(stat.delta, stat.deltaDir)}
                palette={palette}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart scaffolding
// ---------------------------------------------------------------------------

/** A text summary of the whole chart — the accessible name of the plot. */
function chartSummary(chart: VisualChart): string {
  const points = chart.series.map((p) => `${p.label}: ${p.value}`).join(", ");
  const prefix = chart.title ? `${chart.title}. ` : "";
  return `${prefix}${chart.type} chart. ${points}`;
}

/**
 * A quiet second line under the title. Plain English and true to the data —
 * never a made-up insight.
 */
function chartNote(chart: VisualChart): string {
  const points = chart.series;
  if (points.length === 0) return "No values to plot";
  if (chart.type === "pie") {
    const total = points.reduce((sum, p) => sum + Math.max(p.value, 0), 0);
    return `${total.toLocaleString()} in total across ${points.length} ${
      points.length === 1 ? "part" : "parts"
    }`;
  }
  const top = points.reduce((best, p) => (p.value > best.value ? p : best), points[0]);
  const count = `${points.length} ${points.length === 1 ? "value" : "values"}`;
  return `${count} · highest: ${top.label} (${top.value.toLocaleString()})`;
}

/**
 * Step sizes a person would actually write on a ruler. Finer than the classic
 * 1 / 2 / 5 set on purpose: with only those, a series topping out at 1,200
 * gets an axis to 2,000 and the tallest bar fills three fifths of the card —
 * which is a large part of what makes a chart look cheap. These fill the plot.
 */
const STEP_CANDIDATES = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

type AxisScale = { max: number; ticks: number[] };

/**
 * The axis a set of values gets: a round step, four intervals, and a top that
 * sits just above the biggest value instead of miles above it. Whole numbers
 * keep whole-number gridlines — "0, 0.8, 1.6" for a count of three is nobody's
 * idea of an axis.
 */
function axisScale(values: number[]): AxisScale {
  const intervals = GRID_LINES - 1;
  const max = Math.max(...values.map((value) => Math.max(value, 0)), 0);
  if (!Number.isFinite(max) || max <= 0) {
    return { max: intervals, ticks: Array.from({ length: GRID_LINES }, (_, i) => i) };
  }

  const raw = max / intervals;
  const base = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / base;
  const candidate = (STEP_CANDIDATES.find((c) => normalized <= c + 1e-9) ?? 10) * base;
  // Guard against floating-point dust turning 300 into 300.00000000000006.
  const step = values.every(Number.isInteger) && candidate < 1 ? 1 : candidate;

  return {
    max: step * intervals,
    ticks: Array.from({ length: GRID_LINES }, (_, i) => Number((step * i).toPrecision(12)))
  };
}

/** The horizontal rules behind a plot, plus a slightly firmer zero line. */
function Gridlines({ palette }: { palette: VisualPalette }) {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-testid="agent-visual-chart-svg"
    >
      <g data-testid="agent-visual-gridlines" style={{ color: palette.ink }}>
        {Array.from({ length: GRID_LINES }, (_, i) => {
          const y = (100 / (GRID_LINES - 1)) * i;
          const isBase = i === GRID_LINES - 1;
          return (
            <line
              key={i}
              x1={0}
              y1={y}
              x2={100}
              y2={y}
              stroke="currentColor"
              strokeOpacity={isBase ? 0.22 : 0.09}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>
    </svg>
  );
}

/** The value axis down the left of a plot, each label centred on its rule. */
function ValueAxis({ scale, palette }: { scale: AxisScale; palette: VisualPalette }) {
  return (
    <div className={cx("relative", AXIS_WIDTH)} aria-hidden="true">
      {scale.ticks.map((tick, index) => (
        <span
          key={index}
          className="absolute right-0 -translate-y-1/2 text-[10px] leading-none tabular-nums sm:text-[11px]"
          style={{ top: `${scale.max > 0 ? (1 - tick / scale.max) * 100 : 100}%`, color: palette.subtle }}
        >
          {compactNumber(tick)}
        </span>
      ))}
    </div>
  );
}

/** The category labels under a plot, sharing the axis gutter so they line up. */
function CategoryAxis({ points, palette }: { points: VisualChartPoint[]; palette: VisualPalette }) {
  return (
    <div className="mt-2.5 flex gap-2 sm:gap-3" aria-hidden="true">
      <div className={AXIS_WIDTH} />
      <div className="flex min-w-0 flex-1 gap-1.5 sm:gap-2">
        {points.map((point, index) => (
          <span
            key={index}
            title={point.label}
            className="min-w-0 flex-1 truncate text-center text-[10px] leading-4 sm:text-[11px]"
            style={{ color: palette.subtle }}
          >
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar chart
// ---------------------------------------------------------------------------

function BarChart({ chart, palette }: { chart: VisualChart; palette: VisualPalette }) {
  const points = chart.series;
  // Negative values are not plottable on a zero-based bar chart; they sit on
  // the floor rather than silently inverting the scale.
  const scale = axisScale(points.map((p) => p.value));
  // Above eight bars the labels start colliding, so they stand down entirely.
  const showValues = points.length <= 8;

  return (
    <>
      <div className={cx("flex items-stretch gap-2 sm:gap-3", PLOT_HEIGHT)}>
        <ValueAxis scale={scale} palette={palette} />
        <div
          className="relative min-w-0 flex-1"
          role="img"
          aria-label={chartSummary(chart)}
          data-testid="agent-visual-chart-plot"
        >
          <Gridlines palette={palette} />
          <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2">
            {points.map((point, index) => {
              const height = scale.max > 0 ? (Math.max(point.value, 0) / scale.max) * 100 : 0;
              // A bar that nearly fills the plot has no room above it, so its
              // label moves inside and flips to the ink that reads on accent.
              const inside = height > 86;
              return (
                <div
                  key={index}
                  className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                  title={`${point.label}: ${point.value.toLocaleString()}`}
                >
                  {showValues ? (
                    <span
                      className={cx(
                        "absolute inset-x-0 z-[1] text-center text-[10px] font-semibold leading-none tabular-nums sm:text-[11px]",
                        points.length > 5 && "max-sm:hidden"
                      )}
                      style={
                        inside
                          ? { bottom: `calc(${height}% - 16px)`, color: palette.onAccent }
                          : { bottom: `calc(${height}% + 5px)`, color: palette.muted }
                      }
                    >
                      {compactNumber(point.value)}
                    </span>
                  ) : null}
                  <div
                    className="agent-visual-bar w-[74%] min-w-[5px] max-w-[64px] rounded-t-[6px]"
                    style={{
                      height: `${Math.max(height, height > 0 ? 1.5 : 0)}%`,
                      background: `linear-gradient(180deg, ${palette.accent} 0%, ${palette.accentLight} 100%)`,
                      animationDelay: `${index * 55}ms`
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <CategoryAxis points={points} palette={palette} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Line chart
// ---------------------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A Catmull-Rom spline written out as cubic beziers — a smooth line with a
 * short tension so it never overshoots into a value the data does not contain.
 */
function smoothPath(coords: Array<{ x: number; y: number }>): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) return `M ${round(coords[0].x)} ${round(coords[0].y)}`;
  let path = `M ${round(coords[0].x)} ${round(coords[0].y)}`;
  const tension = 0.18;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i - 1] ?? coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = p1.y + (p2.y - p0.y) * tension;
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = p2.y - (p3.y - p1.y) * tension;
    path += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(p2.x)} ${round(p2.y)}`;
  }
  return path;
}

function LineChart({
  chart,
  palette,
  gradientId
}: {
  chart: VisualChart;
  palette: VisualPalette;
  gradientId: string;
}) {
  const points = chart.series;
  const scale = axisScale(points.map((p) => p.value));

  // Points sit at the centre of their slot, exactly like bars do, so the line
  // and the labels under it agree and the curve keeps a margin at both ends.
  const coords = points.map((point, index) => ({
    x: ((index + 0.5) / points.length) * 100,
    y: scale.max > 0 ? 100 - (Math.max(point.value, 0) / scale.max) * 100 : 100,
    point
  }));
  const line = smoothPath(coords);
  const area = `${line} L ${round(coords[coords.length - 1].x)} 100 L ${round(coords[0].x)} 100 Z`;

  return (
    <>
      <div className={cx("flex items-stretch gap-2 sm:gap-3", PLOT_HEIGHT)}>
        <ValueAxis scale={scale} palette={palette} />
        <div
          className="relative min-w-0 flex-1"
          role="img"
          aria-label={chartSummary(chart)}
          data-testid="agent-visual-chart-plot"
        >
          <Gridlines palette={palette} />
          <svg
            className="absolute inset-0 h-full w-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.accent} stopOpacity={0.34} />
                <stop offset="100%" stopColor={palette.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gradientId})`} className="agent-visual-enter" />
            <path
              d={line}
              fill="none"
              stroke={palette.accent}
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              pathLength={100}
              className="agent-visual-line"
            />
          </svg>
          {coords.map((coord, index) => (
            <span
              key={index}
              className="agent-visual-dot absolute block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
              style={{
                left: `${coord.x}%`,
                top: `${coord.y}%`,
                backgroundColor: palette.accent,
                borderColor: palette.card,
                animationDelay: `${420 + index * 45}ms`
              }}
              title={`${coord.point.label}: ${coord.point.value.toLocaleString()}`}
            />
          ))}
        </div>
      </div>
      <CategoryAxis points={points} palette={palette} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Pie (donut) chart
// ---------------------------------------------------------------------------

const DONUT_SIZE = 200;
const DONUT_STROKE = 30;
/** A hairline of empty space between slices, in pathLength units. */
const DONUT_GAP = 0.7;

function PieChart({ chart, palette }: { chart: VisualChart; palette: VisualPalette }) {
  const points = chart.series.filter((p) => p.value > 0);
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const radius = (DONUT_SIZE - DONUT_STROKE) / 2;
  const centre = DONUT_SIZE / 2;

  // Cumulative fraction before each slice, accumulated up front so the render
  // body reassigns nothing that escapes it.
  const offsets: number[] = [];
  for (let i = 0, accumulated = 0; i < points.length; i += 1) {
    offsets.push(accumulated);
    accumulated += total > 0 ? (points[i].value / total) * 100 : 0;
  }

  const slices = points.map((point, index) => ({
    point,
    percent: total > 0 ? (point.value / total) * 100 : 0,
    offset: offsets[index],
    color: palette.ramp[index % palette.ramp.length]
  }));

  return (
    // Centred, not stretched. On a wide page the card is ~1100px and a legend
    // allowed to fill it puts the label at one edge and its number at the
    // other, ~800px apart — two things you can no longer read as one row. The
    // donut and a capped legend sit together as a pair instead, and the donut
    // takes a step up so it is not a coin on a billboard.
    <div
      className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-8 lg:gap-12"
      data-testid="agent-visual-pie"
    >
      <div className="relative w-full max-w-[184px] flex-none sm:max-w-[208px] lg:max-w-[248px]">
        <svg
          viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
          className="h-auto w-full"
          role="img"
          aria-label={chartSummary(chart)}
          data-testid="agent-visual-chart-svg"
        >
          <g transform={`rotate(-90 ${centre} ${centre})`}>
            <circle
              cx={centre}
              cy={centre}
              r={radius}
              fill="none"
              strokeWidth={DONUT_STROKE}
              style={{ stroke: palette.borderSoft }}
            />
            {slices.map((slice, index) => (
              <circle
                key={index}
                className="agent-visual-slice"
                cx={centre}
                cy={centre}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={DONUT_STROKE}
                pathLength={100}
                strokeDasharray={`${Math.max(slice.percent - DONUT_GAP, 0.35)} ${
                  100 - Math.max(slice.percent - DONUT_GAP, 0.35)
                }`}
                strokeDashoffset={-slice.offset}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <title>{`${slice.point.label}: ${slice.point.value.toLocaleString()} (${Math.round(
                  slice.percent
                )}%)`}</title>
              </circle>
            ))}
          </g>
        </svg>
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          aria-hidden="true"
        >
          <span
            className="text-lg font-semibold leading-none tracking-tight tabular-nums sm:text-xl"
            style={{ color: palette.ink }}
          >
            {compactNumber(total)}
          </span>
          <span
            className="mt-1 text-[10px] font-semibold uppercase tracking-[0.09em]"
            style={{ color: palette.subtle }}
          >
            Total
          </span>
        </div>
      </div>
      <ul
        className="w-full min-w-0 space-y-2 text-sm sm:max-w-[26rem]"
        data-testid="agent-visual-pie-legend"
      >
        {slices.map((slice, index) => (
          <li key={index} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 flex-none rounded-full"
              style={{ backgroundColor: slice.color }}
            />
            <span className="min-w-0 flex-1 truncate" style={{ color: palette.muted }} title={slice.point.label}>
              {slice.point.label}
            </span>
            <span className="flex-none font-semibold tabular-nums" style={{ color: palette.ink }}>
              {slice.point.value.toLocaleString()}
            </span>
            <span
              className="w-10 flex-none text-right tabular-nums"
              style={{ color: palette.subtle }}
            >
              {Math.round(slice.percent)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart card
// ---------------------------------------------------------------------------

function ChartCard({
  chart,
  palette,
  gradientId
}: {
  chart: VisualChart;
  palette: VisualPalette;
  gradientId: string;
}) {
  // The contract validator drops a chart with no plottable points, but this
  // component is also called directly — a chart with nothing in it is nothing.
  if (chart.series.length === 0) return null;

  return (
    <figure
      className="agent-visual-enter w-full rounded-2xl border p-4 sm:p-6"
      style={cardStyle(palette)}
      data-testid="agent-visual-chart"
      data-chart-type={chart.type}
    >
      <figcaption className="mb-4 sm:mb-5">
        {chart.title ? (
          <span
            className="block text-base font-semibold tracking-tight sm:text-lg"
            style={{ color: palette.ink }}
            data-testid="agent-visual-chart-title"
          >
            {chart.title}
          </span>
        ) : null}
        <span
          className="mt-0.5 block text-xs leading-5 sm:text-sm"
          style={{ color: palette.subtle }}
          data-testid="agent-visual-chart-note"
        >
          {chartNote(chart)}
        </span>
      </figcaption>
      {chart.type === "pie" ? (
        <PieChart chart={chart} palette={palette} />
      ) : chart.type === "line" ? (
        <LineChart chart={chart} palette={palette} gradientId={gradientId} />
      ) : (
        <BarChart chart={chart} palette={palette} />
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

/** Room per column before the table would rather scroll than crush itself. */
const COLUMN_MIN_PX = 132;

function DataTable({
  table,
  palette,
  caption
}: {
  table: VisualTable;
  palette: VisualPalette;
  caption?: string;
}) {
  const numeric = table.columns.map((_, index) => isNumericColumn(table.rows, index));
  // Only wide tables are allowed to demand a scroll; a two-column table fits a
  // phone and never gets a scrollbar it did not need.
  const minWidth = table.columns.length > 2 ? Math.min(table.columns.length * COLUMN_MIN_PX, 860) : 0;
  const footer = caption ?? (table.rows.length > 4 ? `${table.rows.length} rows` : null);

  return (
    <figure
      className="agent-visual-enter w-full overflow-hidden rounded-2xl border"
      style={cardStyle(palette)}
      data-testid="agent-visual-table"
    >
      <div className="w-full overflow-x-auto">
        <table
          className="w-full border-collapse text-sm"
          style={{ minWidth: minWidth || undefined, "--visual-row-hover": palette.rowHover } as CSSProperties}
        >
          <thead>
            <tr style={{ background: palette.headerBg }}>
              {table.columns.map((column, index) => (
                <th
                  key={index}
                  scope="col"
                  data-numeric={numeric[index] ? "true" : "false"}
                  className={cx(
                    "whitespace-nowrap px-4 py-3 text-[0.6875rem] font-semibold uppercase leading-4 tracking-[0.09em] sm:px-5",
                    numeric[index] ? "text-right tabular-nums" : "text-left"
                  )}
                  style={{ color: palette.subtle, borderBottom: `1px solid ${palette.border}` }}
                >
                  {displayValue(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="agent-visual-row"
                style={rowIndex > 0 ? { borderTop: `1px solid ${palette.borderSoft}` } : undefined}
              >
                {row.map((cell, cellIndex) => {
                  const value = displayValue(cell);
                  const isNumber = numeric[cellIndex];
                  // Only the truncating first column earns a tooltip — a title
                  // on every cell turns the whole table into a hover minefield.
                  const truncates = cellIndex === 0 && !isNumber;
                  return (
                    <td
                      key={cellIndex}
                      data-numeric={isNumber ? "true" : "false"}
                      title={truncates ? value : undefined}
                      className={cx(
                        "px-4 py-3 align-middle sm:px-5 sm:py-3.5",
                        isNumber ? "whitespace-nowrap text-right tabular-nums" : "text-left",
                        truncates && "max-w-[15rem] truncate font-medium"
                      )}
                      style={{ color: truncates ? palette.ink : palette.muted }}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer ? (
        <figcaption
          className="px-4 py-2.5 text-xs sm:px-5"
          style={{ color: palette.subtle, borderTop: `1px solid ${palette.borderSoft}` }}
          data-testid="agent-visual-table-caption"
        >
          {footer}
        </figcaption>
      ) : null}
    </figure>
  );
}

// ---------------------------------------------------------------------------

export function VisualResults({
  payload,
  accent,
  surface = "base",
  tableCaption
}: {
  payload: VisualResultsPayload;
  /** Page accent — every colour on screen is derived from this one hex. */
  accent: string;
  /** "dark" only inside a dark band of a generated product page. */
  surface?: VisualSurface;
  /** Optional line under the table. Falls back to an honest row count. */
  tableCaption?: string;
}) {
  const hasContent = Boolean(payload.stats || payload.chart || payload.table);
  if (!hasContent) return null;

  const palette = visualPalette(accent, surface);
  // Stable per payload, so two charts on one page cannot share a gradient.
  const gradientId = `agent-visual-area-${(payload.chart?.title ?? "").length}-${
    payload.chart?.series.length ?? 0
  }-${payload.chart?.type ?? "none"}`;

  return (
    <div className="mt-4 w-full space-y-3 sm:space-y-4" data-testid="agent-block-visual-results">
      {payload.stats ? <StatCards stats={payload.stats} palette={palette} /> : null}
      {payload.chart ? (
        <ChartCard chart={payload.chart} palette={palette} gradientId={gradientId} />
      ) : null}
      {payload.table ? (
        <DataTable table={payload.table} palette={palette} caption={tableCaption} />
      ) : null}
    </div>
  );
}
