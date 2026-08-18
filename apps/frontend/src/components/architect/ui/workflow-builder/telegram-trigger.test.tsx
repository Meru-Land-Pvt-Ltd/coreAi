import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveRequiredIntegrationsFromWorkflow,
  getNodeDefinition,
  requiredConnectorKeys
} from "@coreai/shared";
import { libraryGroups } from "./library";
import { NodeInspector } from "./node-inspector";
import { CoreNode } from "./core-node";
import { ReactFlowProvider } from "@xyflow/react";
import type { BuilderNode, BuilderNodeData } from "./types";

afterEach(() => cleanup());

function telegramNode(): BuilderNode {
  const definition = getNodeDefinition("trigger.telegram_message");

  return {
    id: "telegram-trigger-1",
    type: "coreNode",
    position: { x: 0, y: 0 },
    data: {
      label: definition?.label ?? "Telegram message",
      title: definition?.label ?? "Telegram message",
      kind: "TELEGRAM",
      nodeKind: "trigger",
      type: "trigger.telegram_message",
      accent: "blue",
      icon: "telegram",
      ...(definition?.defaultConfig ?? {})
    } as BuilderNodeData
  } as BuilderNode;
}

function telegramSendMessageNode(): BuilderNode {
  const definition = getNodeDefinition("action.telegram_send_message");
  return {
    id: "telegram-send-1",
    type: "coreNode",
    position: { x: 0, y: 0 },
    data: {
      label: definition?.label ?? "Send Telegram",
      title: definition?.label ?? "Send Telegram",
      kind: "TELEGRAM",
      nodeKind: "connector",
      type: "action.telegram_send_message",
      accent: "blue",
      icon: "telegram",
      ...(definition?.defaultConfig ?? {})
    } as BuilderNodeData
  } as BuilderNode;
}

describe("Telegram trigger architect setup", () => {
  it("is available in the trigger library with isolated-business defaults", () => {
    const triggerGroup = libraryGroups.find((group) => group.title === "Hands");
    const item = triggerGroup?.items.find(
      (candidate) => candidate.overrides?.type === "trigger.telegram_message"
    );

    expect(item?.label).toBe("Telegram message");
    expect(item?.accent).toBe("blue");
    expect(item?.icon).toBe("telegram");
    // Business-scoped copy, never a hardcoded business name.
    expect(item?.overrides?.telegramBotNameTemplate).toContain("{{business.name}}");
  });

  /* The trigger must drop into ANY workflow — a shop, a gym, a law firm — not
     only an appointment bot. Booking commands and contact collection are opt-in
     so a new bot starts as a plain message trigger the workflow answers. */
  it("defaults to a general-purpose bot, with booking features opt-in", () => {
    const triggerGroup = libraryGroups.find((group) => group.title === "Hands");
    const item = triggerGroup?.items.find(
      (candidate) => candidate.overrides?.type === "trigger.telegram_message"
    );

    expect(item?.overrides?.telegramBookingMode).toBe("false");
    expect(item?.overrides?.telegramRequestPhone).toBe("false");
    for (const command of [
      "telegramServicesCommand",
      "telegramBookCommand",
      "telegramMyBookingsCommand",
      "telegramRescheduleCommand",
      "telegramCancelCommand"
    ]) {
      expect(item?.overrides?.[command]).toBe("false");
    }
    // /help stays on — it is useful for every bot, booking or not.
    expect(item?.overrides?.telegramHelpCommand).toBe("true");
    // Default copy must not presuppose appointments.
    expect(String(item?.overrides?.telegramWelcomeMessage)).not.toMatch(/book|appointment|service/i);
  });

  it("marks Telegram as a required integration for the workflow", () => {
    const workflow = { nodes: [telegramNode()] };

    expect(requiredConnectorKeys(workflow)).toContain("telegram");
    expect(deriveRequiredIntegrationsFromWorkflow(workflow).telegram).toBe(true);
  });

  it("exposes the Telegram Send Message action for confirmations", () => {
    const telegramGroup = libraryGroups.find((group) => group.title === "Telegram Features");
    expect(telegramGroup?.items.map((item) => item.overrides?.type)).toContain("action.telegram_send_message");
  });

  it("uses one mandatory catch-all output connection", () => {
    const { container } = render(
      <ReactFlowProvider>
        <CoreNode {...({ id: "telegram-trigger-1", data: telegramNode().data, selected: false } as any)} />
      </ReactFlowProvider>
    );

    const outputs = container.querySelectorAll(".react-flow__handle.source");
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.getAttribute("data-handleid")).toBe("*");
    expect(outputs[0]?.getAttribute("aria-label")).toBe("All Telegram updates");
  });

  it("routes messages to customers or the connected owner without exposing chat IDs", () => {
    const onUpdateNodeData = vi.fn();
    render(
      <NodeInspector
        selectedNode={telegramSendMessageNode()}
        onClearSelection={vi.fn()}
        onUpdateNodeData={onUpdateNodeData}
        onDeleteNode={vi.fn()}
      />
    );

    const recipient = screen.getByTestId("telegram-recipient-source") as HTMLSelectElement;
    expect(Array.from(recipient.options).map((option) => option.text)).toContain("Connected business owner");
    expect(screen.queryByTestId("telegram-chat-id-expression")).toBeNull();

    fireEvent.change(recipient, { target: { value: "business_owner" } });
    expect(onUpdateNodeData).toHaveBeenCalledWith("telegramRecipientSource", "business_owner");
  });

  it("shows Telegram-specific settings and saves edits to the node", () => {
    const onUpdateNodeData = vi.fn();

    render(
      <NodeInspector
        selectedNode={telegramNode()}
        onClearSelection={vi.fn()}
        onUpdateNodeData={onUpdateNodeData}
        onDeleteNode={vi.fn()}
      />
    );

    expect(screen.getByTestId("telegram-bot-username-policy").textContent).toContain(
      "BotFather token"
    );
    expect(screen.getByTestId("telegram-business-setup-requirement").textContent).toContain(
      "BotFather token"
    );
    expect(screen.getByTestId("telegram-business-setup-requirement").textContent).toContain(
      "Business Profile"
    );
    expect(screen.getByTestId("telegram-business-setup-requirement").textContent).toContain(
      "Test tab"
    );
    expect(screen.queryByText("Command menu")).toBeNull();
    expect((screen.getByTestId("telegram-event-type") as HTMLSelectElement).value).toBe("message");

    fireEvent.change(screen.getByTestId("telegram-welcome-message"), {
      target: { value: "Welcome to our booking bot." }
    });

    expect(onUpdateNodeData).toHaveBeenCalledWith(
      "telegramWelcomeMessage",
      "Welcome to our booking bot."
    );
  });
});
