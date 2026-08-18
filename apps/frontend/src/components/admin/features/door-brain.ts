import { LLM_PROVIDERS } from "@coreai/shared";
import { apiGet, apiPatch } from "@/lib/api";

/**
 * Admin → Door Brain (the one swappable battery).
 *
 * Every step on the platform has a smart input and a smart output built inside
 * it. They all run on the ONE brain an admin picks here — there is deliberately
 * no per-step model setting anywhere, so changing this changes every agent at
 * once. Nothing saved means the platform default applies, so the doors are
 * never brain-less.
 */

/** Mirrors the backend limit (DOOR_BRAIN_MODEL_MAX_LENGTH). */
export const ADMIN_DOOR_BRAIN_MODEL_MAX_LENGTH = 120;

export type AdminDoorBrainOption = { id: string; displayName: string };

export type AdminDoorBrain = {
  /** The brand of AI the doors run on (e.g. "gemini"). */
  providerId: string;
  /** null means "let that AI service pick its own default model". */
  modelId: string | null;
  /** True while no admin override is stored. */
  isDefault: boolean;
  updatedAt: string | null;
  /** The platform default provider, so "standard" can be labelled. */
  defaultProviderId: string;
  /** The AI services the engine can actually run doors on. */
  providers: AdminDoorBrainOption[];
  /** Known models for the saved provider (a newer id may still be typed in). */
  models: AdminDoorBrainOption[];
};

/**
 * Used only when the server sends an empty provider list — the same catalog the
 * backend validates against, so the select can never end up with no choices.
 */
export const ADMIN_DOOR_BRAIN_FALLBACK_PROVIDERS: AdminDoorBrainOption[] = LLM_PROVIDERS.map(
  (provider) => ({ id: provider.id, displayName: provider.displayName })
);

export function getAdminDoorBrain() {
  return apiGet<{ doorBrain: AdminDoorBrain }>("/admin/door-brain");
}

/** An empty model restores that service's own default; an empty provider restores the platform default. */
export function updateAdminDoorBrain(input: { provider: string; model: string }) {
  return apiPatch<{ doorBrain: AdminDoorBrain; restoredDefault: boolean }>(
    "/admin/door-brain",
    input
  );
}
