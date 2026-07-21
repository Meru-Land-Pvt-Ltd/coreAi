import { prisma } from "../src/lib/prisma";
import { isSandboxExecutionBusiness } from "../src/modules/architect/twilio-business-routing";

const DRY_RUN = process.argv.includes("--dry-run");

const TEST_PURPOSES = new Set(["ARCHITECT_TEST", "BUYER_SETUP_PREVIEW", "MARKETPLACE_DEMO"]);

function storedPurpose(metadataJson: unknown): string {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) return "";
  const body = metadataJson as Record<string, unknown>;

  const candidates: unknown[] = [];
  const message = body.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const call = (message as Record<string, unknown>).call;
    if (call && typeof call === "object" && !Array.isArray(call)) {
      candidates.push((call as Record<string, unknown>).metadata);
    }
  }
  candidates.push(body.metadata);

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const purpose = (candidate as Record<string, unknown>).purpose;
      if (typeof purpose === "string" && purpose) return purpose;
    }
  }
  return "";
}

async function main() {
  const rows = await prisma.vapiCall.findMany({
    where: { executionMode: "ARCHITECT_DRY_RUN" },
    select: { id: true, callId: true, businessId: true, installedAgentId: true, metadataJson: true },
    orderBy: { createdAt: "desc" }
  });

  console.log(`[backfill] ${rows.length} ARCHITECT_DRY_RUN calls to inspect${DRY_RUN ? " (dry run)" : ""}`);

  let reclassified = 0;
  let keptTestPurpose = 0;
  let keptSandbox = 0;

  for (const row of rows) {
    const purpose = storedPurpose(row.metadataJson);
    if (TEST_PURPOSES.has(purpose)) {
      keptTestPurpose += 1;
      continue;
    }

    const sandbox = await isSandboxExecutionBusiness(row.businessId, row.installedAgentId ?? undefined);
    if (sandbox) {
      keptSandbox += 1;
      continue;
    }

    if (!DRY_RUN) {
      await prisma.vapiCall.update({ where: { id: row.id }, data: { executionMode: "LIVE" } });
    }
    reclassified += 1;
    console.log(`[backfill] ${DRY_RUN ? "would reclassify" : "reclassified"} call=${row.callId.slice(0, 12)}… → LIVE`);
  }

  console.log(
    `[backfill] done: ${reclassified} → LIVE, ${keptTestPurpose} kept (test purpose), ${keptSandbox} kept (sandbox business)`
  );
  if (reclassified > 0) {
    console.log("[backfill] tip: run `npm run backfill:recording-urls` next so reclassified calls also get their recordings.");
  }
}

main()
  .catch((error) => {
    console.error("[backfill] failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
