import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API_CALL_NODE_TYPE, API_CALL_YOUTUBE_PRESET } from "@coreai/shared";
import { NodeInspector } from "./node-inspector";
import { libraryGroups } from "./library";
import { defaultNodeData } from "./node-defaults";
import type { BuilderNode, BuilderNodeData } from "./types";

const { listArchitectSecretsMock } = vi.hoisted(() => ({
  listArchitectSecretsMock: vi.fn()
}));

// Only the secrets lister is exercised here; the inspector imports several
// other named exports from the api module, so keep them present as no-ops.
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

function apiNode(data: Partial<BuilderNodeData> = {}): BuilderNode {
  return {
    id: "api-1",
    type: "coreNode",
    position: { x: 0, y: 0 },
    data: {
      ...defaultNodeData("connector", {
        type: API_CALL_NODE_TYPE,
        connector: "API Call",
        connectorAction: "http_request"
      }),
      ...data
    } as BuilderNodeData
  } as BuilderNode;
}

function renderInspector(data: Partial<BuilderNodeData> = {}) {
  const onUpdateNodeData = vi.fn();
  render(
    <NodeInspector
      selectedNode={apiNode(data)}
      onClearSelection={vi.fn()}
      onUpdateNodeData={onUpdateNodeData}
      onDeleteNode={vi.fn()}
    />
  );
  return { onUpdateNodeData };
}

describe("API Call node — palette", () => {
  it("appears in the Hands group with the customer-word label and stable testid", () => {
    /* Renamed by the founder 2026-08-26: the card IS the factory — it calls
       any app, and can become a new node in the toolkit. */
    const hands = libraryGroups.find((group) => group.title === "Hands");
    expect(hands).toBeDefined();

    const item = hands?.items.find((i) => i.overrides?.type === API_CALL_NODE_TYPE);
    expect(item).toBeDefined();
    expect(item?.label).toBe("Create Node");
    expect(item?.icon).toBe("globe");
    expect(item?.accent).toBe("amber");
    // Registry testid stays stable for Playwright.
    expect(item?.testId).toBe("node-action-api-call");
  });
});

describe("API Call node — inspector", () => {
  it("renders the core fields: method, URL, key source, output key", () => {
    renderInspector();

    expect(screen.getByTestId("node-inspector-api-method")).toBeDefined();
    expect(screen.getByTestId("node-inspector-api-url")).toBeDefined();
    expect(screen.getByTestId("node-inspector-api-key-source")).toBeDefined();
    expect(screen.getByTestId("node-inspector-api-output-key")).toBeDefined();
    expect(screen.getByTestId("node-inspector-api-youtube-preset")).toBeDefined();
  });

  it("one-click YouTube preset writes a working platform-key config", async () => {
    const user = userEvent.setup();
    const { onUpdateNodeData } = renderInspector();

    await user.click(screen.getByTestId("node-inspector-api-youtube-preset"));

    // Every preset field is written through onUpdateNodeData.
    for (const [key, value] of Object.entries(API_CALL_YOUTUBE_PRESET)) {
      expect(onUpdateNodeData).toHaveBeenCalledWith(key, value);
    }
    expect(onUpdateNodeData).toHaveBeenCalledWith("apiKeySource", "platform_youtube");
  });

  it("shows the body field only for POST", async () => {
    const user = userEvent.setup();
    renderInspector({ apiMethod: "GET" });
    expect(screen.queryByTestId("node-inspector-api-body")).toBeNull();

    cleanup();
    renderInspector({ apiMethod: "POST" });
    expect(screen.getByTestId("node-inspector-api-body")).toBeDefined();
  });

  it("reveals key-injection fields once a key source is chosen", () => {
    renderInspector({ apiKeySource: "none" });
    expect(screen.queryByTestId("node-inspector-api-key-injection")).toBeNull();

    cleanup();
    renderInspector({ apiKeySource: "platform_youtube", apiKeyInjection: "query" });
    expect(screen.getByTestId("node-inspector-api-key-injection")).toBeDefined();
    expect(screen.getByTestId("node-inspector-api-key-param")).toBeDefined();
  });

  it("offers saved key names as a dropdown when the locker returns keys", async () => {
    listArchitectSecretsMock.mockResolvedValue({
      success: true,
      data: {
        secrets: [
          { id: "1", name: "weather", maskedValue: "••••", createdAt: "", updatedAt: "" },
          { id: "2", name: "stocks", maskedValue: "••••", createdAt: "", updatedAt: "" }
        ]
      }
    });

    renderInspector({ apiKeySource: "my_key" });

    await waitFor(() => {
      const select = screen.getByTestId("node-inspector-api-key-name") as HTMLSelectElement;
      const values = Array.from(select.options).map((o) => o.value);
      expect(values).toContain("weather");
      expect(values).toContain("stocks");
    });
  });

  it("falls back to a plain key-name field when the locker is empty or unavailable", async () => {
    listArchitectSecretsMock.mockResolvedValue({ success: true, data: { secrets: [] } });

    renderInspector({ apiKeySource: "my_key" });

    await waitFor(() => {
      const field = screen.getByTestId("node-inspector-api-key-name");
      // A text input, not a <select>.
      expect(field.tagName.toLowerCase()).toBe("input");
    });
  });
});
