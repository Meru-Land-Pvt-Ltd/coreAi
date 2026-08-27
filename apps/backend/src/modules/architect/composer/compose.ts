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
import { getBuilderBrainConfig } from "../../admin/builder-brain-settings";
import { getProviderEngine } from "../../ai-provider-engine/provider-engine";
import type { AIExecuteRequest, AIMessage } from "../../ai-provider-engine/types";
import { checkPlan, type ComposerPlan } from "./check-plan";
import { composerMenu, menuAsText, type MenuEntry } from "./node-menu";
import { builderMind } from "../builder-mind";

/** What the architect sees while it works. */
export type ComposerProgress = {
  step: string;
  detail?: string;
};

export type ComposerResult =
  | { ok: true; plan: ComposerPlan; menu: MenuEntry[]; attempts: number }
  /* THE THIRD ANSWER (the founder's ruling, 2026-08-26): an employee handed
     a job with a human-only unknown builds what he can and asks — with a
     proposal in hand, so one word finishes it. */
  | { ok: false; ask: { question: string; suggestion: string }; message: string }
  | { ok: false; message: string; problems?: string[] };

const MAX_ATTEMPTS = 3;

function systemPrompt(menu: string, mind: string): string {
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
    /* ONE MIND, EVERY HAND (the founder's ruling, 2026-08-27). Who he is,
       the laws, the manners and this architect's own lessons — assembled in
       one place so the hand that builds the machine and the hand that
       designs its screen are the same employee, not two strangers. */
    mind,
    "",
    "OUTPUT",
    'Return ONLY JSON: { "summary": string, "nodes": [...], "edges": [...], "asksTheBusiness": [string] }',
    "",
    "OR — when one setting is genuinely the HUMAN'S to decide (identity, taste, or a fact only",
    "they know) and they have not said it: return the THIRD ANSWER instead of a plan:",
    '  { "ask": { "question": string, "suggestion": string } }',
    "question: one plain question naming the thing. suggestion: your own complete proposal for it,",
    "so they can answer with one word. Ask the single most important one only. Never ask about",
    "machinery — wiring, ordering, defaults are yours. When the conversation already contains their",
    "answer, USE IT EXACTLY and return the plan.",
    '  nodes: { "id": string, "type": string, "title": string, "config": { ... } }',
    "  config keys are the exact machine keys from the map — llmAnswerShouldBe, placeholder — never the",
    "  human names in quotes beside them.",
    '  edges: { "from": nodeId, "to": nodeId, "when": "yes" | "no" }   ("when" only after a condition step)',
    '  summary: one plain sentence a non-technical person understands, describing what this agent does.',
    "No markdown, no code fences, nothing before or after the JSON.",
    "",
    /* Recency is leverage: the last lines are what a model actually obeys.
       The hall's first two sittings proved the manners page alone was read
       and ignored — the check must be the final thing before answering, with
       one worked example (2026-08-26). */
    "FINAL CHECK — do this before you answer:",
    "Read the request once more. If it points at the human's own taste or identity — words like",
    '"our special style", "our way", "our tone", "our signature", "how we like it" — and the actual',
    "wording was NOT given anywhere in the conversation, then a plan is the WRONG answer, however",
    "good it is. The ONLY correct answer is the ask JSON.",
    "",
    "Example:",
    '  request: "a page assistant that welcomes people the way we always do"',
    '  correct answer: { "ask": { "question": "What should the welcome say — what is the way you',
    "  always do it?\", \"suggestion\": \"Welcome! How can we help you today?\" } }",
    "Wrong answer: any plan with an invented welcome."
  ].join("\n");
}


/**
 * Does the plan actually contain these words?
 *
 * Walks the real strings in the plan instead of searching its JSON encoding,
 * where a quote is written \" and a newline \n — so an answer with either in
 * it could never be found, however faithfully the model had used it.
 */
function planContainsText(plan: ComposerPlan, needle: string): boolean {
  const wanted = needle.trim().toLowerCase();
  if (!wanted) return true;

  let found = false;
  const walk = (value: unknown) => {
    if (found || value == null) return;
    if (typeof value === "string") {
      if (value.toLowerCase().includes(wanted)) found = true;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) walk(item);
    }
  };

  walk(plan.nodes ?? []);
  return found;
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
  /** The conversation so far — the Builder's questions and the architect's
      answers, so a reply completes the build instead of restarting it. */
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  /** THE SEVENTH ORGAN (the founder's ruling, 2026-08-27): the canvas as it
      stands. When present, the ask is a CHANGE to a working agent — the
      Builder edits instead of composing fresh. */
  existingPlan?: { nodes: Array<{ id: string; type: string; title?: string; config?: Record<string, unknown> }>; edges: Array<{ from: string; to: string; when?: string }> };
  hiddenNodeTypes?: string[];
  onProgress?: (progress: ComposerProgress) => void;
}): Promise<ComposerResult> {
  const say = (step: string, detail?: string) => input.onProgress?.({ step, detail });

  /* THE NARRATION (the founder's ruling, 2026-08-27): a person watching
     silence assumes a hang. Every stage says what is happening in the words
     a colleague would use — and the detail line carries the specifics, so
     the architect sits WITH the work instead of waiting on it. */
  say("Reading what you asked for", input.existingPlan ? "an agent you already built" : undefined);

  const brain = resolveBrainSlot(await getBuilderBrainConfig());
  if (!brain) {
    return {
      ok: false,
      message: "No AI service is switched on yet, so nothing can be built for you. An admin sets that up in Manage API."
    };
  }

  say("Looking at every step available to you");
  const menu = await composerMenu(input.architectUserId, input.hiddenNodeTypes ?? []);
  if (menu.length === 0) {
    return { ok: false, message: "There are no steps available to build with." };
  }
  say(
    "Looking at every step available to you",
    `${menu.length} steps in your toolkit${input.existingPlan ? `, ${input.existingPlan.nodes.length} already on your canvas` : ""}`
  );

  /* A LAW IS MACHINERY, NOT A REQUEST (2026-08-26). Three exam sittings
     proved the model reads "ask about their taste" and builds anyway. So
     the known taste-pointers are caught HERE, deterministically: words that
     point at something only the human knows mean the only correct answer
     is a question — before any model gets a vote. The Intelligence still
     teaches the general case; machinery guarantees the known one. */
  const TASTE_POINTERS: RegExp[] = [
    /our (own |special |unique )?(style|way|tone|voice|signature)/i,
    /how we (like|do|always do) it/i,
    /the way we always/i,
    /in our brand/i
  ];
  const humanAnswered = (input.conversation ?? []).some((turn) => turn.role === "user");
  const pointer = TASTE_POINTERS.map((r) => r.exec(input.want)?.[0]).find(Boolean);
  if (pointer && !humanAnswered && !input.existingPlan) {
    say("One thing only you can decide");
    return {
      ok: false,
      ask: {
        question: `You said "${pointer}" — that's something only you know. What exactly should it say?`,
        suggestion: "Hi! Welcome — how can we help you today?"
      },
      message: `You said "${pointer}" — that's something only you know. What exactly should it say?`
    };
  }

  /* Connection cards are born after the Soul ships, so their wisdom is
     generated from their own rows (2026-08-26) — and rides inside the one
     mind, like everything else. */
  const mind = await builderMind({
    hand: input.existingPlan ? "repair" : "compose",
    architectUserId: input.architectUserId,
    focus: input.want,
    connections: menu
      .filter((entry) => entry.type.startsWith("connector."))
      .map((entry) => ({
        id: entry.type.replace(/^connector\./, ""),
        label: entry.label,
        description: entry.does,
        gives: entry.gives
      }))
  });

  const messages: AIMessage[] = [
    ...(input.existingPlan
      ? [
          {
            role: "user" as const,
            content: `THE CANVAS AS IT STANDS — a working agent the architect built. Their next message asks for a CHANGE. Edit, do not rebuild: keep the ids and settings of every step they did not ask you to touch, change exactly what was asked, and return the COMPLETE revised plan.\n${JSON.stringify(input.existingPlan).slice(0, 12_000)}`
          }
        ]
      : []),
    ...(input.conversation ?? []).slice(-8).map((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, 2000)
    })),
    { role: "user", content: input.want.slice(0, 4000) }
  ];
  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt === 1) {
      say(
        input.existingPlan ? "Working out what to change" : "Choosing the steps and wiring them together",
        input.existingPlan ? "keeping everything you did not ask me to touch" : undefined
      );
    } else {
      say(`Checking my work — round ${attempt}`, lastProblems[0] ?? undefined);
    }

    const request: AIExecuteRequest = {
      capability: "llm",
      systemPrompt: systemPrompt(menuAsText(menu), mind),
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

    say(attempt === 1 ? "Thinking it through" : "Thinking again");
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

    /* THE BUILDER'S OWN QUESTION WAS BINNED. The instructions above tell it,
       twice, that when it needs to know something it may answer with
       { "ask": { question, suggestion } } instead of a plan. This check
       demanded a nodes array, so that answer was rejected as "not usable
       JSON" and the question the Builder wanted to ask was never asked —
       it retried, then gave up. The panel has been waiting for this the
       whole time. */
    const askedRaw = raw && typeof raw === "object" ? (raw as { ask?: unknown }).ask : null;
    const asked =
      askedRaw && typeof askedRaw === "object"
        ? (askedRaw as { question?: unknown; suggestion?: unknown })
        : null;
    const askedQuestion = typeof asked?.question === "string" ? asked.question.trim() : "";

    if (askedQuestion) {
      return {
        ok: false,
        ask: {
          question: askedQuestion,
          suggestion: typeof asked?.suggestion === "string" ? asked.suggestion.trim() : ""
        },
        message: askedQuestion
      };
    }

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
    say("Checking every step and every wire", `${plan.nodes?.length ?? 0} steps to verify`);
    const problems = checkPlan(plan, menu, input.want);

    /* THEIR WORDS ARE SACRED, mechanically: when the human answered a
       question, their exact words must appear in the plan. A model that
       "improves" them gets the order back, verbatim, through the same
       retry loop every other law uses. */
    const lastAnswer = [...(input.conversation ?? [])].reverse().find((turn) => turn.role === "user")?.content.trim();
    if (
      lastAnswer &&
      lastAnswer.length >= 8 &&
      !/you decide|up to you|anything is fine|whatever/i.test(lastAnswer) &&
      /* SEARCHED IN THE ENCODING, NOT THE WORDS. This looked for the answer
         inside JSON.stringify of the plan — where a quote becomes \" and a
         newline becomes \n — so any answer containing either could never be
         found, even when the model had used it exactly. The architect was
         then told off for words they had used, three times, and the build
         gave up. Look at the decoded values. */
      !planContainsText(plan, lastAnswer)
    ) {
      problems.push(
        `The person answered: "${lastAnswer}". Use those words EXACTLY, unchanged, in the setting they answer — never improved or summarised.`
      );
    }

    if (problems.length === 0) {
      say("Done", plan.summary);
      return { ok: true, plan, menu, attempts: attempt };
    }

    lastProblems = problems;
    /* The shape of each failing step rides in the log — "needs X and was not
       given one" is undiagnosable without seeing what the model DID write. */
    console.warn("[composer] plan did not hold", {
      attempt,
      problems: problems.slice(0, 5),
      nodeShapes: JSON.stringify(
        plan.nodes.map((node) => ({ id: node.id, type: node.type, configKeys: Object.keys(node.config ?? {}) }))
      )
    });

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
