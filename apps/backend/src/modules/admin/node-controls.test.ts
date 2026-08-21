import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What a business is shown when Triven switches a step off inside an agent
 * they are paying for.
 *
 * The failure this prevents is quiet: a text that stops arriving, a booking
 * that stops landing, and a business concluding the product is broken. From
 * where they are sitting that is a fair reading, so the sentence has to reach
 * the screen they actually look at.
 */

const findMany = vi.fn();
const definitionFindMany = vi.fn();

vi.mock("../../lib/prisma", () => ({
  prisma: {
    architectNodeVisibility: { findMany: (...args: unknown[]) => findMany(...args) },
    workflowDefinition: { findMany: (...args: unknown[]) => definitionFindMany(...args) }
  }
}));

import { pausedStepsForWorkflows, invalidatePausedCache } from "./node-controls";

const graph = (types: string[]) => ({
  nodes: types.map((type, index) => ({ id: `n${index}`, data: { type, title: `Step ${index}` } }))
});

beforeEach(() => {
  vi.clearAllMocks();
  invalidatePausedCache();
});

describe("telling a business which of their steps is paused", () => {
  it("says nothing, and reads no graphs at all, when nothing is paused", async () => {
    findMany.mockResolvedValue([]);

    const result = await pausedStepsForWorkflows(["wf-1", "wf-2"]);

    expect(result.size).toBe(0);
    // The ordinary case is every page load of every business on the platform.
    // It must not cost a query per agent to discover that all is well.
    expect(definitionFindMany).not.toHaveBeenCalled();
  });

  it("names the step and gives the reason, in a sentence they can read", async () => {
    findMany.mockResolvedValue([{ nodeType: "communication.send_sms", pausedReason: "texts are misfiring" }]);
    definitionFindMany.mockResolvedValue([
      { id: "wf-1", workflowJson: graph(["trigger.twilio_missed_call", "communication.send_sms"]) }
    ]);

    const steps = (await pausedStepsForWorkflows(["wf-1"])).get("wf-1");

    expect(steps).toHaveLength(1);
    expect(steps?.[0].label).toBe("Step 1");
    expect(steps?.[0].message).toContain("texts are misfiring");
    // The reassurance is the part that stops a support ticket.
    expect(steps?.[0].message).toContain("rest of your agent carried on");
  });

  it("mentions a step once, however many times the agent uses it", async () => {
    findMany.mockResolvedValue([{ nodeType: "communication.send_sms", pausedReason: "misfiring" }]);
    definitionFindMany.mockResolvedValue([
      { id: "wf-1", workflowJson: graph(["communication.send_sms", "communication.send_sms", "communication.send_sms"]) }
    ]);

    expect((await pausedStepsForWorkflows(["wf-1"])).get("wf-1")).toHaveLength(1);
  });

  it("leaves an agent out entirely when none of its steps are paused", async () => {
    findMany.mockResolvedValue([{ nodeType: "communication.send_sms", pausedReason: "misfiring" }]);
    definitionFindMany.mockResolvedValue([
      { id: "wf-1", workflowJson: graph(["communication.send_sms"]) },
      { id: "wf-2", workflowJson: graph(["ai.context_reply"]) }
    ]);

    const result = await pausedStepsForWorkflows(["wf-1", "wf-2"]);
    expect([...result.keys()]).toEqual(["wf-1"]);
  });

  it("stays quiet rather than breaking the page when a graph cannot be read", async () => {
    findMany.mockResolvedValue([{ nodeType: "communication.send_sms", pausedReason: "misfiring" }]);
    definitionFindMany.mockRejectedValue(new Error("db is down"));

    // Their agents list is more important than this notice.
    await expect(pausedStepsForWorkflows(["wf-1"])).resolves.toEqual(new Map());
  });

  it("copes with a graph that has no nodes at all", async () => {
    findMany.mockResolvedValue([{ nodeType: "communication.send_sms", pausedReason: "misfiring" }]);
    definitionFindMany.mockResolvedValue([{ id: "wf-1", workflowJson: {} }, { id: "wf-2", workflowJson: null }]);

    await expect(pausedStepsForWorkflows(["wf-1", "wf-2"])).resolves.toEqual(new Map());
  });
});
