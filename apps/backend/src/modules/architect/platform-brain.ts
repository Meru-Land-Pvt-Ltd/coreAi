/**
 * THE PLATFORM'S OWN VOICE — one way to ask a model, shared by the AI Builder
 * and the Check button.
 *
 * Always a provider's strongest model, never its cheapest: these calls are the
 * platform's face at the exact moment an architect is most confused, and a dumb
 * answer there does more damage than the model saves in pennies.
 *
 * And always patient. The Check button runs an agent, judges it, and answers
 * follow-ups in one burst — exactly the shape that trips a provider's rate
 * limit — and the first proof run showed it: two judges "could not be reached"
 * and the follow-up went silent, all one root cause. So a failed ask waits and
 * tries once more before giving up. One retry, not a loop: a provider that is
 * down stays down, and an architect deserves an answer or an honest failure
 * inside seconds, not a spinner.
 */

import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import { resolveConfiguredLlmProvider } from "../ai-provider-engine/llm-credentials";
import type { AIExecuteRequest } from "../ai-provider-engine/types";

const FLAGSHIP: Record<string, string> = {
  mistral: "mistral-large-latest",
  claude: "claude-opus-4-5",
  openai: "gpt-5.4"
};

/**
 * SMALL JOBS GET A SMALL BRAIN (2026-08-26).
 *
 * Not every call is a judgement. Deciding which of three words a message is
 * — build, page, explain — is a reflex, and running a reflex on the flagship
 * is how an architect ends up watching a blank box: the flagship was measured
 * taking 92 seconds on one call while the router waited on a 12-second leash
 * and gave up. The rule the big labs follow and we now do: the strongest
 * model for the answer that matters, the fastest for the one that does not.
 */
const QUICK: Record<string, string> = {
  mistral: "mistral-small-latest",
  claude: "claude-haiku-4-5-20251001",
  openai: "gpt-5.4-mini"
};

const RETRY_AFTER_MS = 2_500;

export async function askPlatformBrain(input: {
  instruction: string;
  message: string;
  maxTokens: number;
  timeoutMs: number;
  task: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** A reflex, not a judgement — runs on the fast model. */
  quick?: boolean;
}): Promise<string | null> {
  const resolved = resolveConfiguredLlmProvider("mistral");
  if (!resolved) return null;

  const request: AIExecuteRequest = {
    capability: "llm",
    systemPrompt: input.instruction,
    conversationHistory: (input.history ?? []).slice(-10).map((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, 2000)
    })),
    messages: [{ role: "user", content: input.message.slice(0, 24_000) }],
    temperature: 0,
    maxTokens: input.maxTokens,
    task: input.task,
    ...(() => {
      const table = input.quick ? QUICK : FLAGSHIP;
      const model = table[resolved.providerId] ?? FLAGSHIP[resolved.providerId];
      return model ? { model } : {};
    })()
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await Promise.race([
        getProviderEngine().executeWithProvider(resolved.providerId, request),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), input.timeoutMs)
        )
      ]);
      if (response.status !== "error") {
        const text = String(response.text ?? "").trim();
        if (text) return text;
      }
    } catch (error) {
      console.warn(`[${input.task}] ask failed (attempt ${attempt + 1})`, (error as Error).message);
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
  }
  return null;
}
