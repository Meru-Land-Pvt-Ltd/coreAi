import crypto from "crypto";
import { decryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import {
  answerTelegramCallback,
  deleteTelegramMessage,
  editTelegramMessage,
  sendTelegramLocation,
  sendTelegramMedia,
  sendTelegramMessage,
  TelegramApiError,
  validateCallbackData,
  type TelegramJson,
  type TelegramSentMessage
} from "./telegram-api-client";

export const TELEGRAM_ACTION_TYPES = {
  sendMessage: "telegram.send_message",
  sendButtons: "telegram.send_buttons",
  answerCallback: "telegram.answer_callback",
  requestContact: "telegram.request_contact",
  sendPhoto: "telegram.send_photo",
  sendDocument: "telegram.send_document",
  sendVoice: "telegram.send_voice",
  sendLocation: "telegram.send_location",
  editMessage: "telegram.edit_message",
  deleteMessage: "telegram.delete_message"
} as const;

export type TelegramActionType = (typeof TELEGRAM_ACTION_TYPES)[keyof typeof TELEGRAM_ACTION_TYPES];
export type TelegramButton = {
  text: string;
  callbackData?: string;
  url?: string;
};

export type TelegramActionInput = {
  actionType: TelegramActionType;
  businessId: string;
  installedAgentId: string;
  telegramConnectionId: string;
  nodeId: string;
  workflowExecutionId?: string;
  idempotencyKey?: string;
  chatId: string;
  messageId?: string;
  callbackQueryId?: string;
  text?: string;
  caption?: string;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  buttons?: TelegramButton[][];
  source?: string;
  latitude?: number;
  longitude?: number;
  livePeriod?: number;
  showAlert?: boolean;
  url?: string;
  replyToMessageId?: string;
  disableNotification?: boolean;
  protectContent?: boolean;
  contactButtonText?: string;
};

export type TelegramActionOutput = {
  success: true;
  chatId: string;
  messageId: string | null;
  actionType: TelegramActionType;
  telegramConnectionId: string;
  executionId: string;
  alreadySent: boolean;
};

function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function redactedRequest(input: TelegramActionInput): Record<string, unknown> {
  return {
    actionType: input.actionType,
    chat: input.chatId ? `sha256:${hashValue(input.chatId)}` : null,
    messageId: input.messageId ?? null,
    callbackQueryId: input.callbackQueryId ? "[REDACTED_CALLBACK_ID]" : null,
    text: input.text ? `[REDACTED_TEXT:${input.text.length}]` : null,
    caption: input.caption ? `[REDACTED_CAPTION:${input.caption.length}]` : null,
    source: input.source ? "[MEDIA_SOURCE]" : null,
    buttonRows: input.buttons?.length ?? 0,
    parseMode: input.parseMode ?? null
  };
}

function inlineKeyboard(buttons: TelegramButton[][]): TelegramJson {
  const rows: TelegramJson[] = buttons.map((row) => {
    const items: TelegramJson[] = row.map((button): TelegramJson => {
      const buttonText = button.text.trim().slice(0, 64);
      if (!buttonText) {
        throw new TelegramApiError("Telegram button text is required.", "validate", 400, 422, null, false);
      }
      if (button.url) {
        const url = new URL(button.url);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          throw new TelegramApiError(
            "Telegram button URL must use HTTP or HTTPS.",
            "validate",
            400,
            422,
            null,
            false
          );
        }
        return { text: buttonText, url: url.toString() };
      }
      return {
        text: buttonText,
        callback_data: validateCallbackData(button.callbackData ?? "")
      };
    });
    return items;
  });
  return {
    inline_keyboard: rows
  };
}

function messageIdOf(result: TelegramSentMessage | boolean): string | null {
  return typeof result === "object" && result !== null && typeof result.message_id === "number"
    ? String(result.message_id)
    : null;
}

async function dispatch(botToken: string, input: TelegramActionInput): Promise<TelegramSentMessage | boolean> {
  if (input.actionType === TELEGRAM_ACTION_TYPES.sendMessage) {
    return sendTelegramMessage({
      botToken,
      chatId: input.chatId,
      text: input.text ?? "",
      parseMode: input.parseMode,
      replyToMessageId: input.replyToMessageId,
      disableNotification: input.disableNotification,
      protectContent: input.protectContent
    });
  }

  if (input.actionType === TELEGRAM_ACTION_TYPES.sendButtons) {
    return sendTelegramMessage({
      botToken,
      chatId: input.chatId,
      text: input.text ?? "",
      parseMode: input.parseMode,
      replyMarkup: inlineKeyboard(input.buttons ?? []),
      replyToMessageId: input.replyToMessageId,
      disableNotification: input.disableNotification,
      protectContent: input.protectContent
    });
  }

  if (input.actionType === TELEGRAM_ACTION_TYPES.answerCallback) {
    if (!input.callbackQueryId) {
      throw new TelegramApiError("A callback query ID is required.", "validate", 400, 422, null, false);
    }
    return answerTelegramCallback({
      botToken,
      callbackQueryId: input.callbackQueryId,
      text: input.text,
      showAlert: input.showAlert,
      url: input.url
    });
  }

  if (input.actionType === TELEGRAM_ACTION_TYPES.requestContact) {
    return sendTelegramMessage({
      botToken,
      chatId: input.chatId,
      text: input.text ?? "Share your phone number or type it in international format.",
      replyMarkup: {
        keyboard: [[{ text: (input.contactButtonText ?? "Share phone number").slice(0, 64), request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
        input_field_placeholder: "Or type +15551234567"
      },
      disableNotification: input.disableNotification,
      protectContent: input.protectContent
    });
  }

  if (
    input.actionType === TELEGRAM_ACTION_TYPES.sendPhoto ||
    input.actionType === TELEGRAM_ACTION_TYPES.sendDocument ||
    input.actionType === TELEGRAM_ACTION_TYPES.sendVoice
  ) {
    const media =
      input.actionType === TELEGRAM_ACTION_TYPES.sendPhoto
        ? { method: "sendPhoto" as const, mediaField: "photo" as const }
        : input.actionType === TELEGRAM_ACTION_TYPES.sendDocument
          ? { method: "sendDocument" as const, mediaField: "document" as const }
          : { method: "sendVoice" as const, mediaField: "voice" as const };
    return sendTelegramMedia({
      botToken,
      chatId: input.chatId,
      source: input.source ?? "",
      caption: input.caption,
      parseMode: input.parseMode,
      disableNotification: input.disableNotification,
      protectContent: input.protectContent,
      ...media
    });
  }

  if (input.actionType === TELEGRAM_ACTION_TYPES.sendLocation) {
    return sendTelegramLocation({
      botToken,
      chatId: input.chatId,
      latitude: input.latitude ?? Number.NaN,
      longitude: input.longitude ?? Number.NaN,
      livePeriod: input.livePeriod,
      disableNotification: input.disableNotification,
      protectContent: input.protectContent
    });
  }

  if (input.actionType === TELEGRAM_ACTION_TYPES.editMessage) {
    if (!input.messageId) {
      throw new TelegramApiError("A Telegram message ID is required.", "validate", 400, 422, null, false);
    }
    return editTelegramMessage({
      botToken,
      chatId: input.chatId,
      messageId: input.messageId,
      text: input.text,
      caption: input.caption,
      replyMarkup: input.buttons ? inlineKeyboard(input.buttons) : undefined,
      parseMode: input.parseMode
    });
  }

  if (!input.messageId) {
    throw new TelegramApiError("A Telegram message ID is required.", "validate", 400, 422, null, false);
  }
  return deleteTelegramMessage({
    botToken,
    chatId: input.chatId,
    messageId: input.messageId
  });
}

export async function executeTelegramAction(input: TelegramActionInput): Promise<TelegramActionOutput> {
  const connection = await prisma.telegramBotConnection.findFirst({
    where: {
      id: input.telegramConnectionId,
      businessId: input.businessId,
      installedAgentId: input.installedAgentId,
      status: "ACTIVE",
      botTokenEncrypted: { not: null },
      installedAgent: { status: { in: ["ACTIVE", "PROVISIONING"] }, pausedAt: null }
    },
    select: {
      id: true,
      botTokenEncrypted: true,
      ownerChatId: true
    }
  });
  if (!connection?.botTokenEncrypted) {
    throw new TelegramApiError(
      "The installed agent does not have an active Telegram connection.",
      "connection",
      404,
      422,
      null,
      false
    );
  }

  const existing = input.idempotencyKey
    ? await prisma.telegramMessageExecution.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
    : null;
  if (existing?.status === "SENT") {
    return {
      success: true,
      chatId: input.chatId,
      messageId: existing.messageId,
      actionType: input.actionType,
      telegramConnectionId: input.telegramConnectionId,
      executionId: existing.id,
      alreadySent: true
    };
  }
  if (
    existing &&
    (existing.businessId !== input.businessId ||
      existing.installedAgentId !== input.installedAgentId ||
      existing.telegramConnectionId !== input.telegramConnectionId)
  ) {
    throw new TelegramApiError("Telegram idempotency key belongs to another tenant.", "connection", 409, 409, null, false);
  }

  const execution = existing
    ? await prisma.telegramMessageExecution.update({
        where: { id: existing.id },
        data: {
          status: "RUNNING",
          attempts: { increment: 1 },
          errorCode: null,
          errorMessage: null
        }
      })
    : await prisma.telegramMessageExecution.create({
        data: {
          workflowExecutionId: input.workflowExecutionId,
          nodeId: input.nodeId,
          businessId: input.businessId,
          installedAgentId: input.installedAgentId,
          telegramConnectionId: input.telegramConnectionId,
          chatId: input.chatId,
          messageId: input.messageId,
          idempotencyKey: input.idempotencyKey,
          actionType: input.actionType,
          status: "RUNNING",
          attempts: 1,
          requestJson: redactedRequest(input) as never
        }
      });

  try {
    const result = await dispatch(decryptSecret(connection.botTokenEncrypted), input);
    const messageId = messageIdOf(result) ?? input.messageId ?? null;
    await prisma.$transaction([
      prisma.telegramMessageExecution.update({
        where: { id: execution.id },
        data: {
          status: "SENT",
          messageId,
          responseJson: {
            ok: true,
            messageId,
            actionType: input.actionType
          },
          sentAt: new Date(),
          errorCode: null,
          errorMessage: null
        }
      }),
      prisma.telegramBotConnection.update({
        where: { id: connection.id },
        data: {
          lastSuccessfulSendAt: new Date(),
          lastProviderErrorCode: null,
          lastError: null
        }
      })
    ]);
    return {
      success: true,
      chatId: input.chatId,
      messageId,
      actionType: input.actionType,
      telegramConnectionId: input.telegramConnectionId,
      executionId: execution.id,
      alreadySent: false
    };
  } catch (error) {
    const telegramError =
      error instanceof TelegramApiError
        ? error
        : new TelegramApiError(
            error instanceof Error ? error.message : "Telegram action failed.",
            "unknown",
            null,
            500,
            null,
            true
          );
    const permanentChatStatus = /bot was blocked/i.test(telegramError.message)
      ? "BLOCKED"
      : /user is deactivated/i.test(telegramError.message)
        ? "DEACTIVATED"
        : /chat not found/i.test(telegramError.message)
          ? "UNREACHABLE"
          : null;
    await prisma.$transaction([
      prisma.telegramMessageExecution.update({
        where: { id: execution.id },
        data: {
          status: telegramError.retryable ? "RETRYABLE_ERROR" : "FAILED",
          errorCode: telegramError.providerCode ? String(telegramError.providerCode) : telegramError.name,
          errorMessage: telegramError.message.slice(0, 500),
          responseJson: {
            ok: false,
            retryable: telegramError.retryable,
            retryAfterSeconds: telegramError.retryAfterSeconds
          }
        }
      }),
      prisma.telegramBotConnection.update({
        where: { id: connection.id },
        data: {
          lastProviderErrorCode: telegramError.providerCode
            ? String(telegramError.providerCode)
            : telegramError.name,
          lastError: telegramError.message.slice(0, 500),
          ...(permanentChatStatus && connection.ownerChatId === input.chatId
            ? { ownerNotificationStatus: "ERROR" }
            : {})
        }
      }),
      ...(permanentChatStatus
        ? [
            prisma.telegramConversationState.updateMany({
              where: {
                businessId: input.businessId,
                installedAgentId: input.installedAgentId,
                telegramConnectionId: input.telegramConnectionId,
                telegramChatId: input.chatId
              },
              data: {
                chatStatus: permanentChatStatus,
                lastDeliveryError: telegramError.message.slice(0, 500)
              }
            })
          ]
        : [])
    ]);
    throw telegramError;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Bounded provider retry used by the background Telegram worker. */
export async function executeTelegramActionWithRetry(
  input: TelegramActionInput,
  maxAttempts = 4
): Promise<TelegramActionOutput> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await executeTelegramAction(input);
    } catch (error) {
      lastError = error;
      if (!(error instanceof TelegramApiError) || !error.retryable || attempt === maxAttempts) throw error;
      const providerDelay = error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : 0;
      const exponentialDelay = 1_000 * 2 ** (attempt - 1);
      await wait(Math.min(Math.max(providerDelay, exponentialDelay), 60_000));
    }
  }
  throw lastError;
}
