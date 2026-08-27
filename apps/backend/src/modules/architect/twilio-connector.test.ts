import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import {
  TwilioSmsError,
  normalizePhoneE164,
  resolveTwilioSmsMode,
  sendTwilioSms,
  validateSmsRecipientE164
} from "./twilio-connector";

/**
 * Unit tests for the shared-sender Twilio connector. All Twilio traffic is a
 * stubbed global fetch — no real message is ever sent.
 */

const PROD_SID = "ACprod00000000000000000000000000";
const TEST_SID = "ACtest00000000000000000000000000";

const originalEnv = {
  TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY_SID: env.TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET: env.TWILIO_API_KEY_SECRET,
  TWILIO_MESSAGING_SERVICE_SID: env.TWILIO_MESSAGING_SERVICE_SID,
  TWILIO_SMS_MODE: env.TWILIO_SMS_MODE,
  TWILIO_TEST_ACCOUNT_SID: env.TWILIO_TEST_ACCOUNT_SID,
  TWILIO_TEST_AUTH_TOKEN: env.TWILIO_TEST_AUTH_TOKEN,
  TWILIO_TEST_MODE: env.TWILIO_TEST_MODE,
  TWILIO_SMS_STATUS_CALLBACK_URL: env.TWILIO_SMS_STATUS_CALLBACK_URL
};

function stubTwilioResponse(status: number, body: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return String((fetchMock.mock.calls[0] as unknown[])[0]);
}

function sentParams(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams {
  const call = fetchMock.mock.calls[0] as unknown[];
  const init = call[1] as { body: URLSearchParams };
  return init.body;
}

function sentAuthHeader(fetchMock: ReturnType<typeof vi.fn>): string {
  const call = fetchMock.mock.calls[0] as unknown[];
  const init = call[1] as { headers: Record<string, string> };
  return init.headers.Authorization;
}

beforeEach(() => {
  env.TWILIO_ACCOUNT_SID = PROD_SID;
  env.TWILIO_AUTH_TOKEN = "prod-auth-token";
  env.TWILIO_API_KEY_SID = undefined;
  env.TWILIO_API_KEY_SECRET = undefined;
  env.TWILIO_MESSAGING_SERVICE_SID = "MGtest0000000000000000000000000000";
  env.TWILIO_SMS_MODE = "LIVE";
  env.TWILIO_TEST_ACCOUNT_SID = undefined;
  env.TWILIO_TEST_AUTH_TOKEN = undefined;
  env.TWILIO_TEST_MODE = false;
  env.TWILIO_SMS_STATUS_CALLBACK_URL = "https://triven.ai/api/architect/connectors/twilio/message-status";
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

describe("resolveTwilioSmsMode", () => {
  it("prefers the explicit TWILIO_SMS_MODE", () => {
    env.TWILIO_SMS_MODE = "TWILIO_TEST_CREDENTIALS";
    expect(resolveTwilioSmsMode()).toBe("TWILIO_TEST_CREDENTIALS");
  });

  it("maps the deprecated TWILIO_TEST_MODE=true to SIMULATED", () => {
    env.TWILIO_SMS_MODE = undefined;
    env.TWILIO_TEST_MODE = true;
    expect(resolveTwilioSmsMode()).toBe("SIMULATED");
  });

  it("defaults to LIVE", () => {
    env.TWILIO_SMS_MODE = undefined;
    env.TWILIO_TEST_MODE = false;
    expect(resolveTwilioSmsMode()).toBe("LIVE");
  });
});

describe("sendTwilioSms (LIVE)", () => {
  it("sends via MessagingServiceSid and never a From number", async () => {
    const fetchMock = stubTwilioResponse(201, {
      sid: "SMtest",
      status: "queued",
      from: null,
      messaging_service_sid: "MGtest0000000000000000000000000000",
      num_segments: "1"
    });

    const result = await sendTwilioSms({ to: "+15551230000", body: "hello" });

    const params = sentParams(fetchMock);
    expect(params.get("MessagingServiceSid")).toBe("MGtest0000000000000000000000000000");
    expect(params.get("From")).toBeNull();
    expect(params.get("StatusCallback")).toBe(
      "https://triven.ai/api/architect/connectors/twilio/message-status"
    );
    expect(result.messageSid).toBe("SMtest");
    expect(result.status).toBe("queued");
    expect(result.numSegments).toBe(1);
    expect(result.simulated).toBe(false);
    expect(result.testCredentials).toBe(false);
    expect(result.mode).toBe("LIVE");
  });

  it("fails loudly when the Messaging Service is not configured", async () => {
    env.TWILIO_MESSAGING_SERVICE_SID = undefined;
    stubTwilioResponse(201, { sid: "SMnever" });

    await expect(sendTwilioSms({ to: "+15551230000", body: "x" })).rejects.toThrow(
      /TWILIO_MESSAGING_SERVICE_SID/
    );
  });

  it("fails loudly when Twilio is unconfigured (never silently simulates)", async () => {
    env.TWILIO_ACCOUNT_SID = undefined;
    env.TWILIO_AUTH_TOKEN = undefined;

    await expect(sendTwilioSms({ to: "+15551230000", body: "x" })).rejects.toThrow(/not configured/);
  });

  it("returns Twilio failures as failures with the error code preserved", async () => {
    stubTwilioResponse(400, {
      code: 21610,
      message: "The recipient has opted out",
      more_info: "https://www.twilio.com/docs/errors/21610"
    });

    const error = await sendTwilioSms({ to: "+15551230000", body: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TwilioSmsError);
    const twilioError = error as TwilioSmsError;
    expect(twilioError.twilioCode).toBe(21610);
    expect(twilioError.httpStatus).toBe(400);
    expect(twilioError.moreInfo).toContain("21610");
    // Never leaks credentials.
    expect(twilioError.message).not.toContain("prod-auth-token");
  });
});

describe("sendTwilioSms (SIMULATED)", () => {
  it("makes no network request and returns simulated:true", async () => {
    env.TWILIO_SMS_MODE = "SIMULATED";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTwilioSms({ to: "+15551230000", body: "x" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.simulated).toBe(true);
    expect(result.testCredentials).toBe(false);
    expect(result.providerCalled).toBe(false);
    expect(result.status).toBe("simulated");
    expect(result.mode).toBe("SIMULATED");
  });

  it("deprecated TWILIO_TEST_MODE=true simulates even with production credentials configured", async () => {
    env.TWILIO_SMS_MODE = undefined;
    env.TWILIO_TEST_MODE = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTwilioSms({ to: "+15551230000", body: "x" });

    // Never a silent Twilio API request with production credentials.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.simulated).toBe(true);
    expect(result.mode).toBe("SIMULATED");
  });
});

describe("sendTwilioSms (TWILIO_TEST_CREDENTIALS)", () => {
  it("uses ONLY the test credentials with the magic From number", async () => {
    env.TWILIO_SMS_MODE = "TWILIO_TEST_CREDENTIALS";
    env.TWILIO_TEST_ACCOUNT_SID = TEST_SID;
    env.TWILIO_TEST_AUTH_TOKEN = "test-cred-token";
    const fetchMock = stubTwilioResponse(201, { sid: "SMtestcred", status: "queued" });

    const result = await sendTwilioSms({ to: "+15551230000", body: "x" });

    const params = sentParams(fetchMock);
    expect(sentUrl(fetchMock)).toContain(TEST_SID);
    expect(sentUrl(fetchMock)).not.toContain(PROD_SID);
    expect(params.get("From")).toBe("+15005550006");
    expect(params.get("MessagingServiceSid")).toBeNull();

    const expectedAuth = `Basic ${Buffer.from(`${TEST_SID}:test-cred-token`).toString("base64")}`;
    expect(sentAuthHeader(fetchMock)).toBe(expectedAuth);
    // Production credentials never appear in the request.
    expect(sentAuthHeader(fetchMock)).not.toContain(
      Buffer.from(`${PROD_SID}:prod-auth-token`).toString("base64")
    );

    expect(result.simulated).toBe(false);
    expect(result.testCredentials).toBe(true);
    expect(result.mode).toBe("TWILIO_TEST_CREDENTIALS");
  });

  it("refuses to run without dedicated test credentials", async () => {
    env.TWILIO_SMS_MODE = "TWILIO_TEST_CREDENTIALS";
    env.TWILIO_TEST_ACCOUNT_SID = undefined;
    env.TWILIO_TEST_AUTH_TOKEN = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTwilioSms({ to: "+15551230000", body: "x" })).rejects.toThrow(
      /TWILIO_TEST_ACCOUNT_SID/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("validateSmsRecipientE164 (strict outbound-SMS validation)", () => {
  it("keeps +17252202182 unchanged", () => {
    expect(validateSmsRecipientE164("+17252202182")).toEqual({ ok: true, e164: "+17252202182" });
  });

  it("rejects a bare 10-digit number as ambiguous (never guesses IN vs US)", () => {
    const result = validateSmsRecipientE164("7252202182");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/country code/i);
  });

  it("keeps +919876543210 valid", () => {
    expect(validateSmsRecipientE164("+919876543210")).toEqual({ ok: true, e164: "+919876543210" });
  });

  it("tolerates separators but normalizes them away", () => {
    expect(validateSmsRecipientE164("+1 (725) 220-2182")).toEqual({ ok: true, e164: "+17252202182" });
  });

  it("rejects malformed values", () => {
    expect(validateSmsRecipientE164("").ok).toBe(false);
    expect(validateSmsRecipientE164("abc").ok).toBe(false);
    expect(validateSmsRecipientE164("+abc123").ok).toBe(false);
    expect(validateSmsRecipientE164("+0123456789").ok).toBe(false); // country code can't start with 0
    expect(validateSmsRecipientE164("+1234").ok).toBe(false); // too short
    expect(validateSmsRecipientE164("+1234567890123456").ok).toBe(false); // > 15 digits
  });
});

describe("normalizePhoneE164 — a bare ten-digit number is a US number", () => {
  it("no longer guesses the country from the first digit", () => {
    /* This used to read 6 through 9 as India. Most US area codes start 6
       through 9 — 650, 718, 916 — so a Sacramento practice typing their own
       team phone had every transfer and every text dialled to India. The
       calls simply never arrived, and nobody would have reported it as a
       country-code problem. */
    expect(normalizePhoneE164("+1 (555) 123-0000")).toBe("+15551230000");
    expect(normalizePhoneE164("5551230000")).toBe("+15551230000");
    expect(normalizePhoneE164("9165551234")).toBe("+19165551234");
    expect(normalizePhoneE164("7185551234")).toBe("+17185551234");
    expect(normalizePhoneE164("bad")).toBe("");
  });

  it("still honours a country code somebody typed themselves", () => {
    expect(normalizePhoneE164("+919876543210")).toBe("+919876543210");
    expect(normalizePhoneE164("+44 20 7946 0958")).toBe("+442079460958");
  });
});
