import { ConnectorProvider } from "@prisma/client";
import { decryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import {
  answerTelegramCallback,
  deleteTelegramMessage,
  editTelegramMessage,
  sendTelegramLocation,
  sendTelegramMedia,
  sendTelegramMessage,
  type TelegramJson
} from "./telegram-api-client";
import {
  TELEGRAM_ACTION_TYPES,
  type TelegramActionInput,
  type TelegramButton
} from "./telegram-actions";

export type ArchitectTelegramTestActionInput = {
  userId: string;
  connectionId: string;
  actionType: TelegramActionInput["actionType"];
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

function inlineKeyboard(buttons: TelegramButton[][] | undefined): TelegramJson | undefined {
  if (!buttons?.length) return undefined;
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((button) => ({
        text: button.text,
        ...(button.callbackData ? { callback_data: button.callbackData } : {}),
        ...(button.url ? { url: button.url } : {})
      }))
    )
  };
}

export async function executeArchitectTelegramTestAction(input: ArchitectTelegramTestActionInput) {
  const connection = await prisma.connectorCredential.findFirst({
    where: {
      id: input.connectionId,
      userId: input.userId,
      provider: ConnectorProvider.TELEGRAM
    },
    select: { accessTokenEnc: true }
  });
  if (!connection?.accessTokenEnc) throw new Error("The Architect Telegram test bot is not connected.");
  const botToken = decryptSecret(connection.accessTokenEnc);
  let messageId: string | null = null;

  if (input.actionType === TELEGRAM_ACTION_TYPES.sendMessage || input.actionType === TELEGRAM_ACTION_TYPES.sendButtons) {
    const sent = await sendTelegramMessage({
      botToken,
      chatId: input.chatId,
      text: input.text || " ",
      parseMode: input.parseMode,
      replyMarkup: inlineKeyboard(input.buttons),
      replyToMessageId: input.replyToMessageId,
      disableNotification: input.disableNotification,
      protectContent: input.protectContent
    });
    messageId = String(sent.message_id);
  } else if (input.actionType === TELEGRAM_ACTION_TYPES.requestContact) {
    const sent = await sendTelegramMessage({
      botToken,
      chatId: input.chatId,
      text: input.text || "Share your phone number.",
      replyMarkup: {
        keyboard: [[{ text: input.contactButtonText || "Share my phone number", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    messageId = String(sent.message_id);
  } else if (
    input.actionType === TELEGRAM_ACTION_TYPES.sendPhoto ||
    input.actionType === TELEGRAM_ACTION_TYPES.sendDocument ||
    input.actionType === TELEGRAM_ACTION_TYPES.sendVoice
  ) {
    const kind = input.actionType === TELEGRAM_ACTION_TYPES.sendPhoto
      ? { method: "sendPhoto" as const, mediaField: "photo" as const }
      : input.actionType === TELEGRAM_ACTION_TYPES.sendDocument
        ? { method: "sendDocument" as const, mediaField: "document" as const }
        : { method: "sendVoice" as const, mediaField: "voice" as const };
    const sent = await sendTelegramMedia({
      botToken,
      chatId: input.chatId,
      source: input.source || "",
      caption: input.caption,
      parseMode: input.parseMode,
      disableNotification: input.disableNotification,
      protectContent: input.protectContent,
      ...kind
    });
    messageId = String(sent.message_id);
  } else if (input.actionType === TELEGRAM_ACTION_TYPES.sendLocation) {
    const sent = await sendTelegramLocation({
      botToken,
      chatId: input.chatId,
      latitude: Number(input.latitude),
      longitude: Number(input.longitude),
      livePeriod: input.livePeriod,
      disableNotification: input.disableNotification,
      protectContent: input.protectContent
    });
    messageId = String(sent.message_id);
  } else if (input.actionType === TELEGRAM_ACTION_TYPES.answerCallback) {
    if (!input.callbackQueryId) throw new Error("Telegram callback query ID is required.");
    await answerTelegramCallback({
      botToken,
      callbackQueryId: input.callbackQueryId,
      text: input.text,
      showAlert: input.showAlert,
      url: input.url
    });
  } else if (input.actionType === TELEGRAM_ACTION_TYPES.editMessage) {
    if (!input.messageId) throw new Error("Telegram message ID is required.");
    const edited = await editTelegramMessage({
      botToken,
      chatId: input.chatId,
      messageId: input.messageId,
      text: input.text,
      caption: input.caption,
      replyMarkup: inlineKeyboard(input.buttons),
      parseMode: input.parseMode
    });
    messageId = typeof edited === "boolean" ? input.messageId : String(edited.message_id);
  } else if (input.actionType === TELEGRAM_ACTION_TYPES.deleteMessage) {
    if (!input.messageId) throw new Error("Telegram message ID is required.");
    await deleteTelegramMessage({ botToken, chatId: input.chatId, messageId: input.messageId });
  }

  return {
    success: true,
    chatId: input.chatId,
    messageId,
    actionType: input.actionType,
    telegramConnectionId: input.connectionId,
    dryRun: false,
    architectTest: true
  };
}
