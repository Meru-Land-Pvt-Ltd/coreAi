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
    // Business-scoped copy, never a hardcoded business name.
    expect(item?.overrides?.telegramBotNameTemplate).toContain("{{business.name}}");
  });

  /* The trigger must drop into ANY workflow — a shop, a gym, a law firm — not
     only an appointment bot. Booking commands and contact collection are opt-in
     so a new bot starts as a plain message trigger the workflow answers. */
  it("defaults to a general-purpose bot, with booking features opt-in", () => {
    const triggerGroup = libraryGroups.find((group) => group.title === "Triggers");
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
