import { prisma } from "../../lib/prisma";
import { checkUsageCapAndNotify } from "../business/usage-cap";
import { ensureCustomerByIdentity } from "../business/customers/customer-service";
import { isAiPausedForConversation, requestHumanTakeover } from "../business/inbox/inbox-service";
import { detectHumanRequest, generateSmsAiReply } from "../business/sms-ai/sms-ai";
import { WhatsAppService } from "./service";
import type { WhatsAppConnection } from "@prisma/client";

/**
 * Buyer-scoped WhatsApp runtime (plan channel requirement): when a WhatsApp
 * number is attached to a business (WhatsAppConnection.businessId), inbound
 * messages become real AI conversations on the shared inbox — not architect
 * template scans. Replies here are Meta "session" messages: always inside the
 * 24-hour customer-service window because we reply immediately to an inbound
 * message; template-message sending (outside the window) stays out of scope
 * for the AI and is left to explicit buyer flows.
 */

export interface BuyerWhatsAppInbound {
  contactPhone: string;
  contactName?: string | null;
  text?: string | null;
  wamid: string;
}

export async function handleBuyerWhatsAppInbound(params: {
  connection: WhatsAppConnection;
  inbound: BuyerWhatsAppInbound;
}): Promise<{ replied: boolean; reason?: string }> {
  const { connection, inbound } = params;
  const businessId = connection.businessId;
  if (!businessId) return { replied: false, reason: "NOT_BUYER_SCOPED" };
  const text = (inbound.text ?? "").trim();

  // Shared-inbox thread first: the message is visible to staff even when the
  // AI stays silent (cap reached, human active, non-text message).
  const now = new Date();
  const conversation = await prisma.conversation.upsert({
    where: {
      businessId_channel_customerPhone: {
        businessId,
        channel: "WHATSAPP",
        customerPhone: inbound.contactPhone
      }
    },
    update: { status: "OPEN", lastInboundAt: now },
    create: {
      businessId,
      channel: "WHATSAPP",
      customerPhone: inbound.contactPhone,
      status: "OPEN",
      lastInboundAt: now
    }
  });
  await prisma.conversationMessage
    .create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        body: text || "[non-text message]",
        providerId: inbound.wamid
      }
    })
    .catch(() => null);

  // Canonical customer link — WHATSAPP is a STRONG identity (plan Part 7).
  if (!conversation.customerId) {
    void ensureCustomerByIdentity({
      businessId,
      kind: "WHATSAPP",
      value: inbound.contactPhone,
      displayName: inbound.contactName ?? undefined,
      source: "whatsapp"
    })
      .then((result) =>
        result.outcome !== "SKIPPED"
          ? prisma.conversation.update({
              where: { id: conversation.id },
              data: { customerId: result.customerId }
            })
          : null
      )
      .catch(() => null);
  }

  if (!text) return { replied: false, reason: "NON_TEXT" };

  if (isAiPausedForConversation(conversation)) return { replied: false, reason: "HUMAN_ACTIVE" };

  // Usage-cap backstop: same gate as every other AI entry point.
  const capStatus = await checkUsageCapAndNotify(businessId);
  if (capStatus.exceeded) return { replied: false, reason: "USAGE_CAP" };

  const [business, agent] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { name: true, type: true } }),
    connection.installedAgentId
      ? prisma.installedAgent.findFirst({
          where: { id: connection.installedAgentId, businessId },
          select: { id: true, configJson: true }
        })
      : prisma.installedAgent.findFirst({
          where: { businessId, status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          select: { id: true, configJson: true }
        })
  ]);

  const details = readBusinessDetails(agent?.configJson);
  const history = await prisma.conversationMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { direction: true, body: true }
  });

  const result = await generateSmsAiReply({
    context: {
      businessId,
      installedAgentId: agent?.id ?? null,
      businessName: business?.name ?? connection.businessName ?? "the business",
      businessType: business?.type ?? null,
      services: details.services,
      faqs: details.faqs,
      tone: details.tone,
      bookingUrl: details.bookingUrl
    },
    conversationId: conversation.id,
    customerPhone: inbound.contactPhone,
    inboundBody: text,
    history: history.reverse()
  });

  // Human requests reply with the honest ack; otherwise the AI reply (or
  // nothing when no LLM is configured — the message still sits in the inbox).
  const reply = result.reply;
  if (!reply) return { replied: false, reason: result.humanRequested ? "HUMAN_REQUESTED" : "NO_REPLY" };

  try {
    await WhatsAppService.sendText({
      connectionId: connection.id,
      recipient: inbound.contactPhone,
      message: reply
    });
  } catch (error) {
    console.error("[whatsapp-buyer] reply send failed (inbound recorded)", {
      connectionId: connection.id,
      message: error instanceof Error ? error.message : String(error)
    });
    return { replied: false, reason: "SEND_FAILED" };
  }

  await prisma.conversationMessage
    .create({
      data: { conversationId: conversation.id, direction: "OUTBOUND", body: reply }
    })
    .catch(() => null);
  await prisma.conversation
    .update({ where: { id: conversation.id }, data: { lastOutboundAt: new Date() } })
    .catch(() => null);

  return { replied: true };
}

/** Only checked for the human-request detector — full AI runs in sms-ai. */
export function shouldFlagHumanRequest(text: string | null | undefined): boolean {
  return Boolean(text && detectHumanRequest(text));
}

function readBusinessDetails(configJson: unknown): {
  services: string[] | null;
  faqs: string[] | null;
  tone: string | null;
  bookingUrl: string | null;
} {
  const config =
    configJson && typeof configJson === "object" && !Array.isArray(configJson)
      ? (configJson as Record<string, unknown>)
      : {};
  const details =
    config.businessDetails && typeof config.businessDetails === "object" && !Array.isArray(config.businessDetails)
      ? (config.businessDetails as Record<string, unknown>)
      : {};
  const list = (value: unknown): string[] | null =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : null;
  return {
    services: list(details.services),
    faqs: list(details.faqs),
    tone: typeof details.tone === "string" ? details.tone : null,
    bookingUrl: typeof details.bookingUrl === "string" ? details.bookingUrl : null
  };
}

/** WhatsApp connection settings a buyer may own (attach/detach their business). */
export async function attachConnectionToBusiness(params: {
  connectionId: string;
  businessId: string;
  installedAgentId?: string | null;
}): Promise<void> {
  if (params.installedAgentId) {
    const agent = await prisma.installedAgent.findFirst({
      where: { id: params.installedAgentId, businessId: params.businessId },
      select: { id: true }
    });
    if (!agent) throw new Error("Installed agent does not belong to this business");
  }
  await prisma.whatsAppConnection.update({
    where: { id: params.connectionId },
    data: { businessId: params.businessId, installedAgentId: params.installedAgentId ?? null }
  });
}
