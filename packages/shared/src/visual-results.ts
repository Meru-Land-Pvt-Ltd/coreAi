/**
 * Visual Results contract — the one shape an AI Brain can emit so the Result
 * Viewer renders stat cards, a chart, or a table instead of plain text. It is
 * defined ONCE here and imported by both sides of the wire so they can never
 * drift: the backend extractor (run-output.ts) validates the Brain's JSON with
 * `parseVisualResults`, and the frontend Result Viewer renders the exact same
 * validated payload.
 *
 * The JSON an architect tells their Brain to emit (every part optional):
 *   {
 *     "text":  "optional prose shown above the visuals",
 *     "stats": [{ "label": "Subscribers", "value": "312M", "delta": "+1.2M", "deltaDir": "up" }],
 *     "chart": { "type": "bar", "title": "Views by video", "series": [{ "label": "A", "value": 1200 }] },
 *     "table": { "columns": ["Video", "Views"], "rows": [["A", "1,200"]] }
 *   }
 *
 * Everything here is DEFENSIVE: the payload originates from a language model,
 * so every field is validated, coerced, and capped. A payload that carries no
 * valid stats/chart/table yields `null` — the caller then falls back to the
 * plain-text path, so non-visual replies (and ordinary JSON) render as before.
 */

export const VISUAL_CHART_TYPES = ["bar", "line", "pie"] as const;
export type VisualChartType = (typeof VISUAL_CHART_TYPES)[number];

/** One stat card: a big value with a label and an optional up/down delta. */
export type VisualStat = {
  label: string;
  value: string;
  delta?: string;
  deltaDir?: "up" | "down";
};

/** One point on a chart — a label and a finite numeric value. */
export type VisualChartPoint = {
  label: string;
  value: number;
};

export type VisualChart = {
  type: VisualChartType;
  title?: string;
  series: VisualChartPoint[];
};

export type VisualTable = {
  columns: string[];
  rows: string[][];
};

/** The full validated payload — every section optional, all bounds enforced. */
export type VisualResultsPayload = {
  text?: string;
  stats?: VisualStat[];
  chart?: VisualChart;
  table?: VisualTable;
};

// Bounds — a model can hallucinate an enormous payload; these keep the Result
// Viewer fast and the page from ever being flooded.
const MAX_STATS = 12;
const MAX_CHART_POINTS = 24;
const MAX_TABLE_COLUMNS = 12;
const MAX_TABLE_ROWS = 100;
const MAX_LABEL_LEN = 120;
const MAX_VALUE_LEN = 60;
const MAX_CELL_LEN = 200;
const MAX_TITLE_LEN = 160;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number, or a string that trims to non-empty. */
function scalarToString(value: unknown, max: number): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, max);
  }
  return null;
}

/** Parse a value that should be a finite number — accepts numeric strings. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/,/g, "");
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseStats(raw: unknown): VisualStat[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const stats: VisualStat[] = [];
  for (const entry of raw) {
    if (stats.length >= MAX_STATS) break;
    if (!isPlainObject(entry)) continue;
    const label = scalarToString(entry.label, MAX_LABEL_LEN);
    const value = scalarToString(entry.value, MAX_VALUE_LEN);
    // A stat card is meaningless without both a label and a value.
    if (label === null || value === null) continue;
    const stat: VisualStat = { label, value };
    const delta = scalarToString(entry.delta, MAX_VALUE_LEN);
    if (delta !== null) stat.delta = delta;
    if (entry.deltaDir === "up" || entry.deltaDir === "down") {
      stat.deltaDir = entry.deltaDir;
    }
    stats.push(stat);
  }
  return stats.length > 0 ? stats : undefined;
}

function parseChart(raw: unknown): VisualChart | undefined {
  if (!isPlainObject(raw)) return undefined;
  const type = raw.type;
  if (type !== "bar" && type !== "line" && type !== "pie") return undefined;
  if (!Array.isArray(raw.series)) return undefined;

  const series: VisualChartPoint[] = [];
  for (const point of raw.series) {
    if (series.length >= MAX_CHART_POINTS) break;
    if (!isPlainObject(point)) continue;
    const label = scalarToString(point.label, MAX_LABEL_LEN);
    const value = toFiniteNumber(point.value);
    if (label === null || value === null) continue;
    series.push({ label, value });
  }
  // A chart with no plottable points is not a chart.
  if (series.length === 0) return undefined;

  const chart: VisualChart = { type, series };
  const title = scalarToString(raw.title, MAX_TITLE_LEN);
  if (title !== null) chart.title = title;
  return chart;
}

function parseTable(raw: unknown): VisualTable | undefined {
  if (!isPlainObject(raw)) return undefined;
  if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return undefined;

  const columns: string[] = [];
  for (const col of raw.columns) {
    if (columns.length >= MAX_TABLE_COLUMNS) break;
    const label = scalarToString(col, MAX_LABEL_LEN);
    columns.push(label ?? "");
  }
  if (columns.length === 0) return undefined;

  const rows: string[][] = [];
  for (const rawRow of raw.rows) {
    if (rows.length >= MAX_TABLE_ROWS) break;
    if (!Array.isArray(rawRow)) continue;
    const row: string[] = [];
    for (let i = 0; i < columns.length; i += 1) {
      // Normalize every row to the column count so the grid never tears.
      row.push(scalarToString(rawRow[i], MAX_CELL_LEN) ?? "");
    }
    rows.push(row);
  }
  if (rows.length === 0) return undefined;

  return { columns, rows };
}

/**
 * Pull the first balanced JSON object out of a string that may be wrapped in a
 * ```json code fence or surrounded by stray prose. Returns the candidate JSON
 * text, or the original string when nothing better is found.
 */
function unwrapJsonCandidate(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1].trim().length > 0) return fenced[1].trim();
  return trimmed;
}

/**
 * Validate an AI Brain reply into a Visual Results payload, or `null` when it
 * carries no renderable stats/chart/table. Accepts either an already-parsed
 * value or the raw JSON string the Brain emitted (JSON string is the common
 * case — `outputFormat: json` hands back a string).
 *
 * Returns non-null ONLY when at least one structured section survived
 * validation, so a text-only reply (or any non-visual JSON) falls through to
 * the plain-text path and nothing double-renders.
 */
export function parseVisualResults(input: unknown): VisualResultsPayload | null {
  let value: unknown = input;

  if (typeof value === "string") {
    const candidate = unwrapJsonCandidate(value);
    // Cheap guard: only attempt a parse when the text looks like a JSON object.
    if (!/^\s*\{/.test(candidate)) return null;
    try {
      value = JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  if (!isPlainObject(value)) return null;

  const stats = parseStats(value.stats);
  const chart = parseChart(value.chart);
  const table = parseTable(value.table);

  // No structured content → let the caller render plain text instead.
  if (!stats && !chart && !table) return null;

  const payload: VisualResultsPayload = {};
  const text = scalarToString(value.text, 4000);
  if (text !== null) payload.text = text;
  if (stats) payload.stats = stats;
  if (chart) payload.chart = chart;
  if (table) payload.table = table;
  return payload;
}
