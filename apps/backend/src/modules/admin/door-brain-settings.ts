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
 * The door battery — one model, swappable forever.
 *
 * Every AI door built inside a node (entry, exit, presentation) runs on the ONE
 * provider/model an admin picks here. There is deliberately no per-node model
 * setting anywhere: the doors belong to the platform, and swapping the battery
 * on this screen changes every door on every agent instantly.
 *
 * The storage, validation and caching rules live in {@link createBrainSlot},
 * shared with the Design Brain battery so the two can never drift apart. This
 * file is the door slot's identity: its keys, its default, its vocabulary.
 */

export const DOOR_BRAIN_PROVIDER_KEY = "doorBrainProvider";
export const DOOR_BRAIN_MODEL_KEY = "doorBrainModel";

/**
 * Safe default battery. Gemini's fast tier is the cheapest capable option for
 * the small, high-volume translation work doors do.
 */
export const DEFAULT_DOOR_BRAIN_PROVIDER = "gemini";

/** Longest model id an admin can save (generous; ids are short). */
export const DOOR_BRAIN_MODEL_MAX_LENGTH = BRAIN_MODEL_MAX_LENGTH;

export type DoorBrainConfig = BrainSlotConfig;
export type DoorBrainSetting = BrainSlotSetting;
export type SaveDoorBrainInput = SaveBrainSlotInput;
export type SaveDoorBrainResult = SaveBrainSlotResult;

const doorSlot = createBrainSlot({
  name: "door-brain-settings",
  providerKey: DOOR_BRAIN_PROVIDER_KEY,
  modelKey: DOOR_BRAIN_MODEL_KEY,
  defaultProvider: DEFAULT_DOOR_BRAIN_PROVIDER
});

/** The provider ids an admin may choose — the engine's known providers. */
export const doorBrainProviderOptions = brainProviderOptions;

/** True for provider ids the AI provider engine knows how to run. */
export const isSupportedDoorBrainProvider = isSupportedBrainProvider;

/** True when the model id belongs to a DIFFERENT provider than the one chosen. */
export const doorBrainModelMismatch = brainModelMismatch;

/** The models the admin screen offers for a provider (may be empty). */
export const doorBrainModelOptions = brainModelOptions;

/** Drop the cache so the next door run reflects a just-saved battery. */
export function invalidateDoorBrainConfigCache(): void {
  doorSlot.invalidateCache();
}

/**
 * The battery every door runs on. Cached for 60s.
 *
 * Never throws. On a database error it returns the last cached value when one
 * exists, otherwise the platform default — a door must always be able to try.
 */
export function getDoorBrainConfig(): Promise<DoorBrainConfig> {
  return doorSlot.getConfig();
}

/** Uncached read for the admin screen — always reflects the database. */
export function getDoorBrainSetting(): Promise<DoorBrainSetting> {
  return doorSlot.getSetting();
}

/**
 * Save the platform door battery. A field left out of the payload is untouched;
 * a field sent blank deletes its row so the default applies again.
 */
export function saveDoorBrainConfig(
  input: SaveDoorBrainInput,
  updatedByUserId: string
): Promise<SaveDoorBrainResult> {
  return doorSlot.save(input, updatedByUserId);
}
