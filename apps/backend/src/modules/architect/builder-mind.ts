/**
 * THE BUILDER'S MIND — one employee, one briefing, every hand.
 *
 * The founder's ruling (2026-08-27), and his own words for why:
 *
 *   "It's like the backend and the frontend are done by two people — how can
 *    we expect synchronous results? Common sense says the one who builds the
 *    backend also builds the frontend."
 *
 * He was describing a real defect, not a preference. The platform had EIGHT
 * separate minds doing one employee's job — chat, explain, compose, repair,
 * diagnose, check, page-design, self-build — and each was briefed
 * differently. The chat carried the Soul; the page designer did not. That is
 * precisely how a Telegram agent, a machine with no page at all, was handed
 * a website screen.
 *
 * Worse in code than between two people: two people at least talk over
 * coffee. Two model calls share nothing — no memory, no conversation, no
 * context. Every handoff is a stranger reading a spec.
 *
 * So: ONE briefing, assembled here, carried by EVERY hand. A hand may add
 * what only it needs (the canvas, the run, the page it is editing) — it may
 * never subtract from the mind.
 *
 * THE FOUR LAYERS, in the order a person would learn them:
 *   WHO HE IS      — one identity, one voice, whatever hand is working
 *   THE LAWS       — the Soul: what nodes are, how they combine (the Bones
 *                    ride inside it, generated from the registry)
 *   THE MANNERS    — Builder Intelligence: how to treat the human
 *   WHAT HE LEARNED— this architect's own lessons, taught by them
 *
 * Any model behind it, replaceable in ten seconds from the admin screen.
 */

import { builderSoulText, connectionWisdom } from "./builder-soul";
import { builderIntelligenceText } from "./builder-intelligence";
import { lessonsForPrompt } from "./builder-lessons";

/** Which hand is working. The mind is the same; the hand says what it is doing. */
export type BuilderHand =
  | "chat"
  | "explain"
  | "compose"
  | "repair"
  | "diagnose"
  | "check"
  | "design-page"
  | "build-card";

const WHO_HE_IS = `WHO YOU ARE

You are the AI Builder on Triven — ONE employee, not a collection of tools.
The same you builds the machine, designs the screen it wears, explains what a
run did, repairs what broke, and writes a new connection card when the toolkit
is missing one. You remember what you just did, because it was you who did it.

Never speak of yourself in parts. There is no "the designer", no "the
composer", no other assistant to hand someone off to. If a person asks for
something you can do with a different hand, you simply do it.

You work for an architect: a person building an AI employee that a business
will pay for. They are often not technical, and they are always spending real
money and real hours. Everything you say to them is in plain words.`;

/** What each hand is doing right now — one line, so the mind stays whole. */
const HAND_AT_WORK: Record<BuilderHand, string> = {
  chat: "RIGHT NOW: you are talking with the architect.",
  explain: "RIGHT NOW: you are explaining what their agent actually did on its last runs.",
  compose: "RIGHT NOW: you are building the machine — the steps and the wiring.",
  repair: "RIGHT NOW: you are fixing exactly what the checker refused, and nothing else.",
  diagnose: "RIGHT NOW: you are working out why their agent behaved as it did.",
  check: "RIGHT NOW: you are testing their agent against the purpose they wrote.",
  "design-page":
    "RIGHT NOW: you are designing the screen a CUSTOMER meets — the same you who built the machine behind it, so you already know what it needs and what it does not.",
  "build-card": "RIGHT NOW: you are describing a new connection to an outside service."
};

/**
 * The whole mind, for one hand.
 *
 * `focus` narrows the Soul's per-node wisdom to what this request is about
 * (the laws and combinations always ride). `connections` carries the custom
 * cards, which are born after the Soul ships.
 */
export async function builderMind(input: {
  hand: BuilderHand;
  architectUserId?: string;
  /** The architect's words, used to narrow which node wisdom rides along. */
  focus?: string;
  /** Connection cards available on this canvas, if any. */
  connections?: Array<{ id: string; label: string; description: string; gives?: string[]; mine?: boolean }>;
}): Promise<string> {
  const [lessons] = await Promise.all([
    input.architectUserId ? lessonsForPrompt(input.architectUserId).catch(() => "") : Promise.resolve("")
  ]);

  return [
    WHO_HE_IS,
    "",
    HAND_AT_WORK[input.hand],
    "",
    builderSoulText(input.connections?.length ? connectionWisdom(input.connections) : "", input.focus ?? ""),
    "",
    builderIntelligenceText(),
    ...(lessons ? ["", lessons] : [])
  ].join("\n");
}
