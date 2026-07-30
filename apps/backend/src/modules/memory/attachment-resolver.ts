import type { AIAttachment } from "../ai-provider-engine/types";
import { getCleanBase64 } from "../ai-provider-engine/providers/base-adapter";

/**
 * Resolves attachment URLs (HTTP/S3) or raw data strings into clean base64 / data URIs
 * ready for multimodal LLMs (OpenAI, Claude, Gemini).
 */
export async function resolveAttachment(att: AIAttachment): Promise<AIAttachment> {
  const dataStr = (att.data ?? "").trim();
  const mimeType = att.mimeType ?? "application/octet-stream";

  if (dataStr.startsWith("http://") || dataStr.startsWith("https://")) {
    try {
      const response = await fetch(dataStr, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        console.warn(`[attachment-resolver] Failed to fetch attachment URL: ${dataStr} (${response.status})`);
        return att;
      }
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return {
        ...att,
        data: base64,
        mimeType: response.headers.get("content-type") || mimeType,
      };
    } catch (error) {
      console.error(`[attachment-resolver] Error fetching attachment URL ${dataStr}:`, error);
      return att;
    }
  }

  return {
    ...att,
    data: getCleanBase64(dataStr),
    mimeType,
  };
}

export async function resolveAttachments(attachments?: AIAttachment[]): Promise<AIAttachment[]> {
  if (!attachments || attachments.length === 0) return [];
  return Promise.all(attachments.map((att) => resolveAttachment(att)));
}
