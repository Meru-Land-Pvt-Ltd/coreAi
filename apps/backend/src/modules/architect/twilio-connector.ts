import { env } from "../../config/env";

export type TwilioSmsResult = {
  id: string | null;
  to: string;
  body: string;
  providerCalled: boolean;
  twilioTestMode: boolean;
};

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

export async function sendTwilioSms({
  to,
  body,
  fromPhoneNumber
}: {
  to: string;
  body: string;
  fromPhoneNumber?: string | null;
}): Promise<TwilioSmsResult> {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authHeader = twilioRestAuthHeader();
  const isTwilioTestMode = env.TWILIO_TEST_MODE;
  const from = isTwilioTestMode ? "+15005550006" : fromPhoneNumber || env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = isTwilioTestMode
    ? undefined
    : env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authHeader || (!from && !messagingServiceSid)) {
    throw new Error(
      "Twilio is not configured. Add TWILIO_ACCOUNT_SID plus TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET (or TWILIO_AUTH_TOKEN), and an assigned business number (or TWILIO_MESSAGING_SERVICE_SID). For Twilio test credentials, set TWILIO_TEST_MODE=true."
    );
  }

  const bodyParams = new URLSearchParams({
    To: to,
    Body: body
  });

  if (messagingServiceSid) {
    bodyParams.set("MessagingServiceSid", messagingServiceSid);
  } else if (from) {
    bodyParams.set("From", from);
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

  const responseJson = (await response.json()) as {
    sid?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(responseJson.message ?? "Twilio SMS failed");
  }

  return {
    id: responseJson.sid ?? null,
    to,
    body,
    providerCalled: true,
    twilioTestMode: isTwilioTestMode
  };
}
