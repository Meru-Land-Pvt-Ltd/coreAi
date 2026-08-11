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

      const multiAgent = business.installedAgents.length > 1;

      const ownsSomething = ["services", "faqs", "tone", "escalationRules", "bookingUrl", "teamPhone", "hours"]
        .some((key) => {
          const value = details[key];
          if (Array.isArray(value)) return value.length > 0;
          return typeof value === "string" ? value.trim().length > 0 : value != null;
        });

      if (multiAgent && !ownsSomething) {
        console.log(
          `SKIP (multi-agent, no own context — keeps profile fallback) ${business.name} / ${agent.name}`
        );
        skipped += 1;
        continue;
      }

      const shared = multiAgent
        ? {}
        : {
          services: profile.services ?? [],
          faqs: profile.faqsJson ?? [],
          tone: profile.tone ?? null,
          escalationRules: profile.escalationRules ?? null,
          bookingUrl: profile.bookingUrl ?? null,
          teamPhone: profile.teamPhone ?? null,
          ...(profile.hoursJson ? { hours: profile.hoursJson } : {})
        };

      // The agent's own saved values always win over anything shared.
      const nextDetails = {
        ...shared,
        ...details,
        contextVersion: AGENT_BUSINESS_CONTEXT_VERSION
      };

      // Report what will actually be WRITTEN, not what the profile happens to
      // hold — the merge means the agent's own values usually win.
      const writtenServices = Array.isArray(nextDetails.services) ? nextDetails.services.length : 0;
      const writtenFaqs = Array.isArray(nextDetails.faqs) ? nextDetails.faqs.length : 0;
      const source = multiAgent ? "own-only (multi-agent)" : "own+profile";

      console.log(
        `${APPLY ? "UPDATE" : "WOULD UPDATE"} ${business.name} / ${agent.name} (${agent.id}) ` +
          `services=${writtenServices} faqs=${writtenFaqs} [${source}]`
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
