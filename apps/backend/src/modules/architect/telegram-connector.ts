import crypto from "crypto";
import type { Context } from "hono";
import { ConnectorProvider, Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import {
  getTelegramBotIdentity,
  getTelegramWebhookInfo,
  sendTelegramMessage,
  telegramApiRequest,
  TelegramApiError,
  type TelegramBotIdentity
} from "./telegram-api-client";
import { enqueueTelegramUpdate } from "./telegram-queue";
import {
  telegramUpdateSchema,
  type TelegramMessage,
  type TelegramUpdate
} from "./telegram-update";
import { parseRunnerWorkflowJson } from "./workflow-runner";
import { createTelegramOwnerAuthorizationToken } from "./telegram-owner-routing";
import {
  telegramCommandList,
  telegramCustomCommands,
  type TelegramCustomCommand
} from "./telegram-command-config";

export { telegramCommandList } from "./telegram-command-config";

const TELEGRAM_TRIGGER_TYPE = "trigger.telegram_message";
const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

type JsonRecord = Record<string, unknown>;

export class TelegramConnectorError extends Error {
  constructor(
    message: string,
    public readonly code = "TELEGRAM_CONNECTOR_ERROR",
    public readonly status = 502
  ) {
    super(message);
    this.name = "TelegramConnectorError";
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function flag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}

function cleanManagerUsername(value: string | undefined): string {
  return value?.trim().replace(/^@/, "") || "";
}

function managerConfigured(): boolean {
  return Boolean(
    env.TELEGRAM_MANAGER_BOT_TOKEN &&
      cleanManagerUsername(env.TELEGRAM_MANAGER_BOT_USERNAME) &&
      env.TELEGRAM_MANAGER_WEBHOOK_SECRET
  );
}

export function telegramManagerEnvironmentConfigured(): boolean {
  return managerConfigured();
}

async function managerProvisioningStatus(): Promise<{
  available: boolean;
  reason: string | null;
}> {
  if (!managerConfigured()) {
    return {
      available: false,
      reason: "The platform Telegram manager bot is not configured."
    };
  }
  try {
    const token = env.TELEGRAM_MANAGER_BOT_TOKEN as string;
    const [identity, webhook] = await Promise.all([
      getTelegramBotIdentity(token),
      getTelegramWebhookInfo(token)
    ]);
    if (!identity.can_manage_bots) {
      return {
        available: false,
        reason: "Bot Management Mode is not enabled for the platform manager bot."
      };
    }
    if (webhook.url !== managerWebhookUrl()) {
      return {
        available: false,
        reason: "The platform manager webhook has not been registered."
      };
    }
    return { available: true, reason: null };
  } catch {
    return {
      available: false,
      reason: "Telegram could not verify the platform manager bot."
    };
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function render(template: unknown, businessName: string): string {
  return text(template).replace(/\{\{\s*business\.name\s*\}\}/gi, businessName);
}

function managerWebhookUrl(): string {
  return `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/telegram/manager-webhook`;
}

function childWebhookUrl(webhookConnectionId: string): string {
  return `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/telegram/webhook/${encodeURIComponent(
    webhookConnectionId
  )}`;
}

function triggerNode(workflowJson: unknown) {
  return parseRunnerWorkflowJson(workflowJson).nodes.find(
    (node) => text(node.data?.type) === TELEGRAM_TRIGGER_TYPE
  );
}

const TELEGRAM_BUSINESS_SETTING_DEFAULTS = {
  telegramWelcomeMessage: "",
  telegramFallbackMessage: "",
  telegramBookingMode: false,
  telegramServicesCommand: false,
  telegramBookCommand: false,
  telegramMyBookingsCommand: false,
  telegramRescheduleCommand: false,
  telegramCancelCommand: false,
  telegramHelpCommand: true,
  telegramRequestPhone: false,
  telegramRequestEmail: false,
  telegramRequestNotes: false
} as const;

export type TelegramBusinessSettings = {
  telegramWelcomeMessage: string;
  telegramFallbackMessage: string;
  telegramBookingMode: boolean;
  telegramServicesCommand: boolean;
  telegramBookCommand: boolean;
  telegramMyBookingsCommand: boolean;
  telegramRescheduleCommand: boolean;
  telegramCancelCommand: boolean;
  telegramHelpCommand: boolean;
  telegramCustomCommands: TelegramCustomCommand[];
  telegramRequestPhone: boolean;
  telegramRequestEmail: boolean;
  telegramRequestNotes: boolean;
};

function telegramBuyerOverrides(configJson: unknown): JsonRecord {
  return record(record(configJson).telegram);
}

function mergedTelegramTriggerData(workflowJson: unknown, configJson: unknown): JsonRecord {
  const node = triggerNode(workflowJson);
  return {
    ...record(node?.data),
    ...telegramBuyerOverrides(configJson)
  };
}

function telegramBusinessSettings(workflowJson: unknown, configJson: unknown): TelegramBusinessSettings {
  const data = mergedTelegramTriggerData(workflowJson, configJson);
  return {
    telegramWelcomeMessage: text(
      data.telegramWelcomeMessage,
      TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramWelcomeMessage
    ),
    telegramFallbackMessage: text(
      data.telegramFallbackMessage,
      TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramFallbackMessage
    ),
    telegramBookingMode: flag(data.telegramBookingMode, TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramBookingMode),
    telegramServicesCommand: flag(data.telegramServicesCommand, TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramServicesCommand),
    telegramBookCommand: flag(data.telegramBookCommand, TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramBookCommand),
    telegramMyBookingsCommand: flag(data.telegramMyBookingsCommand, TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramMyBookingsCommand),
    telegramRescheduleCommand: flag(data.telegramRescheduleCommand, TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramRescheduleCommand),
    telegramCancelCommand: flag(data.telegramCancelCommand, TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramCancelCommand),
    telegramHelpCommand: flag(data.telegramHelpCommand, TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramHelpCommand),
    telegramCustomCommands: telegramCustomCommands(data),
    telegramRequestPhone: flag(data.telegramRequestPhone, TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramRequestPhone),
    telegramRequestEmail: flag(data.telegramRequestEmail, TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramRequestEmail),
    telegramRequestNotes: flag(data.telegramRequestNotes, TELEGRAM_BUSINESS_SETTING_DEFAULTS.telegramRequestNotes)
  };
}

function allowedUpdates(): string[] {
  return ["message", "callback_query"];
}

function usernameStem(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\x00-\x7F]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 16) || "business"
  );
}

function usernameCandidates(businessName: string, installedAgentId: string): string[] {
  const stem = usernameStem(businessName);
  const suffix = sha256(installedAgentId).slice(0, 6);
  return [
    `${stem}_${suffix}_bot`,
    `${stem}_booking_${suffix}_bot`,
    `${stem}_assistant_${suffix}_bot`,
    `triven_${stem}_${suffix}_bot`
  ].map((value) => value.slice(0, 32));
}

async function availableRequestedUsername(businessName: string, installedAgentId: string): Promise<string> {
  for (const candidate of usernameCandidates(businessName, installedAgentId)) {
    const existing = await prisma.telegramBotConnection.findFirst({
      where: {
        requestedUsername: { equals: candidate, mode: "insensitive" },
        installedAgentId: { not: installedAgentId }
      },
      select: { id: true }
    });
    if (!existing) return candidate;
  }
  return `triven_${sha256(`${installedAgentId}:${Date.now()}`).slice(0, 12)}_bot`;
}

async function loadOwnedAgent(ownerId: string, installedAgentId: string) {
  const agent = await prisma.installedAgent.findFirst({
    where: {
      id: installedAgentId,
      business: { ownerId }
    },
    include: {
      business: { include: { profile: true } },
      workflow: true,
      telegramBot: true
    }
  });
  if (!agent) throw new TelegramConnectorError("Installed agent was not found.", "AGENT_NOT_FOUND", 404);
  if (!triggerNode(agent.workflow.workflowJson)) {
    throw new TelegramConnectorError(
      "This agent does not contain a Telegram Bot Trigger.",
      "TELEGRAM_TRIGGER_REQUIRED",
      422
    );
  }
  return agent;
}

async function configureTelegramBot(options: {
  connectionId: string;
  botToken: string;
  botUser: TelegramBotIdentity;
}) {
  const connection = await prisma.telegramBotConnection.findUnique({
    where: { id: options.connectionId },
    include: {
      business: true,
      installedAgent: { include: { workflow: true } }
    }
  });
  if (!connection) {
    throw new TelegramConnectorError("Telegram setup no longer exists.", "TELEGRAM_SETUP_NOT_FOUND", 404);
  }
  const node = triggerNode(connection.installedAgent.workflow.workflowJson);
  if (!node) {
    throw new TelegramConnectorError(
      "The installed agent does not contain a Telegram Bot Trigger.",
      "TELEGRAM_TRIGGER_REQUIRED",
      422
    );
  }
  const data = mergedTelegramTriggerData(
    connection.installedAgent.workflow.workflowJson,
    connection.installedAgent.configJson
  );
  const businessName = connection.business.name;
  const displayName =
    connection.botDisplayName ||
    render(data.telegramBotNameTemplate, businessName) ||
    `${businessName} Assistant`;
  const description =
    render(data.telegramBotDescription, businessName) ||
    `View services and book an appointment with ${businessName}.`;
  const shortDescription =
    render(data.telegramBotShortDescription, businessName) ||
    `Book an appointment with ${businessName}.`;
  const webhookSecret = decryptSecret(connection.webhookSecretEncrypted);

  await telegramApiRequest<boolean>(options.botToken, "setMyName", {
    name: displayName.slice(0, 64)
  });
  await telegramApiRequest<boolean>(options.botToken, "setMyDescription", {
    description: description.slice(0, 512)
  });
  await telegramApiRequest<boolean>(options.botToken, "setMyShortDescription", {
    short_description: shortDescription.slice(0, 120)
  });
  await telegramApiRequest<boolean>(options.botToken, "setMyCommands", {
    commands: telegramCommandList(data)
  });
  const webhookUrl = childWebhookUrl(connection.webhookConnectionId);
  await telegramApiRequest<boolean>(options.botToken, "setWebhook", {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: allowedUpdates(),
    drop_pending_updates: false
  });
  const webhookInfo = await getTelegramWebhookInfo(options.botToken);
  if (webhookInfo.url !== webhookUrl) {
    throw new TelegramConnectorError(
      "Telegram accepted setup but did not retain the expected webhook URL.",
      "TELEGRAM_WEBHOOK_VERIFY_FAILED",
      502
    );
  }

  return prisma.telegramBotConnection.update({
    where: { id: connection.id },
    data: {
      botUserId: String(options.botUser.id),
      botUsername: options.botUser.username,
      botDisplayName: displayName.slice(0, 64),
      botTokenEncrypted: encryptSecret(options.botToken),
      setupNonceHash: null,
      provisioningStatus: "READY",
      webhookStatus: "HEALTHY",
      status: "ACTIVE",
      lastError: null,
      lastProviderErrorCode: null
    }
  });
}

export async function createTelegramManagedBotSetup(options: {
  ownerId: string;
  installedAgentId: string;
  botDisplayName: string;
}) {
  if (!managerConfigured()) {
    throw new TelegramConnectorError(
      "Managed bot setup is unavailable. Use the manual BotFather token option.",
      "TELEGRAM_MANAGER_NOT_CONFIGURED",
      503
    );
  }
  const agent = await loadOwnedAgent(options.ownerId, options.installedAgentId);
  const managerStatus = await managerProvisioningStatus();
  if (!managerStatus.available) {
    throw new TelegramConnectorError(
      `${managerStatus.reason ?? "Managed bot setup is unavailable"} Use the manual BotFather token option.`,
      "TELEGRAM_MANAGER_NOT_READY",
      503
    );
  }
  if (agent.telegramBot?.status === "ACTIVE") {
    return {
      connectionId: agent.telegramBot.id,
      status: agent.telegramBot.status,
      provisioningMode: agent.telegramBot.provisioningMode,
      botUsername: agent.telegramBot.botUsername,
      botUrl: agent.telegramBot.botUsername ? `https://t.me/${agent.telegramBot.botUsername}` : null,
      approvalUrl: null
    };
  }
  if (agent.telegramBot?.botUserId) {
    const token =
      agent.telegramBot.botTokenEncrypted
        ? decryptSecret(agent.telegramBot.botTokenEncrypted)
        : await telegramApiRequest<string>(env.TELEGRAM_MANAGER_BOT_TOKEN as string, "getManagedBotToken", {
            user_id: Number(agent.telegramBot.botUserId)
          });
    const identity = await getTelegramBotIdentity(token);
    const configured = await configureTelegramBot({
      connectionId: agent.telegramBot.id,
      botToken: token,
      botUser: identity
    });
    return {
      connectionId: configured.id,
      status: configured.status,
      provisioningMode: configured.provisioningMode,
      botUsername: configured.botUsername,
      botUrl: configured.botUsername ? `https://t.me/${configured.botUsername}` : null,
      approvalUrl: null
    };
  }

  const nonce = crypto.randomBytes(18).toString("base64url");
  const webhookSecret = crypto.randomBytes(32).toString("base64url");
  const requestedUsername =
    agent.telegramBot?.requestedUsername ??
    (await availableRequestedUsername(agent.business.name, agent.id));
  const displayName = options.botDisplayName.trim().slice(0, 64);
  const managerIdentity = await getTelegramBotIdentity(env.TELEGRAM_MANAGER_BOT_TOKEN as string);
  const connection = agent.telegramBot
    ? await prisma.telegramBotConnection.update({
        where: { id: agent.telegramBot.id },
        data: {
          requestedUsername,
          botDisplayName: displayName,
          webhookSecretEncrypted: encryptSecret(webhookSecret),
          setupNonceHash: sha256(nonce),
          botTokenEncrypted: null,
          botUserId: null,
          botUsername: null,
          managerBotId: String(managerIdentity.id),
          provisioningMode: "MANAGED",
          provisioningStatus: "PENDING_APPROVAL",
          webhookStatus: "PENDING",
          status: "PENDING",
          lastError: null
        }
      })
    : await prisma.telegramBotConnection.create({
        data: {
          businessId: agent.businessId,
          installedAgentId: agent.id,
          requestedUsername,
          botDisplayName: displayName,
          webhookSecretEncrypted: encryptSecret(webhookSecret),
          setupNonceHash: sha256(nonce),
          managerBotId: String(managerIdentity.id),
          provisioningMode: "MANAGED",
          provisioningStatus: "PENDING_APPROVAL"
        }
      });
  const managerUsername = cleanManagerUsername(env.TELEGRAM_MANAGER_BOT_USERNAME);
  const startParameter = `setup_${connection.id}_${nonce}`;
  return {
    connectionId: connection.id,
    status: connection.status,
    provisioningMode: connection.provisioningMode,
    provisioningStatus: connection.provisioningStatus,
    requestedUsername,
    approvalUrl: `https://t.me/${managerUsername}?start=${encodeURIComponent(startParameter)}`
  };
}

export async function connectTelegramManualBot(options: {
  ownerId: string;
  installedAgentId: string;
  botDisplayName: string;
  botToken: string;
}) {
  const agent = await loadOwnedAgent(options.ownerId, options.installedAgentId);
  let identity: TelegramBotIdentity;
  try {
    identity = await getTelegramBotIdentity(options.botToken);
  } catch (error) {
    if (error instanceof TelegramApiError) {
      throw new TelegramConnectorError(error.message, "INVALID_TELEGRAM_BOT_TOKEN", 422);
    }
    throw error;
  }
  const inUse = await prisma.telegramBotConnection.findFirst({
    where: {
      OR: [{ botUserId: String(identity.id) }, { botUsername: identity.username }],
      installedAgentId: { not: agent.id }
    },
    select: { id: true }
  });
  if (inUse) {
    throw new TelegramConnectorError(
      "This Telegram bot is already connected to another installed agent.",
      "TELEGRAM_BOT_ALREADY_CONNECTED",
      409
    );
  }
  const architectTestUse = await prisma.connectorCredential.findFirst({
    where: {
      provider: ConnectorProvider.TELEGRAM,
      metadata: { path: ["botId"], equals: String(identity.id) }
    },
    select: { id: true }
  });
  if (architectTestUse) {
    throw new TelegramConnectorError(
      "Disconnect this bot from Architect testing before using it for a business installation.",
      "TELEGRAM_BOT_ALREADY_CONNECTED",
      409
    );
  }
  const webhookSecret = crypto.randomBytes(32).toString("base64url");
  const displayName = options.botDisplayName.trim().slice(0, 64);
  const replacingBot = Boolean(
    agent.telegramBot &&
      ((agent.telegramBot.botUserId && agent.telegramBot.botUserId !== String(identity.id)) ||
        (agent.telegramBot.botUsername && agent.telegramBot.botUsername !== identity.username))
  );
  const connection = agent.telegramBot
    ? await prisma.telegramBotConnection.update({
        where: { id: agent.telegramBot.id },
        data: {
          requestedUsername: identity.username as string,
          botUserId: String(identity.id),
          botUsername: identity.username,
          botDisplayName: displayName,
          botTokenEncrypted: encryptSecret(options.botToken),
          webhookSecretEncrypted: encryptSecret(webhookSecret),
          provisioningMode: "MANUAL",
          provisioningStatus: "CONFIGURING",
          webhookStatus: "PENDING",
          setupNonceHash: null,
          status: "CONFIGURING",
          credentialRotatedAt: agent.telegramBot.botTokenEncrypted ? new Date() : null,
          lastError: null,
          ...(replacingBot
            ? {
                telegramOwnerUserId: null,
                ownerChatId: null,
                ownerNotificationStatus: "NOT_CONNECTED",
                ownerNotificationNonceHash: null
              }
            : {})
        }
      })
    : await prisma.telegramBotConnection.create({
        data: {
          businessId: agent.businessId,
          installedAgentId: agent.id,
          requestedUsername: identity.username as string,
          botUserId: String(identity.id),
          botUsername: identity.username,
          botDisplayName: displayName,
          botTokenEncrypted: encryptSecret(options.botToken),
          webhookSecretEncrypted: encryptSecret(webhookSecret),
          provisioningMode: "MANUAL",
          provisioningStatus: "CONFIGURING",
          status: "CONFIGURING"
        }
      });
  const configured = await configureTelegramBot({
    connectionId: connection.id,
    botToken: options.botToken,
    botUser: identity
  });
  return {
    connectionId: configured.id,
    status: configured.status,
    provisioningMode: configured.provisioningMode,
    provisioningStatus: configured.provisioningStatus,
    botUsername: configured.botUsername,
    botDisplayName: configured.botDisplayName,
    botUrl: configured.botUsername ? `https://t.me/${configured.botUsername}` : null
  };
}

export async function getTelegramConnectionStatus(ownerId: string, installedAgentId: string) {
  const agent = await loadOwnedAgent(ownerId, installedAgentId);
  const connection = agent.telegramBot;
  return {
    connection: connection
      ? {
          id: connection.id,
          status: connection.status,
          provisioningMode: connection.provisioningMode,
          provisioningStatus: connection.provisioningStatus,
          webhookStatus: connection.webhookStatus,
          ownerNotificationStatus: connection.ownerNotificationStatus,
          requestedUsername: connection.requestedUsername,
          botUsername: connection.botUsername,
          botDisplayName: connection.botDisplayName,
          lastWebhookAt: connection.lastWebhookAt,
          lastSuccessfulSendAt: connection.lastSuccessfulSendAt,
          lastProviderErrorCode: connection.lastProviderErrorCode,
          lastError: connection.lastError,
          credentialRotatedAt: connection.credentialRotatedAt,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
          botUrl: connection.botUsername ? `https://t.me/${connection.botUsername}` : null
        }
      : null,
    settings: telegramBusinessSettings(agent.workflow.workflowJson, agent.configJson),
    services: agent.business.profile?.services ?? [],
    manualProvisioningAvailable: true
  };
}

export async function updateTelegramBusinessSettings(options: {
  ownerId: string;
  installedAgentId: string;
  botDisplayName: string;
  settings: TelegramBusinessSettings;
  services: string[];
}) {
  const agent = await loadOwnedAgent(options.ownerId, options.installedAgentId);
  const existingConfig = record(agent.configJson);
  const configJson = {
    ...existingConfig,
    telegram: {
      ...telegramBuyerOverrides(agent.configJson),
      ...options.settings
    }
  };

  const services = Array.from(
    new Map(
      options.services
        .map((service) => service.trim())
        .filter(Boolean)
        .slice(0, 30)
        .map((service) => [service.toLocaleLowerCase(), service.slice(0, 120)])
    ).values()
  );

  await prisma.$transaction([
    prisma.installedAgent.update({
      where: { id: agent.id },
      data: { configJson: configJson as Prisma.InputJsonValue }
    }),
    prisma.businessProfile.upsert({
      where: { businessId: agent.businessId },
      create: { businessId: agent.businessId, services },
      update: { services }
    })
  ]);

  if (agent.telegramBot) {
    await prisma.telegramBotConnection.update({
      where: { id: agent.telegramBot.id },
      data: { botDisplayName: options.botDisplayName.trim().slice(0, 64) }
    });
  }

  if (agent.telegramBot?.botTokenEncrypted && agent.telegramBot.status === "ACTIVE") {
    const token = decryptSecret(agent.telegramBot.botTokenEncrypted);
    const identity = await getTelegramBotIdentity(token);
    await configureTelegramBot({
      connectionId: agent.telegramBot.id,
      botToken: token,
      botUser: identity
    });
  }

  return {
    settings: options.settings,
    botDisplayName: options.botDisplayName.trim().slice(0, 64),
    services
  };
}

export async function refreshTelegramConnectionHealth(ownerId: string, installedAgentId: string) {
  const connection = await prisma.telegramBotConnection.findFirst({
    where: { installedAgentId, business: { ownerId } }
  });
  if (!connection?.botTokenEncrypted) {
    throw new TelegramConnectorError("Telegram bot is not connected.", "TELEGRAM_CONNECTION_NOT_FOUND", 404);
  }
  try {
    const token = decryptSecret(connection.botTokenEncrypted);
    const [identity, webhook] = await Promise.all([
      getTelegramBotIdentity(token),
      getTelegramWebhookInfo(token)
    ]);
    const expectedUrl = childWebhookUrl(connection.webhookConnectionId);
    const healthy = webhook.url === expectedUrl;
    await prisma.telegramBotConnection.update({
      where: { id: connection.id },
      data: {
        botUserId: String(identity.id),
        botUsername: identity.username,
        webhookStatus: healthy ? "HEALTHY" : "MISCONFIGURED",
        lastError: healthy ? null : "Telegram webhook URL does not match the installed agent."
      }
    });
    return {
      ok: healthy,
      botUsername: identity.username,
      webhookStatus: healthy ? "HEALTHY" : "MISCONFIGURED",
      pendingUpdateCount: webhook.pending_update_count,
      lastWebhookAt: connection.lastWebhookAt,
      lastSuccessfulSendAt: connection.lastSuccessfulSendAt,
      lastError: webhook.last_error_message ?? null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram health check failed.";
    await prisma.telegramBotConnection.update({
      where: { id: connection.id },
      data: { webhookStatus: "ERROR", lastError: message.slice(0, 500) }
    });
    throw error;
  }
}

export async function createTelegramOwnerAuthorization(ownerId: string, installedAgentId: string) {
  const connection = await prisma.telegramBotConnection.findFirst({
    where: {
      installedAgentId,
      business: { ownerId },
      status: "ACTIVE",
      botUsername: { not: null }
    }
  });
  if (!connection?.botUsername) {
    throw new TelegramConnectorError("Connect the Telegram bot first.", "TELEGRAM_CONNECTION_NOT_READY", 422);
  }
  const authorization = createTelegramOwnerAuthorizationToken();
  await prisma.telegramBotConnection.update({
    where: { id: connection.id },
    data: {
      ownerNotificationNonceHash: authorization.tokenHash,
      ownerNotificationStatus: "PENDING"
    }
  });
  return {
    authorizationUrl: `https://t.me/${connection.botUsername}?start=${encodeURIComponent(`owner_${authorization.token}`)}`,
    status: "PENDING",
    expiresAt: authorization.expiresAt.toISOString()
  };
}

export async function sendTelegramConnectionTest(ownerId: string, installedAgentId: string) {
  const connection = await prisma.telegramBotConnection.findFirst({
    where: {
      installedAgentId,
      business: { ownerId },
      status: "ACTIVE"
    },
    include: { business: true }
  });
  if (!connection?.botTokenEncrypted || !connection.ownerChatId || connection.ownerNotificationStatus !== "CONNECTED") {
    throw new TelegramConnectorError(
      "Connect the business owner notification chat before sending a test message.",
      "TELEGRAM_OWNER_CHAT_REQUIRED",
      422
    );
  }
  const sent = await sendTelegramMessage({
    botToken: decryptSecret(connection.botTokenEncrypted),
    chatId: connection.ownerChatId,
    text: `Telegram is connected for ${connection.business.name}. This is a live test message from Triven.`
  });
  await prisma.telegramBotConnection.update({
    where: { id: connection.id },
    data: { lastSuccessfulSendAt: new Date(), lastError: null }
  });
  return { success: true, messageId: String(sent.message_id), chatConnected: true };
}

export async function disconnectTelegramBot(ownerId: string, installedAgentId: string) {
  const connection = await prisma.telegramBotConnection.findFirst({
    where: { installedAgentId, business: { ownerId } }
  });
  if (!connection) return false;
  if (connection.botTokenEncrypted) {
    await telegramApiRequest<boolean>(
      decryptSecret(connection.botTokenEncrypted),
      "deleteWebhook",
      { drop_pending_updates: true }
    ).catch(() => false);
  }
  await prisma.telegramBotConnection.update({
    where: { id: connection.id },
    data: {
      botTokenEncrypted: null,
      setupNonceHash: null,
      ownerNotificationNonceHash: null,
      ownerChatId: null,
      telegramOwnerUserId: null,
      ownerNotificationStatus: "NOT_CONNECTED",
      provisioningStatus: "DISCONNECTED",
      webhookStatus: "DISCONNECTED",
      status: "DISCONNECTED"
    }
  });
  return true;
}

export async function registerTelegramManagerWebhook() {
  if (!managerConfigured()) {
    throw new TelegramConnectorError(
      "TELEGRAM_MANAGER_BOT_TOKEN, TELEGRAM_MANAGER_BOT_USERNAME, and TELEGRAM_MANAGER_WEBHOOK_SECRET are required.",
      "TELEGRAM_MANAGER_NOT_CONFIGURED",
      503
    );
  }
  const token = env.TELEGRAM_MANAGER_BOT_TOKEN as string;
  const identity = await getTelegramBotIdentity(token);
  if (!identity.can_manage_bots) {
    throw new TelegramConnectorError(
      "Enable Bot Management Mode for the manager bot in BotFather first.",
      "TELEGRAM_MANAGER_MODE_DISABLED",
      422
    );
  }
  await telegramApiRequest<boolean>(token, "setWebhook", {
    url: managerWebhookUrl(),
    secret_token: env.TELEGRAM_MANAGER_WEBHOOK_SECRET,
    allowed_updates: ["message", "managed_bot"],
    drop_pending_updates: false
  });
  return {
    botUserId: String(identity.id),
    botUsername: identity.username,
    canManageBots: true,
    webhookUrl: managerWebhookUrl()
  };
}

function managerSecretValid(c: Context): boolean {
  const expected = env.TELEGRAM_MANAGER_WEBHOOK_SECRET;
  const provided = c.req.header(TELEGRAM_SECRET_HEADER) || "";
  return Boolean(expected && provided && secureEqual(provided, expected));
}

async function handleManagerStart(message: TelegramMessage): Promise<boolean> {
  const match = message.text?.trim().match(/^\/start\s+setup_([^_]+)_([A-Za-z0-9_-]+)$/);
  if (!match || !message.from || message.from.is_bot) return false;
  const connection = await prisma.telegramBotConnection.findUnique({ where: { id: match[1] ?? "" } });
  const nonce = match[2] ?? "";
  if (
    !connection ||
    connection.status !== "PENDING" ||
    !connection.setupNonceHash ||
    !secureEqual(sha256(nonce), connection.setupNonceHash)
  ) {
    await sendTelegramMessage({
      botToken: env.TELEGRAM_MANAGER_BOT_TOKEN as string,
      chatId: String(message.chat.id),
      text: "This setup link is invalid or expired. Return to Triven and retry Telegram setup."
    });
    return true;
  }
  await prisma.telegramBotConnection.update({
    where: { id: connection.id },
    data: {
      telegramOwnerUserId: String(message.from.id),
      provisioningStatus: "AWAITING_TELEGRAM_APPROVAL",
      lastError: null
    }
  });
  const managerUsername = cleanManagerUsername(env.TELEGRAM_MANAGER_BOT_USERNAME);
  const createUrl =
    `https://t.me/newbot/${managerUsername}/${connection.requestedUsername}` +
    `?name=${encodeURIComponent(connection.botDisplayName)}`;
  await sendTelegramMessage({
    botToken: env.TELEGRAM_MANAGER_BOT_TOKEN as string,
    chatId: String(message.chat.id),
    text: "Approve the prefilled bot in Telegram. Triven will configure its profile, commands, and webhook automatically.",
    replyMarkup: {
      inline_keyboard: [[{ text: "Create business bot", url: createUrl }]]
    }
  });
  return true;
}

async function handleManagedBotUpdate(update: NonNullable<TelegramUpdate["managed_bot"]>) {
  const ownerUserId = String(update.user.id);
  const botUsername = update.bot.username;
  const pending = await prisma.telegramBotConnection.findMany({
    where: {
      status: "PENDING",
      provisioningMode: "MANAGED",
      OR: [
        ...(botUsername ? [{ requestedUsername: { equals: botUsername, mode: "insensitive" as const } }] : []),
        { telegramOwnerUserId: ownerUserId }
      ]
    },
    orderBy: { updatedAt: "desc" },
    take: 5
  });
  const exact = botUsername
    ? pending.find((connection) => connection.requestedUsername.toLowerCase() === botUsername.toLowerCase())
    : undefined;
  const ownerMatches = pending.filter((connection) => connection.telegramOwnerUserId === ownerUserId);
  const connection = exact ?? (ownerMatches.length === 1 ? ownerMatches[0] : undefined);
  if (!connection) return;

  try {
    const token = await telegramApiRequest<string>(
      env.TELEGRAM_MANAGER_BOT_TOKEN as string,
      "getManagedBotToken",
      { user_id: update.bot.id }
    );
    const identity = await getTelegramBotIdentity(token);
    await prisma.telegramBotConnection.update({
      where: { id: connection.id },
      data: {
        botUserId: String(identity.id),
        botUsername: identity.username,
        botTokenEncrypted: encryptSecret(token),
        provisioningStatus: "CONFIGURING",
        status: "CONFIGURING",
        lastError: null
      }
    });
    await configureTelegramBot({ connectionId: connection.id, botToken: token, botUser: identity });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram setup failed.";
    await prisma.telegramBotConnection.update({
      where: { id: connection.id },
      data: {
        provisioningStatus: "ERROR",
        status: "ERROR",
        lastError: message.slice(0, 500)
      }
    });
    throw error;
  }
}

export async function handleTelegramManagerWebhook(c: Context) {
  if (!managerSecretValid(c)) return c.json({ ok: false }, 401);
  const parsed = telegramUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: true });
  try {
    if (parsed.data.message && (await handleManagerStart(parsed.data.message))) {
      return c.json({ ok: true });
    }
    if (parsed.data.managed_bot) await handleManagedBotUpdate(parsed.data.managed_bot);
  } catch (error) {
    console.error("[telegram-manager] update failed", {
      updateId: parsed.data.update_id,
      error: error instanceof Error ? error.message : "unknown error"
    });
  }
  return c.json({ ok: true });
}

function childSecretValid(c: Context, encryptedSecret: string): boolean {
  const provided = c.req.header(TELEGRAM_SECRET_HEADER) || "";
  if (!provided) return false;
  try {
    return secureEqual(provided, decryptSecret(encryptedSecret));
  } catch {
    return false;
  }
}

export async function handleTelegramBotWebhook(c: Context) {
  const webhookConnectionId = c.req.param("connectionId");
  if (!webhookConnectionId) return c.json({ ok: false }, 404);
  const connection = await prisma.telegramBotConnection.findUnique({
    where: { webhookConnectionId },
    select: {
      id: true,
      webhookSecretEncrypted: true,
      status: true,
      installedAgent: {
        select: {
          status: true,
          pausedAt: true
        }
      }
    }
  });
  if (!connection || !childSecretValid(c, connection.webhookSecretEncrypted)) {
    return c.json({ ok: false }, 401);
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = telegramUpdateSchema.safeParse(raw);
  if (!parsed.success) return c.json({ ok: true });

  let stored;
  try {
    const active =
      connection.status === "ACTIVE" &&
      connection.installedAgent.status === "ACTIVE" &&
      !connection.installedAgent.pausedAt;
    stored = await prisma.telegramProcessedUpdate.create({
      data: {
        telegramConnectionId: connection.id,
        updateId: String(parsed.data.update_id),
        payloadJson: parsed.data as never,
        status: active ? "RECEIVED" : "IGNORED",
        errorCode: active ? null : "AGENT_INACTIVE",
        processedAt: active ? null : new Date()
      }
    });
    if (!active) return c.json({ ok: true, ignored: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return c.json({ ok: true, duplicate: true });
    }
    throw error;
  }
  await enqueueTelegramUpdate(stored.id);
  return c.json({ ok: true, accepted: true });
}
