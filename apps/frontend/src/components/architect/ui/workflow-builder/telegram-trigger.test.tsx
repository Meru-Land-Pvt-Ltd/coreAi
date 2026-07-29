import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveRequiredIntegrationsFromWorkflow,
  getNodeDefinition,
  requiredConnectorKeys
} from "@coreai/shared";
import { libraryGroups } from "./library";
import { NodeInspector } from "./node-inspector";
import type { BuilderNode, BuilderNodeData } from "./types";

afterEach(() => cleanup());

function telegramNode(): BuilderNode {
  const definition = getNodeDefinition("trigger.telegram_message");

  return {
    id: "telegram-trigger-1",
    type: "coreNode",
    position: { x: 0, y: 0 },
    data: {
      label: definition?.label ?? "Telegram Bot Trigger",
      title: definition?.label ?? "Telegram Bot Trigger",
      kind: "TELEGRAM",
      nodeKind: "trigger",
      type: "trigger.telegram_message",
      accent: "amber",
      icon: "telegram",
      ...(definition?.defaultConfig ?? {})
    } as BuilderNodeData
  } as BuilderNode;
}

describe("Telegram trigger architect setup", () => {
  it("is available in the trigger library with isolated-business defaults", () => {
    const triggerGroup = libraryGroups.find((group) => group.title === "Triggers");
    const item = triggerGroup?.items.find(
      (candidate) => candidate.overrides?.type === "trigger.telegram_message"
    );

    expect(item?.label).toBe("Telegram Bot Trigger");
    expect(item?.overrides?.telegramBotNameTemplate).toBe(
      "{{business.name}} Booking Assistant"
    );
    expect(item?.overrides?.telegramRequestPhone).toBe("true");
    expect(item?.overrides?.telegramBookingMode).toBe("true");
  });

  it("marks Telegram as a required integration for the workflow", () => {
    const workflow = { nodes: [telegramNode()] };

    expect(requiredConnectorKeys(workflow)).toContain("telegram");
    expect(deriveRequiredIntegrationsFromWorkflow(workflow).telegram).toBe(true);
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
      "Generated uniquely"
    );
    expect(screen.getByTestId("telegram-business-setup-requirement").textContent).toContain(
      "booking calendar"
    );
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
