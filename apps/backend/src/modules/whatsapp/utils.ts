import crypto from "crypto";
import type { WhatsAppListenFor } from "./types";

/** Normalize a phone to digits-only E.164-ish form (leading + stripped for Meta API). */
export function normalizeWhatsAppRecipient(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return trimmed;
  return digits;
}

export function verifyMetaSignature(rawBody: string, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function messageTypeMatchesListenFor(messageType: string, listenFor: WhatsAppListenFor): boolean {
  if (listenFor === "all") return true;
  const normalized = messageType.toLowerCase();
  if (listenFor === "text") return normalized === "text";
  if (listenFor === "image") return normalized === "image";
  if (listenFor === "document") return normalized === "document";
  if (listenFor === "audio") return normalized === "audio" || normalized === "voice";
  if (listenFor === "video") return normalized === "video";
  return false;
}

export function isLikelyGroupMessage(from: string): boolean {
  // Meta Cloud API group messages use a different shape; treat @g.us / long participant ids.
  return /@g\.us$/i.test(from) || from.includes("-");
}

export function renderSimpleTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const value = vars[path];
    return value == null ? "" : String(value);
  });
}

export function whatsappWebhookCallbackUrl(backendUrl: string): string {
  return `${backendUrl.replace(/\/$/, "")}/architect/connectors/whatsapp`;
}
