/**
 * Finds renderable UI in a node's output so the Test panel can show a live
 * preview instead of a wall of escaped markup.
 *
 * Handles the three shapes a step actually produces:
 *   - a Code node returning an HTML string, or { html, css, js }
 *   - an AI Brain returning markdown with a ```html fence
 *   - either returning a bare SVG
 */

export type UiPreviewSource = {
  /** Complete document ready for an iframe srcDoc. */
  document: string;
  /** The author's own source, shown in the Code tab. */
  code: string;
  language: "html" | "svg";
  /** Where it came from, e.g. "html + css" — shown as a chip. */
  origin: string;
};

/** Enough markup to be worth rendering — avoids previewing "<3 stars". */
const HTML_MARKUP = /<(!doctype\s+html|html|head|body|main|section|article|header|footer|nav|div|table|form|h[1-6]|p|ul|ol|img|button|canvas)\b/i;
const SVG_MARKUP = /<svg[\s>]/i;

/** ```html … ``` / ```svg … ``` fences, the way an LLM returns a page. */
const FENCE = /```(html|svg|xml)?\s*\n([\s\S]*?)```/gi;

const MAX_SOURCE_LENGTH = 500_000;

function isFullDocument(html: string): boolean {
  return /<!doctype\s+html|<html[\s>]/i.test(html);
}

/**
 * Wraps a fragment in a minimal page. `margin: 0` and a system font stop the
 * preview from inheriting nothing at all and looking broken; anything the
 * author styles themselves wins, since their CSS comes after.
 */
function buildDocument(html: string, css?: string, js?: string): string {
  if (isFullDocument(html) && !css && !js) return html;

  const head = [
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<style>*,*::before,*::after{box-sizing:border-box}body{margin:0;padding:16px;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;background:#fff}</style>",
    css ? `<style>\n${css}\n</style>` : ""
  ]
    .filter(Boolean)
    .join("\n");

  // A full document with extra css/js: inject rather than nest a second <html>.
  if (isFullDocument(html)) {
    const extras = [css ? `<style>\n${css}\n</style>` : "", js ? `<script>\n${js}\n</script>` : ""]
      .filter(Boolean)
      .join("\n");
    return html.includes("</body>")
      ? html.replace("</body>", `${extras}\n</body>`)
      : `${html}\n${extras}`;
  }

  return `<!doctype html>
<html>
<head>
${head}
</head>
<body>
${html}
${js ? `<script>\n${js}\n</script>` : ""}
</body>
</html>`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Pulls the first html/svg fenced block, or an unlabelled fence holding markup. */
function extractFencedMarkup(text: string): string | null {
  FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FENCE.exec(text)) !== null) {
    const [, language, body = ""] = match;
    const labelled = language && /^(html|svg|xml)$/i.test(language);
    if (labelled || HTML_MARKUP.test(body) || SVG_MARKUP.test(body)) {
      return body.trim();
    }
  }

  return null;
}

function classify(markup: string): "html" | "svg" | null {
  if (HTML_MARKUP.test(markup)) return "html";
  if (SVG_MARKUP.test(markup)) return "svg";
  return null;
}

/** Object outputs: the conventional field names a generator uses. */
const HTML_KEYS = ["html", "markup", "page", "document", "body", "svg", "code", "output", "content", "text"];
const CSS_KEYS = ["css", "styles", "style", "stylesheet"];
const JS_KEYS = ["js", "javascript", "script", "scripts"];

function pick(record: Record<string, unknown>, keys: string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value.trim()) return { key, value };
  }
  return null;
}

/**
 * True when a formatted output field is really the markup now shown in the
 * preview — the Test panel drops those rows so a whole page is not also dumped
 * into a summary card as one unreadable line.
 */
export function isMarkupField(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 120 && (HTML_MARKUP.test(trimmed) || SVG_MARKUP.test(trimmed));
}

export function detectUiPreview(value: unknown, depth = 0): UiPreviewSource | null {
  if (depth > 3) return null;

  if (typeof value === "string") {
    if (value.length > MAX_SOURCE_LENGTH) return null;

    const fenced = extractFencedMarkup(value);
    const markup = fenced ?? value.trim();
    const language = classify(markup);
    if (!language) return null;

    return {
      document: buildDocument(markup),
      code: markup,
      language,
      origin: fenced ? "code block" : language
    };
  }

  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = detectUiPreview(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  const html = pick(record, HTML_KEYS);
  const css = pick(record, CSS_KEYS);
  const js = pick(record, JS_KEYS);

  if (html) {
    const fenced = extractFencedMarkup(html.value);
    const markup = fenced ?? html.value.trim();
    const language = classify(markup);

    if (language) {
      const parts = [html.key, css?.key, js?.key].filter(Boolean) as string[];
      return {
        document: buildDocument(markup, css?.value, js?.value),
        // The Code tab shows every part, not just the markup, so the architect
        // can see the styles that produced what they are looking at.
        code: [markup, css ? `/* ${css.key} */\n${css.value}` : "", js ? `// ${js.key}\n${js.value}` : ""]
          .filter(Boolean)
          .join("\n\n"),
        language,
        origin: parts.join(" + ")
      };
    }
  }

  // Nested one level, e.g. { value: { html } } from a wrapped node output.
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const found = detectUiPreview(nested, depth + 1);
      if (found) return found;
    }
  }

  return null;
}
