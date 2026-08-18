import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Face-out door runs for real in this file — only the provider engine and
 * the admin battery setting are mocked, so the wiring under test is the true
 * path from an engine result to what a visitor sees.
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

import { presentationDoorEnabled } from "@coreai/shared";
import { createDoorBudget } from "../agent-runtime/node-doors";
import {
  extractRunFinalOutput,
  extractRunOutput,
  extractRunStructured,
  extractRunText,
  resolveRunOutput
} from "./run-output";

/**
 * extractRunText is the LAST exit for one-shot run text (public agent-page
 * /run and the builder's preview-run both extract here), so it must apply
 * customer-text hygiene: leaked {{...}} tokens never survive extraction,
 * while legitimate braces in real answers pass through untouched.
 */
describe("extractRunText hygiene", () => {
  it("returns clean ai output text unchanged", () => {
    const result = { context: { ai: { output: "Here is your 7-day Kerala plan." } }, logs: [] };
    expect(extractRunText(result)).toBe("Here is your 7-day Kerala plan.");
  });

  it("strips a leaked {{business.name}} token from the final run text", () => {
    const result = {
      context: { ai: { output: "A 7-day trip for your family, planned by {{business.name}}  " } },
      logs: []
    };
    expect(extractRunText(result)).toBe("A 7-day trip for your family, planned by");
  });

  it("preserves legitimate braces in code-style answers", () => {
    const output = 'Send {"name": "Ana", "days": 7} to the form, or use { spread } syntax.';
    const result = { context: { ai: { output } }, logs: [] };
    expect(extractRunText(result)).toBe(output);
  });

  it("still returns null when the run produced no text", () => {
    expect(extractRunText({ context: {}, logs: [] })).toBeNull();
    expect(extractRunText({ context: { ai: { output: 42 } }, logs: [] })).toBeNull();
  });

  it("extractRunOutput carries the sanitized text alongside media", () => {
    const result = {
      context: {
        ai: { output: "Your poster is ready!\n— {{business.name}}" },
        image_url: "https://cdn.example.com/poster.png"
      },
      logs: []
    };
    expect(extractRunOutput(result)).toEqual({
      text: "Your poster is ready!",
      mediaUrls: ["https://cdn.example.com/poster.png"],
      structured: null
    });
  });
});

/**
 * When the AI Brain replies with the Visual Results JSON contract, the run
 * output carries a validated `structured` payload and the raw JSON never leaks
 * as visitor-facing text. Plain replies (and non-visual JSON) keep the old
 * behavior — structured is null.
 */
describe("extractRunStructured", () => {
  it("detects stat cards, a chart, and a table from a JSON Brain reply", () => {
    const payload = JSON.stringify({
      text: "Channel is growing.",
      stats: [{ label: "Subscribers", value: "312M", delta: "+1.2M", deltaDir: "up" }],
      chart: { type: "bar", title: "Views", series: [{ label: "Jan", value: 1200 }] },
      table: { columns: ["Video", "Views"], rows: [["Intro", "1,200"]] }
    });
    const structured = extractRunStructured({ context: { ai: { output: payload } }, logs: [] });
    expect(structured).not.toBeNull();
    expect(structured?.stats?.[0]).toEqual({
      label: "Subscribers",
      value: "312M",
      delta: "+1.2M",
      deltaDir: "up"
    });
    expect(structured?.chart?.type).toBe("bar");
    expect(structured?.chart?.series).toEqual([{ label: "Jan", value: 1200 }]);
    expect(structured?.table?.columns).toEqual(["Video", "Views"]);
  });

  it("returns null for plain text (backward compatible)", () => {
    expect(
      extractRunStructured({ context: { ai: { output: "Just a normal answer." } }, logs: [] })
    ).toBeNull();
  });

  it("returns null for non-visual JSON so it renders as text", () => {
    const output = JSON.stringify({ foo: "bar", count: 3 });
    expect(extractRunStructured({ context: { ai: { output } }, logs: [] })).toBeNull();
  });

  it("hygiene runs inside stat labels, values, and table cells", () => {
    const payload = JSON.stringify({
      stats: [{ label: "By {{business.name}}", value: "10 {{leak}}" }],
      table: { columns: ["Name {{x}}"], rows: [["Row {{y}}"]] }
    });
    const structured = extractRunStructured({ context: { ai: { output: payload } }, logs: [] });
    expect(structured?.stats?.[0].label).toBe("By");
    expect(structured?.stats?.[0].value).toBe("10");
    expect(structured?.table?.columns).toEqual(["Name"]);
    expect(structured?.table?.rows).toEqual([["Row"]]);
  });
});

describe("extractRunOutput with a visual payload", () => {
  it("surfaces structured visuals and never leaks the raw JSON as text", () => {
    const payload = JSON.stringify({
      text: "Here are the numbers.",
      stats: [{ label: "Views", value: 1000 }]
    });
    const output = extractRunOutput({ context: { ai: { output: payload } }, logs: [] });
    // text is the payload's own prose, not the raw JSON string.
    expect(output.text).toBe("Here are the numbers.");
    expect(output.structured?.stats?.[0]).toEqual({ label: "Views", value: "1000" });
    expect(output.mediaUrls).toEqual([]);
  });

  it("leaves text null when a visual payload carries no prose", () => {
    const payload = JSON.stringify({ chart: { type: "pie", series: [{ label: "A", value: 5 }] } });
    const output = extractRunOutput({ context: { ai: { output: payload } }, logs: [] });
    expect(output.text).toBeNull();
    expect(output.structured?.chart?.type).toBe("pie");
  });
});

// ---------------------------------------------------------------------------
// THE FACE-OUT DOOR — resolveRunOutput.
// ---------------------------------------------------------------------------

/**
 * An architect used to have to hand-place an AI Brain as the last node and
 * teach it the Visual Results JSON by hand. The Face-out door does that work
 * inside the product: ANY agent — even one whose last step is a bare API call —
 * shows cards, a chart or a table.
 *
 * The contract these tests defend, in order of importance:
 *   1. the door NEVER breaks a run — failure, timeout, nonsense and a spent
 *      budget all land on exactly the plain text shipped before it existed;
 *   2. the door never does work twice — an already-visual result passes
 *      straight through, costing nothing;
 *   3. the door pays from the run's ONE shared allowance, never its own.
 */

/** Minimal provider reply — only these fields are read. */
function reply(text: string) {
  return { status: "success" as const, text, structuredOutput: null, error: null };
}

const DOOR_VISUAL = JSON.stringify({
  text: "Your channel is growing.",
  stats: [{ label: "Subscribers", value: "312M", delta: "+1.2M", deltaDir: "up" }],
  table: { columns: ["Video", "Views"], rows: [["Intro", "1,200"]] }
});

beforeEach(() => {
  vi.clearAllMocks();
  getDoorBrainConfigMock.mockResolvedValue({ providerId: "gemini", modelId: "gemini-3.5-flash" });
  resolveProviderMock.mockReturnValue({ providerId: "gemini" });
  executeWithProviderMock.mockResolvedValue(reply(DOOR_VISUAL));
});

describe("resolveRunOutput: a raw result becomes something a person can read", () => {
  it("turns an API step's raw JSON into stat cards and a table", async () => {
    const raw = JSON.stringify({
      items: [{ statistics: { subscriberCount: "312000000", viewCount: "1200" } }]
    });
    const output = await resolveRunOutput(
      { context: { ai: { output: raw } }, logs: [] },
      { userMessage: "how is the channel doing", businessName: "Acme Studio" }
    );

    expect(output.structured?.stats?.[0]).toEqual({
      label: "Subscribers",
      value: "312M",
      delta: "+1.2M",
      deltaDir: "up"
    });
    expect(output.structured?.table?.rows).toEqual([["Intro", "1,200"]]);
    // The raw payload the cards replaced must never also be dumped as text.
    expect(output.text).toBe("Your channel is growing.");
    expect(executeWithProviderMock).toHaveBeenCalledTimes(1);
  });

  it("presents the last step's output when the agent has no Brain at all", async () => {
    // Six nodes instead of ten: no exit Brain, nothing in context.ai.
    const result = {
      context: {},
      logs: [
        { nodeId: "n1", label: "Trigger", status: "success", output: { message: "hi" } },
        {
          nodeId: "n2",
          label: "Get channel stats",
          status: "success",
          output: { subscribers: 312_000_000, views: 1200 }
        }
      ]
    };

    const output = await resolveRunOutput(result, { userMessage: "how is the channel doing" });

    expect(output.structured?.stats?.[0].label).toBe("Subscribers");
    expect(executeWithProviderMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the agent's own prose when the door adds visuals to it", async () => {
    executeWithProviderMock.mockResolvedValue(
      reply(JSON.stringify({ stats: [{ label: "Days", value: "7" }] }))
    );

    const output = await resolveRunOutput({
      context: { ai: { output: "Here is your 7-day Kerala plan." } },
      logs: []
    });

    // The door wrote no line of its own — real writing is never thrown away.
    expect(output.text).toBe("Here is your 7-day Kerala plan.");
    expect(output.structured?.stats).toEqual([{ label: "Days", value: "7" }]);
  });

  it("runs the same hygiene on a door-built payload as on plain text", async () => {
    executeWithProviderMock.mockResolvedValue(
      reply(JSON.stringify({ stats: [{ label: "By {{business.name}}", value: "10 {{leak}}" }] }))
    );

    const output = await resolveRunOutput({
      context: { ai: { output: '{"count":10}' } },
      logs: []
    });

    expect(output.structured?.stats?.[0]).toEqual({ label: "By", value: "10" });
  });

  it("carries media through untouched and never puts a data: URI in the prompt", async () => {
    // An image node's output is megabytes of base64. It already reaches the
    // visitor through mediaUrls — paying to put it in a prompt teaches the
    // door nothing and costs a fortune.
    const dataUri = `data:image/png;base64,${"A".repeat(5000)}`;
    const output = await resolveRunOutput({
      context: { image_url: dataUri },
      logs: [
        {
          nodeId: "n1",
          label: "Poster",
          status: "success",
          output: { imageUrl: dataUri, caption: "Summer sale poster", printReady: dataUri }
        }
      ]
    });

    expect(output.mediaUrls).toEqual([dataUri]);
    const [, request] = executeWithProviderMock.mock.calls[0];
    const prompt = request.messages[0].content as string;
    expect(prompt).not.toContain("AAAA");
    expect(prompt).toContain("Summer sale poster");
  });
});

describe("resolveRunOutput: already-visual results never pay for a door", () => {
  it("passes a Brain's own visual reply straight through", async () => {
    const payload = JSON.stringify({
      text: "Here are the numbers.",
      stats: [{ label: "Views", value: 1000 }]
    });
    const output = await resolveRunOutput({ context: { ai: { output: payload } }, logs: [] });

    expect(output.text).toBe("Here are the numbers.");
    expect(output.structured?.stats?.[0]).toEqual({ label: "Views", value: "1000" });
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });

  it("uses a visual-shaped step output directly, without a door call", async () => {
    const output = await resolveRunOutput({
      context: {},
      logs: [
        {
          nodeId: "n1",
          label: "Stats",
          status: "success",
          output: { chart: { type: "pie", series: [{ label: "A", value: 5 }] } }
        }
      ]
    });

    expect(output.structured?.chart?.type).toBe("pie");
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });

  it("does not pay to hand the customer their own words back", async () => {
    // Nothing but the trigger ran — there is nothing to present.
    const output = await resolveRunOutput(
      {
        context: {},
        logs: [{ nodeId: "n1", label: "Trigger", status: "success", output: { message: "hi" } }]
      },
      { userMessage: "hi" }
    );

    expect(output.structured).toBeNull();
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });

  it("does not call the door when the run produced nothing", async () => {
    expect(await resolveRunOutput({ context: {}, logs: [] })).toEqual({
      text: null,
      mediaUrls: [],
      structured: null
    });
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });
});

describe("resolveRunOutput: the door is an enhancement, never a dependency", () => {
  const plainRun = {
    context: { ai: { output: "Here is your 7-day Kerala plan." } },
    logs: []
  };

  it("falls back to plain text when the provider errors", async () => {
    executeWithProviderMock.mockResolvedValue({ status: "error", error: "quota exceeded" });
    expect(await resolveRunOutput(plainRun)).toEqual(extractRunOutput(plainRun));
  });

  it("falls back to plain text when the provider throws", async () => {
    executeWithProviderMock.mockRejectedValue(new Error("socket hang up"));
    expect(await resolveRunOutput(plainRun)).toEqual(extractRunOutput(plainRun));
  });

  it("falls back to plain text when no door key is configured", async () => {
    resolveProviderMock.mockReturnValue(null);
    expect(await resolveRunOutput(plainRun)).toEqual(extractRunOutput(plainRun));
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });

  it("falls back to plain text when the door replies with nothing renderable", async () => {
    executeWithProviderMock.mockResolvedValue(reply('{"text":"no numbers here"}'));
    expect(await resolveRunOutput(plainRun)).toEqual(extractRunOutput(plainRun));
  });

  it("falls back to plain text when the door replies with garbage", async () => {
    executeWithProviderMock.mockResolvedValue(reply("I'm sorry, I can't do that."));
    expect(await resolveRunOutput(plainRun)).toEqual(extractRunOutput(plainRun));
  });
});

describe("resolveRunOutput: one shared door allowance per run", () => {
  const rawRun = { context: { ai: { output: '{"subscribers":312000000}' } }, logs: [] };

  it("spends the run's own allowance rather than opening a new one", async () => {
    const budget = createDoorBudget(4);
    await resolveRunOutput(rawRun, { budget });
    expect(budget.used).toBe(1);
  });

  it("uses the allowance the engine already opened for this run", async () => {
    const budget = createDoorBudget(4);
    // Entry/exit doors inside the nodes already spent two of the four.
    budget.take();
    budget.take();

    await resolveRunOutput({ ...rawRun, doorBudget: budget });

    expect(budget.used).toBe(3);
    expect(executeWithProviderMock).toHaveBeenCalledTimes(1);
  });

  it("shows plain text when the run's doors already spent the allowance", async () => {
    const budget = createDoorBudget(2);
    budget.take();
    budget.take();

    const output = await resolveRunOutput(rawRun, { budget });

    expect(output.structured).toBeNull();
    expect(output).toEqual(extractRunOutput(rawRun));
    expect(executeWithProviderMock).not.toHaveBeenCalled();
  });

  it("ignores a doorBudget field that is not a real allowance", async () => {
    const output = await resolveRunOutput({ ...rawRun, doorBudget: { take: "yes" } });
    expect(output.structured?.stats?.[0].label).toBe("Subscribers");
  });
});

describe("extractRunFinalOutput", () => {
  it("prefers the AI reply over any step output", () => {
    const result = {
      context: { ai: { output: "the answer" } },
      logs: [{ nodeId: "n1", label: "Step", status: "success", output: { raw: 1 } }]
    };
    expect(extractRunFinalOutput(result)).toBe("the answer");
  });

  it("falls back to the newest step that actually produced something", () => {
    const result = {
      context: {},
      logs: [
        { nodeId: "n1", label: "A", status: "success", output: { first: true } },
        { nodeId: "n2", label: "B", status: "success", output: {} },
        { nodeId: "n3", label: "C", status: "success", output: { last: true } },
        { nodeId: "n4", label: "D", status: "success" }
      ]
    };
    expect(extractRunFinalOutput(result)).toEqual({ last: true });
  });

  it("never presents a failed step's output", () => {
    const result = {
      context: {},
      logs: [
        { nodeId: "n1", label: "A", status: "success", output: { good: true } },
        { nodeId: "n2", label: "B", status: "error", output: { stack: "boom" } }
      ]
    };
    expect(extractRunFinalOutput(result)).toEqual({ good: true });
  });

  it("returns null for a run that produced nothing", () => {
    expect(extractRunFinalOutput({ context: {}, logs: [] })).toBeNull();
  });
});

/* ------------------- the Face-out door obeys its own switch ---------------- */

describe("the Result Viewer's Smart input & output switch", () => {
  const RUN = {
    context: {},
    logs: [
      {
        nodeId: "n1",
        label: "Get channel stats",
        status: "success",
        output: { subscribers: 312000000, views: 1200 }
      }
    ]
  };

  it("reads the switch off the graph so the door can honour it", () => {
    // The presentation door runs out here, after the engine has returned, so
    // the flag has to travel from the canvas to this surface.
    const on = { nodes: [{ id: "b1", data: { type: "block.output_stage" } }] };
    const off = {
      nodes: [{ id: "b1", data: { type: "block.output_stage", doorsDisabled: "true" } }]
    };

    expect(presentationDoorEnabled(on)).toBe(true);
    expect(presentationDoorEnabled(off)).toBe(false);
    // A graph with no Result Viewer, and an unreadable one, both mean "on" —
    // doors are on by default and a missing answer is never an "off".
    expect(presentationDoorEnabled({ nodes: [] })).toBe(true);
    expect(presentationDoorEnabled(null)).toBe(true);
  });

  it("makes no door call at all when the architect switched it off", async () => {
    const output = await resolveRunOutput(RUN, {
      userMessage: "how is the channel doing",
      doorsEnabled: false
    });

    expect(executeWithProviderMock).not.toHaveBeenCalled();
    expect(output.structured).toBeNull();
  });

  it("still runs the door when the switch is untouched", async () => {
    executeWithProviderMock.mockResolvedValue({
      status: "success",
      text: '{"text":"The channel has 312M subscribers.","stats":[{"label":"Subscribers","value":"312M"}]}',
      structuredOutput: null,
      error: null
    });

    const output = await resolveRunOutput(RUN, { userMessage: "how is the channel doing" });

    expect(executeWithProviderMock).toHaveBeenCalledTimes(1);
    expect(output.structured?.stats?.[0]?.value).toBe("312M");
  });
});
