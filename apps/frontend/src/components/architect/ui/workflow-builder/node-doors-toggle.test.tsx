import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BLOCK_NODE_TYPES,
  DOOR_BEARING_NODE_TYPES,
  NODE_DOORS_DISABLED_KEY,
  API_CALL_NODE_TYPE
} from "@coreai/shared";
import { NodeInspector } from "./node-inspector";
import { defaultNodeData } from "./node-defaults";
import type { BuilderNode, BuilderNodeData, NodeKind } from "./types";

/**
 * The doors built inside a step are invisible on the canvas — the only place an
 * architect ever meets them is one quiet switch under Advanced settings, and
 * only on the steps that actually carry doors.
 */

const { listArchitectSecretsMock } = vi.hoisted(() => ({
  listArchitectSecretsMock: vi.fn()
}));

// The inspector imports several named exports from the api module; only the
// secrets lister matters here, so keep the rest present as no-ops.
vi.mock("../../features/api", () => ({
  listArchitectSecrets: listArchitectSecretsMock,
  listWhatsAppConnections: vi.fn().mockResolvedValue({ success: true, data: { connections: [] } }),
  getCalendlyConnectorStatus: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getCalendlyOAuthUrl: vi.fn(),
  disconnectCalendlyConnector: vi.fn()
}));

beforeEach(() => {
  listArchitectSecretsMock.mockReset();
  listArchitectSecretsMock.mockResolvedValue({ success: true, data: { secrets: [] } });
});

afterEach(() => cleanup());

function node(type: string, nodeKind: NodeKind, data: Partial<BuilderNodeData> = {}): BuilderNode {
  return {
    id: "node-1",
    type: "coreNode",
    position: { x: 0, y: 0 },
    data: { ...defaultNodeData(nodeKind, { type }), ...data } as BuilderNodeData
  } as BuilderNode;
}

function renderInspector(selectedNode: BuilderNode) {
  const onUpdateNodeData = vi.fn();
  render(
    <NodeInspector
      selectedNode={selectedNode}
      onClearSelection={vi.fn()}
      onUpdateNodeData={onUpdateNodeData}
      onDeleteNode={vi.fn()}
    />
  );
  return { onUpdateNodeData };
}

async function openAdvanced() {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId("node-advanced-settings-toggle"));
  return user;
}

/** Product sections use the block frame; everything else is engine chrome. */
function kindFor(type: string): NodeKind {
  return type.startsWith("block.") ? "block" : "connector";
}

describe("Smart input & output switch — which steps show it", () => {
  it.each(DOOR_BEARING_NODE_TYPES)("shows it on %s", async (type) => {
    renderInspector(node(type, kindFor(type)));
    await openAdvanced();

    expect(screen.getByTestId("node-doors-toggle")).toBeTruthy();
    expect(screen.getByText("Smart input & output")).toBeTruthy();
    expect(
      screen.getByText("Lets this step understand what arrives and tidy what it returns.")
    ).toBeTruthy();
  });

  it("shows it on a legacy Calendly slug too", async () => {
    renderInspector(node("action.calendly_get_event_details", "connector"));
    await openAdvanced();

    expect(screen.getByTestId("node-doors-toggle")).toBeTruthy();
  });

  it("never shows it on a step that has no doors", async () => {
    renderInspector(node("ai.memory", "ai"));
    await openAdvanced();

    expect(screen.getByTestId("node-advanced-settings")).toBeTruthy();
    expect(screen.queryByTestId("node-doors-toggle")).toBeNull();
  });

  it("never shows it on the customer's own input sections", async () => {
    renderInspector(node(BLOCK_NODE_TYPES.promptComposer, "block"));

    // Face-in blocks keep their jargon-free frame: no Advanced drawer at all.
    expect(screen.queryByTestId("node-advanced-settings-toggle")).toBeNull();
    expect(screen.queryByTestId("node-doors-toggle")).toBeNull();
  });

  it("stays hidden until Advanced settings is opened", async () => {
    renderInspector(node(API_CALL_NODE_TYPE, "connector"));

    await screen.findByTestId("node-advanced-settings-toggle");
    expect(screen.queryByTestId("node-doors-toggle")).toBeNull();
  });

  it("gives the result section the switch alone — no engine jargon", async () => {
    renderInspector(node(BLOCK_NODE_TYPES.outputStage, "block"));
    await openAdvanced();

    expect(screen.getByTestId("node-doors-toggle")).toBeTruthy();
    expect(screen.queryByTestId("node-advanced-input")).toBeNull();
    expect(screen.queryByTestId("node-advanced-output")).toBeNull();
    expect(screen.queryByTestId("node-advanced-variables")).toBeNull();
    expect(screen.queryByTestId("node-advanced-developer")).toBeNull();
  });
});

describe("Smart input & output switch — what it writes", () => {
  it("is on by default", async () => {
    renderInspector(node(API_CALL_NODE_TYPE, "connector"));
    await openAdvanced();

    expect(screen.getByTestId("node-doors-toggle").getAttribute("aria-checked")).toBe("true");
  });

  it("turning it off stores the disabled flag", async () => {
    const { onUpdateNodeData } = renderInspector(node(API_CALL_NODE_TYPE, "connector"));
    const user = await openAdvanced();

    await user.click(screen.getByTestId("node-doors-toggle"));

    expect(onUpdateNodeData).toHaveBeenCalledWith(NODE_DOORS_DISABLED_KEY, "true");
  });

  it("reads as off when the flag is already stored, and turning it back on clears it", async () => {
    const { onUpdateNodeData } = renderInspector(
      node(API_CALL_NODE_TYPE, "connector", { [NODE_DOORS_DISABLED_KEY]: "true" })
    );
    const user = await openAdvanced();

    const toggle = screen.getByTestId("node-doors-toggle");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await user.click(toggle);
    expect(onUpdateNodeData).toHaveBeenCalledWith(NODE_DOORS_DISABLED_KEY, "false");
  });
});
