import { describe, expect, it } from "vitest";
import {
  architectTelegramTestInteraction,
  renderArchitectTelegramTestTemplate
} from "./architect-telegram-test-connector";
import type { NormalizedTelegramEvent } from "./telegram-update";

function event(text: string, options?: { callbackData?: string; phone?: string }): NormalizedTelegramEvent {
  return {
    provider: "TELEGRAM",
    updateId: "1",
    eventType: options?.callbackData ? "callback_query" : text.startsWith("/") ? "command" : "message",
    businessId: "architect-test-business",
    installedAgentId: "architect-test-agent",
    telegramConnectionId: "architect-test-connection",
    bot: { id: "100", username: "architect_test_bot" },
    chat: { id: "customer-chat", type: "private" },
    sender: {
      id: "customer-user",
      isBot: false,
      username: "test_customer",
      firstName: "Test",
      lastName: "Customer",
      languageCode: "en"
    },
    message: { id: "10", text, caption: "", date: "2026-08-05T00:00:00.000Z" },
    callback: { id: options?.callbackData ? "callback-1" : "", data: options?.callbackData ?? "" },
    contact: {
      phoneNumber: options?.phone ?? "",
      firstName: "Test",
      lastName: "Customer",
      userId: "customer-user"
    },
    media: { type: "", fileId: "", fileName: "", mimeType: "" },
    location: { latitude: null, longitude: null }
  };
}

describe("Architect Telegram test interactions", () => {
  it("renders the Test business name in welcome and custom-command replies", () => {
    expect(renderArchitectTelegramTestTemplate("Hi {{business.name}}", "Acme Salon")).toBe("Hi Acme Salon");

    const welcome = architectTelegramTestInteraction({
      event: event("/start"),
      triggerData: { telegramWelcomeMessage: "Hi! You're chatting with {{business.name}}." },
      context: { businessName: "Acme Salon", services: ["Haircut"] },
      workflowName: "Workflow",
      currentSession: null
    });
    expect(welcome?.text).toBe("Hi! You're chatting with Acme Salon.");

    const custom = architectTelegramTestInteraction({
      event: event("/contact"),
      triggerData: {
        telegramCustomCommands: [{
          command: "contact",
          description: "Show contact details",
          action: "reply",
          response: "Contact {{business.name}} at +15551234567"
        }]
      },
      context: { businessName: "Acme Salon" },
      workflowName: "Workflow",
      currentSession: null
    });
    expect(custom?.text).toBe("Contact Acme Salon at +15551234567");
  });

  it("accepts a typed service and collects required and configured booking details", () => {
    const triggerData = {
      telegramBookingMode: true,
      telegramBookCommand: true,
      telegramRequestEmail: true,
      telegramRequestNotes: true
    };
    const context = { businessName: "Acme Salon", services: ["Haircut", "Deep Cleaning"] };
    const interact = (message: string, currentSession: any) => architectTelegramTestInteraction({
      event: event(message),
      triggerData,
      context,
      workflowName: "Workflow",
      currentSession
    });

    const started = interact("/book", null);
    expect(started?.nextSession?.state).toBe("SELECTING_SERVICE");
    expect(started?.replyMarkup).toBeTruthy();

    const service = interact("deep cleaning", started?.nextSession);
    expect(service?.text).toContain("Selected: Deep Cleaning");
    expect(service?.nextSession?.state).toBe("WAITING_FOR_DATE");

    const date = interact("2026-08-20", service?.nextSession);
    const time = interact("3:30 PM", date?.nextSession);
    const name = interact("Rahul Sharma", time?.nextSession);
    const phone = interact("+919876543210", name?.nextSession);
    const email = interact("rahul@example.com", phone?.nextSession);
    const completed = interact("skip", email?.nextSession);

    expect(completed?.text).toContain("Architect test booking captured");
    expect(completed?.text).toContain("Customer: Rahul Sharma");
    expect(completed?.text).toContain("Phone: +919876543210");
    expect(completed?.text).toContain("Email: rahul@example.com");
    expect(completed?.nextSession).toBeNull();
  });
});
