import type {
  VisualChart,
  VisualResultsPayload,
  VisualStat,
  VisualTable
} from "@coreai/shared";

/**
 * Visual Results renderer — the Result Viewer's rich mode. When an AI Brain
 * replies with the visual JSON contract (see packages/shared/visual-results.ts)
 * the run's `structured` payload lands here and renders as stat cards, a chart,
 * and/or a table. Everything is self-contained inline SVG — no chart library —
 * built on the page accent (Triven amber by default), responsive, and
 * accessible (each chart is one labelled image with a text summary).
 *
 * The payload is already validated and hygiened on the backend; this component
 * only lays it out.
 */

const CHART_VIEW_W = 640;
const CHART_VIEW_H = 260;

/** Compact human number for axis/value labels: 1_200_000 → "1.2M". */
function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trimZero(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimZero(value / 1_000)}K`;
  return trimZero(value);
}

function trimZero(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/**
 * A fixed amber-family ramp for multi-slice pie charts, so slices stay on
 * brand and distinguishable. Bar and line charts use the page accent directly.
 */
const AMBER_RAMP = [
  "#f59e0b",
  "#d97706",
  "#fbbf24",
  "#b45309",
  "#f97316",
  "#92400e",
  "#fcd34d",
  "#ea580c"
];

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------

function StatCards({ stats }: { stats: VisualStat[] }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      data-testid="agent-visual-stats"
    >
      {stats.map((stat, index) => {
        const dir = stat.deltaDir;
        const deltaColor =
          dir === "up" ? "text-emerald-600" : dir === "down" ? "text-rose-600" : "text-slate-500";
        const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : null;
        return (
          <div
            key={index}
            className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
            data-testid="agent-visual-stat"
          >
            <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">
              {stat.label}
            </p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{stat.value}</p>
            {stat.delta ? (
              <p className={`mt-1 flex items-center gap-1 text-xs font-semibold ${deltaColor}`}>
                {arrow ? <span aria-hidden="true">{arrow}</span> : null}
                <span>
                  {arrow ? <span className="sr-only">{dir === "up" ? "Up " : "Down "}</span> : null}
                  {stat.delta}
                </span>
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts (bar / line / pie) — inline SVG, no external library
// ---------------------------------------------------------------------------

function chartSummary(chart: VisualChart): string {
  const points = chart.series.map((p) => `${p.label}: ${p.value}`).join(", ");
  const prefix = chart.title ? `${chart.title}. ` : "";
  return `${prefix}${chart.type} chart. ${points}`;
}

function BarChart({ chart, accent }: { chart: VisualChart; accent: string }) {
  const points = chart.series;
  const maxValue = Math.max(...points.map((p) => Math.max(p.value, 0)), 1);
  const padX = 8;
  const padTop = 24;
  const padBottom = 44;
  const usableW = CHART_VIEW_W - padX * 2;
  const usableH = CHART_VIEW_H - padTop - padBottom;
  const slot = usableW / points.length;
  const barW = Math.min(slot * 0.6, 72);
  const baseY = CHART_VIEW_H - padBottom;

  return (
    <svg
      viewBox={`0 0 ${CHART_VIEW_W} ${CHART_VIEW_H}`}
      className="h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={chartSummary(chart)}
    >
      <line x1={padX} y1={baseY} x2={CHART_VIEW_W - padX} y2={baseY} stroke="#e2e8f0" strokeWidth={1} />
      {points.map((point, index) => {
        const h = maxValue > 0 ? Math.max((Math.max(point.value, 0) / maxValue) * usableH, 1) : 1;
        const cx = padX + slot * index + slot / 2;
        const x = cx - barW / 2;
        const y = baseY - h;
        return (
          <g key={index}>
            <title>{`${point.label}: ${point.value.toLocaleString()}`}</title>
            <rect x={x} y={y} width={barW} height={h} rx={4} fill={accent} />
            <text
              x={cx}
              y={y - 6}
              textAnchor="middle"
              fontSize={13}
              fontWeight={600}
              fill="#334155"
            >
              {compactNumber(point.value)}
            </text>
            <text x={cx} y={baseY + 18} textAnchor="middle" fontSize={12} fill="#64748b">
              {truncateLabel(point.label)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ chart, accent }: { chart: VisualChart; accent: string }) {
  const points = chart.series;
  const values = points.map((p) => p.value);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const range = maxValue - minValue || 1;
  const padX = 24;
  const padTop = 24;
  const padBottom = 44;
  const usableW = CHART_VIEW_W - padX * 2;
  const usableH = CHART_VIEW_H - padTop - padBottom;
  const baseY = CHART_VIEW_H - padBottom;
  const stepX = points.length > 1 ? usableW / (points.length - 1) : 0;

  const coords = points.map((point, index) => {
    const x = points.length > 1 ? padX + stepX * index : CHART_VIEW_W / 2;
    const y = baseY - ((point.value - minValue) / range) * usableH;
    return { x, y, point };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${CHART_VIEW_W} ${CHART_VIEW_H}`}
      className="h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={chartSummary(chart)}
    >
      <line x1={padX} y1={baseY} x2={CHART_VIEW_W - padX} y2={baseY} stroke="#e2e8f0" strokeWidth={1} />
      <path d={path} fill="none" stroke={accent} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((c, index) => (
        <g key={index}>
          <title>{`${c.point.label}: ${c.point.value.toLocaleString()}`}</title>
          <circle cx={c.x} cy={c.y} r={4} fill={accent} stroke="#ffffff" strokeWidth={1.5} />
          <text x={c.x} y={baseY + 18} textAnchor="middle" fontSize={12} fill="#64748b">
            {truncateLabel(c.point.label)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function PieChart({ chart }: { chart: VisualChart }) {
  const points = chart.series.filter((p) => p.value > 0);
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const cx = 130;
  const cy = CHART_VIEW_H / 2;
  const r = 96;

  // Cumulative fraction before each slice, built with a loop-local accumulator
  // so the render body reassigns nothing that escapes (keeps the compiler happy).
  const START_ANGLE = -Math.PI / 2; // 12 o'clock
  const offsets: number[] = [];
  for (let i = 0, acc = 0; i < points.length; i += 1) {
    offsets.push(acc);
    acc += total > 0 ? points[i].value / total : 0;
  }

  const slices = points.map((point, index) => {
    const fraction = total > 0 ? point.value / total : 0;
    const start = START_ANGLE + offsets[index] * Math.PI * 2;
    const end = start + fraction * Math.PI * 2;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    // A single full-circle slice can't be drawn as an arc — use a full circle.
    const d =
      points.length === 1
        ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return { d, point, fraction, color: AMBER_RAMP[index % AMBER_RAMP.length] };
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row" data-testid="agent-visual-pie">
      <svg
        viewBox={`0 0 260 ${CHART_VIEW_H}`}
        className="h-auto w-full max-w-[260px]"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={chartSummary(chart)}
      >
        {slices.map((slice, index) => (
          <path key={index} d={slice.d} fill={slice.color} stroke="#ffffff" strokeWidth={2}>
            <title>{`${slice.point.label}: ${slice.point.value.toLocaleString()} (${Math.round(
              slice.fraction * 100
            )}%)`}</title>
          </path>
        ))}
      </svg>
      <ul className="w-full space-y-1.5 text-sm" data-testid="agent-visual-pie-legend">
        {slices.map((slice, index) => (
          <li key={index} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-3 flex-none rounded-sm"
              style={{ backgroundColor: slice.color }}
            />
            <span className="flex-1 truncate text-slate-600">{slice.point.label}</span>
            <span className="font-semibold text-slate-900">{slice.point.value.toLocaleString()}</span>
            <span className="w-10 text-right text-slate-400">{Math.round(slice.fraction * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function truncateLabel(label: string): string {
  return label.length > 12 ? `${label.slice(0, 11)}…` : label;
}

function ChartCard({ chart, accent }: { chart: VisualChart; accent: string }) {
  return (
    <figure
      className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
      data-testid="agent-visual-chart"
      data-chart-type={chart.type}
    >
      {chart.title ? (
        <figcaption className="mb-3 text-sm font-semibold text-slate-700">{chart.title}</figcaption>
      ) : null}
      {chart.type === "pie" ? (
        <PieChart chart={chart} />
      ) : chart.type === "line" ? (
        <LineChart chart={chart} accent={accent} />
      ) : (
        <BarChart chart={chart} accent={accent} />
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function DataTable({ table }: { table: VisualTable }) {
  return (
    <div
      className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm"
      data-testid="agent-visual-table"
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-slate-50/70">
            {table.columns.map((col, index) => (
              <th
                key={index}
                scope="col"
                className="px-4 py-2.5 text-left font-semibold text-slate-700"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-gray-50 last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-2.5 text-slate-600">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function VisualResults({
  payload,
  accent
}: {
  payload: VisualResultsPayload;
  accent: string;
}) {
  const hasContent = Boolean(payload.stats || payload.chart || payload.table);
  if (!hasContent) return null;

  return (
    <div className="mt-3 space-y-3" data-testid="agent-block-visual-results">
      {payload.stats ? <StatCards stats={payload.stats} /> : null}
      {payload.chart ? <ChartCard chart={payload.chart} accent={accent} /> : null}
      {payload.table ? <DataTable table={payload.table} /> : null}
    </div>
  );
}
