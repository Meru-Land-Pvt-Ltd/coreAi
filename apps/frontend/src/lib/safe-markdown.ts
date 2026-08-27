import { marked } from "marked";

/**
 * MARKDOWN FROM SOMEBODY WE DO NOT TRUST.
 *
 * The builder's test panel renders what came back from a run: a model's
 * answer, a text message, and — the dangerous one — the body of an email the
 * agent just read. Anyone in the world can send an email. That body was being
 * handed to a markdown parser and then written straight into the page as HTML,
 * so a stranger could put a script tag in an email, the architect could open
 * their own test panel, and the script would run as them, on our domain, with
 * their sign-in sitting in browser storage.
 *
 * Two things make that impossible here, and both matter:
 *
 *   1. Every character that could begin a tag is escaped BEFORE the markdown
 *      parser sees it. So no tag in the message survives — the only tags in
 *      the output are ones the parser itself wrote from markdown syntax.
 *      Formatting still works: **bold**, lists, and headings are punctuation,
 *      not tags.
 *
 *   2. Markdown can still write a link, and a link can carry a script in its
 *      address. So every address in the finished HTML must be one of the
 *      handful of kinds that only ever go somewhere — http, https, mailto — and
 *      anything else is dropped.
 *
 * Escaping alone is not enough, and the link check alone is not enough. Both.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/** Addresses that can only ever navigate. Everything else is dropped. */
const ADDRESS_IS_SAFE = /^(?:https?:\/\/|mailto:|tel:|#|\/(?!\/))/i;

function stripUnsafeAddresses(html: string): string {
  return html.replace(/\s(href|src)\s*=\s*"([^"]*)"/gi, (whole, attribute: string, address: string) => {
    /* The parser writes its own attributes, so the value here is already
       entity-encoded. Decode the few that could hide a scheme before judging
       it — "java&#115;cript:" must not slip through as unrecognised. */
    const decoded = address
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, "")
      .trim();

    return ADDRESS_IS_SAFE.test(decoded) ? whole : ` ${attribute}="#"`;
  });
}

/**
 * Turn untrusted text into HTML that is safe to put on the page.
 *
 * Anything that is not a string comes back empty rather than stringified: a
 * surprise object should show nothing, never "[object Object]".
 */
export function safeMarkdownHtml(content: unknown): string {
  if (typeof content !== "string" || content.length === 0) return "";
  const parsed = marked.parse(escapeHtml(content), { breaks: true, gfm: true }) as string;
  return stripUnsafeAddresses(parsed);
}
