import { apiGet, apiPatch } from "@/lib/api";

/**
 * Admin → AI Builder rules. One plain-text "constitution" the AI Builder
 * follows on every styling conversation. While nothing is saved the platform
 * default applies, so the Brain is never rule-less; saving blank restores it.
 */

/** Mirrors the backend limit (DESIGN_BRAIN_RULES_MAX_LENGTH). */
export const ADMIN_DESIGN_RULES_MAX_LENGTH = 8000;

export type AdminDesignRules = {
  /** The effective rules text (saved value, or the platform default when unset). */
  value: string;
  /** True while no admin override is stored. */
  isDefault: boolean;
  updatedAt: string | null;
  /** The platform default, always included so "Restore default" can preview it. */
  defaultValue: string;
};

export function getAdminDesignRules() {
  return apiGet<{ rules: AdminDesignRules }>("/admin/design-rules");
}

/** An empty value restores the platform default rules. */
export function updateAdminDesignRules(value: string) {
  return apiPatch<{ rules: AdminDesignRules; restoredDefault: boolean }>("/admin/design-rules", {
    value
  });
}
