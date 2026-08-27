import { adminPriceFor } from "./admin-model-prices";
/**
 * Backend view of the LLM catalog. The data lives in @coreai/shared so the
 * builder's provider/model dropdowns and the adapters can never drift apart —
 * this module only reshapes it for the adapter API.
 */
import { LLM_MODELS } from "@coreai/shared";

export type ModelEntry = {
  id: string;
  provider: string;
  displayName: string;
  input: number | null;   // $ per 1M tokens
  output: number | null;  // $ per 1M tokens
};

export const MODEL_CATALOG: ModelEntry[] = LLM_MODELS.map((model) => ({
  id: model.id,
  provider: model.providerId,
  displayName: model.displayName,
  input: model.inputPricePer1M,
  output: model.outputPricePer1M,
}));

/** Returns all model IDs for a given provider (used by adapter.models getter). */
export function getModelsForProvider(provider: string): string[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider).map((m) => m.id);
}

/** Returns a pricing lookup table for a given provider (used by adapter.pricing getter). */
export function getPricingForProvider(provider: string): Record<string, { input: number; output: number }> {
  const pricing: Record<string, { input: number; output: number }> = {};
  for (const m of MODEL_CATALOG) {
    if (m.provider !== provider) continue;
    /* An admin's own price wins over the one shipped in the code. Theirs is
       the current one; ours is whatever was true the day we released. */
    const override = adminPriceFor(provider, m.id);
    const input = override?.input ?? m.input;
    const output = override?.output ?? m.output;
    if (input !== null && output !== null) {
      pricing[m.id] = { input, output };
    }
  }
  return pricing;
}
