import { prisma } from "../../lib/prisma";

/**
 * THE PRICES AN ADMIN TYPES, ACTUALLY USED.
 *
 * The admin screen lets a price per million tokens be edited for any model,
 * saves it, and shows it back. Nothing read it. Every cost the platform
 * recorded came from the price list shipped inside the code — so when a
 * provider changed their prices, an admin could correct ours, watch the new
 * number appear on screen, and every figure in the ledger carried on using the
 * old one.
 *
 * Overrides are held in a small cached map rather than queried per call: costs
 * are worked out on a hot path, and a price a minute out of date has never
 * hurt anybody. The admin's own save clears it, so the screen and the ledger
 * agree the moment they act.
 */

type Price = { input: number | null; output: number | null };

let overrides = new Map<string, Price>();
let loadedAt = 0;
const FRESH_FOR_MS = 60_000;

/** Cleared by the admin's save, so a new price takes effect at once. */
export function forgetAdminModelPrices(): void {
  loadedAt = 0;
}

/**
 * Refresh the map. Safe to call often; it only asks the database when what it
 * holds has gone stale. On an error the previous answer is kept — a blip must
 * not silently return every model to the shipped price.
 */
export async function refreshAdminModelPrices(): Promise<void> {
  if (Date.now() - loadedAt < FRESH_FOR_MS) return;

  try {
    const rows = await prisma.adminLlmModel.findMany({
      select: { modelId: true, providerId: true, inputPricePer1M: true, outputPricePer1M: true }
    });
    overrides = new Map(
      rows.map((row) => [
        `${row.providerId}:${row.modelId}`,
        { input: row.inputPricePer1M, output: row.outputPricePer1M }
      ])
    );
    loadedAt = Date.now();
  } catch (error) {
    console.error("[llm] could not read the admin's model prices — keeping the last answer", error);
  }
}

/** The admin's price for this model, when they have set one. */
export function adminPriceFor(providerId: string, modelId: string): Price | undefined {
  return overrides.get(`${providerId}:${modelId}`);
}
