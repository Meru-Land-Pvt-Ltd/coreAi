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

import { prisma } from "../../lib/prisma";
import { getMemoryLimits } from "../admin/memory-limits";

const ONCE_A_DAY_MS = 24 * 60 * 60 * 1000;
/** Bounded so one sweep can never lock the table a customer's run is using. */
const BATCH = 5_000;

export async function sweepOldMemory(): Promise<number> {
  const { keepForDays } = await getMemoryLimits();
  if (!keepForDays) return 0;

  const cutoff = new Date(Date.now() - keepForDays * ONCE_A_DAY_MS);
  let deleted = 0;

  for (;;) {
    const doomed = await prisma.memoryRecord.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH
    });
    if (doomed.length === 0) break;

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
