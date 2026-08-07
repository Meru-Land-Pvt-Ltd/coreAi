import { describe, expect, it } from "vitest";
import { telegramCommandList } from "./telegram-connector";

describe("Telegram command menu", () => {
  it("defaults to only the mandatory start command and help", () => {
    expect(telegramCommandList({}).map((item) => item.command)).toEqual(["start", "help"]);
  });

  it("keeps booking commands out when the business disables booking", () => {
    const commands = telegramCommandList({
      telegramBookingMode: false,
      telegramServicesCommand: true,
      telegramBookCommand: true,
      telegramMyBookingsCommand: true,
      telegramRescheduleCommand: true,
      telegramCancelCommand: true,
      telegramHelpCommand: true
    }).map((item) => item.command);

    expect(commands).toEqual(["start", "help", "services"]);
  });

  it("publishes only the booking commands selected by the business", () => {
    const commands = telegramCommandList({
      telegramBookingMode: true,
      telegramServicesCommand: false,
      telegramBookCommand: true,
      telegramMyBookingsCommand: false,
      telegramRescheduleCommand: true,
      telegramCancelCommand: false,
      telegramHelpCommand: true
    }).map((item) => item.command);

    expect(commands).toEqual(["start", "help", "book", "reschedule"]);
  });

  it("adds valid custom commands with their feature description", () => {
    const commands = telegramCommandList({
      telegramCustomCommands: [
        { command: "/contact", description: "Show contact details", action: "reply", response: "Call us" },
        { command: "offers", description: "Show available services", action: "services", response: "" },
        { command: "start", description: "Cannot replace start", action: "reply", response: "No" },
        { command: "contact", description: "Duplicate", action: "reply", response: "Duplicate" }
      ]
    });

    expect(commands).toEqual([
      { command: "start", description: "Start the assistant" },
      { command: "help", description: "Show available commands" },
      { command: "contact", description: "Show contact details" },
      { command: "offers", description: "Show available services" }
    ]);
  });
});
