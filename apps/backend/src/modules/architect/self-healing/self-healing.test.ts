import { describe, it, expect } from "vitest";
import { failureSignature, fixScopeFor, isSafeToApplyAutomatically } from "@coreai/shared";

/**
 * The last layer, and the one where a mistake is expensive in two different
 * ways.
 *
 * Get the grouping wrong and the platform pays to diagnose the same fault four
 * hundred times. Get the scoping wrong and one business's mistake is applied to
 * every agent on the platform. Both are tested here.
 */

describe("one bug is one bug, however often it happens", () => {
  it("gives the same fault the same signature every time", () => {
    const facts = {
      nodeType: "calendar.book_appointment",
      kind: "unproven" as const,
      missingOutputs: ["appointment.status", "appointment.date"]
    };
    expect(failureSignature(facts)).toBe(failureSignature(facts));
  });

  it("does not care what order the missing things came in", () => {
    const a = failureSignature({ nodeType: "x", kind: "unproven", missingOutputs: ["b", "a"] });
    const b = failureSignature({ nodeType: "x", kind: "unproven", missingOutputs: ["a", "b"] });
    expect(a).toBe(b);
  });

  it("treats the same error about two different people as one bug", () => {
    // Without this, every caller is a separate bug and the platform pays to
    // diagnose the same thing again every single day.
    const a = failureSignature({
      nodeType: "action.send_sms",
      kind: "error",
      errorMessage: "Could not reach +447700900123 at 2026-08-21T10:14:02Z"
    });
    const b = failureSignature({
      nodeType: "action.send_sms",
      kind: "error",
      errorMessage: "Could not reach +447700900456 at 2026-08-21T16:41:55Z"
    });
    expect(a).toBe(b);
  });

  it("strips ids, emails and money too", () => {
    const a = failureSignature({
      nodeType: "x",
      kind: "error",
      errorMessage: "Lead cmt1p32kn009kpb0jqujkg22i for priya@example.com cost $12.40"
    });
    const b = failureSignature({
      nodeType: "x",
      kind: "error",
      errorMessage: "Lead cmszmwcc3000rno0ivfc7sq86 for sam@other.co cost $9.99"
    });
    expect(a).toBe(b);
  });

  it("keeps two genuinely different faults apart", () => {
    const missing = failureSignature({ nodeType: "x", kind: "unproven", missingOutputs: ["a"] });
    const errored = failureSignature({ nodeType: "x", kind: "error", errorMessage: "no such thing" });
    expect(missing).not.toBe(errored);
  });

  it("keeps the same fault on two different steps apart", () => {
    const a = failureSignature({ nodeType: "action.send_sms", kind: "unproven", missingOutputs: ["x"] });
    const b = failureSignature({ nodeType: "action.send_email", kind: "unproven", missingOutputs: ["x"] });
    expect(a).not.toBe(b);
  });

  it("stays readable, so a person can see what is being paid for", () => {
    expect(
      failureSignature({ nodeType: "calendar.book_appointment", kind: "unproven", missingOutputs: ["appointment.date"] })
    ).toContain("calendar.book_appointment");
  });
});

describe("how far a fix is allowed to travel", () => {
  it("keeps one account's own situation to that account", () => {
    // Telling another business to reconnect a calendar they never connected is
    // worse than saying nothing at all.
    for (const cause of [
      "Their Google Calendar is not connected.",
      "The API key has expired.",
      "This account is out of credit.",
      "The token is unauthorised."
    ]) {
      expect(fixScopeFor(cause), cause).toBe("local");
    }
  });

  it("lets a fault in the shape of things travel", () => {
    for (const cause of [
      "The field is named differently than the step expects.",
      "The date format does not match.",
      "The step produces nothing under that name."
    ]) {
      expect(fixScopeFor(cause), cause).toBe("generic");
    }
  });

  it("treats anything it is unsure about as local", () => {
    // A fix that fails to travel costs one architect a few minutes. A fix that
    // travels when it should not can break every agent on the platform. The
    // two mistakes are not the same size.
    expect(fixScopeFor("Something odd happened.")).toBe("local");
    expect(fixScopeFor("")).toBe("local");
  });
});

describe("what the platform may never do on its own", () => {
  it("refuses to act by itself on anything that reaches a person", () => {
    // Doing this automatically means the platform sending something to
    // somebody's customer that no human chose.
    for (const remedy of [
      "Send the text again.",
      "Resend the confirmation email.",
      "Book the appointment manually.",
      "Refund the charge.",
      "Change the phone number it dials."
    ]) {
      expect(isSafeToApplyAutomatically(remedy), remedy).toBe(false);
    }
  });

  it("allows a correction that only changes shape", () => {
    for (const remedy of [
      "Map the field to the right name.",
      "Change the date format to match.",
      "Correct the spelling of the key name."
    ]) {
      expect(isSafeToApplyAutomatically(remedy), remedy).toBe(true);
    }
  });

  it("says no when it does not recognise the remedy", () => {
    expect(isSafeToApplyAutomatically("Have a think about it.")).toBe(false);
  });
});
