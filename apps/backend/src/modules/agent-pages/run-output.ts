/**
 * One-shot run output extraction shared by the public agent-page /run endpoint
 * and the architect builder's preview-run endpoint. Both surfaces must render
 * the exact same { text, mediaUrls, structured } for the same engine result —
 * keep every extraction rule here so they can never drift.
 */

import { parseVisualResults, type VisualResultsPayload } from "@coreai/shared";
import { sanitizeCustomerText } from "./output-hygiene";

/** Structural view of a runWorkflowTest result — only what extraction reads. */
export type RunEngineResult = { context?: unknown; logs?: unknown[] };

/**
 * Explicit media keys only — a generic "url" field (booking links, webhook
 * echoes) must never surface as visitor-facing media.
 */
const MEDIA_URL_KEYS = new Set(["imageUrl", "videoUrl", "mediaUrl"]);
const MAX_MEDIA_URLS = 8;

/** http(s) URLs plus data: image/video URIs (the image node emits data URIs). */
function isRenderableMediaUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^https?:\/\//i.test(value) || /^data:(image|video)\//i.test(value))
  );
}

function collectMediaUrls(output: unknown, found: Set<string>, depth = 0): void {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return;

  for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
    if (MEDIA_URL_KEYS.has(key) && isRenderableMediaUrl(value)) {
      found.add(value);
    } else if (depth < 1 && typeof value === "object" && value !== null && !Array.isArray(value)) {
      collectMediaUrls(value, found, depth + 1);
    }
  }
}

/**
 * Media from a one-shot run. The image-generation node never logs its URL —
 * the log line carries "[Binary Image Data]" — so the real result is read
 * from context.image_url and context.imagePipeline[nodeId].imageUrl (usually
 * data: URIs). Log outputs are still scanned for explicit media keys emitted
 * by other node types.
 */
export function extractRunMediaUrls(result: RunEngineResult): string[] {
  const found = new Set<string>();
  const context = (result.context ?? {}) as Record<string, unknown>;

  if (isRenderableMediaUrl(context.image_url)) found.add(context.image_url);

  const pipeline = context.imagePipeline;
  if (pipeline && typeof pipeline === "object" && !Array.isArray(pipeline)) {
    for (const entry of Object.values(pipeline as Record<string, unknown>)) {
      const imageUrl = (entry as { imageUrl?: unknown } | null)?.imageUrl;
      if (isRenderableMediaUrl(imageUrl)) found.add(imageUrl);
    }
  }

  for (const log of result.logs ?? []) {
    collectMediaUrls((log as { output?: unknown }).output, found);
  }

  return [...found].slice(0, MAX_MEDIA_URLS);
}

/**
 * The final AI reply text of a one-shot run, or null when the run produced
 * none. This is the LAST exit before the text reaches a visitor (public
 * agent-page /run and the builder's preview-run both extract here), so leaked
 * template artifacts are stripped exactly once at this point.
 */
export function extractRunText(result: RunEngineResult): string | null {
  const aiOutput = readAiOutputString(result);
  return aiOutput !== null ? sanitizeCustomerText(aiOutput) : null;
}

/** The raw AI reply string from context, or null when the run produced none. */
function readAiOutputString(result: RunEngineResult): string | null {
  const aiOutput = (result.context as { ai?: { output?: unknown } } | undefined)?.ai?.output;
  return typeof aiOutput === "string" ? aiOutput : null;
}

/**
 * A Visual Results payload when the AI Brain's reply is JSON matching the
 * visual contract (stat cards / chart / table), or null. Every string inside
 * is passed through the same customer-text hygiene as plain text, so leaked
 * template artifacts can't ride in through a stat label or a table cell.
 */
export function extractRunStructured(result: RunEngineResult): VisualResultsPayload | null {
  const raw = readAiOutputString(result);
  if (raw === null) return null;
  const parsed = parseVisualResults(raw);
  return parsed ? sanitizeStructured(parsed) : null;
}

/** Run every visitor-facing string in a payload through the text hygiene pass. */
function sanitizeStructured(payload: VisualResultsPayload): VisualResultsPayload {
  const clean: VisualResultsPayload = {};
  if (payload.text !== undefined) {
    const text = sanitizeCustomerText(payload.text).trim();
    if (text.length > 0) clean.text = text;
  }
  if (payload.stats) {
    clean.stats = payload.stats.map((stat) => ({
      label: sanitizeCustomerText(stat.label),
      value: sanitizeCustomerText(stat.value),
      ...(stat.delta !== undefined ? { delta: sanitizeCustomerText(stat.delta) } : {}),
      ...(stat.deltaDir !== undefined ? { deltaDir: stat.deltaDir } : {})
    }));
  }
  if (payload.chart) {
    clean.chart = {
      type: payload.chart.type,
      ...(payload.chart.title !== undefined
        ? { title: sanitizeCustomerText(payload.chart.title) }
        : {}),
      // Numeric values never carry text artifacts — only labels are hygiened.
      series: payload.chart.series.map((point) => ({
        label: sanitizeCustomerText(point.label),
        value: point.value
      }))
    };
  }
  if (payload.table) {
    clean.table = {
      columns: payload.table.columns.map((col) => sanitizeCustomerText(col)),
      rows: payload.table.rows.map((row) => row.map((cell) => sanitizeCustomerText(cell)))
    };
  }
  return clean;
}

/**
 * The full visitor-facing payload of a one-shot run. When the AI reply is a
 * Visual Results JSON payload, `structured` carries the validated stats/chart/
 * table and `text` is only the payload's own prose (never the raw JSON). For
 * every other reply `structured` is null and `text` is the plain reply, exactly
 * as before — full backward compatibility.
 */
export function extractRunOutput(result: RunEngineResult): {
  text: string | null;
  mediaUrls: string[];
  structured: VisualResultsPayload | null;
} {
  const structured = extractRunStructured(result);
  return {
    // A visual payload's raw JSON must never leak as text — show only its prose.
    text: structured ? structured.text ?? null : extractRunText(result),
    mediaUrls: extractRunMediaUrls(result),
    structured
  };
}
