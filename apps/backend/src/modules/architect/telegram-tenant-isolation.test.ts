import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import { executeTelegramAction, TELEGRAM_ACTION_TYPES } from "./telegram-actions";
import {
  loadTelegramConversationState,
  saveTelegramConversationState,
  type TelegramConversationIdentity
} from "./telegram-conversation-state";
import { loadTelegramBusinessService } from "./telegram-services";

const RUN = `telegram-isolation-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let businessAId = "";
let businessBId = "";
let agentAId = "";
let agentBId = "";
let connectionAId = "";
let connectionBId = "";

function identity(options: {
  businessId: string;
  installedAgentId: string;
  telegramConnectionId: string;
  botId: string;
}): TelegramConversationIdentity {
  const { botId, ...scope } = options;
  return {
    ...scope,
    telegramBotId: botId,
    telegramChatId: "shared-chat-id",
    telegramUserId: "shared-user-id"
  };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    return;
  }

  const architect = await prisma.user.create({
    data: { email: `${RUN}-architect@test.local`, role: "ARCHITECT" }
  });
  const [ownerA, ownerB] = await Promise.all([
    prisma.user.create({ data: { email: `${RUN}-a@test.local`, role: "BUSINESS" } }),
    prisma.user.create({ data: { email: `${RUN}-b@test.local`, role: "BUSINESS" } })
  ]);
  const workflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: architect.id,
      name: `${RUN} workflow`,
      workflowJson: {
        nodes: [{ id: "trigger", data: { type: "trigger.telegram_message", nodeKind: "trigger" } }],
        edges: []
      }
    }
  });
  const [businessA, businessB] = await Promise.all([
    prisma.business.create({ data: { ownerId: ownerA.id, name: `${RUN} A`, type: "clinic" } }),
    prisma.business.create({ data: { ownerId: ownerB.id, name: `${RUN} B`, type: "salon" } })
  ]);
  businessAId = businessA.id;
  businessBId = businessB.id;
  const [agentA, agentB] = await Promise.all([
    prisma.installedAgent.create({
      data: { businessId: businessA.id, workflowId: workflow.id, name: "Telegram Agent A" }
    }),
    prisma.installedAgent.create({
      data: { businessId: businessB.id, workflowId: workflow.id, name: "Telegram Agent B" }
    })
  ]);
  agentAId = agentA.id;
  agentBId = agentB.id;
  const [connectionA, connectionB] = await Promise.all([
    prisma.telegramBotConnection.create({
      data: {
        businessId: businessA.id,
        installedAgentId: agentA.id,
        requestedUsername: `${RUN.replace(/[^a-z0-9]/gi, "").slice(0, 14)}a_bot`,
        botUserId: `100${Date.now()}`,
        botUsername: `${RUN.replace(/[^a-z0-9]/gi, "").slice(0, 14)}a_bot`,
        botDisplayName: "Business A Bot",
        botTokenEncrypted: encryptSecret("100000001:test-token-business-a"),
        webhookSecretEncrypted: encryptSecret("webhook-secret-business-a"),
        provisioningStatus: "READY",
        webhookStatus: "HEALTHY",
        status: "ACTIVE"
      }
    }),
    prisma.telegramBotConnection.create({
      data: {
        businessId: businessB.id,
        installedAgentId: agentB.id,
        requestedUsername: `${RUN.replace(/[^a-z0-9]/gi, "").slice(0, 14)}b_bot`,
        botUserId: `200${Date.now()}`,
        botUsername: `${RUN.replace(/[^a-z0-9]/gi, "").slice(0, 14)}b_bot`,
        botDisplayName: "Business B Bot",
        botTokenEncrypted: encryptSecret("100000002:test-token-business-b"),
        webhookSecretEncrypted: encryptSecret("webhook-secret-business-b"),
        provisioningStatus: "READY",
        webhookStatus: "HEALTHY",
        status: "ACTIVE"
      }
    })
  ]);
  connectionAId = connectionA.id;
  connectionBId = connectionB.id;
});

afterAll(async () => {
  if (dbAvailable) {
    await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  }
  await prisma.$disconnect();
});

describe("Telegram tenant isolation", () => {
  it("keeps the same Telegram chat separate under each installed business bot", async () => {
    if (!dbAvailable) return;
    const identityA = identity({
      businessId: businessAId,
      installedAgentId: agentAId,
      telegramConnectionId: connectionAId,
      botId: "bot-a"
    });
    const identityB = identity({
      businessId: businessBId,
      installedAgentId: agentBId,
      telegramConnectionId: connectionBId,
      botId: "bot-b"
    });

    await Promise.all([
      saveTelegramConversationState(identityA, "WAITING_FOR_NAME", { serviceName: "Cleaning" }),
      saveTelegramConversationState(identityB, "WAITING_FOR_PHONE", { serviceName: "Haircut" })
    ]);

    expect((await loadTelegramConversationState(identityA))?.context.serviceName).toBe("Cleaning");
    expect((await loadTelegramConversationState(identityB))?.context.serviceName).toBe("Haircut");
  });

  it("cannot resolve another business's service", async () => {
    if (!dbAvailable) return;
    await prisma.businessService.create({
      data: {
        businessId: businessBId,
        installedAgentId: agentBId,
        slug: "business-b-only",
        name: "Business B Service"
      }
    });

    expect(
      await loadTelegramBusinessService({
        businessId: businessAId,
        installedAgentId: agentAId,
        serviceSlug: "business-b-only"
      })
    ).toBeNull();
  });

  it("rejects a connection when the business or installed-agent mapping differs", async () => {
    if (!dbAvailable) return;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeTelegramAction({
        actionType: TELEGRAM_ACTION_TYPES.sendMessage,
        businessId: businessBId,
        installedAgentId: agentBId,
        telegramConnectionId: connectionAId,
        nodeId: "cross-tenant-send",
        chatId: "123",
        text: "Must not send"
      })
    ).rejects.toThrow(/active Telegram connection/);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("deduplicates update IDs within a connection but allows the same ID on another bot", async () => {
    if (!dbAvailable) return;
    const updateId = `${Date.now()}`;
    await prisma.telegramProcessedUpdate.create({
      data: { telegramConnectionId: connectionAId, updateId, payloadJson: { update_id: 1 } }
    });
    await expect(
      prisma.telegramProcessedUpdate.create({
        data: { telegramConnectionId: connectionAId, updateId, payloadJson: { update_id: 1 } }
      })
    ).rejects.toMatchObject<Partial<Prisma.PrismaClientKnownRequestError>>({ code: "P2002" });
    await expect(
      prisma.telegramProcessedUpdate.create({
        data: { telegramConnectionId: connectionBId, updateId, payloadJson: { update_id: 1 } }
      })
    ).resolves.toBeTruthy();
  });

  it("expires stale conversation context instead of resuming it", async () => {
    if (!dbAvailable) return;
    const stateIdentity = identity({
      businessId: businessAId,
      installedAgentId: agentAId,
      telegramConnectionId: connectionAId,
      botId: "bot-a"
    });
    await saveTelegramConversationState(stateIdentity, "CONFIRMING", {
      customerName: "Expired Customer"
    });
    await prisma.telegramConversationState.updateMany({
      where: {
        businessId: businessAId,
        installedAgentId: agentAId,
        telegramConnectionId: connectionAId,
        telegramChatId: stateIdentity.telegramChatId
      },
      data: { expiresAt: new Date(Date.now() - 1_000) }
    });

    const loaded = await loadTelegramConversationState(stateIdentity);
    expect(loaded?.state).toBe("EXPIRED");
    expect(loaded?.context).toEqual({});
  });
});
