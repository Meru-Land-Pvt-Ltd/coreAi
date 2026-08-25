/**
 * THE AI BUILDER — one assistant instead of three.
 *
 * The platform had grown three faces: the AI Composer built the canvas, the
 * Smart Designer edited the page, and a third — the Design Brain — was already
 * a corpse still registered in the palette. Three boxes, three names, and none
 * of them knew what the other two did or what the last run said. Nobody's
 * friend works like that; ChatGPT is one box that hears everything.
 *
 * The founder found the missing hand himself: he briefed a Brain wrongly, the
 * agent echoed his words back, and the only reason he did not walk away
 * confused is that a person was in the room to read the run and say, in one
 * sentence, which box the mistake was in. An architect alone gets nobody. This
 * module is that person.
 *
 * One face, many hands. The engines stay — composing and page-editing are
 * genuinely different machinery, and they already work. What this adds is the
 * one door in front of them:
 *
 *   needs  the architect's words + the canvas + the last run
 *   gives  which hand to use — or, for "why?" questions, the answer itself:
 *          the mistake and the fix, in plain words
 *
 * The routing and the explaining are the entry and exit doors of the SOP,
 * applied to the platform's own assistant.
 */

import { prisma } from "../../lib/prisma";
import { askPlatformBrain } from "./platform-brain";
import { builderSoulText } from "./builder-soul";
import { lessonsForPrompt } from "./builder-lessons";

export type AiBuilderHand = "build" | "page" | "explain";

export type AiBuilderAnswer = {
  /** Which hand the message belongs to. */
  hand: AiBuilderHand;
  /** For "explain": the answer itself. For the other hands: null — the caller
   *  passes the message on to the engine that already does that job. */
  reply: string | null;
};

const ROUTER_TIMEOUT_MS = 12_000;
const EXPLAIN_TIMEOUT_MS = 25_000;

/* ------------------------------------------------------------- the router */

const ROUTER_INSTRUCTION = [
  "You are routing one message from a person building an AI agent. Pick exactly one word:",
  "",
  "- build — they want steps, wiring or a whole agent created or changed on the canvas",
  '    ("build me a lead scorer", "add a condition after the brain", "make an agent that...")',
  "- page — they want the customer-facing page changed: boxes, sections, wording, layout, look",
  '    ("make the input box bigger", "add an email field", "change the button text", "make it blue")',
  "- explain — they are asking why something happened, what went wrong, or how something works",
  '    ("why is it just repeating what I type?", "why did it say no?", "what does this step do?")',
  "",
  'Answer with one word and nothing else: build, page, or explain. If genuinely unsure, say "explain" —',
  "a wrong answer to a question wastes a sentence; a wrongly rebuilt canvas wastes an afternoon."
].join("\n");

/* ----------------------------------------------------------- the explainer */

const EXPLAIN_INSTRUCTION = [
  "You are the AI Builder on the Triven platform, helping a non-technical person who built an AI agent",
  "out of connected steps. They are confused or curious about their own agent. You are given the agent's",
  "steps (with the exact words they typed into each) and what the most recent runs actually did.",
  "",
  "THE PLATFORM'S OWN WORDS — use these and no others:",
  '- An AI Brain step has exactly two boxes: "What is coming in" (describes what arrives) and',
  '  "How the answer should be" (the order — what to write back). Name the box you mean.',
  '- "Prompt Box" is a DIFFERENT step — the box a customer types into on the page. Never use',
  "  \"prompt box\" to mean a Brain's boxes.",
  "- Data flows between steps by itself. NEVER suggest typing {{anything}} in braces.",
  '- To point somewhere: click the step on the canvas, its boxes open on the right.',
  "",
  "Answer in AT MOST three short sentences, in plain simple words. If a step's own written",
  "instructions are causing the problem, quote the words they typed, name the exact box, and give",
  "the exact words to put there instead. If nothing is wrong, say what is actually happening in one",
  "sentence.",
  "",
  'When they ask "where", answer with the click-path: which step to click and which box to look at.',
  "Read the conversation so far — never answer a follow-up by repeating your previous answer.",
  "",
  "Never invent a run that did not happen. If the runs given to you do not show the problem, say what",
  "you would need them to try next — one concrete test."
].join("\n");

/** The canvas, in the words the architect typed — not our internals. */
async function describeAgent(workflowId: string): Promise<string> {
  const workflow = await prisma.workflowDefinition.findUnique({
    where: { id: workflowId },
    select: { name: true, purpose: true, workflowJson: true }
  });
  if (!workflow) return "(the agent could not be loaded)";

  const graph = workflow.workflowJson as { nodes?: Array<{ id?: string; data?: Record<string, unknown> }>; edges?: Array<{ source?: string; target?: string }> };
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  const names = new Map<string, string>();
  const lines: string[] = [
    `AGENT: ${workflow.name}`,
    /* The yardstick everything tallies against — the architect's own sentence. */
    ...(workflow.purpose?.trim() ? [`PURPOSE (what the architect said they are building): ${workflow.purpose.trim()}`] : []),
    "",
    "STEPS:"
  ];

  for (const node of nodes) {
    const data = node.data ?? {};
    const title = String(data.title ?? data.label ?? node.id ?? "step");
    names.set(String(node.id ?? ""), title);

    const parts: string[] = [`- "${title}" (${String(data.type ?? "step")})`];
    /* The fields an architect actually types into. These are their own words,
       and their own words are where briefing mistakes live. */
    const spoken: Array<[string, unknown]> = [
      ["what is coming in", data.llmInputIs],
      ["how the answer should be", data.llmAnswerShouldBe],
      ["prompt", data.llmRequirements],
      ["rule", data.conditionQuestion],
      ["roads out", Array.isArray(data.conditionChoices) ? (data.conditionChoices as unknown[]).join(", ") : undefined],
      ["always remember", data.customMemoryNotes]
    ];
    for (const [label, value] of spoken) {
      const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
      if (text) parts.push(`    ${label}: "${text.slice(0, 300)}"`);
    }
    lines.push(parts.join("\n"));
  }

  lines.push("", "WIRING:");
  for (const edge of edges) {
    lines.push(`- ${names.get(String(edge.source ?? "")) ?? edge.source} → ${names.get(String(edge.target ?? "")) ?? edge.target}`);
  }
  return lines.join("\n");
}

/** The last few runs, as they actually happened. */
async function describeRecentRuns(workflowId: string): Promise<string> {
  const runs = await prisma.workflowRun.findMany({
    where: { workflowId },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, status: true, createdAt: true }
  });
  if (runs.length === 0) return "RECENT RUNS: none yet.";

  const lines: string[] = ["RECENT RUNS (newest first):"];
  for (const run of runs) {
    const steps = await prisma.nodeRun.findMany({
      where: { workflowRunId: run.id },
      orderBy: { executionOrder: "asc" },
      select: { nodeLabel: true, status: true, summary: true, inputJson: true, outputJson: true }
    });
    lines.push(`\nRun (${run.status}):`);
    for (const step of steps) {
      const output = compact(step.outputJson);
      const input = compact(step.inputJson);
      lines.push(
        `- ${step.nodeLabel} [${step.status}]${input ? ` in: ${input}` : ""}${output ? ` out: ${output}` : ""}`
      );
    }
  }
  return lines.join("\n");
}

function compact(value: unknown): string {
  if (!value) return "";
  try {
    const record = value as Record<string, unknown>;
    /* The fields that show what actually travelled — not our bookkeeping. */
    const interesting = ["text", "prompt", "memory", "choice", "why", "message"]
      .map((key) => (typeof record[key] === "string" && (record[key] as string).trim() ? `${key}="${(record[key] as string).slice(0, 160)}"` : ""))
      .filter(Boolean);
    return interesting.join(" ");
  } catch {
    return "";
  }
}

/* ----------------------------------------------------------------- the ask */

/* ---------------------------------------------------------------- entrance */

export async function aiBuilderAnswer(input: {
  workflowId: string;
  /** Whose personal lessons ride along — the drawer is per architect. */
  architectUserId?: string;
  message: string;
  /** The chat so far, newest last — a follow-up like "where?" is meaningless without it. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<AiBuilderAnswer> {
  const message = input.message.trim();

  const said = (await askPlatformBrain({ instruction: ROUTER_INSTRUCTION, message, maxTokens: 10, timeoutMs: ROUTER_TIMEOUT_MS, task: "ai-builder-router" }))?.toLowerCase() ?? "";
  const hand: AiBuilderHand = said.includes("build") ? "build" : said.includes("page") ? "page" : "explain";

  if (hand !== "explain") return { hand, reply: null };

  const [agent, runs, personalLessons] = await Promise.all([
    describeAgent(input.workflowId),
    describeRecentRuns(input.workflowId),
    input.architectUserId ? lessonsForPrompt(input.architectUserId) : Promise.resolve("")
  ]);

  const reply = await askPlatformBrain({
    /* The Builder Soul rides with every explanation — the same map the
       composer builds from, so both hands speak as one employee. */
    instruction: `${EXPLAIN_INSTRUCTION}

${builderSoulText()}${personalLessons ? `\n\n${personalLessons}` : ""}`,
    message: `${agent}

${runs}

THE PERSON ASKS: ${message}`,
    maxTokens: 400,
    timeoutMs: EXPLAIN_TIMEOUT_MS,
    task: "ai-builder-explain",
    history: input.history ?? []
  });

  return {
    hand,
    reply:
      reply ??
      "I could not read your agent just now. Run it once more and ask me again — I will look at what actually happened."
  };
}
