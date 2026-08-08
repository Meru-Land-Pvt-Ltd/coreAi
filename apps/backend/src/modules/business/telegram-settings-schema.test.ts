import { describe, expect, it } from "vitest";
import { telegramBusinessSettingsSchema } from "./routes";

describe("Telegram business settings schema", () => {
  it("allows the default /commands entry without a response", () => {
    const parsed = telegramBusinessSettingsSchema.safeParse({
      botDisplayName: "Test Bot",
      telegramWelcomeMessage: "Welcome",
      telegramFallbackMessage: "Sorry, I didn't understand.",
      telegramBookingMode: false,
      telegramServicesCommand: false,
      telegramBookCommand: false,
      telegramMyBookingsCommand: false,
      telegramRescheduleCommand: false,
      telegramCancelCommand: false,
      telegramHelpCommand: false,
      telegramCustomCommands: [
        {
          command: "commands",
          description: "Show list of all active bot commands",
          action: "reply",
          response: ""
        }
      ],
      services: [],
      telegramRequestPhone: false,
      telegramRequestEmail: false,
      telegramRequestNotes: false
    });

    expect(parsed.success).toBe(true);
  });

  it("still rejects custom /pricing commands when the reply is empty", () => {
    const parsed = telegramBusinessSettingsSchema.safeParse({
      botDisplayName: "Test Bot",
      telegramWelcomeMessage: "Welcome",
      telegramFallbackMessage: "Sorry, I didn't understand.",
      telegramBookingMode: false,
      telegramServicesCommand: false,
      telegramBookCommand: false,
      telegramMyBookingsCommand: false,
      telegramRescheduleCommand: false,
      telegramCancelCommand: false,
      telegramHelpCommand: false,
      telegramCustomCommands: [
        {
          command: "pricing",
          description: "View pricing",
          action: "reply",
          response: ""
        }
      ],
      services: [],
      telegramRequestPhone: false,
      telegramRequestEmail: false,
      telegramRequestNotes: false
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error.issues[0]?.message).toContain("Add the bot reply for /pricing");
  });
});
