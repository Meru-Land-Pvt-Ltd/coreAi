import type { ProductSpec, SpecNode } from "@coreai/shared";
import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import type { AIExecuteRequest } from "../ai-provider-engine/types";

/**
 * The Smart Designer's eyes — step one.
 *
 * The founder caught the designer saying "done" three times while the screen
 * had not changed. The cause: one blind pass — it rewrites the plan and never
 * looks at what it wrote. This module is the look: after every change, a
 * second, separate call is shown the architect's ask and the page skeleton
 * BEFORE and AFTER, and must answer "did it really happen?". A "no" comes
 * back with what is missing, so the designer can correct itself and — above
 * all — never again claim a change it did not make.
 *
 * Step two (real screenshots into a vision model) needs a browser inside the
 * backend image; this step needs nothing new and kills the lying today. The
 * skeleton is what the renderer draws — order, nesting, labels, styles — so
 * order/count/wording claims are all checkable from it.
 */

export type EyesVerdict = {
  /** True when the AFTER skeleton really shows the asked-for change. */
  satisfied: boolean;
  /** Plain words on what is still wrong — fed back to the designer verbatim. */
  problems: string[];
};

/** Verdicts must be tiny and fast — a look is not a second design pass. */
const EYES_MAX_TOKENS = 500;

/**
 * The page as the renderer will draw it, one line per element:
 * indentation = nesting, order = order on screen. Small enough to read
 * whole, faithful enough that "above", "one box", "no background", "wider"
 * are all visible in it.
 */
export function layoutSkeleton(spec: ProductSpec): string {
  const lines: string[] = [];
  const walk = (nodes: SpecNode[], depth: number) => {
    for (const node of nodes) {
      const record = node as unknown as Record<string, unknown>;
      const bits: string[] = [node.type];
      for (const key of ["label", "text", "variant", "kind", "level", "size", "padding", "background", "gap", "align"]) {
        const value = record[key];
        if (typeof value === "string" && value) bits.push(`${key}=${truncate(value)}`);
        if (typeof value === "number") bits.push(`${key}=${value}`);
      }
      const wire = record.wire as { role?: string } | undefined;
      if (wire?.role) bits.push(`wired=${wire.role}`);
      lines.push(`${"  ".repeat(depth)}${bits.join(" ")}`);
      const children = record.children;
      if (Array.isArray(children)) walk(children as SpecNode[], depth + 1);
    }
  };
  for (const page of spec.pages) {
    lines.push(`page "${page.title}"`);
    walk(page.blocks, 1);
  }
  return lines.join("\n");
}

function truncate(value: string): string {
  return value.length > 40 ? `${value.slice(0, 37)}…` : value;
}

/**
 * Look at the change. Never throws — if the look itself fails, the designer
 * proceeds as before (blind is the old behaviour, not a new failure), but it
 * must NOT claim the check happened.
 */
export async function verifyDesignChange(args: {
  brain: { providerId: string; model?: string };
  instruction: string;
  before: ProductSpec;
  after: ProductSpec;
  workflowId: string;
}): Promise<EyesVerdict | null> {
  const prompt = [
    "You are the quality checker for a page-design change. Be strict and literal.",
    "",
    `THE ARCHITECT ASKED: "${args.instruction}"`,
    "",
    "THE PAGE BEFORE (order = order on screen, indentation = nesting):",
    layoutSkeleton(args.before),
    "",
    "THE PAGE AFTER:",
    layoutSkeleton(args.after),
    "",
    'Answer ONLY this JSON: { "satisfied": boolean, "problems": string[] }.',
    "satisfied is true ONLY if the AFTER skeleton clearly shows what was asked.",
    "If anything asked-for is missing, unchanged, or only half done, satisfied is false and each problem is one short plain sentence naming exactly what is still wrong (e.g. \"the result still sits below the input\").",
    "Judge only what was asked — unrelated imperfections are not problems."
  ].join("\n");

  const request: AIExecuteRequest = {
    capability: "llm",
    messages: [{ role: "user", content: prompt }],
    // A checker must be cold: no creativity, just comparison.
    temperature: 0,
    maxTokens: EYES_MAX_TOKENS,
    outputFormat: "json",
    task: "smart-designer-eyes",
    ...(args.brain.model ? { model: args.brain.model } : {})
  };

  try {
    const response = await getProviderEngine().executeWithProvider(args.brain.providerId, request);
    if (response.status !== "success") return null;

    const raw =
      response.structuredOutput && typeof response.structuredOutput === "object"
        ? (response.structuredOutput as Record<string, unknown>)
        : parseJson(response.text);
    // Anything without a real yes/no is "could not check", never a verdict —
    // a design JSON echoed back here must not read as "not satisfied".
    if (!raw || typeof raw.satisfied !== "boolean") return null;

    const problems = Array.isArray(raw.problems)
      ? raw.problems.filter((p): p is string => typeof p === "string").slice(0, 5)
      : [];
    if (!raw.satisfied && problems.length === 0) return null;
    return { satisfied: raw.satisfied, problems };
  } catch (error) {
    console.warn("[designer-eyes] look failed — proceeding unchecked", {
      workflowId: args.workflowId,
      message: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

function parseJson(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
