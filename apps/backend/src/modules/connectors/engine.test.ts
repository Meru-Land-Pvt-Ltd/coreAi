import { describe, it, expect, vi } from "vitest";
import type { NodeFrame, HeartResult } from "@coreai/shared";
import { validateNodeFrame } from "@coreai/shared";
import { runConnector, checkConnectorHealth } from "./engine";

/**
 * The engine exists to make two things impossible: a connector that pretends it
 * worked, and a connector that spends without a ceiling. Everything else it
 * does is convenience; these two are the reason it exists at all.
 */

const base: Omit<NodeFrame, "heart"> = {
  id: "test.thing",
  version: "1.0.0",
  job: "custom",
  label: "Test connector",
  description: "For tests.",
  provider: {
    name: "TestCo",
    docsUrl: "https://example.com/docs",
    apiVersion: "v1",
    lastVerified: "2026-08-19"
  },
  needs: { platform: [], architect: [], business: [], accounts: [] },
  produces: [{ key: "things", label: "Things", kind: "list", required: true, sample: [] }],
  cost: { style: "per_call", estimateCents: 5, unit: "per call", billedTo: "platform" },
  failure: {
    onError: "retry",
    maxRetries: 2,
    backoffMs: 1,
    neverRetry: [401, 402],
    humanMessage: "TestCo could not be reached."
  },
  limits: { callsPerMinute: 100, callsPerDay: 1000, concurrent: 2, pageSize: 10, maxPages: 3 },
  rules: {},
  health: { everyHours: 24, expectKeys: ["things"], severity: "breaks-agents" },
  execution: "immediate",
  rollout: "everyone"
};

const make = (
  heart: NodeFrame["heart"],
  overrides: Partial<NodeFrame> = {}
): NodeFrame => ({ ...base, heart, ...overrides });

const run = (contract: NodeFrame, extra: Record<string, unknown> = {}) =>
  runConnector({
    contract,
    // A fresh business per test, so one test's rate-limit counters can never
    // change another test's answer.
    businessId: `biz-${Math.random().toString(36).slice(2)}`,
    config: {},
    ...extra
  });

describe("a connector cannot pretend it worked", () => {
  it("refuses a success that is missing what the contract promised", async () => {
    // This is the exact shape of the calendar bug: an empty answer, reported
    // green, and a real customer booked into a slot that never existed.
    const result = await run(make(async () => ({ outputs: {} })));

    expect(result.ok).toBe(false);
    expect(result.code).toBe("dishonest_result");
    expect(result.outputs).toEqual({});
  });

  it("refuses an empty string where a value was required", async () => {
    const contract = make(async () => ({ outputs: { name: "  " } }), {
      produces: [{ key: "name", label: "Name", kind: "text", required: true, sample: "x" }]
    });
    expect((await run(contract)).code).toBe("dishonest_result");
  });

  it("accepts a genuinely empty LIST — finding nothing is a real answer", async () => {
    // "No leads matched" and "the provider is broken" must never collapse into
    // the same outcome.
    const result = await run(make(async () => ({ outputs: { things: [] } })));
    expect(result.ok).toBe(true);
    expect(result.outputs.things).toEqual([]);
  });
});

describe("failure", () => {
  it("retries a server error, then succeeds", async () => {
    let calls = 0;
    const heart = vi.fn(async (): Promise<HeartResult> => {
      calls += 1;
      if (calls < 3) {
        const error = new Error("boom") as Error & { status: number };
        error.status = 500;
        throw error;
      }
      return { outputs: { things: [1] } };
    });

    const result = await run(make(heart));
    expect(result.ok).toBe(true);
    expect(heart).toHaveBeenCalledTimes(3);
  });

  it("never retries a wrong key — it will still be wrong the fourth time", async () => {
    const heart = vi.fn(async () => {
      const error = new Error("unauthorised") as Error & { status: number };
      error.status = 401;
      throw error;
    });

    const result = await run(make(heart));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("provider_error");
    expect(heart).toHaveBeenCalledTimes(1);
  });

  it("never retries when credits have run out", async () => {
    // Retrying a 402 four times is just four times the bill.
    const heart = vi.fn(async () => {
      const error = new Error("payment required") as Error & { status: number };
      error.status = 402;
      throw error;
    });
    await run(make(heart));
    expect(heart).toHaveBeenCalledTimes(1);
  });

  it("tells the business something true when it gives up", async () => {
    const result = await run(
      make(async () => {
        throw new Error("down");
      })
    );
    expect(result.message).toContain("could not be reached");
    // The one thing it must never say is that something happened.
    expect(result.outputs).toEqual({});
  });
});

describe("paging", () => {
  it("gathers every page into one answer", async () => {
    const heart = async ({ page }: { page: number }): Promise<HeartResult> => ({
      outputs: { things: [`page-${page}`] },
      morePages: page < 3
    });

    const result = await run(make(heart, { execution: "paged" }));
    expect(result.pagesFetched).toBe(3);
    expect(result.outputs.things).toEqual(["page-1", "page-2", "page-3"]);
  });

  it("stops at the page ceiling so a runaway list cannot spend forever", async () => {
    const heart = async ({ page }: { page: number }): Promise<HeartResult> => ({
      outputs: { things: [page] },
      morePages: true // never satisfied
    });

    const result = await run(make(heart, { execution: "paged" }));
    expect(result.pagesFetched).toBe(3); // maxPages
  });
});

describe("money and limits", () => {
  it("stops before spending past the daily budget", async () => {
    const contract = make(async () => ({ outputs: { things: [1] } }));
    const businessId = `biz-budget-${Math.random().toString(36).slice(2)}`;

    // Budget of 10c against a 5c call: the third attempt must be refused.
    const one = await runConnector({ contract, businessId, config: {}, budgetCents: 10 });
    const two = await runConnector({ contract, businessId, config: {}, budgetCents: 10 });
    const three = await runConnector({ contract, businessId, config: {}, budgetCents: 10 });

    expect(one.ok).toBe(true);
    expect(two.ok).toBe(true);
    expect(three.ok).toBe(false);
    expect(three.code).toBe("budget_exceeded");
  });

  it("refuses to run past a hard daily cap, whatever the business set", async () => {
    const contract = make(async () => ({ outputs: { things: [1] } }), {
      rules: { hardDailyCap: 1 }
    });
    const businessId = `biz-cap-${Math.random().toString(36).slice(2)}`;

    expect((await runConnector({ contract, businessId, config: {} })).ok).toBe(true);
    const second = await runConnector({ contract, businessId, config: {} });
    expect(second.ok).toBe(false);
    expect(second.code).toBe("blocked_by_rule");
  });

  it("throttles to the provider's rate rather than failing against it", async () => {
    const contract = make(async () => ({ outputs: { things: [1] } }), {
      limits: { ...base.limits, callsPerMinute: 1 }
    });
    const businessId = `biz-rate-${Math.random().toString(36).slice(2)}`;

    expect((await runConnector({ contract, businessId, config: {} })).ok).toBe(true);
    expect((await runConnector({ contract, businessId, config: {} })).code).toBe("rate_limited");
  });
});

describe("credentials", () => {
  it("says plainly when a key has never been set, and never calls out", async () => {
    const heart = vi.fn(async () => ({ outputs: { things: [1] } }));
    const contract = make(heart, {
      needs: {
        ...base.needs,
        platform: [
          { key: "MISSING_KEY_XYZ", label: "TestCo key", kind: "api_key", help: "", required: true }
        ]
      }
    });

    const result = await run(contract);
    expect(result.code).toBe("missing_credential");
    expect(result.message).toContain("not connected yet");
    expect(heart).not.toHaveBeenCalled();
  });

  it("prefers a key the business supplied over the platform's own", async () => {
    let seen = "";
    const contract = make(async ({ credentials }) => {
      seen = credentials.MISSING_KEY_XYZ ?? "";
      return { outputs: { things: [1] } };
    }, {
      needs: {
        ...base.needs,
        platform: [
          { key: "MISSING_KEY_XYZ", label: "TestCo key", kind: "api_key", help: "", required: true }
        ]
      }
    });

    await run(contract, { config: { MISSING_KEY_XYZ: "theirs" } });
    expect(seen).toBe("theirs");
  });
});

describe("the daily self-test", () => {
  it("reports a changed API when an expected field disappears", async () => {
    const contract = make(async () => ({ outputs: { things: [1] } }), {
      probe: async () => ({ outputs: { somethingElse: true } })
    });

    const health = await checkConnectorHealth(contract);
    expect(health.healthy).toBe(false);
    expect(health.missingKeys).toEqual(["things"]);
    // The message must point a maintainer at the docs and the version.
    expect(health.message).toContain("v1");
    expect(health.message).toContain("example.com/docs");
  });

  it("does not cry wolf when nobody has configured a key", async () => {
    const contract = make(async () => ({ outputs: { things: [1] } }), {
      needs: {
        ...base.needs,
        platform: [
          { key: "MISSING_KEY_XYZ", label: "TestCo key", kind: "api_key", help: "", required: true }
        ]
      },
      probe: async () => ({ outputs: { things: [1] } })
    });

    const health = await checkConnectorHealth(contract);
    // An alarm that fires every day until someone stops listening is worse
    // than no alarm.
    expect(health.healthy).toBe(true);
    expect(health.message).toContain("no key configured");
  });

  it("passes when the provider still answers in the shape we expect", async () => {
    const contract = make(async () => ({ outputs: { things: [1] } }), {
      probe: async () => ({ outputs: { things: [1] } })
    });
    expect((await checkConnectorHealth(contract)).healthy).toBe(true);
  });
});

describe("a badly-formed connector never ships", () => {
  it("rejects one with no required output — success and silence would be identical", () => {
    const problems = validateNodeFrame(
      make(async () => ({ outputs: {} }), {
        produces: [{ key: "maybe", label: "Maybe", kind: "text", required: false, sample: "x" }]
      })
    );
    expect(problems.join(" ")).toContain("at least one output must be required");
  });

  it("rejects paged work with no ceiling", () => {
    const problems = validateNodeFrame(
      make(async () => ({ outputs: { things: [] } }), {
        execution: "paged",
        limits: { ...base.limits, maxPages: undefined }
      })
    );
    expect(problems.join(" ")).toContain("page ceiling");
  });

  it("rejects a secret asked of the architect", () => {
    const problems = validateNodeFrame(
      make(async () => ({ outputs: { things: [] } }), {
        needs: {
          ...base.needs,
          architect: [{ key: "apiKey", label: "Key", help: "", kind: "secret", required: true }]
        }
      })
    );
    expect(problems.join(" ")).toContain("Secrets belong in platform needs");
  });

  it("rejects a connector with no provider version, so deprecations stay traceable", () => {
    const problems = validateNodeFrame(
      make(async () => ({ outputs: { things: [] } }), {
        provider: { ...base.provider, apiVersion: "" }
      })
    );
    expect(problems.join(" ")).toContain("API version");
  });
});
