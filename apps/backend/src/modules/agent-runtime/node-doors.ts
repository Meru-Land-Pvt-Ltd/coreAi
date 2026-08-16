import {
  BLOCK_NODE_TYPES,
  getNodeDefinition,
  getNodeDoors,
  parseVisualResults,
  type NodeDoorSpec,
  type VisualResultsPayload
} from "@coreai/shared";
import { env } from "../../config/env";
import { getDoorBrainConfig } from "../admin/door-brain-settings";
import { resolveConfiguredLlmProvider } from "../ai-provider-engine/llm-credentials";
import { recordLlmProviderFailure, recordLlmProviderSuccess } from "../ai-provider-engine/llm-health";
import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import type { AIExecuteRequest } from "../ai-provider-engine/types";

/**
 * THE TWO DOORS — the AI entry and exit doors built INSIDE a node.
 *
 * An architect used to hand-place an AI Brain node before and after every step
 * that needed translation. That work now happens inside the node itself: doors
 * are never canvas nodes, never appear in the palette, and are on by default.
 * The same product needs 6 nodes instead of 10, and it works even when the
 * architect knows nothing about prompts.
 *
 *   entry door         turns the customer's words and the run so far into the
 *                      exact request this step needs (a resolved config field
 *                      value, applied to THIS execution only — the saved graph
 *                      is never touched).
 *   exit door          cleans the raw reply into the smallest useful thing
 *                      later steps can read.
 *   presentation door  turns the final output into the visual contract the
 *                      Result Viewer renders.
 *
 * Each door is born knowing its job: the instruction comes from the shared node
 * registry (`getNodeDoors`), not from anything the architect writes. The model
 * behind every door is one platform-wide battery an admin can swap forever
 * (Admin → door model), never a per-node setting.
 *
 * ── THE CONTRACT THAT MATTERS ────────────────────────────────────────────────
 * Doors are an ENHANCEMENT, never a dependency. Every function here:
 *   • never throws — a failure, a timeout, a missing key or nonsense from the
 *     model all return "no change", and the node proceeds exactly as it does
 *     today;
 *   • is bounded — one shared per-run budget of door calls and a hard timeout
 *     on each call, so a door can never stall or inflate a run;
 *   • is skipped when it could not help, so a run never pays for a door it
 *     did not need;
 *   • never logs a config value, a customer message or a model reply.
 */

/* ------------------------------- constants -------------------------------- */

/** Hard ceiling on one door call. Past this the node proceeds without it. */
export const DOOR_TIMEOUT_MS = 12_000;

/** Doors are precise translators, not writers. */
const DOOR_TEMPERATURE = 0.1;

const ENTRY_DOOR_MAX_TOKENS = 400;
const EXIT_DOOR_MAX_TOKENS = 600;
const PRESENTATION_DOOR_MAX_TOKENS = 1200;

/** Below this a raw reply is already small enough that cleaning is waste. */
const EXIT_DOOR_MIN_CHARS = 400;

/** Bounds on what a door may hand back — a model can hallucinate enormity. */
const MAX_OVERRIDE_FIELDS = 12;
const MAX_OVERRIDE_VALUE_CHARS = 4000;
const MAX_CLEANED_CHARS = 20_000;

/** Bounds on what a door is shown, so prompts stay small and cheap. */
const MAX_CONTEXT_CHARS = 4000;
const MAX_RAW_OUTPUT_CHARS = 8000;
const MAX_HISTORY_TURNS = 6;

/**
 * Config field names a door may NEVER read or write. These select credentials,
 * connections and accounts: letting a language model rewrite them would let a
 * customer's words redirect the platform's own keys, and showing them to the
 * model would put a pasted credential in a prompt. Doors fill in the request —
 * the address, the parameters, the body, the message — never who is paying or
 * which account is used.
 */
const PROTECTED_CONFIG_KEY_PATTERN =
  /(key|secret|token|credential|password|auth|connection|account|webhook|header)/i;

/**
 * Names that reach an object's prototype instead of its own properties. A model
 * reply is parsed JSON, and `JSON.parse` happily produces an own "__proto__"
 * key, so these are refused everywhere a door name is read or written.
 */
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/* --------------------------------- types ---------------------------------- */

export type DoorKind = "entry" | "exit" | "presentation";

/**
 * The shared per-run allowance for ALL doors in one run. Created once per run
 * and passed to every door call.
 *
 * TWO ceilings, both shared, because they bound different things:
 *   • `max` bounds COST — how many door calls the run may ever pay for;
 *   • the deadline bounds WAITING — how long, in total, a customer may be kept
 *     looking at a spinner because of doors.
 *
 * Without the deadline the two ceilings multiply: a full allowance of doors
 * that each crawl to the 12s per-call timeout is 8 × 12s of dead time added to
 * one page load. The deadline collapses that to one number the whole run
 * shares, after which every remaining door is skipped and the run finishes on
 * the architect's saved config — exactly the same "no change" path as any other
 * door failure.
 */
export type DoorBudget = {
  /** Total door calls allowed in this run. */
  readonly max: number;
  /** Door calls already spent. */
  readonly used: number;
  readonly remaining: number;
  /** True once this run has spent its whole door time allowance. */
  readonly expired: boolean;
  /** Claim one call. False when the run is out of allowance or out of time. */
  take(): boolean;
};

/**
 * One run's door allowance: `DOOR_BRAIN_MAX_PER_RUN` calls (8) inside
 * `DOOR_BRAIN_MAX_MS_PER_RUN` milliseconds (25s) of total door time.
 */
export function createDoorBudget(
  max: number = env.DOOR_BRAIN_MAX_PER_RUN,
  totalMs: number = env.DOOR_BRAIN_MAX_MS_PER_RUN
): DoorBudget {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
  // A door already claimed cannot be un-claimed, so the deadline is measured
  // from the moment the run starts rather than from the first door call.
  // 0 means "no door time at all", the same way a max of 0 means "no doors" —
  // both are the switch that turns every door off platform-wide. Only a value
  // that is not a usable number leaves the run unbounded in time.
  const deadline =
    Number.isFinite(totalMs) && totalMs >= 0 ? Date.now() + Math.floor(totalMs) : Number.POSITIVE_INFINITY;
  let used = 0;

  return {
    get max() {
      return limit;
    },
    get used() {
      return used;
    },
    get remaining() {
      return Math.max(0, limit - used);
    },
    get expired() {
      return Date.now() >= deadline;
    },
    take() {
      if (used >= limit) return false;
      if (Date.now() >= deadline) return false;
      used += 1;
      return true;
    }
  };
}

/** The node a door is built into — id and label are used for logs only. */
export type DoorNode = {
  id: string;
  label?: string;
  /** The node's saved config, exactly as stored on the canvas. */
  config?: Record<string, unknown>;
};

/** What the door is allowed to see of the run. Deliberately small. */
export type DoorContext = {
  /** What the customer actually said or typed, in their own words. */
  userMessage?: string;
  /** Everything the run has produced so far, keyed by output name. */
  variables?: Record<string, unknown>;
  /** Recent conversation, newest last. Trimmed before it is sent. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** The business this run belongs to, for grounding names and tone. */
  businessName?: string;
};

/**
 * Config field values that REPLACE the node's config for this execution only.
 * An empty object means "no change" — the node runs on its saved config.
 */
export type EntryDoorResult = {
  overrides: Record<string, string>;
};

/** `changed: false` means "no change" — store the raw output as before. */
export type ExitDoorResult = {
  value: unknown;
  changed: boolean;
};

/** `visual: null` means "no change" — render the plain-text result as before. */
export type PresentationDoorResult = {
  visual: VisualResultsPayload | null;
};

export type RunEntryDoorInput = {
  node: DoorNode;
  nodeType: string;
  context: DoorContext;
  /** Defaults to this node type's registry doors. */
  doorSpec?: NodeDoorSpec;
  budget: DoorBudget;
};

export type RunExitDoorInput = {
  node: DoorNode;
  nodeType: string;
  rawOutput: unknown;
  context: DoorContext;
  doorSpec?: NodeDoorSpec;
  budget: DoorBudget;
};

export type RunPresentationDoorInput = {
  context: DoorContext;
  lastOutput: unknown;
  budget: DoorBudget;
};

const NO_ENTRY_CHANGE: EntryDoorResult = { overrides: {} };

/* ------------------------------ small helpers ----------------------------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON that can never throw on cycles or exotic values. */
function safeStringify(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    return (
      JSON.stringify(value, (_key, inner) => {
        if (typeof inner === "object" && inner !== null) {
          if (seen.has(inner as object)) return "[circular]";
          seen.add(inner as object);
        }
        if (typeof inner === "bigint") return String(inner);
        return inner;
      }) ?? ""
    );
  } catch {
    return "";
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Never send a credential-shaped field to the door model, or let one back in. */
function isProtectedConfigKey(key: string): boolean {
  return PROTOTYPE_KEYS.has(key) || PROTECTED_CONFIG_KEY_PATTERN.test(key);
}

/** True when a value still carries an unfilled {{variable}} slot. */
function hasRunPlaceholder(value: string): boolean {
  return /\{\{[^}]*\}\}/.test(value);
}

/** Config a door may see and set: strings only, credentials removed. */
function visibleConfig(config: Record<string, unknown> | undefined): Record<string, string> {
  const visible: Record<string, string> = {};
  for (const [key, value] of Object.entries(config ?? {})) {
    if (isProtectedConfigKey(key)) continue;
    if (typeof value === "string") visible[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") visible[key] = String(value);
  }
  return visible;
}

/**
 * THE WHITELIST, resolved. Exactly which settings this node's entry door may
 * fill in — nothing else the model hands back is ever applied.
 *
 * The list comes from the shared registry (`doors.entry.fields`), not from what
 * the node happens to have saved. That distinction is the point: a door's reply
 * is shaped by the run, and the run carries whatever a stranger typed into a
 * published page, so "a setting this node has" is not a safe boundary — only
 * "a setting this door was born allowed to fill" is. A door with no declared
 * list writes nothing at all.
 *
 * The credential/prototype filter is applied a second time on top, so a name
 * added to the registry by mistake still cannot reach a key or an account.
 */
function settableFields(doorSpec: NodeDoorSpec | undefined): Set<string> {
  const names = new Set<string>();
  for (const key of doorSpec?.entry?.fields ?? []) {
    if (typeof key === "string" && key && !isProtectedConfigKey(key)) names.add(key);
  }
  return names;
}

function contextBlock(context: DoorContext): string {
  const lines: string[] = [];

  if (context.businessName?.trim()) lines.push(`Business: ${context.businessName.trim()}`);
  if (context.userMessage?.trim()) {
    lines.push(`What the customer said: ${clip(context.userMessage.trim(), 2000)}`);
  }

  const history = (context.history ?? []).slice(-MAX_HISTORY_TURNS);
  if (history.length > 0) {
    lines.push("Recent conversation:");
    for (const turn of history) {
      lines.push(`  ${turn.role}: ${clip(String(turn.content ?? ""), 500)}`);
    }
  }

  const variables = context.variables ?? {};
  if (Object.keys(variables).length > 0) {
    lines.push(`What the run has produced so far: ${clip(safeStringify(variables), MAX_CONTEXT_CHARS)}`);
  }

  return lines.length > 0 ? lines.join("\n") : "Nothing has been produced yet.";
}

/** Pull the first JSON object out of a model reply, fences and prose allowed. */
function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (isPlainObject(raw)) return raw;
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced && fenced[1].trim() ? fenced[1].trim() : trimmed;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/* -------------------------------- logging --------------------------------- */

/**
 * Door usage, never door content. No config value, customer message or model
 * reply is ever written here.
 */
function logDoor(
  kind: DoorKind,
  outcome: string,
  detail: { nodeId?: string; nodeType?: string; ms?: number; budget?: DoorBudget }
): void {
  const parts = [
    `[node-doors] ${kind} ${outcome}`,
    detail.nodeId ? `node=${detail.nodeId}` : "",
    detail.nodeType ? `type=${detail.nodeType}` : "",
    typeof detail.ms === "number" ? `ms=${detail.ms}` : "",
    detail.budget ? `doors=${detail.budget.used}/${detail.budget.max}` : ""
  ].filter(Boolean);
  console.log(parts.join(" "));
}

/* ---------------------------- skip heuristics ----------------------------- */

/**
 * The entry door earns its cost only when the step's request is not already
 * decided: either the config points at the run (`{{...}}`) or there is nothing
 * usable saved at all.
 *
 * Only the settings the door may actually WRITE are weighed. A field the door
 * could never change cannot make the request ambiguous, and paying for a call
 * whose every answer would be discarded is the definition of waste.
 */
export function entryDoorShouldRun(
  node: DoorNode,
  nodeType: string,
  doorSpec?: NodeDoorSpec
): boolean {
  const allowed = settableFields(doorSpec ?? getNodeDoors(nodeType));
  if (allowed.size === 0) return false;

  const config = visibleConfig(node.config);
  const values = Array.from(allowed)
    .map((field) => config[field] ?? "")
    .filter((value) => value.trim().length > 0);

  // Nothing saved, or nothing meaningful saved → the request is ambiguous.
  if (values.length === 0) return true;
  if (values.some(hasRunPlaceholder)) return true;

  // A required field the door is allowed to fill, left blank, is ambiguous too.
  const required = getNodeDefinition(nodeType)?.requiredConfig ?? [];
  return required.some((field) => allowed.has(field) && !(config[field] ?? "").trim());
}

/** True when a value contains another object or array — shape worth flattening. */
function hasNestedStructure(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => typeof item === "object" && item !== null);
  if (isPlainObject(value)) {
    return Object.values(value).some((item) => typeof item === "object" && item !== null);
  }
  return false;
}

/**
 * The exit door earns its cost only on a reply big or shaped enough that later
 * steps would otherwise wade through it. A number, a flag or a short line is
 * already the smallest useful thing.
 */
export function exitDoorShouldRun(rawOutput: unknown): boolean {
  if (typeof rawOutput === "string") return rawOutput.length > EXIT_DOOR_MIN_CHARS;
  if (rawOutput === null || typeof rawOutput !== "object") return false;

  const serialized = safeStringify(rawOutput);
  if (serialized.length > EXIT_DOOR_MIN_CHARS) return true;
  return hasNestedStructure(rawOutput);
}

/**
 * The presentation door only runs when the final output is not ALREADY a valid
 * visual payload — a Brain that emitted proper stats/chart/table is left alone.
 */
export function presentationDoorShouldRun(lastOutput: unknown): boolean {
  if (lastOutput === null || lastOutput === undefined) return false;
  if (typeof lastOutput === "string" && !lastOutput.trim()) return false;
  return parseVisualResults(lastOutput) === null;
}

/* ----------------------------- the model call ----------------------------- */

type DoorCallResult = { ok: true; json: Record<string, unknown> } | { ok: false };

const FAILED: DoorCallResult = { ok: false };

/**
 * Race a promise against the door timeout. The losing promise's rejection is
 * swallowed here so a slow provider can never surface as an unhandled error.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = work.then(
    (value) => ({ settled: true as const, value }),
    () => ({ settled: false as const, value: null })
  );

  try {
    const outcome = await Promise.race([
      guarded,
      new Promise<{ settled: false; value: null }>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false, value: null }), ms);
      })
    ]);
    return outcome.settled ? (outcome.value as T) : null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * One door call on the admin-configured battery, exactly the way ai.llm_call
 * reaches the provider engine. Returns the parsed JSON object, or `{ ok: false }`
 * for every kind of failure — this function never throws.
 */
async function callDoorModel(params: {
  kind: DoorKind;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  budget: DoorBudget;
  nodeId?: string;
  nodeType?: string;
}): Promise<DoorCallResult> {
  const { kind, budget, nodeId, nodeType } = params;
  const startedAt = Date.now();

  try {
    const config = await getDoorBrainConfig();
    const resolved = resolveConfiguredLlmProvider(config.providerId);
    if (!resolved) {
      logDoor(kind, "skipped:no-provider-key", { nodeId, nodeType, budget });
      return FAILED;
    }

    // Budget is claimed only once a real call is definitely about to happen.
    if (!budget.take()) {
      logDoor(kind, "skipped:budget-spent", { nodeId, nodeType, budget });
      return FAILED;
    }

    const request: AIExecuteRequest = {
      capability: "llm",
      systemPrompt: params.systemPrompt,
      messages: [{ role: "user", content: params.userPrompt }],
      temperature: DOOR_TEMPERATURE,
      maxTokens: params.maxTokens,
      outputFormat: "json",
      // A model saved for the configured provider is dropped when the engine
      // falls back to a different one, so it is never sent to an API that
      // would reject it.
      ...(config.modelId && !resolved.fallbackFrom ? { model: config.modelId } : {})
    };

    const response = await withTimeout(
      getProviderEngine().executeWithProvider(resolved.providerId, request),
      DOOR_TIMEOUT_MS
    );
    const ms = Date.now() - startedAt;

    if (!response) {
      logDoor(kind, "no-change:timeout", { nodeId, nodeType, ms, budget });
      return FAILED;
    }

    if (response.status === "error") {
      recordLlmProviderFailure(resolved.providerId, response.error);
      logDoor(kind, "no-change:provider-error", { nodeId, nodeType, ms, budget });
      return FAILED;
    }
    recordLlmProviderSuccess(resolved.providerId);

    const json = parseJsonObject(response.structuredOutput ?? response.text);
    if (!json) {
      logDoor(kind, "no-change:unreadable-reply", { nodeId, nodeType, ms, budget });
      return FAILED;
    }

    logDoor(kind, "ok", { nodeId, nodeType, ms, budget });
    return { ok: true, json };
  } catch (error) {
    // Anything at all — a thrown adapter, a database blip, a bad config — is a
    // no-change. The node proceeds exactly as it does today.
    logDoor(kind, "no-change:error", { nodeId, nodeType, ms: Date.now() - startedAt, budget });
    console.warn(`[node-doors] ${kind} door failed`, {
      reason: error instanceof Error ? error.message : "unknown"
    });
    return FAILED;
  }
}

/* ------------------------------- entry door -------------------------------- */

const ENTRY_DOOR_SYSTEM = [
  "You are the entry door built inside one step of an automation. You never talk to anyone.",
  "",
  "YOUR JOB: {{job}}",
  "",
  'Answer with JSON only, in exactly this shape: {"overrides": {"settingName": "finished value"}}',
  "",
  "Rules:",
  "- Only use setting names from the list you are given. Never invent one.",
  "- Include a setting only when you are changing it. Return {\"overrides\": {}} when nothing needs to change.",
  "- Every value must be finished: no {{...}} and no [...] left in it.",
  "- Use only facts you were given. Never invent a name, number, date, address or id.",
  "- Keep values short and exact."
].join("\n");

/**
 * The entry door: turn the customer's words and the run so far into the exact
 * request this step needs. The returned overrides replace config field values
 * for THIS execution only — the saved graph is never mutated.
 *
 * Returns `{ overrides: {} }` (no change) when the door is skipped, out of
 * budget, times out, or hands back anything unusable.
 */
export async function runEntryDoor(input: RunEntryDoorInput): Promise<EntryDoorResult> {
  const { node, nodeType, context, budget } = input;

  try {
    const spec = input.doorSpec ?? getNodeDoors(nodeType);
    const job = spec?.entry?.job;
    if (!job) return NO_ENTRY_CHANGE;

    const allowed = settableFields(spec);
    if (allowed.size === 0) return NO_ENTRY_CHANGE;

    if (!entryDoorShouldRun(node, nodeType, spec)) {
      logDoor("entry", "skipped:request-already-decided", {
        nodeId: node.id,
        nodeType,
        budget
      });
      return NO_ENTRY_CHANGE;
    }

    const current = visibleConfig(node.config);
    const userPrompt = [
      `This step: ${node.label || nodeType}`,
      "",
      "Settings you may fill in (name → what is saved now):",
      ...Array.from(allowed)
        .sort()
        .map((field) => `- ${field} → ${current[field] ? clip(current[field], 500) : "(empty)"}`),
      "",
      contextBlock(context)
    ].join("\n");

    const result = await callDoorModel({
      kind: "entry",
      systemPrompt: ENTRY_DOOR_SYSTEM.replace("{{job}}", job),
      userPrompt,
      maxTokens: ENTRY_DOOR_MAX_TOKENS,
      budget,
      nodeId: node.id,
      nodeType
    });
    if (!result.ok) return NO_ENTRY_CHANGE;

    // Weaker models sometimes drop the wrapper and answer with the settings
    // themselves. That is safe to accept here because every field name is
    // checked against the allow-list below — a bare object cannot smuggle in a
    // setting this node does not have. (The exit door stays strict about its
    // wrapper: it REPLACES real data, so it must say plainly that its reply is
    // a cleaning and not, say, a refusal.)
    const raw = isPlainObject(result.json.overrides)
      ? result.json.overrides
      : isPlainObject(result.json)
        ? result.json
        : null;
    if (!raw) return NO_ENTRY_CHANGE;

    const overrides: Record<string, string> = {};
    for (const [field, value] of Object.entries(raw)) {
      if (Object.keys(overrides).length >= MAX_OVERRIDE_FIELDS) break;
      // A door may only fill settings this node really has, and never a
      // credential or connection field.
      if (!allowed.has(field) || isProtectedConfigKey(field)) continue;

      const text =
        typeof value === "string"
          ? value
          : typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : "";
      const trimmed = text.trim();
      // A value that still carries a placeholder is worse than the saved one.
      if (!trimmed || hasRunPlaceholder(trimmed)) continue;

      overrides[field] = trimmed.slice(0, MAX_OVERRIDE_VALUE_CHARS);
    }

    return { overrides };
  } catch {
    return NO_ENTRY_CHANGE;
  }
}

/* -------------------------------- exit door -------------------------------- */

const EXIT_DOOR_SYSTEM = [
  "You are the exit door built inside one step of an automation. You never talk to anyone.",
  "",
  "YOUR JOB: {{job}}",
  "",
  'Answer with JSON only, in exactly this shape: {"clean": <the cleaned result>}',
  "",
  "Rules:",
  "- Keep every name, number, id, date and link a later step or a person could need.",
  "- Drop wrappers, repeated boilerplate, empty fields and anything nobody will read.",
  "- Never invent a value. If it is not in the raw result, leave it out.",
  "- Keep it small."
].join("\n");

/**
 * The exit door: clean a step's raw reply into the smallest useful value for
 * later steps. Returns `{ changed: false }` (store the raw output, exactly as
 * today) when the door is skipped, out of budget, times out, or hands back
 * anything unusable.
 */
export async function runExitDoor(input: RunExitDoorInput): Promise<ExitDoorResult> {
  const { node, nodeType, rawOutput, context, budget } = input;
  const unchanged: ExitDoorResult = { value: rawOutput, changed: false };

  try {
    const spec = input.doorSpec ?? getNodeDoors(nodeType);
    const job = spec?.exit?.job;
    if (!job) return unchanged;

    if (!exitDoorShouldRun(rawOutput)) {
      logDoor("exit", "skipped:already-small", { nodeId: node.id, nodeType, budget });
      return unchanged;
    }

    const serialized =
      typeof rawOutput === "string" ? rawOutput : safeStringify(rawOutput);
    const userPrompt = [
      `This step: ${node.label || nodeType}`,
      "",
      "The raw result to clean:",
      clip(serialized, MAX_RAW_OUTPUT_CHARS),
      "",
      "What the run is trying to do:",
      contextBlock(context)
    ].join("\n");

    const result = await callDoorModel({
      kind: "exit",
      systemPrompt: EXIT_DOOR_SYSTEM.replace("{{job}}", job),
      userPrompt,
      maxTokens: EXIT_DOOR_MAX_TOKENS,
      budget,
      nodeId: node.id,
      nodeType
    });
    if (!result.ok) return unchanged;

    if (!("clean" in result.json)) return unchanged;
    const cleaned = result.json.clean;
    if (cleaned === null || cleaned === undefined) return unchanged;
    if (typeof cleaned === "string" && !cleaned.trim()) return unchanged;

    // An empty or runaway "cleaning" is not one — keep the raw reply instead.
    const cleanedSize = typeof cleaned === "string" ? cleaned.length : safeStringify(cleaned).length;
    if (cleanedSize === 0 || cleanedSize > MAX_CLEANED_CHARS) return unchanged;

    return { value: cleaned, changed: true };
  } catch {
    return unchanged;
  }
}

/* ---------------------------- presentation door ---------------------------- */

const PRESENTATION_DOOR_SYSTEM = [
  "You are the last step before a customer sees their result.",
  "",
  "YOUR JOB: {{job}}",
  "",
  "Answer with JSON only, in exactly this shape. Every part is optional:",
  '{"text":"a short line in plain words",',
  ' "stats":[{"label":"Subscribers","value":"312M","delta":"+1.2M","deltaDir":"up"}],',
  ' "chart":{"type":"bar","title":"Views by video","series":[{"label":"A","value":1200}]},',
  ' "table":{"columns":["Video","Views"],"rows":[["A","1,200"]]}}',
  "",
  "Rules:",
  "- Use only real values from the result. Never invent a number.",
  "- Plain everyday words. No technical terms.",
  "- Leave out any part the result does not really contain.",
  '- chart type must be one of "bar", "line" or "pie".'
].join("\n");

/** Fallback job if the registry entry is ever removed — the door still works. */
const PRESENTATION_FALLBACK_JOB =
  "Turn whatever this run produced into what the customer should see: a short line of plain words, " +
  "plus stat cards, a chart or a table when the result really does contain numbers or rows.";

/**
 * The presentation door (Face-out entry door): turn the run's final output into
 * the visual contract the Result Viewer renders. Returns `{ visual: null }` (no
 * change — render plain text exactly as today) when the output is already a
 * valid visual payload, when the door is skipped or out of budget, on timeout,
 * or when the model's payload carries nothing renderable.
 */
export async function runPresentationDoor(
  input: RunPresentationDoorInput
): Promise<PresentationDoorResult> {
  const { context, lastOutput, budget } = input;

  try {
    if (!presentationDoorShouldRun(lastOutput)) {
      logDoor("presentation", "skipped:already-visual", { budget });
      return { visual: null };
    }

    const job = getNodeDoors(BLOCK_NODE_TYPES.outputStage)?.entry?.job ?? PRESENTATION_FALLBACK_JOB;
    const serialized = typeof lastOutput === "string" ? lastOutput : safeStringify(lastOutput);
    if (!serialized.trim()) return { visual: null };

    const userPrompt = [
      "The result this run produced:",
      clip(serialized, MAX_RAW_OUTPUT_CHARS),
      "",
      "What the customer asked for:",
      contextBlock(context)
    ].join("\n");

    const result = await callDoorModel({
      kind: "presentation",
      systemPrompt: PRESENTATION_DOOR_SYSTEM.replace("{{job}}", job),
      userPrompt,
      maxTokens: PRESENTATION_DOOR_MAX_TOKENS,
      budget
    });
    if (!result.ok) return { visual: null };

    // The shared validator is the single source of truth for this contract —
    // it caps, coerces and rejects on both sides of the wire.
    return { visual: parseVisualResults(result.json) };
  } catch {
    return { visual: null };
  }
}
