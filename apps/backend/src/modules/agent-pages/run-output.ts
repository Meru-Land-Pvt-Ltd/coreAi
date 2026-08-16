/**
 * One-shot run output extraction shared by the public agent-page /run endpoint
 * and the architect builder's preview-run endpoint. Both surfaces must render
 * the exact same { text, mediaUrls, structured } for the same engine result —
 * keep every extraction rule here so they can never drift.
 *
 * THE FACE-OUT DOOR lives here too. `extractRunOutput` is the old synchronous
 * rule: it renders visuals only when the agent's own Brain happened to reply in
 * the Visual Results contract. `resolveRunOutput` wraps it with the
 * presentation door, so an agent whose last step is a plain API call — no exit
 * Brain, no prompt engineering, nothing the architect had to know — still shows
 * cards, a chart or a table instead of a wall of raw text.
 *
 * The door is an enhancement, never a dependency: it is skipped whenever the
 * output is already visual, it can never throw, and every failure path lands
 * back on exactly the text this module produced before it existed.
 */

import { parseVisualResults, type VisualResultsPayload } from "@coreai/shared";
import {
  createDoorBudget,
  runPresentationDoor,
  type DoorBudget
} from "../agent-runtime/node-doors";
import { sanitizeCustomerText } from "./output-hygiene";

/**
 * Structural view of a runWorkflowTest result — only what extraction reads.
 *
 * `doorBudget` is the run's shared door allowance when the engine ran doors
 * inside its nodes. The presentation door spends from that same allowance, so
 * one run can never pay for more door calls than DOOR_BRAIN_MAX_PER_RUN.
 */
export type RunEngineResult = { context?: unknown; logs?: unknown[]; doorBudget?: unknown };

/** The visitor-facing payload both one-shot surfaces return. */
export type RunOutput = {
  text: string | null;
  mediaUrls: string[];
  structured: VisualResultsPayload | null;
};

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
export function extractRunOutput(result: RunEngineResult): RunOutput {
  const structured = extractRunStructured(result);
  return {
    // A visual payload's raw JSON must never leak as text — show only its prose.
    text: structured ? structured.text ?? null : extractRunText(result),
    mediaUrls: extractRunMediaUrls(result),
    structured
  };
}

// ---------------------------------------------------------------------------
// THE FACE-OUT DOOR — the presentation door on the way to the Result Viewer.
// ---------------------------------------------------------------------------

/** What the presentation door is told about the run. Deliberately small. */
export type ResolveRunOutputOptions = {
  /** What the customer actually asked for, in their own words. */
  userMessage?: string;
  /** The agent's public name, for grounding labels and tone. */
  businessName?: string;
  /**
   * The run's shared door allowance. Falls back to `result.doorBudget`, then to
   * a fresh per-run allowance for runs whose engine ran no doors at all.
   */
  budget?: DoorBudget;
  /**
   * False when the architect switched "Smart input & output" off on this
   * agent's Result Viewer. The presentation door runs out here rather than
   * inside a node, so the flag has to be carried in from the graph — see
   * `presentationDoorEnabled`. Omitted means on, like every other door.
   */
  doorsEnabled?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A DoorBudget carried across a module boundary — checked, never assumed. */
function isDoorBudget(value: unknown): value is DoorBudget {
  return (
    isPlainObject(value) &&
    typeof (value as { take?: unknown }).take === "function" &&
    typeof (value as { remaining?: unknown }).remaining === "number"
  );
}

/** Is there anything here at all worth turning into a visual? */
function isPresentableValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return typeof value === "number" || typeof value === "boolean";
}

/**
 * Strip media out of the value handed to the door. An image node's output
 * carries a data: URI that can be megabytes long — it is already surfaced
 * through `mediaUrls`, and putting it in a prompt would cost a fortune and
 * teach the door nothing.
 */
function stripMediaForDoor(value: unknown, depth = 0): unknown {
  // Strings are checked at EVERY depth — a data: URI nested six levels down is
  // just as expensive as one at the top.
  if (typeof value === "string") {
    return /^data:/i.test(value.trim()) ? "[media]" : value;
  }
  // Depth cap only bounds the walk itself; the door prompt is clipped anyway.
  if (depth >= 6) return value;
  if (Array.isArray(value)) return value.map((item) => stripMediaForDoor(item, depth + 1));
  if (!isPlainObject(value)) return value;

  const pruned: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (MEDIA_URL_KEYS.has(key)) continue;
    pruned[key] = stripMediaForDoor(inner, depth + 1);
  }
  return pruned;
}

/**
 * Read a (possibly dotted) output key out of the run context, structured value
 * first and the string mirror second — the same precedence the runner uses when
 * it writes the pair.
 */
function readContextOutputKey(context: unknown, key: string): unknown {
  if (!isPlainObject(context) || !key) return undefined;

  let cursor: unknown = context;
  for (const segment of key.split(".").filter(Boolean)) {
    if (!isPlainObject(cursor)) return context[key];
    cursor = cursor[segment];
  }
  return cursor === undefined ? context[key] : cursor;
}

/**
 * What a step really produced, out of the runner's log envelope.
 *
 * A step logs a receipt, not a result: an API call's entry is
 * `{ status, ok, outputKey, bytes, data }`, where `data` is the reply as it
 * arrived and `outputKey` names where the step actually parked it. Two reasons
 * never to hand that envelope to the presentation door as-is:
 *
 *   • `status`, `ok`, `bytes` and `outputKey` are engine bookkeeping. A door
 *     asked to build stat cards out of them will happily render "Bytes 318" to
 *     a customer;
 *   • `data` is the RAW reply. The exit door has since cleaned that step's
 *     output in the run context, so the envelope is the one copy that never got
 *     the cleaning.
 *
 * So when the envelope says where the value lives, read the value.
 */
function unwrapLogOutput(output: unknown, context: unknown): unknown {
  if (!isPlainObject(output)) return output;

  const outputKey = typeof output.outputKey === "string" ? output.outputKey : "";
  if (outputKey) {
    const stored = readContextOutputKey(context, outputKey);
    if (isPresentableValue(stored)) return stored;
  }

  // No key to follow — the reply itself still beats the bookkeeping around it.
  if ("data" in output && isPresentableValue(output.data)) return output.data;
  return output;
}

/** The last success log that actually produced something, newest first. */
function readLastLogOutput(result: RunEngineResult): unknown {
  const logs = result.logs ?? [];
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const log = logs[i] as { status?: unknown; output?: unknown } | null;
    if (!isPlainObject(log)) continue;
    if (log.status === "error") continue;
    if (isPresentableValue(log.output)) return unwrapLogOutput(log.output, result.context);
  }
  return null;
}

/**
 * What this run actually produced, whatever shape it arrived in.
 *
 * The AI reply wins when there is one. Without it — an agent whose last step is
 * an API call, a calendar lookup, a send — the newest step output stands in, so
 * a Brain-less agent still has something to present.
 */
export function extractRunFinalOutput(result: RunEngineResult): unknown {
  const aiOutput = (result.context as { ai?: { output?: unknown } } | undefined)?.ai?.output;
  if (isPresentableValue(aiOutput)) return aiOutput;
  return readLastLogOutput(result);
}

/**
 * True when the only thing this run "produced" is the customer's own words
 * handed back — a graph where nothing but the trigger ran. There is nothing to
 * present, so the run must not pay for a door call to present it.
 */
function isEchoOfUserMessage(value: unknown, userMessage: string | undefined): boolean {
  const asked = userMessage?.trim();
  if (!asked) return false;
  if (typeof value === "string") return value.trim() === asked;
  if (!isPlainObject(value)) return false;

  const present = Object.values(value).filter(isPresentableValue);
  return (
    present.length > 0 &&
    present.every((inner) => typeof inner === "string" && inner.trim() === asked)
  );
}

/**
 * True when this text is a machine payload rather than something written for a
 * person. Once the door has turned such a payload into cards or a table, the
 * payload itself must not also be dumped on the customer as "text".
 */
function looksLikeRawData(text: string | null): boolean {
  if (text === null) return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * The visitor-facing payload of a one-shot run, with the Face-out door applied.
 *
 * Order of preference, cheapest first:
 *   1. the agent's own reply already IS a visual payload → pass it through
 *      untouched, no door call (never do the work twice);
 *   2. the run's final output parses as a visual payload → use it directly,
 *      still no door call;
 *   3. otherwise the presentation door turns the output into stats/chart/table;
 *   4. anything else — door skipped, out of budget, timed out, failed, or gave
 *      back nothing renderable — falls back to the exact plain-text result
 *      `extractRunOutput` returns today.
 *
 * Never throws.
 */
export async function resolveRunOutput(
  result: RunEngineResult,
  options: ResolveRunOutputOptions = {}
): Promise<RunOutput> {
  const base = extractRunOutput(result);

  try {
    // 1. The Brain already spoke the visual contract — leave it completely alone.
    if (base.structured) return base;

    // The architect switched this agent's Face-out door off. Plain text, no
    // door call, exactly as before the door existed.
    if (options.doorsEnabled === false) return base;

    const finalOutput = extractRunFinalOutput(result);
    if (!isPresentableValue(finalOutput)) return base;
    if (isEchoOfUserMessage(finalOutput, options.userMessage)) return base;

    const forDoor = stripMediaForDoor(finalOutput);

    // 2. Already-visual data that simply did not arrive through context.ai.output.
    const alreadyVisual = parseVisualResults(forDoor);
    if (alreadyVisual) return withStructured(base, alreadyVisual);

    // 3. The door. It spends the run's shared allowance and can never throw.
    const budget = options.budget ?? (isDoorBudget(result.doorBudget) ? result.doorBudget : createDoorBudget());
    const { visual } = await runPresentationDoor({
      budget,
      lastOutput: forDoor,
      // Only the customer's own words and the agent's name. The runner context
      // is NOT passed: it holds business config, connection ids and other
      // things a prompt must never carry.
      context: {
        ...(options.userMessage ? { userMessage: options.userMessage } : {}),
        ...(options.businessName ? { businessName: options.businessName } : {})
      }
    });

    // 4. No change — plain text, exactly as before the door existed.
    if (!visual) return base;
    return withStructured(base, visual);
  } catch {
    return base;
  }
}

/**
 * Fold a door-built payload into the run output. Everything visitor-facing goes
 * through the same text hygiene as plain text, because a door payload is model
 * output and can carry a leaked {{token}} in a stat label just as easily.
 */
function withStructured(base: RunOutput, payload: VisualResultsPayload): RunOutput {
  const structured = sanitizeStructured(payload);
  return {
    // The door's own line wins. Otherwise the run's prose stays — never lose
    // real writing — unless that "prose" was the raw payload the cards replaced.
    text: structured.text ?? (looksLikeRawData(base.text) ? null : base.text),
    mediaUrls: base.mediaUrls,
    structured
  };
}
