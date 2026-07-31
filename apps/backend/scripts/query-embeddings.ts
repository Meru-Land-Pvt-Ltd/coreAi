import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("=== Fetching Memory Chunks & Stored Embeddings from Database ===");

  const countResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint as count FROM "MemoryChunk";
  `;
  const totalCount = Number(countResult[0]?.count || 0);
  console.log(`Total MemoryChunk records in DB: ${totalCount}`);

  const withEmbeddingCountResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint as count FROM "MemoryChunk" WHERE "embedding" IS NOT NULL;
  `;
  const withEmbeddingCount = Number(withEmbeddingCountResult[0]?.count || 0);
  console.log(`MemoryChunk records with NON-NULL embedding: ${withEmbeddingCount}`);

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    scopeKey: string;
    sourceType: string;
    sourceLabel: string | null;
    content: string;
    embeddingModel: string | null;
    embeddingStr: string | null;
    createdAt: Date;
  }>>`
    SELECT 
      "id",
      "scopeKey",
      "sourceType",
      "sourceLabel",
      "content",
      "embeddingModel",
      "embedding"::text as "embeddingStr",
      "createdAt"
    FROM "MemoryChunk"
    ORDER BY "createdAt" DESC
    LIMIT 20;
  `;

  if (rows.length === 0) {
    console.log("\nNo MemoryChunk rows found in database.");
  } else {
    console.log(`\nDisplaying latest ${rows.length} MemoryChunk record(s):\n`);
    for (const row of rows) {
      console.log(`--------------------------------------------------`);
      console.log(`ID:              ${row.id}`);
      console.log(`Scope Key:       ${row.scopeKey}`);
      console.log(`Source Type:     ${row.sourceType} (${row.sourceLabel || "N/A"})`);
      console.log(`Embedding Model: ${row.embeddingModel || "N/A"}`);
      console.log(`Created At:      ${row.createdAt.toISOString()}`);
      console.log(`Content:         ${JSON.stringify(row.content.substring(0, 100))}${row.content.length > 100 ? "..." : ""}`);
      
      if (!row.embeddingStr) {
        console.log(`Embedding:       NULL (Pending or not generated)`);
      } else {
        const vectorValues = row.embeddingStr
          .replace(/^\[/, "")
          .replace(/\]$/, "")
          .split(",")
          .map(Number);
        
        console.log(`Embedding Dim:   ${vectorValues.length}`);
        console.log(`First 5 values:  [${vectorValues.slice(0, 5).join(", ")}]`);
        console.log(`Last 5 values:   [${vectorValues.slice(-5).join(", ")}]`);
        console.log(`Full Vector Preview: ${row.embeddingStr.substring(0, 100)}...`);
      }
    }
  }

  // Also check MemoryRecord table embedding status
  const memoryRecords = await prisma.$queryRaw<Array<{
    id: string;
    scopeKey: string;
    embeddingStatus: string;
    createdAt: Date;
  }>>`
    SELECT "id", "scopeKey", "embeddingStatus", "createdAt"
    FROM "MemoryRecord"
    ORDER BY "createdAt" DESC
    LIMIT 10;
  `;

  console.log("\n=== Latest MemoryRecord Status Summary ===");
  if (memoryRecords.length === 0) {
    console.log("No MemoryRecord rows found in database.");
  } else {
    for (const rec of memoryRecords) {
      console.log(`Record ${rec.id} | Scope: ${rec.scopeKey} | Status: ${rec.embeddingStatus}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error executing query:", err);
  process.exit(1);
});
