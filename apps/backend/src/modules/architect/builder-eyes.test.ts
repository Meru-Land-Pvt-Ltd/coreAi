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

  it("keeps the seeing model in ONE place, so a provider swap changes nothing upstream", () => {
    expect(brain).toContain("const VISION");
    for (const provider of ["mistral", "claude", "openai"]) {
      expect(brain).toContain(`${provider}:`);
    }
    /* The choice of eyes lives at the request, not at the call sites. */
    expect(brain).toContain("images.length > 0 ? VISION.mistral : FLAGSHIP.mistral");
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
