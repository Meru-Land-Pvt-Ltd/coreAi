import { describe, expect, it } from "vitest";
import { luhnValid, redactSensitiveText, redactionSummary, hasRedactions } from "./redaction";

describe("luhnValid", () => {
  it("accepts known-valid test card numbers and rejects tampered ones", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4222222222222")).toBe(true); // 13-digit Visa test number
    expect(luhnValid("30569309025904")).toBe(true); // 14-digit Diners test number
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(luhnValid("")).toBe(false);
    expect(luhnValid("4111-1111")).toBe(false); // non-digits rejected
  });
});

describe("redactSensitiveText — card numbers", () => {
  it("redacts a contiguous Luhn-valid 16-digit card", () => {
    const { redacted, found } = redactSensitiveText("my card is 4111111111111111 thanks");
    expect(redacted).toBe("my card is [CARD REDACTED] thanks");
    expect(found).toEqual(["CARD"]);
  });

  it("redacts a space-separated card", () => {
    const { redacted, found } = redactSensitiveText("card 4111 1111 1111 1111 ok");
    expect(redacted).toBe("card [CARD REDACTED] ok");
    expect(found).toEqual(["CARD"]);
  });

  it("redacts a dash-separated card", () => {
    const { redacted } = redactSensitiveText("card 4111-1111-1111-1111.");
    expect(redacted).toBe("card [CARD REDACTED].");
  });

  it("redacts a 13-digit Luhn-valid card", () => {
    const { redacted } = redactSensitiveText("visa 4222222222222 on file");
    expect(redacted).toBe("visa [CARD REDACTED] on file");
  });

  it("keeps a Luhn-INVALID 16-digit number (order ids survive)", () => {
    const text = "order ref 4111111111111112 confirmed";
    const { redacted, found } = redactSensitiveText(text);
    expect(redacted).toBe(text);
    expect(found).toEqual([]);
  });

  it("keeps a Luhn-invalid 14-digit reference number", () => {
    const text = "tracking 12345678901234 shipped";
    expect(redactSensitiveText(text).redacted).toBe(text);
  });

  it("redacts only the card groups when a phone follows in the same digit run", () => {
    const { redacted, found } = redactSensitiveText(
      "pay with 4111 1111 1111 1111 650 555 1234"
    );
    expect(redacted).toBe("pay with [CARD REDACTED] 650 555 1234");
    expect(found).toEqual(["CARD"]);
  });
});

describe("redactSensitiveText — phone numbers are never destroyed", () => {
  it("keeps E.164 numbers with + prefix", () => {
    const text = "call me at +16505551234 anytime";
    const { redacted, found } = redactSensitiveText(text);
    expect(redacted).toBe(text);
    expect(found).toEqual([]);
  });

  it("keeps a '+'-prefixed run even when its digits are Luhn-valid card length", () => {
    // 30569309025904 is a Luhn-valid 14-digit number; the + prefix marks it
    // as E.164 phone data, so it must survive.
    const text = "reach us on +30569309025904 today";
    expect(redactSensitiveText(text).redacted).toBe(text);
  });

  it("redacts the same Luhn-valid 14-digit number without the + prefix", () => {
    const { redacted } = redactSensitiveText("card number 30569309025904 today");
    expect(redacted).toBe("card number [CARD REDACTED] today");
  });

  it("keeps 10-digit phone numbers, plain and dashed", () => {
    const text = "call 6505551234 or 650-555-1234 tomorrow";
    const { redacted, found } = redactSensitiveText(text);
    expect(redacted).toBe(text);
    expect(found).toEqual([]);
  });

  it("keeps 11-digit numbers starting with 1 (below the 13-digit card floor)", () => {
    const text = "dial 1 650 555 1234 or 16505551234";
    expect(redactSensitiveText(text).redacted).toBe(text);
  });
});

describe("redactSensitiveText — SSN", () => {
  it("redacts dash-separated SSNs", () => {
    const { redacted, found } = redactSensitiveText("my ssn is 123-45-6789 ok");
    expect(redacted).toBe("my ssn is [SSN REDACTED] ok");
    expect(found).toEqual(["SSN"]);
  });

  it("redacts space-separated SSNs", () => {
    const { redacted } = redactSensitiveText("number 123 45 6789.");
    expect(redacted).toBe("number [SSN REDACTED].");
  });

  it("redacts 9 contiguous digits after the SSN label", () => {
    const { redacted, found } = redactSensitiveText("SSN 123456789 on record");
    expect(redacted).toBe("SSN [SSN REDACTED] on record");
    expect(found).toEqual(["SSN"]);
  });

  it("redacts 'social security number is' followed by digits", () => {
    const { redacted } = redactSensitiveText("social security number is 123456789");
    expect(redacted).toBe("social security number is [SSN REDACTED]");
  });

  it("does NOT redact a bare unlabeled 9-digit number", () => {
    const text = "confirmation 123456789 saved";
    expect(redactSensitiveText(text).redacted).toBe(text);
  });

  it("does NOT treat a 3-3-4 phone grouping as an SSN", () => {
    const text = "call 650-555-1234 please";
    expect(redactSensitiveText(text).redacted).toBe(text);
  });
});

describe("redactSensitiveText — CVV", () => {
  it("redacts 3-digit codes after cvv", () => {
    const { redacted, found } = redactSensitiveText("cvv 123 please");
    expect(redacted).toBe("cvv [CVV REDACTED] please");
    expect(found).toEqual(["CVV"]);
  });

  it("redacts 4-digit codes after 'security code is'", () => {
    const { redacted } = redactSensitiveText("the security code is 4567 thanks");
    expect(redacted).toBe("the security code is [CVV REDACTED] thanks");
  });

  it("redacts cvc with punctuation gap", () => {
    const { redacted } = redactSensitiveText("CVC: 321");
    expect(redacted).toBe("CVC: [CVV REDACTED]");
  });

  it("ignores digits farther than ~12 chars from the label", () => {
    const text = "cvv will be mailed to you in 30 days";
    expect(redactSensitiveText(text).redacted).toBe(text);
  });

  it("does not eat the first digits of a longer number after the label", () => {
    // \d{3,4} must be standalone — a 10-digit phone after "security code"
    // stays intact.
    const text = "for the security code call 6505551234";
    expect(redactSensitiveText(text).redacted).toBe(text);
  });
});

describe("redactSensitiveText — mixed text, idempotency, summary", () => {
  const mixed =
    "Card 4111-1111-1111-1111, cvv 123, SSN 123-45-6789, call me at +16505551234 or 650-555-1234.";
  const mixedExpected =
    "Card [CARD REDACTED], cvv [CVV REDACTED], SSN [SSN REDACTED], call me at +16505551234 or 650-555-1234.";

  it("handles mixed sensitive + operational data, in positional order", () => {
    const { redacted, found } = redactSensitiveText(mixed);
    expect(redacted).toBe(mixedExpected);
    expect(found).toEqual(["CARD", "CVV", "SSN"]);
  });

  it("is idempotent — the second pass changes nothing and finds nothing", () => {
    const first = redactSensitiveText(mixed);
    const second = redactSensitiveText(first.redacted);
    expect(second.redacted).toBe(first.redacted);
    expect(second.found).toEqual([]);
  });

  it("handles empty and falsy input", () => {
    expect(redactSensitiveText("")).toEqual({ redacted: "", found: [] });
  });

  it("redactionSummary counts categories with correct pluralization", () => {
    expect(redactionSummary(["CARD", "CARD", "SSN"])).toBe("Redacted 2 card numbers, 1 SSN");
    expect(redactionSummary(["CVV"])).toBe("Redacted 1 CVV");
    expect(redactionSummary([])).toBe("");
  });

  it("hasRedactions reflects findings", () => {
    expect(hasRedactions([])).toBe(false);
    expect(hasRedactions(["CARD"])).toBe(true);
  });
});
