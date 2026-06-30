/**
 * Safe dev cleanup for draft-agent clutter on /architect/agents.
 *
 * Deletes ONLY draft WorkflowDefinitions for one architect that have:
 *   - no AgentListing (not submitted/published), AND
 *   - no InstalledAgent (not deployed as a live agent).
 * It NEVER deletes AgentListing rows, and never touches submitted/published or
 * deployed agents.
 *
 * Usage:
 *   npm run cleanup:draft-agents --workspace=@coreai/backend -- --email=architect@example.com
 *   npm run cleanup:draft-agents --workspace=@coreai/backend -- --user=<userId>
 *   npm run cleanup:draft-agents --workspace=@coreai/backend -- architect@example.com
 *   add --dry-run to only list what would be deleted.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

function getFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const userId = getFlag("user") ?? getFlag("userId");
  const email = getFlag("email") ?? process.argv.slice(2).find((arg) => !arg.startsWith("--"));

  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : email
      ? await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } } })
      : null;

  if (!user) {
    console.error("Architect not found. Provide --email=<architect email> or --user=<userId>.");
    process.exit(1);
    return;
  }

  const workflows = await prisma.workflowDefinition.findMany({
    where: { architectUserId: user.id },
    select: { id: true, name: true }
  });

  const listedIds = new Set(
    (
      await prisma.agentListing.findMany({
        where: { architectUserId: user.id, workflowId: { not: null } },
        select: { workflowId: true }
      })
    )
      .map((listing) => listing.workflowId)
      .filter((id): id is string => Boolean(id))
  );
  const deployedIds = new Set(
    (
      await prisma.installedAgent.findMany({
        where: { workflowId: { in: workflows.map((workflow) => workflow.id) } },
        select: { workflowId: true }
      })
    ).map((agent) => agent.workflowId)
  );

  const drafts = workflows.filter((workflow) => !listedIds.has(workflow.id) && !deployedIds.has(workflow.id));

  if (drafts.length === 0) {
    console.log(`No deletable draft workflows for ${user.email}. (Listings/deployed agents preserved.)`);
    return;
  }

  console.log(`${dryRun ? "[dry-run] Would delete" : "Deleting"} ${drafts.length} draft workflow(s) for ${user.email}:`);
  for (const draft of drafts) {
    console.log(`  - ${draft.name?.trim() || "(untitled)"}  [${draft.id}]`);
  }

  if (dryRun) {
    console.log("[dry-run] No changes made.");
    return;
  }

  const result = await prisma.workflowDefinition.deleteMany({
    where: { id: { in: drafts.map((draft) => draft.id) }, architectUserId: user.id }
  });
  console.log(`Deleted ${result.count} draft workflow(s). Listings and deployed agents were preserved.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
