import { describe, it, expect, vi, beforeEach } from "vitest";
import { SCRIPT_NODE_TYPE } from "@coreai/shared";

/**
 * The composer was asked for on one condition: use only existing nodes, no
 * custom code execution. That condition is why its output can be trusted
 * without reading it — every step in what it builds is a step the platform
 * already tested.
 *
 * The Code step arriving on the palette is exactly the thing that could quietly
 * end that, so it is pinned here rather than left to a comment.
 */

vi.mock("../../admin/node-controls", () => ({
  pausedNodeTypes: vi.fn(async () => new Map<string, string>())
}));
vi.mock("../../connectors/registry", () => ({ allConnectors: () => [] }));
vi.mock("../../connectors/architect-frames", () => ({ readyFramesFor: async () => [] }));

import { composerMenu } from "./node-menu";
import { pausedNodeTypes } from "../../admin/node-controls";

beforeEach(() => {
  vi.mocked(pausedNodeTypes).mockResolvedValue(new Map());
});

describe("the admin switches actually reach the composer", () => {
  it("throws away nothing an admin set — a Map is looked up by node type, an array is not", async () => {
    const { hiddenArchitectNodeTypes } = await import("@coreai/shared");
    const rows = [{ nodeType: "communication.send_sms", visible: false, label: null, group: null }];

    // What the route used to pass, behind an `as never` cast.
    const asArray = hiddenArchitectNodeTypes(
      rows.map((r) => ({ type: r.nodeType, visible: r.visible, label: r.label, group: r.group })) as never
    );
    // What it passes now.
    const asMap = hiddenArchitectNodeTypes(
      new Map(rows.map((r) => [r.nodeType, { visible: r.visible, label: r.label, group: r.group }]))
    );

    expect(asArray).not.toContain("communication.send_sms");
    expect(asMap).toContain("communication.send_sms");
  });
});

describe("what the composer is allowed to build with", () => {
  it("never offers the Code step", async () => {
    const menu = await composerMenu("architect-1");
    expect(menu.some((entry) => entry.type === SCRIPT_NODE_TYPE)).toBe(false);
  });

  it("still offers the ordinary steps, so this is a rule and not an empty menu", async () => {
    const menu = await composerMenu("architect-1");
    // The five a receptionist is made of were once filtered out by accident and
    // the composer chose WhatsApp for somebody who telephoned. Never again.
    expect(menu.length).toBeGreaterThan(5);
    expect(menu.some((entry) => entry.type === "communication.send_sms")).toBe(true);
  });

  it("does not offer a step an admin has paused", async () => {
    vi.mocked(pausedNodeTypes).mockResolvedValue(new Map([["communication.send_sms", "texts are misfiring"]]));
    const menu = await composerMenu("architect-1");
    expect(menu.some((entry) => entry.type === "communication.send_sms")).toBe(false);
  });

  it("still builds a menu when the paused list cannot be read", async () => {
    // A database blip must not leave an architect with nothing to build from.
    vi.mocked(pausedNodeTypes).mockRejectedValue(new Error("db is down"));
    const menu = await composerMenu("architect-1");
    expect(menu.length).toBeGreaterThan(5);
  });
});
