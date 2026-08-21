/**
 * The harness, tested by running it the way the service runs it.
 *
 * Run with: node --test apps/sandbox/harness.test.mjs
 *
 * Named explicitly, not the directory — `node --test apps/sandbox/` picks up
 * server.mjs, which starts a listening server and never exits.
 *
 * These are not security tests — no test in a language can prove a language
 * sandbox holds, and README.md is explicit that it does not. These check the
 * other half: that what an architect writes comes back correctly, and that a
 * wrong answer is never handed over as if it were right.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function runJs(code, input = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", [join(HERE, "harness.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", () => {
      const lastLine = out.trim().split("\n").pop() ?? "{}";
      resolve(JSON.parse(lastLine));
    });
    child.stdin.end(JSON.stringify({ code, input }));
  });
}

test("hands back what the code returns", async () => {
  const result = await runJs("return { doubled: input.n * 2 };", { n: 21 });
  assert.deepEqual(result, { ok: true, output: { doubled: 42 }, logs: [] });
});

test("waits for a promise instead of returning an empty object", async () => {
  // This shipped broken. `return Promise.resolve({answer: 42})` came back as
  // {ok: true, output: {}} — a wrong answer handed to the next step with every
  // appearance of having worked, which is the one failure this platform does
  // not tolerate anywhere.
  const result = await runJs("return Promise.resolve({ answer: 42 });");
  assert.deepEqual(result.output, { answer: 42 });
});

test("supports await, because people will write it", async () => {
  const result = await runJs("const x = await Promise.resolve(20); return { sum: x + input.b };", { b: 22 });
  assert.deepEqual(result.output, { sum: 42 });
});

test("a mistake comes back as a sentence, not a stack trace", async () => {
  const result = await runJs('throw new Error("my mistake");');
  assert.equal(result.ok, false);
  assert.equal(result.error, "my mistake");
});

test("an async mistake is caught too", async () => {
  const result = await runJs('await Promise.reject(new Error("later mistake"));');
  assert.equal(result.ok, false);
  assert.match(result.error, /later mistake/);
});

test("console output comes back so somebody can debug their own step", async () => {
  const result = await runJs('console.log("halfway", { n: 1 }); return 1;');
  assert.deepEqual(result.logs, ['halfway {"n":1}']);
});

test("says plainly that there is no internet here", async () => {
  const result = await runJs('return fetch("https://example.com");');
  assert.equal(result.ok, false);
  assert.match(result.error, /cannot reach the internet/);
});

test("says plainly that there are no packages here", async () => {
  const result = await runJs('return require("fs");');
  assert.equal(result.ok, false);
  assert.match(result.error, /not available here/);
});

test("refuses to pass on something the next step could not read", async () => {
  // Returned as a refusal rather than quietly becoming null.
  const result = await runJs("return () => 1;");
  assert.equal(result.ok, false);
  assert.match(result.error, /cannot be passed to the next step/);
});

test("returning nothing is fine and says so", async () => {
  const result = await runJs("const x = 1;");
  assert.equal(result.ok, true);
  assert.equal(result.output, null);
});
