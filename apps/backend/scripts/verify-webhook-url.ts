import { env } from "../src/config/env";
import { buildPublicWebhookUrl } from "../src/modules/architect/twilio-business-routing";

const VOICE_ROUTE = "/architect/connectors/twilio/voice";
const SMS_ROUTE = "/architect/connectors/twilio/inbound-sms";

function expect(label: string, actual: string, expected: string): boolean {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) {
    console.log(`     expected: ${expected}`);
    console.log(`     actual:   ${actual}`);
  }
  return ok;
}

const base = env.BACKEND_URL.replace(/\/$/, "");
let basePath = "";
try {
  basePath = new URL(base).pathname.replace(/\/$/, "");
} catch {
  basePath = "";
}

const expectedVoice = `${base}${VOICE_ROUTE}`;

let allOk = true;
// Proxy strips the prefix (normal nginx `location /api/ { proxy_pass ...:8787/; }`).
allOk = expect("proxy strips prefix", buildPublicWebhookUrl(VOICE_ROUTE), expectedVoice) && allOk;
// Proxy does NOT strip the prefix — must not double it.
if (basePath) {
  allOk = expect(
    "proxy keeps prefix (no doubling)",
    buildPublicWebhookUrl(`${basePath}${VOICE_ROUTE}`),
    expectedVoice
  ) && allOk;
}
// Query strings survive (Twilio signs them too).
allOk = expect(
  "query string preserved",
  buildPublicWebhookUrl(VOICE_ROUTE, "?to=%2B17252202182"),
  `${expectedVoice}?to=%2B17252202182`
) && allOk;

console.log("");
console.log("Paste into the Twilio console for every platform number:");
console.log(`  Voice webhook (POST): ${expectedVoice}`);
console.log(`  SMS webhook   (POST): ${base}${SMS_ROUTE}`);
console.log("");
console.log(`Signature validation: ${env.TWILIO_VALIDATE_SIGNATURE ? "ON" : "OFF (set TWILIO_VALIDATE_SIGNATURE=true in production)"}`);

if (!allOk) process.exitCode = 1;
