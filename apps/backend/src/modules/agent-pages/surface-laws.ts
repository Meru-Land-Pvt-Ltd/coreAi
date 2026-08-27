/**
 * THE SURFACE LAWS — what a customer's screen may never say.
 *
 * The frontend wing of the Examination Hall (the founder's ruling,
 * 2026-08-27). The generation gate already enforces the CONTRACT — every ask
 * placed, the architect's controls kept, internal fields hidden. What it
 * never checked was the LANGUAGE: a generated page could legally say
 * "Enter the webhook trigger config" and pass. A paying customer meeting a
 * platform word doesn't complain; he leaves.
 *
 * Mechanical and deterministic, like every marker in the Hall: no AI grades
 * the AI.
 */

/** The keys whose values a customer actually reads on the screen. */
const VISIBLE_KEYS = new Set([
  "label",
  "text",
  "title",
  "subtitle",
  "headline",
  "placeholder",
  "helper",
  "helperText",
  "description",
  "welcomeMessage",
  "buttonLabel",
  "emptyText",
  "prompt",
  "brand"
]);

/**
 * Platform vocabulary. A customer's screen speaks the customer's world;
 * these words belong to ours. Word-boundary matched, case-insensitive.
 */
const PLATFORM_WORDS = [
  "workflow",
  "orchestration",
  "node",
  "trigger",
  "webhook",
  "llm",
  "config",
  "api key",
  "payload",
  "endpoint",
  "prompt box"
];

const PLATFORM_PATTERN = new RegExp(`\\b(${PLATFORM_WORDS.join("|").replace(/ /g, "\\s")})s?\\b`, "i");

export type SurfaceViolation = { where: string; text: string; word: string };

/**
 * Every visible string in a generated spec, checked against the customer's
 * language. `{{...}}` braces are also forbidden on a screen — a leaked token
 * is machinery showing through the paint.
 */
export function surfaceLanguageViolations(spec: unknown): SurfaceViolation[] {
  const violations: SurfaceViolation[] = [];

  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (typeof child === "string" && VISIBLE_KEYS.has(key)) {
          const match = PLATFORM_PATTERN.exec(child);
          if (match) {
            violations.push({ where: `${path}.${key}`, text: child.slice(0, 80), word: match[1]!.toLowerCase() });
          }
          if (child.includes("{{")) {
            violations.push({ where: `${path}.${key}`, text: child.slice(0, 80), word: "{{…}} token" });
          }
        } else {
          walk(child, `${path}.${key}`);
        }
      }
    }
  };

  walk(spec, "spec");
  return violations;
}

/** The violations, written as orders the generation loop feeds back. */
export function surfaceLanguageProblems(spec: unknown): string[] {
  return surfaceLanguageViolations(spec).map(
    (violation) =>
      `A customer would read "${violation.text}" (${violation.where}) — but "${violation.word}" is our word, not theirs. Say it in the customer's world.`
  );
}
