import { describe, expect, it } from "vitest";
import { classifyCallOutcome, classifySentiment, type CallOutcomeInput } from "./classify";

const base: CallOutcomeInput = {
  transcript: null,
  summary: null,
  hadBookedAppointment: false,
  hadReschedule: false,
  hadCancellation: false,
  hadTransfer: false,
  transferConnected: false,
  leadCaptured: false,
  endedReason: null,
  durationSeconds: null
};

describe("classifyCallOutcome — fact-based tier (0.9)", () => {
  it("BOOKED wins over every other signal", () => {
    expect(
      classifyCallOutcome({
        ...base,
        hadBookedAppointment: true,
        hadReschedule: true,
        hadCancellation: true,
        hadTransfer: true,
        transferConnected: true,
        leadCaptured: true,
        durationSeconds: 3,
        transcript: "not interested"
      })
    ).toEqual({ outcome: "BOOKED", confidence: 0.9 });
  });

  it("RESCHEDULED when reschedule happened and no booking", () => {
    expect(classifyCallOutcome({ ...base, hadReschedule: true, hadCancellation: true })).toEqual({
      outcome: "RESCHEDULED",
      confidence: 0.9
    });
  });

  it("CANCELLED on cancellation flag", () => {
    expect(classifyCallOutcome({ ...base, hadCancellation: true })).toEqual({
      outcome: "CANCELLED",
      confidence: 0.9
    });
  });

  it("TRANSFERRED only when the transfer actually connected", () => {
    expect(
      classifyCallOutcome({ ...base, hadTransfer: true, transferConnected: true })
    ).toEqual({ outcome: "TRANSFERRED", confidence: 0.9 });
  });

  it("a failed transfer attempt falls through to weaker signals", () => {
    expect(
      classifyCallOutcome({ ...base, hadTransfer: true, transferConnected: false, leadCaptured: true })
    ).toEqual({ outcome: "LEAD", confidence: 0.9 });
  });

  it("LEAD on leadCaptured", () => {
    expect(classifyCallOutcome({ ...base, leadCaptured: true })).toEqual({
      outcome: "LEAD",
      confidence: 0.9
    });
  });

  it("LEAD beats MISSED — a captured lead on a short call is still a lead", () => {
    expect(classifyCallOutcome({ ...base, leadCaptured: true, durationSeconds: 4 })).toEqual({
      outcome: "LEAD",
      confidence: 0.9
    });
  });

  it("MISSED when the call lasted under 8 seconds", () => {
    expect(classifyCallOutcome({ ...base, durationSeconds: 5 })).toEqual({
      outcome: "MISSED",
      confidence: 0.9
    });
  });

  it("MISSED on no-answer / busy / voicemail ended reasons", () => {
    for (const endedReason of [
      "customer-did-not-answer",
      "no-answer",
      "customer-busy",
      "voicemail",
      "silence-timed-out"
    ]) {
      expect(classifyCallOutcome({ ...base, endedReason, durationSeconds: 30 })).toEqual({
        outcome: "MISSED",
        confidence: 0.9
      });
    }
  });

  it("a 0-second duration is treated as MISSED (falsy but finite)", () => {
    expect(classifyCallOutcome({ ...base, durationSeconds: 0 })).toEqual({
      outcome: "MISSED",
      confidence: 0.9
    });
  });
});

describe("classifyCallOutcome — text-heuristic tier (0.5-0.6)", () => {
  it("NO_INTEREST from 'not interested'", () => {
    const result = classifyCallOutcome({
      ...base,
      durationSeconds: 45,
      transcript: "No, I'm not interested, please don't call again."
    });
    expect(result.outcome).toBe("NO_INTEREST");
    expect(result.confidence).toBe(0.6);
  });

  it("NO_INTEREST beats FOLLOW_UP wording in the same call", () => {
    const result = classifyCallOutcome({
      ...base,
      durationSeconds: 45,
      transcript: "I'm not interested, do not call me back."
    });
    expect(result.outcome).toBe("NO_INTEREST");
  });

  it("FOLLOW_UP when a follow-up was promised", () => {
    const result = classifyCallOutcome({
      ...base,
      durationSeconds: 60,
      summary: "Caller asked about pricing; the office will follow up tomorrow."
    });
    expect(result).toEqual({ outcome: "FOLLOW_UP", confidence: 0.55 });
  });

  it("FOLLOW_UP from 'call you back'", () => {
    const result = classifyCallOutcome({
      ...base,
      durationSeconds: 60,
      transcript: "Thanks, someone will call you back this afternoon."
    });
    expect(result.outcome).toBe("FOLLOW_UP");
  });

  it("SUPPORT_RESOLVED when the question was answered with no pending action", () => {
    const result = classifyCallOutcome({
      ...base,
      durationSeconds: 90,
      transcript: "Perfect, thanks, that's all I needed. Bye!"
    });
    expect(result).toEqual({ outcome: "SUPPORT_RESOLVED", confidence: 0.5 });
  });

  it("handles curly apostrophes in transcripts", () => {
    const result = classifyCallOutcome({
      ...base,
      durationSeconds: 90,
      transcript: "That’s all, thanks."
    });
    expect(result.outcome).toBe("SUPPORT_RESOLVED");
  });
});

describe("classifyCallOutcome — UNKNOWN", () => {
  it("UNKNOWN with low confidence when nothing matches", () => {
    expect(classifyCallOutcome({ ...base, durationSeconds: 42 })).toEqual({
      outcome: "UNKNOWN",
      confidence: 0.2
    });
  });

  it("UNKNOWN when text exists but carries no signal", () => {
    const result = classifyCallOutcome({
      ...base,
      durationSeconds: 42,
      transcript: "Hello, what are your opening hours? We open at nine. Okay bye."
    });
    expect(result).toEqual({ outcome: "UNKNOWN", confidence: 0.2 });
  });
});

describe("classifySentiment", () => {
  it("ANGRY on complaint/unacceptable language", () => {
    expect(classifySentiment({ transcript: "This is unacceptable, I want to file a complaint." }))
      .toEqual({ sentiment: "ANGRY", confidence: 0.6 });
  });

  it("ANGRY wins over positive words in the same call", () => {
    expect(
      classifySentiment({ transcript: "Great, just great. This is unacceptable." }).sentiment
    ).toBe("ANGRY");
  });

  it("FRUSTRATED on repeat-contact frustration", () => {
    expect(
      classifySentiment({ transcript: "This is the third time I've called about this." })
    ).toEqual({ sentiment: "FRUSTRATED", confidence: 0.6 });
    expect(classifySentiment({ summary: "Caller sounded frustrated." }).sentiment).toBe(
      "FRUSTRATED"
    );
  });

  it("CONFUSED on confusion language", () => {
    expect(classifySentiment({ transcript: "I don't understand how this works." })).toEqual({
      sentiment: "CONFUSED",
      confidence: 0.55
    });
    expect(classifySentiment({ transcript: "I’m confused about the invoice." }).sentiment).toBe(
      "CONFUSED"
    );
  });

  it("POSITIVE on gratitude/praise", () => {
    expect(classifySentiment({ transcript: "Thank you so much, that was perfect!" })).toEqual({
      sentiment: "POSITIVE",
      confidence: 0.55
    });
  });

  it("NEUTRAL by default when text has no emotional signal", () => {
    expect(classifySentiment({ transcript: "I'd like to know your opening hours." })).toEqual({
      sentiment: "NEUTRAL",
      confidence: 0.5
    });
  });

  it("UNKNOWN when there is no text at all", () => {
    expect(classifySentiment({})).toEqual({ sentiment: "UNKNOWN", confidence: 0.2 });
    expect(classifySentiment({ transcript: null, summary: null }).sentiment).toBe("UNKNOWN");
    expect(classifySentiment({ transcript: "   ", summary: "" }).sentiment).toBe("UNKNOWN");
  });
});
