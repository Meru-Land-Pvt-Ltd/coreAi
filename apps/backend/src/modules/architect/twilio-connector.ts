import { env } from "../../config/env";

export type SendTwilioSmsInput = {
  to: string;
  body: string;
  /** Overrides TWILIO_SMS_STATUS_CALLBACK_URL (and the BACKEND_URL default). */
  statusCallbackUrl?: string;
  /** Free-form context for logs only — never sent to Twilio. */
  metadata?: Record<string, unknown>;
};

/** Explicit SMS sending modes — see resolveTwilioSmsMode(). */
export type TwilioSmsMode = "SIMULATED" | "TWILIO_TEST_CREDENTIALS" | "LIVE";

export type TwilioSmsResult = {
  /** Twilio Message SID (kept as `id` too for legacy readers of sentSms.id). */
  messageSid: string | null;
  id: string | null;
  status: string | null;
  to: string;
  from: string | null;
  messagingServiceSid: string | null;
  numSegments: number | null;
  price: string | null;
  priceUnit: string | null;
  body: string;
  providerCalled: boolean;
  mode: TwilioSmsMode;
  /** True only in SIMULATED mode — no Twilio request was made. */
  simulated: boolean;
  /** True only in TWILIO_TEST_CREDENTIALS mode — accepted by Twilio, never delivered. */
  testCredentials: boolean;
};

/** Twilio REST failure with the provider's error context preserved. */
export class TwilioSmsError extends Error {
  readonly twilioCode: number | null;
  readonly httpStatus: number;
  readonly moreInfo: string | null;

  constructor(message: string, opts: { twilioCode?: number | null; httpStatus?: number; moreInfo?: string | null }) {
    super(message);
    this.name = "TwilioSmsError";
    this.twilioCode = opts.twilioCode ?? null;
    this.httpStatus = opts.httpStatus ?? 500;
    this.moreInfo = opts.moreInfo ?? null;
  }
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function twilioRestAuthHeader(): string | null {
  const apiKeySid = env.TWILIO_API_KEY_SID;
  const apiKeySecret = env.TWILIO_API_KEY_SECRET;
  if (apiKeySid && apiKeySecret) {
    return `Basic ${Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString("base64")}`;
  }
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    return `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`;
  }
  return null;
}

export function isSmsDeliveryUnreliable(e164: string): boolean {
  if (!e164.startsWith("+")) return false;
  const digits = e164.slice(1);
  return env.SMS_UNRELIABLE_COUNTRY_PREFIXES.split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean)
    .some((prefix) => digits.startsWith(prefix));
}

export function normalizePhoneE164(raw?: string | null): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 10 ? `+${digits}` : "";
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10) return "";
  if (digits.length === 10) return /^[6-9]/.test(digits) ? `+91${digits}` : `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) {
    const national = digits.slice(1);
    return national.length === 10 ? (/^[6-9]/.test(national) ? `+91${national}` : `+1${national}`) : "";
  }
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

export type SmsRecipientValidation = { ok: true; e164: string } | { ok: false; error: string };

/**
 * Strict outbound-SMS recipient validation. SMS destinations must be EXPLICIT
 * E.164 — a bare ten-digit number is ambiguous between countries (e.g.
 * 7252202182 is a valid US Nevada number AND looks like an Indian mobile), so
 * it is rejected with a clear error instead of guessed. US numbers must be
 * +1XXXXXXXXXX. Separators like spaces/dashes/parentheses are tolerated.
 */
export function validateSmsRecipientE164(raw: string | null | undefined): SmsRecipientValidation {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "Recipient phone number is required." };
  }
  if (!trimmed.startsWith("+")) {
    return {
      ok: false,
      error:
        "Phone number must include the country code in E.164 format (e.g. +15551234567 for US). Bare national numbers are ambiguous and are not accepted."
    };
  }
  const digits = trimmed.slice(1).replace(/[\s().-]/g, "");
  if (!/^\d+$/.test(digits)) {
    return { ok: false, error: "Phone number contains invalid characters. Use E.164, e.g. +15551234567." };
  }
  if (digits.startsWith("0") || digits.length < 8 || digits.length > 15) {
    return { ok: false, error: "Phone number is not a valid E.164 number (8–15 digits after the country code)." };
  }
  return { ok: true, e164: `+${digits}` };
}

/** The public delivery-status callback URL Twilio posts message updates to. */
export function twilioSmsStatusCallbackUrl(): string {
  if (env.TWILIO_SMS_STATUS_CALLBACK_URL) return env.TWILIO_SMS_STATUS_CALLBACK_URL;
  return `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/twilio/message-status`;
}

/** Twilio "magic" test-credential sender — accepted, never delivered. */
const TWILIO_TEST_FROM_NUMBER = "+15005550006";

/**
 * The active SMS mode. Explicit TWILIO_SMS_MODE wins. The deprecated
 * TWILIO_TEST_MODE=true maps to SIMULATED — it must never trigger a Twilio
 * request with production credentials. Default is LIVE.
 */
export function resolveTwilioSmsMode(): TwilioSmsMode {
  if (env.TWILIO_SMS_MODE) return env.TWILIO_SMS_MODE;
  if (env.TWILIO_TEST_MODE) return "SIMULATED";
  return "LIVE";
}

type TwilioMessageResponse = {
  sid?: string;
  status?: string;
  from?: string | null;
  messaging_service_sid?: string | null;
  num_segments?: string | null;
  price?: string | null;
  price_unit?: string | null;
  message?: string;
  code?: number;
  more_info?: string;
};

/**
 * Send one SMS through the global Triven Messaging Service (shared sender).
 *
 * The buyer's voice number is NEVER the sender — this function does not accept
 * a from-number. Three explicit modes (resolveTwilioSmsMode):
 *
 * - SIMULATED: no network request at all; result is flagged simulated.
 * - TWILIO_TEST_CREDENTIALS: uses TWILIO_TEST_ACCOUNT_SID/TWILIO_TEST_AUTH_TOKEN
 *   (never production credentials) with Twilio's magic From number — the
 *   request is real, nothing is delivered.
 * - LIVE: production credentials + MessagingServiceSid; Twilio picks the
 *   shared Triven sender from the Messaging Service pool.
 *
 * A Twilio failure always surfaces as a TwilioSmsError — never a fake success.
 */
export async function sendTwilioSms({
  to,
  body,
  statusCallbackUrl,
  metadata
}: SendTwilioSmsInput): Promise<TwilioSmsResult> {
  const mode = resolveTwilioSmsMode();

  if (mode === "SIMULATED") {
    console.log("[twilio-sms] simulated (no provider request)", {
      to,
      bodyLength: body.length,
      ...(metadata ? { metadata } : {})
    });
    return {
      messageSid: null,
      id: null,
      status: "simulated",
      to,
      from: null,
      messagingServiceSid: null,
      numSegments: null,
      price: null,
      priceUnit: null,
      body,
      providerCalled: false,
      mode,
      simulated: true,
      testCredentials: false
    };
  }

  let accountSid: string;
  let authHeader: string;
  let messagingServiceSid: string | undefined;

  if (mode === "TWILIO_TEST_CREDENTIALS") {
    // Twilio TEST credentials only — production credentials are never used in
    // this mode, and magic numbers only work against the test account anyway.
    if (!env.TWILIO_TEST_ACCOUNT_SID || !env.TWILIO_TEST_AUTH_TOKEN) {
      throw new TwilioSmsError(
        "TWILIO_SMS_MODE=TWILIO_TEST_CREDENTIALS requires TWILIO_TEST_ACCOUNT_SID and TWILIO_TEST_AUTH_TOKEN.",
        { httpStatus: 500 }
      );
    }
    accountSid = env.TWILIO_TEST_ACCOUNT_SID;
    authHeader = `Basic ${Buffer.from(
      `${env.TWILIO_TEST_ACCOUNT_SID}:${env.TWILIO_TEST_AUTH_TOKEN}`
    ).toString("base64")}`;
    messagingServiceSid = undefined;
  } else {
    const liveAuthHeader = twilioRestAuthHeader();
    if (!env.TWILIO_ACCOUNT_SID || !liveAuthHeader) {
      throw new TwilioSmsError(
        "Twilio is not configured. Add TWILIO_ACCOUNT_SID plus TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET (or TWILIO_AUTH_TOKEN). For safe testing set TWILIO_SMS_MODE=SIMULATED.",
        { httpStatus: 500 }
      );
    }
    if (!env.TWILIO_MESSAGING_SERVICE_SID) {
      throw new TwilioSmsError(
        "TWILIO_MESSAGING_SERVICE_SID is not configured. Live SMS must go through the shared Triven Messaging Service.",
        { httpStatus: 500 }
      );
    }
    accountSid = env.TWILIO_ACCOUNT_SID;
    authHeader = liveAuthHeader;
    messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
  }

  const bodyParams = new URLSearchParams({
    To: to,
    Body: body
  });

  if (messagingServiceSid) {
    // Shared live mode: MessagingServiceSid only — Twilio selects the shared
    // Triven sender. Never combined with a From number.
    bodyParams.set("MessagingServiceSid", messagingServiceSid);
    const callback = statusCallbackUrl ?? twilioSmsStatusCallbackUrl();
    if (callback && callback.startsWith("https://")) {
      bodyParams.set("StatusCallback", callback);
    }
  } else {
    bodyParams.set("From", TWILIO_TEST_FROM_NUMBER);
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: bodyParams
    }
  );

  const responseJson = (await response.json().catch(() => ({}))) as TwilioMessageResponse;

  if (!response.ok) {
    // Never log or include the auth header/token — Twilio's message alone.
    throw new TwilioSmsError(responseJson.message ?? `Twilio SMS failed (${response.status})`, {
      twilioCode: typeof responseJson.code === "number" ? responseJson.code : null,
      httpStatus: response.status,
      moreInfo: typeof responseJson.more_info === "string" ? responseJson.more_info : null
    });
  }

  const numSegments = Number(responseJson.num_segments);

  return {
    messageSid: responseJson.sid ?? null,
    id: responseJson.sid ?? null,
    status: responseJson.status ?? null,
    to,
    from: responseJson.from ?? null,
    messagingServiceSid: responseJson.messaging_service_sid ?? messagingServiceSid ?? null,
    numSegments: Number.isFinite(numSegments) ? numSegments : null,
    price: responseJson.price ?? null,
    priceUnit: responseJson.price_unit ?? null,
    body,
    providerCalled: true,
    mode,
    simulated: false,
    testCredentials: mode === "TWILIO_TEST_CREDENTIALS"
  };
}
