import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * MINIMISE MUST MEAN MINIMISE (2026-08-28).
 *
 * The AI Builder dock was mounted only while open, so closing it destroyed
 * the panel and every message in it. The founder opened the Builder, got an
 * answer, minimised it to read the node settings it was covering, opened it
 * again — and found an empty box with no way back to what it had told him.
 *
 * And the progress line: the composer streams what it is actually doing
 * ("Laying out 3 steps: Telegram → AI Brain → Send reply"), and the panel
 * threw the sentence away and flipped a two-item canned animation on a timer
 * instead. The architect watched a fake animation while the real account of
 * the work went in the bin.
 *
 * Both are decisions, so both are held here as decisions.
 */

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("the Builder dock is minimised, never destroyed", () => {
  it("stays mounted when it is closed", () => {
    const view = readFileSync(join(__dirname, "..", "workflow-builder-view.tsx"), "utf8");
    const dock = view.slice(view.indexOf('data-testid="build-ai-builder-dock"'));

    /* Mounted and hidden — not behind a ternary that unmounts it. */
    expect(dock.slice(0, 400)).toContain("hidden={!aiBuilderOpen}");
    expect(
      view,
      "the dock must not be wrapped in `aiBuilderOpen ? ... : null` — that throws the conversation away"
    ).not.toContain("{aiBuilderOpen ? (");
  });
});

describe("the architect sees the Builder's real words", () => {
  it("uses the line the server sent, not a canned animation", () => {
    const panel = read("ai-builder-panel.tsx");

    /* The compose callback must pass the server's sentence through. */
    expect(panel).toContain("if (line) setStage(line);");

    /* And the indicator must prefer it over the fixed list. */
    expect(panel).toContain("{stage || PROGRESS_STAGES[progressStage]}");
  });

  it("never shows a bare spinner with no words", () => {
    const panel = read("ai-builder-panel.tsx");
    /* A status is set the moment the architect presses send, before the
       server has said anything — the router runs first and that is the
       longest silent part of the wait. */
    expect(panel).toContain('setStage("Reading what you asked");');
    expect(panel).toContain('setStage(PROGRESS_STAGES[0]);');
  });
});

describe("the Builder sits in the centre", () => {
  it("is centred and wide, not squeezed into a corner", () => {
    const view = readFileSync(join(__dirname, "..", "workflow-builder-view.tsx"), "utf8");
    const dock = view.slice(view.indexOf('data-testid="build-ai-builder-dock"'));

    /* The founder pointed at Higgsfield: a conversation that composes a whole
       agent does not belong in a phone-width box in the corner. */
    expect(dock.slice(0, 700)).toContain("left-1/2");
    expect(dock.slice(0, 700)).toContain("-translate-x-1/2");
    expect(dock.slice(0, 700)).not.toContain("right-6");
  });
});
