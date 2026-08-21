/**
 * RUNNING ONE PIECE OF JAVASCRIPT.
 *
 * The architect writes the body of a function. It is handed `input` and returns
 * a value, and that value becomes what the next step reads.
 *
 * Everything removed below is removed to stop ACCIDENTS, not attacks. `vm` is
 * not a security boundary — the escapes are public — and this file does not
 * pretend to be one. The wall is the container: no network, no secrets, no
 * privileges, read-only disk. See README.md.
 *
 * What this file genuinely buys us is that ordinary mistakes fail immediately
 * and legibly. An architect who types `require("fs")` gets a clear sentence
 * instead of a confusing crash, and nobody reaches for `process.env` and
 * wonders why it is empty.
 */

import vm from "node:vm";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});

process.stdin.on("end", () => {
  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    say({ ok: false, error: "The sandbox could not read the code." });
    return;
  }

  const logs = [];

  /** What the architect's code can see. Everything else is absent. */
  const context = {
    input: request.input ?? {},

    // Their own console, so log lines come back with the result instead of
    // being lost. Someone debugging needs this more than anything else here.
    console: {
      log: (...args) => logs.push(args.map(render).join(" ")),
      info: (...args) => logs.push(args.map(render).join(" ")),
      warn: (...args) => logs.push(args.map(render).join(" ")),
      error: (...args) => logs.push(args.map(render).join(" "))
    },

    JSON,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Map,
    Set,
    Error,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,

    // Named explicitly so the message is a sentence rather than
    // "require is not defined", which sends people to Stack Overflow.
    require: () => {
      throw new Error("Other packages are not available here. This step can only work with what it is given.");
    },
    fetch: () => {
      throw new Error("This step cannot reach the internet. Use a connector step for that, and pass the result in here.");
    },
    process: undefined,
    globalThis: undefined,
    setTimeout: undefined,
    setInterval: undefined
  };

  try {
    const script = new vm.Script(`(function(input){ "use strict";\n${request.code}\n})`);
    const fn = script.runInNewContext(context, { timeout: 10_000, displayErrors: true });
    const output = fn(context.input);

    // What comes back has to survive the trip to the next step, so it must be
    // plain data. A function or a circular object is a mistake worth naming.
    let clean;
    try {
      clean = JSON.parse(JSON.stringify(output ?? null));
    } catch {
      say({
        ok: false,
        logs,
        error: "What your code returned cannot be passed to the next step. Return plain values — text, numbers, lists and objects."
      });
      return;
    }

    say({ ok: true, output: clean, logs });
  } catch (error) {
    say({ ok: false, logs, error: String(error?.message ?? error).slice(0, 1000) });
  }
});

function render(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** One line of JSON, last, so the service can find it after any output. */
function say(result) {
  process.stdout.write("\n" + JSON.stringify(result));
}
