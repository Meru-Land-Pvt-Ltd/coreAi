export type TranscriptSegment = {
  role: "assistant" | "user" | "unknown";
  text: string;
};

const ASSISTANT_MARKER = /^(ai|assistant|bot|agent)\s*:\s*/i;
const USER_MARKER = /^(user|caller|customer|human)\s*:\s*/i;

/** Split a Vapi running transcript into role segments (lines without a role marker continue the previous segment). */
export function parseTranscriptSegments(transcript: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  for (const rawLine of transcript.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (ASSISTANT_MARKER.test(line)) {
      segments.push({ role: "assistant", text: line.replace(ASSISTANT_MARKER, "") });
    } else if (USER_MARKER.test(line)) {
      segments.push({ role: "user", text: line.replace(USER_MARKER, "") });
    } else if (segments.length > 0) {
      const last = segments[segments.length - 1];
      last.text = `${last.text} ${line}`;
    } else {
      segments.push({ role: "unknown", text: line });
    }
  }

  return segments;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assistantSegmentContainsFullDisclosure(segmentText: string, businessName: string): boolean {
  const text = normalize(segmentText);
  const business = normalize(businessName);

  if (!business || !text.includes(business)) return false;
  if (!/transactional text/.test(text)) return false;
  if (!/message frequency varies/.test(text)) return false;
  if (!/data rates may apply/.test(text)) return false;
  if (!/\bstop\b/.test(text) || !/opt out/.test(text)) return false;
  if (!/\bhelp\b/.test(text)) return false;
  if (!/not required to complete|not a condition/.test(text)) return false;
  if (!/yes or no/.test(text)) return false;

  return true;
}

export type SmsDisclosureState = "ANSWERED" | "AWAITING_ANSWER" | "NOT_PRESENTED";

export function segmentsSmsDisclosureState(
  segments: TranscriptSegment[],
  businessName: string
): SmsDisclosureState {
  if (!businessName.trim()) return "NOT_PRESENTED";

  let presented = false;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.role !== "assistant") continue;
    if (!assistantSegmentContainsFullDisclosure(segment.text, businessName)) continue;

    presented = true;
    // The caller must have answered AFTER the disclosure was spoken.
    if (segments.slice(index + 1).some((later) => later.role === "user")) return "ANSWERED";
  }

  return presented ? "AWAITING_ANSWER" : "NOT_PRESENTED";
}

export function transcriptSmsDisclosureState(
  transcript: string,
  businessName: string
): SmsDisclosureState {
  if (!transcript.trim() || !businessName.trim()) return "NOT_PRESENTED";
  return segmentsSmsDisclosureState(parseTranscriptSegments(transcript), businessName);
}

export function transcriptShowsCompleteSmsDisclosure(
  transcript: string,
  businessName: string
): boolean {
  return transcriptSmsDisclosureState(transcript, businessName) === "ANSWERED";
}
