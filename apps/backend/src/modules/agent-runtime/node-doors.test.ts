import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_CALL_NODE_TYPE,
  BLOCK_NODE_TYPES,
  CALENDLY_NODE_TYPES,
  DOOR_BEARING_NODE_TYPES,
  TELEGRAM_NODE_TYPES,
  VOICE_NODE_TYPES,
  getNodeDefinition,
  getNodeDoors,
  hasNodeDoors,
  nodeDoorsEnabled
} from "@coreai/shared";

/**
 * THE TWO DOORS — the engine behind the AI entry and exit doors built inside a
 * node.
 *
 * The contract these tests defend, in order of importance:
 *   1. a door NEVER breaks a run — failure, timeout, nonsense and an exhausted
 *      budget all mean "no change", and the node proceeds exactly as today;
 *   2. a door never touches the saved graph, a credential field, or a setting
 *      the node does not have;
 *   3. a door is skipped whenever it could not have helped, so no run pays for
 *      a call it did not need.
 *
 * The provider engine is mocked, so nothing here talks to a model or a database.
 */

const { getDoorBrainConfigMock, executeWithProviderMock, resolveProviderMock } = vi.hoisted(() => ({
  getDoorBrainConfigMock: vi.fn(),
  executeWithProviderMock: vi.fn(),
  resolveProviderMock: vi.fn()
}));

vi.mock("../admin/door-brain-settings", () => ({
  getDoorBrainConfig: getDoorBrainConfigMock
}));
vi.mock("../ai-provider-engine/provider-engine", () => ({
  getProviderEngine: () => ({ executeWithProvider: executeWithProviderMock })
}));
vi.mock("../ai-provider-engine/llm-credentials", () => ({
  resolveConfiguredLlmProvider: resolveProviderMock
}));
vi.mock("../ai-provider-engine/llm-health", () => ({
  recordLlmProviderFailure: vi.fn(),
  recordLlmProviderSuccess: vi.fn()
}));

import {
  DOOR_TIMEOUT_MS,
  createDoorBudget,
  entryDoorShouldRun,
  exitDoorShouldRun,
  presentationDoorShouldRun,
  runEntryDoor,
  runExitDoor,
  runPresentationDoor,
  type DoorContext,
  type DoorNode
} from "./node-doors";

/* -------------------------------- fixtures -------------------------------- */

/** Minimal provider reply — only these fields are read by the engine. */
function reply(text: string) {
  return { status: "success" as const, text, structuredOutput: null, error: null };
}

function apiCallNode(overrides: Record<string, unknown> = {}): DoorNode {
  return {
    id: "node-api-1",
    label: "Get channel stats",
    config: {
      apiMethod: "GET",
      apiUrl: "https://api.example.com/search?q={{customer.request}}",
      apiKeySource: "platform_youtube",
      apiKeyName: "youtube",
      apiOutputKey: "api.response",
      ...overrides
    }
  };
}

const CONTEXT: DoorContext = {
  userMessage: "how is the MrBeast channel doing",
  businessName: "Acme Studio",
  variables: { "trigger.prompt": "how is the MrBeast channel doing" }
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  getDoorBrainConfigMock.mockResolvedValue({ providerId: "gemini", modelId: "gemini-3.5-flash" });
  resolveProviderMock.mockReturnValue({ providerId: "gemini" });
  executeWithProviderMock.mockResolvedValue(reply("{}"));
});

/* ------------------------------ the registry ------------------------------ */

describe("registry: which nodes were born with doors", () => {
  const HANDS = [
    API_CALL_NODE_TYPE,
    VOICE_NODE_TYPES.sendEmail,
    VOICE_NODE_TYPES.sendSms,
    "action.send_whatsapp",
    TELEGRAM_NODE_TYPES.sendMessage,
    VOICE_NODE_TYPES.calendarAvailability,
    VOICE_NODE_TYPES.bookAppointment,
    CALENDLY_NODE_TYPES.action
  ];

  it("gives every Hand both doors", () => {
    for (const type of HANDS) {
      const doors = getNodeDoors(type);
      expect(doors?.entry?.job, type).toBeTruthy();
      expect(doors?.exit?.job, type).toBeTruthy();
    }
  });

  it("gives the Face-out step an entry door and no exit door", () => {
    const doors = getNodeDoors(BLOCK_NODE_TYPES.outputStage);
    expect(doors?.entry?.job).toBeTruthy();
    expect(doors?.exit).toBeUndefined();
  });

  it("gives Face-in blocks and Brains no doors at all", () => {
    // The customer's own words ARE the input; a Brain already is a door.
    for (const type of [
      BLOCK_NODE_TYPES.promptComposer,
      BLOCK_NODE_TYPES.actionButton,
      BLOCK_NODE_TYPES.presetGallery,
      BLOCK_NODE_TYPES.modelPicker,
      "ai.brain",
      "ai.context_reply",
      "ai.memory",
      "logic.condition"
    ]) {
      expect(hasNodeDoors(type), type).toBe(false);
    }
  });

  it("lists exactly the door-bearing types and nothing else", () => {
    expect([...DOOR_BEARING_NODE_TYPES].sort()).toEqual(
      [...HANDS, BLOCK_NODE_TYPES.outputStage].sort()
    );
  });

  it("writes a real job for this node's work, not a generic one", () => {
    // A job string is the door's whole brain — a stub would ship a useless door.
    for (const type of DOOR_BEARING_NODE_TYPES) {
      const doors = getNodeDoors(type);
      for (const job of [doors?.entry?.job, doors?.exit?.job].filter(Boolean) as string[]) {
        expect(job.length, type).toBeGreaterThan(80);
        expect(job, type).not.toMatch(/\bTODO\b|\bstub\b|lorem ipsum/i);
      }
    }
    // Each job is specific to its node, not copy-pasted between them.
    const entryJobs = DOOR_BEARING_NODE_TYPES.map((type) => getNodeDoors(type)?.entry?.job);
    expect(new Set(entryJobs).size).toBe(entryJobs.length);
  });

  it("hands doors to legacy Calendly slugs from older canvases", () => {
    expect(getNodeDoors("action.calendly_get_event_details")?.entry?.job).toBe(
      getNodeDoors(CALENDLY_NODE_TYPES.action)?.entry?.job
    );
  });

  it("attaches doors to the node definition consumers read", () => {
    expect(getNodeDefinition(API_CALL_NODE_TYPE)?.doors?.entry?.job).toBeTruthy();
    expect(getNodeDefinition("logic.condition")?.doors).toBeUndefined();
  });

  it("keeps doors on by default and off only when the architect says so", () => {
    expect(nodeDoorsEnabled({})).toBe(true);
    expect(nodeDoorsEnabled(undefined)).toBe(true);
    expect(nodeDoorsEnabled({ doorsDisabled: "true" })).toBe(false);
    expect(nodeDoorsEnabled({ doorsDisabled: true })).toBe(false);
    expect(nodeDoorsEnabled({ doorsDisabled: "false" })).toBe(true);
  });
});

/* ---------------------------- skip heuristics ----------------------------- */

describe("skip heuristics: never pay for a door that could not help", () => {
  it("runs the entry door when the step's request points at the run", () => {
    expect(entryDoorShouldRun(apiCallNode(), API_CALL_NODE_TYPE)).toBe(true);
  });

  it("runs the entry door when nothing usable is saved", () => {
    expect(entryDoorShouldRun({ id: "n", config: {} }, API_CALL_NODE_TYPE)).toBe(true);
    expect(entryDoorShouldRun({ id: "n" }, API_CALL_NODE_TYPE)).toBe(true);
    // apiUrl is required and blank — the request is still undecided.
    expect(entryDoorShouldRun(apiCallNode({ apiUrl: "" }), API_CALL_NODE_TYPE)).toBe(true);
  });

  it("skips the entry door when the request is already fully decided", () => {
    expect(
      entryDoorShouldRun(apiCallNode({ apiUrl: "https://api.example.com/stats?id=42" }), API_CALL_NODE_TYPE)
    ).toBe(false);
  });

  it("runs the exit door only on a reply worth cleaning", () => {
    expect(exitDoorShouldRun({ items: [{ id: 1, title: "a" }] })).toBe(true); // shaped
    expect(exitDoorShouldRun("x".repeat(401))).toBe(true); // long
    expect(exitDoorShouldRun([{ id: 1 }])).toBe(true);

    expect(exitDoorShouldRun("Sent.")).toBe(false);
    expect(exitDoorShouldRun({ ok: true })).toBe(false);
    expect(exitDoorShouldRun(42)).toBe(false);
    expect(exitDoorShouldRun(true)).toBe(false);
    expect(exitDoorShouldRun(null)).toBe(false);
    expect(exitDoorShouldRun(["a", "b"])).toBe(false);
  });

  it("runs the presentation door only when the result is not already visual", () => {
    expect(presentationDoorShouldRun("312 million subscribers and rising")).toBe(true);
    expect(presentationDoorShouldRun({ subscribers: "312M", views: 1200 })).toBe(true);

    expect(
      presentationDoorShouldRun('{"stats":[{"label":"Subscribers","value":"312M"}]}')
    ).toBe(false);
    expect(presentationDoorShouldRun("")).toBe(false);
    expect(presentationDoorShouldRun(null)).toBe(false);
  });
});

/* ------------------------------- entry door ------------------------------- */

describe("entry door", () => {
  it("returns the resolved settings this execution should use", async () => {
    executeWithProviderMock.mockResolvedValue(
      reply('{"overrides":{"apiUrl":"https://api.example.com/search?q=MrBeast"}}')
    );

    const node = apiCallNode();
    const result = await runEntryDoor({
      node,
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result.overrides).toEqual({ apiUrl: "https://api.example.com/search?q=MrBeast" });
    // The saved graph is never touched — overrides apply to this run only.
    expect(node.config?.apiUrl).toBe("https://api.example.com/search?q={{customer.request}}");
  });

  it("runs on the admin-configured battery at low temperature", async () => {
    getDoorBrainConfigMock.mockResolvedValue({ providerId: "claude", modelId: "claude-sonnet-5" });
    resolveProviderMock.mockReturnValue({ providerId: "claude" });
    executeWithProviderMock.mockResolvedValue(reply('{"overrides":{"apiUrl":"https://x.test/a"}}'));

    await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    const [providerId, request] = executeWithProviderMock.mock.calls[0];
    expect(providerId).toBe("claude");
    expect(request).toMatchObject({
      model: "claude-sonnet-5",
      temperature: 0.1,
      maxTokens: 400,
      outputFormat: "json"
    });
  });

  it("drops a model id when the engine fell back to another provider", async () => {
    resolveProviderMock.mockReturnValue({ providerId: "openai", fallbackFrom: "gemini" });
    executeWithProviderMock.mockResolvedValue(reply('{"overrides":{"apiUrl":"https://x.test/a"}}'));

    await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(executeWithProviderMock.mock.calls[0][0]).toBe("openai");
    expect(executeWithProviderMock.mock.calls[0][1].model).toBeUndefined();
  });

  it("never lets a door rewrite a credential or invent a setting", async () => {
    executeWithProviderMock.mockResolvedValue(
      reply(
        '{"overrides":{"apiUrl":"https://api.example.com/ok","apiKeySource":"my_key",' +
          '"apiKeyName":"stolen","connectionId":"other-account","madeUpField":"x"}}'
      )
    );

    const result = await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result.overrides).toEqual({ apiUrl: "https://api.example.com/ok" });
  });

  it("never shows a credential field to the model", async () => {
    executeWithProviderMock.mockResolvedValue(reply('{"overrides":{}}'));

    await runEntryDoor({
      node: apiCallNode({ apiKeyName: "super-secret-key-name" }),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    const sent = JSON.stringify(executeWithProviderMock.mock.calls[0][1]);
    expect(sent).not.toContain("super-secret-key-name");
    expect(sent).not.toContain("apiKeyName");
  });

  it("refuses a value that still carries an unfilled slot", async () => {
    executeWithProviderMock.mockResolvedValue(
      reply('{"overrides":{"apiUrl":"https://api.example.com/search?q={{customer.request}}"}}')
    );

    const result = await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result.overrides).toEqual({});
  });

  it("accepts settings sent without the wrapper", async () => {
    executeWithProviderMock.mockResolvedValue(reply('{"apiUrl":"https://api.example.com/bare"}'));

    const result = await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result.overrides).toEqual({ apiUrl: "https://api.example.com/bare" });
  });

  it("does nothing for a node type that has no entry door", async () => {
    const result = await runEntryDoor({
      node: { id: "n", config: { prompt: "{{customer.request}}" } },
      nodeType: BLOCK_NODE_TYPES.promptComposer,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result.overrides).toEqual({});
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });

  it("does nothing when the request is already decided", async () => {
    const result = await runEntryDoor({
      node: apiCallNode({ apiUrl: "https://api.example.com/stats?id=42" }),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result.overrides).toEqual({});
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });
});

/* -------------------------------- exit door -------------------------------- */

const RAW_REPLY = {
  kind: "youtube#searchListResponse",
  etag: "abc",
  pageInfo: { totalResults: 1, resultsPerPage: 1 },
  items: [
    {
      id: { kind: "youtube#channel", channelId: "UC123" },
      snippet: { title: "MrBeast", description: "x".repeat(500), publishedAt: "2012-02-19" }
    }
  ]
};

describe("exit door", () => {
  it("stores the cleaned reply instead of the raw one", async () => {
    executeWithProviderMock.mockResolvedValue(
      reply('{"clean":{"channelId":"UC123","title":"MrBeast","publishedAt":"2012-02-19"}}')
    );

    const result = await runExitDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      rawOutput: RAW_REPLY,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      channelId: "UC123",
      title: "MrBeast",
      publishedAt: "2012-02-19"
    });
    expect(executeWithProviderMock.mock.calls[0][1]).toMatchObject({ maxTokens: 600 });
  });

  it("keeps the raw reply when the model forgets to say it is a cleaning", async () => {
    // The exit door REPLACES real data, so it must state plainly that its reply
    // is a cleaning — a bare object could be a refusal.
    executeWithProviderMock.mockResolvedValue(reply('{"error":"I cannot help with that"}'));

    const result = await runExitDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      rawOutput: RAW_REPLY,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result).toEqual({ value: RAW_REPLY, changed: false });
  });

  it("skips a reply that is already small", async () => {
    const result = await runExitDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      rawOutput: { ok: true },
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result).toEqual({ value: { ok: true }, changed: false });
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });

  it("does nothing for a node type that has no exit door", async () => {
    const result = await runExitDoor({
      node: { id: "n" },
      nodeType: BLOCK_NODE_TYPES.outputStage,
      rawOutput: RAW_REPLY,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result.changed).toBe(false);
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });
});

/* ---------------------------- presentation door ---------------------------- */

describe("presentation door", () => {
  it("turns the run's result into what the Result Viewer renders", async () => {
    executeWithProviderMock.mockResolvedValue(
      reply(
        '```json\n{"text":"MrBeast is still growing.",' +
          '"stats":[{"label":"Subscribers","value":"312M","delta":"+1.2M","deltaDir":"up"}],' +
          '"chart":{"type":"bar","title":"Views by video","series":[{"label":"A","value":1200}]}}\n```'
      )
    );

    const result = await runPresentationDoor({
      context: CONTEXT,
      lastOutput: "The channel has 312 million subscribers, up 1.2 million, and video A got 1200 views.",
      budget: createDoorBudget()
    });

    expect(result.visual).toEqual({
      text: "MrBeast is still growing.",
      stats: [{ label: "Subscribers", value: "312M", delta: "+1.2M", deltaDir: "up" }],
      chart: { type: "bar", title: "Views by video", series: [{ label: "A", value: 1200 }] }
    });
    expect(executeWithProviderMock.mock.calls[0][1]).toMatchObject({ maxTokens: 1200 });
  });

  it("leaves an already-visual result alone", async () => {
    const result = await runPresentationDoor({
      context: CONTEXT,
      lastOutput: '{"stats":[{"label":"Subscribers","value":"312M"}]}',
      budget: createDoorBudget()
    });

    expect(result.visual).toBeNull();
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });

  it("falls back to plain text when the payload carries nothing renderable", async () => {
    executeWithProviderMock.mockResolvedValue(reply('{"text":"Nothing to chart here."}'));

    const result = await runPresentationDoor({
      context: CONTEXT,
      lastOutput: "a plain sentence with no numbers",
      budget: createDoorBudget()
    });

    expect(result.visual).toBeNull();
  });
});

/* ------------------------- the never-break contract ------------------------ */

describe("doors are an enhancement, never a dependency", () => {
  it("stops at the per-run budget, shared by every door", async () => {
    executeWithProviderMock.mockResolvedValue(reply('{"overrides":{"apiUrl":"https://x.test/a"}}'));
    const budget = createDoorBudget(1);

    const first = await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget
    });
    expect(first.overrides).toEqual({ apiUrl: "https://x.test/a" });
    expect(budget.remaining).toBe(0);

    // Same budget, a different door in the same run — no allowance left.
    const second = await runExitDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      rawOutput: RAW_REPLY,
      context: CONTEXT,
      budget
    });
    const third = await runPresentationDoor({
      context: CONTEXT,
      lastOutput: "a long sentence about the result",
      budget
    });

    expect(second).toEqual({ value: RAW_REPLY, changed: false });
    expect(third.visual).toBeNull();
    expect(executeWithProviderMock).toHaveBeenCalledTimes(1);
  });

  it("a zero budget disables every door with no calls at all", async () => {
    const budget = createDoorBudget(0);
    const result = await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget
    });

    expect(result.overrides).toEqual({});
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });

  it("a slow provider times out and the node proceeds unchanged", async () => {
    vi.useFakeTimers();
    executeWithProviderMock.mockImplementation(() => new Promise(() => {}));

    const pending = runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });
    await vi.advanceTimersByTimeAsync(DOOR_TIMEOUT_MS + 100);

    expect((await pending).overrides).toEqual({});
    vi.useRealTimers();
  });

  it("nonsense from the model means no change", async () => {
    for (const text of ["I think the address should be https://api.example.com", "", "[1,2,3]", "null"]) {
      executeWithProviderMock.mockResolvedValue(reply(text));

      const entry = await runEntryDoor({
        node: apiCallNode(),
        nodeType: API_CALL_NODE_TYPE,
        context: CONTEXT,
        budget: createDoorBudget()
      });
      const exit = await runExitDoor({
        node: apiCallNode(),
        nodeType: API_CALL_NODE_TYPE,
        rawOutput: RAW_REPLY,
        context: CONTEXT,
        budget: createDoorBudget()
      });
      const presentation = await runPresentationDoor({
        context: CONTEXT,
        lastOutput: "a long sentence about the result",
        budget: createDoorBudget()
      });

      expect(entry.overrides, text).toEqual({});
      expect(exit.changed, text).toBe(false);
      expect(presentation.visual, text).toBeNull();
    }
  });

  it("a provider error means no change", async () => {
    executeWithProviderMock.mockResolvedValue({
      status: "error",
      text: null,
      structuredOutput: null,
      error: "rate limited"
    });

    const result = await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });
    expect(result.overrides).toEqual({});
  });

  it("a thrown provider means no change", async () => {
    executeWithProviderMock.mockRejectedValue(new Error("adapter exploded"));

    await expect(
      runExitDoor({
        node: apiCallNode(),
        nodeType: API_CALL_NODE_TYPE,
        rawOutput: RAW_REPLY,
        context: CONTEXT,
        budget: createDoorBudget()
      })
    ).resolves.toEqual({ value: RAW_REPLY, changed: false });
  });

  it("an unreachable settings store means no change and no wasted budget", async () => {
    getDoorBrainConfigMock.mockRejectedValue(new Error("database down"));
    const budget = createDoorBudget();

    const result = await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget
    });

    expect(result.overrides).toEqual({});
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });

  it("no configured provider key means no change and no wasted budget", async () => {
    resolveProviderMock.mockReturnValue(null);
    const budget = createDoorBudget();

    const result = await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget
    });

    expect(result.overrides).toEqual({});
    expect(budget.used).toBe(0);
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });
});

describe("door usage is logged without leaking anything", () => {
  it("logs the door, the node and the cost — never a value", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    executeWithProviderMock.mockResolvedValue(
      reply('{"overrides":{"apiUrl":"https://api.example.com/search?q=MrBeast"}}')
    );

    await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });
    spy.mockRestore();

    const line = logs.find((entry) => entry.includes("[node-doors] entry ok"));
    expect(line).toBeTruthy();
    expect(line).toContain("node=node-api-1");
    expect(line).toContain("doors=1/8");

    const all = logs.join("\n");
    expect(all).not.toContain("MrBeast");
    expect(all).not.toContain("api.example.com");
    expect(all).not.toContain("youtube");
  });
});

/* ------------------------- the whitelist, enforced ------------------------ */

describe("a door may only ever write the settings it was born allowed to write", () => {
  it("gives every entry door an explicit list of settings it may fill", () => {
    // A missing list is not "anything goes" — but a door shipped without one
    // would silently do nothing, so the registry is checked here instead.
    for (const type of DOOR_BEARING_NODE_TYPES) {
      const entry = getNodeDoors(type)?.entry;
      if (!entry) continue;
      expect(entry.fields, type).toBeDefined();
    }
  });

  it("never puts a credential, connection or account setting on a list", () => {
    for (const type of DOOR_BEARING_NODE_TYPES) {
      for (const field of getNodeDoors(type)?.entry?.fields ?? []) {
        expect(field, `${type}.${field}`).not.toMatch(
          /key|secret|token|credential|password|auth|connection|account|webhook|header/i
        );
      }
    }
  });

  it("lets the presentation door write no settings at all", () => {
    // It builds the picture a customer sees; it configures nothing.
    expect(getNodeDoors(BLOCK_NODE_TYPES.outputStage)?.entry?.fields).toEqual([]);
  });

  it("refuses a real setting on the node that is not on this door's list", async () => {
    // Every name below exists on a WhatsApp send node and is read by the
    // runner. None of them is the door's to choose: `connectionId` picks the
    // account that pays, `mediaLink` makes Meta fetch a URL, `templateName`
    // picks pre-approved copy. Only the number and the words are.
    executeWithProviderMock.mockResolvedValue(
      reply(
        '{"overrides":{"recipient":"+15550000001","message":"Your table is booked for 7pm.",' +
          '"connectionId":"attacker-account","mediaLink":"https://evil.example.com/x.png",' +
          '"templateName":"other_template"}}'
      )
    );

    const result = await runEntryDoor({
      node: {
        id: "node-wa-1",
        label: "Send WhatsApp",
        config: {
          connectionId: "the-real-account",
          recipient: "{{trigger.whatsapp.from}}",
          message: "",
          mediaLink: "",
          templateName: "booking_confirmed"
        }
      },
      nodeType: "action.send_whatsapp",
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result.overrides).toEqual({
      recipient: "+15550000001",
      message: "Your table is booked for 7pm."
    });
  });

  it("refuses the Telegram settings that would put a stranger's link in a chat", async () => {
    executeWithProviderMock.mockResolvedValue(
      reply(
        '{"overrides":{"telegramMessageText":"All set!",' +
          '"telegramCallbackUrl":"https://evil.example.com",' +
          '"telegramButtonsJson":"[[{\\"text\\":\\"Claim\\",\\"url\\":\\"https://evil.example.com\\"}]]"}}'
      )
    );

    const result = await runEntryDoor({
      node: {
        id: "node-tg-1",
        config: { telegramMessageText: "{{ai.output}}", telegramCallbackUrl: "", telegramButtonsJson: "" }
      },
      nodeType: TELEGRAM_NODE_TYPES.sendMessage,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result.overrides).toEqual({ telegramMessageText: "All set!" });
  });

  it("cannot reach an object's prototype through a setting name", async () => {
    executeWithProviderMock.mockResolvedValue(
      reply('{"overrides":{"__proto__":{"polluted":"yes"},"constructor":"x","apiUrl":"https://api.example.com/ok"}}')
    );

    const result = await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget: createDoorBudget()
    });

    expect(result.overrides).toEqual({ apiUrl: "https://api.example.com/ok" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result.overrides)).toBe(Object.prototype);
  });

  it("skips the call entirely when every setting it may fill is already decided", async () => {
    // The saved key fields are noise to this decision: the door could not
    // change them, so they can never make the request ambiguous.
    const shouldRun = entryDoorShouldRun(
      apiCallNode({ apiUrl: "https://api.example.com/fixed", apiBody: "" }),
      API_CALL_NODE_TYPE
    );

    expect(shouldRun).toBe(false);
  });
});

/* -------------------------- the shared time ceiling ----------------------- */

describe("doors can never hold a customer's page open", () => {
  it("stops every door once the run has spent its door time", async () => {
    // A budget created with no time left: calls are refused before any model
    // is reached, so a page that has already waited long enough just finishes.
    const budget = createDoorBudget(8, 0);
    expect(budget.expired).toBe(true);

    const entry = await runEntryDoor({
      node: apiCallNode(),
      nodeType: API_CALL_NODE_TYPE,
      context: CONTEXT,
      budget
    });
    const presentation = await runPresentationDoor({
      context: CONTEXT,
      lastOutput: { subscribers: 312000000, views: 1200 },
      budget
    });

    expect(entry.overrides).toEqual({});
    expect(presentation.visual).toBeNull();
    expect(executeWithProviderMock).not.toHaveBeenCalled();
    expect(budget.used).toBe(0);
  });

  it("keeps the per-call timeout as the second ceiling", () => {
    // Both matter: this one bounds a single slow provider, the budget's
    // deadline bounds the whole run.
    expect(DOOR_TIMEOUT_MS).toBeLessThanOrEqual(12_000);
  });
});
