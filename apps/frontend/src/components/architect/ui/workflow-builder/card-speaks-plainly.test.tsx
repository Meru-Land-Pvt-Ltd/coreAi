import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { CoreNode } from "./core-node";

/**
 * A CARD SAYS WHAT A STEP GIVES IN THREE LINES (2026-08-28).
 *
 * The Telegram trigger printed twenty-four raw names on its card —
 * `trigger.telegram.callback.data`, `trigger.telegram.sender.lastName` — and
 * a three-step agent read as a control panel. The founder's question was the
 * right one: what does a paying architect DO with that? Almost nothing.
 *
 * The exact names are not thrown away. They are one hover from the card, and
 * in the panel and the docs, for the rare moment somebody needs a field by
 * name.
 */

beforeEach(cleanup);

function renderCard(type: string) {
  return render(
    <ReactFlowProvider>
      <CoreNode
        id="n1"
        type="core"
        selected={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        draggable
        selectable
        deletable
        data={{ type, title: "Telegram message received", icon: "telegram" } as never}
      />
    </ReactFlowProvider>
  );
}

describe("the node card speaks the architect's language", () => {
  it("summarises the Telegram trigger instead of printing 24 names", () => {
    renderCard("trigger.telegram_message");

    const gives = screen.getByTestId("core-node-gives");
    expect(gives.textContent).toContain("the message");

    /* The wall is gone: no raw dotted name is printed on the card. */
    expect(gives.textContent).not.toContain("trigger.telegram.callback.data");
    expect(gives.textContent).not.toContain("sender.lastName");
  });

  it("says how many it did not list, rather than hiding them", () => {
    renderCard("trigger.telegram_message");
    expect(screen.getByTestId("core-node-gives-more").textContent).toMatch(/\+\d+ more/);
  });

  it("keeps every exact name one hover away", () => {
    renderCard("trigger.telegram_message");
    /* Nothing is lost — an architect who needs the real field name still has
       it without leaving the canvas. */
    const title = screen.getByTestId("core-node-gives").getAttribute("title") ?? "";
    expect(title).toContain("trigger.telegram.sender.firstName");
  });
});
