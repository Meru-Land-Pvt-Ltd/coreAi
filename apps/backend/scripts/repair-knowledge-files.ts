/* eslint-disable no-console */
/**
 * Verify and repair buyer knowledge documents (PDF/DOCX/TXT).
 *
 * Dry-run (default):  npx tsx scripts/repair-knowledge-files.ts
 * Apply fixes:        npx tsx scripts/repair-knowledge-files.ts --apply
 * One business only:  npx tsx scripts/repair-knowledge-files.ts --business <id> [--apply]
 *
 * For every stored document this checks that the source bytes exist, that
 * extracted chunks exist, belong to the right business + installed agent, and
 * match the recorded chunk count. Broken documents are re-extracted from the
 * stored bytes (no re-upload needed); documents without bytes are marked
 * REUPLOAD_REQUIRED. Idempotent — re-running on a healthy corpus changes
 * nothing. With --apply, affected businesses' live assistants are re-synced.
 */
import { prisma } from "../src/lib/prisma";
import { repairKnowledgeFiles } from "../src/modules/business/knowledge-files";
import { refreshLiveAssistantKnowledge } from "../src/modules/business/deploy";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const businessFlag = args.indexOf("--business");
  const businessId = businessFlag >= 0 ? args[businessFlag + 1] : undefined;

  console.log(`[repair-knowledge] mode=${apply ? "APPLY" : "dry-run"}${businessId ? ` business=${businessId}` : ""}`);

  const reports = await repairKnowledgeFiles({ apply, businessId });

  if (reports.length === 0) {
    console.log("[repair-knowledge] no stored documents found.");
    return;
  }

  let healthy = 0;
  const touchedBusinesses = new Set<string>();

  for (const report of reports) {
    if (report.action === "ok") {
      healthy += 1;
      continue;
    }
    touchedBusinesses.add(report.businessId);
    console.log(
      `[repair-knowledge] ${report.action.toUpperCase()} file=${report.fileId} "${report.filename}" ` +
        `business=${report.businessId} agent=${report.installedAgentId ?? "-"} ` +
        `chunks recorded=${report.recordedChunkCount} actual=${report.actualChunkCount} misScoped=${report.misScopedChunks} ` +
        `bytes=${report.hasSourceBytes ? "yes" : "MISSING"}${report.error ? ` error="${report.error}"` : ""}`
    );
  }

  console.log(`[repair-knowledge] total=${reports.length} healthy=${healthy} needing-action=${reports.length - healthy}`);

  if (apply && touchedBusinesses.size > 0) {
    for (const id of touchedBusinesses) {
      const sync = await refreshLiveAssistantKnowledge(id);
      console.log(
        `[repair-knowledge] live sync business=${id} attempted=${sync.attempted} ok=${sync.ok}${sync.error ? ` error="${sync.error}"` : ""}`
      );
    }
  } else if (!apply && reports.length - healthy > 0) {
    console.log("[repair-knowledge] dry-run only — re-run with --apply to fix the documents listed above.");
  }
}

main()
  .catch((error) => {
    console.error("[repair-knowledge] failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
