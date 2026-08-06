import crypto from "crypto";
import type { Context } from "hono";
import { ConnectorProvider, Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import {
  answerTelegramCallback,
  getTelegramBotIdentity,
  getTelegramWebhookInfo,
  sendTelegramMessage,
  telegramApiRequest,
  TelegramApiError,
  type TelegramJson
} from "./telegram-api-client";
import { TelegramConnectorError } from "./telegram-connector";
import { telegramCommandList, telegramCustomCommands } from "./telegram-command-config";
import {
  normalizeTelegramUpdate,
  telegramTriggerMatches,
  telegramUpdateSchema,
  type NormalizedTelegramEvent,
  type TelegramTriggerConfig
} from "./telegram-update";
import { parseRunnerWorkflowJson, runWorkflowTest, type WorkflowRunLog } from "./workflow-runner";

const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
const TELEGRAM_TRIGGER_TYPE = "trigger.telegram_message";

type JsonRecord = Record<string, unknown>;

type ArchitectTelegramTestBookingState =
  | "SELECTING_SERVICE"
  | "WAITING_FOR_DATE"
  | "WAITING_FOR_TIME"
  | "WAITING_FOR_NAME"
  | "WAITING_FOR_PHONE"
  | "WAITING_FOR_EMAIL"
  | "WAITING_FOR_NOTES";

type ArchitectTelegramTestBookingSession = {
  state: ArchitectTelegramTestBookingState;
  service?: string;
  date?: string;
  time?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerNotes?: string;
  updatedAt: string;
};

type ArchitectTelegramTestMetadata = {
  status?: "CONNECTED" | "ERROR";
  activeWorkflowId?: string;
  botId?: string;
  botUsername?: string;
  webhookSecretEncrypted?: string;
  webhookStatus?: string;
  connectedAt?: string;
  lastWebhookAt?: string;
  lastUpdateId?: string;
  lastMessage?: string;
  lastSender?: string;
  lastChatId?: string;
  lastRunAt?: string;
  lastRunStatus?: "PROCESSING" | "SUCCESS" | "FAILED" | "IGNORED";
  lastWorkflowRunId?: string | null;
  lastRunLogs?: WorkflowRunLog[];
  lastError?: string | null;
  commands?: Array<{ command: string; description: string }>;
  bookingSessions?: Record<string, ArchitectTelegramTestBookingSession>;
  testContext?: {
    businessName?: string;
    businessType?: string;
    appointmentService?: string;
    services?: string[];
    timeZone?: string;
  };
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function flag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}

export function renderArchitectTelegramTestTemplate(template: string, businessName: string, userName = "there"): string {
  return template
    .replace(/\{\{\s*business\.name\s*\}\}/gi, businessName)
    .replace(/\{\{\s*business_name\s*\}\}/gi, businessName)
    .replace(/\{\{\s*user\.name\s*\}\}/gi, userName)
    .replace(/\{\{\s*user\.first_name\s*\}\}/gi, userName)
    .replace(/\{\{\s*user\.firstName\s*\}\}/gi, userName)
    .replace(/\{\{\s*customer\.name\s*\}\}/gi, userName);
}

function metadata(value: unknown): ArchitectTelegramTestMetadata {
  return record(value) as ArchitectTelegramTestMetadata;
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function webhookUrl(connectionId: string): string {
  const base = new URL(env.BACKEND_URL);
  if (
    base.protocol !== "https:" ||
    ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(base.hostname)
  ) {
    throw new TelegramConnectorError(
      "Live Telegram testing needs a public HTTPS BACKEND_URL. Start the development tunnel and try again.",
      "TELEGRAM_PUBLIC_WEBHOOK_REQUIRED",
      503
    );
  }
  return `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/telegram/test-webhook/${encodeURIComponent(connectionId)}`;
}

function triggerNode(workflowJson: unknown) {
  return parseRunnerWorkflowJson(workflowJson).nodes.find(
    (node) => text(node.data?.type) === TELEGRAM_TRIGGER_TYPE
  );
}

function triggerConfig(data: JsonRecord): TelegramTriggerConfig {
  const keywords = Array.isArray(data.telegramKeywords)
    ? data.telegramKeywords.filter((value): value is string => typeof value === "string")
    : text(data.telegramKeywords).split(",").map((value) => value.trim()).filter(Boolean);
  return {
    eventType: text(data.telegramEventType, "message") as TelegramTriggerConfig["eventType"],
    command: text(data.telegramCommand),
    keywords,
    matchType: text(data.telegramMatchType, "contains") as TelegramTriggerConfig["matchType"],
    privateChatsOnly: text(data.telegramChatAccess, "private") === "private",
    ignoreBots: flag(data.telegramIgnoreBots, true)
  };
}

function testServices(context: ArchitectTelegramTestMetadata["testContext"]): string[] {
  const services = Array.isArray(context?.services)
    ? context.services.map((service) => text(service)).filter(Boolean).slice(0, 30)
    : [];
  if (services.length > 0) return services;
  return [text(context?.appointmentService, "General Consultation")];
}

type ArchitectTelegramTestReply = {
  text: string;
  replyMarkup?: TelegramJson;
  nextSession?: ArchitectTelegramTestBookingSession | null;
  callbackText?: string;
};

const TEST_BOOKING_SESSION_TTL_MS = 2 * 60 * 60_000;

function normalizedServiceName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

function session(
  state: ArchitectTelegramTestBookingState,
  current: Partial<ArchitectTelegramTestBookingSession> = {}
): ArchitectTelegramTestBookingSession {
  return { ...current, state, updatedAt: new Date().toISOString() };
}

function serviceMenu(services: string[]): ArchitectTelegramTestReply {
  return {
    text: "Which service would you like to book? Choose a button or type the exact service name.",
    replyMarkup: {
      inline_keyboard: services.map((service, index) => [{
        text: service.slice(0, 64),
        callback_data: `testbook:service:${index}`
      }])
    },
    nextSession: session("SELECTING_SERVICE")
  };
}

function selectedTestService(services: string[], value: string): string | null {
  const wanted = normalizedServiceName(value);
  if (!wanted) return null;
  const exact = services.find((service) => normalizedServiceName(service) === wanted);
  const partial = services.filter((service) => {
    const candidate = normalizedServiceName(service);
    return candidate.includes(wanted) || wanted.includes(candidate);
  });
  return exact ?? (partial.length === 1 ? partial[0] ?? null : null);
}

function completeTestBooking(
  businessName: string,
  booking: ArchitectTelegramTestBookingSession
): ArchitectTelegramTestReply {
  return {
    text: [
      "Architect test booking captured",
      "",
      `Business: ${businessName}`,
      `Service: ${booking.service}`,
      `Date: ${booking.date}`,
      `Time: ${booking.time}`,
      `Customer: ${booking.customerName}`,
      `Phone: ${booking.customerPhone}`,
      ...(booking.customerEmail ? [`Email: ${booking.customerEmail}`] : []),
      ...(booking.customerNotes ? [`Notes: ${booking.customerNotes}`] : []),
      "",
      "This is an Architect test only; no live customer appointment was created."
    ].join("\n"),
    nextSession: null
  };
}

export function architectTelegramTestInteraction(options: {
  event: NormalizedTelegramEvent;
  triggerData: JsonRecord;
  context: ArchitectTelegramTestMetadata["testContext"];
  workflowName: string;
  currentSession: ArchitectTelegramTestBookingSession | null;
}): ArchitectTelegramTestReply | null {
  const messageText = options.event.message.text.trim();
  const match = messageText.match(/^\/([a-z0-9_]+)(?:@\S+)?(?:\s|$)/i);
  const command = (match?.[1] ?? "").toLowerCase();
  const commands = telegramCommandList(options.triggerData);
  const customCommand = telegramCustomCommands(options.triggerData).find((item) => item.command === command);
  const businessName = text(options.context?.businessName, options.workflowName);
  const services = testServices(options.context);

  if (options.currentSession && command === "cancel") {
    return { text: "The Architect test booking has been cancelled.", nextSession: null };
  }
  if (command === "start") {
    const welcome = text(
      options.triggerData.telegramWelcomeMessage,
      `Welcome to ${businessName}. How can I help?`
    );
    return {
      text: renderArchitectTelegramTestTemplate(welcome, businessName),
      nextSession: null
    };
  }
  if (command && !commands.some((item) => item.command === command)) return null;
  if (customCommand?.action === "reply") {
    return {
      text: renderArchitectTelegramTestTemplate(customCommand.response, businessName),
      nextSession: null
    };
  }
  if (command === "services" || customCommand?.action === "services") {
    return {
      text: [`Services available from ${businessName}:`, ...services.map((service) => `• ${service}`)].join("\n"),
      nextSession: null
    };
  }
  if (command === "help" || customCommand?.action === "help") {
    return {
      text: ["Available commands:", ...commands.map((item) => `/${item.command} — ${item.description}`)].join("\n"),
      nextSession: null
    };
  }
  if (command === "book" || customCommand?.action === "book") {
    if (!flag(options.triggerData.telegramBookingMode, false)) {
      return { text: "Booking features are not enabled for this test bot.", nextSession: null };
    }
    return serviceMenu(services);
  }
  if (command === "mybookings") {
    return { text: "No live customer bookings are stored in this Architect test bot.", nextSession: null };
  }
  if (command === "reschedule") {
    return { text: "Send the booking reference you want to reschedule.", nextSession: null };
  }
  if (command === "cancel") {
    return { text: "Send the booking reference you want to cancel.", nextSession: null };
  }

  const booking = options.currentSession;
  if (options.event.callback.data.startsWith("testbook:service:") && booking?.state !== "SELECTING_SERVICE") {
    return {
      text: "This test service menu has expired. Send /book to start again.",
      nextSession: null,
      callbackText: "Menu expired"
    };
  }
  if (!booking) return null;
  if (booking.state === "SELECTING_SERVICE") {
    const callbackPrefix = "testbook:service:";
    const callbackIndex = options.event.callback.data.startsWith(callbackPrefix)
      ? Number(options.event.callback.data.slice(callbackPrefix.length))
      : -1;
    const selected = Number.isInteger(callbackIndex) && callbackIndex >= 0
      ? services[callbackIndex] ?? null
      : selectedTestService(services, messageText);
    if (!selected) {
      return {
        ...serviceMenu(services),
        text: "I couldn't match that service. Type the exact service name or choose a button.",
        callbackText: options.event.callback.id ? "Service unavailable" : undefined
      };
    }
    return {
      text: `Selected: ${selected}\n\nWhat date would you like? Send it as YYYY-MM-DD.`,
      nextSession: session("WAITING_FOR_DATE", { ...booking, service: selected }),
      callbackText: options.event.callback.id ? selected : undefined
    };
  }
  if (booking.state === "WAITING_FOR_DATE") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(messageText)) {
      return { text: "Enter the booking date as YYYY-MM-DD, for example 2026-08-20." };
    }
    return {
      text: "What time would you like? For example, 3:30 PM.",
      nextSession: session("WAITING_FOR_TIME", { ...booking, date: messageText })
    };
  }
  if (booking.state === "WAITING_FOR_TIME") {
    if (!messageText || messageText.length > 50) return { text: "Enter a valid booking time, for example 3:30 PM." };
    return {
      text: "What is your full name?",
      nextSession: session("WAITING_FOR_NAME", { ...booking, time: messageText })
    };
  }
  if (booking.state === "WAITING_FOR_NAME") {
    if (!messageText || messageText.startsWith("/")) return { text: "Please enter your full name." };
    return {
      text: "What phone number should receive booking updates? Include the country code.",
      nextSession: session("WAITING_FOR_PHONE", { ...booking, customerName: messageText.slice(0, 120) })
    };
  }
  if (booking.state === "WAITING_FOR_PHONE") {
    const phone = text(options.event.contact.phoneNumber, messageText).replace(/[()\s.-]/g, "");
    const normalizedPhone = phone.startsWith("+") ? phone : `+${phone}`;
    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
      return { text: "Enter a valid phone number with country code, for example +15551234567." };
    }
    const next = session("WAITING_FOR_PHONE", { ...booking, customerPhone: normalizedPhone });
    if (flag(options.triggerData.telegramRequestEmail, false)) {
      return { text: "What email address should receive the confirmation?", nextSession: session("WAITING_FOR_EMAIL", next) };
    }
    if (flag(options.triggerData.telegramRequestNotes, false)) {
      return { text: "Add any notes for the business, or type skip.", nextSession: session("WAITING_FOR_NOTES", next) };
    }
    return completeTestBooking(businessName, next);
  }
  if (booking.state === "WAITING_FOR_EMAIL") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(messageText)) {
      return { text: "Enter a valid email address." };
    }
    const next = session("WAITING_FOR_EMAIL", { ...booking, customerEmail: messageText.toLowerCase() });
    if (flag(options.triggerData.telegramRequestNotes, false)) {
      return { text: "Add any notes for the business, or type skip.", nextSession: session("WAITING_FOR_NOTES", next) };
    }
    return completeTestBooking(businessName, next);
  }
  if (booking.state === "WAITING_FOR_NOTES") {
    const next = session("WAITING_FOR_NOTES", {
      ...booking,
      customerNotes: messageText.toLowerCase() === "skip" ? undefined : messageText.slice(0, 1_000)
    });
    return completeTestBooking(businessName, next);
  }
  return null;
}

async function ownedWorkflow(userId: string, workflowId: string) {
  const workflow = await prisma.workflowDefinition.findFirst({
    where: { id: workflowId, architectUserId: userId }
  });
  if (!workflow) {
    throw new TelegramConnectorError("Workflow was not found.", "WORKFLOW_NOT_FOUND", 404);
  }
  if (!triggerNode(workflow.workflowJson)) {
    throw new TelegramConnectorError(
      "Add a Telegram Bot Trigger before connecting a test bot.",
      "TELEGRAM_TRIGGER_REQUIRED",
      422
    );
  }
  return workflow;
}

function publicStatus(
  connection: { id: string; accessTokenEnc: string | null; metadata: unknown } | null,
  workflowId: string
) {
  if (!connection) return { connection: null };
  const meta = metadata(connection.metadata);
  const activeForWorkflow = meta.activeWorkflowId === workflowId;
  return {
    connection: {
      id: connection.id,
      connected: Boolean(connection.accessTokenEnc && meta.status === "CONNECTED" && activeForWorkflow),
      activeForWorkflow,
      status: meta.status ?? "ERROR",
      webhookStatus: meta.webhookStatus ?? "UNKNOWN",
      botUsername: meta.botUsername ?? null,
      botUrl: meta.botUsername ? `https://t.me/${meta.botUsername}` : null,
      lastWebhookAt: meta.lastWebhookAt ?? null,
      lastMessage: meta.lastMessage ?? null,
      lastSender: meta.lastSender ?? null,
      lastChatId: meta.lastChatId ?? null,
      lastRunAt: meta.lastRunAt ?? null,
      lastRunStatus: meta.lastRunStatus ?? null,
      lastWorkflowRunId: meta.lastWorkflowRunId ?? null,
      lastRunLogs: Array.isArray(meta.lastRunLogs) ? meta.lastRunLogs : [],
      lastError: meta.lastError ?? null,
      commands: Array.isArray(meta.commands) ? meta.commands : [],
      services: testServices(meta.testContext)
    }
  };
}

export async function getArchitectTelegramTestStatus(userId: string, workflowId: string) {
  await ownedWorkflow(userId, workflowId);
  const connection = await prisma.connectorCredential.findUnique({
    where: { userId_provider: { userId, provider: ConnectorProvider.TELEGRAM } },
    select: { id: true, accessTokenEnc: true, metadata: true }
  });
  return publicStatus(connection, workflowId);
}

export async function connectArchitectTelegramTestBot(options: {
  userId: string;
  workflowId: string;
  botToken: string;
  testContext?: ArchitectTelegramTestMetadata["testContext"];
}) {
  const workflow = await ownedWorkflow(options.userId, options.workflowId);
  const node = triggerNode(workflow.workflowJson);
  if (!node) throw new TelegramConnectorError("Telegram trigger is missing.", "TELEGRAM_TRIGGER_REQUIRED", 422);

  let identity;
  try {
    identity = await getTelegramBotIdentity(options.botToken);
  } catch (error) {
    if (error instanceof TelegramApiError) {
      throw new TelegramConnectorError(error.message, "INVALID_TELEGRAM_BOT_TOKEN", 422);
    }
    throw error;
  }

  const businessBot = await prisma.telegramBotConnection.findFirst({
    where: {
      OR: [{ botUserId: String(identity.id) }, { botUsername: identity.username }],
      status: { not: "DISCONNECTED" }
    },
    select: { id: true }
  });
  if (businessBot) {
    throw new TelegramConnectorError(
      "Use a separate Telegram bot for Architect testing; this bot belongs to a business installation.",
      "TELEGRAM_TEST_BOT_IN_USE",
      409
    );
  }

  const anotherArchitect = await prisma.connectorCredential.findFirst({
    where: {
      provider: ConnectorProvider.TELEGRAM,
      userId: { not: options.userId },
      metadata: { path: ["botId"], equals: String(identity.id) }
    },
    select: { id: true }
  });
  if (anotherArchitect) {
    throw new TelegramConnectorError(
      "This test bot is already connected by another Architect.",
      "TELEGRAM_TEST_BOT_IN_USE",
      409
    );
  }

  const previous = await prisma.connectorCredential.findUnique({
    where: { userId_provider: { userId: options.userId, provider: ConnectorProvider.TELEGRAM } }
  });
  const previousMeta = metadata(previous?.metadata);
  if (previous?.accessTokenEnc && previousMeta.botId && previousMeta.botId !== String(identity.id)) {
    await telegramApiRequest<boolean>(decryptSecret(previous.accessTokenEnc), "deleteWebhook", {
      drop_pending_updates: true
    }).catch(() => false);
  }

  const secret = crypto.randomBytes(32).toString("base64url");
  const testContext = JSON.parse(JSON.stringify(options.testContext ?? {})) as NonNullable<
    ArchitectTelegramTestMetadata["testContext"]
  >;
  const baseMetadata: ArchitectTelegramTestMetadata = {
    status: "CONNECTED",
    activeWorkflowId: options.workflowId,
    botId: String(identity.id),
    botUsername: identity.username,
    webhookSecretEncrypted: encryptSecret(secret),
    webhookStatus: "CONFIGURING",
    connectedAt: new Date().toISOString(),
    lastError: null,
    commands: telegramCommandList(record(node.data)),
    testContext
  };
  const connection = await prisma.connectorCredential.upsert({
    where: { userId_provider: { userId: options.userId, provider: ConnectorProvider.TELEGRAM } },
    create: {
      userId: options.userId,
      provider: ConnectorProvider.TELEGRAM,
      externalAccountEmail: identity.username ? `@${identity.username}` : null,
      accessTokenEnc: encryptSecret(options.botToken),
      scope: options.workflowId,
      metadata: baseMetadata as Prisma.InputJsonValue
    },
    update: {
      externalAccountEmail: identity.username ? `@${identity.username}` : null,
      accessTokenEnc: encryptSecret(options.botToken),
      scope: options.workflowId,
      metadata: baseMetadata as Prisma.InputJsonValue
    }
  });

  try {
    await telegramApiRequest<boolean>(options.botToken, "setMyCommands", {
      commands: baseMetadata.commands
    });
    await telegramApiRequest<boolean>(options.botToken, "setWebhook", {
      url: webhookUrl(connection.id),
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true
    });
    const webhook = await getTelegramWebhookInfo(options.botToken);
    if (webhook.url !== webhookUrl(connection.id)) {
      throw new TelegramConnectorError(
        "Telegram did not retain the Architect test webhook.",
        "TELEGRAM_WEBHOOK_VERIFY_FAILED",
        502
      );
    }
    const updated = await prisma.connectorCredential.update({
      where: { id: connection.id },
      data: {
        metadata: { ...baseMetadata, webhookStatus: "HEALTHY" } as Prisma.InputJsonValue
      },
      select: { id: true, accessTokenEnc: true, metadata: true }
    });
    return publicStatus(updated, options.workflowId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram test bot setup failed.";
    await prisma.connectorCredential.update({
      where: { id: connection.id },
      data: {
        metadata: {
          ...baseMetadata,
          status: "ERROR",
          webhookStatus: "ERROR",
          lastError: message.slice(0, 500)
        } as Prisma.InputJsonValue
      }
    });
    throw error;
  }
}

export async function syncArchitectTelegramTestBot(options: {
  userId: string;
  workflowId: string;
  testContext?: ArchitectTelegramTestMetadata["testContext"];
}) {
  const workflow = await ownedWorkflow(options.userId, options.workflowId);
  const node = triggerNode(workflow.workflowJson);
  if (!node) throw new TelegramConnectorError("Telegram trigger is missing.", "TELEGRAM_TRIGGER_REQUIRED", 422);
  const connection = await prisma.connectorCredential.findUnique({
    where: { userId_provider: { userId: options.userId, provider: ConnectorProvider.TELEGRAM } }
  });
  const currentMetadata = metadata(connection?.metadata);
  if (
    !connection?.accessTokenEnc ||
    currentMetadata.activeWorkflowId !== options.workflowId ||
    currentMetadata.status !== "CONNECTED"
  ) {
    throw new TelegramConnectorError(
      "Connect a Telegram test bot before syncing commands.",
      "TELEGRAM_TEST_BOT_NOT_CONNECTED",
      409
    );
  }

  const commands = telegramCommandList(record(node.data));
  const botToken = decryptSecret(connection.accessTokenEnc);
  await telegramApiRequest<boolean>(botToken, "setMyCommands", { commands });
  const nextMetadata: ArchitectTelegramTestMetadata = {
    ...currentMetadata,
    commands,
    testContext: JSON.parse(JSON.stringify(options.testContext ?? currentMetadata.testContext ?? {})),
    lastError: null
  };
  const updated = await prisma.connectorCredential.update({
    where: { id: connection.id },
    data: { metadata: nextMetadata as Prisma.InputJsonValue },
    select: { id: true, accessTokenEnc: true, metadata: true }
  });
  return publicStatus(updated, options.workflowId);
}

export async function disconnectArchitectTelegramTestBot(userId: string, workflowId: string) {
  const connection = await prisma.connectorCredential.findUnique({
    where: { userId_provider: { userId, provider: ConnectorProvider.TELEGRAM } }
  });
  if (!connection || metadata(connection.metadata).activeWorkflowId !== workflowId) return false;
  if (connection.accessTokenEnc) {
    await telegramApiRequest<boolean>(decryptSecret(connection.accessTokenEnc), "deleteWebhook", {
      drop_pending_updates: true
    }).catch(() => false);
  }
  await prisma.connectorCredential.delete({ where: { id: connection.id } });
  return true;
}

async function updateMetadata(connectionId: string, patch: ArchitectTelegramTestMetadata) {
  const current = await prisma.connectorCredential.findUnique({
    where: { id: connectionId },
    select: { metadata: true }
  });
  if (!current) return;
  await prisma.connectorCredential.update({
    where: { id: connectionId },
    data: { metadata: { ...metadata(current.metadata), ...patch } as Prisma.InputJsonValue }
  });
}

function activeTestBookingSession(
  value: ArchitectTelegramTestMetadata,
  chatId: string
): ArchitectTelegramTestBookingSession | null {
  const current = value.bookingSessions?.[chatId];
  if (!current) return null;
  const updatedAt = new Date(current.updatedAt).getTime();
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > TEST_BOOKING_SESSION_TTL_MS) return null;
  return current;
}

async function updateTestBookingSession(
  connectionId: string,
  chatId: string,
  nextSession: ArchitectTelegramTestBookingSession | null
) {
  const current = await prisma.connectorCredential.findUnique({
    where: { id: connectionId },
    select: { metadata: true }
  });
  if (!current) return;
  const currentMetadata = metadata(current.metadata);
  const cutoff = Date.now() - TEST_BOOKING_SESSION_TTL_MS;
  const bookingSessions = Object.fromEntries(
    Object.entries(currentMetadata.bookingSessions ?? {})
      .filter(([, value]) => new Date(value.updatedAt).getTime() >= cutoff)
      .slice(-19)
  );
  if (nextSession) bookingSessions[chatId] = nextSession;
  else delete bookingSessions[chatId];
  await prisma.connectorCredential.update({
    where: { id: connectionId },
    data: {
      metadata: {
        ...currentMetadata,
        bookingSessions
      } as Prisma.InputJsonValue
    }
  });
}

export async function handleArchitectTelegramTestWebhook(c: Context) {
  const connectionId = c.req.param("connectionId");
  const connection = await prisma.connectorCredential.findFirst({
    where: { id: connectionId, provider: ConnectorProvider.TELEGRAM },
    include: { user: true }
  });
  const meta = metadata(connection?.metadata);
  const suppliedSecret = c.req.header(TELEGRAM_SECRET_HEADER) || "";
  let expectedSecret = "";
  try {
    expectedSecret = meta.webhookSecretEncrypted ? decryptSecret(meta.webhookSecretEncrypted) : "";
  } catch {
    expectedSecret = "";
  }
  if (!connection || !connection.accessTokenEnc || !suppliedSecret || !expectedSecret || !secureEqual(suppliedSecret, expectedSecret)) {
    console.warn("[architect-telegram-test-webhook] Unauthorized test webhook attempt:", {
      connectionId,
      connectionFound: Boolean(connection),
      hasToken: Boolean(connection?.accessTokenEnc),
      hasSuppliedSecret: Boolean(suppliedSecret)
    });
    return c.json({ ok: false }, 401);
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = telegramUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[architect-telegram-test-webhook] Test update schema validation failed:", {
      connectionId,
      errors: parsed.error.format(),
      raw
    });
    return c.json({ ok: true, ignored: true });
  }
  if (meta.lastUpdateId === String(parsed.data.update_id)) return c.json({ ok: true, duplicate: true });

  const workflowId = meta.activeWorkflowId;
  const workflow = workflowId
    ? await prisma.workflowDefinition.findFirst({
        where: { id: workflowId, architectUserId: connection.userId }
      })
    : null;
  if (!workflow) {
    await updateMetadata(connection.id, { lastError: "The connected draft workflow no longer exists." });
    return c.json({ ok: true, ignored: true });
  }
  const node = triggerNode(workflow.workflowJson);
  if (!node) {
    await updateMetadata(connection.id, {
      lastWebhookAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "IGNORED",
      lastError: "The draft no longer contains a Telegram Bot Trigger."
    });
    return c.json({ ok: true, ignored: true });
  }
  const data = record(node?.data);
  const event = normalizeTelegramUpdate({
    update: parsed.data,
    businessId: "architect-test-business",
    installedAgentId: `architect-test:${workflow.id}`,
    telegramConnectionId: connection.id,
    botId: meta.botId ?? "",
    botUsername: meta.botUsername ?? ""
  });
  const isTestBookingCallback = Boolean(event?.callback.data.startsWith("testbook:service:"));
  if (!event || (!telegramTriggerMatches(event, triggerConfig(data)) && !isTestBookingCallback)) {
    await updateMetadata(connection.id, {
      lastWebhookAt: new Date().toISOString(),
      lastUpdateId: String(parsed.data.update_id),
      ...(event ? { lastChatId: event.chat.id } : {}),
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "IGNORED",
      lastError: null
    });
    return c.json({ ok: true, ignored: true });
  }

  // Claim the update before the workflow runs. Telegram may retry a webhook
  // while an LLM step is still executing; the retry then exits as a duplicate
  // instead of starting a second test run or sending a second reply.
  await updateMetadata(connection.id, {
    lastWebhookAt: new Date().toISOString(),
    lastUpdateId: event.updateId,
    lastMessage: (event.message.text || event.message.caption || `[${event.eventType}]`).slice(0, 500),
    lastSender: event.sender.username ? `@${event.sender.username}` : event.sender.firstName,
    lastChatId: event.chat.id,
    lastRunAt: new Date().toISOString(),
    lastRunStatus: "PROCESSING",
    lastError: null
  });

  const botToken = decryptSecret(connection.accessTokenEnc);
  const messageText = event.message.text || event.message.caption || `[${event.eventType}]`;
  try {
    const context = meta.testContext ?? {};
    const services = testServices(context);
    const interaction = architectTelegramTestInteraction({
      event,
      triggerData: data,
      context,
      workflowName: workflow.name,
      currentSession: activeTestBookingSession(meta, event.chat.id)
    });
    if (interaction) {
      if (event.callback.id) {
        await answerTelegramCallback({
          botToken,
          callbackQueryId: event.callback.id,
          text: interaction.callbackText
        }).catch(() => false);
      }
      await sendTelegramMessage({
        botToken,
        chatId: event.chat.id,
        text: interaction.text,
        replyMarkup: interaction.replyMarkup
      });
      if (Object.prototype.hasOwnProperty.call(interaction, "nextSession")) {
        await updateTestBookingSession(connection.id, event.chat.id, interaction.nextSession ?? null);
      }
      await updateMetadata(connection.id, {
        status: "CONNECTED",
        webhookStatus: "HEALTHY",
        lastWebhookAt: new Date().toISOString(),
        lastUpdateId: event.updateId,
        lastMessage: messageText.slice(0, 500),
        lastSender: event.sender.username ? `@${event.sender.username}` : event.sender.firstName,
        lastChatId: event.chat.id,
        lastRunAt: new Date().toISOString(),
        lastRunStatus: "SUCCESS",
        lastWorkflowRunId: null,
        lastRunLogs: [],
        lastError: null
      });
      return c.json({ ok: true, accepted: true, interaction: true });
    }
    const run = await runWorkflowTest({
      userId: connection.userId,
      workflowId: workflow.id,
      workflowJson: workflow.workflowJson,
      mode: "test",
      executionMode: "ARCHITECT_DRY_RUN",
      input: {
        businessName: context.businessName || workflow.name || "Architect Telegram Test",
        businessType: context.businessType || "Service Business",
        timeZone: context.timeZone || "UTC",
        services,
        appointmentService: services[0] || "General Consultation",
        latestMessage: messageText,
        inboundSmsBody: messageText,
        telegramConnectionId: connection.id,
        architectTelegramTestConnectionId: connection.id,
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

    const runContext = record(run.context);
    const telegramAction = record(runContext.telegramAction);
    if (telegramAction.success !== true) {
      const aiOutput = text(record(runContext.ai).output);
      const fallback = text(
        data.telegramFallbackMessage,
        `Thanks for messaging ${context.businessName || workflow.name}. How can I help?`
      );
      const reply = aiOutput || renderArchitectTelegramTestTemplate(
        fallback,
        context.businessName || workflow.name
      );
      await sendTelegramMessage({ botToken, chatId: event.chat.id, text: reply });
    }

    const logs = JSON.parse(JSON.stringify(run.logs.slice(-50))) as WorkflowRunLog[];
    await updateMetadata(connection.id, {
      status: "CONNECTED",
      webhookStatus: "HEALTHY",
      lastWebhookAt: new Date().toISOString(),
      lastUpdateId: event.updateId,
      lastMessage: messageText.slice(0, 500),
      lastSender: event.sender.username ? `@${event.sender.username}` : event.sender.firstName,
      lastChatId: event.chat.id,
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "SUCCESS",
      lastWorkflowRunId: run.workflowRunId,
      lastRunLogs: logs,
      lastError: null
    });
    return c.json({ ok: true, accepted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Architect Telegram test failed.";
    await updateMetadata(connection.id, {
      lastWebhookAt: new Date().toISOString(),
      lastUpdateId: event.updateId,
      lastMessage: messageText.slice(0, 500),
      lastSender: event.sender.username ? `@${event.sender.username}` : event.sender.firstName,
      lastChatId: event.chat.id,
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "FAILED",
      lastError: message.slice(0, 500)
    });
    await sendTelegramMessage({
      botToken,
      chatId: event.chat.id,
      text: `Architect test failed: ${message.slice(0, 350)}`
    }).catch(() => null);
    return c.json({ ok: true, accepted: true });
  }
}
