import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { isVapiConfigured } from "../src/modules/architect/vapi-connector";
import { deployInstalledAgentVoiceAssistant } from "../src/modules/business/deploy";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const businessFlag = args.indexOf("--business");
  const onlyBusinessId = businessFlag >= 0 ? args[businessFlag + 1] : undefined;

  if (businessFlag >= 0 && !onlyBusinessId) {
    console.error("--business requires a business id.");
    process.exitCode = 1;
    return;
  }

  if (!isVapiConfigured()) {
    console.error("Vapi is not configured on this server (VAPI_API_KEY missing) — nothing to resync.");
    process.exitCode = 1;
    return;
  }

  const profiles = await prisma.businessProfile.findMany({
    where: {
      vapiAssistantId: { not: null },
      ...(onlyBusinessId ? { businessId: onlyBusinessId } : {})
    },
    select: {
      businessId: true,
      vapiAssistantId: true,
      business: {
        select: {
          name: true,
          installedAgents: {
            where: { status: "ACTIVE" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true }
          }
        }
      }
    },
    orderBy: { businessId: "asc" }
  });

  const targets = profiles.filter(
    (profile) =>
      profile.vapiAssistantId &&
      profile.vapiAssistantId !== env.VAPI_DEFAULT_ASSISTANT_ID &&
      profile.business.installedAgents.length > 0
  );
  const skipped = profiles.length - targets.length;

  if (targets.length === 0) {
    console.log(`No live assistants to resync${skipped ? ` (${skipped} profile(s) skipped: shared/default assistant or no ACTIVE installed agent)` : ""}.`);
    return;
  }

  console.log(`${apply ? "Resyncing" : "[dry-run] Would resync"} ${targets.length} live assistant(s)${skipped ? `; skipping ${skipped}` : ""}.`);

  let ok = 0;
  let failed = 0;
  let recreated = 0;

  for (const profile of targets) {
    const label = `${profile.business.name ?? profile.businessId} (${profile.businessId}, assistant ${profile.vapiAssistantId})`;

    if (!apply) {
      console.log(`[dry-run] ${label}`);
      continue;
    }

    try {
      const agentId = profile.business.installedAgents[0]?.id;
      if (agentId && profile.vapiAssistantId) {
        const row = await prisma.installedAgent.findUnique({
          where: { id: agentId },
          select: { configJson: true }
        });
        const config =
          row?.configJson && typeof row.configJson === "object" && !Array.isArray(row.configJson)
            ? (row.configJson as Record<string, unknown>)
            : {};
        if (config.vapiAssistantId !== profile.vapiAssistantId) {
          await prisma.installedAgent.update({
            where: { id: agentId },
            data: {
              configJson: { ...config, vapiAssistantId: profile.vapiAssistantId } as object
            }
          });
          console.log(
            `  backfilled configJson.vapiAssistantId for ${profile.businessId} (was ${
              config.vapiAssistantId ?? "missing"
            })`
          );
        }
      }

      const result = await deployInstalledAgentVoiceAssistant(profile.businessId);
      if (!result) {
        failed += 1;
        console.error(`FAILED ${label}: no deployable plan (agent config incomplete?).`);
        continue;
      }
      ok += 1;
      if (result.created) {
        recreated += 1;
        console.warn(`WARNING ${label}: assistant was re-created as ${result.assistantId} — verify the phone-number attachment for this business.`);
      } else {
        console.log(`OK ${label}: prompt updated in place.`);
      }
    } catch (error) {
      failed += 1;
      console.error(`FAILED ${label}:`, error instanceof Error ? error.message : error);
    }
  }

  if (apply) {
    console.log(`Done. ${ok} updated, ${failed} failed${recreated ? `, ${recreated} RE-CREATED (check phone attachments!)` : ""}.`);
    if (failed > 0) process.exitCode = 1;
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
