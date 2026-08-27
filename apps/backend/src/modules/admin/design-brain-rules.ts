import { prisma } from "../../lib/prisma";
import { decryptSecret, encryptSecret } from "../../lib/crypto";

/**
 * AI Builder rules ("constitution") — platform-wide guidance the AI Builder
 * follows on every styling conversation, editable from Admin → AI Builder rules.
 *
 * Storage reuses the existing PlatformApiSetting key/value table (the same store
 * that backs Admin → Manage API) under the key "designBrainRules" — no new table
 * or migration. The value is not a credential (`secret: false`) but the column is
 * `valueEncrypted`, so it is stored encrypted at rest like every other row.
 *
 * When no row exists the strong platform default below applies, so the Design
 * Brain is never rule-less. Saving blank deletes the row, which restores the
 * default — mirroring how clearing an API key restores the .env fallback.
 *
 * design-chat reads this through {@link getDesignBrainRules}: cached for 60s and
 * guaranteed never to throw, so a database hiccup can never take styling chat down.
 */

export const DESIGN_BRAIN_RULES_KEY = "designBrainRules";

export const DEFAULT_DESIGN_BRAIN_RULES = [
  "1. Every change must look perfect on mobile first - if it breaks on a phone, refuse it.",
  "2. Always keep text readable: never allow color combinations with poor contrast.",
  "3. Always use the platform's latest standards - modern spacing, modern typography, no outdated visual patterns.",
  "4. Never break accessibility: buttons stay tappable, focus states stay visible, screen-reader labels stay intact.",
  "5. Keep the product consistent - one accent color family, one theme, one voice. Never mix three styles in one page.",
  "6. Prefer clarity over decoration - if a change adds beauty but hurts understanding, choose understanding.",
  "7. Small, precise changes - change exactly what was asked, nothing extra, never redesign uninvited.",
  "8. Only apply changes through the approved settings - never invent new elements.",
  "9. If a request is impossible or would make the product worse, refuse kindly and offer the closest alternative.",
  "10. Reply in the same language the architect wrote in.",
  "11. After every change, confirm in one short line what was done - no lectures.",
  "12. Never remove anything unless explicitly asked.",
  "13. Never touch payments, pricing, security, or the brains' thinking - styling only.",
  "14. Customer-facing words must stay free of technical language.",
  "15. When in doubt, choose what a $100-billion company's designer would choose."
].join("\n");

/** Longest rules text an admin can save. Generous, but bounded. */
export const DESIGN_BRAIN_RULES_MAX_LENGTH = 8000;

/* --------------------------------- cache --------------------------------- */

let cachedRules: string | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

/** Drop the cache so the next read reflects a just-saved value. */
export function invalidateDesignBrainRulesCache(): void {
  cachedRules = null;
  cacheLoadedAt = 0;
}

async function readStoredRow(): Promise<{ value: string; updatedAt: Date | null }> {
  const row = await prisma.platformApiSetting.findUnique({
    where: { key: DESIGN_BRAIN_RULES_KEY },
    select: { valueEncrypted: true, updatedAt: true }
  });
  if (!row) return { value: "", updatedAt: null };
  try {
    return { value: decryptSecret(row.valueEncrypted).trim(), updatedAt: row.updatedAt };
  } catch {
    // A row encrypted under a rotated ENCRYPTION_KEY must not break the Design
    // Brain — behave as unset so the default constitution applies.
    console.warn("[design-brain-rules] could not decrypt stored rules — using default");
    return { value: "", updatedAt: null };
  }
}

/**
 * The effective AI Builder rules for prompt building: the admin-saved text,
 * or the platform default when nothing is saved.
 *
 * Never throws. On a database error it returns the last cached value when one
 * exists, otherwise "" — design-chat only prepends rules "when present", so an
 * unreachable database degrades to no extra rules rather than a failed reply.
 */
export async function getDesignBrainRules(): Promise<string> {
  if (cachedRules !== null && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedRules;
  }
  try {
    const stored = await readStoredRow();
    cachedRules = stored.value || DEFAULT_DESIGN_BRAIN_RULES;
    cacheLoadedAt = Date.now();
    return cachedRules;
  } catch (error) {
    console.warn("[design-brain-rules] falling back", {
      error: error instanceof Error ? error.message : String(error)
    });
    return cachedRules ?? "";
  }
}

/* ------------------------------- admin API -------------------------------- */

export type DesignBrainRulesSetting = {
  /** The effective rules text (saved value, or the default when unset). */
  value: string;
  /** True while no admin override is stored. */
  isDefault: boolean;
  updatedAt: string | null;
};

/** Uncached read for the admin screen — always reflects the database. */
export async function getDesignBrainRulesSetting(): Promise<DesignBrainRulesSetting> {
  const stored = await readStoredRow();
  return {
    value: stored.value || DEFAULT_DESIGN_BRAIN_RULES,
    isDefault: !stored.value,
    updatedAt: stored.updatedAt?.toISOString() ?? null
  };
}

/**
 * Save admin-edited rules. Blank (or text identical to the default) deletes the
 * stored row so the platform default applies again — "restore default" is just
 * a save with an empty value.
 */
export async function saveDesignBrainRules(
  value: string,
  updatedByUserId: string
): Promise<{ restoredDefault: boolean }> {
  const trimmed = value.trim().slice(0, DESIGN_BRAIN_RULES_MAX_LENGTH);

  if (!trimmed || trimmed === DEFAULT_DESIGN_BRAIN_RULES) {
    await prisma.platformApiSetting.deleteMany({ where: { key: DESIGN_BRAIN_RULES_KEY } });
    invalidateDesignBrainRulesCache();
    return { restoredDefault: true };
  }

  await prisma.platformApiSetting.upsert({
    where: { key: DESIGN_BRAIN_RULES_KEY },
    update: { valueEncrypted: encryptSecret(trimmed), secret: false, updatedByUserId },
    create: {
      key: DESIGN_BRAIN_RULES_KEY,
      valueEncrypted: encryptSecret(trimmed),
      secret: false,
      updatedByUserId
    }
  });
  invalidateDesignBrainRulesCache();
  return { restoredDefault: false };
}
