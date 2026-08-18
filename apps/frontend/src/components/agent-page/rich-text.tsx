"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { marked, type Token, type Tokens } from "marked";

/**
 * RichText — safe markdown for AI answers on customer pages.
 *
 * Parses with marked's lexer (already a dependency) and maps the token tree
 * to React elements directly — never an HTML string, never
 * dangerouslySetInnerHTML — so model output can't inject markup: a literal
 * `<script>` in an answer renders as visible text. Anything the renderer
 * doesn't recognize degrades to plain text instead of disappearing.
 *
 * Optional `reveal` adds a word-by-word fade-in. The complete text is in the
 * DOM from the first frame (only opacity animates via per-word CSS
 * animation-delay), so:
 *   - layout never jumps — space is reserved naturally,
 *   - an aria-live region announces the reply once, complete,
 *   - prefers-reduced-motion shows everything instantly (CSS media query
 *     immediately; the matchMedia hook also drops the animation spans).
 *
 * User-typed content must NOT go through this component — customers' own
 * words render as plain text, only AI answers get markdown treatment.
 */

// ~330 words/min for short answers; long answers accelerate so the whole
// reveal always lands within REVEAL_MAX_TOTAL_MS + the per-word fade.
const REVEAL_BASE_MS_PER_WORD = 180;
const REVEAL_MAX_TOTAL_MS = 2800;
/** A code block fades in as one piece but "costs" a few word slots. */
const CODE_BLOCK_WORD_SLOTS = 3;

type RevealPlan = {
  /** May be fractional — delays are rounded where they're applied. */
  perWordMs: number;
  /** Mutable word cursor threaded through one render pass. */
  counter: { current: number };
};

function buildRevealPlan(text: string): RevealPlan {
  const totalWords = text.split(/\s+/).filter(Boolean).length || 1;
  const perWordMs = Math.min(REVEAL_BASE_MS_PER_WORD, REVEAL_MAX_TOTAL_MS / totalWords);
  return { perWordMs, counter: { current: 0 } };
}

function nextDelayMs(plan: RevealPlan, slots = 1): number {
  const delay = Math.round(plan.counter.current * plan.perWordMs);
  plan.counter.current += slots;
  return delay;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
  }, []);
  return reduced;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'"
};

/** marked marks some text tokens `escaped` — undo the entities it encoded. */
function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (match) => ENTITY_MAP[match] ?? match);
}

/**
 * Unmatched `**` never became bold — at a whitespace boundary it's a model
 * artifact, not content, so strip it there. Mid-word `**` with non-space on
 * BOTH sides (glob paths, exponents like `2**3`) is meaningful text and
 * passes through untouched.
 */
function stripStrayBoldMarkers(text: string): string {
  if (!text.includes("**")) return text;
  return text.replace(/(^|\s)\*{2,}/g, "$1").replace(/\*{2,}(?=\s|$)/g, "");
}

/**
 * Plain text, optionally wrapped word-by-word in reveal spans. Whitespace
 * stays as bare strings between spans so wrapping behaves exactly like
 * untouched text.
 */
function renderWords(content: string, plan: RevealPlan | null): ReactNode {
  if (!plan || content.length === 0) return content;
  return content.split(/(\s+)/).map((part, index) => {
    if (part.length === 0) return null;
    if (/^\s+$/.test(part)) return part;
    const delayMs = nextDelayMs(plan);
    return (
      <span
        key={index}
        className="agent-reveal-word"
        style={{ animationDelay: `${delayMs}ms` }}
      >
        {part}
      </span>
    );
  });
}

// ---------------------------------------------------------------------------
// Token → React element mapping
// ---------------------------------------------------------------------------

function textOf(token: Token): string {
  const raw = (token as { raw?: unknown }).raw;
  return typeof raw === "string" ? raw : "";
}

function renderInline(tokens: Token[], plan: RevealPlan | null): ReactNode[] {
  return tokens.map((token, index) => {
    switch (token.type) {
      case "text": {
        const text = token as Tokens.Text;
        if (text.tokens && text.tokens.length > 0) {
          return <span key={index}>{renderInline(text.tokens, plan)}</span>;
        }
        const content = text.escaped ? decodeEntities(text.text) : text.text;
        return <span key={index}>{renderWords(stripStrayBoldMarkers(content), plan)}</span>;
      }
      case "strong":
        return (
          <strong key={index} className="font-semibold">
            {renderInline((token as Tokens.Strong).tokens, plan)}
          </strong>
        );
      case "em":
        return (
          <em key={index} className="italic">
            {renderInline((token as Tokens.Em).tokens, plan)}
          </em>
        );
      case "del":
        return (
          <del key={index}>{renderInline((token as Tokens.Del).tokens, plan)}</del>
        );
      case "codespan": {
        const delayMs = plan ? nextDelayMs(plan) : 0;
        return (
          <code
            key={index}
            className={`rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.875em] text-slate-800 ${
              plan ? "agent-reveal-word" : ""
            }`}
            style={plan ? { animationDelay: `${delayMs}ms` } : undefined}
          >
            {(token as Tokens.Codespan).text}
          </code>
        );
      }
      case "br":
        return <br key={index} />;
      case "link": {
        const link = token as Tokens.Link;
        // Only plain web links become anchors — anything else (javascript:,
        // data:, …) degrades to its visible text.
        if (/^https?:\/\//i.test(link.href)) {
          return (
            <a
              key={index}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline decoration-slate-300 underline-offset-2 transition hover:decoration-current motion-reduce:transition-none"
            >
              {renderInline(link.tokens, plan)}
            </a>
          );
        }
        return <span key={index}>{renderInline(link.tokens, plan)}</span>;
      }
      case "escape":
        return <span key={index}>{renderWords((token as Tokens.Escape).text, plan)}</span>;
      case "html":
        // Raw markup renders as literal, visible text — React escapes it.
        return <span key={index}>{renderWords(textOf(token), plan)}</span>;
      default:
        // Unknown inline syntax degrades to its source text, never vanishes.
        return <span key={index}>{renderWords(textOf(token), plan)}</span>;
    }
  });
}

function renderListItem(item: Tokens.ListItem, plan: RevealPlan | null): ReactNode {
  return item.tokens.map((token, index) => {
    // Tight list items wrap their content in a block-level "text" token —
    // render it inline so bullets don't gain paragraph margins.
    if (token.type === "text") {
      const text = token as Tokens.Text;
      return (
        <span key={index}>
          {text.tokens && text.tokens.length > 0
            ? renderInline(text.tokens, plan)
            : renderWords(stripStrayBoldMarkers(text.text), plan)}
        </span>
      );
    }
    return <div key={index}>{renderBlocks([token], plan)}</div>;
  });
}

function renderBlocks(tokens: Token[], plan: RevealPlan | null): ReactNode[] {
  return tokens.map((token, index) => {
    switch (token.type) {
      case "space":
        return null;
      case "heading": {
        const heading = token as Tokens.Heading;
        const children = renderInline(heading.tokens, plan);
        // The page's own <h1>/<h2> outrank anything inside an answer —
        // answer headings start at h3 so the document outline stays honest.
        if (heading.depth === 1) {
          return (
            <h3 key={index} className="mb-1.5 mt-4 text-lg font-semibold text-slate-900 first:mt-0">
              {children}
            </h3>
          );
        }
        if (heading.depth === 2) {
          return (
            <h4 key={index} className="mb-1 mt-3.5 text-base font-semibold text-slate-900 first:mt-0">
              {children}
            </h4>
          );
        }
        return (
          <h5 key={index} className="mb-1 mt-3 text-[15px] font-semibold text-slate-900 first:mt-0">
            {children}
          </h5>
        );
      }
      case "paragraph":
        return (
          <p key={index} className="my-2 first:mt-0 last:mb-0">
            {renderInline((token as Tokens.Paragraph).tokens, plan)}
          </p>
        );
      case "list": {
        const list = token as Tokens.List;
        const items = list.items.map((item, itemIndex) => (
          <li key={itemIndex} className="pl-1">
            {renderListItem(item, plan)}
          </li>
        ));
        if (list.ordered) {
          return (
            <ol
              key={index}
              start={typeof list.start === "number" && list.start > 1 ? list.start : undefined}
              className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0"
            >
              {items}
            </ol>
          );
        }
        return (
          <ul key={index} className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">
            {items}
          </ul>
        );
      }
      case "code": {
        const delayMs = plan ? nextDelayMs(plan, CODE_BLOCK_WORD_SLOTS) : 0;
        return (
          <pre
            key={index}
            className={`my-2 overflow-x-auto rounded-xl bg-slate-100 p-3 first:mt-0 last:mb-0 ${
              plan ? "agent-reveal-word" : ""
            }`}
            style={plan ? { animationDelay: `${delayMs}ms` } : undefined}
          >
            <code className="font-mono text-[13px] leading-relaxed text-slate-800">
              {(token as Tokens.Code).text}
            </code>
          </pre>
        );
      }
      case "blockquote":
        return (
          <blockquote
            key={index}
            className="my-2 border-l-2 border-gray-200 pl-3 text-slate-600 first:mt-0 last:mb-0"
          >
            {renderBlocks((token as Tokens.Blockquote).tokens, plan)}
          </blockquote>
        );
      case "hr":
        return <hr key={index} className="my-3 border-gray-100" />;
      case "html":
        // Raw markup blocks (e.g. a pasted <script>) show as literal text.
        return (
          <p key={index} className="my-2 first:mt-0 last:mb-0">
            {renderWords(textOf(token), plan)}
          </p>
        );
      case "def":
        // Link definitions are metadata, not prose.
        return null;
      default:
        // Tables and future syntax degrade to their source text.
        return (
          <p key={index} className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">
            {renderWords(textOf(token), plan)}
          </p>
        );
    }
  });
}

function lexSafely(text: string): Token[] | null {
  try {
    return marked.lexer(text, { gfm: true, breaks: true });
  } catch {
    return null;
  }
}

export function RichText({
  text,
  reveal = false,
  className
}: {
  text: string;
  /** Word-by-word fade-in (CSS-only; instant under prefers-reduced-motion). */
  reveal?: boolean;
  className?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const tokens = useMemo(() => lexSafely(text), [text]);

  // A fresh plan every render pass — its word counter mutates while mapping.
  const plan = reveal && !reducedMotion ? buildRevealPlan(text) : null;
  const rootClass = `max-w-prose break-words leading-relaxed${className ? ` ${className}` : ""}`;

  if (tokens === null) {
    // The parser refused the input — show it verbatim rather than nothing.
    return (
      <div className={rootClass} data-testid="agent-rich-text">
        <p className="whitespace-pre-wrap">{text}</p>
      </div>
    );
  }

  return (
    <div className={rootClass} data-testid="agent-rich-text">
      {renderBlocks(tokens, plan)}
    </div>
  );
}
