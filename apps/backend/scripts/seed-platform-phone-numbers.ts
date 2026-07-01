/**
 * Seed CoreAI/Twilio platform phone number(s) into PlatformPhoneNumber so buyer
 * setup Step 2 has a selectable number in local/dev.
 *
 * Usage:
 *   npm run seed:platform-phone-numbers --workspace=@coreai/backend
 *   npm run seed:platform-phone-numbers --workspace=@coreai/backend -- +15550100001 +15550100002|PNxxxxxxxx
 *   npm run seed:platform-phone-numbers --workspace=@coreai/backend -- --release-demo
 *
 * Each argument is "+1..." or "+1...|<twilioSid>". With no arguments the demo
 * number below is seeded. `--release-demo` (dev-only) un-assigns the demo number
 * so it returns to the AVAILABLE pool for buyer setup Step 2. No secrets here.
 *
 * Safe / idempotent:
 *   - upsert by phoneNumber, provider TWILIO
 *   - a NEW number is created AVAILABLE
 *   - an existing UNASSIGNED number is (re)set AVAILABLE
 *   - an existing ASSIGNED number is left untouched — never overwrite its status
 *     and never clear its businessId (so we can't steal another business's number)
 */
import { prisma } from "../src/lib/prisma";

const DEMO_NUMBER = "+18173985754";
const DEFAULT_NUMBERS = [DEMO_NUMBER];

function parseEntry(raw: string): { phoneNumber: string; sid?: string } {
  const [rawNumber, sid] = raw.split("|");
  return {
    phoneNumber: rawNumber.replace(/[^+\d]/g, ""),
    sid: sid?.trim() || undefined
  };
}

/**
 * DEV-ONLY: release the local demo number back to the AVAILABLE pool so it
 * reappears in buyer setup Step 2. Deletes its BusinessPhoneNumber mapping and
 * clears the PlatformPhoneNumber assignment. Only runs when --release-demo is
 * explicitly passed — the default seed never un-assigns anything.
 */
async function releaseDemoNumber() {
  // BusinessPhoneNumber has no inbound FKs, so removing the mapping is safe.
  await prisma.businessPhoneNumber.deleteMany({ where: { phoneNumber: DEMO_NUMBER } });

  await prisma.platformPhoneNumber.upsert({
    where: { phoneNumber: DEMO_NUMBER },
    update: { provider: "TWILIO", status: "AVAILABLE", businessId: null, assignedAt: null },
    create: { phoneNumber: DEMO_NUMBER, provider: "TWILIO", status: "AVAILABLE" }
  });

  console.log(`${DEMO_NUMBER} released and marked AVAILABLE for local demo.`);
}

async function main() {
  const rawArgs = process.argv
    .slice(2)
    .map((value) => value.trim())
    .filter(Boolean);

  // Explicit, dev-only escape hatch — never un-assign numbers automatically.
  if (rawArgs.includes("--release-demo")) {
    await releaseDemoNumber();
    return;
  }

  const numberArgs = rawArgs.filter((arg) => !arg.startsWith("--"));
  const entries = (numberArgs.length > 0 ? numberArgs : DEFAULT_NUMBERS).map(parseEntry).filter((entry) => entry.phoneNumber);

  for (const entry of entries) {
    const existing = await prisma.platformPhoneNumber.findUnique({
      where: { phoneNumber: entry.phoneNumber }
    });

    if (existing?.businessId) {
      console.log(`${existing.phoneNumber} is already ASSIGNED to a business — leaving as-is.`);
      continue;
    }

    if (existing) {
      const row = await prisma.platformPhoneNumber.update({
        where: { phoneNumber: entry.phoneNumber },
        data: {
          provider: "TWILIO",
          status: "AVAILABLE",
          ...(entry.sid ? { twilioSid: entry.sid } : {})
        }
      });
      console.log(`Updated ${row.phoneNumber} -> ${row.status}`);
    } else {
      const row = await prisma.platformPhoneNumber.create({
        data: {
          phoneNumber: entry.phoneNumber,
          twilioSid: entry.sid ?? null,
          provider: "TWILIO",
          status: "AVAILABLE"
        }
      });
      console.log(`Created ${row.phoneNumber} -> ${row.status}`);
    }
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
