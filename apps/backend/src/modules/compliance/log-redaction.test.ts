import { describe, expect, it } from "vitest";
import { maskPhone, redactForLog, stripUrlQuery } from "./log-redaction";

describe("maskPhone", () => {
  it("keeps only the last 4 digits", () => {
    expect(maskPhone("+15551234567")).toBe("•••4567");
    expect(maskPhone("(555) 123-4567")).toBe("•••4567");
    expect(maskPhone("12")).toBe("•••");
  });
});

describe("stripUrlQuery", () => {
  it("removes signed-URL query parameters", () => {
    expect(
      stripUrlQuery("https://s3.aws.com/rec.mp3?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA123")
    ).toBe("https://s3.aws.com/rec.mp3");
    expect(stripUrlQuery("https://x.com/plain")).toBe("https://x.com/plain");
  });
});

describe("redactForLog", () => {
  it("replaces secret-ish keys entirely", () => {
    const redacted = redactForLog({
      access_token: "ya29.secret",
      apiKey: "sk-123",
      authorization: "Bearer abc",
      refreshToken: "1//xyz",
      signature: "sig",
      safe: "keep-me"
    }) as Record<string, unknown>;
    expect(redacted.access_token).toBe("[redacted]");
    expect(redacted.apiKey).toBe("[redacted]");
    expect(redacted.authorization).toBe("[redacted]");
    expect(redacted.refreshToken).toBe("[redacted]");
    expect(redacted.signature).toBe("[redacted]");
    expect(redacted.safe).toBe("keep-me");
  });

  it("masks customer PII keys and phone-like strings", () => {
    const redacted = redactForLog({
      customer_name: "Jane Caller",
      customerPhone: "+15551234567",
      patient_phone: "+15559876543",
      note: "call +1 555 123 4567 back"
    }) as Record<string, unknown>;
    expect(redacted.customer_name).toBe("[redacted]");
    expect(redacted.customerPhone).toBe("•••4567");
    expect(redacted.patient_phone).toBe("•••6543");
    expect(JSON.stringify(redacted)).not.toContain("Jane");
  });

  it("drops raw calendar payload keys and strips URL queries deep in objects", () => {
    const redacted = redactForLog({
      nested: {
        attendees: [{ email: "a@b.com" }],
        description: "Customer: Jane, Phone: +15551234567",
        recording: "https://s3.aws.com/rec.mp3?X-Amz-Signature=deadbeef"
      }
    }) as { nested: Record<string, unknown> };
    expect(redacted.nested.attendees).toBe("[omitted]");
    expect(redacted.nested.description).toBe("[omitted]");
    expect(redacted.nested.recording).toBe("https://s3.aws.com/rec.mp3");
    const json = JSON.stringify(redacted);
    expect(json).not.toContain("a@b.com");
    expect(json).not.toContain("X-Amz-Signature");
    expect(json).not.toContain("4567");
  });
});
