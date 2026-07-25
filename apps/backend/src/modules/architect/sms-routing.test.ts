import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import {
  resolveLiveSmsSender,
  sendTwilioSms,
  TwilioSmsError,
  validateSmsRecipientE164
} from "./twilio-connector";

/**
 * Region-aware live SMS routing: EVERY message goes through the shared
 * Messaging Service; US (+1) additionally pins TWILIO_US_SMS_FROM; India (+91)
 * and other international destinations send with the service ALONE so Twilio
 * selects the correct regional route. Invalid recipients are rejected before
 * any provider request. `status: accepted` + `from: null` (typical for
 * international) is a valid acceptance.
 */

const LIVE_ENV = {
  TWILIO_SMS_MODE: "LIVE",
  TWILIO_ACCOUNT_SID: "AC_test_account",
  TWILIO_AUTH_TOKEN: "test_token",
  TWILIO_MESSAGING_SERVICE_SID: "MG_test_service",
  TWILIO_US_SMS_FROM: "+17252202182"
} as const;

const saved = new Map<string, unknown>();

function setEnv(overrides: Record<string, unknown>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (!saved.has(key)) saved.set(key, (env as Record<string, unknown>)[key]);
    (env as Record<string, unknown>)[key] = value;
  }
}

/** Capture the form body Twilio would receive, without a network call. */
function mockTwilioFetch() {
  const calls: URLSearchParams[] = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
    calls.push(init.body);
    // Simulate Twilio's response for an international (no-From) accept.
    return {
      ok: true,
      status: 201,
      json: async () => ({
        sid: "SM_fake_sid",
        status: "accepted",
        from: null,
        messaging_service_sid: "MG_test_service",
        num_segments: "1"
      })
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

describe("resolveLiveSmsSender (pure)", () => {
  afterEach(() => {
    for (const [key, value] of saved) (env as Record<string, unknown>)[key] = value;
    saved.clear();
  });

  it("+91 → Messaging Service only, no From", () => {
    setEnv({ TWILIO_US_SMS_FROM: "+17252202182" });
    const sender = resolveLiveSmsSender("+916396039675", "MG_x");
    expect(sender.messagingServiceSid).toBe("MG_x");
    expect(sender.from).toBeUndefined();
  });

  it("+1 → Messaging Service + configured US sender", () => {
    setEnv({ TWILIO_US_SMS_FROM: "+17252202182" });
    const sender = resolveLiveSmsSender("+16505551234", "MG_x");
    expect(sender.messagingServiceSid).toBe("MG_x");
    expect(sender.from).toBe("+17252202182");
  });

  it("+1 with no US sender configured → Messaging Service only", () => {
    setEnv({ TWILIO_US_SMS_FROM: "" });
    const sender = resolveLiveSmsSender("+16505551234", "MG_x");
    expect(sender.from).toBeUndefined();
  });

  it("other international (+44) → Messaging Service only", () => {
    setEnv({ TWILIO_US_SMS_FROM: "+17252202182" });
    expect(resolveLiveSmsSender("+447700900123", "MG_x").from).toBeUndefined();
  });
});

describe("sendTwilioSms live routing", () => {
  beforeEach(() => {
    setEnv(LIVE_ENV);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of saved) (env as Record<string, unknown>)[key] = value;
    saved.clear();
  });

  it("+91 sends with MessagingServiceSid and NO From", async () => {
    const { calls } = mockTwilioFetch();
    const result = await sendTwilioSms({ to: "+916396039675", body: "hi" });

    expect(calls).toHaveLength(1);
    const params = calls[0];
    expect(params.get("MessagingServiceSid")).toBe("MG_test_service");
    expect(params.get("From")).toBeNull();
    expect(params.get("To")).toBe("+916396039675");

    // status: accepted + from: null is a valid international acceptance.
    expect(result.status).toBe("accepted");
    expect(result.from).toBeNull();
    expect(result.messageSid).toBe("SM_fake_sid");
    expect(result.providerCalled).toBe(true);
  });

  it("+1 sends with MessagingServiceSid AND the configured US From", async () => {
    const { calls } = mockTwilioFetch();
    await sendTwilioSms({ to: "+16505551234", body: "hi" });

    const params = calls[0];
    expect(params.get("MessagingServiceSid")).toBe("MG_test_service");
    expect(params.get("From")).toBe("+17252202182");
    expect(params.get("To")).toBe("+16505551234");
  });

  it("rejects an invalid recipient BEFORE calling Twilio", async () => {
    const { fetchMock } = mockTwilioFetch();
    await expect(sendTwilioSms({ to: "12345", body: "hi" })).rejects.toBeInstanceOf(TwilioSmsError);
    await expect(sendTwilioSms({ to: "", body: "hi" })).rejects.toBeInstanceOf(TwilioSmsError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not hardcode the sender — omitting TWILIO_US_SMS_FROM drops the US From", async () => {
    setEnv({ TWILIO_US_SMS_FROM: "" });
    const { calls } = mockTwilioFetch();
    await sendTwilioSms({ to: "+16505551234", body: "hi" });
    expect(calls[0].get("From")).toBeNull();
    expect(calls[0].get("MessagingServiceSid")).toBe("MG_test_service");
  });
});

describe("validateSmsRecipientE164 gates before Twilio", () => {
  it("accepts full E.164 and rejects bare/short/leading-zero numbers", () => {
    expect(validateSmsRecipientE164("+916396039675").ok).toBe(true);
    expect(validateSmsRecipientE164("+16505551234").ok).toBe(true);
    expect(validateSmsRecipientE164("6396039675").ok).toBe(false);
    expect(validateSmsRecipientE164("+0123").ok).toBe(false);
    expect(validateSmsRecipientE164("").ok).toBe(false);
  });
});
