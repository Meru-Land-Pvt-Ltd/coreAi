import { prisma } from "../../lib/prisma";

export const TELEGRAM_CONVERSATION_STATES = [
  "STARTED",
  "SHOWING_SERVICES",
  "SELECTING_SERVICE",
  "SELECTING_DATE",
  "SELECTING_TIME",
  "WAITING_FOR_PREFERRED_DATE",
  "WAITING_FOR_PREFERRED_TIME",
  "WAITING_FOR_NAME",
  "WAITING_FOR_PHONE",
  "WAITING_FOR_EMAIL",
  "WAITING_FOR_NOTES",
  "CONFIRMING",
  "CONFIRMING_REQUEST",
  "BOOKING",
  "BOOKED",
  "REQUESTED",
  "RESCHEDULING",
  "CANCELLING",
  "CANCELLED",
  "EXPIRED"
] as const;

export type TelegramConversationStateName = (typeof TELEGRAM_CONVERSATION_STATES)[number];

export type TelegramBookingContext = {
  serviceId?: string;
  serviceSlug?: string;
  serviceName?: string;
  serviceDurationMinutes?: number;
  selectedDate?: string;
  selectedStartAt?: string;
  bookingRequestMode?: boolean;
  preferredDate?: string;
  preferredTime?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerNotes?: string;
  bookingAttemptId?: string;
  summaryMessageId?: string;
  appointmentId?: string;
  bookingReference?: string;
  reschedulingAppointmentId?: string;
  cancellingAppointmentId?: string;
  pendingIntent?: "mybookings" | "reschedule" | "cancel";
};

export type TelegramConversationIdentity = {
  businessId: string;
  installedAgentId: string;
  telegramConnectionId: string;
  telegramBotId: string;
  telegramChatId: string;
  telegramUserId: string;
};

const TELEGRAM_STATE_TTL_MS = 24 * 60 * 60 * 1000;

function contextOf(value: unknown): TelegramBookingContext {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as TelegramBookingContext)
    : {};
}

function expiresAt(): Date {
  return new Date(Date.now() + TELEGRAM_STATE_TTL_MS);
}

export async function loadTelegramConversationState(identity: TelegramConversationIdentity) {
  const row = await prisma.telegramConversationState.findUnique({
    where: {
      businessId_installedAgentId_telegramConnectionId_telegramChatId: {
        businessId: identity.businessId,
        installedAgentId: identity.installedAgentId,
        telegramConnectionId: identity.telegramConnectionId,
        telegramChatId: identity.telegramChatId
      }
    }
  });
  if (!row) return null;
  if (row.expiresAt.getTime() > Date.now()) {
    return { ...row, context: contextOf(row.contextJson) };
  }
  const expired = await prisma.telegramConversationState.update({
    where: { id: row.id },
    data: {
      state: "EXPIRED",
      contextJson: {},
      telegramUserId: identity.telegramUserId,
      expiresAt: expiresAt()
    }
  });
  return { ...expired, context: {} as TelegramBookingContext };
}

export async function saveTelegramConversationState(
  identity: TelegramConversationIdentity,
  state: TelegramConversationStateName,
  context: TelegramBookingContext
) {
  const row = await prisma.telegramConversationState.upsert({
    where: {
      businessId_installedAgentId_telegramConnectionId_telegramChatId: {
        businessId: identity.businessId,
        installedAgentId: identity.installedAgentId,
        telegramConnectionId: identity.telegramConnectionId,
        telegramChatId: identity.telegramChatId
      }
    },
    create: {
      ...identity,
      state,
      contextJson: context as never,
      expiresAt: expiresAt()
    },
    update: {
      telegramBotId: identity.telegramBotId,
      telegramUserId: identity.telegramUserId,
      chatStatus: "ACTIVE",
      lastDeliveryError: null,
      state,
      contextJson: context as never,
      expiresAt: expiresAt()
    }
  });
  return { ...row, context };
}

/**
 * Remember every customer who talks to the bot without disturbing an active
 * booking state. This lets later confirmation and notification steps reuse
 * the captured Telegram chat.
 */
export async function rememberTelegramConversation(identity: TelegramConversationIdentity) {
  return prisma.telegramConversationState.upsert({
    where: {
      businessId_installedAgentId_telegramConnectionId_telegramChatId: {
        businessId: identity.businessId,
        installedAgentId: identity.installedAgentId,
        telegramConnectionId: identity.telegramConnectionId,
        telegramChatId: identity.telegramChatId
      }
    },
    create: {
      ...identity,
      state: "STARTED",
      contextJson: {},
      expiresAt: expiresAt()
    },
    update: {
      telegramBotId: identity.telegramBotId,
      telegramUserId: identity.telegramUserId,
      chatStatus: "ACTIVE",
      lastDeliveryError: null,
      expiresAt: expiresAt()
    }
  });
}

export async function resetTelegramConversationState(identity: TelegramConversationIdentity) {
  return saveTelegramConversationState(identity, "STARTED", {});
}

export async function expireOldTelegramConversationStates(now = new Date()) {
  return prisma.telegramConversationState.updateMany({
    where: {
      expiresAt: { lte: now },
      state: { not: "EXPIRED" }
    },
    data: {
      state: "EXPIRED",
      contextJson: {}
    }
  });
}
