import { env } from "../../config/env";

export type TelegramJson = null | boolean | number | string | TelegramJson[] | { [key: string]: TelegramJson };
export type TelegramRequestPayload = Record<string, TelegramJson | undefined>;

type TelegramApiEnvelope<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
    migrate_to_chat_id?: number;
  };
};

export type TelegramBotIdentity = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_manage_bots?: boolean;
};

export type TelegramSentMessage = {
  message_id: number;
  chat: { id: number; type: string };
  date: number;
  text?: string;
  caption?: string;
};

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_DESCRIPTIONS = [
  /bot was blocked/i,
  /chat not found/i,
  /user is deactivated/i,
  /not enough rights/i,
  /unauthorized/i,
  /wrong file identifier/i,
  /message to delete not found/i,
  /message can't be edited/i,
  /bad request/i
];

export class TelegramApiError extends Error {
  readonly provider = "TELEGRAM";

  constructor(
    message: string,
    public readonly method: string,
    public readonly providerCode: number | null,
    public readonly httpStatus: number,
    public readonly retryAfterSeconds: number | null,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

function apiUrl(botToken: string, method: string): string {
  const baseUrl = env.TELEGRAM_API_BASE_URL.replace(/\/$/, "");
  return `${baseUrl}/bot${botToken}/${method}`;
}

function errorIsRetryable(status: number, description: string, retryAfter: number | null): boolean {
  if (retryAfter !== null || status === 429) return true;
  if (NON_RETRYABLE_DESCRIPTIONS.some((pattern) => pattern.test(description))) return false;
  return RETRYABLE_HTTP_STATUSES.has(status);
}

function safeDescription(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.replace(/\b\d{8,10}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TOKEN]").slice(0, 500);
}

export async function telegramApiRequest<T>(
  botToken: string,
  method: string,
  payload: TelegramRequestPayload = {}
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(apiUrl(botToken, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    throw new TelegramApiError(
      safeDescription(error instanceof Error ? error.message : null, `Telegram ${method} request failed.`),
      method,
      null,
      503,
      null,
      true
    );
  }

  const envelope = (await response.json().catch(() => null)) as TelegramApiEnvelope<T> | null;
  if (response.ok && envelope?.ok && envelope.result !== undefined) return envelope.result;

  const description = safeDescription(
    envelope?.description,
    `Telegram ${method} returned HTTP ${response.status}.`
  );
  const retryAfter =
    typeof envelope?.parameters?.retry_after === "number"
      ? Math.max(1, Math.round(envelope.parameters.retry_after))
      : null;
  throw new TelegramApiError(
    description,
    method,
    typeof envelope?.error_code === "number" ? envelope.error_code : null,
    response.status,
    retryAfter,
    errorIsRetryable(response.status, description, retryAfter)
  );
}

async function telegramMultipartRequest<T>(
  botToken: string,
  method: string,
  form: FormData
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(botToken, method), {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    throw new TelegramApiError(
      safeDescription(error instanceof Error ? error.message : null, `Telegram ${method} upload failed.`),
      method,
      null,
      503,
      null,
      true
    );
  }
  const envelope = (await response.json().catch(() => null)) as TelegramApiEnvelope<T> | null;
  if (response.ok && envelope?.ok && envelope.result !== undefined) return envelope.result;
  const description = safeDescription(
    envelope?.description,
    `Telegram ${method} returned HTTP ${response.status}.`
  );
  const retryAfter =
    typeof envelope?.parameters?.retry_after === "number"
      ? Math.max(1, Math.round(envelope.parameters.retry_after))
      : null;
  throw new TelegramApiError(
    description,
    method,
    typeof envelope?.error_code === "number" ? envelope.error_code : null,
    response.status,
    retryAfter,
    errorIsRetryable(response.status, description, retryAfter)
  );
}

export async function getTelegramBotIdentity(botToken: string): Promise<TelegramBotIdentity> {
  const bot = await telegramApiRequest<TelegramBotIdentity>(botToken, "getMe");
  if (!bot.is_bot || !bot.username) {
    throw new TelegramApiError(
      "Telegram token did not resolve to a bot with a username.",
      "getMe",
      400,
      422,
      null,
      false
    );
  }
  return bot;
}

export async function getTelegramWebhookInfo(botToken: string): Promise<{
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}> {
  return telegramApiRequest(botToken, "getWebhookInfo");
}

export function telegramChatId(value: string): string | number {
  const trimmed = value.trim();
  if (!trimmed || !/^-?\d+$/.test(trimmed)) {
    throw new TelegramApiError("Telegram chat ID must be an integer.", "validate", 400, 422, null, false);
  }
  const numberValue = Number(trimmed);
  return Number.isSafeInteger(numberValue) ? numberValue : trimmed;
}

export function telegramMessageId(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new TelegramApiError("Telegram message ID must be a positive integer.", "validate", 400, 422, null, false);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TelegramApiError("Telegram message ID must be a positive integer.", "validate", 400, 422, null, false);
  }
  return parsed;
}

export function validateCallbackData(value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 1 || bytes > 64) {
    throw new TelegramApiError(
      "Telegram callback data must contain 1 to 64 UTF-8 bytes.",
      "validate",
      400,
      422,
      null,
      false
    );
  }
  return value;
}

export function validatePublicTelegramMediaSource(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:") return url.toString();
  } catch {
    // A useful validation error is returned below.
  }
  throw new TelegramApiError(
    "Telegram media must be an existing Telegram file ID or a public HTTPS URL.",
    "validate",
    400,
    422,
    null,
    false
  );
}

export async function sendTelegramMessage(options: {
  botToken: string;
  chatId: string;
  text: string;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  replyMarkup?: TelegramJson;
  replyToMessageId?: string;
  disableNotification?: boolean;
  protectContent?: boolean;
}): Promise<TelegramSentMessage> {
  const parseMode = options.parseMode ?? "Markdown";
  try {
    return await telegramApiRequest(options.botToken, "sendMessage", {
      chat_id: telegramChatId(options.chatId),
      text: options.text.slice(0, 4096),
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      ...(options.replyToMessageId
        ? { reply_parameters: { message_id: telegramMessageId(options.replyToMessageId) } }
        : {}),
      ...(options.disableNotification ? { disable_notification: true } : {}),
      ...(options.protectContent ? { protect_content: true } : {})
    });
  } catch (error) {
    if (
      parseMode &&
      error instanceof TelegramApiError &&
      /can't parse entities|bad request/i.test(error.message)
    ) {
      return telegramApiRequest(options.botToken, "sendMessage", {
        chat_id: telegramChatId(options.chatId),
        text: options.text.slice(0, 4096),
        ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
        ...(options.replyToMessageId
          ? { reply_parameters: { message_id: telegramMessageId(options.replyToMessageId) } }
          : {}),
        ...(options.disableNotification ? { disable_notification: true } : {}),
        ...(options.protectContent ? { protect_content: true } : {})
      });
    }
    throw error;
  }
}

export async function answerTelegramCallback(options: {
  botToken: string;
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
  url?: string;
}): Promise<boolean> {
  return telegramApiRequest(options.botToken, "answerCallbackQuery", {
    callback_query_id: options.callbackQueryId,
    ...(options.text ? { text: options.text.slice(0, 200) } : {}),
    ...(options.showAlert ? { show_alert: true } : {}),
    ...(options.url ? { url: options.url } : {})
  });
}

export async function sendTelegramMedia(options: {
  botToken: string;
  method: "sendPhoto" | "sendDocument" | "sendVoice";
  mediaField: "photo" | "document" | "voice";
  chatId: string;
  source: string;
  caption?: string;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  disableNotification?: boolean;
  protectContent?: boolean;
}): Promise<TelegramSentMessage> {
  const parseMode = options.parseMode ?? "Markdown";
  const dataUrl = options.source.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (dataUrl) {
    const mimeType = dataUrl[1] || "application/octet-stream";
    const bytes = Buffer.from((dataUrl[2] || "").replace(/\s+/g, ""), "base64");
    if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) {
      throw new TelegramApiError(
        "Uploaded Telegram media must be between 1 byte and 20 MB.",
        "validate",
        400,
        422,
        null,
        false
      );
    }
    const extension =
      options.mediaField === "photo"
        ? "jpg"
        : options.mediaField === "voice"
          ? "ogg"
          : mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
    const form = new FormData();
    form.append("chat_id", String(telegramChatId(options.chatId)));
    form.append(options.mediaField, new Blob([bytes], { type: mimeType }), `telegram-upload.${extension}`);
    if (options.caption) form.append("caption", options.caption.slice(0, 1024));
    if (parseMode) form.append("parse_mode", parseMode);
    if (options.disableNotification) form.append("disable_notification", "true");
    if (options.protectContent) form.append("protect_content", "true");
    return telegramMultipartRequest(options.botToken, options.method, form);
  }
  return telegramApiRequest(options.botToken, options.method, {
    chat_id: telegramChatId(options.chatId),
    [options.mediaField]: validatePublicTelegramMediaSource(options.source),
    ...(options.caption ? { caption: options.caption.slice(0, 1024) } : {}),
    ...(parseMode ? { parse_mode: parseMode } : {}),
    ...(options.disableNotification ? { disable_notification: true } : {}),
    ...(options.protectContent ? { protect_content: true } : {})
  });
}

export async function sendTelegramLocation(options: {
  botToken: string;
  chatId: string;
  latitude: number;
  longitude: number;
  livePeriod?: number;
  disableNotification?: boolean;
  protectContent?: boolean;
}): Promise<TelegramSentMessage> {
  if (!Number.isFinite(options.latitude) || options.latitude < -90 || options.latitude > 90) {
    throw new TelegramApiError("Latitude must be between -90 and 90.", "validate", 400, 422, null, false);
  }
  if (!Number.isFinite(options.longitude) || options.longitude < -180 || options.longitude > 180) {
    throw new TelegramApiError("Longitude must be between -180 and 180.", "validate", 400, 422, null, false);
  }
  if (
    options.livePeriod !== undefined &&
    (!Number.isInteger(options.livePeriod) || options.livePeriod < 60 || options.livePeriod > 86_400)
  ) {
    throw new TelegramApiError(
      "Live location period must be between 60 and 86400 seconds.",
      "validate",
      400,
      422,
      null,
      false
    );
  }
  return telegramApiRequest(options.botToken, "sendLocation", {
    chat_id: telegramChatId(options.chatId),
    latitude: options.latitude,
    longitude: options.longitude,
    ...(options.livePeriod ? { live_period: options.livePeriod } : {}),
    ...(options.disableNotification ? { disable_notification: true } : {}),
    ...(options.protectContent ? { protect_content: true } : {})
  });
}

export async function editTelegramMessage(options: {
  botToken: string;
  chatId: string;
  messageId: string;
  text?: string;
  caption?: string;
  replyMarkup?: TelegramJson;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
}): Promise<TelegramSentMessage | boolean> {
  const parseMode = options.parseMode ?? "Markdown";
  const common: TelegramRequestPayload = {
    chat_id: telegramChatId(options.chatId),
    message_id: telegramMessageId(options.messageId),
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    ...(parseMode ? { parse_mode: parseMode } : {})
  };
  try {
    if (options.text) {
      return await telegramApiRequest(options.botToken, "editMessageText", {
        ...common,
        text: options.text.slice(0, 4096)
      });
    }
    if (options.caption) {
      return await telegramApiRequest(options.botToken, "editMessageCaption", {
        ...common,
        caption: options.caption.slice(0, 1024)
      });
    }
    return await telegramApiRequest(options.botToken, "editMessageReplyMarkup", common);
  } catch (error) {
    if (
      parseMode &&
      error instanceof TelegramApiError &&
      /can't parse entities|bad request/i.test(error.message)
    ) {
      const fallbackCommon: TelegramRequestPayload = {
        chat_id: telegramChatId(options.chatId),
        message_id: telegramMessageId(options.messageId),
        ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {})
      };
      if (options.text) {
        return telegramApiRequest(options.botToken, "editMessageText", {
          ...fallbackCommon,
          text: options.text.slice(0, 4096)
        });
      }
      if (options.caption) {
        return telegramApiRequest(options.botToken, "editMessageCaption", {
          ...fallbackCommon,
          caption: options.caption.slice(0, 1024)
        });
      }
    }
    throw error;
  }
}

export async function deleteTelegramMessage(options: {
  botToken: string;
  chatId: string;
  messageId: string;
}): Promise<boolean> {
  return telegramApiRequest(options.botToken, "deleteMessage", {
    chat_id: telegramChatId(options.chatId),
    message_id: telegramMessageId(options.messageId)
  });
}
