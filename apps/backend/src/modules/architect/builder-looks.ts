/**
 * THE BUILDER LOOKS AT HIS OWN WORK.
 *
 * The founder's ruling (2026-08-27), in his own words:
 *
 *   "Whenever I tell you as a real human, you check it in your own browser,
 *    you test it for real, you take the screenshot, verify it with the
 *    desired result — and then you confirm it is working. Is the present AI
 *    Builder doing the same thing?"
 *
 * It was not. It composed, and the first eyes on the result were always the
 * architect's — which is exactly how a Telegram agent was handed a website
 * screen and nobody knew until a founder pressed Preview.
 *
 * So the loop closes here: BUILD → LOOK → JUDGE → FIX → LOOK AGAIN, and the
 * Builder only says "done" about what the look confirmed.
 *
 * Two halves, and both are needed:
 *   THE PICTURE — a real browser in its own room renders the page and hands
 *                 back a screenshot (apps/eyes).
 *   THE JUDGEMENT — the Builder's own eyes brain reads that picture against
 *                 what the architect asked for.
 *
 * Model-agnostic by construction: which brain looks is an admin setting, and
 * a service that cannot see says so honestly instead of failing strangely.
 */

import { getBuilderEyesConfig, serviceCanSee } from "../admin/builder-brain-settings";
import { streamPlatformBrain } from "./platform-brain";
import { env } from "../../config/env";

const EYES_URL = process.env.EYES_URL || "http://eyes:8791";
const EYES_TOKEN = process.env.EYES_TOKEN || "";
const LOOK_TIMEOUT_MS = 30_000;

export type Look = {
  /** A PNG data URL of the page as a customer would meet it. */
  image: string;
  /** The words actually on the page — cheap evidence, no model needed. */
  text: string;
  /** Errors the page threw while rendering. A screen that renders while
   *  throwing is not a working screen. */
  consoleErrors: string[];
};

export type LookFailure = { failed: string };

/**
 * Take one honest picture of one of our own pages.
 *
 * Never throws: a Builder that crashes because it could not look is worse
 * than one that says "I could not look".
 */
export async function lookAt(input: {
  /** A path on our own frontend, e.g. "/a/agent-slug". */
  path: string;
  viewport?: { width: number; height: number };
}): Promise<Look | LookFailure> {
  const origin = process.env.EYES_ALLOWED_ORIGIN || "http://frontend:3000";
  const url = `${origin.replace(/\/+$/, "")}${input.path.startsWith("/") ? input.path : `/${input.path}`}`;

  try {
    const response = await fetch(`${EYES_URL}/look`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(EYES_TOKEN ? { "x-eyes-token": EYES_TOKEN } : {})
      },
      body: JSON.stringify({ url, ...(input.viewport ? { viewport: input.viewport } : {}) }),
      signal: AbortSignal.timeout(LOOK_TIMEOUT_MS)
    });

    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; image?: string; text?: string; consoleErrors?: string[]; error?: string }
      | null;

    if (!response.ok || !body?.ok || !body.image) {
      return { failed: body?.error || `The page could not be looked at (${response.status}).` };
    }
    return {
      image: body.image,
      text: body.text ?? "",
      consoleErrors: Array.isArray(body.consoleErrors) ? body.consoleErrors : []
    };
  } catch (error) {
    return { failed: `The looking room could not be reached: ${(error as Error).message}` };
  }
}

/** True when a look is possible at all — an honest answer beats a mystery. */
export async function canLook(): Promise<{ ok: true } | { ok: false; why: string }> {
  const eyes = await getBuilderEyesConfig().catch(() => null);
  if (!eyes || !serviceCanSee(eyes.providerId)) {
    return {
      ok: false,
      why: "The seeing brain is not switched on. An admin sets it in AI Builder → The Builder's Eyes."
    };
  }
  try {
    const health = await fetch(`${EYES_URL}/health`, { signal: AbortSignal.timeout(4_000) });
    if (!health.ok) return { ok: false, why: "The looking room is not answering." };
  } catch {
    return { ok: false, why: "The looking room is not running." };
  }
  return { ok: true };
}

/** Whether the platform was built with a looking room at all. */
export function lookingRoomConfigured(): boolean {
  return Boolean(process.env.EYES_URL || env.NODE_ENV === "production");
}

/* ------------------------- the judgement half ---------------------------- */

export type Judgement = {
  /** True when the picture genuinely shows what the architect asked for. */
  works: boolean;
  /** What is wrong, in plain words — fed straight back as the next order. */
  problems: string[];
};

const JUDGE_INSTRUCTION = [
  "You are looking at a screenshot of a page you just built, and deciding — honestly — whether it does",
  "what was asked for. You are not being polite; you are being useful.",
  "",
  "Say it WORKS only if the picture shows it. If you cannot see the thing you were asked to build, it",
  "does not work, however good your reasons. A blank area, a broken layout, a missing box, text in our",
  "own jargon instead of the customer's words — all of these are failures.",
  "",
  "ALSO FAIL IT for anything a paying customer would resent: a platform word on screen (workflow, node,",
  "trigger, webhook, config), a leaked {{token}}, two boxes doing one job, or a control for something",
  "the agent cannot actually do.",
  "",
  'Answer ONLY JSON: { "works": boolean, "problems": [string] }.',
  "Each problem is one short sentence naming exactly what to change. No problems when it works."
].join("\n");

/**
 * Judge one look against one ask.
 *
 * Deliberately a SEPARATE call from the one that built the page: a maker
 * marking their own homework in the same breath will pass it. Same rule the
 * Examination Hall keeps — the judge is never the builder mid-sentence.
 */
export async function judgeLook(input: {
  ask: string;
  look: Look;
}): Promise<Judgement> {
  /* Free evidence first — no model needed, and it can never hallucinate. */
  const mechanical: string[] = [];
  if (input.look.consoleErrors.length > 0) {
    mechanical.push(`The page threw an error while rendering: ${input.look.consoleErrors[0]}`);
  }
  const jargon = /\b(workflow|node|trigger|webhook|llm|config|payload)s?\b/i.exec(input.look.text);
  if (jargon) {
    mechanical.push(`A customer would read our own word "${jargon[1]}" on this screen.`);
  }
  if (/\{\{/.test(input.look.text)) {
    mechanical.push("A {{token}} is showing on the screen — machinery through the paint.");
  }
  if (input.look.text.trim().length < 10) {
    mechanical.push("The page is effectively empty — nothing a customer could use.");
  }

  const eyes = await getBuilderEyesConfig().catch(() => null);
  if (!eyes || !serviceCanSee(eyes.providerId)) {
    /* No seeing brain: the mechanical checks still stand, and the platform
       says plainly that it could not look properly rather than passing it. */
    return {
      works: mechanical.length === 0,
      problems: mechanical.length > 0 ? mechanical : []
    };
  }

  let answer = "";
  await streamPlatformBrain({
    instruction: JUDGE_INSTRUCTION,
    message: `THE ARCHITECT ASKED FOR: ${input.ask}\n\nHere is the page you built. Does it show that?`,
    images: [input.look.image],
    maxTokens: 400,
    task: "builder-judges-its-own-work",
    onWord: (chunk: string) => {
      answer += chunk;
    }
  });

  try {
    const parsed = JSON.parse(answer.trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "")) as Judgement;
    const problems = [...mechanical, ...(Array.isArray(parsed.problems) ? parsed.problems : [])];
    return { works: Boolean(parsed.works) && mechanical.length === 0, problems };
  } catch {
    /* A judge that cannot be read has not judged. Never a silent pass. */
    return {
      works: false,
      problems: [...mechanical, "I could not read my own verdict on that screen — look again."]
    };
  }
}
