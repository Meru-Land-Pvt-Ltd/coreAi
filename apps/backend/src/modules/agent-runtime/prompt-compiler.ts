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

const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;

function isPurelyRedundant(line: string): boolean {
  for (const pattern of REDUNDANT_BUILTIN_PATTERNS) {
    if (!pattern.test(line)) continue;
    const remainder = line.replace(pattern, " ").replace(/[\s.,;:!—–-]+/g, "");
    if (!remainder) return true;
  }
  return false;
}

export function compileCustomInstructions(rawInstructions?: string | null): string {
  if (!rawInstructions || typeof rawInstructions !== "string") return "";

  const trimmed = rawInstructions.trim();
  if (!trimmed) return "";

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(LIST_MARKER, "").trim())
    .filter((line) => line.length > 0);

  const compiledLines = lines.filter((line) => !isPurelyRedundant(line)).map((line) => `- ${line}`);

  if (compiledLines.length === 0) return "";

  return compiledLines.join("\n");
}
