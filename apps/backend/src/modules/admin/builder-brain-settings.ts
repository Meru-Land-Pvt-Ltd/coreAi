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
 * THE AI BUILDER'S OWN TWO BRAINS — the employee, and his eyes.
 *
 * The founder's ruling (2026-08-27), from a real failure: the Builder's
 * seeing model was hard-coded as "pixtral-large-latest", the platform's key
 * did not carry it, and every screenshot an architect sent was refused —
 * with only a developer able to fix it. A model name written in code is a
 * decision the founder cannot make, and that is the wrong place for it.
 *
 * So both of the Builder's brains join the door and page batteries on the
 * admin screen, under one pattern the admin already knows: an AI service and
 * an optional model, blank meaning "use that service's standard model".
 *
 *   THE BUILDER'S BRAIN — the employee an architect talks to. Composes
 *                         agents, explains runs, edits canvases.
 *   THE BUILDER'S EYES  — the brain that reads the screenshots an architect
 *                         pastes into the chat. A DIFFERENT slot on purpose:
 *                         seeing is a rarer, dearer job than talking, and
 *                         not every service that talks can see.
 *
 * Storage, validation and caching come from {@link createBrainSlot}, shared
 * with every other battery so the slots can never drift apart.
 */

/* --------------------------- the employee's brain ------------------------- */

/**
 * ONE BRAIN FOR THE WHOLE EMPLOYEE (the founder's ruling, 2026-08-27).
 *
 * It briefly stood as TWO settings — one for the brain that talks and builds
 * the machine, another for the brain that designs its screen. The founder
 * named the real cost of that, and it is not money:
 *
 *   "It's like the backend and frontend are done by two people — how can we
 *    expect synchronous results? Common sense says the one who builds the
 *    backend also builds the frontend."
 *
 * Exactly right, and worse in code than between two humans: two people at
 * least talk; two brains share no memory and no conversation. That split is
 * how a Telegram agent — a machine with no page at all — ended up being
 * given a website screen. One mind builds the machine AND its face, because
 * it knows why the machine is that way.
 *
 * The storage keys stay the ones already in the database, so nothing an
 * admin already saved is lost to a rename.
 */
export const BUILDER_BRAIN_PROVIDER_KEY = "pageHandProvider";
export const BUILDER_BRAIN_MODEL_KEY = "pageHandModel";

export const DEFAULT_BUILDER_BRAIN_PROVIDER = "claude";
export const DEFAULT_BUILDER_BRAIN_MODEL = "claude-opus-5";

export const BUILDER_BRAIN_MODEL_MAX_LENGTH = BRAIN_MODEL_MAX_LENGTH;

export type BuilderBrainConfig = BrainSlotConfig;
export type BuilderBrainSetting = BrainSlotSetting;
export type SaveBuilderBrainInput = SaveBrainSlotInput;
export type SaveBuilderBrainResult = SaveBrainSlotResult;

const builderBrainSlot = createBrainSlot({
  name: "AI Builder brain",
  providerKey: BUILDER_BRAIN_PROVIDER_KEY,
  modelKey: BUILDER_BRAIN_MODEL_KEY,
  defaultProvider: DEFAULT_BUILDER_BRAIN_PROVIDER,
  defaultModel: DEFAULT_BUILDER_BRAIN_MODEL
});

export function invalidateBuilderBrainConfigCache(): void {
  builderBrainSlot.invalidateCache();
}

/**
 * The ONE battery the AI Builder runs on — talking, composing the machine,
 * repairing it, diagnosing a run, and designing the customer's screen.
 */
export function getBuilderBrainConfig(): Promise<BuilderBrainConfig> {
  return builderBrainSlot.getConfig();
}

/** Uncached read for the admin screen. */
export function getBuilderBrainSetting(): Promise<BuilderBrainSetting> {
  return builderBrainSlot.getSetting();
}

export function saveBuilderBrainConfig(
  input: SaveBuilderBrainInput,
  updatedByUserId: string
): Promise<SaveBuilderBrainResult> {
  return builderBrainSlot.save(input, updatedByUserId);
}

/* ------------------------------- the eyes -------------------------------- */

export const BUILDER_EYES_PROVIDER_KEY = "builderEyesProvider";
export const BUILDER_EYES_MODEL_KEY = "builderEyesModel";

/**
 * No default model on purpose.
 *
 * A hard-coded seeing model is exactly what broke on the day this slot was
 * born. Blank means "use the chosen service's standard model" — and when a
 * service cannot see at all, the platform says so honestly to the architect
 * rather than refusing their screenshot with a stranger's error code.
 */
export const DEFAULT_BUILDER_EYES_PROVIDER = "claude";
export const DEFAULT_BUILDER_EYES_MODEL = "";

export type BuilderEyesConfig = BrainSlotConfig;
export type BuilderEyesSetting = BrainSlotSetting;

const builderEyesSlot = createBrainSlot({
  name: "AI Builder eyes",
  providerKey: BUILDER_EYES_PROVIDER_KEY,
  modelKey: BUILDER_EYES_MODEL_KEY,
  defaultProvider: DEFAULT_BUILDER_EYES_PROVIDER,
  defaultModel: DEFAULT_BUILDER_EYES_MODEL
});

export function invalidateBuilderEyesConfigCache(): void {
  builderEyesSlot.invalidateCache();
}

/** The battery the Builder SEES on — used only when pictures are attached. */
export function getBuilderEyesConfig(): Promise<BuilderEyesConfig> {
  return builderEyesSlot.getConfig();
}

export function getBuilderEyesSetting(): Promise<BuilderEyesSetting> {
  return builderEyesSlot.getSetting();
}

export function saveBuilderEyesConfig(
  input: SaveBuilderBrainInput,
  updatedByUserId: string
): Promise<SaveBuilderBrainResult> {
  return builderEyesSlot.save(input, updatedByUserId);
}

/* ---------------------------- shared helpers ----------------------------- */

export const builderBrainProviderOptions = brainProviderOptions;
export const isSupportedBuilderBrainProvider = isSupportedBrainProvider;
export const builderBrainModelMismatch = brainModelMismatch;
export const builderBrainModelOptions = brainModelOptions;

/**
 * Which services can actually LOOK at a picture.
 *
 * Kept here, in one place, so the admin screen can say plainly which choices
 * see — and so the Builder can refuse honestly instead of sending a
 * screenshot to a service that will reject it. A service missing from this
 * list is not broken; it simply has no eyes.
 */
export const SERVICES_THAT_SEE = ["claude", "openai", "gemini"] as const;

export function serviceCanSee(providerId: string | null | undefined): boolean {
  return (SERVICES_THAT_SEE as readonly string[]).includes((providerId ?? "").toLowerCase());
}
