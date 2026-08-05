import crypto from "crypto";
import { dateOnlyInZone } from "@coreai/shared";
import { decryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import {
  cancelGoogleCalendarAppointment,
  createGoogleCalendarAppointment,
  rescheduleGoogleCalendarAppointment
} from "./google-calendar-connector";
import { getGmailConnectionStatus } from "./gmail-connector";
import {
  computeBusinessAvailability,
  revalidateAndReserveSlot
} from "../business/scheduling";
import { sendBusinessAppointmentBookedEmail } from "../notifications/appointment-booked-email";
import {
  executeTelegramActionWithRetry,
  TELEGRAM_ACTION_TYPES,
  type TelegramActionInput,
  type TelegramButton
} from "./telegram-actions";
import {
  loadTelegramConversationState,
  rememberTelegramConversation,
  resetTelegramConversationState,
  saveTelegramConversationState,
  type TelegramBookingContext,
  type TelegramConversationIdentity,
  type TelegramConversationStateName
} from "./telegram-conversation-state";
import {
  loadTelegramBusinessService,
  loadTelegramBusinessServices
} from "./telegram-services";
import {
  normalizeTelegramUpdate,
  telegramCommand,
  telegramTriggerMatches,
  telegramUpdateSchema,
  type NormalizedTelegramEvent,
  type TelegramTriggerConfig
} from "./telegram-update";
import {
  inspectTelegramOwnerAuthorizationCommand,
  shouldRememberTelegramEventAsCustomer,
  telegramEventBelongsToBusinessOwner
} from "./telegram-owner-routing";
import { telegramCommandList, telegramCustomCommands } from "./telegram-command-config";
import { parseRunnerWorkflowJson, runWorkflowTest } from "./workflow-runner";
import { formatKnowledgeEntries, retrieveRelevantKnowledge } from "../business/agent-knowledge";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}

function renderBusinessTemplate(template: unknown, businessName: string): string {
  return stringValue(template).replace(/\{\{\s*business\.name\s*\}\}/gi, businessName);
}

function triggerNode(workflowJson: unknown) {
  return parseRunnerWorkflowJson(workflowJson).nodes.find(
    (node) => stringValue(node.data?.type) === "trigger.telegram_message"
  );
}

function telegramTriggerData(workflowJson: unknown, configJson: unknown): JsonRecord {
  const config = record(configJson);
  return {
    ...record(triggerNode(workflowJson)?.data),
    ...record(config.telegram)
  };
}

function triggerConfig(data: JsonRecord): TelegramTriggerConfig {
  const rawKeywords = data.telegramKeywords;
  const keywords = Array.isArray(rawKeywords)
    ? rawKeywords.filter((value): value is string => typeof value === "string")
    : typeof rawKeywords === "string"
      ? rawKeywords.split(",").map((value) => value.trim()).filter(Boolean)
      : [];
  return {
    eventType: stringValue(data.telegramEventType, "message") as TelegramTriggerConfig["eventType"],
    command: stringValue(data.telegramCommand),
    keywords,
    matchType: stringValue(data.telegramMatchType, "contains") as TelegramTriggerConfig["matchType"],
    privateChatsOnly: stringValue(data.telegramChatAccess, "private") === "private",
    ignoreBots: boolValue(data.telegramIgnoreBots, true)
  };
}

function bookingMode(data: JsonRecord): boolean {
  return boolValue(data.telegramBookingMode, false);
}

function commandEnabled(data: JsonRecord, field: string): boolean {
  return boolValue(data[field], field === "telegramHelpCommand");
}

function nextDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function localDateLabel(date: string, timeZone: string): string {
  try {
    return new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric"
    });
  } catch {
    return date;
  }
}

function localAppointmentLabel(startAt: string, timeZone: string): string {
  try {
    return new Date(startAt).toLocaleString("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    });
  } catch {
    return startAt;
  }
}

function localHourMinute(startAt: string, timeZone: string): { hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(startAt));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isInteger(hour) && Number.isInteger(minute) ? { hour, minute } : null;
  } catch {
    return null;
  }
}

function normalizePhone(value: string): string | null {
  const normalized = value.trim().replace(/[()\s.-]/g, "");
  const withCountry = normalized.startsWith("+") ? normalized : `+${normalized}`;
  return /^\+[1-9]\d{7,14}$/.test(withCountry) ? withCountry : null;
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizedServiceName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

function bookingReference(): string {
  return `TG-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

type LoadedConnection = NonNullable<Awaited<ReturnType<typeof loadRuntimeConnection>>>;

async function loadRuntimeConnection(connectionId: string) {
  return prisma.telegramBotConnection.findUnique({
    where: { id: connectionId },
    include: {
      business: {
        include: {
          profile: true,
          phoneNumbers: {
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      },
      installedAgent: {
        include: { workflow: true }
      }
    }
  });
}

function identity(connection: LoadedConnection, event: NormalizedTelegramEvent): TelegramConversationIdentity {
  return {
    businessId: connection.businessId,
    installedAgentId: connection.installedAgentId,
    telegramConnectionId: connection.id,
    telegramBotId: connection.botUserId ?? "",
    telegramChatId: event.chat.id,
    telegramUserId: event.sender.id
  };
}

function baseAction(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  purpose: string
): Pick<
  TelegramActionInput,
  "businessId" | "installedAgentId" | "telegramConnectionId" | "nodeId" | "chatId" | "idempotencyKey"
> {
  return {
    businessId: connection.businessId,
    installedAgentId: connection.installedAgentId,
    telegramConnectionId: connection.id,
    nodeId: `telegram-runtime:${purpose}`,
    chatId: event.chat.id,
    idempotencyKey: `telegram:${connection.id}:${event.updateId}:${purpose}`
  };
}

async function sendText(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  purpose: string,
  text: string
) {
  return executeTelegramActionWithRetry({
    ...baseAction(connection, event, purpose),
    actionType: TELEGRAM_ACTION_TYPES.sendMessage,
    text
  });
}

async function sendButtons(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  purpose: string,
  text: string,
  buttons: TelegramButton[][]
) {
  return executeTelegramActionWithRetry({
    ...baseAction(connection, event, purpose),
    actionType: TELEGRAM_ACTION_TYPES.sendButtons,
    text,
    buttons
  });
}

async function requestContact(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  purpose: string
) {
  return executeTelegramActionWithRetry({
    ...baseAction(connection, event, purpose),
    actionType: TELEGRAM_ACTION_TYPES.requestContact,
    text: "Please share your phone number, or type it in international format such as +15551234567.",
    contactButtonText: "Share my phone number"
  });
}

async function answerCallback(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  purpose: string,
  text = ""
) {
  if (!event.callback.id) return null;
  return executeTelegramActionWithRetry({
    ...baseAction(connection, event, purpose),
    actionType: TELEGRAM_ACTION_TYPES.answerCallback,
    callbackQueryId: event.callback.id,
    text
  });
}

async function editMessage(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  purpose: string,
  messageId: string,
  text: string
) {
  return executeTelegramActionWithRetry({
    ...baseAction(connection, event, purpose),
    actionType: TELEGRAM_ACTION_TYPES.editMessage,
    messageId,
    text
  });
}

async function sendMainMenu(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  triggerData: JsonRecord
) {
  const welcome =
    renderBusinessTemplate(triggerData.telegramWelcomeMessage, connection.business.name) ||
    `Welcome to ${connection.business.name}. Choose what you would like to do.`;
  const bookingEnabled = bookingMode(triggerData);
  const primary = [
    ...(commandEnabled(triggerData, "telegramServicesCommand")
      ? [{ text: "View services", callbackData: "nav:services" }]
      : []),
    ...(bookingEnabled && commandEnabled(triggerData, "telegramBookCommand")
      ? [{ text: "Book appointment", callbackData: "nav:book" }]
      : [])
  ];
  const rows = [
    ...(primary.length ? [primary] : []),
    ...(bookingEnabled && commandEnabled(triggerData, "telegramMyBookingsCommand")
      ? [[{ text: "My bookings", callbackData: "nav:mybookings" }]]
      : []),
    ...(commandEnabled(triggerData, "telegramHelpCommand")
      ? [[{ text: "Help", callbackData: "nav:help" }]]
      : [])
  ];
  return rows.length
    ? sendButtons(connection, event, "main-menu", welcome, rows)
    : sendText(connection, event, "main-menu", welcome);
}

async function sendHelpMenu(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  triggerData: JsonRecord
) {
  const helpLines = telegramCommandList(triggerData).map(
    (item) => `/${item.command} - ${item.description}`
  );
  await sendText(connection, event, "help", helpLines.join("\n"));
}

async function showServices(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  forBooking: boolean
) {
  const services = await loadTelegramBusinessServices({
    businessId: connection.businessId,
    installedAgentId: connection.installedAgentId
  });
  if (services.length === 0) {
    await sendText(
      connection,
      event,
      "services-empty",
      `No bookable services are configured for ${connection.business.name} yet. Please contact the business directly.`
    );
    return;
  }
  if (!forBooking) {
    const list = services.slice(0, 20).map((service) =>
      service.priceVisible && service.priceCents !== null
        ? `• ${service.name} - $${(service.priceCents / 100).toFixed(2)}`
        : `• ${service.name}`
    );
    await sendText(
      connection,
      event,
      "show-services",
      [`Services at ${connection.business.name}:`, ...list].join("\n")
    );
    return;
  }
  const rows = services.slice(0, 20).map((service) => [
    {
      text: service.priceVisible && service.priceCents !== null
        ? `${service.name} - $${(service.priceCents / 100).toFixed(2)}`
        : service.name,
      callbackData: `service:${service.slug}`
    }
  ]);
  await sendButtons(
    connection,
    event,
    forBooking ? "book-services" : "show-services",
    forBooking ? "Choose the service you want to book:" : `Services at ${connection.business.name}:`,
    rows
  );
}

async function availableDates(connection: LoadedConnection, serviceName: string): Promise<string[]> {
  const timeZone = connection.business.profile?.timeZone || "UTC";
  const today = dateOnlyInZone(new Date(), timeZone);
  const dates = Array.from({ length: 14 }, (_, index) => nextDate(today, index));
  const availability = await Promise.all(
    dates.map(async (date) => {
      const result = await computeBusinessAvailability({
        businessId: connection.businessId,
        installedAgentId: connection.installedAgentId,
        date,
        serviceName
      });
      return result.calendarStatus === "connected" && result.allSlots.length > 0 ? date : null;
    })
  );
  return availability.filter((date): date is string => Boolean(date)).slice(0, 7);
}

async function showDates(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  serviceName: string
) {
  const dates = await availableDates(connection, serviceName);
  if (dates.length === 0) {
    await sendText(
      connection,
      event,
      "dates-unavailable",
      "Live calendar availability is temporarily unavailable or there are no open dates. No appointment has been booked."
    );
    return false;
  }
  const timeZone = connection.business.profile?.timeZone || "UTC";
  await sendButtons(
    connection,
    event,
    "show-dates",
    `Choose a date for ${serviceName}:`,
    dates.map((date) => [{ text: localDateLabel(date, timeZone), callbackData: `date:${date}` }])
  );
  return true;
}

async function businessCalendarConnected(
  connection: LoadedConnection,
  serviceName?: string
): Promise<boolean> {
  const configured = await getGmailConnectionStatus(connection.business.ownerId)
    .then((status) => status.calendarConnected)
    .catch(() => false);
  if (!configured) return false;

  // A stored credential can be expired, revoked, or missing access despite
  // still existing in the database. Check the same live availability source
  // used by booking before promising a real-time calendar flow.
  const timeZone = connection.business.profile?.timeZone || "UTC";
  const today = dateOnlyInZone(new Date(), timeZone);
  return computeBusinessAvailability({
    businessId: connection.businessId,
    installedAgentId: connection.installedAgentId,
    date: today,
    serviceName
  })
    .then((availability) => availability.calendarStatus === "connected")
    .catch(() => false);
}

async function beginBookingForService(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  stateIdentity: TelegramConversationIdentity,
  context: TelegramBookingContext
) {
  if (!(await businessCalendarConnected(connection, context.serviceName))) {
    const requestContext: TelegramBookingContext = {
      ...context,
      bookingRequestMode: true,
      preferredDate: undefined,
      preferredTime: undefined,
      selectedDate: undefined,
      selectedStartAt: undefined,
      bookingAttemptId: undefined
    };
    await saveTelegramConversationState(
      stateIdentity,
      "WAITING_FOR_PREFERRED_DATE",
      requestContext
    );
    await sendText(
      connection,
      event,
      "ask-preferred-date",
      `${connection.business.name} confirms appointment times manually. I can send them your booking request. What date would you prefer?`
    );
    return;
  }

  const calendarContext: TelegramBookingContext = {
    ...context,
    bookingRequestMode: false,
    preferredDate: undefined,
    preferredTime: undefined
  };
  await saveTelegramConversationState(stateIdentity, "SELECTING_DATE", calendarContext);
  await showDates(connection, event, calendarContext.serviceName ?? "Appointment");
}

async function showSlots(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  context: TelegramBookingContext,
  date: string
) {
  const result = await computeBusinessAvailability({
    businessId: connection.businessId,
    installedAgentId: connection.installedAgentId,
    date,
    serviceName: context.serviceName
  });
  if (result.calendarStatus !== "connected") {
    await sendText(
      connection,
      event,
      "slots-calendar-unavailable",
      "The business calendar is not connected right now, so I cannot confirm availability. No appointment has been booked."
    );
    return false;
  }
  if (result.allSlots.length === 0) {
    await sendButtons(connection, event, "slots-empty", "No times are open on that date. Choose another date.", [
      [{ text: "Choose another date", callbackData: `service:${context.serviceSlug ?? ""}` }]
    ]);
    return false;
  }
  await sendButtons(
    connection,
    event,
    "show-slots",
    `Available times on ${localDateLabel(date, result.timeZone)}:`,
    result.allSlots.slice(0, 12).map((slot) => [
      { text: slot.label, callbackData: `slot:${slot.startAt}` }
    ])
  );
  return true;
}

async function showBookingSummary(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  context: TelegramBookingContext
) {
  const timeZone = connection.business.profile?.timeZone || "UTC";
  const result = await sendButtons(
    connection,
    event,
    "booking-summary",
    [
      "Please confirm your appointment:",
      "",
      `Business: ${connection.business.name}`,
      `Service: ${context.serviceName ?? "Appointment"}`,
      `When: ${context.selectedStartAt ? localAppointmentLabel(context.selectedStartAt, timeZone) : "Not selected"}`,
      `Name: ${context.customerName ?? "Not provided"}`,
      `Phone: ${context.customerPhone ?? "Not provided"}`,
      ...(context.customerEmail ? [`Email: ${context.customerEmail}`] : []),
      ...(context.customerNotes ? [`Notes: ${context.customerNotes}`] : [])
    ].join("\n"),
    [
      [{ text: "Confirm booking", callbackData: "booking:confirm" }],
      [
        { text: "Change details", callbackData: "booking:change" },
        { text: "Cancel", callbackData: "booking:cancel" }
      ]
    ]
  );
  return result.messageId;
}

async function createTelegramAppointment(options: {
  connection: LoadedConnection;
  event: NormalizedTelegramEvent;
  context: TelegramBookingContext;
}) {
  const { connection, event, context } = options;
  if (!context.customerPhone || !context.customerName || !context.serviceName || !context.selectedStartAt || !context.selectedDate) {
    throw new Error("Booking details are incomplete.");
  }
  const timeZone = connection.business.profile?.timeZone || "UTC";
  const localTime = localHourMinute(context.selectedStartAt, timeZone);
  if (!localTime) throw new Error("The selected Telegram slot is invalid.");
  const idempotencyKey =
    `telegram:${connection.id}:${event.chat.id}:${context.bookingAttemptId ?? `${context.serviceId ?? context.serviceSlug}:${context.selectedStartAt}`}`;
  const existing = await prisma.appointment.findUnique({ where: { idempotencyKey } });
  if (existing) return { appointment: existing, alreadyBooked: true };

  const durationMinutes = context.serviceDurationMinutes ?? 30;
  const startAt = new Date(context.selectedStartAt);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  const reservation = await revalidateAndReserveSlot({
    businessId: connection.businessId,
    installedAgentId: connection.installedAgentId,
    date: context.selectedDate,
    hour: localTime.hour,
    minute: localTime.minute,
    serviceName: context.serviceName,
    createBooking: async () => {
      const duplicate = await prisma.appointment.findUnique({ where: { idempotencyKey } });
      if (duplicate) return duplicate;
      const calendarEvent = await createGoogleCalendarAppointment({
        userId: connection.business.ownerId,
        calendarId: connection.business.profile?.calendarId || "primary",
        timeZone,
        businessName: connection.business.name,
        customerName: context.customerName,
        customerPhone: context.customerPhone as string,
        service: context.serviceName,
        startAt,
        endAt,
        description: [
          "Booked through the business Telegram bot.",
          `Customer: ${context.customerName}`,
          `Phone: ${context.customerPhone}`,
          ...(context.customerEmail ? [`Email: ${context.customerEmail}`] : []),
          ...(context.customerNotes ? [`Notes: ${context.customerNotes}`] : [])
        ].join("\n")
      });
      try {
        return await prisma.appointment.create({
          data: {
            businessId: connection.businessId,
            installedAgentId: connection.installedAgentId,
            customerPhone: context.customerPhone as string,
            customerName: context.customerName,
            customerEmail: context.customerEmail,
            service: context.serviceName,
            source: "TELEGRAM",
            bookingReference: bookingReference(),
            idempotencyKey,
            startAt,
            endAt,
            timeZone,
            calendarEventId: calendarEvent.id,
            calendarEventLink: calendarEvent.htmlLink,
            status: "BOOKED",
            notes: context.customerNotes
          }
        });
      } catch (error) {
        if (calendarEvent.id) {
          await cancelGoogleCalendarAppointment({
            userId: connection.business.ownerId,
            calendarId: calendarEvent.calendarId,
            eventId: calendarEvent.id
          }).catch(() => null);
        }
        throw error;
      }
    }
  });
  if (!reservation.ok) {
    const duplicate = await prisma.appointment.findUnique({ where: { idempotencyKey } });
    if (duplicate) return { appointment: duplicate, alreadyBooked: true };
    return { conflict: reservation.result, alreadyBooked: false };
  }
  return { appointment: reservation.booking, alreadyBooked: false };
}

async function persistCustomerAndConversation(
  connection: LoadedConnection,
  context: TelegramBookingContext,
  appointmentId: string
) {
  if (!context.customerPhone) return;
  const conversation = await prisma.conversation.upsert({
    where: {
      businessId_channel_customerPhone: {
        businessId: connection.businessId,
        channel: "TELEGRAM",
        customerPhone: context.customerPhone
      }
    },
    create: {
      businessId: connection.businessId,
      channel: "TELEGRAM",
      customerPhone: context.customerPhone,
      messages: {
        create: {
          direction: "SYSTEM",
          body: `Telegram appointment booked: ${context.serviceName ?? "Appointment"}.`,
          providerId: appointmentId
        }
      }
    },
    update: {
      status: "OPEN",
      messages: {
        create: {
          direction: "SYSTEM",
          body: `Telegram appointment booked: ${context.serviceName ?? "Appointment"}.`,
          providerId: appointmentId
        }
      }
    }
  });
  await prisma.$transaction([
    prisma.lead.upsert({
      where: {
        businessId_phoneNumber: {
          businessId: connection.businessId,
          phoneNumber: context.customerPhone
        }
      },
      create: {
        businessId: connection.businessId,
        conversationId: conversation.id,
        phoneNumber: context.customerPhone,
        name: context.customerName,
        source: "TELEGRAM",
        status: "CAPTURED"
      },
      update: {
        conversationId: conversation.id,
        name: context.customerName,
        source: "TELEGRAM",
        status: "CAPTURED"
      }
    }),
    prisma.appointment.update({
      where: { id: appointmentId },
      data: { conversationId: conversation.id }
    })
  ]);
}

async function notifyOwner(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  purpose: string,
  text: string
) {
  if (connection.ownerNotificationStatus !== "CONNECTED" || !connection.ownerChatId) return;
  await executeTelegramActionWithRetry({
    businessId: connection.businessId,
    installedAgentId: connection.installedAgentId,
    telegramConnectionId: connection.id,
    nodeId: `telegram-runtime:${purpose}`,
    chatId: connection.ownerChatId,
    idempotencyKey: `telegram:${connection.id}:${event.updateId}:${purpose}`,
    actionType: TELEGRAM_ACTION_TYPES.sendMessage,
    text
  }).catch(() => null);
}

function ownerCustomerDetails(
  event: NormalizedTelegramEvent,
  context: TelegramBookingContext
): string[] {
  const telegramName = [event.sender.firstName, event.sender.lastName].filter(Boolean).join(" ");
  return [
    `Customer: ${context.customerName || telegramName || "Not provided"}`,
    `Phone: ${context.customerPhone || event.contact.phoneNumber || "Not provided"}`,
    `Email: ${context.customerEmail || "Not provided"}`,
    `Telegram: ${event.sender.username ? `@${event.sender.username}` : telegramName || "Not provided"}`,
    `Notes: ${context.customerNotes || "None"}`
  ];
}

async function showBookingRequestSummary(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  context: TelegramBookingContext
) {
  const result = await sendButtons(
    connection,
    event,
    "booking-request-summary",
    [
      "Please confirm your booking request:",
      "",
      `Business: ${connection.business.name}`,
      `Service: ${context.serviceName ?? "Appointment"}`,
      `Preferred date: ${context.preferredDate ?? "Not provided"}`,
      `Preferred time: ${context.preferredTime ?? "Not provided"}`,
      `Name: ${context.customerName ?? "Not provided"}`,
      `Phone: ${context.customerPhone ?? "Not provided"}`,
      ...(context.customerEmail ? [`Email: ${context.customerEmail}`] : []),
      ...(context.customerNotes ? [`Notes: ${context.customerNotes}`] : []),
      "",
      "The business will confirm the final date and time."
    ].join("\n"),
    [
      [{ text: "Send booking request", callbackData: "booking-request:confirm" }],
      [
        { text: "Change details", callbackData: "booking:change" },
        { text: "Cancel", callbackData: "booking:cancel" }
      ]
    ]
  );
  return result.messageId;
}

async function persistManualBookingRequest(
  connection: LoadedConnection,
  context: TelegramBookingContext,
  reference: string
) {
  if (!context.customerPhone) return;
  const body = [
    `Telegram booking request ${reference}`,
    `Service: ${context.serviceName ?? "Appointment"}`,
    `Preferred date: ${context.preferredDate ?? "Not provided"}`,
    `Preferred time: ${context.preferredTime ?? "Not provided"}`,
    ...(context.customerEmail ? [`Email: ${context.customerEmail}`] : []),
    ...(context.customerNotes ? [`Notes: ${context.customerNotes}`] : [])
  ].join("\n");
  const conversation = await prisma.conversation.upsert({
    where: {
      businessId_channel_customerPhone: {
        businessId: connection.businessId,
        channel: "TELEGRAM",
        customerPhone: context.customerPhone
      }
    },
    create: {
      businessId: connection.businessId,
      channel: "TELEGRAM",
      customerPhone: context.customerPhone,
      messages: { create: { direction: "SYSTEM", body, providerId: reference } }
    },
    update: {
      status: "OPEN",
      messages: { create: { direction: "SYSTEM", body, providerId: reference } }
    }
  });
  await prisma.lead.upsert({
    where: {
      businessId_phoneNumber: {
        businessId: connection.businessId,
        phoneNumber: context.customerPhone
      }
    },
    create: {
      businessId: connection.businessId,
      conversationId: conversation.id,
      phoneNumber: context.customerPhone,
      name: context.customerName,
      source: "TELEGRAM",
      status: "CAPTURED"
    },
    update: {
      conversationId: conversation.id,
      name: context.customerName,
      source: "TELEGRAM",
      status: "CAPTURED"
    }
  });
}

async function confirmManualBookingRequest(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  stateIdentity: TelegramConversationIdentity,
  context: TelegramBookingContext
) {
  if (
    !context.serviceName ||
    !context.preferredDate ||
    !context.preferredTime ||
    !context.customerName ||
    !context.customerPhone
  ) {
    await answerCallback(connection, event, "booking-request-incomplete", "Some details are missing.");
    await sendText(
      connection,
      event,
      "booking-request-incomplete-message",
      "Some booking-request details are missing. Send /book to start again."
    );
    return;
  }

  await answerCallback(connection, event, "booking-request-confirm-callback", "Request sent.");
  const reference = context.bookingReference ?? bookingReference();
  const next: TelegramBookingContext = { ...context, bookingReference: reference };
  await persistManualBookingRequest(connection, next, reference);
  const customerMessage = [
    "Booking request received",
    "",
    `Business: ${connection.business.name}`,
    `Service: ${next.serviceName}`,
    `Preferred date: ${next.preferredDate}`,
    `Preferred time: ${next.preferredTime}`,
    `Request reference: ${reference}`,
    "Status: Awaiting confirmation from the business.",
    "This is not a confirmed appointment yet.",
    ...(connection.business.profile?.teamPhone
      ? [`For assistance: ${connection.business.profile.teamPhone}`]
      : [])
  ].join("\n");
  await sendText(connection, event, "booking-request-received", customerMessage);
  if (context.summaryMessageId) {
    await editMessage(
      connection,
      event,
      "booking-request-summary-sent",
      context.summaryMessageId,
      customerMessage
    ).catch(() => null);
  }
  await notifyOwner(
    connection,
    event,
    "owner-booking-request",
    [
      "New Telegram booking request",
      "",
      `Business: ${connection.business.name}`,
      ...ownerCustomerDetails(event, next),
      `Service: ${next.serviceName}`,
      `Preferred date: ${next.preferredDate}`,
      `Preferred time: ${next.preferredTime}`,
      `Request reference: ${reference}`,
      "Status: Manual confirmation required",
      "Source: Telegram"
    ].join("\n")
  );
  await saveTelegramConversationState(stateIdentity, "REQUESTED", next);
}

async function finishBookingDetails(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  stateIdentity: TelegramConversationIdentity,
  context: TelegramBookingContext
) {
  const summaryMessageId = context.bookingRequestMode
    ? await showBookingRequestSummary(connection, event, context)
    : await showBookingSummary(connection, event, context);
  await saveTelegramConversationState(
    stateIdentity,
    context.bookingRequestMode ? "CONFIRMING_REQUEST" : "CONFIRMING",
    { ...context, summaryMessageId: summaryMessageId ?? undefined }
  );
}

async function confirmBooking(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  stateIdentity: TelegramConversationIdentity,
  context: TelegramBookingContext
) {
  await answerCallback(connection, event, "confirm-callback", "Checking the calendar...");
  await saveTelegramConversationState(stateIdentity, "BOOKING", context);
  const result = await createTelegramAppointment({ connection, event, context });
  if ("conflict" in result && result.conflict) {
    await saveTelegramConversationState(stateIdentity, "SELECTING_TIME", {
      ...context,
      selectedStartAt: undefined
    });
    await sendText(
      connection,
      event,
      "booking-conflict",
      "That time was just taken. No booking was created. Please choose another available time."
    );
    await showSlots(connection, event, context, context.selectedDate ?? "");
    return;
  }
  const appointment = result.appointment;
  if (result.alreadyBooked) {
    await saveTelegramConversationState(stateIdentity, "BOOKED", {
      ...context,
      appointmentId: appointment.id,
      bookingReference: appointment.bookingReference ?? undefined
    });
    return;
  }
  await persistCustomerAndConversation(connection, context, appointment.id);
  await sendBusinessAppointmentBookedEmail(appointment.id).catch(() => null);
  const timeZone = connection.business.profile?.timeZone || "UTC";
  const reference = appointment.bookingReference || appointment.id.slice(-8).toUpperCase();
  const customerMessage = [
    "Appointment confirmed",
    "",
    `Business: ${connection.business.name}`,
    `Service: ${appointment.service ?? "Appointment"}`,
    `When: ${localAppointmentLabel(appointment.startAt.toISOString(), timeZone)}`,
    `Timezone: ${timeZone}`,
    `Booking reference: ${reference}`,
    ...(connection.business.profile?.teamPhone
      ? [`For assistance: ${connection.business.profile.teamPhone}`]
      : [])
  ].join("\n");
  await sendText(connection, event, "booking-confirmation", customerMessage);
  if (context.summaryMessageId) {
    await editMessage(
      connection,
      event,
      "booking-summary-confirmed",
      context.summaryMessageId,
      customerMessage
    ).catch(() => null);
  }
  await notifyOwner(
    connection,
    event,
    "owner-booking-notification",
    [
      "New Telegram booking",
      "",
      `Business: ${connection.business.name}`,
      ...ownerCustomerDetails(event, context),
      `Service: ${appointment.service ?? "Appointment"}`,
      `When: ${localAppointmentLabel(appointment.startAt.toISOString(), timeZone)}`,
      `Timezone: ${timeZone}`,
      `Booking reference: ${reference}`,
      "Status: Confirmed",
      "Source: Telegram"
    ].join("\n")
  );
  await saveTelegramConversationState(stateIdentity, "BOOKED", {
    ...context,
    appointmentId: appointment.id,
    bookingReference: reference
  });
}

async function loadCustomerAppointments(
  connection: LoadedConnection,
  phone: string
) {
  return prisma.appointment.findMany({
    where: {
      businessId: connection.businessId,
      installedAgentId: connection.installedAgentId,
      customerPhone: phone,
      status: "BOOKED",
      startAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }
    },
    orderBy: { startAt: "asc" },
    take: 10
  });
}

async function showCustomerBookings(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  context: TelegramBookingContext,
  mode: "mybookings" | "reschedule" | "cancel"
) {
  if (!context.customerPhone) {
    await requestContact(connection, event, `${mode}-request-contact`);
    return false;
  }
  const appointments = await loadCustomerAppointments(connection, context.customerPhone);
  if (appointments.length === 0) {
    await sendText(connection, event, `${mode}-empty`, "No upcoming bookings were found for that phone number.");
    return true;
  }
  const timeZone = connection.business.profile?.timeZone || "UTC";
  const prefix = mode === "cancel" ? "booking-cancel" : mode === "reschedule" ? "booking-reschedule" : "booking-view";
  await sendButtons(
    connection,
    event,
    `${mode}-list`,
    mode === "mybookings" ? "Your upcoming bookings:" : `Choose a booking to ${mode}:`,
    appointments.map((appointment) => [
      {
        text: `${appointment.service ?? "Appointment"} - ${localAppointmentLabel(
          appointment.startAt.toISOString(),
          timeZone
        )}`,
        callbackData: `${prefix}:${appointment.id}`
      }
    ])
  );
  return true;
}

async function cancelAppointment(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  stateIdentity: TelegramConversationIdentity,
  context: TelegramBookingContext,
  appointmentId: string
) {
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      businessId: connection.businessId,
      installedAgentId: connection.installedAgentId,
      customerPhone: context.customerPhone,
      status: "BOOKED"
    }
  });
  if (!appointment) {
    await answerCallback(connection, event, "cancel-missing-callback", "Booking not found.");
    await sendText(connection, event, "cancel-missing", "That booking is not available to cancel.");
    return;
  }
  if (appointment.calendarEventId) {
    await cancelGoogleCalendarAppointment({
      userId: connection.business.ownerId,
      calendarId: connection.business.profile?.calendarId || "primary",
      eventId: appointment.calendarEventId
    });
  }
  const cancelled = await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancellationSource: "TELEGRAM"
    }
  });
  await answerCallback(connection, event, "cancel-callback", "Cancelled.");
  const message = `Your ${cancelled.service ?? "appointment"} on ${localAppointmentLabel(
    cancelled.startAt.toISOString(),
    connection.business.profile?.timeZone || "UTC"
  )} has been cancelled.`;
  await sendText(connection, event, "cancel-confirmation", message);
  await notifyOwner(
    connection,
    event,
    "owner-cancel-notification",
    [
      "Telegram booking cancelled",
      "",
      `Business: ${connection.business.name}`,
      ...ownerCustomerDetails(event, context),
      `Service: ${cancelled.service ?? "Appointment"}`,
      `Original time: ${localAppointmentLabel(cancelled.startAt.toISOString(), cancelled.timeZone || connection.business.profile?.timeZone || "UTC")}`,
      `Booking reference: ${cancelled.bookingReference || context.bookingReference || cancelled.id.slice(-8).toUpperCase()}`,
      "Status: Cancelled"
    ].join("\n")
  );
  await saveTelegramConversationState(stateIdentity, "CANCELLED", {
    ...context,
    cancellingAppointmentId: appointment.id
  });
}

async function beginReschedule(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  stateIdentity: TelegramConversationIdentity,
  context: TelegramBookingContext,
  appointmentId: string
) {
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      businessId: connection.businessId,
      installedAgentId: connection.installedAgentId,
      customerPhone: context.customerPhone,
      status: "BOOKED"
    }
  });
  if (!appointment) {
    await answerCallback(connection, event, "reschedule-missing-callback", "Booking not found.");
    return;
  }
  const services = await loadTelegramBusinessServices({
    businessId: connection.businessId,
    installedAgentId: connection.installedAgentId
  });
  const service = services.find((item) => item.name.toLowerCase() === (appointment.service ?? "").toLowerCase());
  const nextContext: TelegramBookingContext = {
    ...context,
    serviceId: service?.id,
    serviceSlug: service?.slug,
    serviceName: appointment.service ?? "Appointment",
    serviceDurationMinutes:
      service?.durationMinutes ??
      Math.max(5, Math.round((appointment.endAt.getTime() - appointment.startAt.getTime()) / 60_000)),
    reschedulingAppointmentId: appointment.id,
    selectedDate: undefined,
    selectedStartAt: undefined
  };
  await answerCallback(connection, event, "reschedule-select-callback", "Choose a new date.");
  await saveTelegramConversationState(stateIdentity, "RESCHEDULING", nextContext);
  await showDates(connection, event, nextContext.serviceName ?? "Appointment");
}

async function confirmReschedule(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  stateIdentity: TelegramConversationIdentity,
  context: TelegramBookingContext
) {
  if (!context.reschedulingAppointmentId || !context.selectedStartAt || !context.selectedDate) return;
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: context.reschedulingAppointmentId,
      businessId: connection.businessId,
      installedAgentId: connection.installedAgentId,
      customerPhone: context.customerPhone,
      status: "BOOKED"
    }
  });
  if (!appointment?.calendarEventId) {
    await sendText(connection, event, "reschedule-missing", "This booking cannot be rescheduled automatically.");
    return;
  }
  const timeZone = connection.business.profile?.timeZone || "UTC";
  const localTime = localHourMinute(context.selectedStartAt, timeZone);
  if (!localTime) return;
  await answerCallback(connection, event, "reschedule-confirm-callback", "Checking the new time...");
  const duration = context.serviceDurationMinutes ?? 30;
  const startAt = new Date(context.selectedStartAt);
  const endAt = new Date(startAt.getTime() + duration * 60_000);
  const reservation = await revalidateAndReserveSlot({
    businessId: connection.businessId,
    installedAgentId: connection.installedAgentId,
    date: context.selectedDate,
    hour: localTime.hour,
    minute: localTime.minute,
    serviceName: appointment.service,
    createBooking: async () => {
      const calendar = await rescheduleGoogleCalendarAppointment({
        userId: connection.business.ownerId,
        calendarId: connection.business.profile?.calendarId || "primary",
        eventId: appointment.calendarEventId as string,
        startAt,
        endAt,
        timeZone
      });
      if (!calendar.updated) throw new Error("The Google Calendar event no longer exists.");
      return prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          startAt,
          endAt,
          timeZone,
          calendarEventLink: calendar.htmlLink
        }
      });
    }
  });
  if (!reservation.ok) {
    await sendText(connection, event, "reschedule-conflict", "That time is no longer available. Choose another time.");
    await showSlots(connection, event, context, context.selectedDate);
    return;
  }
  const message = `Your appointment is rescheduled to ${localAppointmentLabel(startAt.toISOString(), timeZone)}.`;
  await sendText(connection, event, "reschedule-confirmation", message);
  await notifyOwner(
    connection,
    event,
    "owner-reschedule-notification",
    [
      "Telegram booking rescheduled",
      "",
      `Business: ${connection.business.name}`,
      ...ownerCustomerDetails(event, context),
      `Service: ${appointment.service ?? context.serviceName ?? "Appointment"}`,
      `New time: ${localAppointmentLabel(startAt.toISOString(), timeZone)}`,
      `Timezone: ${timeZone}`,
      `Booking reference: ${appointment.bookingReference || context.bookingReference || appointment.id.slice(-8).toUpperCase()}`,
      "Status: Rescheduled"
    ].join("\n")
  );
  await saveTelegramConversationState(stateIdentity, "BOOKED", {
    ...context,
    appointmentId: appointment.id,
    reschedulingAppointmentId: undefined
  });
}

async function authorizeOwnerChat(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent
): Promise<boolean> {
  const authorization = inspectTelegramOwnerAuthorizationCommand({
    text: event.message.text,
    expectedTokenHash: connection.ownerNotificationNonceHash,
    chatType: event.chat.type
  });
  if (!authorization.matches) return false;
  if (authorization.expired) {
    await prisma.telegramBotConnection.update({
      where: { id: connection.id },
      data: {
        ownerNotificationStatus: "NOT_CONNECTED",
        ownerNotificationNonceHash: null
      }
    });
    await sendText(
      connection,
      event,
      "owner-authorization-expired",
      "This owner connection link has expired. Generate a new link from Business Setup."
    );
    return true;
  }
  await prisma.telegramBotConnection.update({
    where: { id: connection.id },
    data: {
      ownerChatId: event.chat.id,
      telegramOwnerUserId: event.sender.id,
      ownerNotificationStatus: "CONNECTED",
      ownerNotificationNonceHash: null,
      lastError: null
    }
  });
  await sendText(
    { ...connection, ownerChatId: event.chat.id, ownerNotificationStatus: "CONNECTED" },
    event,
    "owner-authorized",
    `Owner notifications are connected for ${connection.business.name}.`
  );
  return true;
}

async function handleConnectedOwnerMessage(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent
): Promise<boolean> {
  if (!telegramEventBelongsToBusinessOwner(connection, event)) return false;
  if (connection.ownerNotificationStatus !== "CONNECTED") {
    await prisma.telegramBotConnection.update({
      where: { id: connection.id },
      data: {
        ownerNotificationStatus: "CONNECTED",
        lastError: null
      }
    });
  }
  await sendText(
    connection,
    event,
    "owner-chat-message",
    `This Telegram chat is connected as the business owner for ${connection.business.name}. You will receive customer and booking notifications here; customer messages are kept separate.`
  );
  return true;
}

async function handleCommand(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  triggerData: JsonRecord,
  stateIdentity: TelegramConversationIdentity,
  context: TelegramBookingContext,
  stateName: string
): Promise<boolean> {
  const command = telegramCommand(event);
  if (!command) return false;
  if (command === "start") {
    await resetTelegramConversationState(stateIdentity);
    await sendMainMenu(connection, event, triggerData);
    return true;
  }
  const commandSetting = {
    services: "telegramServicesCommand",
    book: "telegramBookCommand",
    mybookings: "telegramMyBookingsCommand",
    reschedule: "telegramRescheduleCommand",
    cancel: "telegramCancelCommand",
    help: "telegramHelpCommand"
  }[command];
  if (commandSetting && !commandEnabled(triggerData, commandSetting)) return false;
  if (["book", "mybookings", "reschedule", "cancel"].includes(command) && !bookingMode(triggerData)) {
    return false;
  }
  const customCommand = telegramCustomCommands(triggerData).find((item) => item.command === command);
  if (customCommand) {
    if (customCommand.action === "services") {
      await saveTelegramConversationState(stateIdentity, "SHOWING_SERVICES", context);
      await showServices(connection, event, false);
      return true;
    }
    if (customCommand.action === "book") {
      if (!bookingMode(triggerData)) {
        await sendText(connection, event, "custom-booking-disabled", "Booking is not enabled for this bot.");
        return true;
      }
      await saveTelegramConversationState(stateIdentity, "SELECTING_SERVICE", {});
      await showServices(connection, event, true);
      return true;
    }
    if (customCommand.action === "help") {
      await sendHelpMenu(connection, event, triggerData);
      return true;
    }
    await sendText(
      connection,
      event,
      `custom-command:${customCommand.command}`,
      renderBusinessTemplate(customCommand.response, connection.business.name)
    );
    return true;
  }
  if (command === "services") {
    await saveTelegramConversationState(stateIdentity, "SHOWING_SERVICES", context);
    await showServices(connection, event, false);
    return true;
  }
  if (command === "book") {
    await saveTelegramConversationState(stateIdentity, "SELECTING_SERVICE", {});
    await showServices(connection, event, true);
    return true;
  }
  if (command === "help") {
    await sendHelpMenu(connection, event, triggerData);
    return true;
  }
  if (command === "mybookings" || command === "reschedule") {
    const pendingIntent: "mybookings" | "reschedule" = command;
    const nextContext = { ...context, pendingIntent };
    await saveTelegramConversationState(
      stateIdentity,
      nextContext.customerPhone ? "STARTED" : "WAITING_FOR_PHONE",
      nextContext
    );
    await showCustomerBookings(connection, event, nextContext, pendingIntent);
    return true;
  }
  if (command === "cancel") {
    const activeFlow = !["STARTED", "BOOKED", "REQUESTED", "CANCELLED", "EXPIRED"].includes(stateName);
    if (activeFlow) {
      await saveTelegramConversationState(stateIdentity, "CANCELLED", {});
      await sendText(connection, event, "cancel-flow", "The current booking flow has been cancelled.");
      return true;
    }
    const nextContext = { ...context, pendingIntent: "cancel" as const };
    await saveTelegramConversationState(
      stateIdentity,
      nextContext.customerPhone ? "CANCELLING" : "WAITING_FOR_PHONE",
      nextContext
    );
    await showCustomerBookings(connection, event, nextContext, "cancel");
    return true;
  }
  return false;
}

async function handleCallback(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  triggerData: JsonRecord,
  stateIdentity: TelegramConversationIdentity,
  context: TelegramBookingContext
): Promise<boolean> {
  const data = event.callback.data;
  if (!data) return false;
  const bookingCallback =
    data === "nav:book" ||
    data === "nav:mybookings" ||
    data.startsWith("service:") ||
    data.startsWith("date:") ||
    data.startsWith("slot:") ||
    data.startsWith("booking:") ||
    data.startsWith("booking-request:") ||
    data.startsWith("reschedule:") ||
    data.startsWith("cancel:");
  if (bookingCallback && !bookingMode(triggerData)) return false;
  if (data === "nav:services" && !commandEnabled(triggerData, "telegramServicesCommand")) return false;
  if (data === "nav:help" && !commandEnabled(triggerData, "telegramHelpCommand")) return false;
  if (data === "nav:services") {
    await answerCallback(connection, event, "nav-services-callback");
    await saveTelegramConversationState(stateIdentity, "SHOWING_SERVICES", context);
    await showServices(connection, event, false);
    return true;
  }
  if (data === "nav:book") {
    await answerCallback(connection, event, "nav-book-callback");
    await saveTelegramConversationState(stateIdentity, "SELECTING_SERVICE", {});
    await showServices(connection, event, true);
    return true;
  }
  if (data === "nav:mybookings") {
    await answerCallback(connection, event, "nav-mybookings-callback");
    const next = { ...context, pendingIntent: "mybookings" as const };
    await saveTelegramConversationState(
      stateIdentity,
      next.customerPhone ? "STARTED" : "WAITING_FOR_PHONE",
      next
    );
    await showCustomerBookings(connection, event, next, "mybookings");
    return true;
  }
  if (data === "nav:help") {
    await answerCallback(connection, event, "nav-help-callback");
    await handleCommand(
      connection,
      { ...event, message: { ...event.message, text: "/help" } },
      triggerData,
      stateIdentity,
      context,
      "STARTED"
    );
    return true;
  }
  if (data.startsWith("service:")) {
    const slug = data.slice("service:".length);
    const service = await loadTelegramBusinessService({
      businessId: connection.businessId,
      installedAgentId: connection.installedAgentId,
      serviceSlug: slug
    });
    if (!service) {
      await answerCallback(connection, event, "service-invalid-callback", "Service is unavailable.");
      return true;
    }
    const nextContext: TelegramBookingContext = {
      ...context,
      serviceId: service.id,
      serviceSlug: service.slug,
      serviceName: service.name,
      serviceDurationMinutes: service.durationMinutes,
      selectedDate: undefined,
      selectedStartAt: undefined,
      bookingAttemptId: undefined
    };
    await answerCallback(connection, event, "service-callback", service.name);
    await beginBookingForService(connection, event, stateIdentity, nextContext);
    return true;
  }
  if (data.startsWith("date:") && context.serviceName) {
    const date = data.slice("date:".length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await answerCallback(connection, event, "date-invalid-callback", "Invalid date.");
      return true;
    }
    const next = { ...context, selectedDate: date, selectedStartAt: undefined };
    await answerCallback(connection, event, "date-callback");
    await saveTelegramConversationState(stateIdentity, "SELECTING_TIME", next);
    await showSlots(connection, event, next, date);
    return true;
  }
  if (data.startsWith("slot:") && context.serviceName && context.selectedDate) {
    const startAt = data.slice("slot:".length);
    const parsed = new Date(startAt);
    const timeZone = connection.business.profile?.timeZone || "UTC";
    if (
      Number.isNaN(parsed.getTime()) ||
      dateOnlyInZone(parsed, timeZone) !== context.selectedDate
    ) {
      await answerCallback(connection, event, "slot-invalid-callback", "Invalid time.");
      return true;
    }
    const next = {
      ...context,
      selectedStartAt: parsed.toISOString(),
      bookingAttemptId: context.reschedulingAppointmentId
        ? context.bookingAttemptId
        : crypto.randomUUID()
    };
    await answerCallback(connection, event, "slot-callback");
    if (context.reschedulingAppointmentId) {
      await saveTelegramConversationState(stateIdentity, "CONFIRMING", next);
      const result = await sendButtons(
        connection,
        event,
        "reschedule-summary",
        `Move your appointment to ${localAppointmentLabel(
          parsed.toISOString(),
          connection.business.profile?.timeZone || "UTC"
        )}?`,
        [
          [{ text: "Confirm reschedule", callbackData: "reschedule:confirm" }],
          [{ text: "Cancel", callbackData: "booking:cancel" }]
        ]
      );
      await saveTelegramConversationState(stateIdentity, "CONFIRMING", {
        ...next,
        summaryMessageId: result.messageId ?? undefined
      });
      return true;
    }
    await saveTelegramConversationState(stateIdentity, "WAITING_FOR_NAME", next);
    await sendText(connection, event, "ask-name", "What is your full name?");
    return true;
  }
  if (data === "booking:confirm") {
    if (context.appointmentId) {
      await answerCallback(connection, event, "booking-already-confirmed-callback", "Already booked.");
      return true;
    }
    await confirmBooking(connection, event, stateIdentity, context);
    return true;
  }
  if (data === "booking-request:confirm") {
    if (context.bookingReference) {
      await answerCallback(connection, event, "booking-request-already-confirmed", "Request already sent.");
      return true;
    }
    await confirmManualBookingRequest(connection, event, stateIdentity, context);
    return true;
  }
  if (data === "booking:change") {
    await answerCallback(connection, event, "booking-change-callback");
    await saveTelegramConversationState(stateIdentity, "SELECTING_SERVICE", {});
    await showServices(connection, event, true);
    return true;
  }
  if (data === "booking:cancel") {
    await answerCallback(connection, event, "booking-cancel-flow-callback", "Cancelled.");
    await saveTelegramConversationState(stateIdentity, "CANCELLED", {});
    await sendText(connection, event, "booking-cancel-flow", "The booking flow has been cancelled.");
    return true;
  }
  if (data === "reschedule:confirm") {
    if (!context.reschedulingAppointmentId) {
      await answerCallback(connection, event, "reschedule-already-confirmed-callback", "Already processed.");
      return true;
    }
    await confirmReschedule(connection, event, stateIdentity, context);
    return true;
  }
  if (data.startsWith("booking-view:")) {
    await answerCallback(connection, event, "booking-view-callback");
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: data.slice("booking-view:".length),
        businessId: connection.businessId,
        installedAgentId: connection.installedAgentId,
        customerPhone: context.customerPhone
      }
    });
    if (appointment) {
      await sendText(
        connection,
        event,
        "booking-details",
        `${appointment.service ?? "Appointment"}\n${localAppointmentLabel(
          appointment.startAt.toISOString(),
          connection.business.profile?.timeZone || "UTC"
        )}\nReference: ${appointment.bookingReference ?? appointment.id.slice(-8).toUpperCase()}`
      );
    }
    return true;
  }
  if (data.startsWith("booking-cancel:")) {
    await cancelAppointment(
      connection,
      event,
      stateIdentity,
      context,
      data.slice("booking-cancel:".length)
    );
    return true;
  }
  if (data.startsWith("booking-reschedule:")) {
    await beginReschedule(
      connection,
      event,
      stateIdentity,
      context,
      data.slice("booking-reschedule:".length)
    );
    return true;
  }
  return false;
}

async function handleCollectedInput(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  triggerData: JsonRecord,
  stateIdentity: TelegramConversationIdentity,
  stateName: string,
  context: TelegramBookingContext
): Promise<boolean> {
  const text = event.message.text.trim();
  if (stateName === "SELECTING_SERVICE" && text && !text.startsWith("/")) {
    const services = await loadTelegramBusinessServices({
      businessId: connection.businessId,
      installedAgentId: connection.installedAgentId
    });
    const wanted = normalizedServiceName(text);
    const exact = services.find((service) => normalizedServiceName(service.name) === wanted);
    const partial = services.filter((service) => {
      const candidate = normalizedServiceName(service.name);
      return candidate.includes(wanted) || wanted.includes(candidate);
    });
    const service = exact ?? (partial.length === 1 ? partial[0] : null);
    if (!service) {
      await sendText(
        connection,
        event,
        "typed-service-not-found",
        `I couldn't match “${text.slice(0, 80)}” to one service. Type the exact service name or choose a button below.`
      );
      await showServices(connection, event, true);
      return true;
    }
    const next: TelegramBookingContext = {
      ...context,
      serviceId: service.id,
      serviceSlug: service.slug,
      serviceName: service.name,
      serviceDurationMinutes: service.durationMinutes,
      selectedDate: undefined,
      selectedStartAt: undefined,
      bookingAttemptId: undefined
    };
    await beginBookingForService(connection, event, stateIdentity, next);
    return true;
  }
  if (stateName === "WAITING_FOR_PREFERRED_DATE" && text && !text.startsWith("/")) {
    const next = { ...context, preferredDate: text.slice(0, 120) };
    await saveTelegramConversationState(stateIdentity, "WAITING_FOR_PREFERRED_TIME", next);
    await sendText(
      connection,
      event,
      "ask-preferred-time",
      "What time would you prefer? Include AM/PM and your timezone if relevant."
    );
    return true;
  }
  if (stateName === "WAITING_FOR_PREFERRED_TIME" && text && !text.startsWith("/")) {
    const next = { ...context, preferredTime: text.slice(0, 120) };
    await saveTelegramConversationState(stateIdentity, "WAITING_FOR_NAME", next);
    await sendText(connection, event, "ask-name", "What is your full name?");
    return true;
  }
  if (stateName === "WAITING_FOR_NAME" && text && !text.startsWith("/")) {
    const next = { ...context, customerName: text.slice(0, 120) };
    await saveTelegramConversationState(stateIdentity, "WAITING_FOR_PHONE", next);
    await requestContact(connection, event, "ask-phone");
    return true;
  }
  if (stateName === "WAITING_FOR_PHONE") {
    if (event.contact.userId && event.contact.userId !== event.sender.id) {
      await sendText(
        connection,
        event,
        "phone-owner-mismatch",
        "Please share your own Telegram contact or type your phone number manually."
      );
      return true;
    }
    const phone = normalizePhone(event.contact.phoneNumber || text);
    if (!phone) {
      await sendText(
        connection,
        event,
        "phone-invalid",
        "Enter a valid phone number in international format, for example +15551234567."
      );
      return true;
    }
    const next = { ...context, customerPhone: phone };
    if (context.pendingIntent) {
      await saveTelegramConversationState(stateIdentity, "STARTED", next);
      await showCustomerBookings(connection, event, next, context.pendingIntent);
      return true;
    }
    if (boolValue(triggerData.telegramRequestEmail, false)) {
      await saveTelegramConversationState(stateIdentity, "WAITING_FOR_EMAIL", next);
      await sendText(connection, event, "ask-email", "What email address should receive the confirmation?");
      return true;
    }
    if (boolValue(triggerData.telegramRequestNotes, false)) {
      await saveTelegramConversationState(stateIdentity, "WAITING_FOR_NOTES", next);
      await sendText(
        connection,
        event,
        "ask-notes",
        "Add any notes for the business, or type skip."
      );
      return true;
    }
    await finishBookingDetails(connection, event, stateIdentity, next);
    return true;
  }
  if (stateName === "WAITING_FOR_EMAIL") {
    if (!validEmail(text)) {
      await sendText(connection, event, "email-invalid", "Enter a valid email address.");
      return true;
    }
    const next = { ...context, customerEmail: text.toLowerCase() };
    if (boolValue(triggerData.telegramRequestNotes, false)) {
      await saveTelegramConversationState(stateIdentity, "WAITING_FOR_NOTES", next);
      await sendText(
        connection,
        event,
        "ask-notes",
        "Add any notes for the business, or type skip."
      );
      return true;
    }
    await finishBookingDetails(connection, event, stateIdentity, next);
    return true;
  }
  if (stateName === "WAITING_FOR_NOTES" && text && !text.startsWith("/")) {
    const next = {
      ...context,
      customerNotes: text.toLowerCase() === "skip" ? undefined : text.slice(0, 1_000)
    };
    await finishBookingDetails(connection, event, stateIdentity, next);
    return true;
  }
  return false;
}

async function naturalLanguageRoute(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  stateIdentity: TelegramConversationIdentity,
  context: TelegramBookingContext
): Promise<boolean> {
  const text = event.message.text.trim().toLowerCase();
  if (!text) return false;
  if (/\b(cancel|delete)\b.*\b(booking|appointment)\b/i.test(text)) {
    const next = { ...context, pendingIntent: "cancel" as const };
    await saveTelegramConversationState(
      stateIdentity,
      next.customerPhone ? "CANCELLING" : "WAITING_FOR_PHONE",
      next
    );
    await showCustomerBookings(connection, event, next, "cancel");
    return true;
  }
  if (/\b(reschedule|move|change)\b.*\b(booking|appointment|time)\b/i.test(text)) {
    const next = { ...context, pendingIntent: "reschedule" as const };
    await saveTelegramConversationState(
      stateIdentity,
      next.customerPhone ? "RESCHEDULING" : "WAITING_FOR_PHONE",
      next
    );
    await showCustomerBookings(connection, event, next, "reschedule");
    return true;
  }
  if (/\b(my|show|view)\b.*\b(bookings?|appointments?)\b/i.test(text)) {
    const next = { ...context, pendingIntent: "mybookings" as const };
    await saveTelegramConversationState(
      stateIdentity,
      next.customerPhone ? "STARTED" : "WAITING_FOR_PHONE",
      next
    );
    await showCustomerBookings(connection, event, next, "mybookings");
    return true;
  }
  if (/\b(show|view|list).*\bservices?\b|\bwhat (do you|services)/i.test(text)) {
    await saveTelegramConversationState(stateIdentity, "SHOWING_SERVICES", context);
    await showServices(connection, event, false);
    return true;
  }
  if (
    /\b(available|availability|open|times?|slots?)\b/i.test(text) &&
    context.serviceName
  ) {
    if (!(await businessCalendarConnected(connection, context.serviceName))) {
      await beginBookingForService(connection, event, stateIdentity, context);
      return true;
    }
    const timeZone = connection.business.profile?.timeZone || "UTC";
    const today = dateOnlyInZone(new Date(), timeZone);
    const requestedDate = /\btomorrow\b/i.test(text) ? nextDate(today, 1) : today;
    await saveTelegramConversationState(stateIdentity, "SELECTING_TIME", {
      ...context,
      selectedDate: requestedDate,
      selectedStartAt: undefined
    });
    await showSlots(connection, event, context, requestedDate);
    return true;
  }
  if (/\b(book|schedule|appointment)\b/i.test(text)) {
    const services = await loadTelegramBusinessServices({
      businessId: connection.businessId,
      installedAgentId: connection.installedAgentId
    });
    const service = services.find((item) => text.includes(item.name.toLowerCase()));
    if (service) {
      const next = {
        ...context,
        serviceId: service.id,
        serviceSlug: service.slug,
        serviceName: service.name,
        serviceDurationMinutes: service.durationMinutes
      };
      await beginBookingForService(connection, event, stateIdentity, next);
    } else {
      await saveTelegramConversationState(stateIdentity, "SELECTING_SERVICE", {});
      await showServices(connection, event, true);
    }
    return true;
  }
  if (/\bcancel.*appointment|\bcancel.*booking/i.test(text)) {
    const next = { ...context, pendingIntent: "cancel" as const };
    await saveTelegramConversationState(
      stateIdentity,
      next.customerPhone ? "CANCELLING" : "WAITING_FOR_PHONE",
      next
    );
    await showCustomerBookings(connection, event, next, "cancel");
    return true;
  }
  return false;
}

async function workflowFallback(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  triggerData: JsonRecord
) {
  const text = event.message.text || event.message.caption || `[${event.eventType}]`;
  const profile = connection.business.profile;

  /* The runner only ever reads knowledge from its input — it never loads from
     the database itself. Without this, a Telegram bot answers from the prompt
     and the services list alone and cannot see anything the buyer uploaded,
     while the voice path answers the same question correctly via
     lookup_knowledge. Retrieval is query-aware, so only the sections relevant
     to THIS message are sent. */
  const knowledge = await retrieveRelevantKnowledge({
    businessId: connection.businessId,
    installedAgentId: connection.installedAgentId,
    query: text
  })
    .then((sections) => formatKnowledgeEntries(sections))
    .catch((error) => {
      // Knowledge is an enhancement — never fail the reply because of it.
      console.warn("[telegram] knowledge retrieval failed", {
        businessId: connection.businessId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [] as string[];
    });

  const run = await runWorkflowTest({
    userId: connection.business.ownerId,
    workflowId: connection.installedAgent.workflowId,
    workflowJson: connection.installedAgent.workflow.workflowJson,
    mode: "live",
    executionMode: "LIVE",
    callProvider: `TELEGRAM:${connection.id}`,
    externalCallId: event.updateId,
    input: {
      businessId: connection.businessId,
      installedAgentId: connection.installedAgentId,
      businessOwnerId: connection.business.ownerId,
      businessName: connection.business.name,
      businessType: connection.business.type,
      businessPhoneNumber: connection.business.phoneNumbers[0]?.phoneNumber,
      calendarId: profile?.calendarId || "primary",
      timeZone: profile?.timeZone || "UTC",
      services: profile?.services ?? [],
      knowledge,
      latestMessage: text,
      inboundSmsBody: text,
      telegramConnectionId: connection.id,
      telegramUpdateId: event.updateId,
      telegramChatId: event.chat.id,
      telegramUserId: event.sender.id,
      telegramUsername: event.sender.username,
      telegramMessageId: event.message.id,
      telegramChatType: event.chat.type,
      telegramPhoneNumber: event.contact.phoneNumber,
      trigger: { telegram: event },
      telegramEvent: event
    }
  });
  const context = record(run.context);
  const telegramAction = record(context.telegramAction);
  if (telegramAction.success === true) return run.workflowRunId ?? null;
  const ai = record(context.ai);
  const reply =
    stringValue(ai.output) ||
    renderBusinessTemplate(triggerData.telegramFallbackMessage, connection.business.name) ||
    "I did not understand that. Use /services, /book, or /help.";
  await sendText(connection, event, "workflow-reply", reply);
  return run.workflowRunId ?? null;
}

async function processEvent(
  connection: LoadedConnection,
  event: NormalizedTelegramEvent,
  triggerData: JsonRecord
): Promise<string | null> {
  if (await authorizeOwnerChat(connection, event)) return null;
  if (await handleConnectedOwnerMessage(connection, event)) return null;
  const stateIdentity = identity(connection, event);
  const loadedState = await loadTelegramConversationState(stateIdentity);
  const stateName = loadedState?.state ?? "STARTED";
  const context = loadedState?.context ?? {};

  if (await handleCommand(connection, event, triggerData, stateIdentity, context, stateName)) return null;
  if (event.eventType === "callback_query") {
    if (await handleCallback(connection, event, triggerData, stateIdentity, context)) return null;
    await answerCallback(connection, event, "unknown-callback", "This option has expired.");
    return null;
  }
  if (
    bookingMode(triggerData) &&
    await handleCollectedInput(connection, event, triggerData, stateIdentity, stateName, context)
  ) return null;
  if (bookingMode(triggerData) && await naturalLanguageRoute(connection, event, stateIdentity, context)) return null;
  return workflowFallback(connection, event, triggerData);
}

export async function processTelegramStoredUpdate(processedUpdateId: string): Promise<void> {
  const stored = await prisma.telegramProcessedUpdate.findUnique({
    where: { id: processedUpdateId }
  });
  if (!stored || stored.status === "PROCESSED" || stored.status === "IGNORED") return;

  const staleProcessingBefore = new Date(Date.now() - 5 * 60_000);
  const claimed = await prisma.telegramProcessedUpdate.updateMany({
    where: {
      id: stored.id,
      OR: [
        { status: { in: ["RECEIVED", "PENDING", "FAILED"] } },
        { status: "PROCESSING", updatedAt: { lt: staleProcessingBefore } }
      ]
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      errorCode: null,
      errorMessage: null,
      processedAt: null
    }
  });
  if (claimed.count !== 1) return;

  const connection = await loadRuntimeConnection(stored.telegramConnectionId);
  if (!connection) {
    await prisma.telegramProcessedUpdate.update({
      where: { id: stored.id },
      data: { status: "FAILED", errorCode: "CONNECTION_NOT_FOUND", processedAt: new Date() }
    });
    return;
  }

  try {
    if (
      connection.status !== "ACTIVE" ||
      connection.installedAgent.status !== "ACTIVE" ||
      connection.installedAgent.pausedAt ||
      !connection.botTokenEncrypted
    ) {
      await prisma.telegramProcessedUpdate.update({
        where: { id: stored.id },
        data: { status: "IGNORED", errorCode: "AGENT_INACTIVE", processedAt: new Date() }
      });
      return;
    }
    const parsed = telegramUpdateSchema.safeParse(stored.payloadJson);
    if (!parsed.success) {
      await prisma.telegramProcessedUpdate.update({
        where: { id: stored.id },
        data: { status: "IGNORED", errorCode: "UNSUPPORTED_UPDATE", processedAt: new Date() }
      });
      return;
    }
    const event = normalizeTelegramUpdate({
      update: parsed.data,
      businessId: connection.businessId,
      installedAgentId: connection.installedAgentId,
      telegramConnectionId: connection.id,
      botId: connection.botUserId ?? "",
      botUsername: connection.botUsername ?? ""
    });
    if (!event) {
      await prisma.telegramProcessedUpdate.update({
        where: { id: stored.id },
        data: { status: "IGNORED", errorCode: "UNSUPPORTED_UPDATE", processedAt: new Date() }
      });
      return;
    }
    const ownerAuthorization = inspectTelegramOwnerAuthorizationCommand({
      text: event.message.text,
      expectedTokenHash: connection.ownerNotificationNonceHash,
      chatType: event.chat.type
    });
    const isConnectedOwner = telegramEventBelongsToBusinessOwner(connection, event);
    if (shouldRememberTelegramEventAsCustomer(connection, event, ownerAuthorization.matches)) {
      await rememberTelegramConversation(identity(connection, event));
    }
    const node = triggerNode(connection.installedAgent.workflow.workflowJson);
    if (!node) {
      await prisma.telegramProcessedUpdate.update({
        where: { id: stored.id },
        data: { status: "IGNORED", errorCode: "TRIGGER_NOT_FOUND", processedAt: new Date() }
      });
      return;
    }
    const data = telegramTriggerData(
      connection.installedAgent.workflow.workflowJson,
      connection.installedAgent.configJson
    );
    const matches = telegramTriggerMatches(event, triggerConfig(data));
    if (
      !matches &&
      !(bookingMode(data) && event.eventType === "callback_query") &&
      !isConnectedOwner &&
      !ownerAuthorization.matches
    ) {
      await prisma.telegramProcessedUpdate.update({
        where: { id: stored.id },
        data: { status: "IGNORED", errorCode: "TRIGGER_NOT_MATCHED", processedAt: new Date() }
      });
      return;
    }
    const workflowRunId = await processEvent(connection, event, data);
    await prisma.$transaction([
      prisma.telegramProcessedUpdate.update({
        where: { id: stored.id },
        data: {
          status: "PROCESSED",
          workflowRunId,
          processedAt: new Date(),
          errorCode: null,
          errorMessage: null
        }
      }),
      prisma.telegramBotConnection.update({
        where: { id: connection.id },
        data: {
          lastWebhookAt: new Date(),
          webhookStatus: "HEALTHY",
          lastError: null
        }
      })
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram update processing failed.";
    await prisma.$transaction([
      prisma.telegramProcessedUpdate.update({
        where: { id: stored.id },
        data: {
          status: "FAILED",
          errorCode: error instanceof Error ? error.name : "TELEGRAM_UPDATE_FAILED",
          errorMessage: message.slice(0, 500),
          processedAt: new Date()
        }
      }),
      prisma.telegramBotConnection.update({
        where: { id: connection.id },
        data: {
          lastError: message.slice(0, 500)
        }
      })
    ]);
    throw error;
  }
}

export function telegramBotTokenForConnection(connection: { botTokenEncrypted: string | null }): string | null {
  return connection.botTokenEncrypted ? decryptSecret(connection.botTokenEncrypted) : null;
}
