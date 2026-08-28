import { createBrainSlot, type BrainSlotConfig } from "./brain-slot-settings";

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
 * with the door battery.
 *
 * THIS FILE USED TO PROMISE AN ADMIN SCREEN THAT DOES NOT EXIST: "swapping
 * this on the admin screen changes design for every architect instantly — no
 * deploy, no code change". There is no route and no screen. Fifteen exports
 * sat here waiting for one — the options list, the validators, the save, the
 * cache invalidator — and every one of them had no caller. A file that
 * describes a screen nobody built teaches the next person to look for it.
 *
 * What is true: the default below is what every design call runs on, and the
 * slot reads an override from the settings table if one is ever put there. If
 * an admin screen is wanted, the builder-brain routes and cards are the
 * pattern — it is a small piece of work, and it is not this file's claim to
 * make until somebody does it.
 */

/* THE NAMES STAY BECAUSE THE SAVED VALUES DO. These two strings are the keys
   the settings already sit under in the database. Renaming them to match what
   the screen now says would leave every value an admin has chosen behind under
   the old key, and the platform would come back up with defaults. The screen's
   words changed; the drawer label did not. */
const DESIGN_BRAIN_PROVIDER_KEY = "designBrainProvider";
const DESIGN_BRAIN_MODEL_KEY = "designBrainModel";

const DEFAULT_DESIGN_BRAIN_PROVIDER = "openai";
const DEFAULT_DESIGN_BRAIN_MODEL = "gpt-4.1-mini";


export type DesignBrainConfig = BrainSlotConfig;

const designSlot = createBrainSlot({
  name: "design-brain-settings",
  providerKey: DESIGN_BRAIN_PROVIDER_KEY,
  modelKey: DESIGN_BRAIN_MODEL_KEY,
  defaultProvider: DEFAULT_DESIGN_BRAIN_PROVIDER,
  defaultModel: DEFAULT_DESIGN_BRAIN_MODEL
});


/**
 * The battery every design call runs on. Cached for 60s.
 *
 * Never throws: on a database error the last known battery (or the default)
 * applies, so an architect mid-design is never blocked by a settings read.
 */
export function getDesignBrainConfig(): Promise<DesignBrainConfig> {
  return designSlot.getConfig();
}

