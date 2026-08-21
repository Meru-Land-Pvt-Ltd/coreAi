/**
 * THE CODE STEP.
 *
 * An architect writes a small piece of JavaScript or Python, it is handed what
 * the steps before it produced, and what it returns goes to the step after.
 *
 * This node was on the palette once and was taken off, and the reason was
 * written down at the time: it shipped with an editor and a NEW badge, and the
 * function that would have run the code was never called from anywhere. A step
 * that quietly did nothing. The note said it comes back when it can run inside
 * a real sandbox with no network and no filesystem, and not before.
 *
 * This is that. The code does not run here. It is sent to a container that has
 * no route to the internet, no credentials, no database, a read-only disk, no
 * Linux capabilities and a hard ceiling on time, memory and processes. If the
 * code escapes its language sandbox — and the honest assumption is that one day
 * it will — it arrives somewhere with nothing in it.
 *
 * Nothing in this file is a security boundary. Every boundary is in
 * docker-compose.prod.yml and apps/sandbox/. This file's only job is to send
 * the right thing and to refuse to send the wrong one.
 */

import { env } from "../../config/env";

export type CodeLanguage = "javascript" | "python";

export type CodeRunResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
  /** console.log / print lines, so somebody can debug their own step. */
  logs: string[];
  ms?: number;
  timedOut?: boolean;
};

/** Longer than this and it is a loop, not a calculation. */
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * What the code is allowed to see.
 *
 * NOT the whole run context. The run carries the business, the caller, phone
 * numbers, conversation history and — depending on the orchestration — things
 * belonging to a real customer. A step whose whole point is to run somebody
 * else's code is the last place any of that should be handed over by default.
 *
 * So it gets the previous steps' declared outputs and the values the architect
 * explicitly wired in, and nothing else. If they want the caller's number in
 * there, they write {{callerNumber}} into an input and it arrives as data they
 * asked for rather than data that was lying around.
 */
export function inputForCode(
  nodeData: Record<string, unknown>,
  resolve: (text: string) => string
): Record<string, unknown> {
  const raw = nodeData.codeInput;

  // Nothing wired in: the step gets an empty object rather than the run.
  if (raw === undefined || raw === null || String(raw).trim() === "") return {};

  const text = resolve(String(raw));

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    // Not JSON — a single value the architect wired in. Handed over as `value`
    // rather than refused, because "{{callerNumber}}" is a perfectly sensible
    // thing to want and should not need quoting rules explained.
    return { value: text };
  }
}

export function normalizeLanguage(value: unknown): CodeLanguage {
  return String(value ?? "").toLowerCase() === "python" ? "python" : "javascript";
}

/**
 * Send one piece of code to the sandbox.
 *
 * Every failure here is a refusal to run, never a fallback. There is no path
 * where this quietly executes the code somewhere less safe because the sandbox
 * was unavailable — the whole point of the container is lost the moment there
 * is a second way to run.
 */
export async function runCodeInSandbox(input: {
  language: CodeLanguage;
  code: string;
  data: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<CodeRunResult> {
  const url = env.SANDBOX_URL;
  const token = env.SANDBOX_TOKEN;

  if (!url || !token) {
    return {
      ok: false,
      logs: [],
      error:
        "The safe place where code runs is not switched on, so this step did not run. Nothing else was affected."
    };
  }

  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(500, input.timeoutMs ?? DEFAULT_TIMEOUT_MS));

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sandbox-token": token },
      body: JSON.stringify({
        language: input.language,
        code: input.code,
        input: input.data,
        timeoutMs
      }),
      // Longer than the sandbox's own two timers, so a real answer always wins
      // the race against this one.
      signal: AbortSignal.timeout(timeoutMs + 5_000)
    });

    if (!response.ok) {
      return {
        ok: false,
        logs: [],
        error: `The safe place where code runs answered ${response.status}, so this step did not run.`
      };
    }

    const result = (await response.json()) as CodeRunResult;
    return { ...result, logs: result.logs ?? [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      logs: [],
      error: message.includes("timeout")
        ? "Your code took too long and was stopped."
        : "The safe place where code runs could not be reached, so this step did not run."
    };
  }
}
