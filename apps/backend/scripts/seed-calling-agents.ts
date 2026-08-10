/**
 * Creates approved calling-agent workflows as unpublished drafts for one
 * Architect account. Safe to rerun: matching drafts are skipped unless --force
 * is supplied; submitted, listed, or deployed workflows are untouched.
 *
 * Usage:
 *   npm run seed:calling-agents -- --email=architect@example.com --group=remaining
 *   npm run seed:calling-agents -- --email=architect@example.com --group=remaining --force
 *   npm run seed:calling-agents -- --email=architect@example.com --group=remaining --dry-run
 */
import "dotenv/config";
import { buildMarketplacePreview } from "@coreai/shared";
import { prisma } from "../src/lib/prisma";
import {
  CALLING_AGENT_DRAFT_VERSION,
  buildAllCallingAgentDraftDefinitions,
  buildCallingAgentDraftDefinitions,
  buildRemainingCallingAgentDraftDefinitions
} from "../src/modules/architect/calling-agent-drafts";

type DraftGroup = "existing" | "remaining" | "all";

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim();
}

async function main() {
  const email = (flag("email") ?? "").toLowerCase();
  const group = (flag("group") ?? "remaining") as DraftGroup;
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");

  if (!email) {
    throw new Error("Provide the Architect account with --email=<architect email>.");
  }

  if (!(["existing", "remaining", "all"] as const).includes(group)) {
    throw new Error("Invalid --group. Use --group=remaining, --group=existing, or --group=all.");
  }

  const architect = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      OR: [
        { role: "ARCHITECT" },
        { roleMemberships: { some: { role: "ARCHITECT" } } }
      ]
    },
    select: { id: true, email: true, fullName: true }
  });

  if (!architect) {
    throw new Error(`Architect account not found: ${email}`);
  }

  const definitions =
    group === "remaining"
      ? buildRemainingCallingAgentDraftDefinitions()
      : group === "all"
        ? buildAllCallingAgentDraftDefinitions()
        : buildCallingAgentDraftDefinitions();
  const architectName = architect.fullName?.trim() || architect.email;
  const results: Array<{ name: string; action: "created" | "updated" | "skipped"; id?: string }> = [];

  for (const definition of definitions) {
    const existing = await prisma.workflowDefinition.findFirst({
      where: {
        architectUserId: architect.id,
        name: definition.name,
        reviewStatus: "DRAFT",
        publishStatus: "DRAFT",
        listings: { none: {} },
        installedAgents: { none: {} }
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true }
    });

    if (existing && !force) {
      results.push({ name: definition.name, action: "skipped", id: existing.id });
      continue;
    }

    if (dryRun) {
      results.push({
        name: definition.name,
        action: existing ? "updated" : "created",
        ...(existing ? { id: existing.id } : {})
      });
      continue;
    }

    const marketplace = buildMarketplacePreview(definition.configure, architectName);
    const data = {
      description: definition.description,
      workflowJson: definition.workflowJson as never,
      configureJson: {
        ...definition.configure,
        seed: {
          key: definition.key,
          version: CALLING_AGENT_DRAFT_VERSION,
          group,
          sourceCategory: definition.sourceCategory,
          sourceSubcategory: definition.sourceSubcategory
        }
      } as never,
      marketplaceJson: marketplace as never,
      requiredIntegrations: definition.configure.template.requiredIntegrations as never,
      buyerSetupSchema: definition.configure.template.requiredBuyerSetup as never,
      publishChecklist: definition.configure.compliance.complianceChecks as never,
      reviewStatus: "DRAFT" as const,
      publishStatus: "DRAFT" as const,
      isTemplate: false
    };

    const saved = existing
      ? await prisma.workflowDefinition.update({ where: { id: existing.id }, data })
      : await prisma.workflowDefinition.create({
          data: {
            architectUserId: architect.id,
            name: definition.name,
            ...data
          }
        });

    results.push({ name: definition.name, action: existing ? "updated" : "created", id: saved.id });
  }

  console.log(`Calling-agent drafts for ${architect.email} (${group} group):`);
  for (const result of results) {
    console.log(`  ${result.action.toUpperCase().padEnd(7)} ${result.name}${result.id ? ` [${result.id}]` : ""}`);
  }
  console.log(`Summary: ${results.filter((item) => item.action === "created").length} created, ${results.filter((item) => item.action === "updated").length} updated, ${results.filter((item) => item.action === "skipped").length} skipped.${dryRun ? " No database changes were made." : " All remain unpublished drafts."}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
