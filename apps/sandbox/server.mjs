/**
 * THE SANDBOX SERVICE.
 *
 * One endpoint. It takes a piece of code and some input, runs the code in a
 * child process that dies at the first sign of trouble, and hands back what it
 * returned.
 *
 * It holds no credentials, has no database, and cannot reach the internet. See
 * README.md for why that arrangement is the actual security boundary and the
 * language sandbox is not.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8790);

/**
 * The one secret this service has, and the only environment variable it is
 * given. Without it, anything that can reach the container could run code here.
 */
const TOKEN = process.env.SANDBOX_TOKEN ?? "";

/** Ceilings. The caller may ask for less, never for more. */
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 5_000;
/** Anything larger than this is a mistake or an attack, and reading it costs us. */
const MAX_CODE_BYTES = 100_000;
const MAX_INPUT_BYTES = 1_000_000;
/** A runaway loop printing to stdout must not fill our memory. */
const MAX_OUTPUT_BYTES = 256_000;

const LANGUAGES = {
  javascript: { command: "node", args: [join(HERE, "harness.mjs")] },
  python: { command: "python3", args: ["-I", "-S", join(HERE, "harness.py")] }
};

/**
 * Compared in constant time.
 *
 * Only the backend can reach this service, so a timing attack would have to
 * come from inside the sandbox itself — from code that can already run here and
 * gains nothing from the token. It is written this way anyway, because "the
 * network makes it unreachable" is exactly the assumption that stops being true
 * the day somebody adds a service to this network without reading this file.
 */
function tokenMatches(given) {
  if (!TOKEN || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  // timingSafeEqual throws on a length mismatch, which would leak the length.
  // Comparing b against itself keeps the work identical either way.
  return a.length === b.length ? timingSafeEqual(a, b) : (timingSafeEqual(b, b), false);
}

function reply(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  response.end(text);
}

/**
 * Run one piece of code.
 *
 * Two timers, not one. The first kills the child at the limit. The second gives
 * up on the whole thing shortly after, because a child that has wedged the
 * kernel — a tight loop in a syscall, an unkillable state — will not die when
 * asked, and a request that never returns is its own denial of service.
 */
function runInChild({ language, code, input, timeoutMs }) {
  return new Promise((resolve) => {
    const spec = LANGUAGES[language];
    const started = Date.now();

    const child = spawn(spec.command, spec.args, {
      // NOTHING. Not a filtered copy of ours — an empty object. There is no
      // key here to leak because none was ever handed over.
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
      cwd: "/tmp",
      stdio: ["pipe", "pipe", "pipe"]
    });

    let out = "";
    let err = "";
    let truncated = false;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(giveUpTimer);
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      resolve({ ...result, ms: Date.now() - started });
    };

    child.stdout.on("data", (chunk) => {
      if (out.length > MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (err.length > MAX_OUTPUT_BYTES) return;
      err += chunk;
    });

    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      finish({
        ok: false,
        error: `Your code was still running after ${Math.round(timeoutMs / 1000)} seconds, so it was stopped.`,
        timedOut: true
      });
    }, timeoutMs);

    const giveUpTimer = setTimeout(() => {
      finish({
        ok: false,
        error: "Your code could not be stopped and was abandoned.",
        timedOut: true
      });
    }, timeoutMs + 2_000);

    child.on("error", (error) => {
      finish({ ok: false, error: `The sandbox could not start: ${error.message}` });
    });

    child.on("close", () => {
      if (settled) return;

      // The harness prints exactly one line of JSON as its last act. Anything
      // the code itself printed comes before it, which is why the LAST line is
      // the answer rather than the first.
      const lines = out.trim().split("\n").filter(Boolean);
      const last = lines[lines.length - 1];

      let parsed = null;
      try {
        parsed = last ? JSON.parse(last) : null;
      } catch {
        parsed = null;
      }

      if (!parsed || typeof parsed !== "object") {
        finish({
          ok: false,
          error: err.trim().slice(0, 2000) || "Your code did not finish and returned nothing.",
          logs: lines.slice(0, -1).slice(0, 50)
        });
        return;
      }

      finish({
        ok: parsed.ok === true,
        ...(parsed.ok === true ? { output: parsed.output } : { error: String(parsed.error ?? "Your code stopped with an error.") }),
        logs: [...(parsed.logs ?? []), ...(truncated ? ["(output was very long and has been cut short)"] : [])].slice(0, 50)
      });
    });

    try {
      child.stdin.write(JSON.stringify({ code, input }));
      child.stdin.end();
    } catch (error) {
      finish({ ok: false, error: `The sandbox could not be given the code: ${error.message}` });
    }
  });
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    reply(response, 200, { ok: true, languages: Object.keys(LANGUAGES) });
    return;
  }

  if (request.method !== "POST" || request.url !== "/run") {
    reply(response, 404, { ok: false, error: "Not found" });
    return;
  }

  if (!tokenMatches(request.headers["x-sandbox-token"])) {
    // One shape of answer whether the token is wrong or missing, so this
    // cannot be used to learn whether a token exists.
    reply(response, 401, { ok: false, error: "Not allowed" });
    return;
  }

  let body = "";
  let tooBig = false;

  request.on("data", (chunk) => {
    if (tooBig) return;
    body += chunk;
    if (body.length > MAX_CODE_BYTES + MAX_INPUT_BYTES) {
      tooBig = true;
      reply(response, 413, { ok: false, error: "That is too much to run at once." });
      request.destroy();
    }
  });

  request.on("end", async () => {
    if (tooBig) return;

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      reply(response, 400, { ok: false, error: "Malformed request." });
      return;
    }

    const language = String(parsed.language ?? "javascript").toLowerCase();
    if (!LANGUAGES[language]) {
      reply(response, 400, { ok: false, error: `Language "${language}" is not available here.` });
      return;
    }

    const code = String(parsed.code ?? "");
    if (!code.trim()) {
      reply(response, 400, { ok: false, error: "There is no code to run." });
      return;
    }
    if (Buffer.byteLength(code) > MAX_CODE_BYTES) {
      reply(response, 413, { ok: false, error: "That code is too long." });
      return;
    }

    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(500, Number(parsed.timeoutMs) || DEFAULT_TIMEOUT_MS)
    );

    const result = await runInChild({
      language,
      code,
      input: parsed.input ?? {},
      timeoutMs
    });

    reply(response, 200, result);
  });
});

server.listen(PORT, () => {
  if (!TOKEN) {
    // Refusing to run without a token is the only safe default: a sandbox
    // anything on the network can drive is not a sandbox.
    console.error("[sandbox] SANDBOX_TOKEN is not set. Refusing to accept work.");
  }
  console.log(`[sandbox] listening on ${PORT}`);
});
