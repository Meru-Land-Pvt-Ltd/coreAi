import { API_CALL_NODE_TYPE, BLOCK_NODE_TYPES } from "@coreai/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE TWO DOORS — the end-to-end read-through.
 *
 * The founder's defining scenario: a YouTube stats agent built out of five
 * nodes and NO hand-placed AI Brain.
 *
 *   Prompt Box → Button → API Call (video) → API Call (channel) → Result Viewer
 *
 * Nothing in that graph knows how to turn "how is MrBeast's video doing?" into
 * two web addresses, and nothing in it knows how to turn a YouTube payload into
 * cards. The doors built inside the two API Call nodes and the Result Viewer do
 * all of it. This suite is the proof, and it guards the three seams where the
 * runtime doors, the presentation door and the run context meet:
 *
 *   • ONE door allowance is shared by the whole run — including the
 *     presentation door, which runs after the engine has already returned;
 *   • the presentation door is handed the step's CLEANED product, never the
 *     runner's log receipt (which carries engine bookkeeping and the raw reply);
 *   • the raw copy an exit door parks for debugging never reaches a later
 *     door's prompt.
 *
 * And the two invariants the founder is strictest about: doors are invisible,
 * and doors are an enhancement that can never become a dependency.
 *
 * A true unit test: no network, no database, no model.
 */

const { getDoorBrainConfigMock, executeWithProviderMock, resolveProviderMock } = vi.hoisted(() => ({
  getDoorBrainConfigMock: vi.fn(),
  executeWithProviderMock: vi.fn(),
  resolveProviderMock: vi.fn()
}));

vi.mock("../admin/door-brain-settings", () => ({ getDoorBrainConfig: getDoorBrainConfigMock }));
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
vi.mock("../../lib/safe-fetch", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/safe-fetch")>();
  return { ...actual, safeFetch: vi.fn() };
});
vi.mock("../memory", () => ({
  createWorkflowRun: vi.fn(async () => ({ workflowRunId: "run-e2e", threadId: "thread-e2e" })),
  completeWorkflowRun: vi.fn(async () => undefined),
  failWorkflowRun: vi.fn(async () => undefined),
  runAiBrainNode: vi.fn(),
  memoryBroker: { saveNodeMemory: vi.fn(async () => undefined) },
  buildSmartMemory: vi.fn(async () => ""),
  resolveSmartMemoryForQuery: vi.fn(async () => ""),
  mergeMemoryIntoPrompt: vi.fn((prompt: string) => prompt)
}));

import { env } from "../../config/env";
import { safeFetch, type SafeFetchResult } from "../../lib/safe-fetch";
import { resolveRunOutput } from "../agent-pages/run-output";
import { runWorkflowTest } from "./workflow-runner";

const mockSafeFetch = vi.mocked(safeFetch);

const ASKED = "How is MrBeast's 'I Built a School' video doing?";

const VIDEO_URL_TEMPLATE =
  "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id={{videoId}}";
const CHANNEL_URL_TEMPLATE =
  "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id={{channelId}}";
const VIDEO_URL_RESOLVED =
  "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=abc123";
const CHANNEL_URL_RESOLVED =
  "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=UC-MrBeast";

/** Real YouTube shape: a deep envelope around the few facts anyone wants. */
const VIDEO_REPLY = {
  kind: "youtube#videoListResponse",
  etag: "etag-v",
  pageInfo: { totalResults: 1, resultsPerPage: 1 },
  items: [
    {
      kind: "youtube#video",
      etag: "etag-vi",
      id: "abc123",
      snippet: { title: "I Built a School", channelId: "UC-MrBeast", channelTitle: "MrBeast" },
      statistics: { viewCount: "180000000", likeCount: "6000000", commentCount: "210000" }
    }
  ]
};

const CHANNEL_REPLY = {
  kind: "youtube#channelListResponse",
  etag: "etag-c",
  pageInfo: { totalResults: 1, resultsPerPage: 1 },
  items: [
    {
      kind: "youtube#channel",
      etag: "etag-ci",
      id: "UC-MrBeast",
      snippet: { title: "MrBeast", customUrl: "@mrbeast" },
      statistics: { viewCount: "60000000000", subscriberCount: "312000000", videoCount: "800" }
    }
  ]
};

const CLEAN_VIDEO = {
  title: "I Built a School",
  videoId: "abc123",
  views: 180000000,
  channelId: "UC-MrBeast"
};
const CLEAN_CHANNEL = {
  channel: "MrBeast",
  subscribers: 312000000,
  totalViews: 60000000000,
  videos: 800
};

function okJson(body: unknown): SafeFetchResult {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    url: "https://www.googleapis.com/",
    bodyText: text,
    bytesRead: text.length
  };
}

function blockNode(id: string, type: string, title: string) {
  return {
    id,
    type: "coreNode",
    position: { x: 0, y: 0 },
    data: { nodeKind: "block", type, title }
  };
}

function apiCallNode(id: string, title: string, apiUrl: string, apiOutputKey: string) {
  return {
    id,
    type: "coreNode",
    position: { x: 0, y: 0 },
    data: {
      nodeKind: "connector",
      type: API_CALL_NODE_TYPE,
      title,
      connector: "API Call",
      connectorAction: "api_call",
      apiMethod: "GET",
      apiUrl,
      apiKeySource: "none",
      apiOutputKey
    }
  };
}

/** The founder's six-node product, minus the trigger: five nodes, no Brain. */
function readThroughGraph() {
  return {
    nodes: [
      blockNode("prompt-box", BLOCK_NODE_TYPES.promptComposer, "Ask for a channel"),
      blockNode("button", BLOCK_NODE_TYPES.actionButton, "Get stats"),
      apiCallNode("api-video", "Find the video", VIDEO_URL_TEMPLATE, "video.response"),
      apiCallNode("api-channel", "Get the channel stats", CHANNEL_URL_TEMPLATE, "channel.response"),
      blockNode("result-viewer", BLOCK_NODE_TYPES.outputStage, "Result")
    ],
    edges: [
      { id: "e1", source: "prompt-box", target: "button" },
      { id: "e2", source: "button", target: "api-video" },
      { id: "e3", source: "api-video", target: "api-channel" },
      { id: "e4", source: "api-channel", target: "result-viewer" }
    ]
  };
}

type DoorPrompt = { kind: "entry" | "exit" | "presentation"; system: string; user: string };

/** Every prompt the one shared door battery was asked, in order. */
let doorPrompts: DoorPrompt[] = [];

function doorKindOf(system: string): DoorPrompt["kind"] {
  if (system.includes("entry door")) return "entry";
  if (system.includes("exit door")) return "exit";
  return "presentation";
}

/** A door battery that answers each door with a good, well-formed reply. */
function batteryAnswersEveryDoor() {
  executeWithProviderMock.mockImplementation(async (_providerId: string, request: any) => {
    const system = String(request.systemPrompt ?? "");
    const user = String(request.messages?.[0]?.content ?? "");
    const kind = doorKindOf(system);
    doorPrompts.push({ kind, system, user });

    if (kind === "entry") {
      return {
        status: "success",
        text: JSON.stringify({
          overrides: {
            apiUrl: user.includes("youtube/v3/videos") ? VIDEO_URL_RESOLVED : CHANNEL_URL_RESOLVED
          }
        })
      };
    }

    if (kind === "exit") {
      return {
        status: "success",
        text: JSON.stringify({
          clean: user.includes("Find the video") ? CLEAN_VIDEO : CLEAN_CHANNEL
        })
      };
    }

    return {
      status: "success",
      text: JSON.stringify({
        text: "MrBeast has 312 million subscribers.",
        stats: [
          { label: "Subscribers", value: "312M" },
          { label: "Total views", value: "60B" }
        ],
        chart: { type: "bar", title: "Views", series: [{ label: "I Built a School", value: 180000000 }] }
      })
    };
  });
}

async function runReadThrough(graph: unknown) {
  const result = await runWorkflowTest({
    userId: "arch-e2e",
    workflowId: "wf-e2e",
    workflowJson: graph,
    input: { latestMessage: ASKED },
    mode: "test"
  });
  const output = await resolveRunOutput(result, {
    userMessage: ASKED,
    businessName: "YouTube Stats"
  });
  return { result, output };
}

beforeEach(() => {
  vi.clearAllMocks();
  doorPrompts = [];
  getDoorBrainConfigMock.mockResolvedValue({ providerId: "gemini", modelId: null });
  resolveProviderMock.mockReturnValue({ providerId: "gemini" });
  mockSafeFetch.mockImplementation(async (url: string) =>
    okJson(String(url).includes("/videos") ? VIDEO_REPLY : CHANNEL_REPLY)
  );
  batteryAnswersEveryDoor();
});

describe("read-through: five nodes, no hand-placed Brain", () => {
  it("resolves each request, cleans each reply and presents cards with doors alone", async () => {
    const graph = readThroughGraph();
    const { result, output } = await runReadThrough(graph);

    // Every step succeeded, with no Brain anywhere in the graph.
    expect(result.logs.every((log) => log.status === "success")).toBe(true);

    // ENTRY DOORS: both addresses were resolved from what the customer typed.
    // Neither call went out still carrying a {{placeholder}}.
    const urls = mockSafeFetch.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([VIDEO_URL_RESOLVED, CHANNEL_URL_RESOLVED]);
    expect(urls.some((url) => url.includes("{{"))).toBe(false);

    // EXIT DOORS: each step's stored output is the small clean object.
    const context = result.context as Record<string, any>;
    expect(context.video.response).toEqual(CLEAN_VIDEO);
    expect(context.channel.response).toEqual(CLEAN_CHANNEL);

    // PRESENTATION DOOR: the customer gets cards and a chart, not a payload.
    expect(output.structured).not.toBeNull();
    expect(output.structured?.stats?.map((stat) => stat.label)).toEqual([
      "Subscribers",
      "Total views"
    ]);
    expect(output.structured?.chart?.type).toBe("bar");
    expect(output.text).toBe("MrBeast has 312 million subscribers.");

    // The saved graph is untouched: overrides live for one execution only.
    expect(graph.nodes[2].data.apiUrl).toBe(VIDEO_URL_TEMPLATE);
    expect(graph.nodes[3].data.apiUrl).toBe(CHANNEL_URL_TEMPLATE);
  });

  it("keeps doors invisible — never a node, never a step of their own", async () => {
    const { result } = await runReadThrough(readThroughGraph());

    // Five nodes on the canvas, five log entries. Five door calls happened in
    // between and not one of them added a line.
    expect(doorPrompts).toHaveLength(5);
    expect(result.logs.map((log) => log.nodeId)).toEqual([
      "prompt-box",
      "button",
      "api-video",
      "api-channel",
      "result-viewer"
    ]);

    // Door work is a sub-line of the node it belongs to, in plain words.
    const videoLog = result.logs.find((log) => log.nodeId === "api-video");
    expect(videoLog?.message).toContain("understood the request");
    expect(videoLog?.message).toContain("cleaned the response");

    // The Face-in blocks and the Result Viewer carry no door note at all: the
    // customer's own words are the input, and the presentation door runs where
    // the result is rendered, never as a canvas step.
    for (const nodeId of ["prompt-box", "button", "result-viewer"]) {
      const log = result.logs.find((entry) => entry.nodeId === nodeId);
      expect(log?.message).not.toContain("understood the request");
      expect(log?.message).not.toContain("cleaned the response");
    }
  });

  it("spends ONE allowance across the whole run, presentation door included", async () => {
    const { result } = await runReadThrough(readThroughGraph());

    // 2 entry + 2 exit + 1 presentation, all drawn from the same run budget.
    expect(doorPrompts.map((prompt) => prompt.kind)).toEqual([
      "entry",
      "exit",
      "entry",
      "exit",
      "presentation"
    ]);
    expect(result.doorBudget?.used).toBe(5);
    expect(result.doorBudget?.remaining).toBe(env.DOOR_BRAIN_MAX_PER_RUN - 5);
  });

  it("hands the presentation door the cleaned product, not the runner's receipt", async () => {
    await runReadThrough(readThroughGraph());

    const presentation = doorPrompts.find((prompt) => prompt.kind === "presentation");
    expect(presentation).toBeDefined();

    // It sees exactly what the exit door produced…
    expect(presentation?.user).toContain(JSON.stringify(CLEAN_CHANNEL));

    // …and none of the engine bookkeeping the log entry wraps it in. A door
    // shown "bytes" will cheerfully render it to a customer as a stat card.
    expect(presentation?.user).not.toContain("outputKey");
    expect(presentation?.user).not.toContain("bytes");
    expect(presentation?.user).not.toContain("youtube#channelListResponse");
  });

  it("never shows a later door the raw copy an earlier door already cleaned", async () => {
    await runReadThrough(readThroughGraph());

    // `video.response_raw` is kept in the run context for debugging, but the
    // whole point of the cleaning is that the noise stops travelling.
    const context = (await runReadThrough(readThroughGraph())).result.context as Record<string, any>;
    expect(context.video.response_raw).toEqual(VIDEO_REPLY);

    for (const prompt of doorPrompts) {
      expect(prompt.user).not.toContain("response_raw");
    }

    // An exit door is handed the raw reply on purpose — cleaning it IS its job.
    // Every OTHER door must be past that: once the video step is cleaned, its
    // payload stops travelling through the run.
    const laterDoors = doorPrompts.filter((prompt) => prompt.kind !== "exit");
    for (const prompt of laterDoors) {
      expect(prompt.user).not.toContain("etag-vi");
      expect(prompt.user).not.toContain("youtube#videoListResponse");
    }
  });
});

describe("read-through: a door failure degrades to today's behaviour", () => {
  it("runs the same five nodes on their saved config when the battery is down", async () => {
    executeWithProviderMock.mockRejectedValue(new Error("door battery unreachable"));

    const graph = readThroughGraph();
    const { result, output } = await runReadThrough(graph);

    // The run still succeeds — a door is an enhancement, never a dependency.
    expect(result.logs.every((log) => log.status === "success")).toBe(true);
    expect(result.logs).toHaveLength(5);

    // Each step fell back to the plain template substitution the engine has
    // always done: nothing in the run fills {{videoId}}, so it resolves to
    // nothing and the address goes out bare. That is precisely the behaviour
    // this product had before doors existed — which is what "degrades" means.
    const urls = mockSafeFetch.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=",
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id="
    ]);
    // The door never got to substitute its resolved address.
    expect(urls).not.toContain(VIDEO_URL_RESOLVED);

    // Outputs are the raw replies, unchanged and un-cleaned.
    const context = result.context as Record<string, any>;
    expect(context.video.response).toEqual(VIDEO_REPLY);
    expect(context.channel.response).toEqual(CHANNEL_REPLY);
    expect(context.video.response_raw).toBeUndefined();

    // No cards — the plain-text result, exactly as today.
    expect(output.structured).toBeNull();

    // And no door note on any line, because no door did anything.
    for (const log of result.logs) {
      expect(log.message).not.toContain("understood the request");
      expect(log.message).not.toContain("cleaned the response");
    }
  });

  it("still delivers the run when the platform has no door battery configured", async () => {
    resolveProviderMock.mockReturnValue(null);

    const { result, output } = await runReadThrough(readThroughGraph());

    expect(executeWithProviderMock).not.toHaveBeenCalled();
    expect(result.logs.every((log) => log.status === "success")).toBe(true);
    expect(output.structured).toBeNull();
    // A door that never ran costs nothing.
    expect(result.doorBudget?.used).toBe(0);
  });
});
