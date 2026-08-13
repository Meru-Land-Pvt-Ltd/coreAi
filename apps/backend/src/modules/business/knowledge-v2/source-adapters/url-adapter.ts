import { sanitizeFilename } from "../../knowledge-files";
import { SourceAdapterError, type SourceAdapter } from "./types";

/**
 * URL knowledge source (plan Part 3): fetch a PUBLIC web page and extract its
 * visible text for ingestion.
 *
 * SSRF guard (documented scope): we validate by URL shape only — scheme must
 * be http(s), port must be default/80/443, and the hostname must not match
 * loopback/private/link-local patterns (localhost, 127.*, 0.0.0.0, 10.*,
 * 192.168.*, 172.16-31.*, 169.254.*, *.local, *.internal, any IPv6 literal).
 * Redirects are followed manually and EVERY hop is re-validated. We do NOT
 * resolve DNS and re-check the resulting IP, so a public hostname that
 * resolves to a private address (DNS rebinding) is not caught — accepted MVP
 * limitation, called out here on purpose.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_URL_CONTENT_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_REDIRECTS = 3;

const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/,
  /\.localhost$/,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /\.local$/,
  /\.internal$/,
  // Any IPv6 literal ([::1], [fd00::...], …) — blocked wholesale for MVP.
  /^\[/,
  /^::/
];

/** Validate scheme/port/hostname; returns the parsed URL. Throws 422 on any failure. */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceAdapterError("That is not a valid URL.", 422, "URL_INVALID");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SourceAdapterError(
      "Only http(s) pages can be imported.",
      422,
      "URL_UNSUPPORTED_SCHEME"
    );
  }

  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new SourceAdapterError(
      "Only standard web ports (80/443) are allowed.",
      422,
      "URL_BLOCKED_PORT"
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname || BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname))) {
    throw new SourceAdapterError(
      "This address points to a private or internal network and cannot be imported.",
      422,
      "URL_PRIVATE_ADDRESS"
    );
  }

  return url;
}

/* ------------------------------- html → text ------------------------------ */

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    copy: "©",
    reg: "®",
    trade: "™"
  };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

/**
 * Naive regex-based HTML → text: drop script/style/noscript/comments, turn
 * block-element boundaries into newlines, strip remaining tags, decode common
 * entities, collapse whitespace. Deliberately dependency-free.
 */
export function htmlToText(html: string): string {
  const withoutHidden = html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<template[\s\S]*?<\/template\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s\S]*?<\/head\s*>/gi, " ");

  const withBreaks = withoutHidden
    .replace(/<(?:br|hr)\s*\/?\s*>/gi, "\n")
    .replace(
      /<\/?(?:p|div|section|article|main|aside|nav|li|ul|ol|dl|dt|dd|tr|table|thead|tbody|h[1-6]|header|footer|blockquote|pre|figure|figcaption|form|fieldset)\b[^>]*>/gi,
      "\n"
    )
    .replace(/<\/(?:td|th)\s*>/gi, " \n")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(withBreaks)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractHtmlTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!match) return "";
  return decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim();
}

/* --------------------------------- fetching -------------------------------- */

async function readBodyWithCap(res: Response, cap: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > cap) {
    throw new SourceAdapterError("The page is larger than the 2 MB limit.", 413, "URL_TOO_LARGE");
  }

  const body = res.body as unknown as AsyncIterable<Uint8Array> | null;
  if (!body) {
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > cap) {
      throw new SourceAdapterError("The page is larger than the 2 MB limit.", 413, "URL_TOO_LARGE");
    }
    return buffer;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > cap) {
      throw new SourceAdapterError("The page is larger than the 2 MB limit.", 413, "URL_TOO_LARGE");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Manual redirect follow — every hop goes back through assertSafeUrl. */
async function fetchWithGuards(url: URL, signal: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current.toString(), {
      signal,
      redirect: "manual",
      headers: {
        "user-agent": "TrivenKnowledgeBot/1.0 (+https://triven.ai)",
        accept: "text/html, text/plain;q=0.9"
      }
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new SourceAdapterError(
          "The page redirected without a destination.",
          502,
          "URL_REDIRECT_INVALID"
        );
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new SourceAdapterError(
          "The page redirected to an invalid address.",
          502,
          "URL_REDIRECT_INVALID"
        );
      }
      current = assertSafeUrl(next.toString());
      continue;
    }

    return res;
  }
  throw new SourceAdapterError("The page redirected too many times.", 502, "URL_TOO_MANY_REDIRECTS");
}

export const urlSourceAdapter: SourceAdapter<{ url: string }> = {
  sourceType: "URL",

  async fetchContent(input) {
    const parsed = assertSafeUrl(input.url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetchWithGuards(parsed, controller.signal);
      if (!res.ok) {
        throw new SourceAdapterError(
          `The page could not be fetched (HTTP ${res.status}).`,
          502,
          "URL_FETCH_FAILED"
        );
      }

      const contentType = (res.headers.get("content-type") ?? "")
        .toLowerCase()
        .split(";")[0]
        .trim();
      const isHtml = contentType === "text/html" || contentType === "application/xhtml+xml";
      if (!isHtml && contentType !== "text/plain") {
        throw new SourceAdapterError(
          "Only HTML and plain-text pages can be imported.",
          415,
          "URL_UNSUPPORTED_CONTENT_TYPE"
        );
      }

      const bytes = await readBodyWithCap(res, MAX_URL_CONTENT_BYTES);
      const raw = bytes.toString("utf8");
      const text = isHtml ? htmlToText(raw) : raw;

      const title = isHtml ? extractHtmlTitle(raw) : "";
      const fallbackName = `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
      const filename = `${sanitizeFilename((title || fallbackName).replace(/[\\/]+/g, "-")).slice(0, 100)}.txt`;

      return {
        filename,
        mimeType: "text/plain",
        text,
        sizeBytes: bytes.byteLength
      };
    } catch (error) {
      if (error instanceof SourceAdapterError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SourceAdapterError(
          "The page took too long to load (10 second limit).",
          502,
          "URL_FETCH_TIMEOUT"
        );
      }
      throw new SourceAdapterError("The page could not be fetched.", 502, "URL_FETCH_FAILED");
    } finally {
      clearTimeout(timer);
    }
  }
};
