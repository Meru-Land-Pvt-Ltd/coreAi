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
 * The Smart Designer battery — the brain that composes product interfaces.
 *
 * The AI Composer reads a workflow's declarations and generates the MINIMUM
 * interface, and the Smart Designer chat is its feedback loop. Both run on the
 * ONE provider/model an admin picks here — never a model an architect chooses,
 * and never one hardcoded in the composer. The frontend law behind that:
 * an architect picking an expensive model burns unpredictable money, one
 * picking a weak model blames the platform for bad output, and a model
 * dropdown is itself a design decision the law removes.
 *
 * This slot is deliberately SEPARATE from the Design Brain battery: the old
 * Style/Build designer keeps its own brain and stays untouched, so swapping
 * the composer's model can never change what the existing designer does.
 *
 * Default is Claude Opus 5 — composition is a taste-and-reasoning job, the
 * exact opposite of the doors' high-volume translation work. Storage,
 * validation and caching come from {@link createBrainSlot}, shared with the
 * door and design batteries so the three can never drift apart.
 */

export const SMART_DESIGNER_BRAIN_PROVIDER_KEY = "smartDesignerProvider";
export const SMART_DESIGNER_BRAIN_MODEL_KEY = "smartDesignerModel";

export const DEFAULT_SMART_DESIGNER_BRAIN_PROVIDER = "claude";
export const DEFAULT_SMART_DESIGNER_BRAIN_MODEL = "claude-opus-5";

/** Longest model id an admin can save (generous; ids are short). */
export const SMART_DESIGNER_BRAIN_MODEL_MAX_LENGTH = BRAIN_MODEL_MAX_LENGTH;

export type SmartDesignerBrainConfig = BrainSlotConfig;
export type SmartDesignerBrainSetting = BrainSlotSetting;
export type SaveSmartDesignerBrainInput = SaveBrainSlotInput;
export type SaveSmartDesignerBrainResult = SaveBrainSlotResult;

const smartDesignerSlot = createBrainSlot({
  name: "smart-designer-brain-settings",
  providerKey: SMART_DESIGNER_BRAIN_PROVIDER_KEY,
  modelKey: SMART_DESIGNER_BRAIN_MODEL_KEY,
  defaultProvider: DEFAULT_SMART_DESIGNER_BRAIN_PROVIDER,
  defaultModel: DEFAULT_SMART_DESIGNER_BRAIN_MODEL
});

/** The provider ids an admin may choose — the engine's known providers. */
export const smartDesignerBrainProviderOptions = brainProviderOptions;

/** True for provider ids the AI provider engine knows how to run. */
export const isSupportedSmartDesignerBrainProvider = isSupportedBrainProvider;

/** True when the model id belongs to a DIFFERENT provider than the one chosen. */
export const smartDesignerBrainModelMismatch = brainModelMismatch;

/** The models the admin screen offers for a provider (may be empty). */
export const smartDesignerBrainModelOptions = brainModelOptions;

/** Drop the cache so the next composition reflects a just-saved battery. */
export function invalidateSmartDesignerBrainConfigCache(): void {
  smartDesignerSlot.invalidateCache();
}

/**
 * The battery every composition and Smart Designer chat runs on. Cached for
 * 60s. Never throws: on a database error the last known battery (or the
 * default) applies, so an architect mid-design is never blocked.
 */
export function getSmartDesignerBrainConfig(): Promise<SmartDesignerBrainConfig> {
  return smartDesignerSlot.getConfig();
}

/** Uncached read for the admin screen — always reflects the database. */
export function getSmartDesignerBrainSetting(): Promise<SmartDesignerBrainSetting> {
  return smartDesignerSlot.getSetting();
}

/**
 * Save the platform Smart Designer battery. A field left out of the payload is
 * untouched; a field sent blank deletes its row so the default applies again.
 */
export function saveSmartDesignerBrainConfig(
  input: SaveSmartDesignerBrainInput,
  updatedByUserId: string
): Promise<SaveSmartDesignerBrainResult> {
  return smartDesignerSlot.save(input, updatedByUserId);
}
