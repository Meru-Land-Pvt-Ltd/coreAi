import { env } from "../src/config/env";

const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
const base = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`;

async function main() {
  const res = await fetch(`${base}/Messages.json?PageSize=12`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  if (!res.ok) {
    console.error(`Twilio ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const data = (await res.json()) as { messages?: Array<Record<string, unknown>> };
  for (const message of data.messages ?? []) {
    console.log(
      JSON.stringify({
        sid: String(message.sid ?? "").slice(0, 10),
        to: String(message.to ?? "").replace(/\d(?=\d{4})/g, "*"),
        status: message.status,
        errorCode: message.error_code ?? null,
        dateCreated: message.date_created
      })
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
