import { describe, expect, it } from "vitest";
import { heartFromRecipe } from "./recipe-heart";

/**
 * A SETUP ANSWER MUST NOT CHOOSE WHOSE SERVER WE TALK TO (2026-08-27).
 *
 * A recipe's address can carry placeholders, and a business fills some of them
 * in on their own setup form. The private-address check refuses our own
 * network; nothing refused evil.com. So a business's answer could point the
 * request anywhere on the internet — and the ARCHITECT's API key travels in
 * the headers of that request. Somebody else's key, sent to a stranger's
 * server, by a value a third party typed into a form.
 *
 * The company is pinned. The parts an answer may fill can still vary.
 */

function declarationFor(url: string) {
  /* The real entry point takes a whole frame declaration, not a bare recipe.
     Getting this wrong is how three of these first "passed": they threw
     before they ever reached the check they were meant to exercise. */
  return {
    id: "acme",
    label: "Acme",
    provider: { name: "Acme" },
    produces: [{ key: "people", label: "People found", kind: "list" }],
    recipe: {
      url,
      method: "GET" as const,
      headers: { Authorization: "Bearer {{secret.apiKey}}" },
      resultsAt: "items"
    }
  } as unknown as Parameters<typeof heartFromRecipe>[0];
}

async function run(url: string, config: Record<string, string>) {
  const heart = heartFromRecipe(declarationFor(url));
  const seen: string[] = [];

  try {
    await heart({
      config,
      credentials: { apiKey: "sk-the-architects-own-key" },
      page: 1,
      pageSize: 25,
      cursor: null,
      log: () => {},
      http: async ({ url: called }: { url: string }) => {
        seen.push(called);
        return { status: 200, body: { items: [] }, headers: {} };
      }
    } as never);
    return { ok: true as const, seen, error: "" };
  } catch (error) {
    return { ok: false as const, seen, error: error instanceof Error ? error.message : String(error) };
  }
}

describe("a recipe talks to the company the architect declared", () => {
  it("refuses an answer that ends the host early and points somewhere else", async () => {
    /* The oldest trick in the book: a "#" (or a "/") closes the host, and
       everything the architect wrote after the placeholder becomes decoration
       on somebody else's address. */
    const result = await run("https://{{config.region}}.api.acme.com/v1/people", {
      region: "evil.com#"
    });

    expect(result.ok, "an answer must not be able to end the host early").toBe(false);
    /* And nothing was sent, so the key never left. */
    expect(result.seen).toEqual([]);
  });

  it("refuses an address swapped outright", async () => {
    const result = await run("https://{{config.host}}/v1/people", { host: "evil.com" });
    expect(result.ok).toBe(false);
    expect(result.seen).toEqual([]);
  });

  it("still lets an answer fill in a region or an account", async () => {
    const result = await run("https://{{config.region}}.api.acme.com/v1/people", { region: "eu" });

    expect(result.ok, result.error).toBe(true);
    expect(result.seen[0]).toContain("eu.api.acme.com");
  });

  it("still refuses an address inside our own network", async () => {
    const result = await run("https://{{config.host}}/v1/people", { host: "127.0.0.1" });
    expect(result.ok).toBe(false);
    expect(result.seen).toEqual([]);
  });
});
