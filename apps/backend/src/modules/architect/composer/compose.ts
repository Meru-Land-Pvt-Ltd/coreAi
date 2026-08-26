/**
 * BUILDING AN ORCHESTRATION FROM A SENTENCE.
 *
 * An architect types "an AI receptionist for a dental practice that answers the
 * phone, books appointments and texts people back when we miss a call", and
 * this assembles it out of steps that already exist.
 *
 * The arrangement is the one that has worked twice already on this platform:
 * a model proposes, a machine checks, and the exact problems go straight back
 * for another attempt. Nothing reaches a canvas because it read well — it
 * reaches a canvas because every step is real, every wire lands somewhere, and
 * nothing is left stranded.
 *
 * Two things it may never do, and both are enforced rather than requested:
 * invent a step that does not exist, and write code. The menu it chooses from
 * is read from the registry, and anything not on it is rejected by name.
 */

import { resolveBrainSlot } from "../../admin/brain-slot-settings";
import { getSmartDesignerBrainConfig } from "../../admin/smart-designer-brain-settings";
import { getProviderEngine } from "../../ai-provider-engine/provider-engine";
import type { AIExecuteRequest, AIMessage } from "../../ai-provider-engine/types";
import { checkPlan, type ComposerPlan } from "./check-plan";
import { composerMenu, menuAsText, type MenuEntry } from "./node-menu";
import { builderSoulText, connectionWisdom } from "../builder-soul";
import { lessonsForPrompt } from "../builder-lessons";

/** What the architect sees while it works. */
export type ComposerProgress = {
  step: string;
  detail?: string;
};

export type ComposerResult =
  | { ok: true; plan: ComposerPlan; menu: MenuEntry[]; attempts: number }
  | { ok: false; message: string; problems?: string[] };

const MAX_ATTEMPTS = 3;

function systemPrompt(menu: string, personalLessons: string, connections: string): string {
  return [
    "You assemble agents for Triven, out of steps that already exist.",
    "",
    "An architect tells you in plain English what they want their agent to do. You return the",
    "orchestration: which steps, in what order, wired together, with each step's settings filled in.",
    "",
    "THE STEPS YOU MAY USE — there are no others, and you may not write code:",
    menu,
    "",
    "HOW TO BUILD IT",
    "- Exactly one trigger. It is the thing that happens in the world to set the agent off.",
    "- PREFER ONE STEP THAT DOES THE WHOLE JOB over three that add up to it. If a step exists whose",
    "  description already matches what was asked for, use it. Assembling a receptionist out of",
    "  speech-to-text and a general AI step is worse than the receptionist step: it is more to go",
    "  wrong, and the purpose-built one already knows the business's hours, services and prices.",
    "- REPLY ON THE CHANNEL THEY ARRIVED ON. Somebody who telephoned gets a text, not a WhatsApp",
    "  message; somebody who messaged on WhatsApp gets a WhatsApp reply. Sending a stranger a message",
    "  on an app they never contacted you on is worse than sending nothing.",
    "- Use the business's own calendar for booking unless they specifically named another service.",
    "- Every step must be reachable from that trigger. A step nothing leads to never runs.",
    "- Wire by what each step GIVES and what the next one NEEDS. That is what makes a flow rather than a pile.",
    "- Fill in every setting a step needs. When the value is something only the business knows —",
    "  their phone number, their opening hours, their calendar — write {{business.thatThing}} and it",
    "  will be asked for on their setup screen. Never invent a phone number, an address or a price.",
    "- Use as few steps as will genuinely do the job. An extra step that reaches a real person is not",
    "  an extra feature; it is a second text message to somebody's customer.",
    "- Give every step a short title in the architect's own words, not the type name.",
    "- THE FACE IS A JUDGEMENT, NOT AN ASSEMBLY. When the agent has a customer at its page, compose",
    "  the fewest Face pieces the job truly needs — usually exactly one Prompt Box and one Result",
    "  Viewer — and write the customer's words into them: a placeholder that says what to type, a",
    "  button verb they recognise. Never a platform word on the screen. When nobody visits the page",
    "  (a Timer, an email ear, a webhook), compose NO Face at all.",
    "",
    /* The Builder Soul rides with every request — fetched fresh, so a swapped
       LLM is briefed on its first breath. This is where "where to start, how
       much per node, where to end" comes from. */
    builderSoulText(connections),
    ...(personalLessons ? ["", personalLessons] : []),
    "",
    "OUTPUT",
    'Return ONLY JSON: { "summary": string, "nodes": [...], "edges": [...], "asksTheBusiness": [string] }',
    '  nodes: { "id": string, "type": string, "title": string, "config": { ... } }',
    '  edges: { "from": nodeId, "to": nodeId, "when": "yes" | "no" }   ("when" only after a condition step)',
    '  summary: one plain sentence a non-technical person understands, describing what this agent does.',
    "No markdown, no code fences, nothing before or after the JSON."
  ].join("\n");
}

function extractJson(text: string): unknown {
  const trimmed = (text ?? "").trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // A model that wrapped the JSON in a sentence. Take the outermost object.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export async function composeOrchestration(input: {
  architectUserId: string;
  /** What the architect typed. */
  want: string;
  hiddenNodeTypes?: string[];
  onProgress?: (progress: ComposerProgress) => void;
}): Promise<ComposerResult> {
  const say = (step: string, detail?: string) => input.onProgress?.({ step, detail });

  say("Reading what you asked for");

  const brain = resolveBrainSlot(await getSmartDesignerBrainConfig());
  if (!brain) {
    return {
      ok: false,
      message: "No AI service is switched on yet, so nothing can be built for you. An admin sets that up in Manage API."
    };
  }

  say("Looking at every step available to you");
  const [menu, personalLessons] = await Promise.all([
    composerMenu(input.architectUserId, input.hiddenNodeTypes ?? []),
    lessonsForPrompt(input.architectUserId)
  ]);
  if (menu.length === 0) {
    return { ok: false, message: "There are no steps available to build with." };
  }
  say("Looking at every step available to you", `${menu.length} to choose from`);

  /* Connection cards are born after the Soul ships, so their wisdom is
     generated from their own rows (the founder's third hole, 2026-08-26). */
  const connections = connectionWisdom(
    menu
      .filter((entry) => entry.type.startsWith("connector."))
      .map((entry) => ({
        id: entry.type.replace(/^connector\./, ""),
        label: entry.label,
        description: entry.does,
        gives: entry.gives
      }))
  );

  const messages: AIMessage[] = [{ role: "user", content: input.want.slice(0, 4000) }];
  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt === 1) say("Choosing the steps and wiring them together");
    else say("Fixing what did not hold", lastProblems[0] ?? undefined);

    const request: AIExecuteRequest = {
      capability: "llm",
      systemPrompt: systemPrompt(menuAsText(menu), personalLessons, connections),
      conversationHistory: [],
      messages: [...messages],
      // Low, because this is arithmetic dressed as writing: which step, wired
      // where. The warmth belongs in the titles, and the checker holds the line.
      temperature: 0.2,
      maxTokens: 6000,
      outputFormat: "json",
      task: "compose-orchestration",
      ...(brain.model ? { model: brain.model } : {})
    };

    let response;
    try {
      response = await getProviderEngine().executeWithProvider(brain.providerId, request);
      /* The one patient retry, same as the platform brain's: a rate-limited
         provider gets a breath and one more chance before we give up. */
      if (response.status === "error" && /429|rate.?limit/i.test(String(response.error ?? ""))) {
        await new Promise((resolve) => setTimeout(resolve, 7000));
        response = await getProviderEngine().executeWithProvider(brain.providerId, request);
      }
    } catch (error) {
      console.error("[composer] LLM call failed", error);
      return {
        ok: false,
        message: "The AI service could not be reached just now, so nothing was built. Nothing was changed on your canvas."
      };
    }

    if (response.status === "error") {
      console.error("[composer] LLM returned an error", response.error);
      return {
        ok: false,
        message: "The AI service returned an error, so nothing was built. Nothing was changed on your canvas."
      };
    }

    const raw =
      response.structuredOutput && typeof response.structuredOutput === "object"
        ? response.structuredOutput
        : extractJson(response.text ?? "");

    const plan = raw as ComposerPlan | null;
    if (!plan || !Array.isArray(plan.nodes)) {
      messages.push({ role: "assistant", content: (response.text ?? "").slice(0, 2000) });
      messages.push({
        role: "user",
        content: 'That was not usable JSON. Return exactly { "summary": string, "nodes": [...], "edges": [...] } and nothing else.'
      });
      lastProblems = ["The answer was not usable."];
      continue;
    }

    say("Checking every step is real and every wire lands");
    const problems = checkPlan(plan, menu);

    if (problems.length === 0) {
      say("Done", plan.summary);
      return { ok: true, plan, menu, attempts: attempt };
    }

    lastProblems = problems;
    console.warn("[composer] plan did not hold", { attempt, problems: problems.slice(0, 5) });

    messages.push({ role: "assistant", content: JSON.stringify(plan).slice(0, 4000) });
    messages.push({
      role: "user",
      content: [
        "That plan does not hold. Fix exactly these and return the whole plan again:",
        ...problems.map((problem) => `- ${problem}`)
      ].join("\n")
    });
  }

  // Three attempts and it still would not hold. Saying so is the only honest
  // answer — half an orchestration on a canvas is worse than none, because it
  // looks finished.
  return {
    ok: false,
    message:
      "I could not build something I am confident in from that description. Nothing was put on your canvas. Try describing it a little more plainly — what starts it, and what should happen.",
    problems: lastProblems
  };
}
