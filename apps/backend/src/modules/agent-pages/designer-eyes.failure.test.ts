import { expect, it, vi } from "vitest";

/**
 * The one guarantee that must hold even when everything else is on fire: a
 * throwing engine can never crash the designer or produce a fake verdict —
 * the look degrades to "unchecked" (null). Kept in its own file: alongside
 * the other eyes tests the runner mis-attributes the deliberately thrown
 * mock error to the test itself; isolated, the same assertion is stable.
 */
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../ai-provider-engine/provider-engine", () => ({
  getProviderEngine: () => ({ executeWithProvider: mocks.execute })
}));

import { verifyDesignChange } from "./designer-eyes";
import type { ProductSpec } from "@coreai/shared";

const empty = {
  version: 1,
  theme: { accent: "#f59e0b", mode: "light" },
  nav: { title: "T", links: [], footerLinks: [] },
  pages: []
} as unknown as ProductSpec;

it("a throwing engine yields null — never a crash, never a fake verdict", async () => {
  mocks.execute.mockImplementation(() => {
    throw new Error("down");
  });

  const verdict = await verifyDesignChange({
    brain: { providerId: "claude", model: "claude-opus-5" },
    instruction: "move the result up",
    before: empty,
    after: empty,
    workflowId: "wf-1"
  });

  expect(verdict).toBeNull();
});
