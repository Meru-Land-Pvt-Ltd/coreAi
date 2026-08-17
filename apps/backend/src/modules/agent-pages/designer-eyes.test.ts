import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The eyes' one promise: the designer never again says "done" when the page
 * did not change. Three behaviours carry it: a cold verdict call, honest
 * failure (null, never a fake verdict), and a skeleton faithful enough that
 * order and count are visible in it.
 */

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../ai-provider-engine/provider-engine", () => ({
  getProviderEngine: () => ({ executeWithProvider: mocks.execute })
}));

import { layoutSkeleton, verifyDesignChange } from "./designer-eyes";
import type { ProductSpec } from "@coreai/shared";

function spec(blocks: unknown[]): ProductSpec {
  return {
    version: 1,
    theme: { accent: "#f59e0b", mode: "light" },
    nav: { title: "T", links: [], footerLinks: [] },
    pages: [{ id: "home", title: "Home", path: "", blocks }]
  } as unknown as ProductSpec;
}

const inputFirst = spec([
  { id: "a", type: "input", label: "Your prompt", wire: { role: "input", nodeId: "n1" } },
  { id: "b", type: "result", variant: "auto", wire: { role: "output", nodeId: "n2" } }
]);
const resultFirst = spec([
  { id: "b", type: "result", variant: "auto", wire: { role: "output", nodeId: "n2" } },
  { id: "a", type: "input", label: "Your prompt", wire: { role: "input", nodeId: "n1" } }
]);

beforeEach(() => mocks.execute.mockReset());

describe("layoutSkeleton", () => {
  it("shows on-screen order, so 'above' is checkable", () => {
    const before = layoutSkeleton(inputFirst);
    const after = layoutSkeleton(resultFirst);
    expect(before.indexOf("input")).toBeLessThan(before.indexOf("result"));
    expect(after.indexOf("result")).toBeLessThan(after.indexOf("input"));
  });
});

describe("verifyDesignChange", () => {
  const args = {
    brain: { providerId: "claude", model: "claude-opus-5" },
    instruction: "put the result above the prompt",
    before: inputFirst,
    after: resultFirst,
    workflowId: "wf-1"
  };

  it("returns the verdict and passes the model + zero temperature", async () => {
    mocks.execute.mockResolvedValue({
      status: "success",
      structuredOutput: { satisfied: true, problems: [] }
    });

    const verdict = await verifyDesignChange(args);

    expect(verdict).toEqual({ satisfied: true, problems: [] });
    const [providerId, request] = mocks.execute.mock.calls[0];
    expect(providerId).toBe("claude");
    expect(request.model).toBe("claude-opus-5");
    expect(request.temperature).toBe(0);
    expect(request.task).toBe("smart-designer-eyes");
  });

  it("carries the problems back word for word", async () => {
    mocks.execute.mockResolvedValue({
      status: "success",
      structuredOutput: { satisfied: false, problems: ["the result still sits below the input"] }
    });

    const verdict = await verifyDesignChange(args);
    expect(verdict?.satisfied).toBe(false);
    expect(verdict?.problems).toEqual(["the result still sits below the input"]);
  });

  it("parses a text answer when structuredOutput is absent", async () => {
    mocks.execute.mockResolvedValue({
      status: "success",
      text: 'Sure: { "satisfied": false, "problems": ["nothing moved"] }'
    });

    const verdict = await verifyDesignChange(args);
    expect(verdict).toEqual({ satisfied: false, problems: ["nothing moved"] });
  });

  it("returns null on engine failure — never a fake verdict", async () => {
    mocks.execute.mockResolvedValue({ status: "error", error: "boom" });
    expect(await verifyDesignChange(args)).toBeNull();

    mocks.execute.mockImplementation(async () => { throw new Error("down"); });
    expect(await verifyDesignChange(args)).toBeNull();
  });

  it("treats junk output as null, not as satisfied", async () => {
    mocks.execute.mockResolvedValue({ status: "success", text: "all good!" });
    expect(await verifyDesignChange(args)).toBeNull();
  });
});
