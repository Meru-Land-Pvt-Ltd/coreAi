import { describe, expect, it } from "vitest";
import { smsDenialDetail } from "./sms-notification-service";

/**
 * Every consent-gated suppression used to be recorded as
 * "No affirmative SMS consent on record", including sends that never had a
 * business attached — which reads as an opt-in problem when it is a number
 * routing problem. Each denial now keeps its own reason.
 */
describe("smsDenialDetail", () => {
  it("separates an unresolved business from a missing opt-in", () => {
    const unresolved = smsDenialDetail("MISSING_BUSINESS");

    expect(unresolved.code).toBe("SMS_BUSINESS_UNRESOLVED");
    expect(unresolved.message).toContain("No business is attached");
    expect(unresolved.message).toContain("BusinessPhoneNumber");
    expect(unresolved.message).not.toContain("No affirmative SMS consent");
  });

  it("still names a real consent gap and an opt-out", () => {
    expect(smsDenialDetail("SMS_CONSENT_REQUIRED")).toEqual({
      code: "SMS_CONSENT_REQUIRED",
      message: "No affirmative SMS consent on record for this business and recipient."
    });

    expect(smsDenialDetail("SMS_OPTED_OUT").code).toBe("SMS_OPTED_OUT");
    expect(smsDenialDetail("SMS_OPTED_OUT").message).toContain("opted out");
  });

  it("reports an unusable recipient number as its own failure", () => {
    expect(smsDenialDetail("INVALID_PHONE").code).toBe("SMS_INVALID_RECIPIENT");
  });
});
