import { LLM_PROVIDERS, getLlmModelsForProvider } from "@coreai/shared";
import { apiGet, apiPatch } from "@/lib/api";

/**
 * Admin → the AI Builder's own two brains.
 *
 * The founder's ruling (2026-08-27), written the day a hard-coded seeing
 * model refused every screenshot an architect sent: a model name in code is
 * a decision the founder cannot make. Both of the Builder's brains now sit
 * on the admin screen beside the door and page batteries, under the same
 * pattern — an AI service, and an optional model whose blank means "use that
 * service's own standard".
 *
 *   THE BUILDER'S BRAIN — the employee an architect talks to.
 *   THE BUILDER'S EYES  — the brain that reads pasted screenshots. Separate
 *                         on purpose: not every service that talks can see.
 */

export const ADMIN_BUILDER_BRAIN_MODEL_MAX_LENGTH = 120;

export type AdminBuilderBrainOption = { id: string; displayName: string };

export type AdminBuilderBrain = {
  providerId: string;
  /** null means "let that AI service pick its own default model". */
  modelId: string | null;
  isDefault: boolean;
  updatedAt: string | null;
  defaultProviderId: string;
  defaultModelId: string;
  providers: AdminBuilderBrainOption[];
  models: AdminBuilderBrainOption[];
};

export type AdminBuilderEyes = AdminBuilderBrain & {
  /** The services that can actually look at a picture. */
  servicesThatSee: string[];
  /** True when the SAVED service is one of them. */
  canSee: boolean;
};

export const ADMIN_BUILDER_BRAIN_FALLBACK_PROVIDERS: AdminBuilderBrainOption[] = LLM_PROVIDERS.map(
  (provider) => ({ id: provider.id, displayName: provider.displayName })
);

/**
 * The models a service has RIGHT NOW, asked of the provider itself.
 *
 * The founder's ruling (2026-08-27): pull it in real time. A list written
 * into our code is stale the day a provider ships something new — and it
 * lies about what this platform's own key can actually reach. `live` is
 * false when the provider could not be asked, and `note` says why in plain
 * words rather than pretending.
 */
export function getLiveModels(providerId: string) {
  return apiGet<{ models: AdminBuilderBrainOption[]; live: boolean; note?: string }>(
    `/admin/live-models?provider=${encodeURIComponent(providerId)}`
  );
}

/** The shipped catalogue — shown only while the live answer is on its way. */
export function providerModels(providerId: string): AdminBuilderBrainOption[] {
  return getLlmModelsForProvider(providerId).map((model) => ({
    id: model.id,
    displayName: model.displayName
  }));
}

export function getAdminBuilderBrain() {
  return apiGet<{ builderBrain: AdminBuilderBrain }>("/admin/builder-brain");
}

export function updateAdminBuilderBrain(input: { provider: string; model: string }) {
  return apiPatch<{ builderBrain: AdminBuilderBrain }>("/admin/builder-brain", input);
}

export function getAdminBuilderEyes() {
  return apiGet<{ builderEyes: AdminBuilderEyes }>("/admin/builder-eyes");
}

/** Saving an eyeless service is allowed — the reply carries the honest warning. */
export function updateAdminBuilderEyes(input: { provider: string; model: string }) {
  return apiPatch<{ builderEyes: AdminBuilderEyes; warning?: string }>("/admin/builder-eyes", input);
}
