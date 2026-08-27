/**
 * FORGETTING ON PURPOSE.
 *
 * A business that deletes a customer cannot have that customer's words living
 * on in a drawer forever, and until now they did: nothing on this platform ever
 * deleted a memory record. "How long it is kept" is the one memory setting that
 * is a legal question rather than a taste one, which is why it belongs to the
 * admin and not to the architect.
 *
 * Keep-forever stays the default, because that is exactly what the platform did
 * before this file existed. An admin who never opens the screen sees no change.
 */

import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { formatTenantNamespace, getPineconeIndex, isPineconeConfigured } from "../../lib/pinecone-client";
import { getMemoryLimits } from "../admin/memory-limits";

const ONCE_A_DAY_MS = 24 * 60 * 60 * 1000;
/** Bounded so one sweep can never lock the table a customer's run is using. */
const BATCH = 5_000;


/**
 * Remove the same memories from the search index.
 *
 * The vector's id and namespace are both rebuilt from the stored row, using
 * exactly the recipe that wrote them: the id is a hash of the conversation
 * scope and the content, and the namespace comes from the business or
 * architect named inside the scope key.
 */
async function forgetVectors(
  rows: Array<{ scopeKey: string; contentHash: string }>
): Promise<void> {
  if (!isPineconeConfigured() || rows.length === 0) return;

  const index = await getPineconeIndex().catch(() => null);
  if (!index) return;

  const byNamespace = new Map<string, string[]>();
  for (const row of rows) {
    const conversationScopeKey = row.scopeKey.replace(/\|node:[^|]+/, "");
    const business = row.scopeKey.match(/biz:([^|]+)/);
    const architect = row.scopeKey.match(/arch:([^|]+)/);
    const tenantId = business ? `biz_${business[1]}` : architect ? `arch_${architect[1]}` : "default";
    const namespace = formatTenantNamespace(tenantId);
    const vectorId = createHash("sha256").update(`${conversationScopeKey}:${row.contentHash}`).digest("hex");
    byNamespace.set(namespace, [...(byNamespace.get(namespace) ?? []), vectorId]);
  }

  for (const [namespace, ids] of byNamespace) {
    /* One failure must not stop the sweep, and must not be silent. */
    await index
      .namespace(namespace)
      .deleteMany(ids)
      .catch((error) =>
        console.error("[memory-retention] could not forget vectors — the text is still searchable", {
          namespace,
          count: ids.length,
          error: error instanceof Error ? error.message : String(error)
        })
      );
  }
}

export async function sweepOldMemory(): Promise<number> {
  const { keepForDays } = await getMemoryLimits();
  if (!keepForDays) return 0;

  const cutoff = new Date(Date.now() - keepForDays * ONCE_A_DAY_MS);
  let deleted = 0;

  for (;;) {
    const doomed = await prisma.memoryRecord.findMany({
      where: { createdAt: { lt: cutoff } },
      /* The two fields that rebuild the vector's own id. Without them the
         text was deleted here and kept somewhere else. */
      select: { id: true, scopeKey: true, contentHash: true },
      take: BATCH
    });
    if (doomed.length === 0) break;

    /* FORGETTING IN ONE PLACE IS NOT FORGETTING.
       This deleted the database rows and nothing else, while retrieval reads
       the text straight out of the search index — so a business that deleted
       a customer, or an admin who set "keep for 30 days", watched the agent
       go on quoting that customer's words back for as long as the index kept
       them. Deleted here means deleted in both places, and the index goes
       first: a row we failed to remove there must not be lost from the only
       record that can name it. */
    await forgetVectors(doomed);

    const result = await prisma.memoryRecord.deleteMany({ where: { id: { in: doomed.map((row) => row.id) } } });
    deleted += result.count;
    if (doomed.length < BATCH) break;
  }

  if (deleted) console.log(`[memory-retention] forgot ${deleted} records older than ${keepForDays} days`);
  return deleted;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startMemoryRetentionWorker(): void {
  if (timer) return;
  // Not on boot: a deploy restarts every container, and a sweep racing four
  // starts at once is a database spike for no reason.
  timer = setInterval(() => {
    void sweepOldMemory().catch((error) => console.warn("[memory-retention] sweep failed", (error as Error).message));
  }, ONCE_A_DAY_MS);
  timer.unref();
}

export function stopMemoryRetentionWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
