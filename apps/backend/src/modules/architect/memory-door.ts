/**
 * MEMORY'S EXIT DOOR.
 *
 * When there is more to remember than a step can be handed, something has to
 * go. Cutting the end off is the cheap answer and the wrong one: a conversation
 * opens with the things that matter most — somebody's name, what they wanted,
 * the date they asked for — and closes with pleasantries. Truncating keeps the
 * pleasantries and throws away the appointment.
 *
 * So beyond the limit this summarises instead. The facts survive; the small
 * talk goes. That is exactly what an exit door is for in the SOP: cleaning what
 * came back into the smallest useful thing later steps can read.
 *
 * Below the limit it does nothing at all, because most runs are short and
 * putting a model call on every one of them would be indefensible.
 */

import { getDoorBrainConfig } from "../admin/door-brain-settings";
import { resolveBrainSlot } from "../admin/brain-slot-settings";
import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import type { AIExecuteRequest } from "../ai-provider-engine/types";

const DOOR_TIMEOUT_MS = 15_000;

/** Four characters to a token is the usual rule of thumb, and close enough here. */
export function roughlyTooLong(text: string, maxTokens: number): boolean {
  return text.length > maxTokens * 4;
}

const INSTRUCTION = [
  "You are shortening what an agent remembers so it can be handed to the next step.",
  "",
  "KEEP, always:",
  "- who the person is: their name, their number, their email",
  "- what they actually want, and any date, time or amount they named",
  "- anything they were promised, and anything still unfinished",
  "- decisions already made, so they are not asked twice",
  "",
  "DROP:",
  "- greetings, thanks, apologies and small talk",
  "- anything repeated",
  "- how the agent phrased things — only what was true matters",
  "",
  "Write it as short plain notes, not prose, and not a story. Nothing else."
].join("\n");

/**
 * Shorten what is remembered, keeping the facts.
 *
 * Never throws. If it cannot summarise, the caller keeps the original text —
 * too much memory is a smaller problem than none, and an agent must not stop
 * because the optional half of a feature had a bad minute.
 */
export async function shortenMemory(memory: string, maxTokens: number): Promise<string | null> {
  if (!memory.trim() || !roughlyTooLong(memory, maxTokens)) return null;

  const config = await getDoorBrainConfig().catch(() => null);
  const brain = config ? resolveBrainSlot(config) : null;
  if (!brain) return null;

  const request: AIExecuteRequest = {
    capability: "llm",
    systemPrompt: INSTRUCTION,
    conversationHistory: [],
    messages: [{ role: "user", content: memory.slice(0, 60_000) }],
    // Zero: this is remembering, not writing. The same conversation must be
    // remembered the same way twice, or an agent contradicts itself.
    temperature: 0,
    maxTokens: Math.max(256, Math.floor(maxTokens * 0.8)),
    task: "memory-exit-door",
    ...(brain.model ? { model: brain.model } : {})
  };

  try {
    const response = await Promise.race([
      getProviderEngine().executeWithProvider(brain.providerId, request),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), DOOR_TIMEOUT_MS))
    ]);

    if (response.status === "error") return null;

    const shortened = String(response.text ?? "").trim();
    /* A summary longer than what it summarised is not a summary. Keeping the
       original is the honest answer rather than pretending work was done. */
    return shortened && shortened.length < memory.length ? shortened : null;
  } catch (error) {
    console.warn("[memory-door] could not shorten", (error as Error).message);
    return null;
  }
}
