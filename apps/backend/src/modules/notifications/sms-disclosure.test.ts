import { describe, expect, it } from "vitest";
import { parseTranscriptSegments, transcriptShowsCompleteSmsDisclosure } from "./sms-disclosure";

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
