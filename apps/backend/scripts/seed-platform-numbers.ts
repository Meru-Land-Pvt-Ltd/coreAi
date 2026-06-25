/**
 * Seed pre-provisioned CoreAI/Twilio phone numbers into PlatformPhoneNumber so
 * the buyer setup flow has numbers to assign.
 *
 * Usage:
 *   npm run seed:numbers --workspace=@coreai/backend
 *   npm run seed:numbers --workspace=@coreai/backend -- +15550100001 +15550100002|PNxxxxxxxx
 *
 * Each argument is either "+15550100001" or "+15550100001|<twilioSid>".
 * With no arguments, a small default test set is seeded.
 */
import { prisma } from "../src/lib/prisma";

function parseEntry(raw: string): { phoneNumber: string; sid?: string } {
  const [rawNumber, sid] = raw.split("|");
  return {
    phoneNumber: rawNumber.replace(/[^+\d]/g, ""),
    sid: sid?.trim() || undefined
  };
}

async function main() {
  const args = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
  const defaults = ["+15550100001", "+15550100002", "+15550100003"];
  const entries = (args.length > 0 ? args : defaults).map(parseEntry).filter((e) => e.phoneNumber);

  for (const entry of entries) {
    const row = await prisma.platformPhoneNumber.upsert({
      where: { phoneNumber: entry.phoneNumber },
      update: { twilioSid: entry.sid ?? undefined },
      create: {
        phoneNumber: entry.phoneNumber,
        twilioSid: entry.sid ?? null,
        provider: "TWILIO",
        status: "AVAILABLE"
      }
    });
    console.log(`Seeded ${row.phoneNumber} -> ${row.status}`);
  }

  console.log(`Done. ${entries.length} platform number(s) processed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
