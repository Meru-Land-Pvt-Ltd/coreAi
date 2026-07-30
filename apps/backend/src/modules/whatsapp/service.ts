import crypto from "node:crypto";
import { env } from "../../config/env";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import {
  createConnection,
  createMessage,
  deleteConnection,
  getConnectionById,
  getConnectionByPhoneNumberId,
  listConnectionsByArchitect,
  updateConnection,
  upsertConversation
} from "./repository";
import {
  metaDownloadMedia,
  metaGetMediaUrl,
  metaGetPhoneNumber,
  metaMarkMessageRead,
  metaSendMediaMessage,
  metaSendTemplateMessage,
  metaSendTextMessage
} from "./meta-client";
import type { ConnectWhatsAppInput, SendWhatsAppTextInput } from "./validators";
import {
  WhatsAppServiceError,
  type WhatsAppConnectionPublic,
  type WhatsAppConnectionOwnerView
} from "./types";
import { normalizeWhatsAppRecipient, whatsappWebhookCallbackUrl } from "./utils";

type ConnectionRow = {
  id: string;
  displayName: string | null;
  businessName: string | null;
  phoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  status: string;
  qualityRating: string | null;
  lastConnectedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toPublic(connection: ConnectionRow): WhatsAppConnectionPublic {
  return {
    id: connection.id,
    displayName: connection.displayName,
    businessName: connection.businessName,
    phoneNumber: connection.phoneNumber,
    status: connection.status as WhatsAppConnectionPublic["status"],
    qualityRating: connection.qualityRating,
    lastConnectedAt: connection.lastConnectedAt?.toISOString() ?? null,
    lastError: connection.lastError,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
    webhookCallbackUrl: whatsappWebhookCallbackUrl(env.BACKEND_URL)
  };
}

function toOwnerView(connection: ConnectionRow): WhatsAppConnectionOwnerView {
  return {
    ...toPublic(connection),
    phoneNumberId: connection.phoneNumberId,
    businessAccountId: connection.businessAccountId
  };
}

async function requireOwnedConnection(connectionId: string, architectUserId: string) {
  const connection = await getConnectionById(connectionId, architectUserId);
  if (!connection) {
    throw new WhatsAppServiceError("WhatsApp connection not found.", 404, "CONNECTION_NOT_FOUND");
  }
  return connection;
}

function auditCredentialAccess(action: string, connectionId: string, userId?: string) {
  console.info("[whatsapp:audit]", JSON.stringify({
    action,
    connectionId,
    userId: userId ?? "system",
    timestamp: new Date().toISOString()
  }));
}

function decryptAccessToken(enc: string, connectionId?: string, userId?: string) {
  if (connectionId) auditCredentialAccess("decrypt_access_token", connectionId, userId);
  try {
    return decryptSecret(enc);
  } catch {
    throw new WhatsAppServiceError("Stored access token could not be decrypted.", 500, "TOKEN_DECRYPT_FAILED");
  }
}

export const WhatsAppService = {
  async listConnections(architectUserId: string): Promise<WhatsAppConnectionPublic[]> {
    const rows = await listConnectionsByArchitect(architectUserId);
    return rows.map(toPublic);
  },

  async listConnectionsOwnerView(architectUserId: string): Promise<WhatsAppConnectionOwnerView[]> {
    const rows = await listConnectionsByArchitect(architectUserId);
    return rows.map(toOwnerView);
  },

  async getConnection(architectUserId: string, connectionId: string): Promise<WhatsAppConnectionPublic> {
    const connection = await requireOwnedConnection(connectionId, architectUserId);
    return toPublic(connection);
  },

  async getConnectionOwnerView(architectUserId: string, connectionId: string): Promise<WhatsAppConnectionOwnerView> {
    const connection = await requireOwnedConnection(connectionId, architectUserId);
    return toOwnerView(connection);
  },

  async connect(
    architectUserId: string,
    input: ConnectWhatsAppInput & { businessId?: string | null }
  ): Promise<WhatsAppConnectionPublic> {
    const phoneNumber = normalizeWhatsAppRecipient(input.phoneNumber);
    const phoneNumberId = input.phoneNumberId.trim();
    const businessAccountId = input.businessAccountId?.trim() || phoneNumberId;
    const autoWebhookToken = input.webhookVerifyToken?.trim() || crypto.randomUUID().replace(/-/g, "");
    const businessId = input.businessId?.trim() || null;

    const existingByPhoneId = await getConnectionByPhoneNumberId(phoneNumberId);
    if (existingByPhoneId && existingByPhoneId.architectUserId !== architectUserId) {
      throw new WhatsAppServiceError(
        "This WhatsApp phone number ID is already connected to another account.",
        409,
        "PHONE_NUMBER_IN_USE"
      );
    }

    let qualityRating: string | null = null;
    let verifiedName: string | null = input.businessName?.trim() || null;
    let displayPhone = phoneNumber;

    try {
      const meta = await metaGetPhoneNumber(input.accessToken, phoneNumberId);
      qualityRating = meta.quality_rating ?? null;
      verifiedName = meta.verified_name?.trim() || verifiedName;
      if (meta.display_phone_number) {
        displayPhone = normalizeWhatsAppRecipient(meta.display_phone_number) || displayPhone;
      }
    } catch (error) {
      if (error instanceof WhatsAppServiceError) {
        throw new WhatsAppServiceError(
          `Could not verify WhatsApp credentials with Meta: ${error.message}`,
          422,
          "CREDENTIALS_INVALID",
          false
        );
      }
      throw error;
    }

    const accessTokenEnc = encryptSecret(input.accessToken.trim());
    const webhookVerifyTokenEnc = encryptSecret(autoWebhookToken);
    const appSecretEnc = input.appSecret?.trim()
      ? encryptSecret(input.appSecret.trim())
      : env.META_WHATSAPP_APP_SECRET
        ? encryptSecret(env.META_WHATSAPP_APP_SECRET)
        : null;

    if (existingByPhoneId) {
      const updated = await updateConnection(existingByPhoneId.id, {
        displayName: input.displayName?.trim() || existingByPhoneId.displayName,
        businessName: verifiedName,
        phoneNumber: displayPhone,
        businessAccountId,
        ...(businessId ? { businessId } : {}),
        accessTokenEnc,
        webhookVerifyTokenEnc,
        appSecretEnc,
        status: "CONNECTED",
        qualityRating,
        lastConnectedAt: new Date(),
        lastError: null
      });
      return toPublic(updated);
    }

    const created = await createConnection({
      architectUserId,
      businessId,
      displayName: input.displayName?.trim() || verifiedName || `WhatsApp ${displayPhone}`,
      businessName: verifiedName,
      phoneNumber: displayPhone,
      phoneNumberId,
      businessAccountId,
      accessTokenEnc,
      webhookVerifyTokenEnc,
      appSecretEnc,
      status: "CONNECTED",
      qualityRating,
      lastConnectedAt: new Date(),
      lastError: null
    });

    return toPublic(created);
  },

  async disconnect(architectUserId: string, connectionId: string): Promise<WhatsAppConnectionPublic> {
    await requireOwnedConnection(connectionId, architectUserId);
    const updated = await updateConnection(connectionId, {
      status: "DISCONNECTED",
      lastError: null
    });
    return toPublic(updated);
  },

  async rename(architectUserId: string, connectionId: string, displayName: string): Promise<WhatsAppConnectionPublic> {
    await requireOwnedConnection(connectionId, architectUserId);
    const updated = await updateConnection(connectionId, { displayName });
    return toPublic(updated);
  },

  async refreshConnection(architectUserId: string, connectionId: string): Promise<WhatsAppConnectionPublic> {
    const connection = await requireOwnedConnection(connectionId, architectUserId);
    const token = decryptAccessToken(connection.accessTokenEnc, connectionId, architectUserId);

    try {
      const meta = await metaGetPhoneNumber(token, connection.phoneNumberId);
      const updated = await updateConnection(connectionId, {
        businessName: meta.verified_name?.trim() || connection.businessName,
        phoneNumber: meta.display_phone_number
          ? normalizeWhatsAppRecipient(meta.display_phone_number)
          : connection.phoneNumber,
        qualityRating: meta.quality_rating ?? connection.qualityRating,
        status: "CONNECTED",
        lastConnectedAt: new Date(),
        lastError: null
      });
      return toPublic(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refresh failed";
      const updated = await updateConnection(connectionId, {
        status: "ERROR",
        lastError: message
      });
      throw new WhatsAppServiceError(message, 422, "REFRESH_FAILED", true);
    }
  },

  async testConnection(architectUserId: string, connectionId: string) {
    const connection = await requireOwnedConnection(connectionId, architectUserId);
    const token = decryptAccessToken(connection.accessTokenEnc, connectionId, architectUserId);
    const meta = await metaGetPhoneNumber(token, connection.phoneNumberId);
    await updateConnection(connectionId, {
      status: "CONNECTED",
      qualityRating: meta.quality_rating ?? connection.qualityRating,
      lastConnectedAt: new Date(),
      lastError: null
    });
    return {
      ok: true,
      phoneNumberId: meta.id ?? connection.phoneNumberId,
      displayPhoneNumber: meta.display_phone_number ?? connection.phoneNumber,
      verifiedName: meta.verified_name ?? connection.businessName,
      qualityRating: meta.quality_rating ?? null
    };
  },

  async sendText(params: SendWhatsAppTextInput & { architectUserId?: string }) {
    const connection = params.architectUserId
      ? await requireOwnedConnection(params.connectionId, params.architectUserId)
      : await getConnectionById(params.connectionId);

    if (!connection) {
      throw new WhatsAppServiceError("WhatsApp connection not found.", 404, "CONNECTION_NOT_FOUND");
    }
    if (connection.status === "DISCONNECTED") {
      throw new WhatsAppServiceError("WhatsApp connection is disconnected.", 422, "CONNECTION_DISCONNECTED");
    }

    const token = decryptAccessToken(connection.accessTokenEnc, connection.id, params.architectUserId);
    const to = normalizeWhatsAppRecipient(params.recipient);
    const result = await metaSendTextMessage({
      accessToken: token,
      phoneNumberId: connection.phoneNumberId,
      to,
      text: params.message
    });

    const wamid = result.messages?.[0]?.id ?? null;
    const conversation = await upsertConversation({
      connectionId: connection.id,
      contactPhone: to,
      lastMessage: params.message,
      lastMessageAt: new Date()
    });

    await createMessage({
      conversationId: conversation.id,
      direction: "OUTBOUND",
      wamid,
      type: "text",
      text: params.message,
      status: "sent",
      timestamp: new Date()
    });

    return { wamid, connectionId: connection.id, to };
  },

  async sendMedia(params: {
    connectionId: string;
    architectUserId?: string;
    recipient: string;
    mediaType: "image" | "document" | "audio" | "video";
    mediaId?: string;
    mediaLink?: string;
    caption?: string;
    filename?: string;
  }) {
    const connection = params.architectUserId
      ? await requireOwnedConnection(params.connectionId, params.architectUserId)
      : await getConnectionById(params.connectionId);
    if (!connection) {
      throw new WhatsAppServiceError("WhatsApp connection not found.", 404, "CONNECTION_NOT_FOUND");
    }

    const token = decryptAccessToken(connection.accessTokenEnc, connection.id, params.architectUserId);
    const to = normalizeWhatsAppRecipient(params.recipient);
    const result = await metaSendMediaMessage({
      accessToken: token,
      phoneNumberId: connection.phoneNumberId,
      to,
      mediaType: params.mediaType,
      mediaId: params.mediaId,
      mediaLink: params.mediaLink,
      caption: params.caption,
      filename: params.filename
    });

    const wamid = result.messages?.[0]?.id ?? null;
    const conversation = await upsertConversation({
      connectionId: connection.id,
      contactPhone: to,
      lastMessage: params.caption || `[${params.mediaType}]`,
      lastMessageAt: new Date()
    });
    await createMessage({
      conversationId: conversation.id,
      direction: "OUTBOUND",
      wamid,
      type: params.mediaType,
      text: params.caption ?? null,
      mediaUrl: params.mediaLink ?? null,
      status: "sent",
      timestamp: new Date()
    });

    return { wamid, connectionId: connection.id, to };
  },

  async sendTemplate(params: {
    connectionId: string;
    architectUserId?: string;
    recipient: string;
    templateName: string;
    languageCode: string;
    components?: Array<Record<string, unknown>>;
  }) {
    const connection = params.architectUserId
      ? await requireOwnedConnection(params.connectionId, params.architectUserId)
      : await getConnectionById(params.connectionId);
    if (!connection) {
      throw new WhatsAppServiceError("WhatsApp connection not found.", 404, "CONNECTION_NOT_FOUND");
    }

    const token = decryptAccessToken(connection.accessTokenEnc, connection.id, params.architectUserId);
    const to = normalizeWhatsAppRecipient(params.recipient);
    const result = await metaSendTemplateMessage({
      accessToken: token,
      phoneNumberId: connection.phoneNumberId,
      to,
      templateName: params.templateName,
      languageCode: params.languageCode,
      components: params.components
    });

    return { wamid: result.messages?.[0]?.id ?? null, connectionId: connection.id, to };
  },

  async uploadMedia(): Promise<never> {
    throw new WhatsAppServiceError(
      "Media upload via Triven is not enabled yet. Host media and send by link, or use Meta's media ID.",
      501,
      "UPLOAD_NOT_IMPLEMENTED"
    );
  },

  async downloadMedia(params: { connectionId: string; mediaId: string; architectUserId?: string }) {
    const connection = params.architectUserId
      ? await requireOwnedConnection(params.connectionId, params.architectUserId)
      : await getConnectionById(params.connectionId);
    if (!connection) {
      throw new WhatsAppServiceError("WhatsApp connection not found.", 404, "CONNECTION_NOT_FOUND");
    }
    const token = decryptAccessToken(connection.accessTokenEnc, connection.id, params.architectUserId);
    const meta = await metaGetMediaUrl(token, params.mediaId);
    if (!meta.url) {
      throw new WhatsAppServiceError("Media URL missing from Meta.", 404, "MEDIA_NOT_FOUND");
    }
    const buffer = await metaDownloadMedia(token, meta.url);
    return { url: meta.url, mimeType: meta.mime_type ?? null, bytes: buffer };
  },

  async markRead(params: { connectionId: string; messageId: string; architectUserId?: string }) {
    const connection = params.architectUserId
      ? await requireOwnedConnection(params.connectionId, params.architectUserId)
      : await getConnectionById(params.connectionId);
    if (!connection) {
      throw new WhatsAppServiceError("WhatsApp connection not found.", 404, "CONNECTION_NOT_FOUND");
    }
    const token = decryptAccessToken(connection.accessTokenEnc, connection.id, params.architectUserId);
    return metaMarkMessageRead({
      accessToken: token,
      phoneNumberId: connection.phoneNumberId,
      messageId: params.messageId
    });
  },

  /** Soft-delete: mark disconnected then remove row (cascades conversations). */
  async remove(architectUserId: string, connectionId: string) {
    await requireOwnedConnection(connectionId, architectUserId);
    await deleteConnection(connectionId);
    return { deleted: true };
  },

  decryptAccessTokenForInternal(enc: string) {
    return decryptAccessToken(enc);
  },

  decryptVerifyToken(enc: string) {
    try {
      return decryptSecret(enc);
    } catch {
      throw new WhatsAppServiceError("Webhook verify token could not be decrypted.", 500, "TOKEN_DECRYPT_FAILED");
    }
  },

  decryptAppSecret(enc: string | null | undefined): string | null {
    if (!enc) return env.META_WHATSAPP_APP_SECRET ?? null;
    try {
      return decryptSecret(enc);
    } catch {
      return env.META_WHATSAPP_APP_SECRET ?? null;
    }
  }
};
