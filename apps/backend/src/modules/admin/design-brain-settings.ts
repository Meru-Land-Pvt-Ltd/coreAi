import {
  brainModelMismatch,
  brainModelOptions,
  brainProviderOptions,
  createBrainSlot,
  isSupportedBrainProvider,
  BRAIN_MODEL_MAX_LENGTH,
  type BrainSlotConfig,
  type BrainSlotSetting,
  type SaveBrainSlotInput,
  type SaveBrainSlotResult
} from "./brain-slot-settings";

/**
 * The AI Builder battery — the model that designs products.
 *
 * Both design paths run on it: the full product generation ("build me the whole
 * page") and the small styling edits an architect types ("make it wider", "use
 * a calmer colour"). They are the same craft, so they share one battery; the
 * doors keep their own, because door work is high-volume translation while
 * design work is taste.
 *
 * Default is OpenAI gpt-4.1-mini: fast enough that an architect is not left
 * waiting mid-sentence, and cheap enough to be the constant-use brain. Gemini
 * was the old default and measured ~18s with empty replies — never again for a
 * brain a human is sitting in front of.
 *
 * Storage, validation and caching come from {@link createBrainSlot}, shared
 * with the door battery. Swapping this on the admin screen changes design for
 * every architect on the platform instantly — no deploy, no code change. When a
 * stronger design model arrives, it is one dropdown.
 */

/* THE NAMES STAY BECAUSE THE SAVED VALUES DO. These two strings are the keys
   the settings already sit under in the database. Renaming them to match what
   the screen now says would leave every value an admin has chosen behind under
   the old key, and the platform would come back up with defaults. The screen's
   words changed; the drawer label did not. */
export const DESIGN_BRAIN_PROVIDER_KEY = "designBrainProvider";
export const DESIGN_BRAIN_MODEL_KEY = "designBrainModel";

export const DEFAULT_DESIGN_BRAIN_PROVIDER = "openai";
export const DEFAULT_DESIGN_BRAIN_MODEL = "gpt-4.1-mini";

/** Longest model id an admin can save (generous; ids are short). */
export const DESIGN_BRAIN_MODEL_MAX_LENGTH = BRAIN_MODEL_MAX_LENGTH;

export type DesignBrainConfig = BrainSlotConfig;
export type DesignBrainSetting = BrainSlotSetting;
export type SaveDesignBrainInput = SaveBrainSlotInput;
export type SaveDesignBrainResult = SaveBrainSlotResult;

const designSlot = createBrainSlot({
  name: "design-brain-settings",
  providerKey: DESIGN_BRAIN_PROVIDER_KEY,
  modelKey: DESIGN_BRAIN_MODEL_KEY,
  defaultProvider: DEFAULT_DESIGN_BRAIN_PROVIDER,
  defaultModel: DEFAULT_DESIGN_BRAIN_MODEL
});

/** The provider ids an admin may choose — the engine's known providers. */
export const designBrainProviderOptions = brainProviderOptions;

/** True for provider ids the AI provider engine knows how to run. */
export const isSupportedDesignBrainProvider = isSupportedBrainProvider;

/** True when the model id belongs to a DIFFERENT provider than the one chosen. */
export const designBrainModelMismatch = brainModelMismatch;

/** The models the admin screen offers for a provider (may be empty). */
export const designBrainModelOptions = brainModelOptions;

/** Drop the cache so the next design call reflects a just-saved battery. */
export function invalidateDesignBrainConfigCache(): void {
  designSlot.invalidateCache();
}

/**
 * The battery every design call runs on. Cached for 60s.
 *
 * Never throws: on a database error the last known battery (or the default)
 * applies, so an architect mid-design is never blocked by a settings read.
 */
export function getDesignBrainConfig(): Promise<DesignBrainConfig> {
  return designSlot.getConfig();
}

/** Uncached read for the admin screen — always reflects the database. */
export function getDesignBrainSetting(): Promise<DesignBrainSetting> {
  return designSlot.getSetting();
}

/**
 * Save the platform design battery. A field left out of the payload is
 * untouched; a field sent blank deletes its row so the default applies again.
 */
export function saveDesignBrainConfig(
  input: SaveDesignBrainInput,
  updatedByUserId: string
): Promise<SaveDesignBrainResult> {
  return designSlot.save(input, updatedByUserId);
}
