import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The builder view imports React Flow's stylesheet; keep the test pipeline
// out of the PostCSS/Tailwind chain — styles are irrelevant to these tests.
vi.mock("@xyflow/react/dist/style.css", () => ({}));

import { EmptyCanvasFacePicker, nextSelectedNodeId } from "./workflow-builder-view";

/**
 * Canvas polish trio, view-level pieces:
 *
 * - Empty-canvas Face picker: shows only while the canvas has zero pieces,
 *   inserts through the same template path the sidebar cards use (onPick
 *   receives the sidebar slug), and vanishes the moment any piece exists.
 * - Graph reload contract helper: the selection survives a server reload
 *   only while its node still exists.
 */

afterEach(() => cleanup());

const LIVE_FACE_SLUGS = ["chatbot", "voice-agent", "image-studio", "form-tool"] as const;

describe("EmptyCanvasFacePicker", () => {
  it("shows on an empty canvas: title, the four live Face cards, and the drag hint", () => {
    render(<EmptyCanvasFacePicker nodeCount={0} importingSlug={null} onPick={vi.fn()} onComposed={() => undefined} />);

    expect(screen.getByTestId("canvas-picker")).toBeDefined();
    expect(screen.getByTestId("canvas-picker-title").textContent).toBe("What are you building?");
    for (const slug of LIVE_FACE_SLUGS) {
      expect(screen.getByTestId(`canvas-picker-${slug}`)).toBeDefined();
    }
    expect(screen.getByTestId("canvas-picker-drag-hint").textContent).toBe(
      "or drag pieces from the left panel"
    );
  });

  it("clicking a Face card inserts through the sidebar template path (slug passed to onPick)", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<EmptyCanvasFacePicker nodeCount={0} importingSlug={null} onPick={onPick} onComposed={() => undefined} />);

    for (const slug of LIVE_FACE_SLUGS) {
      await user.click(screen.getByTestId(`canvas-picker-${slug}`));
      expect(onPick).toHaveBeenLastCalledWith(slug);
    }
    expect(onPick).toHaveBeenCalledTimes(LIVE_FACE_SLUGS.length);
  });

  it("disappears the moment any piece exists on the canvas", () => {
    const { rerender } = render(
      <EmptyCanvasFacePicker nodeCount={0} importingSlug={null} onPick={vi.fn()} onComposed={() => undefined} />
    );
    expect(screen.getByTestId("canvas-picker")).toBeDefined();

    rerender(<EmptyCanvasFacePicker nodeCount={1} importingSlug={null} onPick={vi.fn()} onComposed={() => undefined} />);
    expect(screen.queryByTestId("canvas-picker")).toBeNull();
  });

  it("locks the cards while a template import is in flight", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<EmptyCanvasFacePicker nodeCount={0} importingSlug="chatbot" onPick={onPick} onComposed={() => undefined} />);

    const card = screen.getByTestId("canvas-picker-chatbot") as HTMLButtonElement;
    expect(card.disabled).toBe(true);
    expect(card.textContent).toContain("Setting things up...");
    await user.click(screen.getByTestId("canvas-picker-voice-agent"));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("keeps the copy jargon-free", () => {
    render(<EmptyCanvasFacePicker nodeCount={0} importingSlug={null} onPick={vi.fn()} onComposed={() => undefined} />);
    const text = (screen.getByTestId("canvas-picker").textContent ?? "").toLowerCase();
    for (const banned of ["workflow", "node", "dry run", "execution", "token", "webhook", "payload"]) {
      expect(text.includes(banned), `copy contains "${banned}"`).toBe(false);
    }
  });
});

describe("nextSelectedNodeId (graph reload contract)", () => {
  const nodes = [{ id: "brain-1" }, { id: "blk-output" }];

  it("preserves the selection while its node still exists", () => {
    expect(nextSelectedNodeId("brain-1", nodes)).toBe("brain-1");
  });

  it("clears the selection when the reloaded graph no longer has the node", () => {
    expect(nextSelectedNodeId("gone-node", nodes)).toBeNull();
  });

  it("keeps an empty selection empty", () => {
    expect(nextSelectedNodeId(null, nodes)).toBeNull();
  });
});
