/**
 * List a buyer's InstalledAgents with their current phone assignment.
 *
 * Read-only. Prints the InstalledAgent IDs you pass to
 * scripts/assign-existing-twilio-number.ts --agent-id=...
 *
 * Usage:
 *   npx tsx scripts/list-installed-agents.ts --email=triventest@gmail.com
 *   npx tsx scripts/list-installed-agents.ts --email=triventest@gmail.com --json
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item?.slice(prefix.length).trim() || undefined;
}

async function main() {
  const email = argValue("email");
  const asJson = process.argv.includes("--json");

  if (!email) {
    console.error("Pass the buyer account with --email=<owner-email>.");
    process.exit(1);
  }

  // Owner email is matched case-insensitively: logins are email-first and the
  // stored casing is not guaranteed to match what was typed here.
  const businesses = await prisma.business.findMany({
    where: { owner: { email: { equals: email, mode: "insensitive" } } },
    select: {
      id: true,
      name: true,
      type: true,
      owner: { select: { id: true, email: true } },
      installedAgents: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          status: true,
          installSource: true,
          createdAt: true,
          phoneNumbers: {
            select: {
              phoneNumber: true,
              isActive: true,
              forwardToPhone: true,
              twilioPhoneNumberSid: true
            }
          }
        }
      }
    }
  });

  if (businesses.length === 0) {
    console.error(`No Business rows are owned by ${email}.`);
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify(businesses, null, 2));
    return;
  }

  for (const business of businesses) {
    console.log(`\nBusiness: ${business.name} (${business.type})`);
    console.log(`  businessId: ${business.id}`);
    console.log(`  owner:      ${business.owner.email} (${business.owner.id})`);

    if (business.installedAgents.length === 0) {
      console.log("  (no installed agents)");
      continue;
    }

    console.log(`  installed agents: ${business.installedAgents.length}`);

    for (const agent of business.installedAgents) {
      // The active row is what routing actually uses; inactive rows are
      // released numbers kept for history.
      const active = agent.phoneNumbers.find((item) => item.isActive);
      const numberLabel = active
        ? `${active.phoneNumber}${active.forwardToPhone ? ` → ${active.forwardToPhone}` : " (no forwarding)"}`
        : "UNASSIGNED";

      console.log("");
      console.log(`    ${agent.name}`);
      console.log(`      agent-id: ${agent.id}`);
      console.log(`      status:   ${agent.status} / ${agent.installSource}`);
      console.log(`      number:   ${numberLabel}`);
    }
  }

  console.log("");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
