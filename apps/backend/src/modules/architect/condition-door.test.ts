import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE CONDITION'S ENTRY DOOR.
 *
 * A branch is only as good as the value it tests. This door removed a whole
 * node from every agent — routing used to need an AI Brain to classify and a
 * Condition to test.
 */

const execute = vi.fn();
vi.mock("../ai-provider-engine/provider-engine", () => ({
  getProviderEngine: () => ({ executeWithProvider: (...a: unknown[]) => execute(...a) })
}));
vi.mock("../admin/door-brain-settings", () => ({ getDoorBrainConfig: async () => ({ provider: "openai", model: "gpt-4o" }) }));
vi.mock("../admin/brain-slot-settings", () => ({ resolveBrainSlot: () => ({ providerId: "openai", model: "gpt-4o" }) }));

import { decideConditionRoad } from "./condition-door";

const ROADS = ["Complaint", "Question", "Spam", "Anything else"];

beforeEach(() => vi.clearAllMocks());

describe("choosing a road", () => {
  it("returns the road spelled exactly as the architect spelled it", async () => {
    // Matched case-insensitively but returned in the architect's spelling, so
    // the road on the canvas and the road taken are the same string.
    execute.mockResolvedValue({ status: "ok", structuredOutput: { choice: "complaint", why: "they are angry about a delay" } });

    const decision = await decideConditionRoad({ question: "What is this?", roads: ROADS, arrived: "my order is late" });

    expect(decision.choice).toBe("Complaint");
    expect(decision.why).toBe("they are angry about a delay");
  });

  it("refuses to invent a road that was not offered", async () => {
    // A wrong road sends a real customer somewhere nobody meant them to go.
    execute.mockResolvedValue({ status: "ok", structuredOutput: { choice: "Refund request", why: "" } });

    expect((await decideConditionRoad({ question: "What is this?", roads: ROADS, arrived: "hello" })).choice).toBeNull();
  });

  it("decides nothing when the AI cannot be reached, and says so plainly", async () => {
    // An agent must not stop because the optional half of a feature had a bad
    // minute — the caller falls back to "Anything else".
    execute.mockRejectedValue(new Error("ECONNREFUSED"));

    const decision = await decideConditionRoad({ question: "What is this?", roads: ROADS, arrived: "hello" });
    expect(decision.choice).toBeNull();
    expect(decision.why).toContain("could not be made");
  });

  it("never calls a model when there is nothing to decide", async () => {
    // A plain rule must never reach here. Business hours is a clock.
    await decideConditionRoad({ question: "", roads: ROADS, arrived: "hello" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("asks for the decision at temperature zero", async () => {
    // The same question about the same message must take the same road every
    // time, or an agent is a coin toss.
    execute.mockResolvedValue({ status: "ok", structuredOutput: { choice: "Spam", why: "it is an advert" } });

    await decideConditionRoad({ question: "What is this?", roads: ROADS, arrived: "buy cheap watches" });

    expect(execute.mock.calls[0]?.[1]).toMatchObject({ temperature: 0 });
  });

  it("reads an answer wrapped in prose or code fences", async () => {
    execute.mockResolvedValue({ status: "ok", text: '```json\n{"choice":"Question","why":"they asked about hours"}\n```' });

    expect((await decideConditionRoad({ question: "What is this?", roads: ROADS, arrived: "when do you open?" })).choice).toBe("Question");
  });
});
