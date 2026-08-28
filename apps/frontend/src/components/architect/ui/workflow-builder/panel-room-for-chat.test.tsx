import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiBuilderPanel } from "./ai-builder-panel";

/**
 * THE CHAT IS THE PRODUCT, SO THE CHAT GETS THE ROOM (2026-08-28).
 *
 * Four controls used to stand above the conversation, each on its own line:
 * the yardstick, a full-width "Check my agent", a paragraph explaining what
 * the Generate button does, and the Generate button. With the input and the
 * Teach link below, six blocks left the conversation a thin strip in the
 * middle of a 540-pixel panel. The founder saw it immediately: "that takes a
 * lot of space, so user feels very less space for chatting."
 *
 * The rule this test holds: ONE row of controls above the chat, and no
 * paragraph explaining a button that is standing right next to it.
 */

vi.mock("@/components/architect/features/api", () => ({
  getAgentPageConfig: vi.fn(async () => ({ success: true, data: { page: null } })),
  smartComposeProduct: vi.fn(),
  checkMyAgent: vi.fn(),
  saveWorkflowPurpose: vi.fn(),
  teachBuilderLesson: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  apiPost: vi.fn(async () => ({ success: true, data: {} })),
  apiGet: vi.fn(async () => ({ success: true, data: {} })),
  getAuthToken: () => "test-token"
}));

describe("the AI Builder panel leaves room to chat", () => {
  it("puts every control in ONE row above the conversation", () => {
    render(<AiBuilderPanel workflowId="wf-1" canvasHasSteps />);

    /* One row holds them all. Before this there were four separate blocks,
       three of them full width, stacked down the panel. */
    const row = screen.getByTestId("ai-builder-actions");
    expect(row).toBeTruthy();

    const check = screen.queryByTestId("ai-builder-check");
    const design = screen.queryByTestId("smart-designer-generate");
    for (const control of [check, design]) {
      if (!control) continue;
      expect(row.contains(control)).toBe(true);
      /* A control in a row is a chip, never a full-width bar — a bar is what
         ate the panel. */
      expect(control.className).not.toContain("w-full");
    }
  });

  it("never explains a button that is standing right beside it", () => {
    render(<AiBuilderPanel workflowId="wf-1" canvasHasSteps />);

    /* "I read your whole workflow — every question your steps need answered
       — and design the smallest page that does the job." Three lines of
       prose describing the button underneath it. One fact, one place. */
    expect(screen.queryByText(/I read your whole workflow/)).toBeNull();
    expect(screen.queryByTestId("smart-designer-intro")).toBeNull();
  });
});
