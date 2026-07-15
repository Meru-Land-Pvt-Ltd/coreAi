import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { resolveTwilioSmsMode, validateSmsRecipientE164 } from "../src/modules/architect/twilio-connector";
import { sendTrackedSms } from "../src/modules/notifications/sms-notification-service";

/**
 * Manual shared-sender SMS test through the global Triven Messaging Service.
 *
 *   npm run test:twilio-sms --workspace=@coreai/backend -- \
 *     --to="+1XXXXXXXXXX" \
 *     --live
 *
 * Guard rails:
 * - --to is required and must normalize to E.164.
 * - Without --live the script refuses to send (dry-run summary only).
 * - Uses TWILIO_MESSAGING_SERVICE_SID; never a buyer From number.
 * - Creates an SmsExecution record; prints the Message SID + initial status.
 * - Never prints credentials.
 * - Only send to numbers you own or have explicit consent to text.
 */

function flagValue(name: string): string | undefined {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`) || Boolean(flagValue(name));
}

async function main() {
  const recipient = validateSmsRecipientE164(flagValue("to") ?? "");
  if (!recipient.ok) {
    console.error(`Invalid --to: ${recipient.error} Explicit E.164 is required, e.g. --to="+1XXXXXXXXXX".`);
    process.exitCode = 1;
    return;
  }
  const to = recipient.e164;

  const mode = resolveTwilioSmsMode();
  if (mode !== "LIVE") {
    console.log(`SMS mode: ${mode} — no real SMS will be delivered.`);
  }

  console.log("Shared-sender SMS test");
  console.log(`  To:                ${to}`);
  console.log(`  Mode:              ${mode}`);
  console.log(`  Messaging Service: ${env.TWILIO_MESSAGING_SERVICE_SID ?? "(not configured)"}`);
  console.log(`  Shared sender:     ${env.TWILIO_SHARED_SMS_NUMBER ?? "(not configured)"}`);
  console.log(`  Status callback:   ${env.TWILIO_SMS_STATUS_CALLBACK_URL ?? "(BACKEND_URL default)"}`);

  if (!hasFlag("live")) {
    console.log("\nRefusing to send without --live. Re-run with --live to actually send.");
    return;
  }

  const body = [
    "Hi there,",
    "",
    "This is a Triven shared-sender SMS test.",
    "",
    "Reply STOP to opt out."
  ].join("\n");

  const outcome = await sendTrackedSms({ to, body, messageType: "TEST_SMS" });

  if (!outcome.sent) {
    console.error(`\nSend FAILED: ${outcome.error ?? "unknown error"}${outcome.errorCode ? ` (Twilio code ${outcome.errorCode})` : ""}`);
    console.error(`SmsExecution id: ${outcome.executionId ?? "(none)"}`);
    process.exitCode = 1;
    return;
  }

  const modeNote = outcome.simulated
    ? " (SIMULATED — no provider call)"
    : outcome.testCredentials
      ? " (Twilio TEST credentials — accepted, not delivered)"
      : "";
  console.log(`\nAccepted${modeNote}.`);
  console.log(`  Message SID:     ${outcome.messageSid ?? "(none)"}`);
  console.log(`  Initial status:  ${outcome.status ?? "(unknown)"}`);
  console.log(`  SmsExecution id: ${outcome.executionId ?? "(none)"}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
