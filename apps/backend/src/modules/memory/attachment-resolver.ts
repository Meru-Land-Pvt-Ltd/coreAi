import type { AIAttachment } from "../ai-provider-engine/types";
import { getCleanBase64 } from "../ai-provider-engine/providers/base-adapter";
import { assertUrlSafe } from "../../lib/safe-fetch";

/**
 * Resolves attachment URLs (HTTP/S3) or raw data strings into clean base64 / data URIs
 * ready for multimodal LLMs (OpenAI, Claude, Gemini).
 */
export async function resolveAttachment(att: AIAttachment): Promise<AIAttachment> {
  const dataStr = (att.data ?? "").trim();
  const mimeType = att.mimeType ?? "application/octet-stream";

  if (dataStr.startsWith("http://") || dataStr.startsWith("https://")) {
    try {
      /* THIS ADDRESS CAME FROM OUTSIDE. A public agent page takes an
         attachment from any visitor, and it reaches here as a string. Fetching
         it as written let a stranger point our server at anything the server
         can reach that they cannot — our own database, another container, the
         cloud metadata service — and read the answer back through the model's
         reply. Every other outbound fetch on this platform goes through this
         check; this one was missed.

         The bytes are read here rather than through safeFetch because an
         attachment is a picture, and safeFetch decodes bodies as text. */
      await assertUrlSafe(dataStr);

      const response = await fetch(dataStr, {
        signal: AbortSignal.timeout(15_000),
        /* Never follow a redirect: a permitted address is free to point at a
           forbidden one, and the check above only saw the first hop. */
        redirect: "manual"
      });
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
