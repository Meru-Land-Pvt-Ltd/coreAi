import { prisma } from "../src/lib/prisma";
import { env } from "../src/config/env";

const DRY_RUN = process.argv.includes("--dry");

async function main() {
  const now = Date.now();
  const report: Record<string, number> = {};

  const ttlCutoff = env.MEMORY_RETENTION_DAYS > 0 ? new Date(now - env.MEMORY_RETENTION_DAYS * 86400_000) : null;
  const testCutoff =
    env.MEMORY_TEST_RETENTION_DAYS > 0 ? new Date(now - env.MEMORY_TEST_RETENTION_DAYS * 86400_000) : null;

  if (ttlCutoff) {
    const where = { createdAt: { lt: ttlCutoff } };
    report.expiredRecords = DRY_RUN
      ? await prisma.memoryRecord.count({ where })
      : (await prisma.memoryRecord.deleteMany({ where })).count;
  }

  if (testCutoff) {
    const where = { testSessionId: { not: null }, createdAt: { lt: testCutoff } };
    report.expiredTestRecords = DRY_RUN
      ? await prisma.memoryRecord.count({ where })
      : (await prisma.memoryRecord.deleteMany({ where })).count;
  }

  if (testCutoff) {
    const orphanWhere = { recordId: null, createdAt: { lt: testCutoff } };
    report.orphanChunks = DRY_RUN
      ? await prisma.memoryChunk.count({ where: orphanWhere })
      : (await prisma.memoryChunk.deleteMany({ where: orphanWhere })).count;
  }

  const tenants = await prisma.memoryRecord.groupBy({
    by: ["businessId", "architectUserId"],
    _sum: { tokenCount: true }
  });
  let cappedTenants = 0;
  let cappedRecords = 0;
  for (const tenant of tenants) {
    let excess = (tenant._sum.tokenCount ?? 0) - env.MEMORY_MAX_TOKENS_PER_TENANT;
    if (excess <= 0) continue;
    cappedTenants += 1;
    const where = tenant.businessId
      ? { businessId: tenant.businessId }
      : tenant.architectUserId
        ? { architectUserId: tenant.architectUserId, businessId: null }
        : { businessId: null, architectUserId: null };
    while (excess > 0) {
      const oldest = await prisma.memoryRecord.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take: 200,
        select: { id: true, tokenCount: true }
      });
      if (oldest.length === 0) break;
      const ids: string[] = [];
      for (const record of oldest) {
        if (excess <= 0) break;
        ids.push(record.id);
        excess -= record.tokenCount;
      }
      if (ids.length === 0) break;
      cappedRecords += ids.length;
      if (!DRY_RUN) await prisma.memoryRecord.deleteMany({ where: { id: { in: ids } } });
      if (DRY_RUN) break; // counting one pass is enough for a report
    }
  }
  report.tenantsOverCap = cappedTenants;
  report.cappedRecords = cappedRecords;

  console.log(`[cleanup-memory]${DRY_RUN ? " (dry run)" : ""}`, JSON.stringify(report));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[cleanup-memory] failed:", error instanceof Error ? error.message : "unknown error");
    process.exit(1);
  });
