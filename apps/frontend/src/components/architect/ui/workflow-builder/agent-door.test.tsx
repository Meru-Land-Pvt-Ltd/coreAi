import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentDoor } from "./agent-door";
import type { WayIn } from "@coreai/shared";

/**
 * THE DOOR, FROM THE CUSTOMER'S CHAIR (2026-08-27). A paying architect
 * pressing Preview must meet the honest room for their agent — never a
 * costume, never a dead end. These are the door's own component exams.
 */

afterEach(cleanup);

const telegramWay: WayIn = { kind: "telegram", why: "This agent answers on Telegram — its customers live in a chat app, not on a web page." };

describe("the agent door", () => {
  it("a Telegram agent without a bot meets the connect room — token box, one button, plain help", () => {
    render(
      <AgentDoor way={telegramWay} agentName="Helper" logs={[]} running={false} onRun={() => undefined} />
    );
    expect(screen.getByTestId("agent-door-why").textContent).toContain("Telegram");
    expect(screen.getByTestId("agent-door-telegram-token")).toBeTruthy();
    expect(screen.getByTestId("agent-door-telegram-connect-button").textContent).toContain("Connect");
  });

  it("the connect button stays asleep until a real token is pasted, then fires with it", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(
      <AgentDoor
        way={telegramWay}
        agentName="Helper"
        onConnectTelegram={onConnect}
        logs={[]}
        running={false}
        onRun={() => undefined}
      />
    );
    const button = screen.getByTestId("agent-door-telegram-connect-button");
    expect(button.hasAttribute("disabled")).toBe(true);
    await user.type(screen.getByTestId("agent-door-telegram-token"), "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(button.hasAttribute("disabled")).toBe(false);
    await user.click(button);
    expect(onConnect).toHaveBeenCalledWith("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });

  it("a connected bot shows the open-the-bot room, never the token box again", () => {
    render(
      <AgentDoor
        way={telegramWay}
        agentName="Helper"
        telegram={{ connected: true, botUsername: "Triven1Bot", botUrl: "https://t.me/Triven1Bot" } as never}
        logs={[]}
        running={false}
        onRun={() => undefined}
      />
    );
    expect(screen.getByTestId("agent-door-telegram-connected").textContent).toContain("Triven1Bot");
    expect(screen.getByTestId("agent-door-telegram-open").getAttribute("href")).toBe("https://t.me/Triven1Bot");
    expect(screen.queryByTestId("agent-door-telegram-token")).toBeNull();
  });

  it("an email agent meets the test-email room and its Run button runs", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(
      <AgentDoor
        way={{ kind: "email", why: "This agent answers email — its customer is an inbox." }}
        agentName="Mailer"
        logs={[]}
        running={false}
        onRun={onRun}
        testEmail=""
        onTestEmailChange={() => undefined}
      />
    );
    expect(screen.getByTestId("agent-door-test-email")).toBeTruthy();
    await user.click(screen.getByTestId("agent-door-run"));
    expect(onRun).toHaveBeenCalled();
  });

  it("an empty canvas says so honestly — and offers the Builder, not a costume", () => {
    render(
      <AgentDoor
        way={{ kind: "empty", why: "There is nothing on the canvas yet." }}
        agentName=""
        logs={[]}
        running={false}
        onRun={() => undefined}
      />
    );
    expect(screen.getByTestId("agent-door-empty").textContent).toContain("AI Builder");
  });

  it("the run log renders each step in plain words", () => {
    render(
      <AgentDoor
        way={{ kind: "whatsapp", why: "This agent answers on WhatsApp — its customers live in a chat app." }}
        agentName="Helper"
        logs={[
          { nodeId: "a", label: "Telegram message", status: "success", message: "A sample message arrived." },
          { nodeId: "b", label: "Thinker", status: "error", message: "The AI could not be reached." }
        ]}
        running={false}
        onRun={() => undefined}
      />
    );
    const log = screen.getByTestId("agent-door-log");
    expect(log.textContent).toContain("A sample message arrived.");
    expect(log.textContent).toContain("could not be reached");
  });
});
