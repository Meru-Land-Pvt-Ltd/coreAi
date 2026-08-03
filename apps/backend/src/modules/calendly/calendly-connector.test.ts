import { describe, expect, it } from "vitest";
import { verifyCalendlyWebhookSignature } from "./calendly-connector";
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
