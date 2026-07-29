import { z } from "zod";

const telegramUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional()
});

const telegramChatSchema = z.object({
  id: z.number().int(),
  type: z.string()
});

const telegramPhotoSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  file_size: z.number().int().optional()
});

const telegramMessageSchema = z.object({
  message_id: z.number().int(),
  date: z.number().int(),
  from: telegramUserSchema.optional(),
  chat: telegramChatSchema,
  text: z.string().optional(),
  caption: z.string().optional(),
  contact: z
    .object({
      phone_number: z.string(),
      first_name: z.string(),
      last_name: z.string().optional(),
      user_id: z.number().int().optional()
    })
    .optional(),
  photo: z.array(telegramPhotoSchema).optional(),
  document: z
    .object({
      file_id: z.string(),
      file_unique_id: z.string().optional(),
      file_name: z.string().optional(),
      mime_type: z.string().optional(),
      file_size: z.number().int().optional()
    })
    .optional(),
  voice: z
    .object({
      file_id: z.string(),
      file_unique_id: z.string().optional(),
      duration: z.number().int(),
      mime_type: z.string().optional(),
      file_size: z.number().int().optional()
    })
    .optional(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      horizontal_accuracy: z.number().optional(),
      live_period: z.number().int().optional()
    })
    .optional()
});

const telegramCallbackSchema = z.object({
  id: z.string(),
  from: telegramUserSchema,
  chat_instance: z.string().optional(),
  data: z.string().optional(),
  message: telegramMessageSchema.optional()
});

export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: telegramMessageSchema.optional(),
  callback_query: telegramCallbackSchema.optional(),
  managed_bot: z
    .object({
      user: telegramUserSchema,
      bot: telegramUserSchema
    })
    .optional()
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramMessage = z.infer<typeof telegramMessageSchema>;
export type TelegramIncomingEventType =
  | "message"
  | "command"
  | "keyword"
  | "callback_query"
  | "contact"
  | "photo"
  | "document"
  | "voice"
  | "location";

export type NormalizedTelegramEvent = {
  provider: "TELEGRAM";
  updateId: string;
  eventType: TelegramIncomingEventType;
  businessId: string;
  installedAgentId: string;
  telegramConnectionId: string;
  bot: {
    id: string;
    username: string;
  };
  chat: {
    id: string;
    type: string;
  };
  sender: {
    id: string;
    isBot: boolean;
    username: string;
    firstName: string;
    lastName: string;
    languageCode: string;
  };
  message: {
    id: string;
    text: string;
    caption: string;
    date: string;
  };
  callback: {
    id: string;
    data: string;
  };
  contact: {
    phoneNumber: string;
    firstName: string;
    lastName: string;
    userId: string;
  };
  media: {
    type: "" | "photo" | "document" | "voice";
    fileId: string;
    fileName: string;
    mimeType: string;
  };
  location: {
    latitude: number | null;
    longitude: number | null;
  };
};

export type TelegramTriggerConfig = {
  eventType?: TelegramIncomingEventType;
  command?: string;
  keywords?: string[];
  matchType?: "contains" | "exact" | "starts_with" | "regex";
  privateChatsOnly?: boolean;
  ignoreBots?: boolean;
};

function eventMessage(update: TelegramUpdate) {
  return update.message ?? update.callback_query?.message;
}

function eventType(update: TelegramUpdate): TelegramIncomingEventType | null {
  if (update.callback_query) return "callback_query";
  const message = update.message;
  if (!message) return null;
  if (message.contact) return "contact";
  if (message.photo?.length) return "photo";
  if (message.document) return "document";
  if (message.voice) return "voice";
  if (message.location) return "location";
  if (message.text?.trim().startsWith("/")) return "command";
  if (message.text || message.caption) return "message";
  return null;
}

function isoDate(unixSeconds: number | undefined): string {
  if (!unixSeconds) return "";
  const date = new Date(unixSeconds * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function normalizeTelegramUpdate(options: {
  update: TelegramUpdate;
  businessId: string;
  installedAgentId: string;
  telegramConnectionId: string;
  botId: string;
  botUsername: string;
}): NormalizedTelegramEvent | null {
  const type = eventType(options.update);
  const message = eventMessage(options.update);
  const callback = options.update.callback_query;
  const sender = callback?.from ?? message?.from;
  if (!type || !message || !sender) return null;

  const photo = message.photo?.length ? message.photo[message.photo.length - 1] : undefined;
  const media = photo
    ? { type: "photo" as const, fileId: photo.file_id, fileName: "", mimeType: "image/jpeg" }
    : message.document
      ? {
          type: "document" as const,
          fileId: message.document.file_id,
          fileName: message.document.file_name ?? "",
          mimeType: message.document.mime_type ?? ""
        }
      : message.voice
        ? {
            type: "voice" as const,
            fileId: message.voice.file_id,
            fileName: "",
            mimeType: message.voice.mime_type ?? "audio/ogg"
          }
        : { type: "" as const, fileId: "", fileName: "", mimeType: "" };

  return {
    provider: "TELEGRAM",
    updateId: String(options.update.update_id),
    eventType: type,
    businessId: options.businessId,
    installedAgentId: options.installedAgentId,
    telegramConnectionId: options.telegramConnectionId,
    bot: {
      id: options.botId,
      username: options.botUsername
    },
    chat: {
      id: String(message.chat.id),
      type: message.chat.type
    },
    sender: {
      id: String(sender.id),
      isBot: sender.is_bot,
      username: sender.username ?? "",
      firstName: sender.first_name,
      lastName: sender.last_name ?? "",
      languageCode: sender.language_code ?? ""
    },
    message: {
      id: String(message.message_id),
      text: message.text ?? "",
      caption: message.caption ?? "",
      date: isoDate(message.date)
    },
    callback: {
      id: callback?.id ?? "",
      data: callback?.data ?? ""
    },
    contact: {
      phoneNumber: message.contact?.phone_number ?? "",
      firstName: message.contact?.first_name ?? "",
      lastName: message.contact?.last_name ?? "",
      userId: message.contact?.user_id ? String(message.contact.user_id) : ""
    },
    media,
    location: {
      latitude: message.location?.latitude ?? null,
      longitude: message.location?.longitude ?? null
    }
  };
}

function commandOf(event: NormalizedTelegramEvent): string {
  const firstToken = event.message.text.trim().split(/\s+/, 1)[0] ?? "";
  return firstToken.toLowerCase().replace(/^\/+/, "").split("@", 1)[0] ?? "";
}

function keywordMatches(text: string, keyword: string, matchType: NonNullable<TelegramTriggerConfig["matchType"]>) {
  const normalizedText = text.toLocaleLowerCase();
  const normalizedKeyword = keyword.toLocaleLowerCase();
  if (matchType === "exact") return normalizedText === normalizedKeyword;
  if (matchType === "starts_with") return normalizedText.startsWith(normalizedKeyword);
  if (matchType === "regex") {
    try {
      return new RegExp(keyword, "i").test(text);
    } catch {
      return false;
    }
  }
  return normalizedText.includes(normalizedKeyword);
}

export function telegramTriggerMatches(
  event: NormalizedTelegramEvent,
  config: TelegramTriggerConfig
): boolean {
  if (config.privateChatsOnly !== false && event.chat.type !== "private") return false;
  if (config.ignoreBots !== false && event.sender.isBot) return false;

  const configuredType = config.eventType ?? "message";
  if (configuredType === "message") return event.eventType !== "callback_query";
  if (configuredType === "command") {
    if (event.eventType !== "command") return false;
    const wanted = (config.command ?? "").trim().toLowerCase().replace(/^\/+/, "");
    return !wanted || commandOf(event) === wanted;
  }
  if (configuredType === "keyword") {
    const text = (event.message.text || event.message.caption).trim();
    const keywords = (config.keywords ?? []).map((value) => value.trim()).filter(Boolean);
    return Boolean(text && keywords.some((keyword) => keywordMatches(text, keyword, config.matchType ?? "contains")));
  }
  return event.eventType === configuredType;
}

export function telegramCommand(event: NormalizedTelegramEvent): string {
  return commandOf(event);
}
