import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * THE BUILDER'S EYES, UNDER LAW (2026-08-27).
 *
 * The founder's ruling: pictures reach the Builder the way they reach any
 * real colleague — and the architecture must survive a model swap. These
 * pin the parts that would rot quietly: the ceiling enforced on the SERVER
 * (a browser's word is not a limit), the refusal of linked addresses (an
 * http address here would be the platform fetching whatever a caller names
 * — the hole every SSRF guard exists to close), the per-provider eyes so no
 * upstream code knows which model can see, and the rule that a screenshot
 * is a question, never an order to rebuild a canvas.
 */

const read = (...parts: string[]) => readFileSync(join(__dirname, ...parts), "utf8");

describe("the Builder's eyes", () => {
  const routes = read("routes.ts");
  const brain = read("platform-brain.ts");
  const builder = read("ai-builder.ts");

  it("enforces five pictures and ten megabytes on the server, not in the browser", () => {
    expect(routes).toMatch(/\.max\(5,/);
    expect(routes).toContain("14_000_000");
  });

  it("takes pasted pictures only — never an address it would have to fetch", () => {
    expect(routes).toMatch(/\^data:image/);
  });

  it("takes its seeing model from the ADMIN, never from this code", () => {
    /* The lesson of the day it was born: a model name hard-coded here was
       wrong for the platform's key, and only a developer could fix it. */
    /* The word may appear in the comment that records the lesson; what must
       never return is a model name used as a VALUE. */
    expect(brain).not.toMatch(/model:\s*"[a-z0-9.-]+"/i);
    expect(brain).toContain("getBuilderEyesConfig()");
    expect(brain).toContain("seeingModel ?? FLAGSHIP.mistral");
  });

  it("refuses honestly when the chosen service cannot see, and names where to fix it", () => {
    expect(brain).toContain("serviceCanSee");
    expect(brain).toContain("The Builder's Eyes");
  });

  it("treats a screenshot as a question — never as an order to rebuild a canvas", () => {
    expect(builder).toContain('"explain"');
    expect(builder).toMatch(/images\?\.length \?\? 0\) > 0/);
  });

  it("teaches the Builder how a colleague reads a screenshot", () => {
    expect(builder).toContain("WHEN THEY SEND YOU A PICTURE");
    expect(builder).toContain("Never describe a picture you cannot make out");
  });
});
