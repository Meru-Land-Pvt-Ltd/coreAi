import { env } from "../src/config/env";

const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
const base = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`;

async function main() {
  const callsRes = await fetch(`${base}/Calls.json?PageSize=10`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  if (!callsRes.ok) {
    console.error(`Twilio calls ${callsRes.status}: ${await callsRes.text()}`);
    process.exit(1);
  }
  const calls = (await callsRes.json()) as { calls?: Array<Record<string, unknown>> };
  console.log("--- Recent Twilio calls ---");
  for (const call of calls.calls ?? []) {
    console.log(
      JSON.stringify({
        sid: String(call.sid ?? "").slice(0, 12),
        direction: call.direction,
        status: call.status,
        durationSec: call.duration,
        to: String(call.to ?? "").replace(/\d(?=\d{4})/g, "*"),
        start: call.start_time
      })
    );
  }

  const numbersRes = await fetch(`${base}/IncomingPhoneNumbers.json?PageSize=10`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  const numbers = (await numbersRes.json()) as { incoming_phone_numbers?: Array<Record<string, unknown>> };
  console.log("--- Incoming numbers (voice webhook) ---");
  for (const number of numbers.incoming_phone_numbers ?? []) {
    console.log(
      JSON.stringify({
        number: String(number.phone_number ?? "").replace(/\d(?=\d{4})/g, "*"),
        voiceUrl: number.voice_url,
        statusCallback: number.status_callback || null
      })
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
