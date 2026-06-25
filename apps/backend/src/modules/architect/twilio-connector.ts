import { env } from "../../config/env";

export type TwilioSmsResult = {
  id: string | null;
  to: string;
  body: string;
  from: string | null;
  providerCalled: boolean;
  twilioTestMode: boolean;
};

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function sendTwilioSms({
  to,
  body,
  from,
  messagingServiceSid
}: {
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
}): Promise<TwilioSmsResult> {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const isTwilioTestMode = env.TWILIO_TEST_MODE;
  const resolvedFrom = isTwilioTestMode
    ? "+15005550006"
    : from || env.TWILIO_PHONE_NUMBER;
  const resolvedMessagingServiceSid = isTwilioTestMode
    ? undefined
    : messagingServiceSid || env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || (!resolvedFrom && !resolvedMessagingServiceSid)) {
    throw new Error(
      "Twilio is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either a business phone number, TWILIO_PHONE_NUMBER, or TWILIO_MESSAGING_SERVICE_SID. For Twilio test credentials, set TWILIO_TEST_MODE=true."
    );
  }

  const bodyParams = new URLSearchParams({
    To: to,
    Body: body
  });

  if (resolvedMessagingServiceSid) {
    bodyParams.set("MessagingServiceSid", resolvedMessagingServiceSid);
  } else if (resolvedFrom) {
    bodyParams.set("From", resolvedFrom);
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
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
    from: resolvedFrom ?? null,
    providerCalled: true,
    twilioTestMode: isTwilioTestMode
  };
}
