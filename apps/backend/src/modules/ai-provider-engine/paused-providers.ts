import { prisma } from "../../lib/prisma";

/**
 * THE "RUNNING" SWITCH, ACTUALLY CONNECTED.
 *
 * The admin screen carries a Running switch for every provider, and tells the
 * admin in words that it "decides everything, including agents already sold".
 * Nothing read it. It was written to the database, shown back on the screen,
 * and never once consulted while an agent was running — so an admin turning a
 * provider off watched it keep answering calls, on the platform's bill,
 * believing they had stopped it.
 *
 * This is the run-time answer. It is a small cached set rather than a query on
 * every call, because the choice of provider happens on a hot path and a list
 * one minute out of date has never hurt anybody. The admin's own save clears
 * it immediately, so the screen and the engine agree the moment they act.
 */

let paused = new Set<string>();
/* THE SAME SWITCH EXISTS ON EVERY MODEL, AND IT WAS READ BY NOTHING EITHER.
   An admin can stop one model — a provider's expensive flagship, a model that
   has started refusing our requests — without stopping the provider. That
   switch was saved, shown back, and never once consulted while an agent ran. */
let pausedModels = new Set<string>();
let loadedAt = 0;
const FRESH_FOR_MS = 60_000;

/** Cleared by the admin's save, so a switch takes effect at once. */
export function forgetPausedProviders(): void {
  loadedAt = 0;
}

/**
 * Refresh the set. Safe to call often; it only asks the database when the
 * answer it holds has gone stale.
 *
 * On a database error the previous answer is kept. Refusing every provider
 * because one query failed would take the whole platform down over a blip,
 * and letting every provider through would ignore a deliberate decision — so
 * it holds the last thing an admin actually said.
 */
export async function refreshPausedProviders(): Promise<void> {
  if (Date.now() - loadedAt < FRESH_FOR_MS) return;

  try {
    const [rows, modelRows] = await Promise.all([
      prisma.adminLlmProvider.findMany({
        where: { runningEnabled: false },
        select: { providerId: true }
      }),
      prisma.adminLlmModel.findMany({
        where: { runningEnabled: false },
        select: { modelId: true }
      })
    ]);
    paused = new Set(rows.map((row) => row.providerId));
    pausedModels = new Set(modelRows.map((row) => row.modelId));
    loadedAt = Date.now();
  } catch (error) {
    console.error("[llm] could not read which providers are paused — keeping the last answer", error);
  }
}

/** True when an admin has switched this provider off for live running. */
export function providerIsPaused(providerId: string): boolean {
  return paused.has(providerId);
}

/** True when an admin has switched this one model off for live running. */
export function modelIsPaused(modelId: string | undefined | null): boolean {
  return Boolean(modelId && pausedModels.has(modelId));
}
