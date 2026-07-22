import { describe, expect, it } from "vitest";
import {
  clearConsentOffer,
  consentOfferStoreIsDistributed,
  markConsentOffered,
  wasConsentOffered
} from "./consent-offer-store";

/**
 * Test env has no REDIS_URL → the store runs on the in-memory fallback with
 * the same semantics. In production, REDIS_URL makes it distributed;
 * consentOfferStoreIsDistributed() is the deploy-time assertion hook.
 */

const key = (callId: string) => ({
  businessId: "biz-1",
  callId,
  disclosureVersion: "2026-07-17.v1"
});

describe("consent-offer store (memory fallback semantics)", () => {
  it("reports non-distributed mode without REDIS_URL (production blocker signal)", () => {
    expect(consentOfferStoreIsDistributed()).toBe(false);
  });

  it("NOT_OFFERED by default; OFFERED after mark; idempotent re-marks; spent after clear", async () => {
    const k = key("call-1");
    expect(await wasConsentOffered(k)).toBe(false);

    await markConsentOffered(k);
    await markConsentOffered(k);
    expect(await wasConsentOffered(k)).toBe(true);

    await clearConsentOffer(k);
    expect(await wasConsentOffered(k)).toBe(false);
  });

  it("keys are scoped — a different call, business, or disclosure version is separate", async () => {
    await markConsentOffered(key("call-2"));
    expect(await wasConsentOffered(key("call-3"))).toBe(false);
    expect(await wasConsentOffered({ ...key("call-2"), businessId: "biz-2" })).toBe(false);
    expect(await wasConsentOffered({ ...key("call-2"), disclosureVersion: "other" })).toBe(false);
    await clearConsentOffer(key("call-2"));
  });
});
