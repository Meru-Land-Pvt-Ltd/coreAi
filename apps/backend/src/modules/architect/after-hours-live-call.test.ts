/**
 * Live-call after-hours contract at the Vapi boundary: the server-side hours
 * decision reaches the assistant as per-call variableValues (businessOpenState
 * / businessHoursStatusLine / businessNextOpenTime) and, when the business is
 * closed, as an assistantOverrides.firstMessage greeting override.
 *
 * Vapi's HTTP API is stubbed with vi.stubGlobal("fetch") — no real calls. The
 * shared env object is snapshotted and restored (twilio-webhooks pattern).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { buildVapiVariableValues, createVapiInboundTwiml } from "./vapi-connector";

const originalEnv = {
  VAPI_API_KEY: env.VAPI_API_KEY,
  VAPI_BASE_URL: env.VAPI_BASE_URL
};

const BUSINESS = {
  businessId: "biz_1",
  businessName: "California Family Dental Center",
  businessType: "dental practice",
  timeZone: "America/Los_Angeles",
  services: [],
  faqs: []
};

describe("buildVapiVariableValues after-hours variables", () => {
  it("carries the server-side hours decision into the per-call variables", () => {
    const values = buildVapiVariableValues({
      customerPhone: "+15555550123",
      business: BUSINESS,
      reason: "test",
      businessHours: {
        state: "closed",
        statusLine: "Currently closed (Monday) — next open Tuesday at 9 AM.",
        nextOpenText: "Tuesday (2026-07-21) at 9 AM"
      }
    });

    expect(values.businessOpenState).toBe("closed");
    expect(values.businessHoursStatusLine).toContain("Currently closed");
    expect(values.businessNextOpenTime).toBe("Tuesday (2026-07-21) at 9 AM");
  });

  it("defaults to 'unknown' when no hours decision was made — never a false closed claim", () => {
    const values = buildVapiVariableValues({
      customerPhone: "+15555550123",
      business: BUSINESS,
      reason: "test"
    });
    expect(values.businessOpenState).toBe("unknown");
    expect(values.businessNextOpenTime).toBe("");
  });
});

describe("createVapiInboundTwiml after-hours overrides", () => {
  let lastRequestBody: Record<string, any> | null = null;

  beforeEach(() => {
    lastRequestBody = null;
    env.VAPI_API_KEY = "test_vapi_key_for_after_hours";
    env.VAPI_BASE_URL = "https://vapi.test.invalid";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        lastRequestBody = init?.body ? JSON.parse(init.body) : null;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "call_1", phoneCallProviderDetails: { twiml: "<Response></Response>" } })
        } as unknown as Response;
      })
    );
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
    vi.unstubAllGlobals();
  });

  it("passes the greeting override and hours variables for a closed-hours call", async () => {
    const twiml = await createVapiInboundTwiml({
      callerNumber: "+15555550123",
      business: BUSINESS,
      reason: "inbound",
      assistantId: "asst_real_123",
      phoneNumberId: "pn_real_123",
      businessHours: { state: "closed", statusLine: "Currently closed.", nextOpenText: "Tuesday at 9 AM" },
      firstMessageOverride:
        "Thank you for calling California Family Dental Center. Our office is currently closed. I hope everything is okay."
    });

    expect(twiml).toBe("<Response></Response>");
    expect(lastRequestBody?.assistantOverrides?.firstMessage).toContain("Our office is currently closed.");
    expect(lastRequestBody?.assistantOverrides?.variableValues?.businessOpenState).toBe("closed");
    expect(lastRequestBody?.assistantOverrides?.variableValues?.businessNextOpenTime).toBe("Tuesday at 9 AM");
  });

  it("sends no firstMessage override while open — the deployed greeting stands", async () => {
    await createVapiInboundTwiml({
      callerNumber: "+15555550123",
      business: BUSINESS,
      reason: "inbound",
      assistantId: "asst_real_123",
      phoneNumberId: "pn_real_123",
      businessHours: { state: "open", statusLine: "Open now.", nextOpenText: "" }
    });

    expect(lastRequestBody?.assistantOverrides?.firstMessage).toBeUndefined();
    expect(lastRequestBody?.assistantOverrides?.variableValues?.businessOpenState).toBe("open");
  });
});
