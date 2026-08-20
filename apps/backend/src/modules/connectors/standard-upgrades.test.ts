import { describe, it, expect, vi } from "vitest";
import {
  checkConnectorRules,
  validateConnector,
  type ConnectorContract,
  type BuyerContract
} from "@coreai/shared";
import { runConnector, checkConnectorHealth } from "./engine";
import { sealBuyerAnswers, openBuyerAnswers, maskBuyerAnswers, SECRET_PLACEHOLDER } from "./buyer-secrets";
import { connectorBudgetCentsFor, DEFAULT_CONNECTOR_DAILY_BUDGET_CENTS } from "./budget";
import { instantlyAddLeads, instantlyReplies } from "./catalogue/instantly";

/**
 * The three things an audit found the engine CLAIMED to do and did not:
 * enforce its safety rules, keep a spending ceiling, and protect a business's
 * own API key. Plus the new shape of work — a provider knocking on our door.
 *
 * Each test here exists because the real thing was broken, not because the
 * code path looked interesting.
 */

const base: Omit<ConnectorContract, "heart"> = {
  id: "test.thing",
  version: "1.0.0",
  job: "custom",
  label: "Test connector",
  description: "For tests.",
  provider: { name: "TestCo", docsUrl: "https://example.com/docs", apiVersion: "v1", lastVerified: "2026-08-20" },
  needs: { platform: [], architect: [], business: [], accounts: [] },
  produces: [{ key: "things", label: "Things", kind: "list", required: true, sample: [] }],
  cost: { style: "per_call", estimateCents: 5, unit: "per call", billedTo: "platform" },
  failure: { onError: "retry", maxRetries: 0, backoffMs: 1, neverRetry: [], humanMessage: "TestCo is down." },
  limits: { callsPerMinute: 100, callsPerDay: 1000, concurrent: 2, pageSize: 10, maxPages: 3 },
  rules: {},
  health: { everyHours: 24, expectKeys: ["things"], severity: "breaks-agents" },
  execution: "immediate",
  rollout: "everyone"
};

const make = (overrides: Partial<ConnectorContract> = {}): ConnectorContract => ({
  ...base,
  heart: async () => ({ outputs: { things: [1] } }),
  ...overrides
});

const freshBiz = () => `biz-${Math.random().toString(36).slice(2)}`;

/* ========================================================================== */

describe("the safety rules are enforced, not just displayed", () => {
  const dialer = make({
    rules: { requiresConsent: true },
    needs: { ...base.needs, business: [{ key: "consentConfirmed", label: "Agreed?", help: "", kind: "choice", required: true }] }
  });

  it("refuses to run when the business answered No", async () => {
    // The exact hole: the question appeared on the form, the business could
    // answer "No — nobody agreed", and the connector ran anyway.
    const result = await runConnector({
      contract: dialer,
      businessId: freshBiz(),
      config: { consentConfirmed: "No" }
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("blocked_by_rule");
    expect(result.message).toContain("agreed to be contacted");
  });

  it("refuses when the question was never answered at all", async () => {
    const result = await runConnector({ contract: dialer, businessId: freshBiz(), config: {} });
    expect(result.code).toBe("blocked_by_rule");
  });

  it("runs once the business has confirmed", async () => {
    const result = await runConnector({
      contract: dialer,
      businessId: freshBiz(),
      config: { consentConfirmed: "Yes — every person agreed" }
    });
    expect(result.ok).toBe(true);
  });

  it("never reaches the provider when a rule refuses", async () => {
    const heart = vi.fn(async () => ({ outputs: { things: [1] } }));
    await runConnector({ contract: make({ ...dialer, heart }), businessId: freshBiz(), config: {} });
    expect(heart).not.toHaveBeenCalled();
  });

  it("demands a way out of every message when the connector says it must", () => {
    const mailer = make({
      rules: { requiresUnsubscribe: true, unsubscribeIn: ["body"] },
      needs: { ...base.needs, business: [{ key: "body", label: "Message", help: "", kind: "longtext", required: true }] }
    });

    expect(checkConnectorRules(mailer, { config: { body: "Hi there, buy my thing." }, isTest: false }).ok).toBe(false);
    expect(
      checkConnectorRules(mailer, { config: { body: "Hi there. Reply STOP to unsubscribe." }, isTest: false }).ok
    ).toBe(true);
  });

  it("refuses a number in a blocked country", () => {
    const caller = make({
      rules: { blockedCountries: ["IN"], reaches: ["phones"] },
      needs: { ...base.needs, business: [{ key: "phones", label: "Who", help: "", kind: "list", required: true }] }
    });

    expect(checkConnectorRules(caller, { config: { phones: ["+919309185238"] }, isTest: false }).ok).toBe(false);
    expect(checkConnectorRules(caller, { config: { phones: ["+16505551234"] }, isTest: false }).ok).toBe(true);
  });

  it("treats a country it cannot identify as blocked, not as allowed", () => {
    // A blocklist exists because reaching the wrong country is a legal
    // problem, and "we could not tell" has never been a defence.
    const caller = make({
      rules: { blockedCountries: ["IN"], reaches: ["phones"] },
      needs: { ...base.needs, business: [{ key: "phones", label: "Who", help: "", kind: "list", required: true }] }
    });
    expect(checkConnectorRules(caller, { config: { phones: ["+99912345678"] }, isTest: false }).ok).toBe(false);
  });

  it("no longer needs a rule to keep a rehearsal safe", async () => {
    // There used to be a testOnlyToVerifiedIdentity rule here. It is gone
    // because the engine now answers a rehearsal from the contract's own
    // declared samples and never calls the heart — so a test cannot reach
    // anybody, whatever the connector does or forgets to do.
    const heart = vi.fn(async () => ({ outputs: { things: [1] } }));
    const result = await runConnector({
      contract: make({ heart }),
      businessId: freshBiz(),
      isTest: true,
      config: {}
    });

    expect(result.ok).toBe(true);
    expect(heart).not.toHaveBeenCalled();
    expect(result.costCents).toBe(0);
  });

});

describe("a rule that cannot be checked cannot ship", () => {
  it("rejects an unsubscribe rule with nowhere to look", () => {
    const problems = validateConnector(make({ rules: { requiresUnsubscribe: true } }));
    expect(problems.join(" ")).toContain("unsubscribeIn");
  });

  it("rejects a country block with nowhere to look", () => {
    const problems = validateConnector(make({ rules: { blockedCountries: ["IN"] } }));
    expect(problems.join(" ")).toContain("reaches");
  });

  it("rejects a rule aimed at a key the connector never has", () => {
    // A rule pointed at nothing passes every time, which is worse than no rule
    // because it reads as protection.
    const problems = validateConnector(
      make({ rules: { requiresUnsubscribe: true, unsubscribeIn: ["nowhere"] } })
    );
    expect(problems.join(" ")).toContain("never asks for or produces");
  });
});

describe("the spending ceiling is a ceiling", () => {
  it("counts money, not attempts", async () => {
    // It used to tick once per call while charging per result, so a 20c
    // ceiling really allowed several dollars.
    const contract = make({
      cost: { style: "per_result", estimateCents: 3, unit: "each", billedTo: "business" },
      limits: { ...base.limits, pageSize: 25 },
      heart: async () => ({ outputs: { things: Array.from({ length: 25 }, (_, i) => i) }, unitsUsed: 25 })
    });
    const businessId = freshBiz();

    // 25 results at 3c = 75c per call. A 200c ceiling must allow two, not many.
    const one = await runConnector({ contract, businessId, config: {}, budgetCents: 200 });
    const two = await runConnector({ contract, businessId, config: {}, budgetCents: 200 });
    const three = await runConnector({ contract, businessId, config: {}, budgetCents: 200 });

    expect(one.ok).toBe(true);
    expect(two.ok).toBe(true);
    expect(three.code).toBe("budget_exceeded");
  });

  it("gives back what it reserved and did not spend", async () => {
    // Reserving the worst case is what makes a ceiling safe; not refunding it
    // would make every small run cost a full page.
    const contract = make({
      cost: { style: "per_result", estimateCents: 3, unit: "each", billedTo: "business" },
      limits: { ...base.limits, pageSize: 25 },
      heart: async () => ({ outputs: { things: [1] }, unitsUsed: 1 })
    });
    const businessId = freshBiz();

    // Each run really costs 3c. On a 200c ceiling that is 60+ runs, which is
    // only true if the 75c reservation comes back each time.
    for (let i = 0; i < 10; i++) {
      const result = await runConnector({ contract, businessId, config: {}, budgetCents: 200 });
      expect(result.ok).toBe(true);
    }
  });

  it("charges nothing when the provider never answered", async () => {
    const contract = make({
      cost: { style: "per_result", estimateCents: 3, unit: "each", billedTo: "business" },
      limits: { ...base.limits, pageSize: 25 },
      heart: async () => {
        throw new Error("down");
      }
    });
    const businessId = freshBiz();

    for (let i = 0; i < 5; i++) {
      const result = await runConnector({ contract, businessId, config: {}, budgetCents: 200 });
      expect(result.code).toBe("provider_error");
    }
    // A failing provider must not eat the day's budget.
    const after = await runConnector({
      contract: make({ cost: { style: "per_call", estimateCents: 1, unit: "x", billedTo: "business" } }),
      businessId,
      config: {},
      budgetCents: 200
    });
    expect(after.ok).toBe(true);
  });

  it("gives every business a real ceiling by default, never 'unlimited'", () => {
    expect(connectorBudgetCentsFor(null)).toBe(DEFAULT_CONNECTOR_DAILY_BUDGET_CENTS);
    expect(connectorBudgetCentsFor({})).toBe(DEFAULT_CONNECTOR_DAILY_BUDGET_CENTS);
    expect(connectorBudgetCentsFor({ connectorDailyBudgetCents: 10_000 })).toBe(10_000);
    // A zero in a config box is far more often a mistake than a decision.
    expect(connectorBudgetCentsFor({ connectorDailyBudgetCents: 0 })).toBe(DEFAULT_CONNECTOR_DAILY_BUDGET_CENTS);
    expect(connectorBudgetCentsFor({ connectorDailyBudgetCents: -5 })).toBe(DEFAULT_CONNECTOR_DAILY_BUDGET_CENTS);
  });
});

describe("a business's own API key", () => {
  const contract = {
    inputs: [
      { key: "MY_KEY", label: "Key", help: "", kind: "secret", required: false, nodeIds: [] },
      { key: "campaignId", label: "Campaign", help: "", kind: "text", required: true, nodeIds: [] }
    ]
  } as unknown as BuyerContract;

  it("is never written in the clear", () => {
    const sealed = sealBuyerAnswers(contract, { MY_KEY: "sk-live-secret", campaignId: "abc" });
    expect(String(sealed.MY_KEY)).not.toContain("sk-live-secret");
    expect(sealed.campaignId).toBe("abc"); // ordinary answers are untouched
  });

  it("comes back only at the moment it is used", () => {
    const sealed = sealBuyerAnswers(contract, { MY_KEY: "sk-live-secret" });
    expect(openBuyerAnswers(contract, sealed).MY_KEY).toBe("sk-live-secret");
  });

  it("is never sent back to the browser", () => {
    const sealed = sealBuyerAnswers(contract, { MY_KEY: "sk-live-secret" });
    expect(maskBuyerAnswers(contract, sealed).MY_KEY).toBe(SECRET_PLACEHOLDER);
  });

  it("survives a save where the business did not retype it", () => {
    // The form shows dots. Pressing save must not encrypt the dots and destroy
    // a working key — the business would only find out when the agent stopped.
    const first = sealBuyerAnswers(contract, { MY_KEY: "sk-live-secret" });
    const second = sealBuyerAnswers(contract, { MY_KEY: SECRET_PLACEHOLDER }, first);
    expect(openBuyerAnswers(contract, second).MY_KEY).toBe("sk-live-secret");
  });

  it("re-seals a key written before this existed, without losing it", () => {
    const legacy = { MY_KEY: "plain-text-from-before" };
    expect(openBuyerAnswers(contract, legacy).MY_KEY).toBe("plain-text-from-before");
    const sealed = sealBuyerAnswers(contract, legacy);
    expect(String(sealed.MY_KEY)).not.toContain("plain-text-from-before");
  });
});

/* ========================================================================== */

describe("Instantly", () => {
  it("registered clean, both halves", () => {
    expect(validateConnector(instantlyAddLeads)).toEqual([]);
    expect(validateConnector(instantlyReplies)).toEqual([]);
  });

  it("asks the business for permission before it will add anyone", async () => {
    const result = await runConnector({
      contract: instantlyAddLeads,
      businessId: freshBiz(),
      config: { campaignId: "c1", leads: [{ email: "a@b.com" }], INSTANTLY_API_KEY: "k" }
    });
    expect(result.code).toBe("blocked_by_rule");
  });

  it("never touches Instantly during a rehearsal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await runConnector({
      contract: instantlyAddLeads,
      businessId: freshBiz(),
      isTest: true,
      config: {
        campaignId: "c1",
        consentConfirmed: "Yes — every person agreed",
        INSTANTLY_API_KEY: "k",
        leads: [{ email: "a@b.com", name: "A B", company: "AB Ltd" }]
      }
    });

    expect(result.ok).toBe(true);
    // A rehearsal that queued a real person would become a real email hours
    // later, with nobody watching.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("takes leads however the previous step produced them", async () => {
    const shapes: unknown[] = [
      [{ email: "a@b.com", name: "A B", company: "AB" }],
      ["a@b.com", "c@d.com"],
      "a@b.com\nc@d.com"
    ];
    for (const leads of shapes) {
      const result = await runConnector({
        contract: instantlyAddLeads,
        businessId: freshBiz(),
        isTest: true,
        config: { campaignId: "c1", consentConfirmed: "Yes", INSTANTLY_API_KEY: "k", leads }
      });
      expect(result.ok).toBe(true);
    }
  });

  it("finding nobody to add is a real answer, not a failure", async () => {
    const result = await runConnector({
      contract: instantlyAddLeads,
      businessId: freshBiz(),
      config: { campaignId: "c1", consentConfirmed: "Yes", INSTANTLY_API_KEY: "k", leads: [] }
    });
    // The step ran and there was nobody to add. That is not the same as a
    // broken provider, and must never be recorded as one.
    expect(result.ok).toBe(true);
    expect(result.outputs.leadsAdded).toEqual([]);
  });
});

describe("Instantly replies — the knock", () => {
  const receive = instantlyReplies.receive!;
  const ctx = (over: Record<string, unknown> = {}) => ({
    rawBody: "",
    body: {},
    headers: {},
    config: {},
    credentials: {},
    secret: "the-secret",
    log: () => undefined,
    ...over
  });

  it("refuses a delivery that cannot prove it is from Instantly", () => {
    expect(() => receive(ctx({ headers: { "x-triven-secret": "wrong" } }))).toThrow();
    // Nothing sent at all must fail too — a missing header is not a pass.
    expect(() => receive(ctx({ headers: {} }))).toThrow();
  });

  it("refuses when this install has no secret, rather than letting it through", () => {
    expect(() => receive(ctx({ secret: "", headers: {} }))).toThrow();
  });

  it("acknowledges and ignores the events nobody asked for", () => {
    const result = receive(
      ctx({ headers: { "x-triven-secret": "the-secret" }, body: { event_type: "email_opened" } })
    ) as { accepted: boolean };
    // An open is not a reason to wake up a workflow.
    expect(result.accepted).toBe(false);
  });

  it("starts the agent on a real reply, with named values", () => {
    const result = receive(
      ctx({
        headers: { "x-triven-secret": "the-secret" },
        body: {
          event_type: "reply_received",
          lead_email: "priya@brightsmiledental.com",
          reply_text: "Sounds interesting — send pricing?",
          campaign_name: "Dental — California",
          id: "evt_123"
        }
      })
    ) as { accepted: boolean; outputs: Record<string, unknown>; eventId?: string };

    expect(result.accepted).toBe(true);
    expect(result.outputs.leadEmail).toBe("priya@brightsmiledental.com");
    expect((result.outputs.reply as { text: string }).text).toContain("pricing");
    // Providers retry; without a stable id the agent answers twice.
    expect(result.eventId).toBe("evt_123");
  });

  it("ignores a reply with no address rather than starting a run it cannot use", () => {
    const result = receive(
      ctx({ headers: { "x-triven-secret": "the-secret" }, body: { event_type: "reply_received" } })
    ) as { accepted: boolean };
    expect(result.accepted).toBe(false);
  });
});

/* ========================================================================== */
/* The conventions a fresh writer got wrong, now caught by the machinery       */
/* ========================================================================== */

describe("what the factory test found", () => {
  it("gives a heart a client whose errors carry the status", async () => {
    // A fresh model wrote `throw new Error("Failed: " + statusText)`. That
    // reads fine and hides the one fact the engine needs, so it retried a
    // wrong API key on every run. context.http makes that impossible.
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as typeof fetch;

    let seen: unknown = "none";
    const contract = make({
      failure: { ...base.failure, maxRetries: 3, neverRetry: [401] },
      heart: async (context) => {
        try {
          await context.http.get("https://example.com/thing");
        } catch (error) {
          seen = (error as { status?: unknown }).status;
          throw error;
        }
        return { outputs: { things: [] } };
      }
    });

    const result = await runConnector({ contract, businessId: freshBiz(), config: {} });
    globalThis.fetch = original;

    expect(seen).toBe(401);
    expect(result.code).toBe("provider_error");
  });

  it("does not retry a wrong key, because the status came through", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("nope", { status: 401 });
    }) as typeof fetch;

    await runConnector({
      contract: make({
        failure: { ...base.failure, maxRetries: 3, neverRetry: [401] },
        heart: async (context) => {
          await context.http.get("https://example.com/thing");
          return { outputs: { things: [] } };
        }
      }),
      businessId: freshBiz(),
      config: {}
    });
    globalThis.fetch = original;

    expect(calls).toBe(1);
  });

  it("counts what a run produced even when the heart forgets to say", async () => {
    // A fresh model never set unitsUsed. A per-result ceiling would then count
    // one per call instead of one per result, and stop being a ceiling.
    const contract = make({
      cost: { style: "per_result", estimateCents: 10, unit: "each", billedTo: "business" },
      limits: { ...base.limits, pageSize: 4 },
      heart: async () => ({ outputs: { things: [1, 2, 3, 4] } }) // no unitsUsed
    });

    const result = await runConnector({ contract, businessId: freshBiz(), config: {} });
    expect(result.costCents).toBe(40);
  });

  it("refuses a connector whose self-test is just the heart again", () => {
    const heart = async () => ({ outputs: { things: [1] } });
    const problems = validateConnector(make({ heart, probe: heart }));
    expect(problems.join(" ")).toContain("same function as the heart");
  });

  it("refuses a heart that reaches the network on its own", () => {
    const problems = validateConnector(
      make({
        heart: async () => {
          await fetch("https://example.com");
          return { outputs: { things: [] } };
        }
      })
    );
    expect(problems.join(" ")).toContain("context.http");
  });

  it("refuses an invented or malformed lastVerified", () => {
    const problems = validateConnector(
      make({ provider: { ...base.provider, lastVerified: "sometime in 2023" } })
    );
    expect(problems.join(" ")).toContain("lastVerified");
  });

  it("still accepts the connectors we ship", () => {
    // The rules above are only worth having if the real files pass them.
    for (const contract of [instantlyAddLeads, instantlyReplies]) {
      expect(validateConnector(contract)).toEqual([]);
    }
  });
});

describe("a connector may say honestly that it cannot self-test", () => {
  it("reports unchecked with the reason, not broken", async () => {
    // Notion has no call that works without a customer's own database id. A
    // writer with no way to say that invents a plausible literal, and the
    // daily check then 404s every morning until nobody reads the alerts.
    const contract = make({
      probe: async () => ({ cannotSelfTest: "every read needs a database id belonging to a business" })
    });

    const health = await checkConnectorHealth(contract);
    expect(health.healthy).toBe(true);
    expect(health.message).toContain("database id belonging to a business");
  });

  it("gives a probe no config at all, so it cannot depend on one", async () => {
    // The type has no `config`, which is what makes this impossible to get
    // wrong rather than merely discouraged.
    let seen: string[] = [];
    await checkConnectorHealth(
      make({
        probe: async (context) => {
          seen = Object.keys(context);
          return { outputs: { things: [] } };
        }
      })
    );
    expect(seen.sort()).toEqual(["credentials", "http", "log"]);
  });
});
