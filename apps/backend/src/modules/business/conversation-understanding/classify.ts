/**
 * Deterministic outcome + sentiment classification from call artifacts.
 *
 * NO LLM here on purpose: this layer is cheap, offline-safe and auditable.
 * An LLM pass can be layered on top later — it should only ever RAISE
 * confidence or refine a text-heuristic result, never silently contradict a
 * fact-based (flag-derived) classification.
 *
 * Confidence contract:
 *   0.9      — fact-based (tool-call flags, ended reason, duration)
 *   0.5-0.6  — transcript/summary keyword heuristics
 *   0.2      — UNKNOWN (nothing matched / no data)
 */

export const CALL_OUTCOMES = [
  "BOOKED",
  "RESCHEDULED",
  "CANCELLED",
  "LEAD",
  "FOLLOW_UP",
  "NO_INTEREST",
  "MISSED",
  "TRANSFERRED",
  "SUPPORT_RESOLVED",
  "UNKNOWN"
] as const;

export const CALL_SENTIMENTS = [
  "POSITIVE",
  "NEUTRAL",
  "CONFUSED",
  "FRUSTRATED",
  "ANGRY",
  "UNKNOWN"
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export type CallSentiment = (typeof CALL_SENTIMENTS)[number];

export interface CallOutcomeInput {
  transcript?: string | null;
  summary?: string | null;
  hadBookedAppointment: boolean;
  hadReschedule: boolean;
  hadCancellation: boolean;
  hadTransfer: boolean;
  transferConnected: boolean;
  leadCaptured: boolean;
  endedReason?: string | null;
  durationSeconds?: number | null;
}

export interface SentimentInput {
  transcript?: string | null;
  summary?: string | null;
}

const MISSED_MAX_DURATION_SECONDS = 8;

/** Vapi-style ended reasons that mean the caller never really engaged. */
const MISSED_ENDED_REASON_RE =
  /no[-_ ]?answer|did[-_ ]?not[-_ ]?answer|busy|voicemail|silence[-_ ]?timed[-_ ]?out/i;

const NO_INTEREST_RE =
  /\bnot interested\b|\bno interest\b|\bstop calling\b|\bdo not call\b|\bdon't call\b|\btake (?:me|us) off\b|\bremove (?:me|us) from\b|\bnot looking for\b/;

const FOLLOW_UP_RE =
  /\bfollow[- ]?up\b|\bfollowing up\b|\bcall (?:you|me|us|them) back\b|\bget back to (?:you|me|us)\b|\bcallback\b|\breach out (?:to (?:you|me|us) )?(?:later|tomorrow|soon|next)\b|\bwill (?:call|contact) (?:you|me|us) (?:later|tomorrow|soon|shortly)\b/;

const SUPPORT_RESOLVED_RE =
  /\bthanks\b|\bthank you\b|\bthat's all\b|\banswered\b|\bthat helps\b|\bgot it\b|\bthat's everything\b/;

const ANGRY_RE =
  /\bangry\b|\bfurious\b|\bunacceptable\b|\bcomplaint\b|\boutrage|\blivid\b|\byell(?:ed|ing)?\b|\bworst\b|\bterrible service\b|\breport you\b/;

const FRUSTRATED_RE =
  /\bfrustrat|\bannoy|\bthird time\b|\bfed up\b|\bridiculous\b|\bagain and again\b|\bover and over\b|\bstill waiting\b/;

const CONFUSED_RE =
  /\bconfus|\bdon't understand\b|\bdoesn't make sense\b|\bnot sure what\b|\bwhat do you mean\b|\bi'm lost\b/;

const POSITIVE_RE =
  /\bgreat\b|\bthank you so much\b|\bperfect\b|\bwonderful\b|\bawesome\b|\bexcellent\b|\bamazing\b|\bvery helpful\b|\bfantastic\b/;

/** Lowercase + normalize curly apostrophes so keyword regexes stay simple. */
function normalizeText(transcript?: string | null, summary?: string | null): string {
  return [transcript, summary]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n")
    .toLowerCase()
    .replace(/[‘’]/g, "'");
}

export function classifyCallOutcome(input: CallOutcomeInput): {
  outcome: string;
  confidence: number;
} {
  // ---- Fact-based tier (0.9): tool-call flags beat any text heuristic. ----
  if (input.hadBookedAppointment) return { outcome: "BOOKED", confidence: 0.9 };
  if (input.hadReschedule) return { outcome: "RESCHEDULED", confidence: 0.9 };
  if (input.hadCancellation) return { outcome: "CANCELLED", confidence: 0.9 };
  // A transfer only counts once it actually connected — a failed transfer
  // attempt falls through to the weaker signals below.
  if (input.hadTransfer && input.transferConnected) {
    return { outcome: "TRANSFERRED", confidence: 0.9 };
  }
  if (input.leadCaptured) return { outcome: "LEAD", confidence: 0.9 };

  const durationSeconds =
    typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds)
      ? input.durationSeconds
      : null;
  const endedReason = input.endedReason ?? "";
  if (
    (durationSeconds !== null && durationSeconds < MISSED_MAX_DURATION_SECONDS) ||
    MISSED_ENDED_REASON_RE.test(endedReason)
  ) {
    return { outcome: "MISSED", confidence: 0.9 };
  }

  // ---- Text-heuristic tier (0.5-0.6). ----
  const text = normalizeText(input.transcript, input.summary);
  if (text.length > 0) {
    if (NO_INTEREST_RE.test(text)) return { outcome: "NO_INTEREST", confidence: 0.6 };
    // FOLLOW_UP before SUPPORT_RESOLVED: a promised follow-up IS a pending
    // action, so "thanks, we'll call you back" is not "resolved, no action".
    if (FOLLOW_UP_RE.test(text)) return { outcome: "FOLLOW_UP", confidence: 0.55 };
    if (SUPPORT_RESOLVED_RE.test(text)) return { outcome: "SUPPORT_RESOLVED", confidence: 0.5 };
  }

  return { outcome: "UNKNOWN", confidence: 0.2 };
}

export function classifySentiment(input: SentimentInput): {
  sentiment: string;
  confidence: number;
} {
  const text = normalizeText(input.transcript, input.summary);
  if (text.length === 0) return { sentiment: "UNKNOWN", confidence: 0.2 };

  // Negative signals win over positive ones: an angry caller who also says
  // "great" sarcastically must surface as ANGRY, not POSITIVE.
  if (ANGRY_RE.test(text)) return { sentiment: "ANGRY", confidence: 0.6 };
  if (FRUSTRATED_RE.test(text)) return { sentiment: "FRUSTRATED", confidence: 0.6 };
  if (CONFUSED_RE.test(text)) return { sentiment: "CONFUSED", confidence: 0.55 };
  if (POSITIVE_RE.test(text)) return { sentiment: "POSITIVE", confidence: 0.55 };

  return { sentiment: "NEUTRAL", confidence: 0.5 };
}
