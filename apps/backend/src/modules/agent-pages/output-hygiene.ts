/**
 * Last-exit hygiene for customer-facing AI text.
 *
 * Resolving {{template.tokens}} is the engine's job while a run executes —
 * this module never resolves anything. It is the safety net at the final
 * exits (agent-page chat/run, builder preview) that keeps an UNRESOLVED
 * token from ever reaching a customer as literal "{{business.name}}".
 *
 * Conservative by design: only identifier-shaped tokens are stripped —
 * {{business.name}}, {{business_name}}, {{ memory }}. Anything else between
 * braces (code samples, JSON, "{{ x + 1 }}", "{a}") is content, not a token,
 * and is left byte-for-byte untouched. Tokens inside inline `code spans` and
 * fenced code blocks are shown code — deliberate content, never a leak — and
 * are preserved too. Lines without a token are never modified at all.
 */

/** Identifier-shaped tokens only: {{word}} / {{word.word}} / {{ word.word }}. */
const TOKEN_SOURCE = String.raw`\{\{\s*[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\s*\}\}`;

const HAS_TOKEN = new RegExp(TOKEN_SOURCE);
/** The token plus the inline spaces before it, so removal never doubles spaces. */
const TOKEN_WITH_LEADING_SPACES = new RegExp(String.raw`[ \t]*${TOKEN_SOURCE}`, "g");
const LINE_STARTS_WITH_TOKEN = new RegExp(String.raw`^[ \t]*${TOKEN_SOURCE}`);

/** A line with no letters or digits left — only connective punctuation/symbols. */
const EMPTY_PUNCTUATION_LINE = /^[^\p{L}\p{N}]*$/u;

/** A fenced-code delimiter line (``` or ~~~) — fences toggle a no-touch zone. */
const FENCE_LINE = /^\s*(?:```|~~~)/;

/** A complete inline code span — its contents are shown code, never a leak. */
const INLINE_CODE_SPAN = /(`[^`\n]*`)/;

function stripTokensFromLine(line: string): string {
  const startedWithToken = LINE_STARTS_WITH_TOKEN.test(line);

  // Backtick code spans are content the customer is meant to read — tokens
  // inside them are being TAUGHT, not leaked. Strip only outside the spans.
  let cleaned = line
    .split(INLINE_CODE_SPAN)
    .map((segment) =>
      segment.startsWith("`") && segment.endsWith("`") && segment.length > 1
        ? segment
        : segment.replace(TOKEN_WITH_LEADING_SPACES, "")
    )
    .join("");

  // Removing a leading token can leave the rest of the line indented by the
  // space that followed the token; other lines keep their indentation.
  if (startedWithToken) cleaned = cleaned.replace(/^[ \t]+/, "");

  cleaned = cleaned.replace(/[ \t]+$/, "");

  // A line that was only punctuation around the token ("— {{business.name}}")
  // carried no content of its own — blank it rather than shipping a stray dash.
  return EMPTY_PUNCTUATION_LINE.test(cleaned) ? "" : cleaned;
}

/**
 * Strip leaked template artifacts from a customer-facing string:
 * remove unresolved {{...}} tokens (identifier shapes only), blank lines the
 * removal reduces to bare punctuation, and trim trailing whitespace.
 * Content outside token patterns is never rewritten.
 */
export function sanitizeCustomerText(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;

  let result = text;

  if (result.includes("{{") && HAS_TOKEN.test(result)) {
    // Fenced code blocks (``` / ~~~) are shown code — a token inside one is
    // deliberate content, so the whole fence is a no-touch zone.
    let insideFence = false;
    result = result
      .split("\n")
      .map((line) => {
        if (FENCE_LINE.test(line)) {
          insideFence = !insideFence;
          return line;
        }
        if (insideFence || !HAS_TOKEN.test(line)) return line;
        return stripTokensFromLine(line);
      })
      .join("\n");
  }

  return result.replace(/\s+$/, "");
}
