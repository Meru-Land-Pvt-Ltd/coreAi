import { describe, expect, it } from "vitest";
import { asSnsEnvelope, isTrustedAwsSnsUrl, verifySnsMessage } from "./sns-verify";

describe("isTrustedAwsSnsUrl", () => {
  it("accepts real SNS cert URLs", () => {
    expect(
      isTrustedAwsSnsUrl("https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc123.pem")
    ).toBe(true);
    expect(isTrustedAwsSnsUrl("https://sns.eu-west-1.amazonaws.com/cert.pem")).toBe(true);
  });

  it("rejects non-AWS hosts, lookalikes, and http", () => {
    expect(isTrustedAwsSnsUrl("https://evil.com/cert.pem")).toBe(false);
    expect(isTrustedAwsSnsUrl("https://sns.us-east-1.amazonaws.com.evil.com/cert.pem")).toBe(false);
    expect(isTrustedAwsSnsUrl("https://sns-us-east-1.amazonaws.com.attacker.net/x.pem")).toBe(false);
    expect(isTrustedAwsSnsUrl("http://sns.us-east-1.amazonaws.com/cert.pem")).toBe(false);
    expect(isTrustedAwsSnsUrl("https://s3.us-east-1.amazonaws.com/cert.pem")).toBe(false);
    expect(isTrustedAwsSnsUrl(undefined)).toBe(false);
    expect(isTrustedAwsSnsUrl("not a url")).toBe(false);
  });
});

describe("asSnsEnvelope", () => {
  it("accepts objects with Type and Message", () => {
    expect(asSnsEnvelope({ Type: "Notification", Message: "{}" })).not.toBeNull();
  });

  it("rejects non-envelope payloads", () => {
    expect(asSnsEnvelope(null)).toBeNull();
    expect(asSnsEnvelope("string")).toBeNull();
    expect(asSnsEnvelope({ to: "x@y.com", from: "a@b.com" })).toBeNull();
  });
});

describe("verifySnsMessage (enforced mode)", () => {
  it("rejects unsigned payloads", async () => {
    const result = await verifySnsMessage({
      Type: "Notification",
      MessageId: "m1",
      Message: "{}",
      Timestamp: new Date().toISOString()
    });
    expect(result.ok).toBe(false);
  });

  it("rejects untrusted SigningCertURL", async () => {
    const result = await verifySnsMessage({
      Type: "Notification",
      MessageId: "m1",
      Message: "{}",
      Timestamp: new Date().toISOString(),
      Signature: "AAAA",
      SigningCertURL: "https://evil.com/cert.pem"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("untrusted");
  });

  it("rejects stale timestamps before fetching any cert", async () => {
    const result = await verifySnsMessage({
      Type: "Notification",
      MessageId: "m1",
      Message: "{}",
      Timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      Signature: "AAAA",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Timestamp");
  });

  it("rejects forged signatures even with a trusted cert host", async () => {
    const result = await verifySnsMessage({
      Type: "Notification",
      MessageId: "m1",
      Message: "{}",
      TopicArn: "arn:aws:sns:us-east-1:1:t",
      Timestamp: new Date().toISOString(),
      Signature: Buffer.from("forged").toString("base64"),
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/does-not-exist.pem"
    });
    // Cert fetch fails (offline/404) or signature mismatch — either way rejected.
    expect(result.ok).toBe(false);
  });
});
