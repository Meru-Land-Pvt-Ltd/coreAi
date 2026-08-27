import { API_CALL_NODE_TYPE } from "@coreai/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE TWO DOORS — runtime wiring.
 *
 * A node that talks to the outside world runs its entry door before it executes
 * and its exit door after. This suite pins the contract the runner owns:
 *
 *   • the entry door's resolved settings apply to THIS execution only — the
 *     saved graph is never touched, and identity fields can never be rewritten;
 *   • the exit door's cleaning replaces the node's output, with the raw reply
 *     kept at `<key>_raw` for debugging;
 *   • the quiet "Smart input & output" toggle turns both off;
 *   • one door allowance is shared by the whole run;
 *   • a door that fails leaves the node running exactly as it does today;
 *   • door work is a sub-line of the node's own log — never a separate entry.
 *
 * A true unit test: no network, no database, no model.
 */

// Real budget, real skip heuristics — only the two door calls are stubbed.
vi.mock("../agent-runtime/node-doors", async (importActual) => {
  const actual = await importActual<typeof import("../agent-runtime/node-doors")>();
  return { ...actual, runEntryDoor: vi.fn(), runExitDoor: vi.fn() };
});
vi.mock("../../lib/safe-fetch", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/safe-fetch")>();
  return { ...actual, safeFetch: vi.fn() };
});
vi.mock("../calendly/calendly-connector", async (importActual) => {
  const actual = await importActual<typeof import("../calendly/calendly-connector")>();
  return { ...actual, calendlyGetUser: vi.fn() };
});
vi.mock("../../lib/prisma", () => ({
  prisma: { workflowDefinition: { findUnique: vi.fn(), findFirst: vi.fn() } }
}));
vi.mock("../memory", () => ({
  createWorkflowRun: vi.fn(async () => ({ workflowRunId: "run-doors", threadId: "thread-doors" })),
  completeWorkflowRun: vi.fn(async () => undefined),
  failWorkflowRun: vi.fn(async () => undefined),
  runAiBrainNode: vi.fn(async () => ({
    status: "success",
    text: "",
    providerId: "gemini",
    modelName: "test-model"
  })),
  memoryBroker: { saveNodeMemory: vi.fn(async () => undefined) },
  buildSmartMemory: vi.fn(async () => ""),
  resolveSmartMemoryForQuery: vi.fn(async () => ""),
  mergeMemoryIntoPrompt: vi.fn((prompt: string) => prompt)
}));

import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { safeFetch, type SafeFetchResult } from "../../lib/safe-fetch";
import { calendlyGetUser } from "../calendly/calendly-connector";
import { runEntryDoor, runExitDoor, type DoorBudget } from "../agent-runtime/node-doors";
import { refuseUnsafeDoorOverrides, runWorkflowTest } from "./workflow-runner";

const mockSafeFetch = vi.mocked(safeFetch);
/* Owner-scoped since the platform audit (2026-08-27): a chained step may
   only hand over to an agent the SAME architect owns. */
const mockFindWorkflow = vi.mocked(prisma.workflowDefinition.findFirst);
const mockEntryDoor = vi.mocked(runEntryDoor);
const mockExitDoor = vi.mocked(runExitDoor);

const TEMPLATED_URL = "https://api.example.com/stats?handle={{handle}}";
const RESOLVED_URL = "https://api.example.com/stats?handle=%40mrbeast";

/** A fat reply — nested and long enough that an exit door earns its cost. */
const FAT_REPLY = {
  kind: "youtube#channelListResponse",
  etag: "etag-1",
  pageInfo: { totalResults: 1, resultsPerPage: 1 },
  items: [
    {
      kind: "youtube#channel",
      etag: "etag-2",
      id: "UC-1",
      statistics: { viewCount: "1000", subscriberCount: "312000000", videoCount: "800" }
    }
  ]
};

function okJson(body: unknown): SafeFetchResult {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    url: "https://api.example.com/",
    bodyText: text,
    bytesRead: text.length
  };
}

function apiCallNode(id: string, data: Record<string, unknown> = {}) {
  return {
    id,
    type: "coreNode",
    position: { x: 0, y: 0 },
    data: {
      label: "Get the channel stats",
      title: "Get the channel stats",
      nodeKind: "connector",
      type: API_CALL_NODE_TYPE,
      connector: "API Call",
      connectorAction: "api_call",
      apiMethod: "GET",
      apiUrl: TEMPLATED_URL,
      apiKeySource: "none",
      apiOutputKey: "api.response",
      ...data
    }
  };
}

function workflowOf(...nodes: ReturnType<typeof apiCallNode>[]) {
  return { nodes, edges: [] as Array<{ id: string; source: string; target: string }> };
}

async function run(workflowJson: unknown) {
  return runWorkflowTest({
    userId: "arch-doors",
    workflowId: "wf-doors",
    workflowJson,
    input: { latestMessage: "How many subscribers does MrBeast have?" },
    mode: "test"
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSafeFetch.mockResolvedValue(okJson({ ok: true }));
  mockEntryDoor.mockResolvedValue({ overrides: {} });
  mockExitDoor.mockImplementation(async ({ rawOutput }) => ({ value: rawOutput, changed: false }));
});

describe("node doors in the workflow runner", () => {
  it("applies the entry door's resolved request to this execution only", async () => {
    mockEntryDoor.mockResolvedValue({ overrides: { apiUrl: RESOLVED_URL } });

    const workflowJson = workflowOf(apiCallNode("api-1"));
    const result = await run(workflowJson);

    // The step called the address the door resolved, not the saved template.
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    expect(mockSafeFetch.mock.calls[0][0]).toBe(RESOLVED_URL);

    // The saved graph is untouched — overrides live for one execution.
    expect(workflowJson.nodes[0].data.apiUrl).toBe(TEMPLATED_URL);

    // The door saw the node's settings, never its identity.
    const doorCall = mockEntryDoor.mock.calls[0][0];
    expect(doorCall.nodeType).toBe(API_CALL_NODE_TYPE);
    expect(doorCall.node.config).toMatchObject({ apiUrl: TEMPLATED_URL, apiMethod: "GET" });
    expect(doorCall.node.config).not.toHaveProperty("type");
    expect(doorCall.node.config).not.toHaveProperty("nodeKind");
    expect(doorCall.node.config).not.toHaveProperty("connectorAction");
    expect(doorCall.context.userMessage).toBe("How many subscribers does MrBeast have?");

    // One node, one log line, with the door as a sub-line of it.
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].nodeId).toBe("api-1");
    expect(result.logs[0].message).toContain("· understood the request");
    expect(result.logs[0].status).toBe("success");
  });

  it("never lets a door re-point the node at another action", async () => {
    mockEntryDoor.mockResolvedValue({
      overrides: {
        apiUrl: RESOLVED_URL,
        type: "communication.send_email",
        nodeKind: "ai",
        connectorAction: "send_email",
        title: "Renamed by a door"
      }
    });

    const result = await run(workflowOf(apiCallNode("api-1")));

    // Still an API Call, still labelled by the architect — only the request moved.
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    expect(mockSafeFetch.mock.calls[0][0]).toBe(RESOLVED_URL);
    expect(result.logs[0].label).toBe("Get the channel stats");
  });

  it("stores the exit door's cleaning at the output key and keeps the raw reply", async () => {
    mockSafeFetch.mockResolvedValue(okJson(FAT_REPLY));
    const cleaned = { channel: "MrBeast", subscribers: "312000000", views: "1000" };
    mockExitDoor.mockResolvedValue({ value: cleaned, changed: true });

    const result = await run(workflowOf(apiCallNode("api-1")));
    const context = result.context as Record<string, any>;

    // The door was handed the parsed reply, not a string.
    expect(mockExitDoor).toHaveBeenCalledTimes(1);
    expect(mockExitDoor.mock.calls[0][0].rawOutput).toEqual(FAT_REPLY);

    // Later steps read the small useful object…
    expect(context.api.response).toEqual(cleaned);
    expect(context["api.response"]).toBe(JSON.stringify(cleaned));

    // …and the raw reply stays available for debugging only.
    expect(context.api.response_raw).toEqual(FAT_REPLY);
    expect(context["api.response_raw"]).toBe(JSON.stringify(FAT_REPLY));

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].message).toContain("· cleaned the response");
  });

  it("runs both doors on one node as a single sub-line", async () => {
    mockSafeFetch.mockResolvedValue(okJson(FAT_REPLY));
    mockEntryDoor.mockResolvedValue({ overrides: { apiUrl: RESOLVED_URL } });
    mockExitDoor.mockResolvedValue({ value: { subscribers: "312000000" }, changed: true });

    const result = await run(workflowOf(apiCallNode("api-1")));

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].message).toContain("· understood the request · cleaned the response");
  });

  it("skips both doors when smart input & output is turned off", async () => {
    mockSafeFetch.mockResolvedValue(okJson(FAT_REPLY));

    const result = await run(workflowOf(apiCallNode("api-1", { doorsDisabled: "true" })));
    const context = result.context as Record<string, any>;

    expect(mockEntryDoor).not.toHaveBeenCalled();
    expect(mockExitDoor).not.toHaveBeenCalled();

    // The step ran on the saved config, resolved the old way.
    expect(mockSafeFetch.mock.calls[0][0]).toBe("https://api.example.com/stats?handle=");
    expect(context.api.response).toEqual(FAT_REPLY);
    expect(context.api.response_raw).toBeUndefined();
    expect(result.logs[0].message).not.toContain("·");
  });

  it("never opens a door on a node type that has none", async () => {
    const conditionNode = {
      id: "cond-1",
      type: "coreNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Open right now?",
        nodeKind: "condition",
        type: "condition.business_hours",
        condition: "business_hours"
      }
    };

    const result = await runWorkflowTest({
      userId: "arch-doors",
      workflowId: "wf-doors",
      workflowJson: { nodes: [conditionNode], edges: [] },
      mode: "test"
    });

    expect(mockEntryDoor).not.toHaveBeenCalled();
    expect(mockExitDoor).not.toHaveBeenCalled();
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].message).not.toContain("·");
  });

  it("shares one door allowance across the whole run and stops at it", async () => {
    const seen: Array<{ budget: DoorBudget; remainingOnEntry: number }> = [];
    mockEntryDoor.mockImplementation(async ({ budget }) => {
      seen.push({ budget, remainingOnEntry: budget.remaining });
      // Spend the run's whole allowance on the first node's door.
      while (budget.take()) {
        /* drain */
      }
      return { overrides: {} };
    });

    const first = await run(workflowOf(apiCallNode("api-1"), apiCallNode("api-2")));

    expect(seen).toHaveLength(2);
    // ONE budget object for the run — not one per node.
    expect(seen[1].budget).toBe(seen[0].budget);
    expect(seen[0].remainingOnEntry).toBe(env.DOOR_BRAIN_MAX_PER_RUN);
    // The second node's door found the allowance already spent…
    expect(seen[1].remainingOnEntry).toBe(0);
    expect(seen[1].budget.take()).toBe(false);
    // …and both steps still ran, exactly as they do today.
    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    expect(first.logs.every((log) => log.status === "success")).toBe(true);

    // A second run starts with a fresh allowance.
    const second = await run(workflowOf(apiCallNode("api-3")));
    expect(seen).toHaveLength(3);
    expect(seen[2].budget).not.toBe(seen[0].budget);
    expect(seen[2].remainingOnEntry).toBe(env.DOOR_BRAIN_MAX_PER_RUN);
    expect(second.logs.every((log) => log.status === "success")).toBe(true);
  });

  it("leaves the node exactly as it is today when a door fails", async () => {
    mockSafeFetch.mockResolvedValue(okJson(FAT_REPLY));
    mockEntryDoor.mockRejectedValue(new Error("door model unreachable"));
    mockExitDoor.mockRejectedValue(new Error("door model unreachable"));

    const result = await run(workflowOf(apiCallNode("api-1")));
    const context = result.context as Record<string, any>;

    // Saved config, raw reply, one clean success log, no door sub-line.
    expect(mockSafeFetch.mock.calls[0][0]).toBe("https://api.example.com/stats?handle=");
    expect(context.api.response).toEqual(FAT_REPLY);
    expect(context.api.response_raw).toBeUndefined();
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].status).toBe("success");
    expect(result.logs[0].message).not.toContain("·");
  });

  it("keeps a text reply as text after cleaning it", async () => {
    const longText = `Channel report. ${"MrBeast has 312,000,000 subscribers. ".repeat(20)}`;
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/plain" },
      url: "https://api.example.com/",
      bodyText: longText,
      bytesRead: longText.length
    });
    mockExitDoor.mockResolvedValue({ value: { subscribers: "312000000" }, changed: true });

    const result = await run(workflowOf(apiCallNode("api-1")));
    const context = result.context as Record<string, any>;

    // The step produced words, so it still produces words — a later
    // {{api.response}} must never read back "[object Object]".
    expect(typeof context.api.response).toBe("string");
    expect(context.api.response).toBe(JSON.stringify({ subscribers: "312000000" }));
    expect(context.api.response_raw).toBe(longText);
  });

  it("cleans a hand's output at its own key, not only the API Call's", async () => {
    const availabilityNode = {
      id: "cal-1",
      type: "coreNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Check the calendar",
        nodeKind: "connector",
        type: "calendar.availability",
        connector: "Google Calendar",
        connectorAction: "check_availability",
        slotsToOffer: 3
      }
    };
    const cleaned = { day: "today", freeTimes: ["10:00 AM", "2:00 PM", "4:30 PM"] };
    mockExitDoor.mockResolvedValue({ value: cleaned, changed: true });

    const result = await runWorkflowTest({
      userId: "arch-doors",
      workflowId: "wf-doors",
      workflowJson: { nodes: [availabilityNode], edges: [] },
      mode: "test"
    });
    const context = result.context as Record<string, any>;

    expect(mockExitDoor).toHaveBeenCalledTimes(1);
    expect(mockExitDoor.mock.calls[0][0].nodeType).toBe("calendar.availability");
    expect(context.calendarAvailability).toEqual(cleaned);
    expect(context.calendarAvailability_raw).toMatchObject({ source: "example" });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].message).toContain("· cleaned the response");
  });

  it("never cleans a reply an earlier step left at the same key", async () => {
    const profile = {
      resource: {
        uri: "https://api.calendly.com/users/U1",
        name: "Dr Rivera",
        email: "dr@example.com",
        scheduling_url: "https://calendly.com/dr-rivera",
        current_organization: { uri: "https://api.calendly.com/organizations/O1", plan: "pro" }
      }
    };
    vi.mocked(calendlyGetUser).mockResolvedValue(profile as never);
    mockExitDoor.mockResolvedValue({ value: { name: "Dr Rivera" }, changed: true });

    const calendlyNode = (id: string, x: number, connectorAction: string) => ({
      id,
      type: "coreNode",
      position: { x, y: 0 },
      data: {
        label: `Calendly ${connectorAction}`,
        nodeKind: "connector",
        type: "action.calendly",
        connector: "Calendly",
        connectorAction
      }
    });

    const result = await runWorkflowTest({
      userId: "arch-doors",
      workflowId: "wf-doors",
      // Second node waits for input it was never given, so it writes nothing.
      workflowJson: {
        nodes: [calendlyNode("cal-1", 0, "get_my_profile"), calendlyNode("cal-2", 100, "find_available_times")],
        edges: []
      },
      mode: "test"
    });
    const context = result.context as Record<string, any>;

    // Only the step that actually produced a reply spent an exit door.
    expect(mockExitDoor).toHaveBeenCalledTimes(1);
    expect(context.calendly.result).toEqual({ name: "Dr Rivera" });
    expect(context.calendly.result_raw).toEqual(profile);

    const waiting = result.logs.find((log) => log.nodeId === "cal-2");
    expect(waiting?.status).toBe("waiting");
    expect(waiting?.message).not.toContain("·");
  });

  it("does not spend an exit door on a step that failed", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { "content-type": "application/json" },
      url: "https://api.example.com/",
      bodyText: JSON.stringify({ error: { code: 404, message: "not found" } }),
      bytesRead: 40
    });

    const result = await run(workflowOf(apiCallNode("api-1")));

    expect(mockExitDoor).not.toHaveBeenCalled();
    expect(result.logs[0].status).toBe("error");
  });

  /**
   * The presentation door runs AFTER the engine returns, inside
   * `resolveRunOutput`. It can only share this run's allowance if the runner
   * hands that allowance back — otherwise a run that already spent all 8 door
   * calls would quietly be granted a 9th.
   */
  it("hands the run's remaining door allowance back for the presentation door", async () => {
    let spentByNodes: DoorBudget | undefined;
    mockEntryDoor.mockImplementation(async ({ budget }) => {
      spentByNodes = budget;
      budget.take();
      budget.take();
      return { overrides: {} };
    });

    const result = await run(workflowOf(apiCallNode("api-1")));

    // The very object the node doors spent — not a copy, not a fresh one.
    expect(result.doorBudget).toBe(spentByNodes);
    expect(result.doorBudget?.used).toBe(2);
    expect(result.doorBudget?.remaining).toBe(env.DOOR_BRAIN_MAX_PER_RUN - 2);
  });

  it("leaves nothing for the presentation door once the run's allowance is gone", async () => {
    mockEntryDoor.mockImplementation(async ({ budget }) => {
      while (budget.take()) {
        /* drain the whole run's allowance */
      }
      return { overrides: {} };
    });

    const result = await run(workflowOf(apiCallNode("api-1")));

    expect(result.doorBudget?.remaining).toBe(0);
    // What resolveRunOutput will ask, and must be refused.
    expect(result.doorBudget?.take()).toBe(false);
  });
});

/* ------------------ one request, one allowance, however wired ------------- */

describe("a chained workflow cannot mint a second door allowance", () => {
  /**
   * A "Next Workflow" step runs a whole second workflow inside the first. If
   * that child started its own allowance, an architect could chain four
   * workflows together and quietly turn one visitor's click into four times the
   * door spend — a cost ceiling that can be multiplied is not a ceiling. The
   * allowance therefore belongs to the REQUEST, and rides the chain into every
   * workflow the request reaches.
   */
  function nextWorkflowNode(id: string, targetId: string) {
    return {
      id,
      type: "coreNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Next Workflow",
        title: "Next Workflow",
        nodeKind: "connector",
        type: "action.trigger_next_workflow",
        connector: "Triven",
        connectorAction: "trigger_next_workflow",
        nextWorkflowId: targetId
      }
    };
  }

  it("hands the parent's allowance to the workflow it chains into", async () => {
    const seen: DoorBudget[] = [];
    mockEntryDoor.mockImplementation(async ({ budget }) => {
      seen.push(budget);
      budget.take();
      return { overrides: {} };
    });

    mockFindWorkflow.mockResolvedValue({
      id: "wf-child",
      name: "Child",
      workflowJson: workflowOf(apiCallNode("api-child"))
    } as never);

    const parent = {
      nodes: [apiCallNode("api-parent"), nextWorkflowNode("next-1", "wf-child")],
      edges: [] as Array<{ id: string; source: string; target: string }>
    };

    await run(parent);

    // Both doors ran, and both were handed the very same allowance object.
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[0].used).toBe(2);
    expect(seen[0].max).toBe(env.DOOR_BRAIN_MAX_PER_RUN);
  });

  it("leaves a chained run with nothing to spend once the parent used it all", async () => {
    const seen: DoorBudget[] = [];
    mockEntryDoor.mockImplementation(async ({ budget }) => {
      seen.push(budget);
      // The parent's own door drains the whole request allowance.
      while (budget.take()) {
        /* spend it */
      }
      return { overrides: {} };
    });

    mockFindWorkflow.mockResolvedValue({
      id: "wf-child",
      name: "Child",
      workflowJson: workflowOf(apiCallNode("api-child"))
    } as never);

    await run({
      nodes: [apiCallNode("api-parent"), nextWorkflowNode("next-1", "wf-child")],
      edges: [] as Array<{ id: string; source: string; target: string }>
    });

    expect(seen).toHaveLength(2);
    expect(seen[1].remaining).toBe(0);
    expect(seen[1].take()).toBe(false);
  });
});

/* -------- a door fills in the request, never who it is sent to ------------ */

describe("an entry door can never send the architect's key somewhere new", () => {
  /**
   * The API Call step attaches a key AFTER the entry door has run. If the door
   * could rewrite the whole address, a stranger's words on a published page
   * could aim that key at a host they own and read it out of the query string.
   * So the saved address pins the origin: path and parameters are the door's,
   * the host is not.
   */
  const SAVED = "https://www.googleapis.com/youtube/v3/channels?id={{handle}}";

  // The origin pin is unconditional once an address is saved, so these use the
  // no-key form the test harness can actually fetch with. The key-carrying case
  // is the last test in this block.
  function keyedApiNode(id: string, data: Record<string, unknown> = {}) {
    return apiCallNode(id, { apiUrl: SAVED, apiKeySource: "none", ...data });
  }

  it("keeps a door's rewritten path and parameters on the saved host", async () => {
    const resolved = "https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=%40mrbeast";
    mockEntryDoor.mockResolvedValue({ overrides: { apiUrl: resolved } });

    await run(workflowOf(keyedApiNode("api-1")));

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    expect(String(mockSafeFetch.mock.calls[0][0])).toContain(resolved.split("?")[0]);
    expect(String(mockSafeFetch.mock.calls[0][0])).toContain("forHandle=%40mrbeast");
  });

  it("refuses an address on a different host and calls the saved one instead", async () => {
    mockEntryDoor.mockResolvedValue({
      overrides: { apiUrl: "https://collector.evil.example.com/steal?part=statistics" }
    });

    const result = await run(workflowOf(keyedApiNode("api-1")));

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const called = String(mockSafeFetch.mock.calls[0][0]);
    expect(called).not.toContain("evil.example.com");
    expect(called).toContain("www.googleapis.com");
    // The refused override is not a failure — the step ran on what was saved.
    expect(result.logs[0].status).toBe("success");
    expect(result.logs[0].message).not.toContain("understood the request");
  });

  it("refuses a different port or scheme on the saved host", async () => {
    mockEntryDoor.mockResolvedValue({ overrides: { apiUrl: "http://www.googleapis.com:8080/x" } });

    await run(workflowOf(keyedApiNode("api-1")));

    expect(String(mockSafeFetch.mock.calls[0][0])).toContain("https://www.googleapis.com/youtube/v3/channels");
  });

  it("refuses to invent a host for a step that carries a key", async () => {
    // Nothing saved to pin to, and a key waiting to be attached.
    mockEntryDoor.mockResolvedValue({ overrides: { apiUrl: "https://anything.example.com/x" } });

    const result = await run(
      workflowOf(apiCallNode("api-1", { apiUrl: "", apiKeySource: "my_key", apiKeyName: "yt" }))
    );

    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(result.logs[0].status).toBe("error");
  });

  it("lets a door choose the host when the step carries no key at all", async () => {
    // The founder's case: an architect who configured nothing. There is no
    // credential to leak, and safeFetch still refuses anything internal.
    mockEntryDoor.mockResolvedValue({ overrides: { apiUrl: "https://api.example.com/open" } });

    await run(workflowOf(apiCallNode("api-1", { apiUrl: "", apiKeySource: "none" })));

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    expect(mockSafeFetch.mock.calls[0][0]).toBe("https://api.example.com/open");
  });
});

/**
 * TWO HOLES THE PLATFORM AUDIT FOUND (2026-08-27), locked shut.
 *
 * Both were the same species of failure: a value arriving from the world
 * deciding something only the architect should decide.
 */
describe("what a door may never decide", () => {
  it("a door may FILL an empty destination but never REPLACE the architect's own", () => {
    /* The door is fed a stranger's raw words. Some node types whitelisted
       their destination field, so a customer texting a business could steer
       which number that business's account texts — on the business's bill. */
    const pinned = refuseUnsafeDoorOverrides(
      { id: "n1", data: { type: "communication.send_sms", smsTo: "+15550001111" } } as never,
      "communication.send_sms",
      { smsTo: "+15559999999", smsBody: "hello" }
    );
    expect(pinned.smsTo).toBeUndefined();
    expect(pinned.smsBody).toBe("hello");

    const filled = refuseUnsafeDoorOverrides(
      { id: "n2", data: { type: "communication.send_sms", smsTo: "" } } as never,
      "communication.send_sms",
      { smsTo: "+15559999999" }
    );
    expect(filled.smsTo).toBe("+15559999999");

    /* A saved {{template}} is a placeholder the door is meant to fill, not a
       decision the architect wrote down. */
    const templated = refuseUnsafeDoorOverrides(
      { id: "n3", data: { type: "communication.send_sms", smsTo: "{{customer.phone}}" } } as never,
      "communication.send_sms",
      { smsTo: "+15551234567" }
    );
    expect(templated.smsTo).toBe("+15551234567");
  });
});
