export type TranscriptSegment = {
  role: "assistant" | "user" | "unknown";
  text: string;
};

const ASSISTANT_MARKER = /^(ai|assistant|bot|agent)\s*:\s*/i;
const USER_MARKER = /^(user|caller|customer|human)\s*:\s*/i;

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

function segmentNamesBusiness(text: string, business: string): boolean {
  if (!business) return false;
  if (text.includes(business)) return true;

  const squash = (value: string) => value.replace(/\s+/g, "");
  return squash(text).includes(squash(business));
}

const DISCLOSURE_ELEMENTS: Array<{
  label: string;
  spoken: string;
  test: (text: string) => boolean;
}> = [
  {
    label: "the offer to receive transactional text messages about this booking",
    spoken: "these would be transactional text messages about this booking",
    test: (text) => /transactional text/.test(text)
  },
  {
    label: '"Message frequency varies."',
    spoken: "message frequency varies",
    test: (text) => /message frequency varies/.test(text)
  },
  {
    label: '"Message and data rates may apply."',
    spoken: "message and data rates may apply",
    test: (text) => /data rates may apply/.test(text)
  },
  {
    label: '"Reply STOP to opt out"',
    spoken: "reply STOP to opt out",
    test: (text) => /\bstop\b/.test(text) && /opt out/.test(text)
  },
  {
    label: '"or HELP for help."',
    spoken: "or HELP for help",
    test: (text) => /for help/.test(text)
  },
  {
    label: '"Consent is not required to complete the booking or service request."',
    spoken: "and consent is not required to complete the booking",
    test: (text) => /not required to complete|not a condition/.test(text)
  },
  {
    label: '"Please say yes or no."',
    spoken: "so is that a yes or no",
    test: (text) => /yes or no/.test(text)
  }
];

export function remainingDisclosureLine(missing: string[]): string {
  const parts = DISCLOSURE_ELEMENTS.filter((element) => missing.includes(element.label)).map(
    (element) => element.spoken
  );
  if (parts.length === 0) return "";

  const ask = DISCLOSURE_ELEMENTS[DISCLOSURE_ELEMENTS.length - 1].spoken;
  const hasAsk = parts[parts.length - 1] === ask;
  const terms = hasAsk ? parts.slice(0, -1) : parts;
  const sentence = terms.length > 0 ? `Just so you know — ${terms.join(", ")}.` : "";

  return [sentence, hasAsk ? `${ask[0].toUpperCase()}${ask.slice(1)}?` : ""]
    .filter(Boolean)
    .join(" ");
}

function segmentOpensDisclosure(text: string, business: string): boolean {
  return segmentNamesBusiness(text, business) && DISCLOSURE_ELEMENTS[0].test(text);
}

export type SmsDisclosureState =
  | "ANSWERED"
  | "AWAITING_ANSWER"
  | "INTERRUPTED"
  | "NOT_PRESENTED";

export type SmsDisclosureProgress = {
  state: SmsDisclosureState;
  missing: string[];
  remainingLine?: string;
};

export function segmentsSmsDisclosureProgress(
  segments: TranscriptSegment[],
  businessName: string
): SmsDisclosureProgress {
  if (!businessName.trim()) return { state: "NOT_PRESENTED", missing: [] };
  const business = normalize(businessName);

  let started = false;
  let spoken = "";
  let completedAt = -1;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.role !== "assistant") continue;
    const text = normalize(segment.text);

    if (!started) {
      if (!segmentOpensDisclosure(text, business)) continue;
      started = true;
      spoken = text;
    } else {
      spoken = `${spoken} ${text}`;
    }

    if (completedAt < 0 && DISCLOSURE_ELEMENTS.every((element) => element.test(spoken))) {
      completedAt = index;
    }
  }

  if (!started) return { state: "NOT_PRESENTED", missing: [] };
  if (completedAt < 0) {
    const missing = DISCLOSURE_ELEMENTS.filter((element) => !element.test(spoken)).map((e) => e.label);
    return { state: "INTERRUPTED", missing, remainingLine: remainingDisclosureLine(missing) };
  }

  const answered = segments.slice(completedAt + 1).some((later) => later.role === "user");
  return { state: answered ? "ANSWERED" : "AWAITING_ANSWER", missing: [] };
}

export function segmentsSmsDisclosureState(
  segments: TranscriptSegment[],
  businessName: string
): SmsDisclosureState {
  return segmentsSmsDisclosureProgress(segments, businessName).state;
}

export function transcriptSmsDisclosureProgress(
  transcript: string,
  businessName: string
): SmsDisclosureProgress {
  if (!transcript.trim() || !businessName.trim()) return { state: "NOT_PRESENTED", missing: [] };
  return segmentsSmsDisclosureProgress(parseTranscriptSegments(transcript), businessName);
}

export function transcriptSmsDisclosureState(
  transcript: string,
  businessName: string
): SmsDisclosureState {
  return transcriptSmsDisclosureProgress(transcript, businessName).state;
}

export function transcriptShowsCompleteSmsDisclosure(
  transcript: string,
  businessName: string
): boolean {
  return transcriptSmsDisclosureState(transcript, businessName) === "ANSWERED";
}
