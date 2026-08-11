import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/** Must match AGENT_BUSINESS_CONTEXT_VERSION in modules/business/routes.ts. */
const AGENT_BUSINESS_CONTEXT_VERSION = 2;

const APPLY = process.argv.includes("--apply");
/** Also stamp agents that never completed setup (they normally start blank). */
const INCLUDE_UNCONFIGURED = process.argv.includes("--include-unconfigured");

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function main() {
  const businesses = await prisma.business.findMany({
    include: {
      profile: true,
      installedAgents: { orderBy: { createdAt: "asc" } }
    }
  });

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for (const business of businesses) {
    const profile = business.profile;
    if (!profile) continue;

    for (const agent of business.installedAgents) {
      scanned += 1;

      const config = recordOf(agent.configJson);
      const details = recordOf(config.businessDetails);


      if (details.contextVersion === AGENT_BUSINESS_CONTEXT_VERSION) {
        skipped += 1;
        continue;
      }

      const wasConfigured =
        agent.status === "ACTIVE" ||
        typeof config.vapiAssistantId === "string" ||
        typeof config.assistantName === "string";

      if (!wasConfigured && !INCLUDE_UNCONFIGURED) {
        console.log(
          `SKIP (never configured, starts blank) ${business.name} / ${agent.name} (${agent.status})`
        );
        skipped += 1;
        continue;
      }

      // Merge onto whatever the agent already has: its own saved values win,
      // the shared profile only fills what was never per-agent.
      const nextDetails = {
        services: profile.services ?? [],
        faqs: profile.faqsJson ?? [],
        tone: profile.tone ?? null,
        escalationRules: profile.escalationRules ?? null,
        bookingUrl: profile.bookingUrl ?? null,
        teamPhone: profile.teamPhone ?? null,
        ...(profile.hoursJson ? { hours: profile.hoursJson } : {}),
        ...details,
        contextVersion: AGENT_BUSINESS_CONTEXT_VERSION
      };

      console.log(
        `${APPLY ? "UPDATE" : "WOULD UPDATE"} ${business.name} / ${agent.name} (${agent.id}) ` +
          `services=${(profile.services ?? []).length} faqs=${Array.isArray(profile.faqsJson) ? profile.faqsJson.length : 0}`
      );

      if (APPLY) {
        await prisma.installedAgent.update({
          where: { id: agent.id },
          data: { configJson: { ...config, businessDetails: nextDetails } as never }
        });
      }

      updated += 1;
    }
  }

  console.log("");
  console.log(`Mode:    ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`Scanned: ${scanned} installed agents`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped} (already own their business context)`);

  if (!APPLY && updated > 0) {
    console.log("\nRe-run with --apply to write these changes.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
