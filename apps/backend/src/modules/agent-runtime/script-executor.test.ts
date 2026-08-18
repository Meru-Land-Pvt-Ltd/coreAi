import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { executeScript } from "./script-executor";

/** Python is optional on a dev machine; its cases skip rather than fail there. */
const pythonAvailable = (() => {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("Code node — JavaScript", () => {
  test("returns the script's value and captures console output", async () => {
    const result = await executeScript({
      language: "javascript",
      code: `console.log("hello", { a: 1 }); return { doubled: input.n * 2 };`,
      input: { n: 21 }
    });

    expect(result.status).toBe("success");
    expect(result.output).toEqual({ doubled: 42 });
    expect(result.logs).toEqual(['hello {"a":1}']);
  });

  test("supports await inside the script body", async () => {
    const result = await executeScript({
      language: "javascript",
      code: `const value = await Promise.resolve(input.name.toUpperCase()); return value;`,
      input: { name: "triven" }
    });

    expect(result.status).toBe("success");
    expect(result.output).toBe("TRIVEN");
  });

  test("reports a thrown error instead of failing the process", async () => {
    const result = await executeScript({
      language: "javascript",
      code: `throw new Error("boom");`
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("boom");
  });

  test("has no require, process, or fetch in scope", async () => {
    const result = await executeScript({
      language: "javascript",
      code: `return {
        require: typeof require,
        process: typeof process,
        fetch: typeof fetch
      };`
    });

    expect(result.status).toBe("success");
    expect(result.output).toEqual({ require: "undefined", process: "undefined", fetch: "undefined" });
  });

  test("stops a synchronous infinite loop at the timeout", async () => {
    const result = await executeScript({
      language: "javascript",
      code: `while (true) {}`,
      timeoutMs: 1_000
    });

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/timed out/i);
  });

  test("stops a script that never resolves", async () => {
    const result = await executeScript({
      language: "javascript",
      code: `await new Promise(() => {}); return 1;`,
      timeoutMs: 1_000
    });

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/timed out/i);
  });

  test("cannot mutate the caller's context object", async () => {
    const input = { business: { name: "Bright Smile" } };
    const result = await executeScript({
      language: "javascript",
      code: `input.business.name = "Hijacked"; return input.business.name;`,
      input
    });

    expect(result.status).toBe("success");
    expect(result.output).toBe("Hijacked");
    expect(input.business.name).toBe("Bright Smile");
  });

  test("survives a context containing cycles and buffers", async () => {
    const cyclic: Record<string, unknown> = { file: Buffer.from("pdf"), keep: "yes" };
    cyclic.self = cyclic;

    const result = await executeScript({
      language: "javascript",
      code: `return { keep: input.keep, file: input.file, self: input.self };`,
      input: cyclic
    });

    expect(result.status).toBe("success");
    expect(result.output).toMatchObject({ keep: "yes", file: "[Binary]", self: "[Circular]" });
  });

  test("rejects an empty script with an actionable message", async () => {
    const result = await executeScript({ language: "javascript", code: "   " });

    expect(result.status).toBe("error");
    expect(result.error).toContain("no code to run");
  });

  test("rejects an oversized return value", async () => {
    const result = await executeScript({
      language: "javascript",
      code: `return "x".repeat(300 * 1024);`
    });

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/larger than/i);
  });
});

describe.skipIf(!pythonAvailable)("Code node — Python", () => {
  test("publishes the `output` variable and captures print()", async () => {
    const result = await executeScript({
      language: "python",
      code: `print("checking", input["n"])\noutput = {"doubled": input["n"] * 2}`,
      input: { n: 21 }
    });

    expect(result.status).toBe("success");
    expect(result.output).toEqual({ doubled: 42 });
    expect(result.logs).toEqual(["checking 21"]);
  });

  test("falls back to a main(input) function when `output` is unset", async () => {
    const result = await executeScript({
      language: "python",
      code: `def main(data):\n    return sorted(data["items"])`,
      input: { items: ["c", "a", "b"] }
    });

    expect(result.status).toBe("success");
    expect(result.output).toEqual(["a", "b", "c"]);
  });

  test("reports a traceback line instead of hanging", async () => {
    const result = await executeScript({ language: "python", code: `raise ValueError("bad input")` });

    expect(result.status).toBe("error");
    expect(result.error).toContain("bad input");
  });

  test("cannot read the backend's environment", async () => {
    const result = await executeScript({
      language: "python",
      code: `import os\noutput = {"database": os.environ.get("DATABASE_URL"), "keys": [k for k in os.environ if "SECRET" in k or "KEY" in k]}`
    });

    expect(result.status).toBe("success");
    expect(result.output).toEqual({ database: null, keys: [] });
  });

  test("stops an infinite loop at the timeout", async () => {
    const result = await executeScript({
      language: "python",
      code: `while True:\n    pass`,
      timeoutMs: 1_500
    });

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/timed out/i);
  });
});
