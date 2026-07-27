import { describe, expect, it } from "vitest";
import {
  SMS_COMPLIANCE_FOOTER,
  SMS_MAX_TOTAL_LENGTH,
  formatTransactionalSms,
  smsAttributionPrefix
} from "./sms-format";

function countOccurrences(text: string, needle: RegExp): number {
  return (text.match(needle) ?? []).length;
}

describe("formatTransactionalSms", () => {
  it("adds business attribution and the compliance footer exactly once", () => {
    const result = formatTransactionalSms({
      body: "Hi Jane, your Cleaning appointment is confirmed for July 25 at 3:00 PM.",
      businessName: "Bright Smile Dental"
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.body.startsWith(`${smsAttributionPrefix("Bright Smile Dental")}Hi Jane`)).toBe(true);
    // Carriers filter bare domains (Twilio 30007) — the prefix must not carry one.
    expect(result.body).not.toContain("Triven.ai");
    expect(result.body.endsWith(SMS_COMPLIANCE_FOOTER)).toBe(true);
    expect(countOccurrences(result.body, /Reply STOP/gi)).toBe(1);
    expect(countOccurrences(result.body, /data rates may apply/gi)).toBe(1);
  });

  it("never duplicates attribution or footer when the template already has them", () => {
    const result = formatTransactionalSms({
      body: "Bright Smile Dental via Triven.ai: Confirmed: Cleaning on July 25 at 3:00 PM. Reply STOP to opt out or HELP for assistance. Msg & data rates may apply.",
      businessName: "Bright Smile Dental"
    });
    if (!result.ok) throw new Error("expected ok");
    expect(countOccurrences(result.body, /\svia\s[^:\n]{1,40}:/g)).toBe(1);
    expect(countOccurrences(result.body, /Reply STOP/gi)).toBe(1);
    expect(countOccurrences(result.body, /data rates may apply/gi)).toBe(1);
    expect(countOccurrences(result.body, /HELP/g)).toBe(1);
  });

  it("replaces PARTIAL template footers with the canonical one (no stacking)", () => {
    const result = formatTransactionalSms({
      body: "Your visit is confirmed. Reply STOP to opt out.",
      businessName: "Bright Smile Dental"
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.body.endsWith(SMS_COMPLIANCE_FOOTER)).toBe(true);
    expect(countOccurrences(result.body, /Reply STOP/gi)).toBe(1);
    expect(countOccurrences(result.body, /data rates may apply/gi)).toBe(1);
  });

  it("normalizes whitespace and caps total length without ever truncating the footer", () => {
    const result = formatTransactionalSms({
      body: `Hi   Jane,\r\n\n\n\nyour appointment note: ${"very long detail ".repeat(60)}`,
      businessName: "Bright Smile Dental"
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.body.length).toBeLessThanOrEqual(SMS_MAX_TOTAL_LENGTH);
    expect(result.body.endsWith(SMS_COMPLIANCE_FOOTER)).toBe(true);
    expect(result.body).not.toContain("Hi   Jane");
  });

  it("REQUIRES business attribution — missing/empty businessName is blocked, never silently allowed", () => {
    for (const businessName of [undefined, null, "", "   "]) {
      const result = formatTransactionalSms({ body: "Your visit is confirmed.", businessName });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("SMS_BUSINESS_IDENTITY_REQUIRED");
    }
  });

  it("blocks embedded links — the campaign is registered with no embedded links", () => {
    for (const body of [
      "Confirm here: https://example.com/x",
      "Visit www.example.com for details",
      "Short link bit.ly/abc123"
    ]) {
      const result = formatTransactionalSms({ body, businessName: "Biz" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("SMS_PURPOSE_NOT_ALLOWED");
    }
  });

  it("blocks promotional content — transactional purpose only", () => {
    for (const body of [
      "Get 20% off your next cleaning!",
      "Use promo code SMILE10 at checkout",
      "Flash sale this weekend only",
      "Subscribe to our newsletter"
    ]) {
      const result = formatTransactionalSms({ body, businessName: "Biz" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("SMS_PURPOSE_NOT_ALLOWED");
    }
  });

  it("keeps a legitimate business callback number intact (embedded phone numbers are allowed)", () => {
    const result = formatTransactionalSms({
      body: "Your Cleaning appointment is confirmed for July 25 at 3:00 PM. For assistance, call +1 (617) 555-0134.",
      businessName: "Bright Smile Dental"
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.body).toContain("+1 (617) 555-0134");
  });
});
