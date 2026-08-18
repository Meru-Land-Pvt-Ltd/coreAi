import { spawn } from "node:child_process";
import vm from "node:vm";
import {
  resolveScriptLanguage,
  resolveScriptTimeoutMs,
  SCRIPT_MAX_SOURCE_LENGTH,
  type ScriptLanguage
} from "@coreai/shared";
import { env } from "../../config/env";

export type ScriptExecutionResult = {
  status: "success" | "error";
  /** Value the script returned/assigned. `undefined` when it produced nothing. */
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
  /** Workflow context snapshot handed to the script as `input`. */
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

function collectLogs() {
  const lines: string[] = [];
  let truncated = false;

  const push = (parts: unknown[]) => {
    if (lines.length >= MAX_LOG_LINES) {
      truncated = true;
      return;
    }
    const line = parts
      .map((part) => {
        if (typeof part === "string") return part;
        try {
          return JSON.stringify(part);
        } catch {
          return String(part);
        }
      })
      .join(" ");
    lines.push(line.length > MAX_LOG_LINE_LENGTH ? `${line.slice(0, MAX_LOG_LINE_LENGTH)}…` : line);
  };

  return {
    push,
    drain(): string[] {
      return truncated ? [...lines, `… log truncated at ${MAX_LOG_LINES} lines`] : lines;
    }
  };
}

function toPlainInput(input: unknown): unknown {
  if (input === undefined || input === null) return {};
  try {
    return JSON.parse(JSON.stringify(input, jsonSafeReplacer()));
  } catch {
    return {};
  }
}

/** Drops cycles and non-serialisable values instead of throwing on them. */
function jsonSafeReplacer() {
  const seen = new WeakSet<object>();
  return function replacer(this: unknown, key: string, value: unknown): unknown {
    /* `value` has already been through toJSON(), which turns a Buffer into
       {type,data} — a call recording would arrive as a 200k-element array. The
       holder still has the original, so check that. */
    const raw = this && typeof this === "object" ? (this as Record<string, unknown>)[key] : value;
    if (Buffer.isBuffer(raw)) return "[Binary]";
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function") return undefined;
    if (value && typeof value === "object") {
      if (seen.has(value as object)) return "[Circular]";
      seen.add(value as object);
    }
    return value;
  };
}

/** Normalises a script result to JSON-safe data and enforces the size cap. */
function normalizeOutput(value: unknown): { output?: unknown; error?: string } {
  if (value === undefined) return {};
  let serialized: string;
  try {
    serialized = JSON.stringify(value, jsonSafeReplacer()) ?? "null";
  } catch (error) {
    return { error: `Script returned a value that could not be serialized: ${describe(error)}` };
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_OUTPUT_BYTES) {
    return {
      error: `Script output is larger than ${Math.round(MAX_OUTPUT_BYTES / 1024)}KB. Return a summary instead of the full payload.`
    };
  }
  return { output: JSON.parse(serialized) };
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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
    return fail("Code nodes are disabled on this server (SCRIPT_NODE_ENABLED=false).");
  }

  const code = typeof params.code === "string" ? params.code : "";
  if (!code.trim()) return fail("This Code node has no code to run.");
  if (code.length > SCRIPT_MAX_SOURCE_LENGTH) {
    return fail(`Script is longer than the ${SCRIPT_MAX_SOURCE_LENGTH.toLocaleString()} character limit.`);
  }

  const timeoutMs = resolveScriptTimeoutMs(params.timeoutMs);
  const input = toPlainInput(params.input);

  const result =
    language === "python"
      ? await runPython({ code, input, timeoutMs })
      : await runJavaScript({ code, input, timeoutMs });

  return { ...result, durationMs: Date.now() - started, language };
}

// ---------------------------------------------------------------- JavaScript

type Runner = (params: {
  code: string;
  input: unknown;
  timeoutMs: number;
}) => Promise<Omit<ScriptExecutionResult, "durationMs" | "language">>;

const runJavaScript: Runner = async ({ code, input, timeoutMs }) => {
  const logs = collectLogs();
  const consoleShim = {
    log: (...parts: unknown[]) => logs.push(parts),
    info: (...parts: unknown[]) => logs.push(parts),
    warn: (...parts: unknown[]) => logs.push(parts),
    error: (...parts: unknown[]) => logs.push(parts),
    debug: (...parts: unknown[]) => logs.push(parts)
  };

  const sandbox: Record<string, unknown> = {
    console: consoleShim,
    input,
    context: input
  };

  let context: vm.Context;
  try {
    context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  } catch (error) {
    return { status: "error", logs: logs.drain(), error: describe(error) };
  }

  const wrapped = `(async () => {\n${code}\n})()`;

  let pending: unknown;
  try {
    // The vm `timeout` only interrupts synchronous work (e.g. `while (true) {}`).
    pending = vm.runInContext(wrapped, context, {
      timeout: timeoutMs,
      filename: "code-node.js",
      displayErrors: true
    });
  } catch (error) {
    const message = describe(error);
    return {
      status: "error",
      logs: logs.drain(),
      error: message.includes("Script execution timed out")
        ? `Script timed out after ${timeoutMs}ms.`
        : message
    };
  }

  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Script timed out after ${timeoutMs}ms.`)), timeoutMs);
  });

  try {
    const value = await Promise.race([Promise.resolve(pending), guard]);
    const normalized = normalizeOutput(value);
    if (normalized.error) {
      return { status: "error", logs: logs.drain(), error: normalized.error };
    }
    return { status: "success", output: normalized.output, logs: logs.drain() };
  } catch (error) {
    return { status: "error", logs: logs.drain(), error: describe(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// -------------------------------------------------------------------- Python

const PYTHON_RESULT_SENTINEL = "__TRIVEN_SCRIPT_RESULT__";

const PYTHON_BOOTSTRAP = `
import io, json, sys, traceback

_real_stdout = sys.stdout
payload = json.loads(sys.stdin.read())
buffer = io.StringIO()
sys.stdout = buffer

result = {"status": "success", "output": None}
scope = {"input": payload.get("input", {}), "output": None, "__name__": "__triven_script__"}

try:
    exec(compile(payload.get("code", ""), "code-node.py", "exec"), scope)
    value = scope.get("output")
    if value is None and callable(scope.get("main")):
        value = scope["main"](scope["input"])
    result["output"] = value
except BaseException:
    result["status"] = "error"
    result["error"] = traceback.format_exc(limit=5).strip().splitlines()[-1]

sys.stdout = _real_stdout
result["logs"] = buffer.getvalue().splitlines()

try:
    encoded = json.dumps(result, default=str)
except (TypeError, ValueError) as exc:
    encoded = json.dumps({
        "status": "error",
        "logs": result.get("logs", []),
        "error": "Script output could not be converted to JSON: " + str(exc),
    })

_real_stdout.write("${PYTHON_RESULT_SENTINEL}" + encoded)
_real_stdout.flush()
`;

const runPython: Runner = async ({ code, input, timeoutMs }) => {
  const command = env.PYTHON_BIN ?? "python3";

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, ["-I", "-c", PYTHON_BOOTSTRAP], {
        /* Stripped environment: the backend's own env holds DATABASE_URL and
           every provider key, and a Python script can read os.environ. */
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: "/tmp",
          PYTHONIOENCODING: "utf-8",
          PYTHONDONTWRITEBYTECODE: "1"
        },
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      resolve({ status: "error", logs: [], error: pythonUnavailableMessage(command, error) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const finish = (result: Omit<ScriptExecutionResult, "durationMs" | "language">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_OUTPUT_BYTES * 2) child.kill("SIGKILL");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ status: "error", logs: [], error: pythonUnavailableMessage(command, error) });
    });

    child.on("close", () => {
      if (timedOut) {
        finish({ status: "error", logs: [], error: `Script timed out after ${timeoutMs}ms.` });
        return;
      }

      const marker = stdout.lastIndexOf(PYTHON_RESULT_SENTINEL);
      if (marker < 0) {
        finish({
          status: "error",
          logs: stdout.split("\n").filter(Boolean).slice(0, MAX_LOG_LINES),
          error: stderr.trim().split("\n").filter(Boolean).pop() ?? "Python script produced no result."
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout.slice(marker + PYTHON_RESULT_SENTINEL.length)) as {
          status?: string;
          output?: unknown;
          logs?: unknown;
          error?: string;
        };
        const logs = Array.isArray(parsed.logs)
          ? parsed.logs.slice(0, MAX_LOG_LINES).map((line) => String(line).slice(0, MAX_LOG_LINE_LENGTH))
          : [];

        if (parsed.status === "error") {
          finish({ status: "error", logs, error: parsed.error ?? "Python script failed." });
          return;
        }

        const normalized = normalizeOutput(parsed.output ?? undefined);
        if (normalized.error) {
          finish({ status: "error", logs, error: normalized.error });
          return;
        }
        finish({ status: "success", output: normalized.output, logs });
      } catch (error) {
        finish({ status: "error", logs: [], error: `Could not read the script result: ${describe(error)}` });
      }
    });

    child.stdin?.on("error", () => {
      /* EPIPE when the interpreter is missing or already dead — the "error"/
         "close" handlers own the reporting, this just stops the throw. */
    });
    child.stdin?.end(JSON.stringify({ code, input }));
  });
};

function pythonUnavailableMessage(command: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") {
    return `Python is not installed on this server (looked for "${command}"). Switch this Code node to JavaScript, or install Python 3 and set PYTHON_BIN.`;
  }
  return `Could not start Python: ${describe(error)}`;
}
