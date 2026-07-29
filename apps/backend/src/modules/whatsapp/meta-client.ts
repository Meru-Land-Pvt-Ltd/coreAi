import { env } from "../../config/env";
import { WhatsAppServiceError } from "./types";

type GraphErrorBody = {
  error?: { message?: string; code?: number; type?: string; error_subcode?: number };
};

function graphBase() {
  return `${env.META_WHATSAPP_GRAPH_BASE_URL.replace(/\/$/, "")}/${env.META_WHATSAPP_API_VERSION}`;
}

async function graphRequest<T>(
  path: string,
  accessToken: string,
  init?: RequestInit & { retryableDefault?: boolean }
): Promise<T> {
  const url = path.startsWith("http") ? path : `${graphBase()}${path.startsWith("/") ? "" : "/"}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    signal: init?.signal ?? AbortSignal.timeout(20000)
  });

  const json = (await response.json().catch(() => ({}))) as T & GraphErrorBody;

  if (!response.ok) {
    const message = json.error?.message ?? `Meta Graph API error (${response.status})`;
    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      Boolean(init?.retryableDefault);
    throw new WhatsAppServiceError(message, response.status >= 400 && response.status < 600 ? response.status : 502, "META_API_ERROR", retryable);
  }

  return json;
}

export async function metaGetPhoneNumber(accessToken: string, phoneNumberId: string) {
  return graphRequest<{
    id?: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
  }>(`/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating`, accessToken);
}

export async function metaGetPhoneNumberOwner(accessToken: string, phoneNumberId: string) {
  return graphRequest<{
    id?: string;
    data?: Array<{ id?: string; name?: string }>;
  }>(`/${encodeURIComponent(phoneNumberId)}?fields=owner_business_info`, accessToken).catch(() => null);
}

export async function metaSendTextMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  text: string;
}) {
  return graphRequest<{ messages?: Array<{ id?: string }> }>(
    `/${encodeURIComponent(params.phoneNumberId)}/messages`,
    params.accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: params.to,
        type: "text",
        text: { preview_url: false, body: params.text }
      })
    }
  );
}

export async function metaSendMediaMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  mediaType: "image" | "document" | "audio" | "video";
  mediaId?: string;
  mediaLink?: string;
  caption?: string;
  filename?: string;
}) {
  const mediaPayload: Record<string, unknown> = {};
  if (params.mediaId) mediaPayload.id = params.mediaId;
  if (params.mediaLink) mediaPayload.link = params.mediaLink;
  if (params.caption && params.mediaType !== "audio") mediaPayload.caption = params.caption;
  if (params.filename && params.mediaType === "document") mediaPayload.filename = params.filename;

  return graphRequest<{ messages?: Array<{ id?: string }> }>(
    `/${encodeURIComponent(params.phoneNumberId)}/messages`,
    params.accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: params.to,
        type: params.mediaType,
        [params.mediaType]: mediaPayload
      })
    }
  );
}

export async function metaSendTemplateMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode: string;
  components?: Array<Record<string, unknown>>;
}) {
  return graphRequest<{ messages?: Array<{ id?: string }> }>(
    `/${encodeURIComponent(params.phoneNumberId)}/messages`,
    params.accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.to,
        type: "template",
        template: {
          name: params.templateName,
          language: { code: params.languageCode },
          ...(params.components ? { components: params.components } : {})
        }
      })
    }
  );
}

export async function metaMarkMessageRead(params: {
  accessToken: string;
  phoneNumberId: string;
  messageId: string;
}) {
  return graphRequest<{ success?: boolean }>(
    `/${encodeURIComponent(params.phoneNumberId)}/messages`,
    params.accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: params.messageId
      })
    }
  );
}

export async function metaGetMediaUrl(accessToken: string, mediaId: string) {
  return graphRequest<{ url?: string; mime_type?: string; sha256?: string; file_size?: number }>(
    `/${encodeURIComponent(mediaId)}`,
    accessToken
  );
}

export async function metaDownloadMedia(accessToken: string, mediaUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new WhatsAppServiceError("Failed to download WhatsApp media", 502, "MEDIA_DOWNLOAD_FAILED", true);
  }
  return response.arrayBuffer();
}
