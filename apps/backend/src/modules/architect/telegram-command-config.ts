type JsonRecord = Record<string, unknown>;

export type TelegramCustomCommandAction = "reply" | "services" | "book" | "help";

export type TelegramCustomCommand = {
  command: string;
  description: string;
  action: TelegramCustomCommandAction;
  response: string;
};

const BUILT_IN_COMMANDS = new Set([
  "start",
  "services",
  "book",
  "mybookings",
  "reschedule",
  "cancel",
  "help"
]);

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function flag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function telegramCustomCommands(triggerData: JsonRecord): TelegramCustomCommand[] {
  if (!Array.isArray(triggerData.telegramCustomCommands)) return [];
  const seen = new Set<string>();
  const commands: TelegramCustomCommand[] = [];

  for (const value of triggerData.telegramCustomCommands.slice(0, 20)) {
    const item = record(value);
    const command = text(item.command)
      .toLowerCase()
      .replace(/^\/+/, "")
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 32);
    if (!command || BUILT_IN_COMMANDS.has(command) || seen.has(command)) continue;
    const actionValue = text(item.action, "reply");
    const action: TelegramCustomCommandAction = ["services", "book", "help"].includes(actionValue)
      ? actionValue as TelegramCustomCommandAction
      : "reply";
    const description = text(item.description, "Custom bot command").slice(0, 256);
    const response = text(item.response).slice(0, 4096);
    if (action === "reply" && !response) continue;
    seen.add(command);
    commands.push({ command, description, action, response });
  }

  return commands;
}

export function telegramCommandList(triggerData: JsonRecord) {
  const commands = [{ command: "start", description: "Start the assistant" }];
  const optional = [
    ["telegramServicesCommand", "services", "View available services"],
    ["telegramBookCommand", "book", "Book an appointment"],
    ["telegramMyBookingsCommand", "mybookings", "View your bookings"],
    ["telegramRescheduleCommand", "reschedule", "Reschedule a booking"],
    ["telegramCancelCommand", "cancel", "Cancel a booking"],
    ["telegramHelpCommand", "help", "Show available commands"]
  ] as const;
  for (const [field, command, description] of optional) {
    const bookingCommand = ["book", "mybookings", "reschedule", "cancel"].includes(command);
    const enabledByDefault = command === "help";
    if (
      flag(triggerData[field], enabledByDefault) &&
      (!bookingCommand || flag(triggerData.telegramBookingMode, false))
    ) {
      commands.push({ command, description });
    }
  }
  for (const custom of telegramCustomCommands(triggerData)) {
    commands.push({ command: custom.command, description: custom.description });
  }
  return commands;
}
