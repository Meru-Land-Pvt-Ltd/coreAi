/**
 * Prompt Compiler & Sanitizer Pipeline
 *
 * Cleans, sanitizes, and deduplicates custom instructions entered in setup.
 * Prevents raw user inputs from conflicting with base engine rules (greetings, booking validation, caller ID verification).
 */

/** Patterns that duplicate built-in system prompt engine capabilities and rules. */
const REDUNDANT_BUILTIN_PATTERNS = [
  /always greet by business name/i,
  /greet caller by business name/i,
  /ask for (the )?full name (before|when|during) booking/i,
  /collect (the )?full name (before|when|during) booking/i,
  /confirm date and time before booking/i,
  /confirm (the )?date (and|&) time/i,
  /check (calendar|availability) before (naming|offering|booking)/i,
  /sound (like a real human|natural|friendly)/i,
  /keep (replies|responses) short/i,
  /do not say (you are|as) an ai/i
];

export function compileCustomInstructions(rawInstructions?: string | null): string {
  if (!rawInstructions || typeof rawInstructions !== "string") return "";

  const trimmed = rawInstructions.trim();
  if (!trimmed) return "";

  // Split into lines/bullets
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s\-*•\d+.]+/, "").trim())
    .filter((line) => line.length > 0);

  const compiledLines: string[] = [];

  for (const line of lines) {
    // Check if line duplicates built-in core rules
    const isRedundant = REDUNDANT_BUILTIN_PATTERNS.some((pattern) => pattern.test(line));
    if (isRedundant) {
      continue; // Filter out direct duplicate commands
    }

    compiledLines.push(`- ${line}`);
  }

  if (compiledLines.length === 0) return "";

  return compiledLines.join("\n");
}
