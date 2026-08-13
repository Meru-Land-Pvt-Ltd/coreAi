/**
 * Conversation quality rubric (plan Part 8). Pure module: dimension
 * definitions, the fairness constraint, and the scorability gate. No prisma,
 * no LLM — evaluate.ts owns those.
 */

export const RUBRIC_VERSION = "v1";

/**
 * Fairness constraint — the evaluation judges OUTCOMES, never speech style.
 * Callers (and human staff on MIXED calls) may have any accent or level of
 * English fluency; the score must reflect whether the caller's problem was
 * actually handled. The sentence below is included VERBATIM in every
 * evaluation prompt so the model is explicitly bound by it.
 */
export const FAIRNESS_CONSTRAINT =
  "Judge whether the problem was solved; NEVER penalize accent or non-native fluency.";

export type RubricDimension =
  | "greeting"
  | "accuracy"
  | "professionalism"
  | "empathy"
  | "sales_handling"
  | "rule_compliance"
  | "knowledge_usage"
  | "resolution"
  | "outcome_success"
  | "satisfaction_proxy";

/** Each dimension is scored 0-10. One-line definitions feed the prompt. */
export const RUBRIC_DIMENSIONS: Record<RubricDimension, string> = {
  greeting: "Opened promptly, identified the business, and set a helpful tone.",
  accuracy: "Information given (hours, services, prices, policies) was correct and never invented.",
  professionalism: "Stayed courteous, focused, and appropriate throughout the conversation.",
  empathy: "Acknowledged the caller's feelings and situation before pushing to process.",
  sales_handling: "Recognized buying interest and moved it forward (booking, follow-up) without being pushy.",
  rule_compliance: "Followed the business's configured rules, escalation policy, and compliance constraints.",
  knowledge_usage: "Used the business's knowledge base/context instead of guessing or deflecting.",
  resolution: "The caller's actual problem or request was handled to a concrete next step.",
  outcome_success: "The measurable outcome (booked, resolved, captured lead, correct transfer) was achieved.",
  satisfaction_proxy: "Signals in the caller's language suggest they ended the call satisfied.",
};

export const RUBRIC_DIMENSION_KEYS = Object.keys(RUBRIC_DIMENSIONS) as RubricDimension[];

/**
 * Minimum thresholds for a call to be scorable at all. Below these the
 * transcript carries too little signal for a fair score, so the call is
 * EXCLUDED from averages instead of being scored.
 */
export const MIN_SCORABLE = {
  durationSeconds: 20,
  transcriptChars: 200,
  customerTurns: 2,
  /** Unlabeled transcripts: estimate turns as floor(chars / charsPerTurn). */
  charsPerTurnHeuristic: 200,
} as const;

export type ScorableInput = {
  durationSeconds?: number | null;
  transcript?: string | null;
};

export type ScorableVerdict = { scorable: boolean; reason?: string };

/** Lines that look like the customer speaking in a labeled transcript. */
const CUSTOMER_LABEL_RE = /^\s*(?:user|customer|caller|human|patient|client)\s*[:\-]/i;
/** Any speaker label at line start — used to detect labeled transcripts. */
const ANY_LABEL_RE = /^\s*[A-Za-z][A-Za-z .'_-]{0,30}\s*:/;

/**
 * Count customer turns. Labeled transcripts count customer-labeled lines;
 * unlabeled ones fall back to the chars/200 heuristic.
 */
export function countCustomerTurns(transcript: string): number {
  const lines = transcript.split(/\r?\n/);
  const hasLabels = lines.some((line) => ANY_LABEL_RE.test(line));
  if (hasLabels) {
    return lines.filter((line) => CUSTOMER_LABEL_RE.test(line)).length;
  }
  return Math.floor(transcript.length / MIN_SCORABLE.charsPerTurnHeuristic);
}

export function isScorable(input: ScorableInput): ScorableVerdict {
  const transcript = (input.transcript ?? "").trim();
  if (!transcript) {
    return { scorable: false, reason: "NO_TRANSCRIPT" };
  }

  const duration = input.durationSeconds ?? 0;
  if (duration < MIN_SCORABLE.durationSeconds) {
    return { scorable: false, reason: "DURATION_TOO_SHORT" };
  }

  if (transcript.length < MIN_SCORABLE.transcriptChars) {
    return { scorable: false, reason: "TRANSCRIPT_TOO_SHORT" };
  }

  if (countCustomerTurns(transcript) < MIN_SCORABLE.customerTurns) {
    return { scorable: false, reason: "TOO_FEW_CUSTOMER_TURNS" };
  }

  return { scorable: true };
}
