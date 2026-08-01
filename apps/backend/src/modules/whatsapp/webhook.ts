import type { Context } from "hono";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest } from "../architect/workflow-runner";
import {
  createMessage,
  createWebhookLog,
  findMessageByWamid,
  getConnectionByPhoneNumberId,
  listArchitectWorkflows,
  markWebhookLog,
  upsertConversation
} from "./repository";
import { WhatsAppService } from "./service";
import {
  WhatsAppServiceError,
  type MetaWebhookChangeValue,
  type MetaWebhookMessage,
  type ParsedInboundWhatsAppMessage,
  type WhatsAppListenFor,
  type WhatsAppWorkflowEvent
} from "./types";
import { isLikelyGroupMessage, messageTypeMatchesListenFor, normalizeWhatsAppRecipient, verifyMetaSignature } from "./utils";
import { metaGetMediaUrl } from "./meta-client";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function extractMediaId(message: MetaWebhookMessage): string | null {
  const type = message.type?.toLowerCase();
  if (type === "image") return message.image?.id ?? null;
  if (type === "document") return message.document?.id ?? null;
  if (type === "audio" || type === "voice") return message.audio?.id ?? null;
  if (type === "video") return message.video?.id ?? null;
  return null;
}

function extractText(message: MetaWebhookMessage): string | null {
  if (message.type === "text") return message.text?.body?.trim() || null;
  return (
    message.image?.caption?.trim() ||
    message.document?.caption?.trim() ||
    message.video?.caption?.trim() ||
    null
  );
}

export function parseInboundMessages(payload: unknown): ParsedInboundWhatsAppMessage[] {
  const root = asRecord(payload);
  const entries = Array.isArray(root?.entry) ? root!.entry : [];
  const parsed: ParsedInboundWhatsAppMessage[] = [];

  for (const entry of entries) {
    const entryObj = asRecord(entry);
    const changes = Array.isArray(entryObj?.changes) ? entryObj!.changes : [];
    for (const change of changes) {
      const changeObj = asRecord(change);
      const value = (changeObj?.value ?? null) as MetaWebhookChangeValue | null;
      if (!value?.metadata?.phone_number_id) continue;

      const phoneNumberId = value.metadata.phone_number_id;
      const contacts = value.contacts ?? [];
      const messages = value.messages ?? [];

      // Status-only updates (delivery receipts) — skip message processing.
      if (messages.length === 0 && Array.isArray(value.statuses) && value.statuses.length > 0) {
        continue;
      }

      for (const message of messages) {
        const contact =
          contacts.find((c) => c.wa_id === message.from) ?? contacts[0] ?? null;
        const tsSeconds = Number(message.timestamp);
        const timestamp = Number.isFinite(tsSeconds)
          ? new Date(tsSeconds * 1000)
          : new Date();

        parsed.push({
          connectionPhoneNumberId: phoneNumberId,
          contactPhone: normalizeWhatsAppRecipient(message.from),
          contactName: contact?.profile?.name?.trim() || null,
          wamid: message.id,
          type: (message.type || "text").toLowerCase(),
          text: extractText(message),
          mediaId: extractMediaId(message),
          mediaUrl: null,
          timestamp,
          isGroup: isLikelyGroupMessage(message.from),
          isStatus: false
        });
      }
    }
  }

  return parsed;
}

function nodeData(node: Record<string, unknown>): Record<string, unknown> {
  const data = node.data;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
}

export function workflowHasMatchingWhatsAppTrigger(
  workflowJson: unknown,
  connectionId: string,
  inbound: ParsedInboundWhatsAppMessage
): boolean {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return false;

  for (const raw of nodes) {
    if (typeof raw !== "object" || raw === null) continue;
    const data = nodeData(raw as Record<string, unknown>);
    const type = typeof data.type === "string" ? data.type : "";
    if (type !== "trigger.whatsapp_message_received") continue;

    const nodeConnectionId = typeof data.connectionId === "string" ? data.connectionId : "";
    // Empty connectionId = listen on any connection owned by this architect.
    if (nodeConnectionId && nodeConnectionId !== connectionId) continue;

    const listenFor = (typeof data.listenFor === "string" ? data.listenFor : "all") as WhatsAppListenFor;
    if (!messageTypeMatchesListenFor(inbound.type, listenFor)) continue;

    const ignoreGroups = String(data.ignoreGroups ?? "true") !== "false";
    if (ignoreGroups && inbound.isGroup) continue;

    const ignoreStatus = String(data.ignoreStatusMessages ?? "true") !== "false";
    if (ignoreStatus && inbound.isStatus) continue;

    return true;
  }

  return false;
}

async function resolveMediaUrl(
  connectionId: string,
  accessTokenEnc: string,
  mediaId: string | null
): Promise<string | null> {
  if (!mediaId) return null;
  try {
    const token = WhatsAppService.decryptAccessTokenForInternal(accessTokenEnc);
    const meta = await metaGetMediaUrl(token, mediaId);
    return meta.url ?? null;
  } catch (error) {
    console.warn("[whatsapp] media url resolve failed", { connectionId, mediaId, error });
    return null;
  }
}

export async function verifyWhatsAppWebhookChallenge(c: Context) {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return c.text("Bad Request", 400);
  }

  const envVerifyToken = env.META_WHATSAPP_VERIFY_TOKEN?.trim();
  if (envVerifyToken && token === envVerifyToken) {
    return c.text(challenge, 200);
  }

  // Accept if any CONNECTED/PENDING connection has this verify token.
  const connections = await prisma.whatsAppConnection.findMany({
    where: { status: { in: ["CONNECTED", "PENDING"] } },
    select: { webhookVerifyTokenEnc: true },
    take: 200
  });

  for (const connection of connections) {
    try {
      if (WhatsAppService.decryptVerifyToken(connection.webhookVerifyTokenEnc) === token) {
        return c.text(challenge, 200);
      }
    } catch {
      // try next
    }
  }

  return c.text("Forbidden", 403);
}

export async function handleWhatsAppWebhookPost(c: Context) {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? undefined;
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return c.json({ success: false, errorCode: "INVALID_JSON", message: "Invalid JSON" }, 400);
  }

  const inboundAll = parseInboundMessages(payload);
  const firstPhoneNumberId = inboundAll[0]?.connectionPhoneNumberId;
  const connection = firstPhoneNumberId
    ? await getConnectionByPhoneNumberId(firstPhoneNumberId)
    : null;

  const appSecret = connection
    ? WhatsAppService.decryptAppSecret(connection.appSecretEnc)
    : null;

  let verified = false;
  if (appSecret) {
    verified = verifyMetaSignature(rawBody, signature, appSecret);
    if (!verified) {
      await createWebhookLog({
        connectionId: connection?.id ?? null,
        payloadJson: payload as object,
        headersJson: { "x-hub-signature-256": signature ?? null },
        verified: false,
        processed: false,
        error: "Invalid signature"
      });
      return c.json({ success: false, errorCode: "INVALID_SIGNATURE", message: "Invalid signature" }, 401);
    }
  } else {
    // Dev / misconfigured: still accept but mark unverified.
    verified = !signature;
  }

  const log = await createWebhookLog({
    connectionId: connection?.id ?? null,
    payloadJson: payload as object,
    headersJson: { "x-hub-signature-256": signature ?? null },
    verified,
    processed: false
  });

  try {
    for (const inbound of inboundAll) {
      const conn =
        connection && connection.phoneNumberId === inbound.connectionPhoneNumberId
          ? connection
          : await getConnectionByPhoneNumberId(inbound.connectionPhoneNumberId);

      if (!conn || conn.status === "DISCONNECTED") continue;

      const existing = await findMessageByWamid(inbound.wamid);
      if (existing) continue;

      const mediaUrl = await resolveMediaUrl(conn.id, conn.accessTokenEnc, inbound.mediaId);
      const conversation = await upsertConversation({
        connectionId: conn.id,
        contactPhone: inbound.contactPhone,
        contactName: inbound.contactName,
        lastMessage: inbound.text || `[${inbound.type}]`,
        lastMessageAt: inbound.timestamp
      });

      await createMessage({
        conversationId: conversation.id,
        direction: "INBOUND",
        wamid: inbound.wamid,
        type: inbound.type,
        text: inbound.text,
        mediaUrl,
        status: "received",
        timestamp: inbound.timestamp
      });

      try {
        await WhatsAppService.markRead({
          connectionId: conn.id,
          messageId: inbound.wamid
        });
      } catch {
        // non-fatal
      }

      const event: WhatsAppWorkflowEvent = {
        type: "WHATSAPP_MESSAGE",
        connectionId: conn.id,
        contact: { name: inbound.contactName, phone: inbound.contactPhone },
        customer: { name: inbound.contactName, phone: inbound.contactPhone },
        message: {
          id: inbound.wamid,
          type: inbound.type,
          text: inbound.text,
          mediaUrl
        },
        timestamp: inbound.timestamp.toISOString()
      };

      const workflows = await listArchitectWorkflows(conn.architectUserId);
      for (const workflow of workflows) {
        if (!workflowHasMatchingWhatsAppTrigger(workflow.workflowJson, conn.id, inbound)) {
          continue;
        }

        try {
          await runWorkflowTest({
            userId: workflow.architectUserId,
            workflowId: workflow.id,
            workflowJson: workflow.workflowJson,
            mode: "live",
            executionMode: "LIVE",
            callProvider: "WHATSAPP",
            externalCallId: inbound.wamid,
            input: {
              callerNumber: inbound.contactPhone,
              callerName: inbound.contactName ?? undefined,
              latestMessage: inbound.text ?? undefined,
              inboundSmsBody: inbound.text ?? undefined,
              whatsapp: event
            }
          });
        } catch (error) {
          console.error("[whatsapp] workflow dispatch failed", {
            workflowId: workflow.id,
            wamid: inbound.wamid,
            error
          });
        }
      }
    }

    await markWebhookLog(log.id, { processed: true, connectionId: connection?.id ?? null });
    return c.json({ success: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    await markWebhookLog(log.id, { processed: false, error: message });
    if (error instanceof WhatsAppServiceError) {
      return c.json(error.toBody(), error.status as 400);
    }
    console.error("[whatsapp] webhook error", error);
    return c.json({ success: false, errorCode: "WEBHOOK_FAILED", message }, 500);
  }
}
