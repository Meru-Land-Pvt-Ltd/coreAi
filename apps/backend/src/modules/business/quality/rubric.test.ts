import { describe, expect, it } from "vitest";
import {
  FAIRNESS_CONSTRAINT,
  MIN_SCORABLE,
  RUBRIC_DIMENSION_KEYS,
  RUBRIC_VERSION,
  countCustomerTurns,
  isScorable,
} from "./rubric";

const LABELED_TRANSCRIPT = [
  "AI: Thank you for calling Bright Smiles, how can I help you today?",
  "User: Hi, I would like to book a cleaning appointment for next week please.",
  "AI: Of course, we have Tuesday at 10am or Thursday at 2pm available for a cleaning.",
  "User: Thursday at 2pm works great for me, thank you so much for the help.",
  "AI: Wonderful, you are booked for Thursday at 2pm. Anything else I can do?",
].join("\n");

describe("rubric constants", () => {
  it("exposes v1 with all ten dimensions", () => {
    expect(RUBRIC_VERSION).toBe("v1");
    expect(RUBRIC_DIMENSION_KEYS).toEqual([
      "greeting",
      "accuracy",
      "professionalism",
      "empathy",
      "sales_handling",
      "rule_compliance",
      "knowledge_usage",
      "resolution",
      "outcome_success",
      "satisfaction_proxy",
    ]);
  });

  it("carries the fairness sentence verbatim", () => {
    expect(FAIRNESS_CONSTRAINT).toBe(
      "Judge whether the problem was solved; NEVER penalize accent or non-native fluency."
    );
  });
});

describe("isScorable", () => {
  it("rejects a call with no transcript", () => {
    expect(isScorable({ durationSeconds: 120, transcript: null })).toEqual({
      scorable: false,
      reason: "NO_TRANSCRIPT",
    });
    expect(isScorable({ durationSeconds: 120, transcript: "   " })).toEqual({
      scorable: false,
      reason: "NO_TRANSCRIPT",
    });
  });

  it("rejects a call shorter than 20 seconds", () => {
    const verdict = isScorable({ durationSeconds: 19, transcript: LABELED_TRANSCRIPT });
    expect(verdict.scorable).toBe(false);
    expect(verdict.reason).toBe("DURATION_TOO_SHORT");
  });

  it("rejects a transcript under 200 characters", () => {
    const verdict = isScorable({ durationSeconds: 60, transcript: "AI: Hello.\nUser: Bye." });
    expect(verdict.scorable).toBe(false);
    expect(verdict.reason).toBe("TRANSCRIPT_TOO_SHORT");
  });

  it("rejects a labeled transcript with fewer than 2 customer turns", () => {
    const oneTurn = [
      "AI: Thank you for calling Bright Smiles dental, how can I help you today my friend?",
      "User: Sorry, wrong number, I did not mean to call this business at all today.",
      "AI: No problem at all, have a wonderful rest of your day and take care out there.",
      "AI: Goodbye now, thanks again for calling Bright Smiles dental clinic today.",
    ].join("\n");
    expect(oneTurn.length).toBeGreaterThanOrEqual(MIN_SCORABLE.transcriptChars);
    const verdict = isScorable({ durationSeconds: 45, transcript: oneTurn });
    expect(verdict.scorable).toBe(false);
    expect(verdict.reason).toBe("TOO_FEW_CUSTOMER_TURNS");
  });

  it("accepts a labeled transcript meeting every threshold", () => {
    expect(isScorable({ durationSeconds: 60, transcript: LABELED_TRANSCRIPT })).toEqual({
      scorable: true,
    });
  });

  it("applies the chars/200 heuristic to unlabeled transcripts", () => {
    const longUnlabeled = "the caller explained the issue and the assistant walked through it ".repeat(8);
    expect(longUnlabeled.length).toBeGreaterThanOrEqual(400);
    expect(isScorable({ durationSeconds: 60, transcript: longUnlabeled }).scorable).toBe(true);

    const shortUnlabeled = "a".repeat(250); // 250 chars → 1 estimated turn
    const verdict = isScorable({ durationSeconds: 60, transcript: shortUnlabeled });
    expect(verdict.scorable).toBe(false);
    expect(verdict.reason).toBe("TOO_FEW_CUSTOMER_TURNS");
  });
});

describe("countCustomerTurns", () => {
  it("counts customer-labeled lines in labeled transcripts", () => {
    expect(countCustomerTurns(LABELED_TRANSCRIPT)).toBe(2);
  });

  it("estimates turns from length when unlabeled", () => {
    expect(countCustomerTurns("x".repeat(650))).toBe(3);
  });
});
