import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * MEMORY'S EXIT DOOR.
 *
 * When there is more to remember than a step can be handed, something has to
 * go. Cutting the end off is the cheap answer and the wrong one: a conversation
 * opens with a name, a date and what somebody wanted, and closes with
 * pleasantries. Truncating keeps the pleasantries.
 */

const execute = vi.fn();
vi.mock("../ai-provider-engine/provider-engine", () => ({
  getProviderEngine: () => ({ executeWithProvider: (...a: unknown[]) => execute(...a) })
}));
vi.mock("../admin/door-brain-settings", () => ({ getDoorBrainConfig: async () => ({ provider: "openai", model: "gpt-4o" }) }));
vi.mock("../admin/brain-slot-settings", () => ({ resolveBrainSlot: () => ({ providerId: "openai", model: "gpt-4o" }) }));

import { roughlyTooLong, shortenMemory } from "./memory-door";

beforeEach(() => vi.clearAllMocks());

describe("when it shortens at all", () => {
  it("leaves a short memory completely alone, and never calls a model", async () => {
    // Most runs are short. Putting a model call on every one of them would be
    // indefensible.
    expect(await shortenMemory("the customer asked about opening hours", 4000)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("knows when there is more than a step can be handed", () => {
    expect(roughlyTooLong("x".repeat(100), 4000)).toBe(false);
    expect(roughlyTooLong("x".repeat(20_000), 4000)).toBe(true);
  });
});

describe("what it keeps", () => {
  it("shortens what is too long, keeping the facts", async () => {
    execute.mockResolvedValue({ status: "ok", text: "Name: Ana. Wants Tuesday 3pm. Promised a callback." });

    const shortened = await shortenMemory("x".repeat(30_000), 1000);

    expect(shortened).toContain("Tuesday");
    // The instruction is what makes the difference between summarising and
    // truncating — the facts are named, the small talk is named.
    const sent = String(execute.mock.calls[0]?.[1]?.systemPrompt ?? "");
    expect(sent).toContain("KEEP");
    expect(sent).toContain("DROP");
  });

  it("remembers the same conversation the same way twice", async () => {
    // At any temperature above zero an agent can contradict itself between runs
    // about what it was told.
    execute.mockResolvedValue({ status: "ok", text: "short" });
    await shortenMemory("x".repeat(30_000), 1000);
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ temperature: 0 });
  });

  it("keeps the original when the summary is not actually shorter", async () => {
    // A summary longer than what it summarised is not a summary.
    execute.mockResolvedValue({ status: "ok", text: "y".repeat(50_000) });
    expect(await shortenMemory("x".repeat(30_000), 1000)).toBeNull();
  });

  it("keeps the original when the AI cannot be reached", async () => {
    // Too much memory is a far smaller problem than none.
    execute.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await shortenMemory("x".repeat(30_000), 1000)).toBeNull();
  });
});
