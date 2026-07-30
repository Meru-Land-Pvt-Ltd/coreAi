import type { Prisma, WhatsAppConnectionStatus, WhatsAppMessageDirection } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export async function listConnectionsByArchitect(architectUserId: string) {
  return prisma.whatsAppConnection.findMany({
    where: { architectUserId },
    orderBy: { updatedAt: "desc" }
  });
}

export async function getConnectionById(id: string, architectUserId?: string) {
  return prisma.whatsAppConnection.findFirst({
    where: {
      id,
      ...(architectUserId ? { architectUserId } : {})
    }
  });
}

export async function getConnectionByPhoneNumberId(phoneNumberId: string) {
  return prisma.whatsAppConnection.findUnique({
    where: { phoneNumberId }
  });
}

export async function createConnection(data: {
  architectUserId: string;
  businessId?: string | null;
  displayName?: string | null;
  businessName?: string | null;
  phoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessTokenEnc: string;
  webhookVerifyTokenEnc: string;
  appSecretEnc?: string | null;
  status: WhatsAppConnectionStatus;
  qualityRating?: string | null;
  lastConnectedAt?: Date | null;
  lastError?: string | null;
}) {
  return prisma.whatsAppConnection.create({ data });
}

export async function updateConnection(
  id: string,
  data: Prisma.WhatsAppConnectionUpdateInput
) {
  return prisma.whatsAppConnection.update({ where: { id }, data });
}

export async function deleteConnection(id: string) {
  return prisma.whatsAppConnection.delete({ where: { id } });
}

export async function upsertConversation(params: {
  connectionId: string;
  contactPhone: string;
  contactName?: string | null;
  lastMessage?: string | null;
  lastMessageAt?: Date | null;
}) {
  return prisma.whatsAppConversation.upsert({
    where: {
      connectionId_contactPhone: {
        connectionId: params.connectionId,
        contactPhone: params.contactPhone
      }
    },
    create: {
      connectionId: params.connectionId,
      contactPhone: params.contactPhone,
      contactName: params.contactName ?? null,
      lastMessage: params.lastMessage ?? null,
      lastMessageAt: params.lastMessageAt ?? new Date()
    },
    update: {
      contactName: params.contactName ?? undefined,
      lastMessage: params.lastMessage ?? undefined,
      lastMessageAt: params.lastMessageAt ?? new Date()
    }
  });
}

export async function findMessageByWamid(wamid: string) {
  return prisma.whatsAppMessage.findUnique({ where: { wamid } });
}

export async function createMessage(data: {
  conversationId: string;
  direction: WhatsAppMessageDirection;
  wamid?: string | null;
  type: string;
  text?: string | null;
  mediaUrl?: string | null;
  status?: string | null;
  timestamp: Date;
}) {
  return prisma.whatsAppMessage.create({ data });
}

export async function createWebhookLog(data: {
  connectionId?: string | null;
  payloadJson: Prisma.InputJsonValue;
  headersJson?: Prisma.InputJsonValue;
  verified: boolean;
  processed?: boolean;
  error?: string | null;
}) {
  return prisma.whatsAppWebhookLog.create({
    data: {
      connectionId: data.connectionId ?? null,
      payloadJson: data.payloadJson,
      headersJson: data.headersJson ?? undefined,
      verified: data.verified,
      processed: data.processed ?? false,
      error: data.error ?? null
    }
  });
}

export async function markWebhookLog(
  id: string,
  data: { processed?: boolean; error?: string | null; connectionId?: string | null }
) {
  return prisma.whatsAppWebhookLog.update({ where: { id }, data });
}

/** Workflows owned by the architect that may contain WhatsApp trigger nodes. */
export async function listArchitectWorkflows(architectUserId: string) {
  return prisma.workflowDefinition.findMany({
    where: { architectUserId },
    select: {
      id: true,
      name: true,
      workflowJson: true,
      architectUserId: true
    },
    orderBy: { updatedAt: "desc" },
    take: 100
  });
}
