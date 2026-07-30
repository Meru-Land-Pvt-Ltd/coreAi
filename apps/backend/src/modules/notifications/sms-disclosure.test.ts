import { describe, expect, it } from "vitest";
import {
  parseTranscriptSegments,
  segmentsSmsDisclosureState,
  transcriptShowsCompleteSmsDisclosure,
  transcriptSmsDisclosureProgress,
  transcriptSmsDisclosureState,
  type TranscriptSegment
} from "./sms-disclosure";

const BUSINESS = "Bright Smile Dental";

const FULL_DISCLOSURE =
  `Would you like to receive transactional text messages from ${BUSINESS} through Triven.ai ` +
  "about this appointment, booking, or service request, including confirmations, reminders, updates, " +
  "cancellations, and customer support messages? Message frequency varies. Message and data rates may apply. " +
  "Reply STOP to opt out or HELP for help. Consent is not required to complete the booking or service request. " +
  "Please say yes or no.";

describe("parseTranscriptSegments", () => {
  it("attributes segments by role and continues unmarked lines", () => {
    const segments = parseTranscriptSegments("AI: Hello there.\nsecond line\nUser: hi\nAI: Great.");
    expect(segments).toEqual([
      { role: "assistant", text: "Hello there. second line" },
      { role: "user", text: "hi" },
      { role: "assistant", text: "Great." }
    ]);
  });

  it("marks unattributed leading text as unknown (never assistant)", () => {
    expect(parseTranscriptSegments("some blob of text")[0].role).toBe("unknown");
  });
});

describe("transcriptShowsCompleteSmsDisclosure", () => {
  it("accepts a complete ASSISTANT disclosure followed by the caller's answer", () => {
    expect(
      transcriptShowsCompleteSmsDisclosure(`AI: ${FULL_DISCLOSURE}\nUser: yes please`, BUSINESS)
    ).toBe(true);
  });

  it("caller text can NEVER satisfy the gate — even repeating the full disclosure verbatim", () => {
    expect(
      transcriptShowsCompleteSmsDisclosure(`User: ${FULL_DISCLOSURE}\nUser: yes`, BUSINESS)
    ).toBe(false);
  });

  it("an unstructured combined transcript (no role markers) never qualifies", () => {
    expect(transcriptShowsCompleteSmsDisclosure(`${FULL_DISCLOSURE} yes`, BUSINESS)).toBe(false);
  });

  it("a PARTIAL assistant disclosure fails — every required element must be spoken", () => {
    const missingPieces = [
      // no business name
      FULL_DISCLOSURE.replace(BUSINESS, "our office"),
      // no frequency
      FULL_DISCLOSURE.replace("Message frequency varies.", ""),
      // no rates
      FULL_DISCLOSURE.replace("Message and data rates may apply.", ""),
      // no STOP
      FULL_DISCLOSURE.replace("Reply STOP to opt out or HELP for help.", "Reply HELP for help."),
      // no HELP
      FULL_DISCLOSURE.replace("or HELP for help", ""),
      // no not-required statement
      FULL_DISCLOSURE.replace("Consent is not required to complete the booking or service request.", ""),
      // no yes/no ask
      FULL_DISCLOSURE.replace("Please say yes or no.", "")
    ];
    for (const partial of missingPieces) {
      expect(transcriptShowsCompleteSmsDisclosure(`AI: ${partial}\nUser: yes`, BUSINESS)).toBe(false);
    }
  });

  it("the disclosure must PRECEDE a caller answer — no user turn after it fails closed", () => {
    expect(transcriptShowsCompleteSmsDisclosure(`User: hello\nAI: ${FULL_DISCLOSURE}`, BUSINESS)).toBe(false);
  });

  it("requires the IDENTIFIED business's name — another business's disclosure never qualifies", () => {
    expect(
      transcriptShowsCompleteSmsDisclosure(`AI: ${FULL_DISCLOSURE}\nUser: yes`, "Harbor Legal Group")
    ).toBe(false);
  });

  it("stale/unrelated assistant text with scattered keywords does not qualify", () => {
    const transcript =
      "AI: We can send transactional text messages. Standard data rates may apply at some carriers.\n" +
      "User: sure\nAI: Anything else?";
    expect(transcriptShowsCompleteSmsDisclosure(transcript, BUSINESS)).toBe(false);
  });

  it("empty transcript or missing business name fails closed", () => {
    expect(transcriptShowsCompleteSmsDisclosure("", BUSINESS)).toBe(false);
    expect(transcriptShowsCompleteSmsDisclosure(`AI: ${FULL_DISCLOSURE}\nUser: yes`, "")).toBe(false);
  });
});

describe("SmsDisclosureState — distinguishing 'never read' from 'read, awaiting the answer'", () => {
  it("AWAITING_ANSWER when the assistant read it in full but no caller turn has landed yet", () => {
    // The live failure this fixes: the caller HAS answered, but Vapi's running
    // transcript is a turn behind, so the answer is not in the string yet.
    expect(transcriptSmsDisclosureState(`User: hello\nAI: ${FULL_DISCLOSURE}`, BUSINESS)).toBe(
      "AWAITING_ANSWER"
    );
  });

  it("ANSWERED once a caller turn follows the complete disclosure", () => {
    expect(transcriptSmsDisclosureState(`AI: ${FULL_DISCLOSURE}\nUser: yes`, BUSINESS)).toBe("ANSWERED");
  });

  it("INTERRUPTED for a partial disclosure — consent still blocked, but finish it rather than restart", () => {
    const partial = FULL_DISCLOSURE.replace("Message frequency varies. ", "").replace(
      "Please say yes or no.",
      ""
    );
    const transcript = `AI: ${partial}\nUser: yes`;
    expect(transcriptSmsDisclosureState(transcript, BUSINESS)).toBe("INTERRUPTED");
    // The compliance guarantee is unchanged: this never counts as consent.
    expect(transcriptShowsCompleteSmsDisclosure(transcript, BUSINESS)).toBe(false);
  });

  it("NOT_PRESENTED when the disclosure was never started", () => {
    expect(
      transcriptSmsDisclosureState("AI: You're all set for Tuesday at 2.\nUser: thanks", BUSINESS)
    ).toBe("NOT_PRESENTED");
  });

  it("caller-spoken disclosure text never reaches AWAITING_ANSWER either", () => {
    expect(transcriptSmsDisclosureState(`User: ${FULL_DISCLOSURE}`, BUSINESS)).toBe("NOT_PRESENTED");
  });

  it("structured role-tagged turns resolve ANSWERED when the flat transcript would lag", () => {
    // artifact.messages carries the caller turn that triggered the tool call.
    const segments: TranscriptSegment[] = [
      { role: "assistant", text: FULL_DISCLOSURE },
      { role: "user", text: "yes" }
    ];
    expect(segmentsSmsDisclosureState(segments, BUSINESS)).toBe("ANSWERED");
    // …while the lagging flat transcript alone only reaches AWAITING_ANSWER.
    expect(transcriptSmsDisclosureState(`AI: ${FULL_DISCLOSURE}`, BUSINESS)).toBe("AWAITING_ANSWER");
  });

  it("empty input stays NOT_PRESENTED", () => {
    expect(transcriptSmsDisclosureState("", BUSINESS)).toBe("NOT_PRESENTED");
    expect(transcriptSmsDisclosureState(`AI: ${FULL_DISCLOSURE}\nUser: yes`, "")).toBe("NOT_PRESENTED");
    expect(segmentsSmsDisclosureState([], BUSINESS)).toBe("NOT_PRESENTED");
  });
});

/**
 * Barge-in. The caller says "yes" part-way through the ~30-second disclosure,
 * which splits one spoken disclosure into two assistant segments. Requiring
 * every element inside a SINGLE segment reported NOT_PRESENTED, so the tool told
 * the assistant to read the whole thing again — the loop QA reported as "the
 * agent keeps repeating the same long message".
 */
describe("caller interrupts mid-disclosure", () => {
  const firstHalf =
    `Would you like to receive transactional text messages from ${BUSINESS} through Triven.ai ` +
    "about this appointment, booking, or service request? Message frequency varies.";
  const secondHalf =
    "Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not " +
    "required to complete the booking or service request. Please say yes or no.";

  it("reports INTERRUPTED — not NOT_PRESENTED — so the assistant resumes instead of restarting", () => {
    const progress = transcriptSmsDisclosureProgress(
      `AI: ${firstHalf}\nUser: yes that's fine`,
      BUSINESS
    );
    expect(progress.state).toBe("INTERRUPTED");
    expect(progress.missing.length).toBeGreaterThan(0);
    // It names only what is left to say, so nothing already spoken is repeated.
    expect(progress.missing.join(" ")).toContain("data rates may apply");
    expect(progress.missing.join(" ")).not.toContain("frequency varies");
  });

  it("an interrupted disclosure never records consent", () => {
    expect(
      transcriptShowsCompleteSmsDisclosure(`AI: ${firstHalf}\nUser: yes that's fine`, BUSINESS)
    ).toBe(false);
  });

  it("ANSWERED once the assistant speaks the remaining parts and the caller answers", () => {
    const transcript = [
      `AI: ${firstHalf}`,
      "User: yes that's fine",
      `AI: Thanks — just to finish: ${secondHalf}`,
      "User: yes"
    ].join("\n");
    expect(transcriptSmsDisclosureState(transcript, BUSINESS)).toBe("ANSWERED");
  });

  it("the caller — not the assistant — speaking the remaining parts never completes it", () => {
    const transcript = [
      `AI: ${firstHalf}`,
      `User: ${secondHalf}`,
      "User: yes"
    ].join("\n");
    expect(transcriptSmsDisclosureState(transcript, BUSINESS)).toBe("INTERRUPTED");
  });

  it("a stray 'how can I help you' never satisfies the HELP element on its own", () => {
    const transcript = [
      `AI: ${firstHalf}`,
      "User: sorry, one second",
      "AI: Of course. How can I help you?",
      "User: go on"
    ].join("\n");
    const progress = transcriptSmsDisclosureProgress(transcript, BUSINESS);
    expect(progress.state).toBe("INTERRUPTED");
    expect(progress.missing.join(" ")).toContain("HELP for help");
  });
});

/**
 * Regression from a real production call (2026-07-27, Bright Smile Dental).
 * The assistant read the disclosure in full and the caller said yes, but the
 * transcript rendered the name as "BrightSmile Dental" — consent was rejected
 * as DISCLOSURE_NOT_PRESENTED and the caller had to hear it two more times.
 */
describe("business name spoken without its space", () => {
  const spokenDisclosure = (name: string) =>
    [
      `assistant: I will need to read the SMS consent disclosure to you first. Would you like to receive transactional text messages from ${name} through triven dot ai, about this appointment booking, or service request, including confirmations, reminders, updates, cancellations, and customer support messages. Message frequency varies. Message and data rates may apply. Reply. Stop to opt out or help for help. Consent is not required to complete the booking or service request. Please say yes or no. Would you like to receive those messages?`,
      "user: Yes."
    ].join("\n");

  it("accepts a merged name the transcriber produced", () => {
    expect(
      transcriptSmsDisclosureState(spokenDisclosure("BrightSmile Dental"), "Bright Smile Dental")
    ).toBe("ANSWERED");
  });

  it("still accepts the correctly spaced name", () => {
    expect(
      transcriptSmsDisclosureState(spokenDisclosure("Bright Smile Dental"), "Bright Smile Dental")
    ).toBe("ANSWERED");
  });

  it("still rejects a disclosure naming a different business", () => {
    expect(
      transcriptSmsDisclosureState(spokenDisclosure("Better White"), "Bright Smile Dental")
    ).toBe("NOT_PRESENTED");
  });
});
