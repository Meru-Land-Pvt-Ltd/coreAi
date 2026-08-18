import { LLM_PROVIDERS } from "@coreai/shared";
import { apiGet, apiPatch } from "@/lib/api";

/**
 * Admin → Smart Designer Brain (the composer battery).
 *
 * Every product's interface is designed by the ONE brain an admin picks here —
 * the AI composer that reads a workflow's declarations and lays out the minimum
 * interface, plus the Smart Designer chat architects talk to when it needs a
 * fix. There is deliberately no per-architect model choice: one battery, one
 * place. Nothing saved means the platform default (Claude) applies, so the
 * designer is never brain-less.
 */

/** Mirrors the backend limit (the same cap the door brain uses). */
export const ADMIN_SMART_DESIGNER_BRAIN_MODEL_MAX_LENGTH = 120;

export type AdminSmartDesignerBrainOption = { id: string; displayName: string };

export type AdminSmartDesignerBrain = {
  /** The brand of AI the designer runs on (default "claude"). */
  providerId: string;
  /** null means "let that AI service pick its own default model". */
  modelId: string | null;
  /** True while no admin override is stored. */
  isDefault: boolean;
  updatedAt: string | null;
  /** The platform default provider, so "standard" can be labelled. */
  defaultProviderId: string;
  /** The AI services the engine can actually run the designer on. */
  providers: AdminSmartDesignerBrainOption[];
  /** Known models for the saved provider (a newer id may still be typed in). */
  models: AdminSmartDesignerBrainOption[];
};

/**
 * Used only when the server sends an empty provider list — the same catalog the
 * backend validates against, so the select can never end up with no choices.
 */
export const ADMIN_SMART_DESIGNER_BRAIN_FALLBACK_PROVIDERS: AdminSmartDesignerBrainOption[] =
  LLM_PROVIDERS.map((provider) => ({ id: provider.id, displayName: provider.displayName }));

export function getAdminSmartDesignerBrain() {
  return apiGet<{ smartDesignerBrain: AdminSmartDesignerBrain }>("/admin/smart-designer-brain");
}

/** An empty model restores that service's own default; an empty provider restores the platform default. */
export function updateAdminSmartDesignerBrain(input: { provider: string; model: string }) {
  return apiPatch<{ smartDesignerBrain: AdminSmartDesignerBrain; restoredDefault: boolean }>(
    "/admin/smart-designer-brain",
    input
  );
}
