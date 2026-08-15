/**
 * One-shot run output extraction shared by the public agent-page /run endpoint
 * and the architect builder's preview-run endpoint. Both surfaces must render
 * the exact same { text, mediaUrls } for the same engine result — keep every
 * extraction rule here so they can never drift.
 */

/** Structural view of a runWorkflowTest result — only what extraction reads. */
export type RunEngineResult = { context?: unknown; logs?: unknown[] };

/**
 * Explicit media keys only — a generic "url" field (booking links, webhook
 * echoes) must never surface as visitor-facing media.
 */
const MEDIA_URL_KEYS = new Set(["imageUrl", "videoUrl", "mediaUrl"]);
const MAX_MEDIA_URLS = 8;

/** http(s) URLs plus data: image/video URIs (the image node emits data URIs). */
function isRenderableMediaUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^https?:\/\//i.test(value) || /^data:(image|video)\//i.test(value))
  );
}

function collectMediaUrls(output: unknown, found: Set<string>, depth = 0): void {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return;

  for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
    if (MEDIA_URL_KEYS.has(key) && isRenderableMediaUrl(value)) {
      found.add(value);
    } else if (depth < 1 && typeof value === "object" && value !== null && !Array.isArray(value)) {
      collectMediaUrls(value, found, depth + 1);
    }
  }
}

/**
 * Media from a one-shot run. The image-generation node never logs its URL —
 * the log line carries "[Binary Image Data]" — so the real result is read
 * from context.image_url and context.imagePipeline[nodeId].imageUrl (usually
 * data: URIs). Log outputs are still scanned for explicit media keys emitted
 * by other node types.
 */
export function extractRunMediaUrls(result: RunEngineResult): string[] {
  const found = new Set<string>();
  const context = (result.context ?? {}) as Record<string, unknown>;

  if (isRenderableMediaUrl(context.image_url)) found.add(context.image_url);

  const pipeline = context.imagePipeline;
  if (pipeline && typeof pipeline === "object" && !Array.isArray(pipeline)) {
    for (const entry of Object.values(pipeline as Record<string, unknown>)) {
      const imageUrl = (entry as { imageUrl?: unknown } | null)?.imageUrl;
      if (isRenderableMediaUrl(imageUrl)) found.add(imageUrl);
    }
  }

  for (const log of result.logs ?? []) {
    collectMediaUrls((log as { output?: unknown }).output, found);
  }

  return [...found].slice(0, MAX_MEDIA_URLS);
}

/** The final AI reply text of a one-shot run, or null when the run produced none. */
export function extractRunText(result: RunEngineResult): string | null {
  const aiOutput = (result.context as { ai?: { output?: unknown } } | undefined)?.ai?.output;
  return typeof aiOutput === "string" ? aiOutput : null;
}

/** The full visitor-facing payload of a one-shot run. */
export function extractRunOutput(result: RunEngineResult): {
  text: string | null;
  mediaUrls: string[];
} {
  return { text: extractRunText(result), mediaUrls: extractRunMediaUrls(result) };
}
