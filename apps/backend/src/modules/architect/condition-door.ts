/**
 * THE CONDITION'S ENTRY DOOR.
 *
 * A branch is only as good as the value it tests. Asking "is this a complaint"
 * of a paragraph of prose gives an answer that is right most of the time, and
 * an agent that is right most of the time is one nobody can trust.
 *
 * So when the rule is about MEANING, the door reads whatever arrived and
 * returns one of the roads the architect named — by name, or nothing at all.
 * That removed a whole node from every agent: routing used to need an AI Brain
 * to classify and a Condition to test. Now the Condition does both.
 *
 * It only wakes for meaning. "Are we open?" is a clock, and putting a model
 * call and its cost on the commonest rule on the platform would be indefensible.
 */

import { getDoorBrainConfig } from "../admin/door-brain-settings";
import { resolveBrainSlot } from "../admin/brain-slot-settings";
import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import type { AIExecuteRequest } from "../ai-provider-engine/types";

const DOOR_TIMEOUT_MS = 12_000;

export type ConditionDecision = {
  /** One of the roads, exactly as the architect spelled it. Null if undecided. */
  choice: string | null;
  /** One line an architect and a business can both read. */
  why: string;
};

function prompt(question: string, roads: string[]): string {
  return [
    "You are choosing one road for a step in an agent, and nothing else.",
    "",
    `THE QUESTION: ${question}`,
    "",
    "THE ROADS, and you must answer with exactly one of these words:",
    ...roads.map((road) => `- ${road}`),
    "",
    "Choose the road that genuinely fits what you were given. If none of them",
    'honestly fits, answer "Anything else" rather than forcing the nearest one —',
    "a wrong road sends a real customer somewhere nobody meant them to go.",
    "",
    'Answer as JSON and nothing else: { "choice": "<one road, spelled exactly as above>", "why": "<one short line>" }'
  ].join("\n");
}

/**
 * Read what arrived and pick a road.
 *
 * Never throws. A door that cannot answer returns no choice, and the caller
 * falls back to "Anything else" — an agent must not stop because the optional
 * half of a feature had a bad minute.
 */
export async function decideConditionRoad(input: {
  question: string;
  roads: string[];
  arrived: string;
}): Promise<ConditionDecision> {
  const question = input.question.trim();
  const roads = input.roads.filter((road) => road.trim().length > 0);

  if (!question || roads.length === 0) return { choice: null, why: "nothing was asked" };

  const config = await getDoorBrainConfig().catch(() => null);
  const brain = config ? resolveBrainSlot(config) : null;
  if (!brain) return { choice: null, why: "no AI is switched on to decide with" };

  const request: AIExecuteRequest = {
    capability: "llm",
    systemPrompt: prompt(question, roads),
    conversationHistory: [],
    messages: [{ role: "user", content: input.arrived.slice(0, 8000) || "(nothing arrived)" }],
    // Low, because this is a decision, not writing. The same question about the
    // same message must take the same road every time or an agent is a coin toss.
    temperature: 0,
    maxTokens: 200,
    outputFormat: "json",
    task: "condition-entry-door",
    ...(brain.model ? { model: brain.model } : {})
  };

  let response;
  try {
    response = await Promise.race([
      getProviderEngine().executeWithProvider(brain.providerId, request),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), DOOR_TIMEOUT_MS))
    ]);
  } catch (error) {
    console.warn("[condition-door] could not decide", (error as Error).message);
    return { choice: null, why: "the decision could not be made just now" };
  }

  if (response.status === "error") return { choice: null, why: "the decision could not be made just now" };

  const raw =
    response.structuredOutput && typeof response.structuredOutput === "object"
      ? (response.structuredOutput as Record<string, unknown>)
      : parseJson(response.text ?? "");

  const said = String(raw?.choice ?? "").trim();
  const why = String(raw?.why ?? "").trim();

  /* Matched against the architect's own spelling, so the road on the canvas and
     the road taken are the same string rather than two that look alike. */
  const matched = roads.find((road) => road.toLowerCase() === said.toLowerCase());

  return {
    choice: matched ?? null,
    why: why || (matched ? `it looked like "${matched}"` : "none of the roads fitted")
  };
}

function parseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "");
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
