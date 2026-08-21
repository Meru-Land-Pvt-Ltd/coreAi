/**
 * RUNNING AN ARCHITECT'S CODE — by sending it somewhere else.
 *
 * This file used to run it here. JavaScript went through `node:vm` inside the
 * backend process, and Python was spawned as a child on the backend container.
 * The environment was stripped for the Python child, which sounds careful and
 * is not the point: both were executing on the machine that holds
 * DATABASE_URL, every provider key, and a route to every other container. A
 * `vm` escape — and they are public, documented and numerous — was not a bug in
 * a sandbox, it was root on the platform.
 *
 * It was survivable only because the node was taken off the palette and the one
 * engine that could reach it has a single caller.
 *
 * Now there is exactly one way to run code, and it is a container with no
 * network, no credentials, no database, a read-only disk and every Linux
 * capability dropped. The in-process paths are gone rather than disabled,
 * because a second way to run is the whole risk: any switch that falls back to
 * "run it here" undoes every wall in one line.
 *
 * The signature is unchanged, so both engines get the safe version at once.
 */

import {
  resolveScriptLanguage,
  resolveScriptTimeoutMs,
  SCRIPT_MAX_SOURCE_LENGTH,
  type ScriptLanguage
} from "@coreai/shared";
import { env } from "../../config/env";
import { normalizeLanguage, runCodeInSandbox } from "../architect/code-node";

export type ScriptExecutionResult = {
  status: "success" | "error";
  /** Value the script returned. `undefined` when it produced nothing. */
  output?: unknown;
  /** console.log / print lines, in order, capped. */
  logs: string[];
  error?: string;
  durationMs: number;
  language: ScriptLanguage;
};

export type ScriptExecutionParams = {
  language?: unknown;
  code?: unknown;
  /** What the script is handed as `input`. */
  input?: unknown;
  timeoutMs?: unknown;
};

const MAX_LOG_LINES = 200;
const MAX_LOG_LINE_LENGTH = 2_000;
/** Guards against a script returning something that would bloat every run row. */
const MAX_OUTPUT_BYTES = 256 * 1024;

export function isScriptNodeEnabled(): boolean {
  return env.SCRIPT_NODE_ENABLED !== false;
}

/**
 * Only plain data crosses the wire.
 *
 * The run context can hold class instances, functions and cycles. Sending it
 * as-is would either throw or quietly send something unrecognisable, and the
 * step would fail for a reason nobody could read.
 */
function toPlainInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  try {
    const plain = JSON.parse(JSON.stringify(value));
    return plain && typeof plain === "object" && !Array.isArray(plain) ? plain : { value: plain };
  } catch {
    return {};
  }
}

function trimLogs(logs: string[] | undefined): string[] {
  const lines = (logs ?? []).slice(0, MAX_LOG_LINES).map((line) => {
    const text = String(line);
    return text.length > MAX_LOG_LINE_LENGTH ? `${text.slice(0, MAX_LOG_LINE_LENGTH)}…` : text;
  });
  if ((logs ?? []).length > MAX_LOG_LINES) lines.push("(more output was produced and has been cut short)");
  return lines;
}

export async function executeScript(params: ScriptExecutionParams): Promise<ScriptExecutionResult> {
  const language = resolveScriptLanguage(params.language);
  const started = Date.now();

  const fail = (error: string, logs: string[] = []): ScriptExecutionResult => ({
    status: "error",
    logs,
    error,
    durationMs: Date.now() - started,
    language
  });

  if (!isScriptNodeEnabled()) {
    return fail("Code steps are switched off on this server.");
  }

  const code = typeof params.code === "string" ? params.code : "";
  if (!code.trim()) return fail("This code step has nothing to run.");
  if (code.length > SCRIPT_MAX_SOURCE_LENGTH) {
    return fail(`That is longer than the ${SCRIPT_MAX_SOURCE_LENGTH.toLocaleString()} character limit.`);
  }

  const result = await runCodeInSandbox({
    language: normalizeLanguage(language),
    code,
    data: toPlainInput(params.input),
    timeoutMs: resolveScriptTimeoutMs(params.timeoutMs)
  });

  if (!result.ok) {
    return fail(result.error ?? "Your code stopped with an error.", trimLogs(result.logs));
  }

  // A step that returns something enormous would be written into every run row
  // it touches. Refused with a sentence rather than truncated, because half an
  // answer silently handed to the next step is the failure this platform spent
  // the week removing.
  let output = result.output;
  try {
    if (JSON.stringify(output ?? null).length > MAX_OUTPUT_BYTES) {
      return fail(
        `Your code returned more than ${Math.round(MAX_OUTPUT_BYTES / 1024)}KB. Return only what the next step needs.`,
        trimLogs(result.logs)
      );
    }
  } catch {
    output = null;
  }

  return {
    status: "success",
    output,
    logs: trimLogs(result.logs),
    durationMs: Date.now() - started,
    language
  };
}
