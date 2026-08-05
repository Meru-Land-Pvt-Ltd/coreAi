import { describe, expect, it } from "vitest";
import { calendlyDefaultEventListRange, verifyCalendlyWebhookSignature } from "./calendly-connector";
import crypto from "crypto";

describe("verifyCalendlyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    const signingKey = "test-signing-key";
    const rawBody = JSON.stringify({ event: "invitee.created" });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    expect(
      verifyCalendlyWebhookSignature({
        rawBody,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        signingKey
      })
    ).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(
      verifyCalendlyWebhookSignature({
        rawBody: "{}",
        signatureHeader: "t=1,v1=deadbeef",
        signingKey: "test-signing-key"
      })
    ).toBe(false);
  });
});

describe("calendlyDefaultEventListRange", () => {
  it("covers one year past and one year ahead", () => {
    const now = Date.UTC(2026, 7, 5, 12, 0, 0);
    const range = calendlyDefaultEventListRange(now);
    const min = new Date(range.minStartTime).getTime();
    const max = new Date(range.maxStartTime).getTime();
    expect(max - min).toBe(730 * 24 * 60 * 60 * 1000);
    expect(min).toBe(now - 365 * 24 * 60 * 60 * 1000);
    expect(max).toBe(now + 365 * 24 * 60 * 60 * 1000);
  });
});
